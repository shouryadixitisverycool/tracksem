/**
 * Curve-based grade prediction.
 *
 * Each graded item is modelled as a two-piece normal distribution:
 *  - anchored at the median when given (otherwise placed so the mean matches) as the 50th percentile,
 *  - with separate left/right spreads so a mean ≠ median produces skew,
 *  - censored to [0, paper max], so scores at the ceiling are ties, not outliers.
 *
 * Items are combined the way a class is actually ranked: by weighted total marks. Every
 * student's latent standing on an item is √ρ·G + √(1−ρ)·E, where G is shared across items,
 * so the class's distribution of totals is integrated over G with each item's real (skewed,
 * censored) mark distribution. Items where the whole class scored about the same barely
 * move the overall percentile.
 */

/** Assumed correlation between a student's performance on any two graded items */
export const ITEM_CORRELATION = 0.5;

/** z-score of the top scorer when class size is unknown */
const DEFAULT_TOP_Z = 2;

/** Neither side of a skewed distribution may be narrower than this fraction of the other */
const MIN_SIDE_RATIO = 0.3;

/** Spread floor for high-average items, as a fraction of the largest possible SD (Bhatia–Davis) */
const CEILING_SPREAD_FRACTION = 0.35;

/** Spread used when nothing better can be inferred, as a fraction of full marks */
const FALLBACK_SPREAD = 0.12;

/** Percentile range a student can be placed in when class size is unknown */
const DEFAULT_PERCENTILE_BOUNDS: [number, number] = [0.1, 99.9];

const SQRT_2PI = Math.sqrt(2 * Math.PI);

// ── Standard normal ──────────────────────────────────────────────────────────

export function normalPdf(z: number): number {
    return Math.exp(-0.5 * z * z) / SQRT_2PI;
}

/** Standard normal CDF (Hart 1968 / West 2005), ~1e-15 relative accuracy including the tails */
export function normalCdf(z: number): number {
    if (Number.isNaN(z)) return NaN;
    const x = Math.abs(z);
    let tail = 0;

    if (x < 37) {
        const e = Math.exp(-0.5 * x * x);
        if (x < 7.07106781186547) {
            let num = 3.52624965998911e-2 * x + 0.700383064443688;
            num = num * x + 6.37396220353165;
            num = num * x + 33.912866078383;
            num = num * x + 112.079291497871;
            num = num * x + 221.213596169931;
            num = num * x + 220.206867912376;
            let den = 8.83883476483184e-2 * x + 1.75566716318264;
            den = den * x + 16.064177579207;
            den = den * x + 86.7807322029461;
            den = den * x + 296.564248779674;
            den = den * x + 637.333633378831;
            den = den * x + 793.826512519948;
            den = den * x + 440.413735824752;
            tail = (e * num) / den;
        } else {
            let b = x + 0.65;
            b = x + 4 / b;
            b = x + 3 / b;
            b = x + 2 / b;
            b = x + 1 / b;
            tail = e / b / 2.506628274631;
        }
    }

    return z > 0 ? 1 - tail : tail;
}

/** Inverse standard normal CDF (Acklam's approximation + one Halley refinement step) */
export function inverseNormalCdf(p: number): number {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pLow = 0.02425;

    const clamped = Math.min(Math.max(p, 1e-15), 1 - 1e-15);
    let x: number;

    if (clamped < pLow) {
        const q = Math.sqrt(-2 * Math.log(clamped));
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (clamped > 1 - pLow) {
        const q = Math.sqrt(-2 * Math.log(1 - clamped));
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else {
        const q = clamped - 0.5;
        const r = q * q;
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }

    const e = normalCdf(x) - clamped;
    const u = e * SQRT_2PI * Math.exp(0.5 * x * x);
    return x - u / (1 + 0.5 * x * u);
}

// ── Distribution ─────────────────────────────────────────────────────────────

export interface ClassStats {
    avg: number;
    median?: number | null;
    /** Highest score obtained in the class; defaults to the paper max */
    max?: number | null;
    stdDev?: number | null;
    /** Percentage (0–100) of the class on full marks */
    fullPct?: number | null;
}

export interface ScoreDistribution {
    center: number;
    sigmaLeft: number;
    sigmaRight: number;
    /** Scores are censored to [0, paperMax]; Infinity means an uncensored distribution */
    paperMax: number;
}

/**
 * Expected z-score of the top scorer in a class of `n` (Blom's approximation).
 * ~2.2 for 40 students, ~2.5 for 100, ~2.9 for 300.
 */
export function expectedTopZ(classSize: number | null | undefined): number {
    if (classSize == null || classSize < 2) return DEFAULT_TOP_Z;
    return inverseNormalCdf((classSize - 0.375) / (classSize + 0.25));
}

function isNum(value: number | null | undefined): value is number {
    return value != null && Number.isFinite(value);
}

function clamp(value: number, lo: number, hi: number): number {
    return Math.min(Math.max(value, lo), hi);
}

/** Largest SD any distribution on [0, top] with this mean can have (Bhatia–Davis) */
function maxStdDev(top: number, avg: number): number {
    return Math.sqrt(Math.max(top - avg, 0) * Math.max(avg, 0));
}

export interface SanitizedStats {
    avg: number;
    median: number | null;
    max: number | null;
    stdDev: number | null;
    fullPct: number | null;
}

/** Drop or clamp stats that can't be right, so one typo can't dominate a course */
export function sanitizeStats(paperMax: number, stats: ClassStats): SanitizedStats {
    const avg = clamp(isNum(stats.avg) ? stats.avg : 0, 0, paperMax);
    const max = isNum(stats.max) && stats.max > 0 && stats.max <= paperMax && stats.max >= avg ? stats.max : null;
    const median = isNum(stats.median) && stats.median >= 0 && stats.median <= (max ?? paperMax) ? stats.median : null;
    const fullPct = isNum(stats.fullPct) && stats.fullPct > 0 && stats.fullPct <= 100 && (max == null || max >= paperMax)
        ? stats.fullPct
        : null;
    const stdDev = isNum(stats.stdDev) && stats.stdDev > 0 && stats.stdDev <= maxStdDev(max ?? paperMax, avg) * (1 + 1e-9)
        ? stats.stdDev
        : null;
    return { avg, median, max, stdDev, fullPct };
}

/** Partial moments of the standard normal on (lo, hi) */
function partialMoments(lo: number, hi: number): [number, number, number] {
    if (hi <= lo) return [0, 0, 0];
    const pdfLo = Number.isFinite(lo) ? normalPdf(lo) : 0;
    const pdfHi = Number.isFinite(hi) ? normalPdf(hi) : 0;
    const p = normalCdf(hi) - normalCdf(lo);
    const m1 = pdfLo - pdfHi;
    const m2 = p + (Number.isFinite(lo) ? lo * pdfLo : 0) - (Number.isFinite(hi) ? hi * pdfHi : 0);
    return [p, m1, m2];
}

/**
 * Mean and variance of the (censored) score when the latent z is N(mu, s²).
 * With mu = 0, s = 1 these are the class's own moments.
 */
export function conditionalMoments(dist: ScoreDistribution, mu = 0, s = 1): { mean: number; variance: number } {
    const lower = Number.isFinite(dist.paperMax) ? 0 : -Infinity;
    const upper = dist.paperMax;
    const at = (z: number) => {
        const x = dist.center + (z < 0 ? dist.sigmaLeft : dist.sigmaRight) * z;
        return clamp(x, lower, upper);
    };

    if (s <= 0) return { mean: at(mu), variance: 0 };

    let e1 = 0;
    let e2 = 0;
    // value = alpha + beta·z on latent z ∈ (zLo, zHi)
    const addSegment = (zLo: number, zHi: number, alpha: number, beta: number) => {
        const [p, m1, m2] = partialMoments((zLo - mu) / s, (zHi - mu) / s);
        if (p <= 0 && m1 === 0) return;
        const a = alpha + beta * mu;
        const b = beta * s;
        e1 += a * p + b * m1;
        e2 += a * a * p + 2 * a * b * m1 + b * b * m2;
    };
    const addHalf = (zLo: number, zHi: number, sigma: number) => {
        if (sigma <= 0) {
            addSegment(zLo, zHi, clamp(dist.center, lower, upper), 0);
            return;
        }
        const zFloor = Number.isFinite(lower) ? (lower - dist.center) / sigma : -Infinity;
        const zCeil = Number.isFinite(upper) ? (upper - dist.center) / sigma : Infinity;
        addSegment(zLo, Math.min(zHi, zFloor), lower, 0);
        addSegment(Math.max(zLo, zFloor), Math.min(zHi, zCeil), dist.center, sigma);
        addSegment(Math.max(zLo, zCeil), zHi, upper, 0);
    };

    addHalf(-Infinity, 0, dist.sigmaLeft);
    addHalf(0, Infinity, dist.sigmaRight);

    return { mean: e1, variance: Math.max(e2 - e1 * e1, 0) };
}

/** Mean and true SD of the class's censored score distribution */
export function distributionMoments(dist: ScoreDistribution): { mean: number; sd: number } {
    const { mean, variance } = conditionalMoments(dist);
    return { mean, sd: Math.sqrt(variance) };
}

/** Root of a monotone function by bisection; returns the nearer bracket end when out of range */
function solveMonotone(f: (x: number) => number, lo: number, hi: number, target: number): number {
    const fLo = f(lo);
    const fHi = f(hi);
    const increasing = fHi >= fLo;
    if (increasing ? target <= fLo : target >= fLo) return lo;
    if (increasing ? target >= fHi : target <= fHi) return hi;

    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if ((f(mid) < target) === increasing) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** Side spreads whose uncensored two-piece normal has SD `sd` and σR − σL = `d`, sides floored */
function sidesFromMoments(sd: number, d: number): [number, number] {
    // Var = (σL² + σR²)/2 − (σR − σL)²/2π
    const disc = 4 * (sd * sd + (d * d) / (2 * Math.PI)) - d * d;
    let left = disc > 0 ? (-d + Math.sqrt(disc)) / 2 : NaN;
    let right = left + d;
    if (!(Math.min(left, right) >= MIN_SIDE_RATIO * Math.max(left, right))) {
        const r = MIN_SIDE_RATIO;
        const big = sd / Math.sqrt((1 + r * r) / 2 - ((1 - r) ** 2) / (2 * Math.PI));
        [left, right] = d >= 0 ? [r * big, big] : [big, r * big];
    }
    return [left, right];
}

function floorSides(left: number, right: number): [number, number] {
    if (left < MIN_SIDE_RATIO * right) return [MIN_SIDE_RATIO * right, right];
    if (right < MIN_SIDE_RATIO * left) return [left, MIN_SIDE_RATIO * left];
    return [left, right];
}

/**
 * A top score at the paper max may be a capped score, so (max − center)/topZ is only a lower
 * bound on the spread. For high-average items, assume at least a moderate spread instead
 * (ramping in between 80% and 90% average so the fit stays continuous).
 */
function ceilingSpreadFloor(paperMax: number, avg: number): number {
    const ramp = clamp((avg / paperMax - 0.8) / 0.1, 0, 1);
    return ramp * CEILING_SPREAD_FRACTION * maxStdDev(paperMax, avg);
}

export function buildDistribution(
    paperMax: number,
    stats: ClassStats,
    classSize?: number | null,
): ScoreDistribution {
    const M = paperMax;
    const make = (center: number, sigmaLeft: number, sigmaRight: number): ScoreDistribution => ({
        center,
        sigmaLeft: Math.max(sigmaLeft, 0),
        sigmaRight: Math.max(sigmaRight, 0),
        paperMax: M,
    });
    if (!(M > 0)) return make(0, 0, 0);

    const { avg, median, max, stdDev, fullPct } = sanitizeStats(M, stats);
    const tiny = M * 1e-6;
    const meanOf = (dist: ScoreDistribution) => conditionalMoments(dist).mean;
    /** Symmetric spread `sigma`, center placed so the censored mean equals the class average */
    const symmetric = (sigma: number) => {
        const center = solveMonotone((c) => meanOf(make(c, sigma, sigma)), avg - 10 * sigma - tiny, avg + 10 * sigma + tiny, avg);
        return make(center, sigma, sigma);
    };

    // Known share of the class tied at full marks: P(score ≥ max) = q
    if (fullPct != null) {
        const q = Math.min(fullPct, 99.5) / 100;
        if (median != null && median < M && q < 0.5) {
            const right = (M - median) / inverseNormalCdf(1 - q);
            const left = solveMonotone((sl) => meanOf(make(median, sl, right)), tiny, 4 * M, avg);
            return make(median, Math.max(left, MIN_SIDE_RATIO * right), right);
        }
        const zq = inverseNormalCdf(q);
        const sigma = solveMonotone((s) => meanOf(make(M + s * zq, s, s)), tiny, 4 * M, avg);
        return make(M + sigma * zq, sigma, sigma);
    }

    // Half the class or more on full marks
    if (median != null && median >= M) {
        const left = solveMonotone((sl) => meanOf(make(M, sl, sl)), tiny, 4 * M, avg);
        return make(M, left, left);
    }

    if (stdDev != null) {
        if (median == null) return symmetric(stdDev);
        // Mass is split 50/50 at the center, so mean − center = (σR − σL) / √(2π)
        const [left, right] = sidesFromMoments(stdDev, (avg - median) * SQRT_2PI);
        return make(median, left, right);
    }

    const top = max ?? M;
    const center = median ?? avg;
    if (top > center) {
        let right = Math.min((top - center) / expectedTopZ(classSize), maxStdDev(top, avg));
        if (top >= M) right = Math.max(right, ceilingSpreadFloor(M, avg));
        if (median == null) return symmetric(right);
        const left = solveMonotone((sl) => meanOf(make(median, sl, right)), tiny, 4 * M, avg);
        return make(median, ...floorSides(left, right));
    }

    const fallback = M * FALLBACK_SPREAD;
    if (median == null) return symmetric(fallback);
    const [left, right] = sidesFromMoments(fallback, (avg - median) * SQRT_2PI);
    return make(median, left, right);
}

/** Fraction of the uncensored distribution strictly below `x` */
function distributionCdf(x: number, dist: ScoreDistribution): number {
    if (x === dist.center) return 0.5;
    if (x < dist.center) {
        return dist.sigmaLeft > 0 ? normalCdf((x - dist.center) / dist.sigmaLeft) : 0;
    }
    return dist.sigmaRight > 0 ? normalCdf((x - dist.center) / dist.sigmaRight) : 1;
}

/**
 * Percentile (0–100) of `score`. Scores at 0 or the paper max are tied with everyone
 * the distribution pushes past that bound, so they get the midpoint of the tied group.
 */
export function scoreToPercentile(score: number, dist: ScoreDistribution): number {
    if (score >= dist.paperMax) {
        const below = distributionCdf(dist.paperMax, dist);
        return (below + (1 - below) / 2) * 100;
    }
    if (score <= 0 && Number.isFinite(dist.paperMax)) {
        return (distributionCdf(0, dist) / 2) * 100;
    }
    return distributionCdf(score, dist) * 100;
}

/** Score at percentile `percentile` (0–100) of the class */
export function percentileToScore(percentile: number, dist: ScoreDistribution): number {
    return latentToScore(dist, inverseNormalCdf(percentile / 100));
}

function latentToScore(dist: ScoreDistribution, z: number): number {
    const x = dist.center + (z < 0 ? dist.sigmaLeft : dist.sigmaRight) * z;
    return Number.isFinite(dist.paperMax) ? clamp(x, 0, dist.paperMax) : x;
}

/** Range of percentiles a student can occupy: [50/n, 100 − 50/n] for a class of n */
export function percentileBounds(classSize?: number | null): [number, number] {
    if (classSize == null || !(classSize >= 2)) return DEFAULT_PERCENTILE_BOUNDS;
    return [50 / classSize, 100 - 50 / classSize];
}

export function clampPercentile(percentile: number, classSize?: number | null): number {
    if (classSize == null || !(classSize >= 2)) return clamp(percentile, 0, 100);
    const [lo, hi] = percentileBounds(classSize);
    return clamp(percentile, lo, hi);
}

// ── Input validation ─────────────────────────────────────────────────────────

export interface StatsInput {
    maxScore: number;
    score?: number | null;
    classAvg?: number | null;
    classMedian?: number | null;
    classMax?: number | null;
    classStdDev?: number | null;
    classFullPct?: number | null;
}

export interface StatsIssue {
    field: 'score' | 'classAvg' | 'classMedian' | 'classMax' | 'classStdDev' | 'classFullPct';
    level: 'error' | 'warning';
    message: string;
}

function fmt(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export function validateStats(item: StatsInput): StatsIssue[] {
    const issues: StatsIssue[] = [];
    const M = item.maxScore;
    const error = (field: StatsIssue['field'], message: string) => issues.push({ field, level: 'error', message });
    const warn = (field: StatsIssue['field'], message: string) => issues.push({ field, level: 'warning', message });
    const inRange = (value: number) => value >= 0 && value <= M;

    const { score, classAvg: avg, classMedian: median, classMax: max, classStdDev: sd, classFullPct: fullPct } = item;
    const validMax = isNum(max) && inRange(max);

    if (isNum(score)) {
        if (score < 0) error('score', 'Score can\'t be negative');
        else if (score > M) error('score', `Score is above the paper max (${fmt(M)})`);
        else if (validMax && score > max) warn('score', 'Above the class max: you\'d be the topper');
    }
    if (isNum(avg) && !inRange(avg)) error('classAvg', `Average must be between 0 and ${fmt(M)}`);
    if (isNum(median) && !inRange(median)) error('classMedian', `Median must be between 0 and ${fmt(M)}`);
    if (isNum(max) && !inRange(max)) error('classMax', `Class max must be between 0 and ${fmt(M)}`);
    if (validMax && isNum(median) && inRange(median) && median > max) error('classMedian', 'Median can\'t exceed the class max');
    if (validMax && isNum(avg) && inRange(avg) && avg > max) error('classAvg', 'Average can\'t exceed the class max');
    if (isNum(fullPct)) {
        if (fullPct < 0 || fullPct > 100) error('classFullPct', 'Must be between 0 and 100%');
        else if (fullPct > 0 && validMax && max < M) warn('classFullPct', 'Class max is below full marks, yet some scored full marks');
    }

    if (isNum(sd)) {
        if (sd < 0) {
            error('classStdDev', 'Std dev can\'t be negative');
        } else if (isNum(avg) && inRange(avg)) {
            const top = validMax && max >= avg ? max : M;
            const bound = maxStdDev(top, avg);
            if (sd > bound * (1 + 1e-9)) {
                error('classStdDev', `Too large for this average (at most ${fmt(bound)})`);
            } else if (sd > 0) {
                const hasMedian = isNum(median) && inRange(median);
                if (hasMedian && Math.abs(avg - median) > sd) {
                    warn('classStdDev', 'Mean and median are more than one std dev apart');
                }
                if (validMax) {
                    const center = hasMedian ? median : avg;
                    const right = hasMedian ? sidesFromMoments(sd, (avg - median) * SQRT_2PI)[1] : sd;
                    const ratio = (max - center) / right;
                    if (ratio < 1) warn('classStdDev', 'Looks large for this class max');
                    else if (ratio > 4) warn('classStdDev', 'Looks small for this class max');
                }
            }
        }
    }

    return issues;
}

// ── Percentile → Letter grade ────────────────────────────────────────────────

export type CurvedLetter = 'A' | 'A-' | 'B' | 'B-' | 'C' | 'C-' | 'D' | 'F';

export function percentileToGrade(percentile: number): CurvedLetter {
    if (percentile >= 90) return 'A';
    if (percentile >= 80) return 'A-';
    if (percentile >= 65) return 'B';
    if (percentile >= 50) return 'B-';
    if (percentile >= 35) return 'C';
    if (percentile >= 20) return 'C-';
    if (percentile >= 10) return 'D';
    return 'F';
}

// ── Color for curved letter grades ───────────────────────────────────────────

const CURVED_GRADE_COLORS: Record<CurvedLetter, string> = {
    'A':  '#4ade80',
    'A-': '#86efac',
    'B':  '#60a5fa',
    'B-': '#93c5fd',
    'C':  '#fbbf24',
    'C-': '#fcd34d',
    'D':  '#fb923c',
    'F':  '#f87171',
};

export function getCurvedGradeColor(letter: CurvedLetter): string {
    return CURVED_GRADE_COLORS[letter] ?? '#6b7280';
}

// ── Predictions ──────────────────────────────────────────────────────────────

/** Position of a student within the class on one item (or a combination of items) */
export interface Standing {
    /** Normal-equivalent z of the percentile */
    z: number;
    /** True class SD as a fraction of full marks (of total weight for combinations) */
    spread: number;
}

export interface PredictedGrade extends Standing {
    percentile: number;
    letter: CurvedLetter;
    color: string;
}

function percentileToZ(percentile: number): number {
    return inverseNormalCdf(clamp(percentile, 0.01, 99.99) / 100);
}

function toPrediction(percentile: number, spread: number): PredictedGrade {
    const letter = percentileToGrade(percentile);
    return { percentile, letter, color: getCurvedGradeColor(letter), z: percentileToZ(percentile), spread };
}

export function standingToPrediction(standing: Standing): PredictedGrade {
    return { ...toPrediction(normalCdf(standing.z) * 100, standing.spread), z: standing.z };
}

export function predictGrade(
    score: number,
    paperMax: number,
    stats: ClassStats,
    classSize?: number | null,
): PredictedGrade {
    const dist = buildDistribution(paperMax, stats, classSize);
    const percentile = clampPercentile(scoreToPercentile(score, dist), classSize);
    return toPrediction(percentile, paperMax > 0 ? distributionMoments(dist).sd / paperMax : 0);
}

// ── Combining items ──────────────────────────────────────────────────────────

export interface CombineItem {
    weight: number;
    dist: ScoreDistribution;
    /** Student's marks, in the same units as `dist` */
    score: number;
    /** Skip bounding the score to the class's percentile range (for what-if searches) */
    unbounded?: boolean;
}

export interface CombineOptions {
    /** Correlation between a student's latent standing on any two items */
    correlation?: number;
    classSize?: number | null;
}

/** Trapezoid quadrature nodes for a standard normal variable on [−6, 6] */
function normalNodes(step: number): { x: number; w: number }[] {
    const nodes: { x: number; w: number }[] = [];
    const count = Math.round(12 / step);
    for (let i = 0; i <= count; i++) {
        const x = -6 + i * step;
        nodes.push({ x, w: normalPdf(x) });
    }
    const total = nodes.reduce((sum, node) => sum + node.w, 0);
    return nodes.map((node) => ({ x: node.x, w: node.w / total }));
}

/** Shared factor G */
const FACTOR_NODES = normalNodes(0.2);
/** Residual of the item with the largest spread, integrated exactly rather than normal-approximated */
const RESIDUAL_NODES = normalNodes(0.05);

/**
 * Raw (unclamped) percentile of the student's weighted total among the class, and the SD of
 * the class's weighted total as a fraction of the total weight.
 *
 * Conditional on the shared factor G the items are independent. The item with the largest
 * spread is integrated over its own residual exactly; the rest of the class total given G is
 * approximated as normal from each item's exact conditional moments. Integrating over G keeps
 * the skew of individual items. A single item uses its exact percentile.
 */
export function combinedPercentile(
    items: CombineItem[],
    options: CombineOptions = {},
): { percentile: number; spread: number } | null {
    const active = items.filter((item) => item.weight > 0 && Number.isFinite(item.score));
    if (active.length === 0) return null;

    const rho = clamp(options.correlation ?? ITEM_CORRELATION, 0, 1);
    const [pLo, pHi] = percentileBounds(options.classSize);
    const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);

    const terms = active.map((item) => {
        const unit = Number.isFinite(item.dist.paperMax) && item.dist.paperMax > 0 ? item.dist.paperMax : 1;
        const score = item.unbounded
            ? item.score
            : clamp(item.score, percentileToScore(pLo, item.dist), percentileToScore(pHi, item.dist));
        return { k: item.weight / unit, score, dist: item.dist };
    });

    if (terms.length === 1) {
        const [{ k, score, dist }] = terms;
        return {
            percentile: scoreToPercentile(score, dist),
            spread: (k * distributionMoments(dist).sd) / totalWeight,
        };
    }

    const total = terms.reduce((sum, term) => sum + term.k * term.score, 0);
    const loading = Math.sqrt(rho);
    const residual = Math.sqrt(1 - rho);
    const eps = 1e-12 * totalWeight;

    const spreads = terms.map((term) => term.k * distributionMoments(term.dist).sd);
    const lead = spreads.indexOf(Math.max(...spreads));
    const leadTerm = terms[lead];

    let below = 0;
    let meanOfMeans = 0;
    let meanOfSquares = 0;
    let meanVariance = 0;
    for (const { x: g, w } of FACTOR_NODES) {
        let restMean = 0;
        let restVariance = 0;
        terms.forEach((term, i) => {
            if (i === lead) return;
            const m = conditionalMoments(term.dist, loading * g, residual);
            restMean += term.k * m.mean;
            restVariance += term.k * term.k * m.variance;
        });
        const restSd = Math.sqrt(restVariance);

        let cdf = 0;
        for (const { x: e, w: we } of RESIDUAL_NODES) {
            const gap = total - restMean - leadTerm.k * latentToScore(leadTerm.dist, loading * g + residual * e);
            if (restSd > eps) {
                const z = gap / restSd;
                cdf += we * (z > 9 ? 1 : z < -9 ? 0 : normalCdf(z));
            } else {
                cdf += we * (gap > eps ? 1 : gap < -eps ? 0 : 0.5);
            }
        }

        const leadMoments = conditionalMoments(leadTerm.dist, loading * g, residual);
        const mean = restMean + leadTerm.k * leadMoments.mean;
        below += w * cdf;
        meanOfMeans += w * mean;
        meanOfSquares += w * mean * mean;
        meanVariance += w * (restVariance + leadTerm.k * leadTerm.k * leadMoments.variance);
    }

    const totalVariance = Math.max(meanOfSquares - meanOfMeans ** 2, 0) + meanVariance;
    return { percentile: below * 100, spread: Math.sqrt(totalVariance) / totalWeight };
}

/** Grade for a raw percentile, clamped to the class's percentile range */
export function gradeFromPercentile(percentile: number, spread: number, classSize?: number | null): PredictedGrade {
    return toPrediction(clampPercentile(percentile, classSize), spread);
}

/** Standing on the weighted total of several items, clamped to the class's percentile range */
export function combineItems(items: CombineItem[], options: CombineOptions = {}): PredictedGrade | null {
    const combined = combinedPercentile(items, options);
    if (!combined) return null;
    return gradeFromPercentile(combined.percentile, combined.spread, options.classSize);
}

/**
 * Normal approximation for combining already-summarised standings, each contributing
 * z·spread marks. Ignores skew; prefer `combineItems` (or `courseCurvedGrade`) when the
 * items' distributions are available.
 */
export function combineStandings(
    items: { weight: number; standing: Standing }[],
    correlation: number = ITEM_CORRELATION,
): Standing | null {
    const active = items.filter((item) => item.weight > 0);
    if (active.length === 0) return null;

    const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
    const scaled = active.map((item) => item.weight * item.standing.spread);

    let variance = 0;
    for (let i = 0; i < scaled.length; i++) {
        for (let j = 0; j < scaled.length; j++) {
            variance += scaled[i] * scaled[j] * (i === j ? 1 : correlation);
        }
    }

    const sd = Math.sqrt(variance);
    if (sd === 0) {
        const z = active.reduce((sum, item) => sum + item.weight * item.standing.z, 0) / totalWeight;
        return { z, spread: 0 };
    }

    const z = active.reduce((sum, item, i) => sum + scaled[i] * item.standing.z, 0) / sd;
    return { z, spread: sd / totalWeight };
}

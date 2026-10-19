/**
 * Curve-based grade prediction.
 *
 * Each graded item is modelled as a two-piece normal distribution:
 *  - anchored at the median when given (otherwise the mean) as the 50th percentile,
 *  - with separate left/right spreads so a mean ≠ median produces skew,
 *  - censored to [0, paper max], so scores at the ceiling are ties, not outliers.
 *
 * Items are combined the way a class is actually ranked: by weighted total marks.
 * Each item contributes its z-score scaled by its spread, so items where the
 * whole class scored about the same barely move the overall percentile.
 */

/** Assumed correlation between a student's performance on any two graded items */
export const ITEM_CORRELATION = 0.5;

/** z-score of the top scorer when class size is unknown */
const DEFAULT_TOP_Z = 2;

const SQRT_2PI = Math.sqrt(2 * Math.PI);

// ── Standard normal CDF (Abramowitz & Stegun approximation) ──────────────────

export function normalCdf(z: number): number {
    if (z < -6) return 0;
    if (z > 6) return 1;

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
}

// ── Inverse standard normal CDF (Acklam's approximation) ─────────────────────

export function inverseNormalCdf(p: number): number {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pLow = 0.02425;

    const clamped = Math.min(Math.max(p, 1e-9), 1 - 1e-9);

    if (clamped < pLow) {
        const q = Math.sqrt(-2 * Math.log(clamped));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    if (clamped > 1 - pLow) {
        const q = Math.sqrt(-2 * Math.log(1 - clamped));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    const q = clamped - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ── Distribution ─────────────────────────────────────────────────────────────

export interface ClassStats {
    avg: number;
    median?: number | null;
    /** Highest score obtained in the class; defaults to the paper max */
    max?: number | null;
    stdDev?: number | null;
}

export interface ScoreDistribution {
    center: number;
    sigmaLeft: number;
    sigmaRight: number;
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

export function buildDistribution(
    paperMax: number,
    stats: ClassStats,
    classSize?: number | null,
): ScoreDistribution {
    const center = stats.median ?? stats.avg;
    // Mass is split 50/50 at the center, so mean − center = (σR − σL) / √(2π)
    const skew = stats.median != null ? (stats.avg - stats.median) * SQRT_2PI : 0;

    let sigmaLeft: number;
    let sigmaRight: number;

    const topScore = stats.max ?? paperMax;
    if (stats.stdDev != null && stats.stdDev > 0) {
        sigmaLeft = stats.stdDev - skew / 2;
        sigmaRight = stats.stdDev + skew / 2;
    } else if (topScore >= center && (topScore > center || skew < 0)) {
        sigmaRight = (topScore - center) / expectedTopZ(classSize);
        sigmaLeft = sigmaRight - skew;
    } else {
        const fallback = paperMax * 0.12;
        sigmaLeft = fallback - skew / 2;
        sigmaRight = fallback + skew / 2;
    }

    return {
        center,
        sigmaLeft: Math.max(sigmaLeft, 0),
        sigmaRight: Math.max(sigmaRight, 0),
        paperMax,
    };
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
    if (score <= 0) {
        return (distributionCdf(0, dist) / 2) * 100;
    }
    return distributionCdf(score, dist) * 100;
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
    z: number;
    /** Class spread as a fraction of full marks */
    spread: number;
}

export interface PredictedGrade extends Standing {
    percentile: number;
    letter: CurvedLetter;
    color: string;
}

function percentileToZ(percentile: number): number {
    return inverseNormalCdf(Math.min(Math.max(percentile, 0.1), 99.9) / 100);
}

export function standingToPrediction(standing: Standing): PredictedGrade {
    const percentile = normalCdf(standing.z) * 100;
    const letter = percentileToGrade(percentile);
    return { ...standing, percentile, letter, color: getCurvedGradeColor(letter) };
}

export function predictGrade(
    score: number,
    paperMax: number,
    stats: ClassStats,
    classSize?: number | null,
): PredictedGrade {
    const dist = buildDistribution(paperMax, stats, classSize);
    const percentile = scoreToPercentile(score, dist);
    const letter = percentileToGrade(percentile);
    const spread = paperMax > 0
        ? Math.sqrt((dist.sigmaLeft ** 2 + dist.sigmaRight ** 2) / 2) / paperMax
        : 0;

    return {
        percentile,
        letter,
        color: getCurvedGradeColor(letter),
        z: percentileToZ(percentile),
        spread,
    };
}

/**
 * Combine standings on several items into a standing on their weighted total,
 * assuming performance on any two items correlates by `ITEM_CORRELATION`.
 */
export function combineStandings(items: { weight: number; standing: Standing }[]): Standing | null {
    const active = items.filter((item) => item.weight > 0);
    if (active.length === 0) return null;

    const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
    const scaled = active.map((item) => item.weight * item.standing.spread);

    let variance = 0;
    for (let i = 0; i < scaled.length; i++) {
        for (let j = 0; j < scaled.length; j++) {
            variance += scaled[i] * scaled[j] * (i === j ? 1 : ITEM_CORRELATION);
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

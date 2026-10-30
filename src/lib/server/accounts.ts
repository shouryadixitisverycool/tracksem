import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Kept dependency-free (no $lib imports) so node --test and scripts/create-user.mjs can use it.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_PERSON_NAME_LENGTH = 100;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Trimmed display name, 1–100 characters */
export function checkPersonName(value: unknown): Checked<string> {
	if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'Enter your name' };
	const trimmed = value.trim().replace(/\s+/g, ' ');
	if (trimmed.length > MAX_PERSON_NAME_LENGTH) {
		return { ok: false, error: `Name must be at most ${MAX_PERSON_NAME_LENGTH} characters` };
	}
	return { ok: true, value: trimmed };
}

/** Roll numbers are letters and digits only, stored uppercase so lookups ignore case */
export function checkRollNumber(value: unknown): Checked<string> {
	if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'Enter your roll number' };
	const normalized = value.trim().toUpperCase();
	if (!/^[A-Z0-9]{3,20}$/.test(normalized)) {
		return { ok: false, error: 'Roll number must be 3–20 letters or digits' };
	}
	return { ok: true, value: normalized };
}

export function checkPassword(value: unknown): Checked<string> {
	if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
		return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
	}
	if (value.length > MAX_PASSWORD_LENGTH) {
		return { ok: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` };
	}
	return { ok: true, value };
}

// ─── Password hashing (scrypt) ───────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) =>
			error ? reject(error) : resolve(key)
		);
	});
}

/** "scrypt$N$r$p$<salt b64>$<key b64>" */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await derive(password, salt, SCRYPT);
	return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, n, r, p, salt, key] = stored.split('$');
	if (scheme !== 'scrypt' || !salt || !key) return false;
	const expected = Buffer.from(key, 'base64');
	const actual = await derive(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash checked against when the roll number doesn't exist, so timing doesn't reveal which accounts exist */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
	dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
	return dummyHash;
}

// ─── Session tokens ──────────────────────────────────────────────────────────

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Random cookie value; only its SHA-256 is stored, so a leaked DB can't be replayed as sessions */
export function newSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

export function sessionIdFor(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

// ─── Attempt limiting ────────────────────────────────────────────────────────

/** Fixed-window counter per key, kept in memory (resets on restart, which is fine for one container) */
export class AttemptLimiter {
	#hits = new Map<string, { count: number; resetAt: number }>();
	readonly limit: number;
	readonly windowMs: number;

	// Plain fields instead of parameter properties: node's type stripping can't handle those
	constructor(limit: number, windowMs: number) {
		this.limit = limit;
		this.windowMs = windowMs;
	}

	blocked(key: string, now = Date.now()): boolean {
		const entry = this.#hits.get(key);
		return entry !== undefined && entry.resetAt > now && entry.count >= this.limit;
	}

	record(key: string, now = Date.now()): void {
		const entry = this.#hits.get(key);
		if (!entry || entry.resetAt <= now) {
			if (this.#hits.size > 10_000) this.#prune(now);
			this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
		} else {
			entry.count++;
		}
	}

	clear(key: string): void {
		this.#hits.delete(key);
	}

	#prune(now: number): void {
		for (const [key, entry] of this.#hits) if (entry.resetAt <= now) this.#hits.delete(key);
	}
}

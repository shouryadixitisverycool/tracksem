#!/usr/bin/env node
// Create a tracksem account from the command line, optionally giving it every semester that
// has no owner yet (data from before accounts existed).
//
// Usage (inside the container, after the app has started once so the schema exists):
//   docker exec tracksem node scripts/create-user.mjs --name "Your Name" --roll 2025115017 [--claim]
// Password: TRACKSEM_NEW_PASSWORD if set, otherwise a random one is generated and printed once.
// DB:       TRACKSEM_DB_PATH (default /app/data/tracksem.db)
//
// The hash format must match hashPassword() in src/lib/server/accounts.ts (a test checks this).

import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRYPT = { N: 16384, r: 8, p: 1 };

/** @param {string} password @returns {Promise<string>} */
export function hashPassword(password) {
	const salt = randomBytes(16);
	return new Promise((resolve, reject) => {
		scrypt(password.normalize('NFKC'), salt, 64, { ...SCRYPT, maxmem: 64 * 1024 * 1024 }, (error, key) => {
			if (error) return reject(error);
			resolve(['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$'));
		});
	});
}

async function main() {
	const { values } = parseArgs({
		options: { name: { type: 'string' }, roll: { type: 'string' }, claim: { type: 'boolean', default: false } }
	});
	const name = values.name?.trim().replace(/\s+/g, ' ');
	const roll = values.roll?.trim().toUpperCase();
	if (!name || !roll || !/^[A-Z0-9]{3,20}$/.test(roll)) {
		console.error('usage: create-user.mjs --name "Full Name" --roll ROLLNUMBER [--claim]');
		process.exit(2);
	}

	const generated = !process.env.TRACKSEM_NEW_PASSWORD;
	const password = process.env.TRACKSEM_NEW_PASSWORD ?? randomBytes(12).toString('base64url');
	if (password.length < 8) {
		console.error('password must be at least 8 characters');
		process.exit(2);
	}

	const { default: Database } = await import('better-sqlite3');
	const db = new Database(process.env.TRACKSEM_DB_PATH ?? '/app/data/tracksem.db', { fileMustExist: true });
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) {
		console.error('no users table yet: start the app once so it can migrate the database');
		process.exit(1);
	}

	const hash = await hashPassword(password);
	const id = randomUUID();
	let claimed = 0;
	try {
		db.transaction(() => {
			db.prepare('INSERT INTO users (id, name, roll_number, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
				id,
				name,
				roll,
				hash,
				Date.now()
			);
			if (values.claim) claimed = db.prepare('UPDATE semesters SET user_id = ? WHERE user_id IS NULL').run(id).changes;
		})();
	} catch (error) {
		if (String(error).includes('UNIQUE')) {
			console.error(`roll number ${roll} already has an account`);
			process.exit(1);
		}
		throw error;
	} finally {
		db.close();
	}

	console.log(`created ${name} (${roll})`);
	if (values.claim) console.log(`assigned ${claimed} unowned semester${claimed === 1 ? '' : 's'} to this account`);
	if (generated) console.log(`temporary password: ${password}\nchange it from the data menu → change password`);
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();

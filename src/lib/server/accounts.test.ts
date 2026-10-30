import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	AttemptLimiter,
	checkPassword,
	checkPersonName,
	checkRollNumber,
	hashPassword,
	sessionIdFor,
	verifyPassword
} from './accounts.ts';

test('hashed passwords verify, and the hash never contains the password', async () => {
	const hash = await hashPassword('correct horse battery');
	assert.match(hash, /^scrypt\$16384\$8\$1\$/);
	assert.ok(!hash.includes('correct horse battery'));
	assert.equal(await verifyPassword('correct horse battery', hash), true);
	assert.equal(await verifyPassword('correct horse batterz', hash), false);
	assert.equal(await verifyPassword('anything', 'garbage'), false);
});

test('the same password hashes differently each time (random salt)', async () => {
	assert.notEqual(await hashPassword('samesame1'), await hashPassword('samesame1'));
});

test('scripts/create-user.mjs hashes compatibly', async () => {
	const { hashPassword: scriptHash } = await import('../../../scripts/create-user.mjs');
	assert.equal(await verifyPassword('from the script', await scriptHash('from the script')), true);
});

test('roll numbers are normalized to uppercase alphanumerics', () => {
	assert.deepEqual(checkRollNumber(' 2025115017 '), { ok: true, value: '2025115017' });
	assert.deepEqual(checkRollNumber('mt23abc'), { ok: true, value: 'MT23ABC' });
	assert.equal(checkRollNumber('20 25').ok, false);
	assert.equal(checkRollNumber('ab').ok, false);
	assert.equal(checkRollNumber(42).ok, false);
});

test('names are trimmed and collapsed; passwords need 8+ characters', () => {
	assert.deepEqual(checkPersonName('  Shourya   Dixit '), { ok: true, value: 'Shourya Dixit' });
	assert.equal(checkPersonName('   ').ok, false);
	assert.equal(checkPassword('short').ok, false);
	assert.equal(checkPassword('long enough').ok, true);
});

test('session ids are a stable hash of the token', () => {
	assert.equal(sessionIdFor('abc'), sessionIdFor('abc'));
	assert.notEqual(sessionIdFor('abc'), 'abc');
});

test('AttemptLimiter blocks after the limit until the window passes', () => {
	const limiter = new AttemptLimiter(2, 1000);
	limiter.record('k', 0);
	assert.equal(limiter.blocked('k', 10), false);
	limiter.record('k', 10);
	assert.equal(limiter.blocked('k', 20), true);
	assert.equal(limiter.blocked('k', 1001), false);
	limiter.clear('k');
	assert.equal(limiter.blocked('k', 20), false);
});

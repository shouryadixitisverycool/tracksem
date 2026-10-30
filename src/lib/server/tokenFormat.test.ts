import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	TOKEN_PREFIX,
	formatScope,
	hashToken,
	isAllowedRedirectUri,
	newToken,
	parseScope,
	safeEqual,
	verifyPkceS256
} from './tokenFormat.ts';

test('parseScope accepts strings and arrays and implies read from write', () => {
	assert.deepEqual(parseScope('read'), ['read']);
	assert.deepEqual(parseScope('read write'), ['read', 'write']);
	assert.deepEqual(parseScope('write'), ['read', 'write']);
	assert.deepEqual(parseScope(['read']), ['read']);
	assert.deepEqual(parseScope(['write', 'read']), ['read', 'write']);
});

test('parseScope rejects empty, unknown and malformed values', () => {
	assert.equal(parseScope(''), null);
	assert.equal(parseScope('   '), null);
	assert.equal(parseScope([]), null);
	assert.equal(parseScope('admin'), null);
	assert.equal(parseScope('read admin'), null);
	assert.equal(parseScope(['read', 1]), null);
	assert.equal(parseScope(null), null);
	assert.equal(parseScope(42), null);
});

test('formatScope produces the canonical stored form', () => {
	assert.equal(formatScope(['read']), 'read');
	assert.equal(formatScope(['write']), 'read write');
	assert.equal(formatScope(['read', 'write']), 'read write');
});

test('isAllowedRedirectUri accepts https, loopback http and private-use schemes', () => {
	assert.equal(isAllowedRedirectUri('https://example.com/cb'), true);
	assert.equal(isAllowedRedirectUri('http://localhost:3000/cb'), true);
	assert.equal(isAllowedRedirectUri('http://127.0.0.1/cb'), true);
	assert.equal(isAllowedRedirectUri('http://[::1]:8080/cb'), true);
	assert.equal(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'), true);
	assert.equal(isAllowedRedirectUri('com.example.app:/cb'), true);
});

test('isAllowedRedirectUri rejects remote http, dangerous schemes and malformed URIs', () => {
	assert.equal(isAllowedRedirectUri('http://example.com/cb'), false);
	assert.equal(isAllowedRedirectUri('javascript:alert(1)'), false);
	assert.equal(isAllowedRedirectUri('data:text/html,hi'), false);
	assert.equal(isAllowedRedirectUri('file:///etc/passwd'), false);
	assert.equal(isAllowedRedirectUri('vbscript:msgbox'), false);
	assert.equal(isAllowedRedirectUri('blob:https://example.com/id'), false);
	assert.equal(isAllowedRedirectUri('about:blank'), false);
	assert.equal(isAllowedRedirectUri('ws://localhost/x'), false);
	assert.equal(isAllowedRedirectUri('wss://example.com/x'), false);
	assert.equal(isAllowedRedirectUri('ftp://example.com/x'), false);
	assert.equal(isAllowedRedirectUri('https://user:pw@example.com/cb'), false);
	assert.equal(isAllowedRedirectUri('https://example.com/cb#frag'), false);
	assert.equal(isAllowedRedirectUri('not a url'), false);
	assert.equal(isAllowedRedirectUri(''), false);
	assert.equal(isAllowedRedirectUri('https://example.com/' + 'a'.repeat(2000)), false);
});

test('verifyPkceS256 matches the RFC 7636 appendix B vector', () => {
	const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
	const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
	assert.equal(verifyPkceS256(verifier, challenge), true);
	assert.equal(verifyPkceS256(verifier, challenge.replace(/.$/, 'A')), false);
	assert.equal(verifyPkceS256(verifier + 'x', challenge), false);
});

test('verifyPkceS256 rejects verifiers outside the RFC 7636 grammar', () => {
	const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
	assert.equal(verifyPkceS256('a'.repeat(42), challenge), false);
	assert.equal(verifyPkceS256('a'.repeat(129), challenge), false);
	assert.equal(verifyPkceS256('dBjftJeZ4CVP+mB92K27uhbUJU1p1r_wW1gFWFOEjXk', challenge), false);
});

test('newToken has the prefix and 32 random bytes in base64url', () => {
	const token = newToken(TOKEN_PREFIX.personal);
	assert.match(token, /^tsm_pat_[A-Za-z0-9_-]{43}$/);
	assert.notEqual(newToken(TOKEN_PREFIX.personal), token);
});

test('hashToken is a deterministic SHA-256 hex digest', () => {
	assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	assert.match(hashToken(newToken(TOKEN_PREFIX.access)), /^[0-9a-f]{64}$/);
});

test('safeEqual compares strings in constant time and handles length mismatches', () => {
	assert.equal(safeEqual('same', 'same'), true);
	assert.equal(safeEqual('same', 'sane'), false);
	assert.equal(safeEqual('short', 'longer'), false);
});

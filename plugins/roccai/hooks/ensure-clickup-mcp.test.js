const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'ensure-clickup-mcp.js');
let tmpSettings;

function runHook(args) {
  return execFileSync('node', [HOOK, '--settings-path', tmpSettings, ...args], { encoding: 'utf8' });
}

function readSettings() {
  return JSON.parse(fs.readFileSync(tmpSettings, 'utf8'));
}

beforeEach(() => {
  tmpSettings = path.join(os.tmpdir(), `settings-${Date.now()}-${Math.random()}.json`);
});

afterEach(() => {
  try { fs.unlinkSync(tmpSettings); } catch (e) { if (e.code !== 'ENOENT') throw e; }
});

test('creates settings.json with roccai.clickupUserId when file does not exist', () => {
  runHook(['--user-id', 'usr_42']);
  const s = readSettings();
  assert.strictEqual(s.roccai.clickupUserId, 'usr_42');
});

test('merges roccai.clickupUserId into existing settings preserving other fields', () => {
  fs.writeFileSync(tmpSettings, JSON.stringify({
    permissions: { allow: ['Bash(git:*)'] },
    model: 'opus[1m]',
  }, null, 2));
  runHook(['--user-id', 'usr_new']);
  const s = readSettings();
  assert.deepStrictEqual(s.permissions, { allow: ['Bash(git:*)'] });
  assert.strictEqual(s.model, 'opus[1m]');
  assert.strictEqual(s.roccai.clickupUserId, 'usr_new');
});

test('overwrites existing roccai.clickupUserId', () => {
  fs.writeFileSync(tmpSettings, JSON.stringify({
    roccai: { clickupUserId: 'usr_old' },
  }, null, 2));
  runHook(['--user-id', 'usr_new']);
  const s = readSettings();
  assert.strictEqual(s.roccai.clickupUserId, 'usr_new');
});

test('is idempotent — running twice with same values produces identical file', () => {
  runHook(['--user-id', 'usr_a']);
  const first = fs.readFileSync(tmpSettings, 'utf8');
  runHook(['--user-id', 'usr_a']);
  const second = fs.readFileSync(tmpSettings, 'utf8');
  assert.strictEqual(first, second);
});

test('exits with non-zero code when settings.json is invalid JSON', () => {
  fs.writeFileSync(tmpSettings, '{ this is not json');
  assert.throws(() => runHook(['--user-id', 'usr_a']));
});

test('exits with non-zero code when --user-id is missing', () => {
  assert.throws(() => runHook([]));
});

test('exits with non-zero code when --user-id is given a flag-shaped value', () => {
  assert.throws(() => runHook(['--user-id', '--settings-path']));
});

test('exits with non-zero code when an unknown flag is passed', () => {
  assert.throws(() => runHook(['--foo', 'bar', '--user-id', 'usr_x']));
});

test('preserves other roccai.* fields when updating clickupUserId', () => {
  fs.writeFileSync(tmpSettings, JSON.stringify({
    roccai: { clickupUserId: 'usr_old', somethingElse: 'preserve-me' },
  }, null, 2));
  runHook(['--user-id', 'usr_new']);
  const s = readSettings();
  assert.strictEqual(s.roccai.clickupUserId, 'usr_new');
  assert.strictEqual(s.roccai.somethingElse, 'preserve-me');
});

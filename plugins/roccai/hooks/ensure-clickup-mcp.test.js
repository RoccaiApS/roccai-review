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

test('creates settings.json with MCP entry when file does not exist', () => {
  runHook(['--token', 'pk_test123', '--team', '999']);
  const s = readSettings();
  assert.deepStrictEqual(s.mcpServers.clickup, {
    command: 'npx',
    args: ['-y', '@taazkareem/clickup-mcp-server'],
    env: { CLICKUP_API_KEY: 'pk_test123', CLICKUP_TEAM_ID: '999' },
  });
});

test('merges MCP entry into existing settings.json preserving other fields', () => {
  fs.writeFileSync(tmpSettings, JSON.stringify({
    permissions: { allow: ['Bash(git:*)'] },
    model: 'opus[1m]',
    mcpServers: { existing: { command: 'foo' } },
  }, null, 2));
  runHook(['--token', 'pk_new', '--team', '42']);
  const s = readSettings();
  assert.deepStrictEqual(s.permissions, { allow: ['Bash(git:*)'] });
  assert.strictEqual(s.model, 'opus[1m]');
  assert.strictEqual(s.mcpServers.existing.command, 'foo');
  assert.strictEqual(s.mcpServers.clickup.env.CLICKUP_API_KEY, 'pk_new');
});

test('overwrites existing clickup MCP entry when token changes', () => {
  fs.writeFileSync(tmpSettings, JSON.stringify({
    mcpServers: { clickup: { command: 'npx', args: [], env: { CLICKUP_API_KEY: 'pk_old', CLICKUP_TEAM_ID: '1' } } },
  }, null, 2));
  runHook(['--token', 'pk_new', '--team', '2']);
  const s = readSettings();
  assert.strictEqual(s.mcpServers.clickup.env.CLICKUP_API_KEY, 'pk_new');
  assert.strictEqual(s.mcpServers.clickup.env.CLICKUP_TEAM_ID, '2');
});

test('writes only roccai.clickupUserId when --user-id passed without token', () => {
  fs.writeFileSync(tmpSettings, JSON.stringify({
    mcpServers: { clickup: { command: 'npx', args: [], env: { CLICKUP_API_KEY: 'pk_keep', CLICKUP_TEAM_ID: '1' } } },
  }, null, 2));
  runHook(['--user-id', 'usr_42']);
  const s = readSettings();
  assert.strictEqual(s.roccai.clickupUserId, 'usr_42');
  assert.strictEqual(s.mcpServers.clickup.env.CLICKUP_API_KEY, 'pk_keep');
});

test('writes both MCP entry and user ID in a single invocation', () => {
  runHook(['--token', 'pk_a', '--team', '7', '--user-id', 'usr_9']);
  const s = readSettings();
  assert.strictEqual(s.mcpServers.clickup.env.CLICKUP_API_KEY, 'pk_a');
  assert.strictEqual(s.roccai.clickupUserId, 'usr_9');
});

test('is idempotent - running twice with same values produces identical file', () => {
  runHook(['--token', 'pk_a', '--team', '7']);
  const first = fs.readFileSync(tmpSettings, 'utf8');
  runHook(['--token', 'pk_a', '--team', '7']);
  const second = fs.readFileSync(tmpSettings, 'utf8');
  assert.strictEqual(first, second);
});

test('exits with non-zero code when settings.json is invalid JSON', () => {
  fs.writeFileSync(tmpSettings, '{ this is not json');
  assert.throws(() => runHook(['--token', 'pk_a', '--team', '7']));
});

test('exits with non-zero code when no flags are provided', () => {
  assert.throws(() => runHook([]));
});

test('exits with non-zero code when --token is given a flag-shaped value', () => {
  assert.throws(() => runHook(['--token', '--team', '99']));
});

test('exits with non-zero code when --team is missing entirely', () => {
  assert.throws(() => runHook(['--token', 'pk_x']));
});

test('exits with non-zero code when an unknown flag is passed', () => {
  assert.throws(() => runHook(['--foo', 'bar', '--token', 'pk_x', '--team', '1']));
});

test('exits with non-zero code when --token is used without --team', () => {
  assert.throws(() => runHook(['--token', 'pk_a']));
});

test('preserves existing roccai.clickupUserId when only credentials are updated', () => {
  fs.writeFileSync(tmpSettings, JSON.stringify({
    roccai: { clickupUserId: 'usr_existing' },
  }, null, 2));
  runHook(['--token', 'pk_new', '--team', '99']);
  const s = readSettings();
  assert.strictEqual(s.roccai.clickupUserId, 'usr_existing');
  assert.strictEqual(s.mcpServers.clickup.env.CLICKUP_API_KEY, 'pk_new');
});

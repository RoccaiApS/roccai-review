#!/usr/bin/env node
// roccai plugin: idempotent settings.json writer for the user's resolved ClickUp user ID.
// Recognizes --user-id and --settings-path. --user-id is required.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RECOGNIZED_FLAGS = new Set(['--user-id', '--settings-path']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      process.stderr.write(`roccai/ensure-clickup-mcp: unexpected positional argument "${key}"\n`);
      process.exit(1);
    }
    if (!RECOGNIZED_FLAGS.has(key)) {
      process.stderr.write(`roccai/ensure-clickup-mcp: unknown flag ${key}\n`);
      process.exit(1);
    }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) {
      process.stderr.write(`roccai/ensure-clickup-mcp: missing value for flag ${key}\n`);
      process.exit(1);
    }
    out[key.slice(2)] = val;
    i++;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const settingsPath = args['settings-path'] || path.join(os.homedir(), '.claude', 'settings.json');

  if (!args['user-id']) {
    process.stderr.write('roccai/ensure-clickup-mcp: --user-id is required\n');
    process.exit(1);
  }

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      process.stderr.write(`roccai/ensure-clickup-mcp: cannot parse ${settingsPath} (${e.message})\n`);
      process.exit(1);
    }
  }

  if (!settings.roccai) settings.roccai = {};
  settings.roccai.clickupUserId = args['user-id'];

  try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`roccai/ensure-clickup-mcp: failed to write ${settingsPath} (${e.message})\n`);
    process.exit(1);
  }
}

main();

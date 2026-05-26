#!/usr/bin/env node
// Centralizes ClickUp MCP credential and user ID merging for settings.json.
// Recognizes --token, --team, --user-id, and --settings-path flags.
// At least one of --token or --user-id required; --team required if --token used.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArgs(argv) {
  const out = {};
  const recognized = new Set(['--token', '--team', '--user-id', '--settings-path']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    if (!recognized.has(key)) {
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

  const hasToken = !!args.token;
  const hasUserId = !!args['user-id'];
  if (!hasToken && !hasUserId) {
    process.stderr.write('roccai/ensure-clickup-mcp: at least one of --token or --user-id required\n');
    process.exit(1);
  }
  if (hasToken && !args.team) {
    process.stderr.write('roccai/ensure-clickup-mcp: --team is required when --token is used\n');
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

  if (hasToken) {
    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers.clickup = {
      command: 'npx',
      args: ['-y', '@taazkareem/clickup-mcp-server'],
      env: {
        CLICKUP_API_KEY: args.token,
        CLICKUP_TEAM_ID: args.team,
      },
    };
  }

  if (hasUserId) {
    if (!settings.roccai) settings.roccai = {};
    settings.roccai.clickupUserId = args['user-id'];
  }

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

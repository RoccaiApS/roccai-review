#!/usr/bin/env node
// roccai plugin SessionStart hook.
//
// Detects the user's Roccai workspace folder (the directory containing a
// *.code-workspace file, found by walking up from the session's cwd) and
// idempotently ensures ~/.claude/settings.json has the Read and Glob
// permissions /roccai:review needs so it can scan repos without
// triggering per-file permission prompts.
//
// Runs on every session start but only writes when something is missing.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function findWorkspaceFolder() {
  let dir = process.cwd();
  while (dir && dir !== path.dirname(dir)) {
    try {
      const entries = fs.readdirSync(dir);
      if (entries.some(name => name.toLowerCase().endsWith('.code-workspace'))) {
        return dir;
      }
    } catch {
      // unreadable dir — keep walking up
    }
    dir = path.dirname(dir);
  }
  return null;
}

function main() {
  const folder = findWorkspaceFolder();
  if (!folder) return;
  if (!fs.existsSync(SETTINGS_PATH)) return;

  let raw, settings;
  try {
    raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    settings = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`roccai hook: cannot parse settings.json (${e.message})\n`);
    return;
  }

  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

  const patterns = [
    `Read(${folder}${path.sep}**)`,
    `Glob(${folder}${path.sep}**)`,
  ];

  let changed = false;
  for (const p of patterns) {
    if (!settings.permissions.allow.includes(p)) {
      settings.permissions.allow.push(p);
      changed = true;
    }
  }
  if (!changed) return;

  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    process.stderr.write(`roccai: added Read/Glob permissions for ${folder} to ~/.claude/settings.json\n`);
  } catch (e) {
    process.stderr.write(`roccai hook: failed to write settings.json (${e.message})\n`);
  }
}

try {
  main();
} catch (e) {
  process.stderr.write(`roccai hook error: ${e.message}\n`);
}

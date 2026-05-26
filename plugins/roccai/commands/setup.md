---
allowed-tools: Read, Glob, Grep, Edit, Write, Bash(node:*), AskUserQuestion, TodoWrite, Agent
description: Configure ClickUp MCP credentials and resolve your ClickUp identity for the /roccai:review plugin.
---

# /roccai:setup

Dispatch the `clickup-flag-sync` subagent in **setup** mode. The agent handles all the credentials prompts, identity resolution, settings.json writes (via the `ensure-clickup-mcp.js` hook), and state-aware messaging.

Pass these inputs to the agent:
- `mode`: `setup`

The agent reads/writes `~/.claude/settings.json` via the bundled `ensure-clickup-mcp.js` hook, which defaults to that path. The agent's allowed tools include the hook invocation (`Bash(node:*)`), so credentials writes don't trigger permission prompts.

After the agent returns, print one line summarizing the outcome:
- `✓ ClickUp MCP setup complete.` — if credentials + identity are both in place and reachable.
- `↷ ClickUp credentials saved; restart required.` — if a State 1 or State 3 outcome occurred.
- `⚠ Setup failed: <reason>.` — if the agent reported an error.

End the command.

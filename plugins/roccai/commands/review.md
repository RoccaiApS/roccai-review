---
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(pytest:*), Bash(python -m pytest:*), Bash(ls:*), Bash(cat:*), Read, Glob, Grep, Edit, Write, TodoWrite, AskUserQuestion, Agent
description: PR-style code review for Roccai repos with configurable scope and level.
argument-hint: [--scope=tight|default|loose] [--level=1-4] [--repos=name1,name2]
---

# /roccai:review

Run a PR review for `$ARGUMENTS`. Rule sources (per-repo `claude.md`, `.claude/rules/`, `docs/`, `.claude/docs/`, global `~/.claude/ai-context/`) are read live from disk. Do not read `${CLAUDE_PLUGIN_ROOT}/lib/`.

Follow the phases in order.

---

## Phase 1 — Parse arguments

Parse `$ARGUMENTS` for `--scope` (tight|default|loose), `--level` (1–4), `--repos` (comma-separated repo names).

For missing args, ask via `AskUserQuestion` (1–4 questions per call).

**`--scope` missing**:
- header: `Scope`; question: `How wide should the review scope be?`
- options (`default` is the recommended default — list it first):
  - `default (Recommended)` — changed hunks + directly-referenced functions/methods/classes/types/enums (excludes merged-in branches)
  - `tight` — branch's own changed hunks only (excludes merged-in branches)
  - `loose` — default + rest of touched files + one more reference level + includes merged-in branches

**`--level` missing**:
- header: `Level`; question: `How nitpicky should the review be?`
- options (level 3 is the recommended default — list it first):
  - `3 (Recommended)` — adds naming, structural simplification, comments on top of level 2
  - `1` — major issues only (blockers + bugs + missing feature flags + obvious optimization)
  - `2` — adds standards conformance, dedup/refactor, test coverage review
  - `4` — adds lint/format/code-order on top of level 3 (runs `npm run lint`, `npx prettier --check`)

**`--repos` missing** — text-based selection (not `AskUserQuestion`):

Detect: glob `*.code-workspace` in parent of cwd, parse `folders[].path`; verify each is a git repo. Fallback: cwd + sibling git repos.

For each detected repo compute via git: current branch, last-commit (`%ar by %an`), dirty status, default branch (origin/HEAD).

Sort: non-default-branch or dirty first, then by recent commit.

Print:

```
Detected N workspace repos:
  1. roccai-dashboard ★ feature/foo • 2 days ago by Ida
  ...

★ = non-default branch or has uncommitted changes

Which repos? Reply with one of:
  • numbers, optionally with base: "1,3,5" or "1 develop, 2 master, 5"
  • "all" / "all develop,master,..."
  • "active" (★ ones) / "active develop,master,..."
  • names: "roccai-dashboard, decisiontree" or "roccai-dashboard develop, decisiontree master"

Base branch (the parent the current branch was branched off) is optional. Omitted entries trigger a follow-up prompt; topology auto-detection runs only as final fallback.
```

Stop and wait for the reply. Parse it forgivingly — accept any combination of commas and whitespace as separators, recover from missing commas where the structure is unambiguous:

**General tolerance rules**:
- Trim every token; collapse runs of whitespace.
- Treat commas, semicolons, and `|` as entry separators; treat newlines and surrounding whitespace as equivalent to a separator.
- Case-insensitive for keywords (`all`, `active`).

**`all [<bases>]`** — every detected repo. Tokens after `all` are bases applied in displayed order. Separators between bases can be commas, whitespace, or any mix. Fewer bases than repos → remaining auto; more → warn and ignore extras. Examples that all parse equivalently:
- `all`
- `all develop,master,master,master,google-dev`
- `all develop master master master google-dev`
- `all develop,master master, master google-dev`

**`active [<bases>]`** — same rules as `all` but only ★ repos.

**Numbered list** — split on commas first. If the input has no commas at all (e.g. `1 develop 2 master 5`), recover by splitting on whitespace and grouping: a purely numeric token starts a new entry; the next non-numeric token (if any) is its base. Examples that all parse to entries [1, develop], [2, master], [5]:
- `1 develop, 2 master, 5`
- `1 develop,2 master,5`
- `1 develop , 2 master , 5`
- `1 develop 2 master 5` (recovered via number-prefix heuristic)
- `1,2 master,5 develop` (any per-entry order works — base is `null` if not specified)

Per entry (after the comma/whitespace split): 1 token = index only; 2 tokens = `<index> <base>`; 3+ tokens or a malformed index = warn and re-ask the affected entry.

**Named list** — split on commas first. If no commas and any token matches a known detected repo name, recover by walking tokens left-to-right: a token matching a known repo name starts a new entry; the immediately-following token (if any, and not also a known name) becomes that entry's base. Examples that all parse to the same two entries:
- `roccai-dashboard, decisiontree`
- `roccai-dashboard develop, decisiontree master`
- `roccai-dashboard,decisiontree`
- `roccai-dashboard develop decisiontree master` (recovered via known-name detection)

Per entry: 1 token = name only; 2 tokens = `<name> <base>`.

Store per repo: `repo`, `providedBase` (or null). Validate provided bases with `git -C <repo> rev-parse --verify origin/<providedBase>`; warn and re-ask only the failed entries (do not require the user to retype the whole list).

### Phase 1b — Ask for missing bases

For each repo with `providedBase = null`, ask via `AskUserQuestion` (4 repos max per call, batch as needed). Skip if all have a `providedBase`.

Per repo:
- header: `Parent`
- question: `` Which branch is `<repo>`'s current branch (`<current>`) branched off? ``
- options (4 max, in this order):
  1. Default branch (from `git symbolic-ref --short refs/remotes/origin/HEAD`). Label = short name. Description = `(default branch — last commit <relative-time> by <author>)`.
  2. & 3. Two most-recently-committed branches (from `for-each-ref --sort=-committerdate`), filtered to exclude default and `origin/<current>`. Description = `last commit <relative-time> by <author>`.
  4. `Auto-detect (slower)` — leaves `providedBase = null` for topology fallback.

If repo has no `origin/HEAD` set, or the default is the current branch: skip option 1 and use the top 3 recent branches as options 1–3.

On answer: set `providedBase` and validate with `rev-parse --verify origin/<chosen>`; re-ask the failed ones. `Auto-detect` keeps it null.

---

## Phase 2 — Pre-review setup (per repo)

### 1. Find the base branch

**Fast path**: if `providedBase` is set, `<base>` = `origin/<providedBase>`, `<base-short>` = `<providedBase>`. Skip to fetch.

**Auto-detect** (only when `providedBase` is null):

- `<current>` = `git -C <repo> branch --show-current`.
- Walk `git -C <repo> log HEAD --first-parent --format=%H`, skip the first SHA. For each subsequent SHA `C`:
  - `git -C <repo> branch -r --contains <C> --format='%(refname:short)' --no-color`
  - Filter out `origin/HEAD` and `origin/<current>`.
  - First C with a non-empty filtered list → `C` is the branch point; the list is candidates. Stop.
  - Cap: 50 commits walked.
- For each candidate `c`:
  - `authors_c = git -C <repo> shortlog -se <C>..<c> | wc -l`
  - `commits_c = git -C <repo> rev-list --count <C>..<c>`
  - `sha_c = git -C <repo> rev-parse <c>`
- Sort by `(authors desc, commits desc)`; pick first.
- **Equal-SHA tie**: if multiple top candidates share the same `(authors, commits, sha)`, pick alphabetically first and print `ℹ <repo> — multiple parent candidates point to the same commit: <names>. Picking <chosen> alphabetically. The diff is identical regardless.`
- **No candidate after 50 commits**: fall back to `git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD`, then `origin/master`. Print `⚠ <repo> — could not detect parent branch, using <fallback>`.

**Fetch**: `git -C <repo> fetch origin <base-short>` (single-branch, not bare `git fetch`).

### 2. Behind check + optional rebase

- `behindCount = git -C <repo> rev-list --count HEAD..<base>`. If 0, skip.
- Dirty check: `git -C <repo> status --porcelain`.
- Ask via `AskUserQuestion`:
  - header: `Behind <base-short>`
  - question: `` `<repo>` is `behindCount` commit(s) behind `<base>`. Rebase onto the latest before reviewing? ``
  - options:
    - `Rebase onto <base> (Recommended)` — only when clean. Run `git -C <repo> rebase <base>`. On conflict, print conflict files + `resolve conflicts then re-run /roccai:review` and **stop the command**.
    - `Skip rebase, review against latest <base>`.
    - `Cancel review`.
- If dirty: omit the rebase option; add to question text `Working tree dirty — rebase unavailable; stash or commit first.`

### 3. Compute the diff source

**For `tight` / `default` — branch-own diff** (excludes content merged in from other branches):

- SHAs: `git -C <repo> log <base>..HEAD --first-parent --no-merges --format=%H --reverse`. Empty list → treat diff as empty.
- File list: `git -C <repo> log <base>..HEAD --first-parent --no-merges --name-only --format=` (dedupe in reasoning).
- Full patch: `git -C <repo> log <base>..HEAD --first-parent --no-merges -p --reverse --pretty=format:"=== %H %s ==="`. Union of patches = "the diff".

**For `loose` — full diff (includes merged-in branches)**:

- File list: `git -C <repo> diff <base>...HEAD --name-only`
- Full diff: `git -C <repo> diff <base>...HEAD`

The "diff" referenced in all downstream steps means whichever was computed above.

### 4. Skip empty diffs

- `tight` / `default`: empty SHA list or zero-change patch → print `↷ <repo> — no own commits vs <base>`.
- `loose`: `git diff` empty → print `↷ <repo> — no changes vs <base>`.

### 5. Scope filtering

- `tight`: changed hunks only.
- `default`: tight + directly-referenced functions/methods/classes/types/enums (resolve via `Grep` in same repo).
- `loose`: full diff + rest of touched files + one more reference level.

No cross-repo expansion — only `dedup-search` crosses repos.

### 6. Load rule sources

Per-repo sources override global ai-context on conflict. Cite the winning source in findings.

**6a. Global ai-context** — skip silently if `~/.claude/ai-context/` doesn't exist. Otherwise read, skipping individual missing files:
- `~/.claude/ai-context/CLAUDE.md` — Roccai rules + routing index.
- `~/.claude/ai-context/glossary.md` — terminology; check before flagging anything as misnamed.
- `~/.claude/ai-context/repos/<repo>.md` — per-repo notes.
- Conditional entries from `CLAUDE.md`'s "Load When Relevant": read each if its trigger matches the scope-filtered diff.

Trigger forms:
- Bare file (e.g. `@architecture/Card-Types-How-They-Work.md`) → trigger is the topic implied by filename.
- Explicit (`<condition> → <files>`) → trigger is the condition.

Evidence of match: file-path patterns tied to the topic, content references to relevant types/services/vocabulary, or repo identity. Skip marketing/brand triggers unless the diff changes user-visible copy. Skip design-system triggers unless the diff includes UI templates/styles. If unsure, load.

**6b. Per-repo sources** (authoritative on conflict):
- `<repo>/claude.md` — read it, then every file it references.
- `<repo>/.claude/rules/*.md` — glob all.
- `<repo>/docs/**/*.md` — glob recursively.
- `<repo>/.claude/docs/**/*.md` — glob recursively.
- `<repo>/README.md` — only if `claude.md` is missing.

**6c. Fallback when no repo rules**: if both `<repo>/claude.md` and `<repo>/.claude/rules/` absent, use `~/.claude/projects/e--Roccai-typescript-scripts/memory/feedback_*.md` + universal checks. Print `⚠ <repo> has no claude.md or .claude/rules/ — using project-memory fallback`.

**6d. Citation format**: `rule` cites source path + anchor, e.g. `.claude/rules/conventions.md#naming`, `docs/cardStructure.md#card-types`, `~/.claude/ai-context/glossary.md#card`, or `"general"`.

Print summary:

```
Reviewing <N> repo(s) at level <L>, scope <S>:
  • <repo>: <files-changed> files vs <base>
```

---

## Phase 3 — Dispatch reviewers

### Finding shape (every subagent and main-thread emits this)

```json
{
  "severity": "blocker | major | minor | nit",
  "repo": "...",
  "file": "...",
  "line": 142,
  "lineEnd": 158,
  "rule": ".claude/rules/conventions.md#naming",
  "description": "One sentence.",
  "suggestedFix": "Optional.",
  "confidence": 85
}
```

Severities:
- `blocker` — prod-breaking, security hole, privacy invariant violation.
- `major` — clear bug, missing feature flag, broken contract.
- `minor` — convention violation, refactor candidate, missing test.
- `nit` — naming, formatting, comment style.

### Level 1 → main thread only

No subagents. Read diff + rule sources. Focus: prod-breaking bugs, security, broken contracts, privacy violations, missing feature flags, obvious optimization, broken error paths.

### Level 2+ → spawn subagents in parallel

Single message with multiple `Agent` calls. Each prompt: scope-filtered diff + loaded rule sources + the inline finding shape.

| Subagent             | Spawn when                                                                  |
| -------------------- | --------------------------------------------------------------------------- |
| `focus-conventions`  | level ≥ 2                                                                    |
| `focus-refactor`     | level ≥ 2                                                                    |
| `focus-tests`        | level ≥ 2 AND repo has test framework                                        |
| `dedup-search`       | level ≥ 2 AND scope ≥ default                                                |
| `focus-naming`       | level ≥ 3                                                                    |
| (lint/format)        | level ≥ 4 — main thread, `npm run lint` / `npx prettier --check`             |
| (test execution)     | level ≥ 2 AND repo has test framework — main thread (below)                  |

### Build prerequisites (level ≥ 2 with tests)

Before running tests, build prerequisites the tests depend on (shared libraries, etc.). Detect by reading repo `claude.md`, `package.json` `scripts` (look for `build:*` scripts producing test-consumed output), or `README.md`.

Known cases:

| Repo               | Build command                                       |
| ------------------ | --------------------------------------------------- |
| roccai-dashboard   | `npm --prefix <repo> run build:shared-library`      |
| others             | none unless detected                                |

Run sequentially per repo. Build failure → emit `blocker` finding (rule `general`, description `Build prerequisite '<cmd>' failed: <first error line>`, confidence 100), skip that repo's tests, move on. Build success → run tests.

### Run the test suite

Separate from `focus-tests` (static review). Main-thread, sequential per repo:

| Repo                          | Command                                           |
| ----------------------------- | ------------------------------------------------- |
| roccai-dashboard              | `npm --prefix <repo> run test:ci`                  |
| journeyprocessormerrymake     | `npm --prefix <repo> run unitTest`                 |
| pytest config detected        | `cd <repo> && pytest -q`                           |
| Other Node `test` script      | `npm --prefix <repo> test -- --watch=false`        |
| No framework                  | skip silently                                      |

Exit 0 → no findings. Exit ≠ 0 → emit one `blocker` per failing test (or aggregate if unparseable): file from trace, line from trace (else 1), rule `general`, description = test name + assertion first line, confidence 100.

### `test-drafter` is opt-in

Not auto-spawned. Triggered in Phase 5 if the user types `draft tests`.

---

## Phase 4 — Aggregate findings

1. Collect findings (subagents + main thread).
2. Filter by level:

   | Level | Severities                                                |
   | ----- | --------------------------------------------------------- |
   | 1     | blocker, major                                            |
   | 2     | blocker, major, minor                                     |
   | 3     | blocker, major, minor, nit                                |
   | 4     | level 3 + lint/format (`npm run lint`, `npx prettier --check`) |

3. Filter by confidence: drop < 80 at level 1, < 70 at level 2, < 60 at level 3, all shown at level 4.
4. Dedupe on `(repo, file, line, rule)` — keep highest confidence.
5. Sort: severity, then repo, file, line.

Create one `TodoWrite` per finding: `content` = `[<severity>] <repo>/<file>:<line> — <description>`, `activeForm` = `Reviewing <repo>/<file>:<line>`, `status` = `pending`.

---

## Phase 5 — Present findings and run the review loop

Show findings grouped by severity:

```
## Blocker (N)
1. <repo>/<file>:<line> — <description>
   Rule: <rule>
   Suggested fix: <if any>

## Major (N)
…
```

Prompt: `For each finding: fix N, dismiss N, defer N, ask N, or end review.`

Loop:
1. Read user input.
2. Execute and update the TodoWrite entry:
   - `fix` → `completed` after change applied.
   - `dismiss` → remove from list.
   - `defer` → stays `pending`, tag description with `(deferred)`.
   - `ask` → discuss; stays `pending`.
3. After each fix, reprint open findings.
4. `draft tests` → spawn `test-drafter`; results appear as `minor` findings with full test files in `suggestedFix`.
5. Continue until all completed/dismissed, or `end review`.

---

## Phase 5b — Re-verify tests after fixes

Only if at least one `fix` ran AND level ≥ 2 AND the touched repo has a test framework. Track which repos got `fix` actions.

For each touched repo:
1. Rebuild prerequisites (same command as Phase 3). On failure → `blocker` finding, re-enter Phase 5; skip that repo's re-test.
2. Re-run the test command (same as Phase 3).

Sequential per repo.

- All pass → print `✓ <repo>: tests still pass`. Proceed to Phase 6.
- Any fail → emit `blocker` findings, re-enter Phase 5. Loop 5 ↔ 5b until clean or `end review` (failures land in Known issues).

---

## Phase 6 — Final summary (with user verification)

Spawn `summary-drafter`. Pass: per-repo diff, resolved findings, deferred findings.

Returns: 2-sentence problem statement, touched components (area + nested items), deferred warnings.

Ask via `AskUserQuestion`:
- header: `Summary`
- question: `Does this problem statement match what the branch actually solves?`
- options: `accept`, `edit` (revise), `rewrite` (re-run summary-drafter with notes).

After verification, print a fenced markdown code block (CommonMark only — no HTML, tables, task lists, footnotes, strikethrough):

````markdown
## Summary

<verified statement — max 2 sentences AND 350 characters, plain English, no implementation jargon>

## Touched components

Verify these areas in the running app:

- **<area or repo>**
  - <specific component, setting, or file>
  - <specific component, setting, or file>
- **<area or repo>**
  - <specific component, setting, or file>

## Known issues

- **<severity>**: <description> — `<repo>/<file>:<line>`
````

Rules:
- Summary copied verbatim from the accepted statement.
- Touched components: top-level = area or repo (e.g. `i18n`, `roccai-dashboard — shared library`); nested = specific items in human-readable names (not raw paths). Two-space indent. If an area has one item, still nest it for format consistency.
- Known issues: include only deferred findings that survived `summary-drafter`'s local/IDE filter. If empty, omit the entire heading and section — no placeholder.
- Wrap the whole thing in ` ```markdown ` / ` ``` `. No prose before or after the block.

### Phase 6b — Commit drafts

After the summary block, draft one commit per repo that had `fix` actions during Phase 5.

For each touched repo:
1. Match repo's commit style (`git -C <repo> log --oneline -5` → Conventional Commits like `feat(scope):` or plain English).
2. Subject ≤72 chars, present tense, describing only the loop's accepted fixes in this repo (not the whole branch).
3. Optional 1–3 line body for nuance (behind a flag, breaking change, etc.). Skip if subject suffices.

Print one block per repo:

**<repo>**

```
<subject>

<optional body>
```

If no repo had fixes: print `_No fixes applied during the review — no commit drafts needed._`.

**Do NOT run `git commit`, `git add`, or any other git write command.** Drafts are text-only.

End the command.

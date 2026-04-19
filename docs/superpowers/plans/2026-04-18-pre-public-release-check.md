# Pre-Public-Release Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the Herald repo for its first public release and npm publish under the `@heraldjs/core` scope. Three independent phases, three PRs: (1) repo cleanliness + scope rename + publish dry-run, (2) roadmap-vs-code sync, (3) code-review findings fixed with TDD.

**Architecture:** Each phase is a standalone branch merged back to `main` before the next starts. Phase 1 and 2 are concrete and enumerable. Phase 3 is discovery-driven: a structured review produces a list of findings, and each finding is fixed in its own commit via a red-green-commit TDD loop against a checklist of review areas.

**Tech Stack:** pnpm 10.x monorepo, TypeScript (strict), Biome (lint/format), Vitest + Cucumber (tests), tsup (build), MIT license.

**Constraints:**
- Don't bloat the repo — this isn't a mature project and shouldn't pretend to be one
- Trust Biome for formatting; do not hand-format
- Follow existing commit conventions (`type: description`)
- Each phase owns its PR; phases do not depend on each other's branches (but phase 3 benefits from phase 1 being merged first)

**Known inputs (from clarifying discussion):**
- npm scope: `@heraldjs` (org just claimed by user; `@herald` scope was taken, `herald` npm org unavailable)
- GitHub: `jeromesth/herald` (already in package.json)
- License holder: **Jerome St-Hilaire** (replace "Jerome S." in LICENSE)
- Review depth: correctness + security + obvious bugs + public-API ergonomics (skip style/nits — Biome owns those)
- Publish verification: include `pnpm publish --dry-run` in phase 1

---

## Phase 1 — Repo cleanliness + scope rename

**Branch:** `chore/pre-release-cleanup`
**Outcome:** Repo is coherent under `@heraldjs/core`, LICENSE carries your full name, repo URL is npm-canonical, `pnpm publish --dry-run` succeeds with a sane tarball. One PR at end.

**Files touched (inventory):**
- Modify: `packages/core/package.json` (name, repository.url, homepage, bugs)
- Modify: `package.json` (monorepo name)
- Modify: `LICENSE` (copyright holder)
- Modify: `README.md` (install snippets, import paths)
- Modify: `ROADMAP.md` (package references)
- Modify: `ARCHITECTURE.md` (package references)
- Modify: `agents.md` (package references — mirrored by CLAUDE.md)
- Modify: `packages/core/src/core/herald.ts` (any embedded package-name strings)
- Modify: `packages/core/src/adapters/workflow/postgres.ts`
- Modify: `packages/core/src/adapters/workflow/upstash.ts`
- Modify: `packages/core/src/adapters/workflow/inngest.ts`
- Modify: `packages/core/src/adapters/database/prisma.ts`
- Modify: `packages/core/src/adapters/database/drizzle/adapter.ts`
- Modify: `packages/core/src/adapters/database/drizzle/schema.ts`

### Task 1.1: Cut a fresh branch from main

- [ ] **Step 1: Verify clean working tree**

```bash
cd /Users/jerome/workspace/herald
git status
```
Expected: `nothing to commit, working tree clean` on `main`.

- [ ] **Step 2: Pull latest and branch**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b chore/pre-release-cleanup
```
Expected: on new branch `chore/pre-release-cleanup`.

### Task 1.2: Verify `@heraldjs/core` is actually claimable

- [ ] **Step 1: Query npm registry for the exact package name**

```bash
npm view @heraldjs/core 2>&1 || true
npm view @heraldjs 2>&1 || true
```
Expected: `404 Not Found` / `code E404` on both (package unpublished, scope claimed by you — you own `@heraldjs` per the user).

- [ ] **Step 2: Confirm you own the scope**

```bash
npm whoami
npm org ls heraldjs 2>&1 || true
```
Expected: `npm whoami` prints your username; `npm org ls heraldjs` lists you as a member (or is empty — which is fine, it just means the org has no packages yet).

- [ ] **Step 3: If either check fails, STOP.** Do not proceed with the rename. Bring findings back to user and pick a different scope.

### Task 1.3: Rename scope in `packages/core/package.json`

- [ ] **Step 1: Read current file**

```bash
cat packages/core/package.json | head -50
```

- [ ] **Step 2: Update `name` field**

Change:
```json
"name": "@herald/core",
```
To:
```json
"name": "@heraldjs/core",
```

- [ ] **Step 3: Update `repository.url` to npm-canonical format**

Change:
```json
"repository": {
  "type": "git",
  "url": "https://github.com/jeromesth/herald"
}
```
To:
```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/jeromesth/herald.git",
  "directory": "packages/core"
}
```

- [ ] **Step 4: Add `homepage` and `bugs`**

After `"repository"`, add:
```json
"homepage": "https://github.com/jeromesth/herald#readme",
"bugs": {
  "url": "https://github.com/jeromesth/herald/issues"
},
```

- [ ] **Step 5: Add `author` (if missing)**

Add after `bugs`:
```json
"author": "Jerome St-Hilaire",
```

- [ ] **Step 6: Add `sideEffects: false` for tree-shaking** (if not present)

Add after `author`:
```json
"sideEffects": false,
```
Rationale: Herald is a pure library — no side-effectful imports. Declaring this lets bundlers tree-shake unused exports aggressively.

- [ ] **Step 7: Verify package.json is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/core/package.json','utf8'))" && echo OK
```
Expected: `OK`.

### Task 1.4: Rename scope in root `package.json`

- [ ] **Step 1: Update monorepo name**

Change:
```json
"name": "@herald/monorepo",
```
To:
```json
"name": "@heraldjs/monorepo",
```

- [ ] **Step 2: Verify JSON validity**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && echo OK
```

### Task 1.5: Update LICENSE copyright holder

- [ ] **Step 1: Replace copyright line**

In `LICENSE`, change:
```
Copyright (c) 2026 Jerome S.
```
To:
```
Copyright (c) 2026 Jerome St-Hilaire
```

### Task 1.6: Global find-replace `@herald/` → `@heraldjs/` in docs and source

- [ ] **Step 1: Preview every match before changing anything**

```bash
grep -rn "@herald/" --include="*.ts" --include="*.md" --include="*.json" --include="*.mjs" packages/core/src README.md ROADMAP.md ARCHITECTURE.md agents.md
```
Expected: list of occurrences. Eyeball them — any reference that is NOT the package scope (e.g. an email address or unrelated URL) must be excluded from the rename.

- [ ] **Step 2: Apply replacements with Edit tool (not sed)** to each file from the Task 1 inventory, replacing `@herald/` with `@heraldjs/` globally within each file.

The files to hit (confirmed by pre-plan grep): `packages/core/src/core/herald.ts`, `packages/core/src/adapters/workflow/postgres.ts`, `packages/core/src/adapters/workflow/upstash.ts`, `packages/core/src/adapters/workflow/inngest.ts`, `packages/core/src/adapters/database/prisma.ts`, `packages/core/src/adapters/database/drizzle/adapter.ts`, `packages/core/src/adapters/database/drizzle/schema.ts`, `README.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `agents.md`.

- [ ] **Step 3: Verify no stragglers**

```bash
grep -rn "@herald/" --include="*.ts" --include="*.md" --include="*.json" --include="*.mjs" .
```
Expected: no output (zero matches). If matches remain, Edit them and re-run.

- [ ] **Step 4: Verify the new scope is consistently applied**

```bash
grep -c "@heraldjs/" README.md ROADMAP.md packages/core/package.json
```
Expected: non-zero count in each file.

### Task 1.7: Make sure the build and tests still pass after the rename

- [ ] **Step 1: Clean rebuild**

```bash
pnpm clean
pnpm install
pnpm typecheck
```
Expected: no TS errors.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```
Expected: no violations. If Biome flags anything, run `pnpm lint:fix` and re-run.

- [ ] **Step 3: Build**

```bash
pnpm build
```
Expected: `dist/` populated in `packages/core/`.

- [ ] **Step 4: Run tests**

```bash
pnpm test:run
```
Expected: all tests pass.

- [ ] **Step 5: Run BDD tests**

```bash
pnpm test:bdd
```
Expected: all scenarios pass (or confirm they were already passing on `main` before your branch, so you know you didn't introduce a regression).

### Task 1.8: Sanity-check README code samples

- [ ] **Step 1: Skim the Quickstart section**

```bash
sed -n '1,120p' README.md
```
Expected: every `pnpm add` and `import` statement references `@heraldjs/core`, not `@herald/core`.

- [ ] **Step 2: Check for any remaining legacy scope strings in code fences anywhere**

```bash
grep -rn "herald/core" --include="*.md" .
```
Expected: every hit begins with `@heraldjs/` — none should still say `@herald/` (bare).

### Task 1.9: Add a CHANGELOG entry for the rename

- [ ] **Step 1: Read existing CHANGELOG**

```bash
head -30 CHANGELOG.md
```

- [ ] **Step 2: Insert a new unreleased section at the top** (after the header, before the latest version) documenting the rename. Follow the existing Keep-a-Changelog format.

Add a block like:

```markdown
## [Unreleased]

### Changed
- **BREAKING (pre-1.0)**: npm scope renamed from `@herald/core` to `@heraldjs/core`. Update imports and install commands accordingly. The `@herald` scope was unavailable on npm.
- LICENSE copyright holder updated to full legal name.
- `package.json`: added `homepage`, `bugs`, `author`, `sideEffects: false` for better tree-shaking and discoverability on npm.
```

Leave the version bump for a later release commit — this PR ships unreleased changes only.

### Task 1.10: Publish dry-run — inspect the tarball

- [ ] **Step 1: Make sure dist/ is fresh**

```bash
pnpm -C packages/core clean
pnpm -C packages/core build
```

- [ ] **Step 2: Dry-run publish**

```bash
cd packages/core
npm publish --dry-run --access public
cd -
```
Expected output includes:
- `name: @heraldjs/core`
- `version: 0.4.0` (or current)
- `package size` and `unpacked size` both under a few MB
- A `Tarball Contents` list that includes `dist/*.mjs`, `dist/*.d.mts`, `README.md`, `LICENSE`, `package.json`
- **Should NOT** include: `src/`, `tests/`, `tsconfig.json`, `*.map` beyond what's needed, or random dotfiles

- [ ] **Step 3: If tarball contents look wrong,** inspect the `files` field in `packages/core/package.json` (currently `["dist", "README.md", "LICENSE"]`) and `.npmignore` (currently absent). Fix before proceeding.

- [ ] **Step 4: Pack to disk for final eyeball**

```bash
cd packages/core
npm pack --dry-run 2>&1 | tail -60
cd -
```

### Task 1.11: Run full quality gate one more time

- [ ] **Step 1: All-green gate**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test:run
```
Expected: zero errors, zero failing tests.

### Task 1.12: Commit and open PR

- [ ] **Step 1: Review the diff**

```bash
git status
git diff --stat
```

- [ ] **Step 2: Stage explicit paths** (never `git add .`)

```bash
git add packages/core/package.json package.json LICENSE README.md ROADMAP.md ARCHITECTURE.md agents.md CHANGELOG.md packages/core/src docs/superpowers/plans
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: rename npm scope to @heraldjs/core and prepare for first publish

Rename scope across package.json, docs, and source imports after confirming
the @herald scope is unavailable on npm. Update LICENSE to full legal name,
fix repository URL to npm-canonical format, add homepage/bugs/author fields,
declare sideEffects: false for tree-shaking, and verify publish dry-run
produces a clean tarball.
EOF
)"
```

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin chore/pre-release-cleanup
gh pr create --title "chore: rename npm scope to @heraldjs/core and prep for first publish" --body "$(cat <<'EOF'
## Summary
- Rename npm scope: `@herald/core` → `@heraldjs/core` across package.json, docs, source imports
- LICENSE: update copyright holder to full legal name
- `packages/core/package.json`: canonical repo URL, add `homepage`, `bugs`, `author`, `sideEffects: false`
- CHANGELOG: add unreleased entry documenting the rename
- Verify `npm publish --dry-run --access public` produces a clean tarball

## Test plan
- [ ] `pnpm lint && pnpm typecheck && pnpm test:run && pnpm test:bdd` all green
- [ ] `npm publish --dry-run --access public` from `packages/core/` — tarball contains `dist/`, `README.md`, `LICENSE` only
- [ ] Manual review: no `@herald/` (legacy scope) strings remain anywhere (`grep -rn '@herald/' .`)
EOF
)"
```

**MERGE this PR to `main` before starting Phase 2.**

---

## Phase 2 — Roadmap ↔ code reality sync

**Branch:** `docs/roadmap-sync`
**Outcome:** Every checkbox in ROADMAP.md is backed by code that actually exists; unchecked items are captured as follow-up work; phases that are "done" but have obvious gaps get a new phase documenting the gap. One PR at end.

**Files touched:**
- Modify: `ROADMAP.md`

**Key rule for this phase:** do not invent new work. Only record what exists vs what's claimed.

### Task 2.1: Branch from updated main

- [ ] **Step 1: Pull latest and branch**

```bash
git checkout main
git pull --ff-only origin main   # after Phase 1 PR is merged
git checkout -b docs/roadmap-sync
```

### Task 2.2: Audit v0.1 — Foundation

For each `[x]` item in v0.1, locate evidence in the codebase.

- [ ] **Step 1: Verify `herald()` factory exists**

```bash
grep -n "export function herald\|export const herald" packages/core/src/core/herald.ts packages/core/src/index.ts
```
Expected: one match for the factory.

- [ ] **Step 2: Verify DatabaseAdapter + Prisma adapter**

```bash
test -f packages/core/src/adapters/database/prisma.ts && echo OK
grep -n "export interface DatabaseAdapter\|export type DatabaseAdapter" packages/core/src/types/adapter.ts
```

- [ ] **Step 3: Verify WorkflowAdapter + Inngest adapter**

```bash
test -f packages/core/src/adapters/workflow/inngest.ts && echo OK
grep -n "export interface WorkflowAdapter\|export type WorkflowAdapter" packages/core/src/types/workflow.ts
```

- [ ] **Step 4: Verify DB schema for subscriber/notification/topic/preference/channel**

```bash
grep -rn "subscriber\|notification\|topic\|preference\|channel" packages/core/src/db/ | head -20
```

- [ ] **Step 5: Verify REST API routes**

```bash
ls packages/core/src/api/routes/
```
Expected: files for trigger, subscribers, notifications, preferences, topics.

- [ ] **Step 6: Verify plugin system**

```bash
test -f packages/core/src/core/plugins.ts && echo OK
grep -n "HeraldPlugin" packages/core/src/types/plugin.ts
```

- [ ] **Step 7: Verify in-memory adapters**

```bash
test -f packages/core/src/adapters/database/memory.ts && echo OK
test -f packages/core/src/adapters/workflow/memory.ts && echo OK
```

- [ ] **Step 8: Record findings in a scratch file**

Create `/tmp/roadmap-audit.md` locally (do not commit). For each item, note `OK` or `MISSING: <what>`.

### Task 2.3: Audit v0.2 — Channel Delivery

- [ ] **Step 1: Email providers**

```bash
ls packages/core/src/channels/email/
```
Expected: files for resend, sendgrid, postmark, ses.

- [ ] **Step 2: In-app SSE**

```bash
test -d packages/core/src/realtime && ls packages/core/src/realtime/
```

- [ ] **Step 3: ChannelProvider interface**

```bash
grep -n "export interface ChannelProvider\|ChannelProvider" packages/core/src/channels/provider.ts
```

- [ ] **Step 4: Handlebars engine**

```bash
grep -n "HandlebarsEngine\|class.*Engine" packages/core/src/templates/engine.ts
```

- [ ] **Step 5: Email layouts**

```bash
test -f packages/core/src/templates/layouts.ts && echo OK
```

Record findings.

### Task 2.4: Audit v0.2.5 — Postgres workflow

- [ ] **Step 1: postgresWorkflowAdapter exists**

```bash
grep -n "postgresWorkflowAdapter\|export.*postgres" packages/core/src/adapters/workflow/postgres.ts
```

- [ ] **Step 2: Step-level durability**

```bash
grep -n "checkpoint\|step.*state\|workflow_steps\|workflow_runs" packages/core/src/adapters/workflow/postgres.ts
```

- [ ] **Step 3: Delay step support**

```bash
grep -n "delay\|scheduled_at\|run_after" packages/core/src/adapters/workflow/postgres.ts
```

- [ ] **Step 4: Retry/error handling**

```bash
grep -n "retry\|attempt\|backoff" packages/core/src/adapters/workflow/postgres.ts
```

- [ ] **Step 5: Note the unchecked items** in v0.2.5:
  - `Make it the default` — is there any auto-config logic when a user passes `prismaAdapter({ provider: "postgresql" })`?
  - `Migration guide` — does any doc explain migrating from Postgres → Inngest?
  - `Tests` — `tests/postgres-workflow.test.ts` and `tests/postgres-extended.test.ts` exist; do they cover durability, retries, delays, crash recovery?

```bash
grep -n "durability\|retry\|delay\|recovery\|crash" packages/core/tests/postgres-workflow.test.ts packages/core/tests/postgres-extended.test.ts
```

Record each as either "already done, ROADMAP is stale" or "genuinely missing, keep unchecked".

### Task 2.5: Audit v0.3 — Workflow Steps (marked COMPLETE)

- [ ] **Step 1: Delay step**

```bash
grep -n "delay\|step.delay\|type.*delay" packages/core/src/core/workflow-runtime.ts packages/core/src/types/workflow.ts
```

- [ ] **Step 2: Digest/batch step**

```bash
grep -rn "digest\|batch" packages/core/src/ --include="*.ts" | head -20
```

- [ ] **Step 3: Branch step**

```bash
grep -n "branch\|conditional" packages/core/src/core/workflow-runtime.ts
```

- [ ] **Step 4: Throttle step**

```bash
grep -rn "throttle" packages/core/src/ --include="*.ts"
```

- [ ] **Step 5: Fetch step**

```bash
grep -rn "fetch.*step\|step.*fetch" packages/core/src/ --include="*.ts"
```

Flag any marked-done items that appear missing or half-implemented.

### Task 2.6: Audit v0.4 — Additional Adapters

- [ ] **Step 1: Drizzle adapter**

```bash
test -f packages/core/src/adapters/database/drizzle/adapter.ts && echo OK
```

- [ ] **Step 2: Postgres workflow adapter** (already covered in v0.2.5)

- [ ] **Step 3: Upstash workflow adapter**

```bash
test -f packages/core/src/adapters/workflow/upstash.ts && echo OK
```

### Task 2.7: Audit v0.5 — Advanced Preferences

- [ ] **Step 1: Category-based preferences**

```bash
grep -n "CategoryPreference" packages/core/src/**/*.ts
```

- [ ] **Step 2: Workflow-level preferences**

```bash
grep -n "WorkflowChannelPreference" packages/core/src/**/*.ts
```

- [ ] **Step 3: Critical notifications + readOnly**

```bash
grep -n "critical\|readOnly" packages/core/src/core/preferences.ts
```

- [ ] **Step 4: Operator-level preferences**

```bash
grep -n "OperatorPreferences" packages/core/src/**/*.ts
```

- [ ] **Step 5: Preference inheritance (12-level precedence)**

```bash
grep -n "preferenceGate" packages/core/src/core/preferences.ts
```

- [ ] **Step 6: Preference conditions**

```bash
grep -n "PreferenceCondition" packages/core/src/**/*.ts
```

- [ ] **Step 7: Bulk preference API**

```bash
grep -rn "bulk\|PUT /preferences/bulk" packages/core/src/api/routes/ --include="*.ts"
```

- [ ] **Step 8: Note the unchecked `preferenceGate` refactor** — already captured in ROADMAP as future work, leave as-is unless the refactor is already done.

### Task 2.8: Rewrite ROADMAP with audit findings

- [ ] **Step 1: Promote correctly-done items** — any `[ ]` that the audit proved is actually built → change to `[x]`.

- [ ] **Step 2: Demote incorrectly-checked items** — any `[x]` where the audit found no implementation → either change back to `[ ]` or (if you're confident it's truly done and just wasn't found by grep) add a code-pointer comment next to it.

- [ ] **Step 3: If any "done" phase has an acknowledged gap,** add a new section at the bottom of the ROADMAP titled `## Phase Catch-Up — Gaps in Completed Phases` listing the gaps as checkboxes, each with a one-line explanation of what's missing and which earlier phase it belongs to.

Only add this section if there are genuine gaps — if the audit comes back clean, do not invent placeholder work.

- [ ] **Step 4: Update "Current" marker** — v0.1 is currently labelled "Foundation (Current)" but v0.5 is marked done. Update the heading to reflect the actual current phase (likely v0.6 is next, so v0.5 is "Current" or last-shipped).

### Task 2.9: Commit and open PR

- [ ] **Step 1: Review the diff**

```bash
git diff ROADMAP.md
```

- [ ] **Step 2: Stage and commit**

```bash
git add ROADMAP.md
git commit -m "docs: sync roadmap with actual code state"
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin docs/roadmap-sync
gh pr create --title "docs: sync roadmap with actual code state" --body "$(cat <<'EOF'
## Summary
- Audit each roadmap item against the codebase
- Promote items that are done but unchecked, demote items that are checked but missing
- Add a "Phase Catch-Up" section capturing gaps in phases marked done (if any)
- Fix the "Current" phase marker

## Test plan
- [ ] Every `[x]` in ROADMAP.md has a code pointer someone could verify
- [ ] Every `[ ]` represents real outstanding work, not a typo or stale item
EOF
)"
```

**MERGE this PR to `main` before starting Phase 3.**

---

## Phase 3 — Code review fixes (TDD, one commit per fix)

**Branch:** `fix/pre-release-code-review`
**Outcome:** A prioritized list of review findings, each fixed in its own red-green-commit cycle. One PR at end with many commits.

This phase is discovery-driven: we can't enumerate findings ahead of time. The plan provides:
- A concrete review checklist (what to examine, where, for what)
- A TDD template (Task 3.X) to apply to every finding
- A prioritization rule (what's a must-fix vs nice-to-have)

**Key rule:** if the review turns up nothing worth fixing, that is a valid outcome. Close the branch without a PR. Do not invent work.

### Task 3.1: Cut the review branch

- [ ] **Step 1: Pull latest (includes Phase 1 rename + Phase 2 roadmap) and branch**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b fix/pre-release-code-review
```

### Task 3.2: Review area — CODING_STANDARDS.md compliance

Read the standards once: `sed -n '1,200p' CODING_STANDARDS.md`.

- [ ] **Step 1: Silent error swallowing**

```bash
grep -rn "catch.*{" packages/core/src/ --include="*.ts" -A 3 | grep -B 1 "^\s*}\s*$" | head -60
```
Look for empty catches, catches that only `console.log`, or catches that swallow errors without rethrowing or returning a structured error. List findings.

- [ ] **Step 2: Type narrowness**

```bash
grep -rn ": string" packages/core/src/ --include="*.ts" | grep -iE "channel|status|type|provider" | head -40
```
Look for `channel: string`, `status: string`, etc. where a narrow union exists. List findings.

- [ ] **Step 3: PATCH semantics**

```bash
grep -rn "PATCH\|patch" packages/core/src/api/routes/ --include="*.ts" -B 1 -A 10 | head -80
```
Look for PATCH handlers that overwrite fields not present in the request body. List findings.

- [ ] **Step 4: Resource cleanup**

```bash
grep -rn "Map\|Set" packages/core/src/ --include="*.ts" | grep -v test | head -20
```
For any internal Map/Set storing request-scoped state, confirm entries are removed in a `finally` block.

- [ ] **Step 5: 500 response leakage**

```bash
grep -rn "500\|Internal Server Error\|throw.*Error" packages/core/src/api/ --include="*.ts" | head -40
```
Confirm 500 responses return a generic message and the real error is logged server-side, not returned in the body.

### Task 3.3: Review area — Security

- [ ] **Step 1: Template injection / XSS in rendered content**

```bash
grep -rn "SafeString\|escape\|noEscape\|triple.*stache" packages/core/src/templates/ --include="*.ts"
```
Confirm Handlebars escape rules are appropriate. HTML email bodies should escape variable substitutions by default. Look for places user input flows into a template without escaping.

- [ ] **Step 2: SQL injection surface in adapters**

```bash
grep -rn "query\(\|\`.*\${" packages/core/src/adapters/ --include="*.ts" | grep -v test | head -40
```
Flag any raw SQL built by string concatenation/interpolation with user input. Parameterized queries are fine; string-built SQL is not.

- [ ] **Step 3: Secrets in logs**

```bash
grep -rn "console\.log\|logger" packages/core/src/ --include="*.ts" | grep -iE "key|token|secret|password|apiKey" | head -20
```
Any match is a finding.

- [ ] **Step 4: Auth on API routes**

```bash
grep -rn "trigger\|subscriber" packages/core/src/api/routes/ --include="*.ts" | head -40
```
Read the trigger route. Does it accept any caller, or require an API key / HMAC signature? Document whatever the current posture is so downstream users can build auth on top. If there's no documented authentication story, that's a finding — either add a hook for it or document that auth is the embedder's responsibility.

- [ ] **Step 5: Input validation with Zod on API routes**

```bash
grep -rn "z\.\|Zod" packages/core/src/api/routes/ --include="*.ts" | head -20
```
Every request body should be Zod-parsed before use. Flag any route that trusts the incoming JSON without parsing.

### Task 3.4: Review area — Public API ergonomics

The goal: imagine a developer installs `@heraldjs/core` today. Would they get a sharp paper cut in the first 10 minutes?

- [ ] **Step 1: Verify all public exports**

```bash
cat packages/core/src/index.ts
```
Confirm the public entrypoint re-exports every type a consumer needs — `ChannelType`, `HeraldAPI`, `HeraldOptions`, `NotificationWorkflow`, `HeraldPlugin`, etc. Missing exports force users to dig into internal paths.

- [ ] **Step 2: Check TSDoc on public factory functions**

```bash
grep -n "^export" packages/core/src/index.ts
```
For every top-level export, confirm the function/type carries a TSDoc comment with at least a one-line purpose and a short example. Missing TSDoc on a user-facing factory = finding.

- [ ] **Step 3: Error messages**

```bash
grep -rn "throw new Error" packages/core/src/ --include="*.ts" | head -40
```
Spot-check 10 throw sites. Does the message tell the developer what went wrong and (ideally) what to do? "Invalid config" is bad; "herald(): `database` is required — pass prismaAdapter(), drizzleAdapter(), or memoryAdapter()" is good.

- [ ] **Step 4: Default values for common configs**

Read `herald()` in `packages/core/src/core/herald.ts`. Are there sensible defaults for everything that isn't truly required? An open-source library with lots of required fields loses users in the first 5 minutes.

- [ ] **Step 5: README quickstart is copy-pasteable**

```bash
sed -n '/^```typescript/,/^```/p' README.md | head -80
```
Mentally execute the first code block in the README. Does it compile? Is there an obvious missing step? Is any type visually confusing?

### Task 3.5: Review area — Correctness

- [ ] **Step 1: Missing `await`**

```bash
grep -rn "\.then\|Promise<" packages/core/src/ --include="*.ts" | grep -v test | head -40
grep -rn "async.*=>" packages/core/src/ --include="*.ts" -A 1 | grep -B 1 "^\s*[a-zA-Z_].*(" | head -30
```
Eyeball for async calls that are not awaited where they should be. `noFloatingPromises` rule coverage — is it on in Biome? If not, a finding.

- [ ] **Step 2: Race conditions around shared state**

```bash
grep -rn "Map<\|Set<" packages/core/src/core/ --include="*.ts" | head -10
```
Any module-scoped Map/Set that isn't clearly request-scoped could race under concurrent load. List each.

- [ ] **Step 3: Nullable guards**

```bash
grep -rn "!\." packages/core/src/ --include="*.ts" | grep -v test | head -40
```
Non-null assertions. Each one is a claim; spot-check 10.

- [ ] **Step 4: Pagination off-by-one**

```bash
grep -rn "limit\|offset\|cursor\|take\|skip" packages/core/src/adapters/ --include="*.ts" | head -40
```
Spot-check pagination math in at least one adapter.

### Task 3.6: Review area — Build/publish readiness

- [ ] **Step 1: Exports map completeness**

Read `packages/core/package.json` `exports` field. Every file someone could reasonably import from should have an explicit export. Flag missing subpaths.

- [ ] **Step 2: ESM-only claim**

```bash
grep -n "require\|module.exports" packages/core/src/
```
Confirm no CJS contamination in source. If there's any, it's either a finding or a documented compromise.

- [ ] **Step 3: Types emit correctly**

```bash
pnpm build
find packages/core/dist -name "*.d.mts" | head -20
```
Every `exports` entry should have a corresponding `.d.mts`.

- [ ] **Step 4: Tarball content sanity** (already covered in Phase 1 Task 1.10 — re-run if the review changed files that affect packaging)

### Task 3.7: Consolidate findings and prioritize

- [ ] **Step 1: Compile the findings list** from Tasks 3.2–3.6 into a scratch file (local, not committed).

- [ ] **Step 2: Classify each finding** as:
  - **MUST-FIX** — correctness bug, security hole, CODING_STANDARDS violation, public-API paper cut that would embarrass on HN
  - **NICE-TO-HAVE** — ergonomic improvement that isn't critical
  - **WONTFIX** — stylistic, cosmetic, or best left to a future phase

- [ ] **Step 3: Fix MUST-FIX only.** NICE-TO-HAVE items become entries in ROADMAP's backlog (a separate follow-up, not this PR). WONTFIX items are dropped.

The user's explicit instruction was "don't go crazy" — lean aggressively toward WONTFIX/NICE-TO-HAVE on borderline items.

### Task 3.8 (template, repeat per MUST-FIX): TDD red → green → commit

Repeat this task for each MUST-FIX finding. Each iteration = one commit.

**Files:**
- Test: write or extend a file in `packages/core/tests/` — match the existing filename convention
- Source: the exact file(s) named in the finding

- [ ] **Step 1: State the finding in one sentence** in your own words. This is your north star for this commit.

- [ ] **Step 2: Write the failing test**

Pick the appropriate existing test file for the area. If none fits, create a new one following the existing convention (`<area>.test.ts` in `packages/core/tests/`). Use `memoryAdapter()` for the database unless testing a real-adapter-specific behavior.

Example skeleton (adapt to the actual finding):

```ts
import { describe, it, expect } from "vitest";
import { /* relevant symbols */ } from "../src/...";

describe("<area>: <finding summary>", () => {
  it("<specific behavior that demonstrates the bug>", async () => {
    // arrange: set up the scenario that triggers the bug
    // act: exercise the code
    // assert: the correct behavior, which currently fails
  });
});
```

- [ ] **Step 3: Run the test — it MUST fail**

```bash
pnpm test:run -- <path/to/test>
```
Expected: one failing assertion, matching the bug. If it passes, the test is wrong or the bug is gone — re-verify the finding.

- [ ] **Step 4: Implement the minimal fix**

Edit only the necessary source file. Do not refactor adjacent code. Do not add features the finding doesn't require.

- [ ] **Step 5: Run the test — it MUST pass**

```bash
pnpm test:run -- <path/to/test>
```

- [ ] **Step 6: Run the full suite — no regressions**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test:run
```

- [ ] **Step 7: Commit**

```bash
git add <test file> <source file(s)>
git commit -m "<type>: <finding summary>"
```
Use `fix:` for bugs, `refactor:` for standards compliance without behavior change, `test:` if the fix is purely test coverage. Keep the subject line under 72 chars; use the body if you need to explain why.

### Task 3.9: Open the Phase 3 PR

After all MUST-FIX commits are on the branch.

- [ ] **Step 1: Review the commit list**

```bash
git log --oneline main..fix/pre-release-code-review
```
Every commit should be a single, self-contained fix.

- [ ] **Step 2: Final quality gate**

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm test:bdd
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin fix/pre-release-code-review
gh pr create --title "fix: pre-public-release code review findings" --body "$(cat <<'EOF'
## Summary
Pre-public-release review of the codebase. Each commit addresses one finding via red-green TDD.

Review areas examined: CODING_STANDARDS compliance, security (template escape, SQL, secrets, auth, input validation), public API ergonomics, correctness (await/race/nullable/pagination), build/publish readiness.

Scope: MUST-FIX only. NICE-TO-HAVE items captured in ROADMAP backlog. WONTFIX items dropped.

See commit messages for individual findings.

## Test plan
- [ ] `pnpm lint && pnpm typecheck && pnpm test:run && pnpm test:bdd` all green
- [ ] Every commit has a corresponding test that fails without the fix and passes with it
- [ ] `npm publish --dry-run --access public` from `packages/core/` still clean
EOF
)"
```

- [ ] **Step 4: If the review produced zero MUST-FIX findings,** delete the branch and skip the PR — instead, comment on the Phase 2 PR (or open a short issue) noting that the review was performed and nothing critical was found. No-finding is a valid outcome and shouldn't produce churn.

---

## Post-plan: release

(Out of scope for this plan, but noted so the user knows what comes next.)

After all three PRs merge:

1. Bump `packages/core/package.json` version from `0.4.0` → `0.5.0` (matching CHANGELOG unreleased block)
2. Move the `[Unreleased]` block in CHANGELOG.md under `## [0.5.0] — 2026-04-XX`
3. Commit `chore: release v0.5.0`, merge to `main`
4. Tag: `git tag -a v0.5.0 -m "v0.5.0" && git push origin main --tags`
5. GitHub release from tag
6. `cd packages/core && npm publish --access public`

The plan's Phase 1 Task 1.10 dry-run is a rehearsal for exactly this step.

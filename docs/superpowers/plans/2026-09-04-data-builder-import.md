# TencentDB Agent Memory Data Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one configuration file and one command that builds Skill and Memory once, then installs the same completed MemoryCore data into Baseline and Native.

**Architecture:** The `eval_kit` package owns validation, imports, orchestration, configuration, documentation, and tests. The builder runs Baseline MemoryCore/MemoryPanel source against an isolated runtime directory, freezes completed Core data, and performs recoverable target replacement.

**Tech Stack:** TypeScript, Node.js 22, js-yaml, Zod, Vitest, user systemd, existing MemoryCore HTTP APIs.

**Spec:** `docs/superpowers/specs/2026-09-04-data-builder-import-design.md`

## Global Constraints

- Skill and L0 are imported into Data Builder exactly once; Baseline and Native do not independently invoke the extraction LLM.
- Credentials stay outside Git and must never be printed.
- Existing Baseline/Native data is moved to a timestamped backup before replacement.
- A failed build never modifies target data; a failed install restores both targets.
- Data Builder includes MemoryCore, MemoryPanel backend, and MemoryPanel web only.
- Existing `eval_kit/importers/skills` and `eval_kit/importers/memories` import behavior remains compatible.
- No Knowledge Tool or MemoryProxy behavior changes are in scope.

---

### Task 1: Configuration and input validation

**Files:**
- Create: `eval_kit/data-preparation/config.ts`
- Test: `eval_kit/tests/data-builder-config.test.ts`

**Interfaces:**
- Produces: `loadDataBuilderConfig(path): Promise<DataBuilderConfig>` and `inspectDataBuilderInputs(config): Promise<InputInspection>`.
- Consumes: `discoverSkillPackages()` and `discoverMemorySessions()`.

- [ ] Write tests proving relative paths resolve from the YAML file, defaults are applied, invalid/equal ports are rejected, and missing project/dataset paths fail before mutation.
- [ ] Run the new test and confirm it fails because the module does not exist.
- [ ] Implement strict YAML parsing, path resolution, project/package checks, data discovery, package-version compatibility, and input counts.
- [ ] Run the focused test and all existing importer tests.

### Task 2: Runtime configuration and service control

**Files:**
- Create: `eval_kit/data-preparation/runtime.ts`
- Test: `eval_kit/tests/data-builder-runtime.test.ts`

**Interfaces:**
- Produces: `prepareBuilderRuntime()`, `startBuilderServices()`, `stopBuilderServices()`, `waitForCore()`, `resetBuilderData()`.
- Consumes: resolved `DataBuilderConfig` and an injectable command runner.

- [ ] Write tests proving runtime files contain only resolved builder paths/ports, copied secrets use mode `0600`, old builder data is moved to a backup, and systemd commands target only `tdam-data-builder-*`.
- [ ] Run the focused test and confirm the expected missing behavior.
- [ ] Implement runtime directory/config generation and systemd unit rendering without logging secret values.
- [ ] Run the focused tests.

### Task 3: Completion waiting and frozen data versions

**Files:**
- Create: `eval_kit/data-preparation/release.ts`
- Test: `eval_kit/tests/data-builder-release.test.ts`

**Interfaces:**
- Produces: `computeInputDigest()`, `waitForMemoryProcessing()`, `createRelease()`, `readReusableRelease()`.

- [ ] Write tests for deterministic input hashes, L1-to-L2 waiting, consecutive idle checks, timeout diagnostics, immutable release creation, and reuse only when the manifest matches.
- [ ] Run the focused test and confirm failure.
- [ ] Implement HTTP status polling, content hashing, release copying, and manifest creation.
- [ ] Run the focused tests.

### Task 4: Recoverable installation and verification

**Files:**
- Create: `eval_kit/data-preparation/install.ts`
- Test: `eval_kit/tests/data-builder-install.test.ts`

**Interfaces:**
- Produces: `installReleaseToTargets()` and `verifyPreparedTarget()`.

- [ ] Write tests proving both old target directories are retained, both targets receive the same release, a second-target failure restores the first target, and no path outside configured Core directories is moved.
- [ ] Run the focused test and confirm failure.
- [ ] Implement staged copies, atomic directory swaps, rollback, target service restart, Native service-address adjustment, and API verification.
- [ ] Run the focused tests.

### Task 5: One-command orchestration

**Files:**
- Create: `eval_kit/data-preparation/prepare.ts`
- Create: `eval_kit/data-preparation/command.ts`
- Modify: `eval_kit/cli.ts`
- Modify: `eval_kit/package.json`
- Test: `eval_kit/tests/data-builder-prepare.test.ts`

**Interfaces:**
- Produces CLI: `npm run data:prepare -- --config FILE [--check]`.

- [ ] Write an orchestration test proving the build path calls Skill import once, Memory import once, waits, creates a release, installs once, and the reusable-release path skips imports and LLM work.
- [ ] Run the focused test and confirm failure.
- [ ] Implement the coordinator and CLI output with phase/progress reporting.
- [ ] Run focused and full Eval Kit tests plus typecheck.

### Task 6: Eval Kit data preparation entry point and documentation

**Files:**
- Create: `eval_kit/configs/data-preparation.yaml`
- Create: `eval_kit/prepare-data.sh`
- Create: `eval_kit/docs/data-preparation.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces one user command: `./prepare-data.sh`; Memory Hub: `http://127.0.0.1:25173`.

- [ ] Add the current project/dataset paths to the sample configuration without credentials.
- [ ] Add a wrapper that locates Eval Kit reliably and calls its data preparation command.
- [ ] Document first run, check-only mode, progress viewing, backups, release reuse, and Windows SSH forwarding.
- [ ] Run `./prepare-data.sh --check` against the current environment and confirm it performs no writes.

### Task 7: Final verification

**Files:**
- Verify only; update documentation for any observed difference.

- [ ] Run `npm run typecheck` in `eval_kit`.
- [ ] Run `npm test` in `eval_kit`.
- [ ] Run Data Builder check-only mode.
- [ ] Inspect `git diff --check` and confirm unrelated dirty files are unchanged.
- [ ] Report that the live destructive preparation was not run automatically; provide the exact one-command handoff.

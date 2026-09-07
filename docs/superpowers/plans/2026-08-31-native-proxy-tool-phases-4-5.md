# Native Proxy Tool Phases 4 and 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This task must be executed inline without subagents.

**Goal:** Add all six Memory and ten Skill Native Proxy Tools, extend the shared Tool Loop to OpenAI-compatible Chat Completions, preserve Provider-owned protocol data, and make hidden Native Tool history compression-safe.

**Architecture:** Generalize the existing Registry and Dispatcher around Memory/Skill Bridge executors while retaining the phase-two/three Coordinator, reliable state store, leases and outbox. Add a conservative OpenAI SSE adapter that emits completed calls only at the round boundary, then add a storage-backed compression-history service that reconstructs completed hidden batches before compaction and marks them covered only after a successful checkpoint.

**Tech Stack:** TypeScript 5.8, Node.js 22, Hono, Web Streams, Vitest 3, Anthropic Messages SSE, OpenAI-compatible Chat Completions SSE, `@clickhouse/client`, ClickHouse 25.12.

**Spec:** `docs/superpowers/specs/2026-08-31-native-proxy-tool-phases-4-5-design.md`

## Global Constraints

- Do not implement Knowledge Native Proxy Tools or OpenAI Responses.
- Do not restore Fake Tool text, curl recipes, compatibility switches or fallback behavior.
- Preserve the existing Anthropic tool loop and all phase-two/three durability guarantees.
- Registry owns schemas, routes, effects and exposure; models never supply identity, URL, headers or credentials.
- Memory tools require `chat_memory`; Skill tools require `skill`; Skill writes additionally require `skillRuntime.allowLlmWrite=true`.
- Read tools may execute after a protocol completion signal; write/archive tools execute only after the upstream round is complete.
- Retry only transport errors, 408, 429 and 5xx; never retry schema, permission, not-found or version-conflict errors.
- Keep successful stream bodies single-consumer and fail closed when reliable state is unavailable.
- Treat Provider extensions as opaque protocol data and never create Proxy/Client slots for them.
- Compression marks history covered only after a successful response and never covers pending, running, aborted or out-of-range state.
- Never log or persist credentials, raw exceptions, authorization headers or unbounded Bridge payloads.
- All code changes occur in the existing isolated branch `codex/anthropic-native-proxy-tools`.

---

### Task 1: Generalize Registry and Exposure Resolver

**Files:**
- Modify: `src/native-proxy-tools/tool-registry.ts`
- Modify: `src/native-proxy-tools/native-proxy-tools-injector.ts`
- Modify: `src/native-proxy-tools/types.ts`
- Modify: `src/native-proxy-tools/__tests__/tool-registry.test.ts`

**Interfaces:**
- Produces `NativeToolBackend = "memory" | "skill"` and `NativeToolEffect = "read" | "write" | "archive"`.
- Produces `NativeProxyToolDefinition.backend`, `.effect`, `.route`, `.exposure` and `.validate`.
- Produces `registry.visibleFor({ memoryEnabled, chatMemory, skillEnabled, skillCapability, allowSkillWrite })`.

- [ ] **Step 1: Write failing Registry tests**

Assert the exact ordered name set:

```ts
expect(registry.list().map(t => t.name)).toEqual([
  "tdai_memory_search", "tdai_atomic_query", "tdai_conversation_search",
  "tdai_conversation_query", "tdai_scenario_ls", "tdai_read_scene",
  "skill_search", "skill_view", "skill_files_read", "skill_extract",
  "skill_create", "skill_update", "skill_patch", "skill_delete",
  "skill_files_write", "skill_files_remove",
]);
```

Add 0/Memory-only/Skill-4/Skill-10 visibility cases and assert all definitions have `additionalProperties:false`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-registry.test.ts`

Expected: FAIL because only `tdai_memory_search` exists and no exposure resolver exists.

- [ ] **Step 3: Add schema validation helpers and definitions**

Use strict object validation and these limits:

- query/path/name/id/reason strings: trim, non-empty where required, maximum 2,000 except Skill content maximum 262,144;
- limits: Memory search `1..20`, Memory query `1..100`, Conversation query `1..200`, offsets `0..100000`;
- atomic type enum `episodic|persona|instruction`;
- time fields must be finite ISO timestamps;
- encoding enum `utf-8|base64`;
- `replace_all` and `is_executable` booleans only;
- resources/files/path arrays maximum 64 entries; each path maximum 1,024; file content maximum 1 MiB before the configured result cap;
- reject identity and transport fields (`user_id`, `team_id`, `agent_id` except the compatibility scene reference, `space_id`, `url`, `headers`, `authorization`).

Keep defaults in the normalized validated value so the Bridge receives deterministic arguments.

- [ ] **Step 4: Implement visibility and injector use**

Replace `registry.list()` in the injector with `visibleFor(...)`, using Session/capability/config data already present in `AgentContext.metadata.custom`. Collision checks run against all reserved Registry names, including currently hidden write tools.

- [ ] **Step 5: Verify GREEN and regressions**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-registry.test.ts src/__tests__/config-native-proxy-tools.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat(proxy): register memory and skill native tools`

---

### Task 2: Add Memory/Skill Bridge Executors and Stable Error Mapping

**Files:**
- Create: `src/native-proxy-tools/bridge-tool-executors.ts`
- Modify: `src/native-proxy-tools/native-proxy-tool-dispatcher.ts`
- Modify: `src/memory/memory-bridge.ts`
- Modify: `src/skill/skill-bridge.ts`
- Modify: `src/native-proxy-tools/__tests__/native-proxy-tool-dispatcher.test.ts`
- Modify: `src/memory/__tests__/memory-bridge-executor.test.ts`
- Create: `src/skill/__tests__/skill-bridge-executor.test.ts`

**Interfaces:**
- Produces `BridgeToolExecutor.execute({ definition, input, scope, callId, signal }): Promise<BridgeExecutionResult>`.
- Produces `createMemoryToolExecutor` and `createSkillToolExecutor` around protocol-independent Bridge functions.
- Dispatcher accepts `executors: Record<NativeToolBackend, BridgeToolExecutor>`.

- [ ] **Step 1: Write failing executor tests**

Cover all 16 name-to-route mappings, trusted session/space propagation, model-supplied identity overwrite, empty success envelopes, malformed envelopes, 400/401/403/404/409, 408/429/500, timeout, retry count and UTF-8 truncation.

Assert `skill_delete` receives the pinned `expected_version`, and write/archive calls carry the stable `callId` as internal operation identity without exposing it to the model.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/native-proxy-tools/__tests__/native-proxy-tool-dispatcher.test.ts src/skill/__tests__/skill-bridge-executor.test.ts`

Expected: FAIL because Dispatcher is Memory-only and no Skill executor exists.

- [ ] **Step 3: Extract protocol-independent Skill Bridge execution**

Keep the Hono handler as a wrapper. The executor receives trusted scope directly, applies the same allowlist, capability/write policy, visibility filtering and version-pin logic, then calls Core with server-held credentials. Add `delete` to version-locked operations. Return `{status,text,contentType}` without logging bodies.

- [ ] **Step 4: Implement backend dispatch, retry and result limits**

Use an attempt loop of initial call plus one retry for retryable failures. Respect `AbortSignal.timeout(config.nativeProxyTools.toolTimeoutMs)`. Normalize errors to `{code,message,request_id?,retryable}`. Success returns only envelope `data`; when serialized bytes exceed `maxResultBytes`, return a bounded structure with `truncated:true`, byte counts and an omitted-content marker.

- [ ] **Step 5: Verify GREEN**

Run the three focused test files and `npm run typecheck`.

- [ ] **Step 6: Commit**

Commit: `feat(proxy): execute native tools through memory and skill bridges`

---

### Task 3: Enforce Side-Effect Scheduling and Multi-Tool Limits

**Files:**
- Modify: `src/native-proxy-tools/tool-loop-coordinator.ts`
- Modify: `src/native-proxy-tools/client-tool-resume.ts`
- Modify: `src/native-proxy-tools/types.ts`
- Modify: `src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`
- Modify: `src/native-proxy-tools/__tests__/client-tool-resume.test.ts`

**Interfaces:**
- Read definition effects through Registry.
- Persist `executionEligibleAt: "call_complete" | "round_complete"` per Proxy slot.

- [ ] **Step 1: Write failing scheduling tests**

Assert read calls start as soon as their protocol completion event is durable; write/archive calls remain pending until `message_completed`; multiple same-name calls use distinct call IDs; per-round and total limits count all Proxy calls; invalid arguments produce terminal Tool Results without Bridge execution.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts src/native-proxy-tools/__tests__/client-tool-resume.test.ts`

- [ ] **Step 3: Implement effect-aware scheduling**

Persist every slot before execution. Start reads from `tool_call_completed`; enqueue writes/archive and release them only after a complete stream snapshot. On aborted streams, mark the batch aborted and never execute queued side effects. Reuse the existing lease/result CAS and loop counters.

- [ ] **Step 4: Verify GREEN and Anthropic integration**

Run focused tests plus `npx vitest run src/__tests__/anthropic-native-proxy-tool.integration.test.ts`.

- [ ] **Step 5: Commit**

Commit: `feat(proxy): schedule native tool effects safely`

---

### Task 4: Implement OpenAI-compatible Incremental Adapter and Rebuilder

**Files:**
- Create: `src/injection/adapters/openai-stream.ts`
- Create: `src/injection/adapters/__tests__/openai-stream.test.ts`
- Modify: `src/injection/adapters/openai.ts`
- Modify: `src/injection/adapters/interface.ts`
- Create: `src/native-proxy-tools/openai-response-rebuilder.ts`
- Create: `src/native-proxy-tools/__tests__/openai-response-rebuilder.test.ts`

**Interfaces:**
- `OpenAIAdapter.createStreamParser(registry)` returns a `ProtocolStreamParser`.
- Parser emits calls only after `finish_reason:"tool_calls"` or terminal `[DONE]`.
- Rebuilder exposes client-visible bytes and full logical assistant/tool messages.

- [ ] **Step 1: Write failing parser tests**

Cover LF/CRLF/CR frames, multi-line `data:`, UTF-8 split, interleaved two-call argument fragments, malformed JSON, missing IDs, `finish_reason`, `[DONE]`, usage, `reasoning_content`, arbitrary unknown delta fields and Provider extension objects.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/injection/adapters/__tests__/openai-stream.test.ts`

- [ ] **Step 3: Implement conservative parser**

Retain every raw frame and full parsed event. Accumulate standard `type:"function"` calls by OpenAI index; classify Registry names as proxy and other functions as client. Unknown/non-function extensions remain opaque events and never emit `tool_call_completed`.

- [ ] **Step 4: Write RED rebuilder tests**

Assert pure Client response is byte-identical, proxy calls are absent from client-visible mixed output, indexes are legal after filtering, unknown/provider fields remain unchanged, and full re-entry uses `assistant.tool_calls[]` followed by ordered `role:"tool"` messages.

- [ ] **Step 5: Implement rebuilder and verify GREEN**

Run both focused files and the Anthropic parser/rebuilder tests.

- [ ] **Step 6: Commit**

Commit: `feat(proxy): parse and rebuild openai native tool streams`

---

### Task 5: Integrate the Shared Tool Loop into Chat Completions Handler

**Files:**
- Modify: `src/handler.ts`
- Modify: `src/native-proxy-tools/exact-target-transport.ts`
- Modify: `src/native-proxy-tools/runtime.ts`
- Create: `src/__tests__/openai-native-proxy-tool.integration.test.ts`

**Interfaces:**
- Generalize exact-target transport for `protocol:"openai"` request messages/results.
- Handler uses the Runtime only for streaming main Chat Completions requests with trusted identity.

- [ ] **Step 1: Write failing handler integration tests**

Cover pure Native, pure Client exact replay, mixed Native/Client, Client result resume, multiple same-name calls, Bridge error/no result, upstream 4xx leak rejection, interrupted SSE, restart recovery, exact target reuse and `stream:false` no-injection behavior.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/__tests__/openai-native-proxy-tool.integration.test.ts`

- [ ] **Step 3: Integrate runtime before forwarding**

Build the original logical request fingerprint before Session/injection mutation, inject only visible Registry definitions, retain the successful target snapshot, and attempt durable resume before a new upstream call.

- [ ] **Step 4: Replace successful stream tap with Coordinator ownership**

Coordinator consumes the stream once. Feed completion metadata back to existing usage/Langfuse/L0/Skill extraction/credit logic without exposing Proxy tool names, inputs or results. Preserve the old path when Native runtime is disabled or request is auxiliary/non-streaming.

- [ ] **Step 5: Verify GREEN and cross-protocol regressions**

Run OpenAI integration, Anthropic integration, handler tests and typecheck.

- [ ] **Step 6: Commit**

Commit: `feat(proxy): run native tool loop for openai chat completions`

---

### Task 6: Persist Compression Checkpoints and Reconstruct Hidden History

**Files:**
- Modify: `src/native-proxy-tools/types.ts`
- Modify: `src/db/tool-execution-storage-adapter.ts`
- Modify: `src/db/in-memory-tool-execution-storage-adapter.ts`
- Modify: `src/db/clickhouse-tool-execution-storage-adapter.ts`
- Create: `src/native-proxy-tools/compression-history.ts`
- Create: `src/native-proxy-tools/__tests__/compression-history.test.ts`
- Modify: `src/db/__tests__/tool-execution-storage-contract.test.ts`
- Modify: `src/db/__tests__/clickhouse-tool-execution-storage-adapter.test.ts`
- Modify: `scripts/qa/__tests__/clickhouse-native-tool-state.integration.test.ts`

**Interfaces:**
- Adds `CompressionCheckpoint { version, coveredThroughTurnSeq, createdAt }`.
- Adds `findCompletedHistory(scope, throughTurnSeq)` and `markCoveredByCheckpoint(scope, throughTurnSeq, checkpoint, expectedUncoveredIds)`.
- Produces `reconstructCompressionMessages(clientMessages, contexts, protocol)` with duplicate-call protection.

- [ ] **Step 1: Write failing storage contract tests**

Cover ordered completed-history reads, scope isolation, exclusion of aborted/pending/already-covered records, atomic coverage, concurrent checkpoints, repeated checkpoint idempotence, expiry and restart decode.

- [ ] **Step 2: Verify RED**

Run storage contract and ClickHouse adapter unit tests.

- [ ] **Step 3: Implement storage schema and CAS**

Add allowlisted checkpoint JSON/columns and ClickHouse migration. Query final/replayable completed rows ordered by `turn_seq, created_at`; coverage UPDATE must predicate scope, turn range, uncovered state and completed stream status. Return the exact affected count and fail closed on mismatch.

- [ ] **Step 4: Write failing reconstruction tests**

Test Anthropic and OpenAI logical messages, client history that already contains a call ID, multiple batches, incomplete slots, corrupted skeleton and deterministic ordering.

- [ ] **Step 5: Implement reconstruction service and verify GREEN**

Reuse existing full-message rebuilders rather than duplicating protocol encoding. Reject corrupted or incomplete state; never synthesize partial Tool Results.

- [ ] **Step 6: Run real ClickHouse test**

Load credentials only from the local ignored secrets file, run the dedicated integration test, and confirm checkpoint data survives a second Adapter instance before the temporary table is dropped.

- [ ] **Step 7: Commit**

Commit: `feat(proxy): persist native tool compression checkpoints`

---

### Task 7: Wire Compression Requests and Invalidate Old Context

**Files:**
- Modify: `src/handler.ts`
- Modify: `src/agent-adapters/dsh.ts`
- Create: `src/__tests__/native-tool-compression.integration.test.ts`

**Interfaces:**
- Auxiliary classification exposes a compaction-specific signal instead of collapsing every auxiliary request into one behavior.
- Compression wrapper returns the upstream response and commits checkpoint only after successful validated completion.

- [ ] **Step 1: Write failing integration tests**

Cover hidden-history insertion before the compaction call, successful checkpoint, failed upstream no checkpoint, pending batch retained, second compression no duplicate history, new context version after checkpoint, restart recovery and identity mismatch rejection.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/__tests__/native-tool-compression.integration.test.ts`

- [ ] **Step 3: Add precise compaction classification**

Retain existing main/title behavior, but expose `isCompaction` from the DSH/OpenAI agent adapter using the existing compact header. Responses `/responses/compact` remains untouched and outside this feature.

- [ ] **Step 4: Reconstruct before forward and checkpoint after success**

Resolve trustworthy scope, read uncovered completed history, rebuild request messages, forward through the existing route, validate a 2xx compression result, then CAS checkpoint. If checkpoint persistence fails, return a retryable proxy error rather than claiming compression success with inconsistent state.

- [ ] **Step 5: Verify GREEN**

Run compression integration, handler tests, OpenAI integration and typecheck.

- [ ] **Step 6: Commit**

Commit: `feat(proxy): restore hidden native history for compression`

---

### Task 8: Final Boundaries, Documentation and Verification

**Files:**
- Modify as required: `README.md`, `README_CN.md`, `config.example.yaml`
- Modify tests only when a verified contract requires it.

- [ ] **Step 1: Add boundary regression tests**

Assert disabled Native mode exposes no proxy tools and no Fake fallback; Knowledge and Responses never receive Registry definitions; Provider blocks survive; logs and errors contain no Registry inputs/results/credentials; all 16 reserved names collide even when hidden.

- [ ] **Step 2: Update documentation**

Document the 6 Memory tools, Skill 0/4/10 exposure, Chat Completions support, conservative OpenAI round-end execution, Compression checkpoint behavior and explicit Knowledge/Responses exclusions. Do not add curl instructions.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm run typecheck
npx vitest run --silent=true
bash scripts/qa/__tests__/claude-native-batch.test.sh
git diff --check
```

Run the real ClickHouse state test with ignored local credentials. Confirm the isolated worktree is clean after the final commit and the original user-modified MemoryProxy files remain untouched.

- [ ] **Step 4: Commit**

Commit: `feat(proxy): complete native proxy tool phases 4 and 5`

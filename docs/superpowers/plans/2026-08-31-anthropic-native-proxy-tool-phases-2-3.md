# Anthropic Native Proxy Tool Phases 2 and 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Anthropic streaming Native Proxy Tool loop for `tdai_memory_search`, including end-of-round Client Tool dispatch, mixed-call reconstruction, reliable ClickHouse leases, restart recovery, and removal of every Native-project Fake Tool prompt path.

**Architecture:** Extend the existing Anthropic request adapter with a focused incremental SSE parser and route its protocol events into a standalone Tool Loop Coordinator. The coordinator persists message skeletons and ordered call slots through a narrow storage interface, executes Registry-owned calls through the in-process Memory Bridge, reconstructs client-visible or full upstream history, and re-enters the exact successful target without re-running injection or routing.

**Tech Stack:** TypeScript 5.8, Node.js 22, Hono, Web Streams, Vitest 3, `@clickhouse/client`, Anthropic Messages SSE, ClickHouse 25.12 Lightweight UPDATE.

**Spec:** `docs/superpowers/specs/2026-08-31-anthropic-native-proxy-tool-phases-2-3-design.md`

## Global Constraints

- Implement only Anthropic streaming Native Proxy Tool handling in this plan; non-streaming Anthropic requests must not receive Native Tool definitions.
- Register only `tdai_memory_search`, routed to Memory Bridge `atomic/search`, with read-only side-effect metadata.
- Never persist or log Authorization, API keys, service tokens, raw ForwardTarget credentials, or exception stacks.
- Native calls start only after the matching Anthropic `content_block_stop`; Client calls dispatch only after `message_stop`.
- A successful upstream SSE body has exactly one consumer; do not use `ReadableStream.tee()` on the successful path.
- Native Tool names, call IDs, input fragments, and results must never appear in a client-visible response.
- ClickHouse state writes are synchronous and fail closed; no in-process, Redis, or telemetry-buffer fallback is permitted in production.
- ClickHouse lease CAS requires Lightweight UPDATE plus `update_parallel_mode='sync'` and `update_sequential_consistency=1`.
- Read-only execution is at-least-once across lease expiry; result acceptance is exactly once.
- New backend filenames use `kebab-case.ts`.
- Preserve the user's existing root staged files, `eval_kit/`, and `docs/superpowers/plans/2026-08-31-native-proxy-tool-dataset-construction.md`.
- Execute inline in this session unless a genuinely independent review later justifies a subagent; no subagent may spawn descendants.

## File Map

### New production files

- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/types.ts` — JSON, registry, slot, snapshot, state, decision, and error types shared by this feature.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/tool-registry.ts` — stable Registry implementation and the `tdai_memory_search` definition.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/native-proxy-tools-injector.ts` — critical `tools.append` hook with visibility and collision checks.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/injection/adapters/anthropic-stream.ts` — SSE framing, incremental block assembly, unified events, and final snapshot.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/db/tool-execution-storage-adapter.ts` — storage interface and shared merge/expiry helpers.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/db/in-memory-tool-execution-storage-adapter.ts` — deterministic contract implementation used only by automated tests.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/db/clickhouse-tool-execution-storage-adapter.ts` — reliable ClickHouse DDL, probe, reads, CAS, lease, results, and TTL.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/native-proxy-tool-dispatcher.ts` — Registry validation, timeout, in-process Bridge execution, sanitization, and result limits.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/anthropic-response-rebuilder.ts` — raw replay, mixed-event filtering/index remapping, full assistant/result reconstruction.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/tool-loop-coordinator.ts` — unique stream consumer and per-round Native/Client orchestration.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/client-tool-resume.ts` — persisted Client Result matching, waiting, reclaiming, and internal re-entry readiness.
- `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/runtime.ts` — config-keyed Registry/storage/dispatcher assembly and startup capability readiness.

### New tests

- `src/__tests__/config-native-proxy-tools.test.ts`
- `src/native-proxy-tools/__tests__/tool-registry.test.ts`
- `src/injection/adapters/__tests__/anthropic-stream.test.ts`
- `src/db/__tests__/tool-execution-storage-contract.test.ts`
- `src/db/__tests__/clickhouse-tool-execution-storage-adapter.test.ts`
- `src/memory/__tests__/memory-bridge-executor.test.ts`
- `src/native-proxy-tools/__tests__/native-proxy-tool-dispatcher.test.ts`
- `src/native-proxy-tools/__tests__/anthropic-response-rebuilder.test.ts`
- `src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`
- `src/native-proxy-tools/__tests__/client-tool-resume.test.ts`
- `src/__tests__/anthropic-native-proxy-tool.integration.test.ts`
- `scripts/qa/__tests__/clickhouse-native-tool-state.integration.test.ts`

### Existing files modified or removed

- `src/types.ts`, `src/config.ts`, `config.example.yaml` — centralized config and validation.
- `src/injection/types.ts`, `src/injection/pipeline.ts`, `src/injection/index.ts` — critical hook support and structured Native Tool registration.
- `src/injection/adapters/interface.ts`, `src/injection/adapters/anthropic.ts` — expose the stream parser through the existing adapter.
- `src/memory/memory-bridge.ts` — extract the protocol-independent executor while retaining the HTTP wrapper.
- `src/anthropicHandler.ts` — resume pending Client results, replace successful-stream tee, create exact-target re-entry transport, and preserve observability.
- `src/index.ts` — initialize/shutdown the Native Tool runtime.
- `src/injection/injectors/tdai-profile-memory-injector.ts` — remove `<memory-tools-guide>`.
- `src/injection/injectors/skill-injector.ts` — retain only a curl-free catalog.
- `src/injection/injectors/skill-tools-injector.ts` — delete.
- `src/injection/injectors/tdai-tools-injector.ts` — delete.
- `src/injection/injectors/knowledge-tools-injector.ts` — delete until the later structured Knowledge implementation.
- `src/injection/__tests__/proxy-base-url.test.ts` — delete obsolete Fake Tool URL behavior.
- `src/server.ts`, `src/skill/skill-bridge.ts`, `src/memory/memory-bridge.ts` comments — describe Bridges as internal business boundaries, not model curl tools.
- `README.md`, `README_CN.md`, `config.example.yaml` — remove Fake Tool/curl guidance and document `nativeProxyTools`.
- `src/common/cc-request-classifier.ts`, `src/requestLog.ts`, `src/types.ts`, and a local ambient declaration if needed — minimal cleanup of existing typecheck blockers encountered by touched paths.

---

### Task 1: Centralized Configuration and Domain Types

**Files:**
- Create: `TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/types.ts`
- Create: `TencentDB-Agent-Memory-Native/MemoryProxy/src/__tests__/config-native-proxy-tools.test.ts`
- Modify: `TencentDB-Agent-Memory-Native/MemoryProxy/src/types.ts`
- Modify: `TencentDB-Agent-Memory-Native/MemoryProxy/src/config.ts`

**Interfaces:**
- Produces: `NativeProxyToolsConfig`, `JsonValue`, `ToolCallSlot`, `ToolExecutionScope`, `ToolExecutionStateKey`, `UpstreamRequestSnapshot`, `ToolExecutionContext`, `NativeToolResult`, `ToolLoopLimits`.
- Produces: `ProxyConfig.nativeProxyTools: NativeProxyToolsConfig` and matching `RawYamlConfig` input.
- Consumes: existing `ProxyConfig.clickhouse` credentials without duplicating them.

- [ ] **Step 1: Write failing config tests**

```ts
it("uses fail-safe Native Tool defaults", () => {
  expect(DEFAULT_CONFIG.nativeProxyTools).toEqual({
    enabled: false,
    maxRounds: 5,
    maxCallsPerRound: 8,
    maxTotalCalls: 20,
    toolTimeoutMs: 5000,
    maxResultBytes: 65536,
    stateTtlSeconds: 1800,
    stateStorage: {
      backend: "clickhouse",
      table: "native_proxy_tool_execution_state",
    },
  });
});

it("rejects an invalid table identifier and contradictory call limits", () => {
  expect(() => buildConfigWithYaml({
    nativeProxyTools: {
      enabled: true,
      maxCallsPerRound: 9,
      maxTotalCalls: 8,
      stateStorage: { backend: "clickhouse", table: "state; DROP TABLE x" },
    },
  })).toThrow(/nativeProxyTools/);
});
```

Define the test-local `buildConfigWithYaml` helper with `mkdtempSync`, `writeFileSync`, and `buildConfig({configFile})`; do not add a production-only config entry point for tests.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run src/__tests__/config-native-proxy-tools.test.ts`

Expected: FAIL because `nativeProxyTools` does not exist on `DEFAULT_CONFIG` or `ProxyConfig`.

- [ ] **Step 3: Add exact domain types**

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface NativeProxyToolsConfig {
  enabled: boolean;
  maxRounds: number;
  maxCallsPerRound: number;
  maxTotalCalls: number;
  toolTimeoutMs: number;
  maxResultBytes: number;
  stateTtlSeconds: number;
  stateStorage: {
    backend: "clickhouse";
    table: string;
  };
}

export interface ToolExecutionScope {
  spaceId: string;
  userId: string;
  agentSource: string;
  sessionId: string;
  contextVersion: string;
}

export interface ToolExecutionStateKey extends ToolExecutionScope {
  toolBatchId: string;
}
```

Define the remaining types exactly from the approved spec and keep all persisted fields JSON-serializable.

- [ ] **Step 4: Parse and validate config**

Add a bounded integer helper that throws a path-specific error instead of silently clamping:

```ts
function boundedInt(path: string, value: unknown, fallback: number, min: number, max: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || (resolved as number) < min || (resolved as number) > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}`);
  }
  return resolved as number;
}
```

Use ranges: rounds `1..20`, calls per round `1..64`, total calls `1..256`, timeout `100..600000`, result bytes `1024..1048576`, TTL `60..86400`. Validate the table with `/^[A-Za-z_][A-Za-z0-9_]*$/` and require total calls to be at least calls per round.

- [ ] **Step 5: Run focused tests and typecheck the touched modules**

Run: `npx vitest run src/__tests__/config-native-proxy-tools.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit --pretty false 2>&1 | tee /tmp/native-tool-typecheck-task1.log`

Expected: no new error mentioning `nativeProxyTools/types.ts`, `config-native-proxy-tools.test.ts`, `config.ts`, or the new config fields; record the known baseline errors separately.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/native-proxy-tools/types.ts src/__tests__/config-native-proxy-tools.test.ts src/types.ts src/config.ts
git commit -m "feat(proxy): add native tool configuration model"
```

### Task 2: Tool Registry, Structured Injection, and Collision Failure

**Files:**
- Create: `src/native-proxy-tools/tool-registry.ts`
- Create: `src/native-proxy-tools/native-proxy-tools-injector.ts`
- Create: `src/native-proxy-tools/__tests__/tool-registry.test.ts`
- Modify: `src/injection/types.ts`
- Modify: `src/injection/pipeline.ts`
- Modify: `src/injection/index.ts`
- Modify: `src/anthropicHandler.ts`

**Interfaces:**
- Consumes: `NativeProxyToolsConfig`, `AgentContext`, and `InjectionHook`.
- Produces: `NativeProxyToolDefinition`, `NativeProxyToolRegistry`, `createDefaultNativeProxyToolRegistry()`, `NativeProxyToolsInjector`.
- Produces: `InjectionHook.critical?: boolean`; critical hook failures propagate through `InjectionPipeline.process`.

- [ ] **Step 1: Write Registry and visibility tests**

```ts
it("registers exactly one read-only memory search tool", () => {
  const registry = createDefaultNativeProxyToolRegistry();
  expect(registry.list().map((tool) => tool.name)).toEqual(["tdai_memory_search"]);
  expect(registry.require("tdai_memory_search").effect).toBe("read");
  expect(registry.require("tdai_memory_search").route).toBe("atomic/search");
});

it.each([
  { stream: false, enabled: true, expected: 0 },
  { stream: true, enabled: false, expected: 0 },
  { stream: true, enabled: true, expected: 1 },
])("applies stream and config visibility", async ({ stream, enabled, expected }) => {
  const ctx = initializedAnthropicContext({ stream });
  const blocks = await new NativeProxyToolsInjector({ enabled, registry }).execute(ctx);
  expect(blocks).toHaveLength(expected);
});
```

Add cases for uninitialized Session, `chat_memory=false`, and a client-defined `tdai_memory_search` collision.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-registry.test.ts`

Expected: FAIL because the Registry and injector do not exist.

- [ ] **Step 3: Implement the Registry and schema validator**

```ts
export interface NativeProxyToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  owner: "proxy";
  effect: "read";
  route: "atomic/search";
  validate(input: unknown): { ok: true; value: Record<string, JsonValue> } | { ok: false; message: string };
}

export interface NativeProxyToolRegistry {
  list(): readonly NativeProxyToolDefinition[];
  get(name: string): NativeProxyToolDefinition | undefined;
  require(name: string): NativeProxyToolDefinition;
  owns(name: string): boolean;
}
```

The validator must reject arrays, null, unknown fields, empty/oversized queries, non-integer limits, and limits outside `1..20`; it must apply `limit=5` when omitted.

- [ ] **Step 4: Implement the critical `tools.append` hook**

Return one `custom` block with `metadata.tool_name` and `metadata.parameters`. Detect an existing client tool before returning and throw `NativeProxyToolNameCollisionError`. Add `critical?: boolean` to `InjectionHook`; in `InjectionPipeline`, rethrow errors from critical hooks instead of logging and continuing.

In `anthropicHandler.ts`, change the pipeline catch to return an Anthropic `invalid_request_error` when the error is a Native Tool collision or critical Native injection failure. It must not forward a request that silently lost the Native definition.

- [ ] **Step 5: Register the hook in the existing pipeline factory**

```ts
if (config.nativeProxyTools.enabled) {
  registry.register(new NativeProxyToolsInjector({
    enabled: true,
    registry: createDefaultNativeProxyToolRegistry(),
  }));
}
```

Include `nativeProxyTools` in the pipeline cache hash. Allow the pipeline to run when Native Tools are enabled even if the legacy `injection.enabled` flag is false, while still requiring initialized identity inside the hook.

- [ ] **Step 6: Run focused tests and relevant injection regression**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-registry.test.ts src/injection/adapters/__tests__/anthropic.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/native-proxy-tools src/injection/types.ts src/injection/pipeline.ts src/injection/index.ts src/anthropicHandler.ts
git commit -m "feat(proxy): inject registered native memory tool"
```

### Task 3: Incremental Anthropic SSE Parser

**Files:**
- Create: `src/injection/adapters/anthropic-stream.ts`
- Create: `src/injection/adapters/__tests__/anthropic-stream.test.ts`
- Modify: `src/injection/adapters/interface.ts`
- Modify: `src/injection/adapters/anthropic.ts`

**Interfaces:**
- Produces: `AnthropicStreamParser.push(chunk): ProtocolStreamEvent[]`, `AnthropicStreamParser.finish(): ProtocolStreamEvent[]`, `AnthropicStreamParser.snapshot(): AnthropicStreamSnapshot`.
- Produces: `ProtocolAdapter.createStreamParser?()` and `AnthropicAdapter.createStreamParser()`.
- Consumes: `NativeProxyToolRegistry.owns(name)` to classify proxy versus client calls.

- [ ] **Step 1: Add fixed SSE fixtures and RED tests**

```ts
it("waits for content_block_stop before completing a fragmented tool call", () => {
  const parser = new AnthropicStreamParser(registry);
  expect(parser.push(bytes(toolStart(0, "p1", "tdai_memory_search")))).not.toContainEqual(
    expect.objectContaining({ type: "tool_call_completed" }),
  );
  expect(parser.push(bytes(inputDelta(0, '{"query":"old'))).not.toContainEqual(
    expect.objectContaining({ type: "tool_call_completed" }),
  );
  expect(parser.push(bytes(inputDelta(0, ' rules"}'))).not.toContainEqual(
    expect.objectContaining({ type: "tool_call_completed" }),
  );
  expect(parser.push(bytes(blockStop(0)))).toContainEqual(expect.objectContaining({
    type: "tool_call_completed",
    call: expect.objectContaining({ callId: "p1", owner: "proxy", input: { query: "old rules" } }),
  }));
});
```

Add tests for UTF-8 split across chunks, CRLF, multi-line data, text, thinking/signature, Client Tool, Provider opaque block, malformed JSON at stop, and EOF without `message_stop`.

- [ ] **Step 2: Run the parser test and confirm RED**

Run: `npx vitest run src/injection/adapters/__tests__/anthropic-stream.test.ts`

Expected: FAIL because `anthropic-stream.ts` does not exist.

- [ ] **Step 3: Implement SSE framing**

Use a streaming `TextDecoder`, retain incomplete bytes/text, split events on blank lines supporting `\n\n` and `\r\n\r\n`, concatenate multiple `data:` lines with `\n`, and keep both original frame bytes and parsed JSON. Do not use a line regex that discards comments or `event:` fields.

- [ ] **Step 4: Implement block assembly and completion semantics**

Track blocks by protocol index. Merge only known deltas into their native fields; retain unknown deltas in an opaque event list. When a `tool_use` block stops, parse accumulated JSON once and emit either a completed call or a protocol call containing a structured parse error. Set `messageCompleted=true` only on `message_stop`.

- [ ] **Step 5: Expose the parser through the existing adapter**

```ts
export interface ProtocolAdapter {
  readonly protocol: Protocol;
  parse(body: Record<string, unknown>, metadata: AgentContextMetadata): AgentContext;
  serialize(ctx: AgentContext): Record<string, unknown>;
  createStreamParser?(registry: NativeProxyToolRegistry): ProtocolStreamParser;
}
```

Define `ProtocolStreamParser` in `interface.ts`; do not add a parallel top-level adapter registry.

- [ ] **Step 6: Run parser and existing Anthropic adapter tests**

Run: `npx vitest run src/injection/adapters/__tests__/anthropic-stream.test.ts src/injection/adapters/__tests__/anthropic.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/injection/adapters
git commit -m "feat(proxy): parse anthropic tool blocks incrementally"
```

### Task 4: Storage Contract and Deterministic In-Memory Adapter

**Files:**
- Create: `src/db/tool-execution-storage-adapter.ts`
- Create: `src/db/in-memory-tool-execution-storage-adapter.ts`
- Create: `src/db/__tests__/tool-execution-storage-contract.test.ts`

**Interfaces:**
- Produces: `ToolExecutionStorageAdapter` with `initializeAndProbe`, `create`, `get`, `findByCallId`, `findActiveBySession`, `compareAndSetStreamSnapshot`, `compareAndSetClientDispatchStatus`, `tryClaimSlotExecution`, `compareAndSetSlotResult`, and `markAborted`.
- Produces: `runToolExecutionStorageContract(createAdapter)` reused by ClickHouse tests.
- Consumes: domain state types from Task 1.

- [ ] **Step 1: Write the reusable storage contract**

```ts
export function runToolExecutionStorageContract(
  createAdapter: () => Promise<ToolExecutionStorageAdapter>,
): void {
  it("allows one concurrent lease owner", async () => {
    const adapter = await createAdapter();
    await adapter.create(pendingContext());
    const [a, b] = await Promise.all([
      adapter.tryClaimSlotExecution({
        key,
        callId: "p1",
        expectedRevision: 0,
        leaseOwner: "worker-a",
        leaseUntil,
      }),
      adapter.tryClaimSlotExecution({
        key,
        callId: "p1",
        expectedRevision: 0,
        leaseOwner: "worker-b",
        leaseUntil,
      }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
}
```

Include stream snapshot CAS conflicts, result exactly-once acceptance, Client dispatch CAS, unknown ID, logical expiry, expired lease reclaim, aborted streams, and a second Adapter instance reading shared state.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run src/db/__tests__/tool-execution-storage-contract.test.ts`

Expected: FAIL because the interface and Adapter do not exist.

- [ ] **Step 3: Implement exact storage signatures**

```ts
export interface ToolExecutionStorageAdapter {
  initializeAndProbe(): Promise<void>;
  create(context: ToolExecutionContext): Promise<void>;
  get(key: ToolExecutionStateKey): Promise<ToolExecutionContext | null>;
  findByCallId(scope: ToolExecutionScope, callId: string): Promise<ToolExecutionContext | null>;
  findActiveBySession(scope: ToolExecutionScope): Promise<ToolExecutionContext[]>;
  compareAndSetStreamSnapshot(update: StreamSnapshotCas): Promise<boolean>;
  compareAndSetClientDispatchStatus(update: ClientDispatchCas): Promise<boolean>;
  tryClaimSlotExecution(claim: SlotExecutionClaim): Promise<boolean>;
  compareAndSetSlotResult(update: SlotResultCas): Promise<boolean>;
  markAborted(key: ToolExecutionStateKey, expectedRevision: number): Promise<boolean>;
  close(): Promise<void>;
}
```

- [ ] **Step 4: Implement the in-memory Adapter with a per-key mutex**

Clone values on read and write. Serialize all changes for a key through a Promise-chain mutex. Enforce revision, owner, lease, expiry, and valid state transitions exactly as production expects; do not weaken the contract for easier tests.

- [ ] **Step 5: Run the contract**

Run: `npx vitest run src/db/__tests__/tool-execution-storage-contract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/db/tool-execution-storage-adapter.ts src/db/in-memory-tool-execution-storage-adapter.ts src/db/__tests__/tool-execution-storage-contract.test.ts
git commit -m "feat(proxy): define native tool state storage contract"
```

### Task 5: Reliable ClickHouse Storage Adapter

**Files:**
- Create: `src/db/clickhouse-tool-execution-storage-adapter.ts`
- Create: `src/db/__tests__/clickhouse-tool-execution-storage-adapter.test.ts`
- Create: `scripts/qa/__tests__/clickhouse-native-tool-state.integration.test.ts`

**Interfaces:**
- Consumes: `ToolExecutionStorageAdapter`, `ProxyConfig.clickhouse`, `NativeProxyToolsConfig.stateStorage`.
- Produces: `ClickHouseToolExecutionStorageAdapter`, `createToolExecutionStateTableDdl(table)`, and an injectable `ToolStateClickHouseClient` boundary.

- [ ] **Step 1: Write fake-client SQL and mapping tests**

```ts
it("uses revision predicates and strict update settings", async () => {
  const client = new RecordingClickHouseClient();
  const adapter = new ClickHouseToolExecutionStorageAdapter(config, { client });
  await adapter.compareAndSetClientDispatchStatus(clientDispatchUpdate());
  expect(client.commands.at(-1)?.query).toContain("revision = {expectedRevision:UInt64}");
  expect(client.commands.at(-1)?.query).toContain("update_parallel_mode = 'sync'");
  expect(client.commands.at(-1)?.query).toContain("update_sequential_consistency = 1");
});
```

Add tests for identifier rejection, DDL block-offset settings, query parameters, secret-free thrown messages, row decoding, expiry filter, and read-back token verification.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run src/db/__tests__/clickhouse-tool-execution-storage-adapter.test.ts`

Expected: FAIL because the ClickHouse Adapter does not exist.

- [ ] **Step 3: Implement reliable client setup and DDL**

Create a dedicated `@clickhouse/client` instance with the configured database and request timeout. Create the database through a bootstrap client when necessary. Create a MergeTree state table with `enable_block_number_column=1`, `enable_block_offset_column=1`, dynamic `TTL expires_at DELETE`, and the exact columns in the spec.

- [ ] **Step 4: Implement initialization probe**

Insert a random probe context expiring in 60 seconds, run a revision CAS with Lightweight UPDATE settings, read it back, and verify the probe token/revision. Throw `NativeToolStateCapabilityError` on any mismatch; never flip to an in-memory Adapter.

- [ ] **Step 5: Implement reads and bounded CAS retries**

Use query parameters for every value. Each mutation reads current state, merges the requested field with current slots, executes one revision-guarded UPDATE, then reads back and verifies its unique token. Retry revision conflicts at most five times. Lease acquisition returns true only when read-back shows the caller's lease token.

- [ ] **Step 6: Run unit tests and storage contract against a fake shared client**

Run: `npx vitest run src/db/__tests__/clickhouse-tool-execution-storage-adapter.test.ts src/db/__tests__/tool-execution-storage-contract.test.ts`

Expected: PASS.

- [ ] **Step 7: Add the opt-in real ClickHouse integration test**

The test must read connection settings only from environment variables, generate `native_proxy_tool_state_test_<random>`, run the full storage contract subset for concurrent claims and snapshot/result races, and drop exactly that validated table in `afterAll`.

Run: `NATIVE_TOOL_CLICKHOUSE_TEST=1 npx vitest run scripts/qa/__tests__/clickhouse-native-tool-state.integration.test.ts`

Expected: PASS when the local test environment is configured; otherwise the file reports a skipped test, not a false pass.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/db/clickhouse-tool-execution-storage-adapter.ts src/db/__tests__/clickhouse-tool-execution-storage-adapter.test.ts scripts/qa/__tests__/clickhouse-native-tool-state.integration.test.ts
git commit -m "feat(proxy): persist native tool state in clickhouse"
```

### Task 6: In-Process Memory Bridge and Native Dispatcher

**Files:**
- Create: `src/memory/__tests__/memory-bridge-executor.test.ts`
- Create: `src/native-proxy-tools/native-proxy-tool-dispatcher.ts`
- Create: `src/native-proxy-tools/__tests__/native-proxy-tool-dispatcher.test.ts`
- Modify: `src/memory/memory-bridge.ts`

**Interfaces:**
- Produces: `executeMemoryBridge(input: MemoryBridgeExecutionInput, deps?: MemoryBridgeDeps): Promise<MemoryBridgeExecutionResult>`.
- Produces: `NativeProxyToolDispatcher.execute(call, context): Promise<NativeToolResult>`.
- Consumes: Registry definition, trusted Session scope, existing fixed-asset resolution, MemoryCore fetcher, configured timeout/result bytes.

- [ ] **Step 1: Write executor parity tests**

```ts
it("overwrites model identity with trusted session identity", async () => {
  const result = await executeMemoryBridge({
    subpath: "atomic/search",
    body: { query: "rules", user_id: "attacker", team_id: "attacker" },
    sessionId: "session-1",
    spaceId: "space-1",
  }, depsWithInitializedSession());
  expect(lastUpstreamJson()).toMatchObject({ user_id: "user-1", team_id: "team-1", query: "rules" });
  expect(result.status).toBe(200);
});
```

Cover multi-agent search merge, uninitialized Session, disallowed subpath, and upstream failure.

- [ ] **Step 2: Confirm RED for the executor**

Run: `npx vitest run src/memory/__tests__/memory-bridge-executor.test.ts`

Expected: FAIL because only the Hono handler exists.

- [ ] **Step 3: Extract the protocol-independent Bridge core**

Move path/method/content-type parsing into the HTTP wrapper. Keep identity recovery, fixed asset resolution, upstream body construction, fan-out merge, telemetry, and response mapping in `executeMemoryBridge`. Make the HTTP wrapper translate its Request into `MemoryBridgeExecutionInput` and translate the result back into a `Response`.

- [ ] **Step 4: Write dispatcher RED tests**

```ts
it("returns a sanitized error without an exception stack", async () => {
  const dispatcher = dispatcherWithBridge(async () => { throw new Error("secret stack detail"); });
  const result = await dispatcher.execute(memoryCall(), trustedContext());
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.value)).not.toContain("secret stack detail");
  expect(result.value).toMatchObject({ code: "memory_bridge_unavailable", retryable: true });
});
```

Add schema rejection, default limit, timeout, business envelope error, and result size tests.

- [ ] **Step 5: Implement Dispatcher validation, timeout, mapping, and truncation**

Use the Registry validator before calling the Bridge. Use `AbortSignal.timeout(toolTimeoutMs)` and pass the signal through the Bridge fetch. Serialize the result to measure UTF-8 bytes. When oversized, return a bounded object containing `code`, `message`, `content_omitted=true`, `original_bytes`, and a safe UTF-8 preview within the configured limit.

- [ ] **Step 6: Run Bridge and Dispatcher tests**

Run: `npx vitest run src/memory/__tests__/memory-bridge-executor.test.ts src/native-proxy-tools/__tests__/native-proxy-tool-dispatcher.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/memory/memory-bridge.ts src/memory/__tests__/memory-bridge-executor.test.ts src/native-proxy-tools/native-proxy-tool-dispatcher.ts src/native-proxy-tools/__tests__/native-proxy-tool-dispatcher.test.ts
git commit -m "feat(proxy): execute native memory calls through bridge"
```

### Task 7: Client-Visible SSE and Full History Rebuilders

**Files:**
- Create: `src/native-proxy-tools/anthropic-response-rebuilder.ts`
- Create: `src/native-proxy-tools/__tests__/anthropic-response-rebuilder.test.ts`

**Interfaces:**
- Produces: `replayAnthropicBytes(snapshot)`, `buildClientVisibleAnthropicSse(snapshot, nativeIndexes)`, `buildFullAssistantMessage(snapshot)`, `buildToolResultMessage(slots)`.
- Consumes: Parser snapshot and ordered slots.

- [ ] **Step 1: Write raw replay and mixed filtering tests**

```ts
it("replays a pure Client Tool response byte for byte", () => {
  const snapshot = parseComplete(clientOnlyFixture);
  expect(replayAnthropicBytes(snapshot)).toEqual(clientOnlyFixture);
});

it("removes every native frame and remaps visible indexes", () => {
  const output = utf8(buildClientVisibleAnthropicSse(parseComplete(mixedFixture), new Set([0, 3])));
  expect(output).not.toContain("tdai_memory_search");
  expect(output).not.toContain("proxy-call-1");
  expect(visibleIndexes(output)).toEqual([0, 0, 0, 1, 1, 1]);
});
```

Add thinking/signature, Provider Block, multiple same-name calls, and invalid missing-`message_stop` cases.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run src/native-proxy-tools/__tests__/anthropic-response-rebuilder.test.ts`

Expected: FAIL because the rebuilder does not exist.

- [ ] **Step 3: Implement frame-aware filtering**

Filter parsed frames by content block ownership, not text matching. Rewrite only the `index` JSON field for visible Block lifecycle events. Preserve unrelated `event:`, comments, ping frames, message metadata, usage, and stop reason. Reject incomplete snapshots.

- [ ] **Step 4: Implement full message reconstruction**

```ts
export function buildToolResultMessage(slots: readonly ToolCallSlot[]): AnthropicUserMessage {
  return {
    role: "user",
    content: [...slots]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((slot) => ({
        type: "tool_result",
        tool_use_id: slot.callId,
        content: JSON.stringify(slot.result ?? null),
        ...(slot.isError ? { is_error: true } : {}),
      })),
  };
}
```

The assistant builder restores original complete blocks by `contentBlockIndex`, including opaque Provider blocks.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/native-proxy-tools/__tests__/anthropic-response-rebuilder.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/native-proxy-tools/anthropic-response-rebuilder.ts src/native-proxy-tools/__tests__/anthropic-response-rebuilder.test.ts
git commit -m "feat(proxy): rebuild anthropic tool responses safely"
```

### Task 8: Unique-Consumer Coordinator for No-Tool, Client-Only, and Native-Only Rounds

**Files:**
- Create: `src/native-proxy-tools/tool-loop-coordinator.ts`
- Create: `src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`

**Interfaces:**
- Produces: `AnthropicToolLoopCoordinator.handleRound(input): Promise<ToolLoopDecision>`.
- Consumes: Registry, parser, storage, dispatcher, rebuilder, limits, deterministic clock/id functions, and `reenter(body, target): Promise<UpstreamRound>`.
- Produces decisions: `replay`, `client_dispatch`, `final`, or `error`, plus round observations.

- [ ] **Step 1: Write no-tool and Client-only RED tests**

Use a `ReadableStream` whose `pull` increments a counter and throws if `getReader()` is requested twice. Assert the Coordinator consumes it once, waits for `message_stop`, and returns byte-identical replay without creating persistent state.

- [ ] **Step 2: Write Native timing and re-entry RED tests**

```ts
it("starts native execution after block stop and before message stop", async () => {
  const gates = controlledNativeStream();
  const promise = coordinator.handleRound(roundInput(gates.stream));
  gates.releaseThroughBlockStop();
  await eventually(() => expect(dispatcher.execute).toHaveBeenCalledTimes(1));
  expect(gates.messageStopReleased()).toBe(false);
  gates.releaseMessageStop();
  await promise;
});
```

Add successful result, structured tool error, first-request snapshot reuse, max calls per round, max total calls, max rounds, and abort-before-stop cases.

- [ ] **Step 3: Confirm RED**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`

Expected: FAIL because the Coordinator does not exist.

- [ ] **Step 4: Implement the single read loop and state transitions**

Read the upstream stream with one reader. Feed every chunk to the parser and process emitted events in order. On the first completed Native call, create state with all complete prior slots, persist snapshot, claim, and start Dispatcher execution without awaiting it. Track each execution Promise so Native-only rounds can await terminal persistence.

- [ ] **Step 5: Implement Native-only Internal Re-entry**

After `message_stop`, wait for all Native slots. Append `buildFullAssistantMessage` and `buildToolResultMessage` to the stored base messages. Re-enter with stored system/tools/request params and target. Carry `round`, `totalCalls`, and the same trace/turn identity. Never call Session Init, injection, routing, or request preparation from the Coordinator.

- [ ] **Step 6: Implement limits and abort behavior**

Check limits before execution. Return a buffered Anthropic error without emitting Native frames when exceeded. On incomplete EOF or read failure, CAS state to aborted, skip re-entry, and allow already-started read-only executions to settle only into the aborted batch.

- [ ] **Step 7: Run focused tests**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/native-proxy-tools/tool-loop-coordinator.ts src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts
git commit -m "feat(proxy): coordinate native anthropic tool rounds"
```

### Task 9: Mixed Client Dispatch, Result Merge, and Restart Recovery

**Files:**
- Create: `src/native-proxy-tools/client-tool-resume.ts`
- Create: `src/native-proxy-tools/__tests__/client-tool-resume.test.ts`
- Modify: `src/native-proxy-tools/tool-loop-coordinator.ts`
- Modify: `src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`

**Interfaces:**
- Produces: `extractAnthropicClientToolResults(body)`, `resumeClientToolResults(input): Promise<ClientToolResumeDecision>`.
- Consumes: Tool execution scope, storage, Dispatcher, full-history builders, exact-target re-entry transport.
- Extends Coordinator with `client_dispatch` decisions and persisted dispatch CAS.

- [ ] **Step 1: Write mixed generation RED tests**

Create fixture order `P1, C1, C2, P2` and completion order `P1, P2, C2, C1`. Assert Client output contains only C1/C2 at continuous indexes and full upstream re-entry order remains P1/C1/C2/P2.

- [ ] **Step 2: Write Client-first and restart RED tests**

```ts
it("waits when Client results arrive before the running Native result", async () => {
  const state = mixedState({ nativeStatus: "running", clientStatus: "pending" });
  await storage.create(state);
  const resume = resumeClientToolResults(resumeInput(clientResults("c1", "c2")));
  await eventually(() => expect(storageResult("c1")).toBeDefined());
  expect(reenter).not.toHaveBeenCalled();
  await completeNativeSlot(storage, "p1");
  await resume;
  expect(reenter).toHaveBeenCalledTimes(1);
});
```

Instantiate a second Adapter object over the same test backend to simulate restart. Add lease-not-expired wait, lease-expired reclaim, duplicate Client Result, unknown call ID within a known batch, cross-scope call ID, expired batch, and concurrent update tests.

- [ ] **Step 3: Confirm RED**

Run: `npx vitest run src/native-proxy-tools/__tests__/client-tool-resume.test.ts src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`

Expected: FAIL because Client resume and mixed dispatch are absent.

- [ ] **Step 4: Implement mixed dispatch at `message_stop`**

Persist the final skeleton, set Client status `pending`, CAS it to `dispatched`, and return the filtered/reindexed SSE without waiting for Native execution. If dispatch CAS proves it was already dispatched, return a deterministic conflict decision rather than silently sending a second new batch.

- [ ] **Step 5: Implement result matching and state fill**

Normalize `tool_result.content` without losing text-block arrays. Reject duplicate call IDs in one request. Resolve all known IDs in one trusted scope and require one batch. CAS each Client slot from pending to succeeded/failed.

- [ ] **Step 6: Implement wait and read-only reclaim**

Poll storage with an injectable bounded interval until Native slots finish or tool timeout elapses. Do not reclaim an unexpired running lease. For pending/expired read-only slots, claim with a new worker token and execute using persisted input. When all slots are terminal, rebuild and re-enter once.

- [ ] **Step 7: Run mixed and recovery tests**

Run: `npx vitest run src/native-proxy-tools/__tests__/client-tool-resume.test.ts src/native-proxy-tools/__tests__/tool-loop-coordinator.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```bash
git add src/native-proxy-tools/client-tool-resume.ts src/native-proxy-tools/tool-loop-coordinator.ts src/native-proxy-tools/__tests__
git commit -m "feat(proxy): merge mixed tool results across requests"
```

### Task 10: Runtime Assembly and Anthropic Handler Integration

**Files:**
- Create: `src/native-proxy-tools/runtime.ts`
- Create: `src/__tests__/anthropic-native-proxy-tool.integration.test.ts`
- Modify: `src/anthropicHandler.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `getNativeProxyToolRuntime(config)`, `initializeNativeProxyToolRuntime(config)`, `shutdownNativeProxyToolRuntime()`.
- Produces handler-local exact-target transport that accepts persisted `UpstreamRequestSnapshot` and appended messages.
- Consumes all Task 1–9 interfaces.

- [ ] **Step 1: Write handler integration RED tests with mocked fetch**

```ts
it("uses the injected first request and exact successful target for re-entry", async () => {
  const calls = installAnthropicFetchSequence(nativeCallFixture, finalTextFixture);
  const response = await app.request("/claude-code/space-1/v1/messages", requestWithInitializedSession());
  await expect(response.text()).resolves.toContain("final answer");
  expect(calls).toHaveLength(2);
  expect(calls[1].url).toBe(calls[0].url);
  expect(calls[1].body.system).toEqual(calls[0].body.system);
  expect(calls[1].body.tools).toEqual(calls[0].body.tools);
});
```

Add single-consumer detection, zero leakage, Client-only delayed replay, mixed Client-first flow, enabled=false no Native/Fake Tool, and initial retry target reuse.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run src/__tests__/anthropic-native-proxy-tool.integration.test.ts`

Expected: FAIL because the Handler still tees successful streams and has no runtime.

- [ ] **Step 3: Assemble config-keyed runtime**

Create one Registry, one ClickHouse Adapter, one Dispatcher, and readiness Promise per stable config hash. Initialization awaits `initializeAndProbe`. Disabled config returns a lightweight disabled runtime without opening ClickHouse. Shutdown closes only the state Adapter it owns.

- [ ] **Step 4: Intercept pending Client Results before normal upstream forwarding**

After auth/Session identity recovery and before sending the current body upstream, extract Tool Results and query the state store. If no known batch exists, continue the old path. If a known batch exists, use `resumeClientToolResults` and return its re-entry response; do not re-run injection or routing for the persisted first request.

- [ ] **Step 5: Replace the successful streaming tee path**

Pass `upstreamResp.body` directly to the Coordinator. Build the first `UpstreamRequestSnapshot` from the already prepared, actually sent body. If the initial request used retry, snapshot the successful retry URL/model/body. Return the Coordinator's replay/client/final/error response with the successful round's response headers.

- [ ] **Step 6: Implement exact-target re-entry transport**

In-process re-entry retains the actual successful headers in a closure. Persist only target ID/url/model/auth-source metadata. Restart recovery reconstructs permitted auth from current config and validates URL/model against the snapshot; if it cannot match, return `native_tool_target_unavailable` and never call `resolveForwardTarget` to select a substitute.

- [ ] **Step 7: Preserve observability without a second upstream consumer**

Feed each completed in-memory round snapshot to a new observation helper rather than teeing the network stream. Intermediate hidden rounds record Generation/tool timing but skip L0 and Skill extraction. Only the final user-visible logical response runs per-turn writeback. Keep the same Langfuse turn trace and increment internal Generation observations.

- [ ] **Step 8: Initialize and close runtime from process lifecycle**

When enabled, await capability readiness before a request can inject Native Tools. Shutdown closes the state client after pending read-only writes settle. Failure remains visible in health/logs and causes Native-enabled requests to return 503.

- [ ] **Step 9: Run handler integration and existing Anthropic tests**

Run: `npx vitest run src/__tests__/anthropic-native-proxy-tool.integration.test.ts src/__tests__/anthropicHandler.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit Task 10**

```bash
git add src/native-proxy-tools/runtime.ts src/__tests__/anthropic-native-proxy-tool.integration.test.ts src/anthropicHandler.ts src/index.ts
git commit -m "feat(proxy): close anthropic native tool loop"
```

### Task 11: Remove Fake Tool Paths and Update Public Configuration

**Files:**
- Delete: `src/injection/injectors/skill-tools-injector.ts`
- Delete: `src/injection/injectors/tdai-tools-injector.ts`
- Delete: `src/injection/injectors/knowledge-tools-injector.ts`
- Delete: `src/injection/__tests__/proxy-base-url.test.ts`
- Modify: `src/injection/index.ts`
- Modify: `src/injection/injectors/tdai-profile-memory-injector.ts`
- Modify: `src/injection/injectors/skill-injector.ts`
- Modify: `src/injection/injectors/asset-reflection-injector.ts`
- Modify: `src/injection/agents/claude-code/index.ts`
- Modify: `src/injection/agents/codebuddy/profile.ts`
- Modify: `src/server.ts`
- Modify: `src/skill/skill-bridge.ts`
- Modify: `src/memory/memory-bridge.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `config.example.yaml`
- Modify: `README.md`
- Modify: `README_CN.md`

**Interfaces:**
- Consumes: `nativeProxyTools` behavior from Tasks 1–10.
- Produces: a Native-only project with no prompt/curl fallback and accurate operator documentation.

- [ ] **Step 1: Add RED assertions for removed prompt tags**

Extend Registry/injection tests so an enabled pipeline output contains `tdai_memory_search` in `tools[]` and contains none of:

```ts
expect(serializedSystem).not.toMatch(/<tdai_memory_tools>|<memory-tools-guide>|<skill_tools>|<knowledge_tools>/);
expect(serializedSystem).not.toMatch(/Bash\s*\+\s*curl|skill-bridge.*curl|memory-bridge.*curl/i);
```

Add an enabled=false case that contains neither Native nor Fake Tool definitions.

- [ ] **Step 2: Confirm RED against current injectors**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-registry.test.ts src/injection/__tests__/proxy-base-url.test.ts`

Expected: FAIL because the current pipeline still registers curl recipe injectors.

- [ ] **Step 3: Delete Fake Tool injectors and registrations**

Remove imports, exports, registrations, proxy base URL derivation, asset reflection Fake tag logic, and the obsolete URL test. Do not delete Memory/Skill Bridge business routes; remove only their model-facing curl role and stale comments.

- [ ] **Step 4: Make remaining catalogs truthful**

Remove `MEMORY_TOOLS_GUIDE` from Profile Memory. Rewrite Skill catalog copy so it does not mention curl or an unavailable Skill Native Tool; when the Skill Native Tool family is absent, emit only neutral asset context or no catalog instruction. Remove Knowledge injection entirely for this phase rather than leaving a half-Fake block.

- [ ] **Step 5: Remove obsolete config and document Native configuration**

Delete `injection.externalGatewayUrl` from types/parser/example. Add the exact `nativeProxyTools` YAML block and document streaming-only `tdai_memory_search`, ClickHouse fail-closed behavior, lease semantics, enabled=false behavior, and absence of Fake fallback in both READMEs.

- [ ] **Step 6: Run tests and targeted residue scan**

Run: `npx vitest run src/native-proxy-tools/__tests__/tool-registry.test.ts src/injection/adapters/__tests__/anthropic.test.ts`

Expected: PASS.

Run:

```bash
rg -n '<tdai_memory_tools>|<memory-tools-guide>|<skill_tools>|<knowledge_tools>|Bash \+ curl|curl-recipe' src README.md README_CN.md config.example.yaml
```

Expected: no matches. Operational examples such as `curl /health` are outside these forbidden patterns and remain valid.

- [ ] **Step 7: Commit Task 11**

```bash
git add -A src/injection src/server.ts src/skill/skill-bridge.ts src/memory/memory-bridge.ts src/types.ts src/config.ts config.example.yaml README.md README_CN.md
git commit -m "refactor(proxy): remove fake tool prompt fallback"
```

### Task 12: Typecheck Baseline Cleanup and Full Verification

**Files:**
- Modify only as proven necessary: `src/common/cc-request-classifier.ts`, `src/requestLog.ts`, `src/types.ts`, `src/storage/factory.ts`, `src/**/*.d.ts`
- Verify all files changed by Tasks 1–11.

**Interfaces:**
- Produces: a clean test/typecheck result or a precisely isolated optional-private-dependency diagnostic.
- Consumes: every prior task deliverable.

- [ ] **Step 1: Capture full RED/GREEN baseline comparison**

Run: `npm test`

Expected: all original 14 tests plus all new tests PASS.

Run: `npm run typecheck`

Expected before minimal cleanup: only errors already captured during initial exploration or errors introduced by the new implementation; classify each by file and cause.

- [ ] **Step 2: Fix the four source-level baseline type errors with minimal edits**

- Widen the Claude Code handler's request-kind variable to the Agent Adapter's actual `RequestKind`, or map `auxiliary` explicitly to the existing side-query behavior without changing runtime routing.
- Add the actual optional `traceId` field to the request log type if `codexHandler.ts` already emits it; do not remove runtime data to satisfy TypeScript.
- Add `memCommand` to `RawYamlConfig` using `Partial<MemCommandConfig>`.
- For the optional private `@context-proxy/cost-guard` module, add a narrow ambient declaration exposing only `openKernelStsCosBackend`, or adjust the dynamic import typing without introducing a runtime stub.

- [ ] **Step 3: Run typecheck until clean**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 4: Run the full automated suite**

Run: `npm test`

Expected: all tests PASS with zero unhandled rejection.

Run: `npm run typecheck`

Expected: PASS.

Run: `bash scripts/qa/__tests__/claude-native-batch.test.sh`

Expected: PASS.

- [ ] **Step 5: Run real ClickHouse capability and concurrency verification**

Load the existing Native local proxy YAML without printing credentials, export its ClickHouse values only into the child test process, and run:

```bash
NATIVE_TOOL_CLICKHOUSE_TEST=1 npx vitest run scripts/qa/__tests__/clickhouse-native-tool-state.integration.test.ts
```

Expected: PASS, including one valid lease owner under concurrent claims and cleanup of the unique temporary table.

- [ ] **Step 6: Run final leakage and diff checks**

```bash
rg -n '<tdai_memory_tools>|<memory-tools-guide>|<skill_tools>|<knowledge_tools>|Bash \+ curl|curl-recipe' src README.md README_CN.md config.example.yaml
git diff --check
git status --short
```

Expected: no forbidden Fake Tool guidance, no whitespace errors, and only intended Native submodule changes.

- [ ] **Step 7: Commit verification cleanup**

```bash
git add src package.json package-lock.json
git commit -m "test(proxy): verify native tool streaming recovery"
```

If package files did not change, omit them from `git add`. Do not create an empty commit.

- [ ] **Step 8: Update the superproject gitlink only**

From `/home/liukuan/Tencent-DB-Memory-Project`:

```bash
git add TencentDB-Agent-Memory-Native
git commit --only -m "feat: advance native proxy tool implementation" -- TencentDB-Agent-Memory-Native
```

Confirm that the user's pre-existing staged documentation and untracked `eval_kit/` tree remain unchanged.

## Execution Checkpoints

- After Task 3: Adapter fixtures prove protocol-boundary correctness before orchestration exists.
- After Task 5: storage contract and real capability probe prove the ClickHouse premise before Handler integration.
- After Task 8: pure Native streaming loop works without mixed cross-request state.
- After Task 10: end-to-end Anthropic Handler flow works with structured tools and exact-target re-entry.
- After Task 11: Native project has no Fake Tool fallback.
- After Task 12: full tests, typecheck, ClickHouse concurrency test, residue scan, and git diff are clean.

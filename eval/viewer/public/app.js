const state = { experiment: null, summary: null, cases: [], selected: null };

const byId = (id) => document.getElementById(id);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function format(value, style = "number") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (style === "percent") return `${(Number(value) * 100).toFixed(1)}%`;
  if (style === "ms") return `${Math.round(Number(value))} ms`;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

async function api(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function card(label, value, tone) {
  const element = node("article", `metric-card ${tone ?? ""}`);
  element.append(node("span", "metric-label", label), node("strong", "metric-value", value));
  return element;
}

function renderHeadline() {
  const target = byId("headline");
  target.replaceChildren();
  const overall = state.summary?.overall ?? {};
  target.append(
    card("Total Runs", format(state.summary?.total_runs)),
    card("Case Pass", format(overall.case_pass_rate, "percent"), "good"),
    card("Tool Precision", format(overall.tool_micro_precision, "percent")),
    card("Tool Recall", format(overall.tool_micro_recall, "percent")),
    card("Trace Complete", `${format(overall.trace_complete_runs)} / ${format(overall.runs)}`),
  );
}

const metricRows = [
  ["Case Pass Rate", "case_pass_rate", "percent", false],
  ["Task Pass Rate", "task_pass_rate", "percent", false],
  ["Effective Call Rate", "effective_call_rate", "percent", false],
  ["False Call Rate", "false_call_rate", "percent", true],
  ["Tool Micro Precision", "tool_micro_precision", "percent", false],
  ["Tool Micro Recall", "tool_micro_recall", "percent", false],
  ["Selection Accuracy", "tool_selection_accuracy", "percent", false],
  ["Argument Accuracy", "argument_accuracy", "percent", false],
  ["Provider Input Tokens · mean", "provider_input_tokens", "number", true],
  ["Provider Output Tokens · mean", "provider_output_tokens", "number", true],
  ["Provider Total Tokens · mean", "provider_total_tokens", "number", true],
  ["Definition Tokens · mean", "definition_tokens", "number", true],
  ["LLM Calls · mean", "llm_calls", "number", true],
  ["Tool Calls · mean", "tool_calls", "number", true],
  ["Duplicate Tool Calls", "duplicate_tool_calls", "number", true],
  ["Internal Re-entry · mean", "internal_reentry_rounds", "number", true],
  ["TTFT · mean", "ttft_ms", "ms", true],
  ["End-to-End · mean", "end_to_end_ms", "ms", true],
  ["Tool Latency · mean", "tool_latency_ms", "ms", true],
];

function scalar(metrics, key) {
  const value = metrics?.[key];
  return value && typeof value === "object" ? value.mean : value;
}

function renderMetrics() {
  const table = byId("metrics");
  table.replaceChildren();
  const head = node("thead");
  const row = node("tr");
  for (const title of ["Metric", "Baseline", "Native", "Δ"]) row.append(node("th", "", title));
  head.append(row);
  const body = node("tbody");
  const baseline = state.summary?.variants?.baseline ?? {};
  const native = state.summary?.variants?.native ?? {};
  for (const [label, key, style, lowerIsBetter] of metricRows) {
    const baseValue = scalar(baseline, key);
    const nativeValue = scalar(native, key);
    const delta = baseValue === null || baseValue === undefined || nativeValue === null || nativeValue === undefined ? null : Number(nativeValue) - Number(baseValue);
    const tr = node("tr");
    tr.append(node("td", "metric-name", label), node("td", "", format(baseValue, style)), node("td", "", format(nativeValue, style)));
    const deltaCell = node("td", "delta", delta === null ? "—" : `${delta > 0 ? "+" : ""}${format(delta, style)}`);
    if (delta !== null && delta !== 0) deltaCell.classList.add((lowerIsBetter ? delta < 0 : delta > 0) ? "positive" : "negative");
    tr.append(deltaCell);
    body.append(tr);
  }
  table.append(head, body);
}

function renderFailureDistribution() {
  const target = byId("failure-distribution");
  target.replaceChildren();
  const entries = Object.entries(state.summary?.failure_distribution ?? {}).sort((left, right) => Number(right[1]) - Number(left[1]));
  if (entries.length === 0) {
    target.append(node("p", "failure-empty", "No failures in this experiment."));
    return;
  }
  const maximum = Math.max(...entries.map(([, count]) => Number(count)), 1);
  for (const [label, count] of entries) {
    const item = node("div", "failure-bar");
    const meter = node("progress", "failure-meter");
    meter.max = maximum;
    meter.value = Math.max(0, Number(count));
    item.append(node("span", "", label), node("strong", "", count), meter);
    target.append(item);
  }
}

function setFailureOptions() {
  const select = byId("failure");
  const current = select.value;
  select.replaceChildren(new Option("All", ""));
  const failures = [...new Set(state.cases.flatMap((item) => item.failure_tags ?? []))].sort();
  for (const failure of failures) select.append(new Option(failure, failure));
  select.value = failures.includes(current) ? current : "";
}

function filteredCases() {
  const failed = byId("failed").checked;
  const variant = byId("variant").value;
  const status = byId("status-filter").value;
  const family = byId("family").value;
  const failure = byId("failure").value;
  return state.cases.filter((item) => {
    if (failed && item.metrics?.case_pass) return false;
    if (variant && item.variant !== variant) return false;
    if (status && item.status !== status) return false;
    if (family && item.tool_family !== family) return false;
    if (failure && !(item.failure_tags ?? []).includes(failure)) return false;
    return true;
  });
}

function badge(text, tone) { return node("span", `badge ${tone ?? ""}`, text); }

function renderCases() {
  const items = filteredCases();
  byId("case-count").textContent = `${items.length} / ${state.cases.length}`;
  const list = byId("case-list");
  list.replaceChildren();
  if (items.length === 0) {
    list.append(node("p", "empty-list", "没有符合当前筛选条件的 Run"));
    return;
  }
  for (const item of items) {
    const button = node("button", `case-row ${state.selected === item.run_id ? "selected" : ""}`);
    button.type = "button";
    const status = node("span", `status ${item.metrics?.case_pass ? "pass" : "fail"}`, item.metrics?.case_pass ? "✓" : "×");
    const copy = node("span", "case-copy");
    copy.append(node("strong", "", item.case_id), node("small", "", item.run_id));
    const tags = node("span", "case-tags");
    tags.append(badge(item.variant, item.variant));
    for (const failure of (item.failure_tags ?? []).slice(0, 2)) tags.append(badge(failure, "failure"));
    button.append(status, copy, tags);
    button.addEventListener("click", () => showRun(item.run_id));
    list.append(button);
  }
}

function section(title, value, folded = false) {
  const details = node("details", "trace-section");
  details.open = !folded;
  details.append(node("summary", "", title));
  const pre = node("pre");
  pre.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  details.append(pre);
  return details;
}

function safeHttpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function renderTimeline(run) {
  const timeline = node("div", "timeline");
  timeline.append(
    section("Input", run.case?.query ?? "", false),
    section("Expected", {
      should_call: run.case?.should_call,
      expected_tools: run.case?.expected_tools ?? [],
      argument_assertions: run.case?.argument_assertions ?? [],
      answer_assertions: run.case?.answer_assertions ?? [],
    }, false),
    section("Raw client request", run.raw_request, true),
  );
  const events = [
    ...(run.model_calls ?? []).map((call, index) => ({ type: "model", call, index, time: Date.parse(call.started_at ?? ""), fallback: index * 2 })),
    ...(run.tool_calls ?? []).map((call, index) => ({ type: "tool", call, index, time: Date.parse(call.started_at ?? ""), fallback: index * 2 + 1 })),
  ].sort((left, right) => {
    if (Number.isFinite(left.time) && Number.isFinite(right.time)) return left.time - right.time;
    if (Number.isFinite(left.time)) return -1;
    if (Number.isFinite(right.time)) return 1;
    return left.fallback - right.fallback;
  });
  for (const event of events) {
    const { call, index } = event;
    if (event.type === "model") {
      const item = node("article", "timeline-item");
      item.append(node("span", "timeline-index", String(index + 1)), node("h3", "", `Model Call #${index + 1}`));
      item.append(section("Injected request", call.input, true));
      if (call.thinking) item.append(section("Thinking metadata", call.thinking, true));
      item.append(section("Model output", call.output, false));
      timeline.append(item);
      continue;
    }
    const item = node("article", "timeline-item tool");
    item.append(node("span", "timeline-index", `T${index + 1}`), node("h3", "", call.logical_name));
    item.append(section("Arguments", call.arguments, false), section("Tool result", call.result, true));
    if (call.error) item.append(section("Tool error", call.error, false));
    timeline.append(item);
  }
  timeline.append(section("Final answer", run.final_answer ?? "", false));
  return timeline;
}

async function showRun(runId) {
  state.selected = runId;
  renderCases();
  const placeholder = byId("detail-placeholder");
  const detail = byId("detail");
  placeholder.hidden = true;
  detail.hidden = false;
  detail.replaceChildren(node("p", "loading", "Loading trace…"));
  try {
    const run = await api(`/api/experiments/${encodeURIComponent(state.experiment)}/runs/${encodeURIComponent(runId)}`);
    detail.replaceChildren();
    const header = node("div", "detail-heading");
    const title = node("div");
    title.append(node("p", "eyebrow", run.variant), node("h2", "", run.case_id));
    const badges = node("div", "detail-badges");
    badges.append(badge(run.status, run.status));
    for (const failure of run.failure_tags ?? []) badges.append(badge(failure, "failure"));
    header.append(title, badges);
    detail.append(header);
    const langfuseUrl = safeHttpUrl(run.trace?.langfuse_url);
    if (langfuseUrl) {
      const link = node("a", "langfuse-link", "Open Langfuse trace ↗");
      link.href = langfuseUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      detail.append(link);
    }
    const score = node("div", "score-grid");
    score.append(card("Case Pass", run.metrics?.case_pass ? "PASS" : "FAIL", run.metrics?.case_pass ? "good" : "bad"));
    score.append(card("Task", format(run.metrics?.task_pass, "percent")));
    score.append(card("Tools", `${(run.metrics?.actual_tools ?? []).join(", ") || "none"}`));
    score.append(card("Re-entry", format(run.metrics?.internal_reentry_rounds)));
    score.append(card("E2E", format(run.latency?.end_to_end_ms, "ms")));
    detail.append(score, renderTimeline(run));
    if (run.error) detail.append(section("Run error", run.error, false));
    detail.append(section("Metrics", run.metrics, true), section("Artifact references", run.trace?.artifacts ?? {}, true));
  } catch (error) {
    detail.replaceChildren(node("p", "error", error.message));
  }
}

async function loadExperiment(id) {
  state.experiment = id;
  state.selected = null;
  const [summary, cases] = await Promise.all([
    api(`/api/experiments/${encodeURIComponent(id)}/summary`),
    api(`/api/experiments/${encodeURIComponent(id)}/cases`),
  ]);
  state.summary = summary;
  state.cases = cases.items ?? [];
  byId("dashboard").hidden = false;
  byId("empty").hidden = true;
  byId("detail").hidden = true;
  byId("detail-placeholder").hidden = false;
  setFailureOptions();
  renderHeadline();
  renderMetrics();
  renderFailureDistribution();
  renderCases();
}

async function boot() {
  try {
    const experiments = await api("/api/experiments");
    const picker = byId("experiment");
    picker.replaceChildren();
    if (experiments.length === 0) {
      const empty = byId("empty");
      empty.hidden = false;
      empty.textContent = "results 目录中还没有完整实验。";
      return;
    }
    for (const experiment of experiments) picker.append(new Option(experiment.experiment_id, experiment.experiment_id));
    picker.addEventListener("change", () => loadExperiment(picker.value));
    byId("filters").addEventListener("change", renderCases);
    await loadExperiment(picker.value);
  } catch (error) {
    const empty = byId("empty");
    empty.hidden = false;
    empty.textContent = `Viewer failed: ${error.message}`;
  }
}

boot();

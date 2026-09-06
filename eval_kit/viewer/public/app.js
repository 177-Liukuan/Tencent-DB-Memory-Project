import { initDataset } from "./dataset.js";
import { initReview } from "./review.js";

const state = { experiment: "", suite: "", data: null, pairs: [], page: 1, load: 0, detail: 0, view: "dataset" };
const PAGE_SIZE = 25;
const labels = { correct: "符合预期", missed: "未调用", wrong_tool: "选择不符", false_call: "误调用", invalid: "采集异常", damaged: "文件异常", pending: "待运行" };
const suites = { main: "主评测", smoke: "冒烟测试", probe: "探针测试", reliability: "可靠性测试" };
const byId = (id) => document.getElementById(id);
function node(tag, className = "", text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  // Query、模型回答及工具名一律当文本展示，不能让实验内容变成页面脚本。
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}
const finite = (value) => typeof value === "number" && Number.isFinite(value);
function format(value, unit = "number") {
  if (!finite(value)) return "—";
  if (unit === "rate") return `${(value * 100).toFixed(1)}%`;
  if (unit === "time") return `${(value / 1000).toFixed(2)} s`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function delta(value, unit, lowerIsBetter) {
  const el = node("span", "delta", "—");
  if (!finite(value)) return el;
  el.textContent = `${value > 0 ? "+" : ""}${value.toFixed(1)}${unit}`;
  if (value !== 0) el.classList.add((lowerIsBetter ? value < 0 : value > 0) ? "good" : "bad");
  return el;
}
function badge(outcome) { return node("span", `badge ${outcome}`, labels[outcome] ?? "未安排"); }
async function api(path) {
  const response = await fetch(path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `读取失败（${response.status}）`);
  return body;
}
function address(suffix) { return `/api/experiments/${encodeURIComponent(state.experiment)}/${suffix}`; }
function notice(message) {
  byId("notice").hidden = !message;
  byId("notice").textContent = message;
}
function updateUrl(pair) {
  const params = new URLSearchParams();
  params.set("view", state.view);
  if (state.experiment) params.set("experiment", state.experiment);
  if (state.suite) params.set("suite", state.suite);
  if (pair) { params.set("case", pair.case_id); params.set("repeat", pair.repeat); }
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function renderMetrics() {
  const { baseline: b, native: n, paired_latency: p } = state.data.summary;
  const target = byId("metrics"); target.replaceChildren();
  for (const [label, key, lower] of [["有效调用率", "effective_call_rate", false], ["误调用率", "false_call_rate", true], ["工具选择正确率", "tool_selection_accuracy", false], ["端到端延迟", "latency", true]]) {
    const latency = key === "latency";
    const base = latency ? p.baseline_mean_ms : b[key];
    const native = latency ? p.native_mean_ms : n[key];
    const card = node("article", "metric-card");
    const title = node("div", "metric-label", label); title.append(node("small", "", latency ? "有效配对均值" : lower ? "越低越好" : "越高越好"));
    const values = node("div", "metric-values");
    for (const [name, value] of [["Baseline", base], ["Native", native]]) {
      const cell = node("div", `${name.toLowerCase()}-label`);
      cell.append(node("small", "", name), node("strong", "", format(value, latency ? "time" : "rate"))); values.append(cell);
    }
    const foot = node("div", "metric-foot");
    const change = latency ? p.native_change_percent : finite(base) && finite(native) ? (native - base) * 100 : null;
    foot.append(delta(change, latency ? "%" : " 个百分点", lower), node("span", "", " · Native 相对 Baseline"));
    card.append(title, values, foot);
    card.append(node("p", "metric-foot", latency ? `${p.cases} 个配对任务 · ${p.pairs} 对运行` : key === "effective_call_rate" ? `正样本 B ${b.positive_samples} / N ${n.positive_samples}` : key === "false_call_rate" ? `负样本 B ${b.negative_samples} / N ${n.negative_samples}` : `已调用正样本 B ${b.called_positive_samples} / N ${n.called_positive_samples}`));
    target.append(card);
  }
  const table = byId("breakdown"); table.replaceChildren();
  const head = node("thead"); const hr = node("tr");
  for (const title of ["指标", "Baseline", "Native"]) hr.append(node("th", "", title)); head.append(hr); table.append(head);
  const body = node("tbody");
  const row = (label, base, native, unit) => {
    const tr = node("tr"); tr.append(node("td", "", label), node("td", "", format(base, unit)), node("td", "", format(native, unit))); body.append(tr);
  };
  row("有效运行数", b.valid_samples, n.valid_samples);
  row("采集异常（不计入指标）", b.invalid_runs, n.invalid_runs);
  row("未完成最终回答（不计延迟）", b.incomplete_runs, n.incomplete_runs);
  for (const family of ["memory", "skill"]) {
    for (const [label, key, unit] of [["正样本数", "positive_samples"], ["有效调用率", "effective_call_rate", "rate"], ["误调用率", "false_call_rate", "rate"], ["工具选择正确率", "tool_selection_accuracy", "rate"]]) {
      row(`${family === "memory" ? "Memory" : "Skill"} · ${label}`, b.by_tool_family[family][key], n.by_tool_family[family][key], unit);
    }
  }
  row("全部有效任务 · 平均耗时（非配对）", b.end_to_end_ms.mean, n.end_to_end_ms.mean, "time");
  row("全部有效任务 · 中位耗时", b.end_to_end_ms.median, n.end_to_end_ms.median, "time");
  row("全部有效任务 · P95 耗时", b.end_to_end_ms.p95, n.end_to_end_ms.p95, "time");
  table.append(body);
}

function makePairs(items) {
  const pairs = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.case_id, item.repeat]);
    if (!pairs.has(key)) pairs.set(key, { case_id: item.case_id, repeat: item.repeat });
    pairs.get(key)[item.variant] = item;
  }
  return [...pairs.values()].sort((a, b) => a.case_id.localeCompare(b.case_id) || a.repeat - b.repeat);
}
function filteredPairs() {
  const search = byId("search").value.trim().toLocaleLowerCase();
  const family = byId("family").value;
  const outcome = byId("outcome").value;
  return state.pairs.filter(pair => {
    const runs = [pair.baseline, pair.native].filter(Boolean);
    if (search && !runs.some(r => [r.case_id, r.run_id, r.query, ...r.actual_tools].join(" ").toLocaleLowerCase().includes(search))) return false;
    if (family && !runs.some(r => r.tool_family === family)) return false;
    if (outcome && !runs.some(r => outcome === "attention" ? ["missed", "wrong_tool", "false_call", "invalid", "damaged"].includes(r.outcome) : r.outcome === outcome)) return false;
    return true;
  });
}
function runCell(run, variant) {
  const cell = node("span", "run-cell");
  cell.append(node("span", `mobile-label ${variant}-label`, variant === "native" ? "Native" : "Baseline"));
  if (!run) { cell.append(node("span", "muted", "未安排")); return cell; }
  const top = node("span", "run-top");
  top.append(badge(run.outcome), node("span", "run-time", format(run.end_to_end_ms, "time")));
  const tools = node("span", "tool-preview", run.actual_tools.join(" → ") || (["pending", "damaged", "invalid"].includes(run.outcome) ? "无有效观测结果" : "未观测到工具调用"));
  tools.title = tools.textContent;
  cell.append(top, tools); return cell;
}
function renderCases() {
  const pairs = filteredPairs();
  const pages = Math.max(1, Math.ceil(pairs.length / PAGE_SIZE)); state.page = Math.min(state.page, pages);
  byId("case-count").textContent = `${pairs.length} / ${state.pairs.length} 个任务 × 重复编号`;
  byId("page-label").textContent = `${state.page} / ${pages} 页`;
  byId("prev").disabled = state.page <= 1; byId("next").disabled = state.page >= pages;
  const list = byId("case-list"); list.replaceChildren();
  if (!pairs.length) { list.append(node("p", "empty-list", "没有符合筛选条件的任务")); return; }
  for (const pair of pairs.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE)) {
    const row = node("button", "case-row"); row.type = "button";
    row.setAttribute("aria-label", `${pair.case_id} · 第 ${pair.repeat} 次 · 查看对比`);
    const sample = pair.baseline?.query ? pair.baseline : pair.native ?? pair.baseline;
    const copy = node("span", "case-copy");
    copy.append(node("strong", "", pair.case_id), node("span", "query-preview", sample.query || "结果尚未就绪"), node("small", "muted", `第 ${pair.repeat} 次 · ${sample.should_call === undefined ? "预期待结果生成" : sample.should_call ? "应调用工具" : "不应调用工具"}`));
    const b = pair.baseline; const n = pair.native;
    const change = b?.observation_valid && n?.observation_valid && b.end_to_end_ms > 0 && finite(n.end_to_end_ms) ? (n.end_to_end_ms - b.end_to_end_ms) / b.end_to_end_ms * 100 : null;
    const diff = delta(change, "%", true); diff.prepend(node("span", "mobile-label", "耗时变化 "));
    row.append(copy, runCell(b, "baseline"), runCell(n, "native"), diff);
    row.addEventListener("click", () => showPair(pair)); list.append(row);
  }
}

function section(title, value, folded = true, className = "") {
  const el = node("details", "detail-section"); el.open = !folded;
  el.append(node("summary", "", title), node("pre", className, typeof value === "string" ? value : JSON.stringify(value, null, 2)));
  return el;
}
function detailColumn(run, variant, error) {
  const el = node("article", "variant-detail");
  const header = node("div", "variant-header"); header.append(node("h3", `${variant}-label`, variant === "native" ? "Native · 真工具" : "Baseline · Fake Tool"), badge(run?.outcome)); el.append(header);
  if (error) { el.append(node("p", "error", error)); return el; }
  if (!run || ["pending", "damaged"].includes(run.outcome)) {
    el.append(node("p", "muted", run?.outcome === "damaged" ? "结果文件损坏或与清单不符，请检查后刷新。" : run ? "该运行尚未生成结果。" : "实验清单中未安排这一组。")); return el;
  }
  const stats = node("div", "detail-stats"); stats.append(node("span", "", `端到端 ${format(run.end_to_end_ms, "time")}`), node("span", "", `${run.actual_tools.length} 次调用`), node("span", "", run.completed ? "已完成回答" : "未完成回答")); el.append(stats);
  if (!run.observation_valid) el.append(node("p", "error", `本次采集无效，不计入指标。${run.error ?? ""}`));
  else if (!run.completed) el.append(node("p", "muted", `工具调用记录有效；最终任务未完成，不计入端到端延迟。${run.error ?? ""}`));
  el.append(node("p", "muted", "Bridge 接收顺序 · 不代表业务执行成功"));
  const calls = node("ol", "call-list");
  run.actual_tools.forEach((tool, index) => {
    const call = run.tool_calls?.[index]; const item = node("li");
    item.append(node("strong", "", `${index + 1}. ${tool}`));
    if (call) {
      item.append(node("small", "", `${new Date(call.timestamp).toISOString().slice(11, 23)} UTC · ${call.tool_family}`));
      item.append(node("small", "", `Call ID：${call.call_id ?? "Baseline 未提供"}`));
    } else item.append(node("small", "", "此记录未包含事件明细"));
    calls.append(item);
  });
  if (!run.actual_tools.length) el.append(node("p", "muted", run.observation_valid ? "未观测到 Memory / Skill 调用。" : "无有效调用记录；不能据此判定模型未调用。"));
  else el.append(calls);
  el.append(section("最终回答", run.final_answer ?? "未记录最终回答", false, "answer"));
  el.append(section("本次运行信息", { run_id: run.run_id, session_id: run.session_id, seed_version: run.seed_version, ...run.identity, started_at: run.started_at, ended_at: run.ended_at }));
  if (run.tool_calls) el.append(section("Bridge 事件 JSON", run.tool_calls));
  return el;
}
async function showPair(pair) {
  const ticket = ++state.detail;
  const dialog = byId("case-dialog"); const body = byId("detail-body");
  byId("detail-title").textContent = `${pair.case_id} · 第 ${pair.repeat} 次`;
  body.replaceChildren(node("p", "loading", "正在读取调用详情…"));
  if (!dialog.open) dialog.showModal(); updateUrl(pair);
  // 详情与实验切换分别编号，慢响应不能覆盖后来选中的案例，也不能重新打开已关闭的窗口。
  const results = await Promise.all(["baseline", "native"].map(async variant => {
    const run = pair[variant];
    if (!run || ["pending", "damaged"].includes(run.outcome)) return { variant, run };
    try { return { variant, run: await api(address(`runs/${encodeURIComponent(run.run_id)}`)) }; }
    catch (error) { return { variant, run, error: error.message }; }
  }));
  if (ticket !== state.detail || !dialog.open) return;
  body.replaceChildren();
  const sample = results.find(r => r.run?.query)?.run;
  if (sample) {
    const input = node("div", "case-input"); input.append(node("h3", "", "任务与预期"), node("p", "", sample.query));
    const rule = sample.allowed_sequences ? { allowed_sequences: sample.allowed_sequences } : sample.expected_tool_sequence ? { expected_tool_sequence: sample.expected_tool_sequence } : sample.allowed_first_tools ? { allowed_first_tools: sample.allowed_first_tools } : { expected_tools: sample.expected_tools };
    input.append(section(sample.should_call ? "应调用工具 · 选择规则" : "不应调用 Memory / Skill 工具", { should_call: sample.should_call, ...rule })); body.append(input);
  }
  const grid = node("div", "detail-grid"); for (const result of results) grid.append(detailColumn(result.run, result.variant, result.error)); body.append(grid);
}

async function loadExperiment(id, suite = "") {
  const ticket = ++state.load;
  byId("case-dialog").close(); ++state.detail;
  state.experiment = id; state.suite = suite; state.data = null; state.page = 1;
  byId("loading").hidden = false; byId("loading").textContent = "正在读取实验…";
  byId("dashboard").hidden = true; byId("empty").hidden = true; notice("");
  try {
    const data = await api(address(`overview${suite ? `?suite=${encodeURIComponent(suite)}` : ""}`));
    if (ticket !== state.load) return;
    state.data = data; state.suite = data.selected_suite; state.pairs = makePairs(data.items);
    byId("suite").replaceChildren(...data.suites.map(s => new Option(suites[s] ?? s, s)));
    byId("suite").value = data.selected_suite; byId("model").textContent = data.model;
    const p = data.progress;
    byId("progress").textContent = `全实验：${p.recorded} / ${p.planned} 次运行已记录${p.pending ? ` · ${p.pending} 次待运行` : ""}`;
    if (p.invalid || p.damaged) notice(`${p.invalid} 次采集异常，${p.damaged} 个结果文件异常。它们未计入指标；缺失或损坏文件的分组尚无法确定，暂列在每个分组中供检查。`);
    else if (p.pending) notice("评测尚未全部完成，当前指标是已有结果的阶段统计。待运行项目尚无分组信息，暂列在每个分组中。");
    byId("dashboard").hidden = false; renderMetrics(); renderCases(); updateUrl();
  } catch (error) {
    if (ticket !== state.load) return;
    notice(`加载失败：${error.message} 可点击“刷新结果”重试。`);
  } finally { if (ticket === state.load) byId("loading").hidden = true; }
}
async function refresh() {
  byId("refresh").disabled = true;
  try {
    const experiments = await api("/api/experiments");
    const picker = byId("experiment"); picker.replaceChildren(...experiments.map(e => new Option(e.experiment_id, e.experiment_id)));
    if (!experiments.length) {
      ++state.load; state.data = null; state.experiment = ""; state.suite = ""; byId("case-dialog").close();
      byId("dashboard").hidden = true; byId("empty").hidden = false; byId("loading").hidden = true; notice("");
      byId("empty").textContent = "还没有 Bridge 观测实验。完成数据准备并运行评测后，点击刷新即可查看。"; return;
    }
    const id = experiments.some(e => e.experiment_id === state.experiment) ? state.experiment : experiments[0].experiment_id;
    picker.value = id; await loadExperiment(id, id === state.experiment ? state.suite : "");
  } catch (error) { ++state.load; byId("dashboard").hidden = true; byId("loading").hidden = true; notice(`加载失败：${error.message}`); }
  finally { byId("refresh").disabled = false; }
}
function clearFilters() {
  byId("filters").reset(); state.page = 1; if (state.data) renderCases();
}
byId("experiment").addEventListener("change", () => { clearFilters(); void loadExperiment(byId("experiment").value); });
byId("suite").addEventListener("change", () => { clearFilters(); void loadExperiment(state.experiment, byId("suite").value); });
byId("refresh").addEventListener("click", refresh);
byId("filters").addEventListener("submit", e => e.preventDefault());
byId("filters").addEventListener("input", () => { state.page = 1; if (state.data) renderCases(); });
byId("clear").addEventListener("click", clearFilters);
byId("prev").addEventListener("click", () => { state.page--; renderCases(); });
byId("next").addEventListener("click", () => { state.page++; renderCases(); });
byId("close-detail").addEventListener("click", () => byId("case-dialog").close());
byId("case-dialog").addEventListener("close", () => { ++state.detail; updateUrl(); });
byId("case-dialog").addEventListener("click", e => {
  const box = e.currentTarget.getBoundingClientRect();
  if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) e.currentTarget.close();
});
const initial = new URLSearchParams(location.search);
state.experiment = initial.get("experiment") ?? ""; state.suite = initial.get("suite") ?? "";
const dataset = initDataset();
const review = initReview();
async function selectView(view) {
  if (state.view === "review") {
    if (!review.canLeave()) return;
    review.discard();
  }
  state.view = view;
  for (const name of ["dataset", "review", "results"]) {
    byId(`${name}-view`).hidden = name !== view;
    if (name === view) byId(`nav-${name}`).setAttribute("aria-current", "page");
    else byId(`nav-${name}`).removeAttribute("aria-current");
  }
  updateUrl();
  if (view === "dataset") await dataset.load();
  else if (view === "review") await review.load();
  else if (!state.data) await refresh();
}
for (const view of ["dataset", "review", "results"]) byId(`nav-${view}`).addEventListener("click", e => {
  // 修饰键点击仍遵循链接的原生行为，便于单独打开另一页。
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault(); void selectView(view);
});
// 外部打开和刷新统一进入结果页；其他页面通过站内导航切换。
await selectView("results");
const initialPair = state.pairs.find(p => p.case_id === initial.get("case") && String(p.repeat) === (initial.get("repeat") ?? "1"));
if (state.view === "results" && state.data && initialPair) await showPair(initialPair);

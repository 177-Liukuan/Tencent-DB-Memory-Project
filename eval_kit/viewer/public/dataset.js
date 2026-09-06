const byId = id => document.getElementById(id);
const familyNames = { memory: "Memory", skill: "Skill", none: "None · 无需工具", knowledge: "Knowledge", unknown: "未标注" };
const familyDescriptions = { memory: "云端记忆", skill: "可复用技能", none: "无需 Proxy Tool", knowledge: "团队知识", unknown: "缺少类别标签" };
const pageSize = 20;
let data, page = 1;
function node(tag, className = "", text) {
  const el = document.createElement(tag); el.className = className;
  // 数据集文本可能包含代码和 HTML 示例；只展示文字，不执行其中的标记。
  if (text !== undefined) el.textContent = String(text);
  return el;
}
const familyClass = name => Object.hasOwn(familyNames, name) ? name : "unknown";
const number = value => value.toLocaleString("zh-CN");
function pill(text, name = "") { return node("span", `dataset-pill ${name}`, text); }
function options(id, entries, labels) {
  const select = byId(id), previous = select.value, first = select.options[0];
  select.replaceChildren(first, ...entries.map(({ name, count }) => new Option(`${labels[name] ?? name} · ${count}`, name)));
  select.value = entries.some(e => e.name === previous) ? previous : "";
}
function filterBy(id, value) {
  const control = byId(id); control.value = control.value === value ? "" : value;
  page = 1; renderList();
}
function renderStats() {
  const s = data.summary;
  byId("dataset-stats").replaceChildren(...[
    ["任务总数", s.tasks, "当前任务文件中的全部任务", "01"],
    ["应调用工具", s.positive, "should_call = true", "02"],
    ["不应调用工具", s.negative, "should_call = false", "03"],
    ["覆盖场景", s.scenarios, `${s.assets} 份素材 · ${s.memory_sessions} 份记忆来源 · ${s.skills} 个 Skill 引用`, "04"],
  ].map(([title, value, sub, index]) => {
    const card = node("article", "dataset-stat"), heading = node("div", "stat-heading", title);
    heading.append(node("span", "stat-index", index));
    card.append(heading, node("strong", "stat-value", number(value)), node("p", "stat-note", sub)); return card;
  }));
}
function renderCharts() {
  const { families, scenarios, tools } = data.distributions;
  const total = data.summary.tasks;
  const svgNode = (name, attrs) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
  };
  const svg = svgNode("svg", { viewBox: "0 0 200 200", "aria-hidden": "true", class: "donut" });
  svg.append(svgNode("circle", { cx: 100, cy: 100, r: 78, class: "donut-track" }));
  let offset = 0;
  const legend = byId("dataset-families"); legend.replaceChildren();
  for (const { name, count } of families) {
    const share = total ? count / total * 100 : 0;
    svg.append(svgNode("circle", { cx: 100, cy: 100, r: 78, pathLength: 100,
      "stroke-dasharray": `${Math.max(0, share - 1.5)} ${100 - Math.max(0, share - 1.5)}`,
      "stroke-dashoffset": -offset, class: `donut-segment ${familyClass(name)}` }));
    offset += share;
    const button = node("button", `legend-button ${familyClass(name)}`); button.type = "button";
    button.dataset.family = name;
    const copy = node("span", "legend-copy");
    copy.append(node("strong", "", familyNames[name] ?? name), node("small", "", familyDescriptions[name] ?? ""));
    const value = node("span", "legend-value"); value.append(node("strong", "", count), node("small", "", `${share.toFixed(1)}%`));
    button.append(node("span", `color-dot ${familyClass(name)}`), copy, value);
    button.addEventListener("click", () => filterBy("dataset-family", name)); legend.append(button);
  }
  const center = node("div", "donut-center"); center.append(node("strong", "", number(total)), node("span", "", "全部任务"));
  byId("dataset-donut").replaceChildren(svg, center);
  byId("dataset-balance").textContent = `应调用 ${data.summary.positive} 条 / 不应调用 ${data.summary.negative} 条 · 按 should_call 统计`;
  byId("scenario-count").textContent = `${data.summary.scenarios} 个已标注场景`;
  byId("dataset-scenarios").replaceChildren(...scenarios.map(({ name, count }) => {
    const button = node("button", "scenario-button"); button.type = "button"; button.dataset.scenario = name;
    const label = node("span", "scenario-label", name === "unknown" ? "未标注" : name); label.title = label.textContent;
    const bar = node("progress"); bar.max = Math.max(1, ...scenarios.map(s => s.count)); bar.value = count; bar.setAttribute("aria-hidden", "true");
    button.append(label, bar, node("span", "scenario-value", count));
    button.addEventListener("click", () => filterBy("dataset-scenario", name)); return button;
  }));
  // 两张类别图使用同一份全量统计，筛选只改变下方任务列表。
  const maxFamilyCount = Math.max(1, ...families.map(f => f.count));
  byId("dataset-family-counts").replaceChildren(...families.map(({ name, count }) => {
    const button = node("button", `family-count-button ${familyClass(name)}`); button.type = "button"; button.dataset.family = name;
    const track = node("span", "family-count-track"), fill = node("span", "family-count-fill");
    fill.style.width = `${count / maxFamilyCount * 100}%`; track.setAttribute("aria-hidden", "true"); track.append(fill);
    button.append(node("span", "family-count-label", familyNames[name] ?? name), track, node("strong", "", count));
    button.addEventListener("click", () => filterBy("dataset-family", name)); return button;
  }));
  byId("dataset-tools").replaceChildren(...tools.map(({ name, count }) => {
    const chip = node("span", "tool-chip"); chip.append(node("span", "", name), node("strong", "", count)); return chip;
  }));
  if (!tools.length) byId("dataset-tools").append(node("span", "muted", "未设置预期工具"));
  options("dataset-family", families, familyNames); options("dataset-scenario", scenarios, { unknown: "未标注" });
}
function renderList() {
  const search = byId("dataset-search").value.trim().toLocaleLowerCase();
  const family = byId("dataset-family").value, scenario = byId("dataset-scenario").value;
  const items = data.items.filter(item => (!family || (item.tool_family ?? "unknown") === family)
    && (!scenario || (item.scenario_id ?? "unknown") === scenario)
    && (!search || [item.case_id, item.query, item.scenario_id, ...item.expected_tools,
      ...item.candidate_skills ?? [], ...item.expected_skills ?? [], ...item.tags ?? []].join(" ").toLocaleLowerCase().includes(search)));
  const pages = Math.max(1, Math.ceil(items.length / pageSize)); page = Math.min(page, pages);
  byId("dataset-count").textContent = `${number(items.length)} / ${number(data.items.length)} 条任务`;
  byId("dataset-page").textContent = `${page} / ${pages} 页`;
  byId("dataset-prev").disabled = page <= 1; byId("dataset-next").disabled = page >= pages;
  for (const [selector, key, selected] of [[".legend-button, .family-count-button", "family", family], [".scenario-button", "scenario", scenario]]) {
    document.querySelectorAll(selector).forEach(button => button.setAttribute("aria-pressed", String(button.dataset[key] === selected)));
  }
  const list = byId("dataset-list"); list.replaceChildren();
  if (!items.length) { list.append(node("p", "empty-list", "没有符合条件的任务，试试其他关键词或重置筛选。")); return; }
  for (const item of items.slice((page - 1) * pageSize, page * pageSize)) {
    const row = node("button", "dataset-row"); row.type = "button"; row.setAttribute("aria-label", `${item.case_id} · 查看任务详情`);
    const copy = node("span", "dataset-copy"); copy.append(node("strong", "", item.case_id), node("span", "dataset-query", item.query));
    const tags = node("span", "dataset-row-tags"); tags.append(pill(familyNames[item.tool_family ?? "unknown"], familyClass(item.tool_family)));
    const expected = node("span", "dataset-expected"); expected.append(node("span", "", item.scenario_id ?? "未标注场景"), node("small", "", item.should_call ? item.expected_tools.join(" · ") : "不应调用 Proxy Tool"));
    row.append(copy, tags, expected, node("span", "row-arrow", "↗"));
    row.addEventListener("click", () => showTask(item)); list.append(row);
  }
}
function detailSection(title, value, folded = false) {
  const section = node("details", "detail-section"); section.open = !folded;
  section.append(node("summary", "", title), node("pre", "", typeof value === "string" ? value : JSON.stringify(value, null, 2))); return section;
}
function showTask(item) {
  const body = byId("dataset-detail-body"); byId("dataset-detail-title").textContent = item.case_id;
  const meta = node("div", "task-meta"); meta.append(pill(familyNames[item.tool_family ?? "unknown"], familyClass(item.tool_family)), pill(item.scenario_id ?? "未标注场景"), pill(item.should_call ? "预期：调用工具" : "预期：不调用工具"));
  const query = node("section", "task-query"); query.append(node("h3", "", "用户输入"), node("p", "", item.query));
  body.replaceChildren(meta, query);
  if (item.reason?.trim()) {
    const reason = node("section", "task-reason");
    reason.append(node("h3", "", "标注理由"), node("p", "", item.reason));
    body.append(reason);
  }
  // 保留规则的原意：允许多条顺序与单条完整顺序不是同一回事，不能统一压成工具集合。
  if (item.should_call) {
    const [title, rule] = item.allowed_sequences ? ["允许的调用顺序（任选一条）", item.allowed_sequences]
      : item.expected_tool_sequence ? ["预期调用顺序", item.expected_tool_sequence]
      : item.allowed_first_tools ? ["允许的首个工具", item.allowed_first_tools] : ["预期工具", item.expected_tools];
    body.append(detailSection(title, rule));
  } else body.append(node("p", "task-negative", "这条任务的标签为不应调用工具；该标签不表示模型的实际表现。"));
  const resources = node("div", "task-resources");
  for (const [title, value] of [["素材项目", item.asset_path], ["来源记忆", item.source_memory_sessions], ["候选 Skill", item.candidate_skills], ["预期 Skill", item.expected_skills], ["预期 Skill 文件", item.expected_skill_files], ["目标记忆", item.target_memory_refs]]) {
    if (value && (!Array.isArray(value) || value.length)) resources.append(detailSection(title, value));
  }
  body.append(resources);
  if (item.tags?.length) { const tags = node("div", "task-meta"); tags.append(...item.tags.map(tag => pill(tag))); body.append(tags); }
  body.append(detailSection("完整任务数据（含参数、答案检查规则）", item, true));
  byId("dataset-dialog").showModal();
}
async function refresh() {
  byId("dataset-refresh").disabled = true; byId("dataset-loading").hidden = false;
  byId("dataset-notice").hidden = true; byId("dataset-content").hidden = true;
  byId("dataset-dialog").close();
  try {
    const response = await fetch("/api/dataset", { signal: AbortSignal.timeout(15000) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "数据集读取失败");
    data = body; page = 1;
    byId("dataset-source").textContent = data.source.name;
    byId("dataset-updated").textContent = `文件更新于 ${new Date(data.source.updated_at).toLocaleString("zh-CN", { hour12: false })}`;
    renderStats(); renderCharts(); renderList(); byId("dataset-content").hidden = false;
  } catch (error) {
    data = null; byId("dataset-source").textContent = "数据集不可用"; byId("dataset-updated").textContent = "";
    byId("dataset-notice").textContent = `${error.message} 可点击“刷新数据”重试。`; byId("dataset-notice").hidden = false;
  } finally { byId("dataset-refresh").disabled = false; byId("dataset-loading").hidden = true; }
}
export function initDataset() {
  window.addEventListener("dataset-changed", () => { data = null; });
  byId("dataset-refresh").addEventListener("click", refresh);
  byId("dataset-filters").addEventListener("submit", e => e.preventDefault());
  byId("dataset-filters").addEventListener("input", () => { if (data) { page = 1; renderList(); } });
  byId("dataset-clear").addEventListener("click", () => { byId("dataset-filters").reset(); if (data) { page = 1; renderList(); } });
  byId("dataset-prev").addEventListener("click", () => { page--; renderList(); });
  byId("dataset-next").addEventListener("click", () => { page++; renderList(); });
  byId("dataset-close").addEventListener("click", () => byId("dataset-dialog").close());
  byId("dataset-dialog").addEventListener("click", e => {
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) e.currentTarget.close();
  });
  return { load: () => data ? Promise.resolve() : refresh() };
}

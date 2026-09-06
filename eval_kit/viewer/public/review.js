const $ = id => document.getElementById(id);
const textNode = (tag, cls, text) => {
  const el = document.createElement(tag); el.className = cls;
  if (text !== undefined) el.textContent = text; // 任务和文档内容只作文本，不执行 HTML。
  return el;
};
const names = { memory: "Memory", skill: "Skill", none: "None", knowledge: "Knowledge" };
let data, draft, original, dirty = false, busy = false, rawDirty = false, previewBody;
const mode = item => item.allowed_sequences ? "sequences" : item.expected_tool_sequence?.length ? "sequence" : item.allowed_first_tools ? "first" : "legacy";
function notice(message = "") { $("review-notice").textContent = message; $("review-notice").hidden = !message; }
async function api(path, body, method = "POST") {
  const response = await fetch(path, body === undefined ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "请求失败"); return result;
}
function setDirty() {
  dirty = rawDirty || JSON.stringify(draft) !== original;
  $("review-dirty").textContent = dirty ? "有未保存修改" : "未修改";
  $("review-dirty").classList.toggle("is-dirty", dirty);
}
function syncJson() { $("review-json").value = JSON.stringify(draft, null, 2); rawDirty = false; setDirty(); }
function canLeave() { return !busy && (!dirty || confirm("有未保存的修改，确定放弃并离开当前任务吗？")); }
function filtered() {
  const query = $("review-search").value.trim().toLowerCase(), family = $("review-family-filter").value;
  const reason = $("review-reason-filter").value, scenario = $("review-scenario-filter").value;
  return (data?.items ?? []).filter(t => (!family || t.tool_family === family) && (!scenario || t.scenario_id === scenario)
    && (!reason || (reason === "filled") === !!t.reason?.trim())
    && (!query || [t.case_id, t.query, t.reason ?? ""].join(" ").toLowerCase().includes(query)));
}
function renderList() {
  const items = filtered(); $("review-count").textContent = `${items.length} / ${data.items.length}`;
  $("review-reason-count").textContent = `已填写理由 ${data.items.filter(t => t.reason?.trim()).length} / ${data.items.length} · 不代表已审核通过`;
  $("review-list").replaceChildren(...items.map(item => {
    const button = textNode("button", "review-task", undefined); button.type = "button";
    button.setAttribute("aria-pressed", String(item.case_id === draft?.case_id));
    button.append(textNode("strong", "", item.case_id), textNode("span", "review-task-query", item.query),
      textNode("small", "muted", `${names[item.tool_family] ?? "未指定"} · ${item.reason?.trim() ? "已填理由" : "未填理由"}`));
    button.addEventListener("click", () => { if (item.case_id !== draft?.case_id && canLeave()) choose(item); }); return button;
  }));
  if (!items.length) $("review-list").append(textNode("p", "muted", "没有匹配任务，可调整筛选条件。"));
  const index = items.findIndex(t => t.case_id === draft?.case_id);
  $("review-prev").disabled = index <= 0; $("review-next").disabled = index < 0 || index >= items.length - 1;
}
function choose(item) {
  draft = structuredClone(item); original = JSON.stringify(draft); rawDirty = false; dirty = false;
  $("review-empty").hidden = true; $("review-form").hidden = false;
  renderForm(); renderList();
}
function renderForm() {
  $("review-task-id").textContent = draft.case_id;
  $("review-query").value = draft.query; $("review-reason").value = draft.reason ?? "";
  $("review-family").value = draft.tool_family ?? ""; $("review-should-call").value = String(draft.should_call);
  $("review-suite").value = draft.suite; $("review-rule-mode").value = mode(draft);
  $("review-rule-mode").disabled = !draft.should_call;
  syncJson(); renderSelection();
}
function clearRules() {
  for (const key of ["expected_tool", "expected_tools", "allowed_first_tools", "expected_tool_sequence", "allowed_sequences"]) delete draft[key];
}
function renderSelection() {
  const target = $("review-selected-tools"); target.replaceChildren();
  const selected = draft.allowed_first_tools ?? [];
  if (!draft.should_call) target.append(textNode("span", "muted", "不应调用任何资产工具"));
  else if (mode(draft) === "first") {
    if (!selected.length) target.append(textNode("span", "muted", "请从右侧选择一个或多个首个工具"));
    for (const tool of selected) {
      const chip = textNode("button", "review-tool-chip", `${tool} ×`); chip.type = "button";
      chip.addEventListener("click", () => toggle(tool)); target.append(chip);
    }
  } else target.append(textNode("pre", "review-rule-value", JSON.stringify(draft.allowed_sequences ?? draft.expected_tool_sequence ?? draft.expected_tools ?? draft.expected_tool, null, 2)));
  $("review-rule-help").textContent = mode(draft) === "first"
    ? "允许任选一个作为首次 Proxy Tool；不是要求全部调用。"
    : "保留当前规则与顺序。修改序列请展开完整 JSON，或明确切换到首个工具规则。";
  document.querySelectorAll(".review-tool-card button").forEach(button => {
    const item = data.catalog.find(t => t.name === button.dataset.name);
    button.disabled = busy || !draft.should_call || mode(draft) !== "first" || !item.enabled || item.kind !== "tool";
    button.setAttribute("aria-pressed", String(selected.includes(item.name)));
  });
}
function toggle(name) {
  if (busy || rawDirty) { notice("请先应用完整 JSON 中的修改。"); return; }
  const selected = new Set(draft.allowed_first_tools ?? []);
  if (selected.has(name)) selected.delete(name); else selected.add(name);
  // 首次规则变更后同步派生工具集合，避免旧 expected_tools 残留。
  draft.allowed_first_tools = [...selected]; draft.expected_tools = [...selected]; delete draft.expected_tool;
  renderSelection(); syncJson();
}
function renderCatalog() {
  const container = $("review-tools"); container.replaceChildren();
  for (const group of [...new Set(data.catalog.map(t => t.group))]) {
    const items = data.catalog.filter(t => t.group === group), section = textNode("details", "review-tool-group");
    section.open = items[0].kind === "tool" && items[0].enabled;
    section.append(textNode("summary", "", group.replace(/^\d+\.\s*/, "")));
    for (const item of items) {
      const card = textNode("div", "review-tool-card"); card.dataset.tool = item.name; card.tabIndex = 0;
      const id = `tool-description-${data.catalog.indexOf(item)}`;
      card.setAttribute("aria-describedby", id);
      const button = textNode("button", "", item.name); button.type = "button"; button.dataset.name = item.name;
      button.setAttribute("aria-describedby", id); button.addEventListener("click", () => {
        // 点击完成选择后收起说明，不移除焦点，以免打断键盘导航。
        card.classList.add("tooltip-dismissed");
        toggle(item.name);
      });
      card.addEventListener("pointerleave", () => card.classList.remove("tooltip-dismissed"));
      card.addEventListener("focusin", event => {
        if (event.target.matches(":focus-visible")) card.classList.remove("tooltip-dismissed");
      });
      card.append(button, textNode("p", "", item.summary));
      if (!item.enabled || item.kind === "skill") card.append(textNode("small", "muted", item.kind === "skill" ? "具体 Skill · 不是工具名称" : "当前未开放 · 不可选"));
      const tip = textNode("div", "review-tooltip", item.description); tip.id = id; tip.setAttribute("role", "tooltip"); card.append(tip);
      section.append(card);
    }
    container.append(section);
  }
}
async function load() {
  if (busy) return;
  busy = true; $("review-form").inert = true;
  notice("正在读取任务与工具说明…");
  try {
    const next = await api("/api/review"); data = next;
    $("review-source").textContent = `当前文件：${data.source} · 保存将更新此文件`;
    const scenario = $("review-scenario-filter").value;
    $("review-scenario-filter").replaceChildren(new Option("全部场景", ""), ...[...new Set(data.items.map(t => t.scenario_id).filter(Boolean))].sort().map(s => new Option(s, s)));
    $("review-scenario-filter").value = scenario;
    renderCatalog(); choose(data.items.find(t => t.case_id === draft?.case_id) ?? data.items[0]); notice();
  } catch (error) { notice(error.message); }
  finally { busy = false; $("review-form").inert = false; if (draft && data) renderSelection(); }
}
function nextTask(offset, ask = true) {
  const items = filtered(), index = items.findIndex(t => t.case_id === draft?.case_id);
  const item = items[index + offset]; if (item && (!ask || canLeave())) choose(item);
}
async function save(advance) {
  if (busy || !draft) return;
  if (rawDirty) { notice("完整 JSON 有尚未应用的修改，请先点击“应用 JSON 到表单”。"); return; }
  if (!$("review-form").reportValidity()) return;
  const listBeforeSave = filtered(), nextId = listBeforeSave[listBeforeSave.findIndex(t => t.case_id === draft.case_id) + 1]?.case_id;
  busy = true; $("review-form").inert = true; renderSelection();
  try {
    const saved = await api(`/api/review/tasks/${encodeURIComponent(draft.case_id)}`, { task: draft, revision: data.revision }, "PUT");
    data.revision = saved.revision; data.items[data.items.findIndex(t => t.case_id === draft.case_id)] = structuredClone(draft);
    original = JSON.stringify(draft); setDirty(); renderList();
    if (advance && nextId) choose(data.items.find(t => t.case_id === nextId));
    notice(`已保存。原文件备份：${saved.backup}`); window.dispatchEvent(new Event("dataset-changed"));
  } catch (error) { notice(error.message); }
  finally { busy = false; $("review-form").inert = false; renderSelection(); }
}
function importBody() { return { content: $("review-import-text").value, revision: data.revision, replaceExisting: $("review-import-replace").checked }; }
function invalidatePreview() { previewBody = undefined; $("review-import-confirm").disabled = true; $("review-import-result").textContent = "请先校验并预览。"; }
async function importTasks(preview) {
  if (busy) return;
  const body = importBody();
  if (!preview && JSON.stringify(body) !== previewBody) { invalidatePreview(); return; }
  busy = true; $("review-import-preview").disabled = true; $("review-import-confirm").disabled = true;
  try {
    const result = await api("/api/review/import", { ...body, preview });
    if (preview) {
      if (JSON.stringify(importBody()) !== JSON.stringify(body)) { invalidatePreview(); return; }
      previewBody = JSON.stringify(body);
      $("review-import-result").textContent = `校验通过：新增 ${result.added} 条，更新 ${result.updated} 条，导入后共 ${result.total} 条。`;
      $("review-import-confirm").disabled = false;
    } else {
      dirty = false; rawDirty = false; $("review-import-dialog").close(); busy = false;
      await load(); notice(`导入完成：新增 ${result.added} 条，更新 ${result.updated} 条。备份：${result.backup}`);
      window.dispatchEvent(new Event("dataset-changed"));
    }
  } catch (error) { $("review-import-result").textContent = error.message; }
  finally { busy = false; $("review-import-preview").disabled = false; }
}
export function initReview() {
  for (const id of ["review-search", "review-family-filter", "review-reason-filter", "review-scenario-filter"]) $(id).addEventListener("input", () => { if (data) renderList(); });
  for (const id of ["review-query", "review-reason", "review-family", "review-suite"]) $(id).addEventListener("input", () => {
    if (rawDirty) { notice("请先应用完整 JSON 修改，再编辑表单。"); return; }
    const key = { "review-query": "query", "review-reason": "reason", "review-family": "tool_family", "review-suite": "suite" }[id];
    draft[key] = $(id).value; if (key === "tool_family" && !draft[key]) delete draft[key]; syncJson();
  });
  $("review-should-call").addEventListener("change", () => {
    const value = $("review-should-call").value === "true";
    if (rawDirty || (!value && !confirm("设为不调用会清空工具选择规则和参数断言，并将类别改为 None，是否继续？"))) { $("review-should-call").value = String(draft.should_call); return; }
    draft.should_call = value;
    if (!value) { clearRules(); delete draft.argument_assertions; draft.expected_tools = []; draft.tool_family = "none"; }
    else { if (draft.tool_family === "none") draft.tool_family = "memory"; draft.allowed_first_tools = []; }
    renderForm();
  });
  $("review-rule-mode").addEventListener("change", () => {
    const value = $("review-rule-mode").value;
    if (rawDirty || !confirm("切换规则会清空当前工具集合或调用序列。确定继续？")) { $("review-rule-mode").value = mode(draft); return; }
    clearRules();
    if (value === "first") draft.allowed_first_tools = [];
    if (value === "sequence") draft.expected_tool_sequence = [];
    if (value === "sequences") draft.allowed_sequences = [[]];
    if (value === "legacy") draft.expected_tools = [];
    syncJson(); renderSelection();
    if (value !== "first") { $("review-json").closest("details").open = true; $("review-json").focus(); }
  });
  $("review-json").addEventListener("input", () => { rawDirty = true; setDirty(); });
  $("review-apply-json").addEventListener("click", async () => {
    if (busy) return;
    try {
      const value = JSON.parse($("review-json").value);
      if (!value || Array.isArray(value) || value.case_id !== draft.case_id || typeof value.query !== "string" || typeof value.should_call !== "boolean" || (value.reason !== undefined && typeof value.reason !== "string")) throw new Error("请保留任务 ID、有效的 query、should_call 和字符串 reason。");
      busy = true; $("review-form").inert = true;
      // 应用前沿用服务端校验，损坏的 JSON 字段不能先进入页面状态。
      await api("/api/review/import", { content: JSON.stringify(value), revision: data.revision, replaceExisting: true, preview: true });
      draft = value; renderForm(); notice("JSON 已应用，请检查后保存。完整字段将在保存时校验。");
    } catch (error) { notice(error.message); }
    finally { busy = false; $("review-form").inert = false; renderSelection(); }
  });
  $("review-form").addEventListener("submit", e => { e.preventDefault(); void save(false); });
  $("review-save-next").addEventListener("click", () => save(true));
  $("review-prev").addEventListener("click", () => nextTask(-1)); $("review-next").addEventListener("click", () => nextTask(1));
  $("review-reload").addEventListener("click", () => { if (canLeave()) void load(); });
  $("review-import-open").addEventListener("click", () => {
    if (!data || !canLeave()) return;
    if (dirty) choose(data.items.find(t => t.case_id === draft.case_id));
    invalidatePreview(); $("review-import-dialog").showModal();
  });
  $("review-import-close").addEventListener("click", () => { if (!busy) $("review-import-dialog").close(); });
  $("review-import-dialog").addEventListener("cancel", e => { if (busy) e.preventDefault(); });
  $("review-import-text").addEventListener("input", invalidatePreview); $("review-import-replace").addEventListener("change", invalidatePreview);
  $("review-import-file").addEventListener("change", async () => {
    const file = $("review-import-file").files[0]; invalidatePreview();
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { $("review-import-result").textContent = "文件不能超过 8 MiB。"; return; }
    $("review-import-text").value = await file.text();
  });
  $("review-import-preview").addEventListener("click", () => importTasks(true));
  $("review-import-confirm").addEventListener("click", () => importTasks(false));
  window.addEventListener("beforeunload", e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ""; } });
  return { load, canLeave, discard: () => { dirty = false; rawDirty = false; } };
}

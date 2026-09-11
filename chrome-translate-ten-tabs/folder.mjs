import { DEFAULT_LANGUAGE, findLanguage } from "./languages.mjs";
import { createLanguagePicker } from "./language-picker.mjs";
import { listDocuments, documentPath, documentType, bytesToBase64, CHUNK_BYTES } from "./folder-files.mjs";
import { createTranslationQueue } from "./translation-queue.mjs";

const $ = selector => document.querySelector(selector);
const managerId = crypto.randomUUID();
let allFiles = [], rows = [], busy = false, launching = false, windowId;
const filesById = new Map();
const queue = createTranslationQueue({
  translate: row => chrome.runtime.sendMessage({ type: "CLICK_FOLDER_TRANSLATE", managerId, batchId: row.batchId, documentId: row.id, tabId: row.tabId }),
  onStart: row => setState(row, "clicking"),
  onResult: (row, result) => setState(row, result?.clicked ? "clicked" : result?.uncertain ? "uncertain" : "error", result?.clicked ? "" : result?.error || "未能点击翻译，请查看页面。"),
  onChange: () => update()
});
function notify(message, error = false) {
  $("#status").textContent = message; $("#status").dataset.error = String(error); $("#status").hidden = false;
}
const picker = createLanguagePicker(language => { $("#target-label").textContent = language?.[1] || "请选择语言"; $("#status").hidden = true; });
picker.choose(findLanguage(DEFAULT_LANGUAGE));
try {
  const saved = await chrome.storage.local.get(["targetLanguage", "autoTranslate"]);
  const code = new URL(location.href).searchParams.get("language") || saved.targetLanguage;
  if (findLanguage(code)) picker.choose(findLanguage(code));
  $("#auto-translate").checked = saved.autoTranslate === true;
} catch { /* The default language is still usable. */ }
picker.setDisabled(false);

const labels = { pending: "待放入", waiting: "等待页面", loading: "正在放入", loaded: "已放入", clicking: "正在点击翻译", clicked: "已点击翻译", uncertain: "点击结果待确认", error: "未完成" };
function update() {
  const pending = rows.filter(row => ["waiting", "loading"].includes(row.state)).length;
  busy = launching || pending > 0 || queue.active || queue.running;
  const completed = rows.filter(row => ["loaded", "clicking", "clicked", "uncertain"].includes(row.state)).length;
  const clicked = rows.filter(row => row.state === "clicked").length;
  const auto = $("#auto-translate").checked;
  const failed = rows.filter(row => row.state === "error").length;
  $("#document-count").textContent = rows.length;
  $("#progress").textContent = !rows.length ? "等待选择" : busy || completed || failed ? `${auto ? `已点击 ${clicked}` : `已放入 ${completed}`}/${rows.length}${failed ? ` · ${failed} 项未完成` : ""}` : `${rows.length} 份待放入`;
  $("#start-button").disabled = busy || !rows.length;
  $("#start-button").textContent = busy ? auto ? "正在按序放入并点击翻译…" : "正在按序放入文档…" : rows.length ? `${completed ? "再次" : ""}打开 ${rows.length} 页${auto ? "并自动翻译" : "并放入文档"}` : "选择文件夹后开始";
  $("#choose-folder").disabled = busy;
  $("#include-subfolders").disabled = busy;
  $("#auto-translate").disabled = busy;
  $("#stop-translate").hidden = !queue.active;
  picker.setDisabled(busy);
  $("#retry-button").hidden = !failed;
  $("#retry-button").disabled = busy;
}
function setState(row, state, detail = "") {
  row.state = state; row.detail = detail;
  row.status.textContent = labels[state] + (detail ? `：${detail}` : "");
  row.status.dataset.state = state;
  if (["loaded", "error", "clicked", "uncertain"].includes(state)) { clearTimeout(row.timer); row.timer = null; }
  update();
}
function chooseFiles() {
  queue.stop();
  const { accepted, skipped } = listDocuments(allFiles, $("#include-subfolders").checked);
  rows.forEach(row => clearTimeout(row.timer));
  filesById.clear(); $("#document-rows").replaceChildren();
  rows = accepted.map((file, index) => {
    const id = crypto.randomUUID();
    const row = { id, file, state: "pending", batchId: null, status: document.createElement("td") };
    filesById.set(id, row);
    const tr = document.createElement("tr");
    const number = document.createElement("td"); number.textContent = index + 1;
    const name = document.createElement("td"); name.className = "document-name"; name.textContent = file.name;
    const relative = documentPath(file).split("/").slice(1, -1).join("/");
    if (relative) { const path = document.createElement("small"); path.textContent = relative; name.append(path); }
    const size = document.createElement("td"); size.className = "file-size"; size.textContent = file.size >= 1024*1024 ? `${(file.size/1024/1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.size/1024))} KB`;
    row.status.className = "document-state"; row.status.textContent = labels.pending; row.status.dataset.state = "pending";
    tr.append(number, name, size, row.status); $("#document-rows").append(tr);
    return row;
  });
  $("#folder-name").textContent = allFiles[0]?.webkitRelativePath?.split("/")[0] || "尚未选择文件夹";
  $("#empty-list").hidden = rows.length > 0; $("#document-table").hidden = !rows.length;
  $("#skipped-section").hidden = !skipped.length;
  $("#skipped-summary").textContent = `已跳过 ${skipped.length} 个文件（点击查看原因）`;
  $("#skipped-list").replaceChildren(...skipped.map(item => { const li = document.createElement("li"); li.textContent = `${item.path} — ${item.reason}`; return li; }));
  $("#status").hidden = true; $("#view-window").hidden = true; update();
}
$("#choose-folder").addEventListener("click", () => { $("#folder-input").value = ""; $("#folder-input").click(); });
$("#folder-input").addEventListener("change", event => { if (event.target.files.length) { allFiles = [...event.target.files]; chooseFiles(); } });
$("#include-subfolders").addEventListener("change", chooseFiles);
$("#auto-translate").addEventListener("change", () => { update(); });
$("#stop-translate").addEventListener("click", () => {
  queue.stop();
  notify("已停止后续自动点击。已经点击的文档可在谷歌翻译页面查看。");
});

async function checkPermission() {
  const allowed = await chrome.extension.isAllowedIncognitoAccess();
  $("#permission-note").hidden = allowed; return allowed;
}
async function openSettings() { await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }); }
$("#settings-button").addEventListener("click", () => openSettings().catch(error => notify(error.message, true)));
$("#permission-button").addEventListener("click", () => openSettings().catch(error => notify(error.message, true)));
window.addEventListener("focus", () => { checkPermission().catch(() => {}); });
checkPermission().catch(error => notify(error.message, true));

function armTimeout(row) {
  clearTimeout(row.timer);
  row.timer = setTimeout(() => { if (["waiting", "loading"].includes(row.state)) { setState(row, "error", "页面加载超时，可检查网络后重试"); queue.kick(); } }, 120000);
}
async function start(selected) {
  if (busy || !selected.length || picker.composing) return;
  const language = picker.resolve();
  if (!language) { notify("请输入并选择一种目标语言。", true); return; }
  launching = true; update();
  try {
    if (!await checkPermission()) { launching = false; update(); notify("请先开启「在无痕模式下启用」，再点击开始。", true); return; }
  } catch (error) { launching = false; update(); throw error; }
  picker.choose(language);
  const batchId = crypto.randomUUID();
  launching = true;
  for (const row of selected) { row.batchId = batchId; setState(row, "waiting"); armTimeout(row); }
  const autoTranslate = $("#auto-translate").checked;
  if (autoTranslate) queue.start(selected);
  $("#status").hidden = true; update();
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_FOLDER_BATCH", managerId, batchId, language: language[0], autoTranslate, documents: selected.map(row => ({ id: row.id, name: row.file.name, size: row.file.size, type: documentType(row.file), lastModified: row.file.lastModified })) });
    if (!result?.ok) throw new Error(result?.error || "未收到开窗结果，请检查新窗口。");
    windowId = result.windowId; $("#view-window").hidden = false;
    result.tabs.forEach(item => { const row = filesById.get(item.documentId); if (row) row.tabId = item.tabId; });
  } catch (error) {
    queue.stop();
    selected.forEach(row => { if (row.state !== "loaded") setState(row, "error", error.message); });
    notify(error.message, true);
  } finally { launching = false; update(); }
}
$("#start-button").addEventListener("click", () => start(rows).catch(error => notify(error.message, true)));
$("#retry-button").addEventListener("click", () => start(rows.filter(row => row.state === "error")).catch(error => notify(error.message, true)));
$("#view-window").addEventListener("click", () => chrome.windows.update(windowId, { focused: true }).catch(() => notify("翻译窗口已关闭，请重新打开。", true)));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== "folder-manager" || message.managerId !== managerId) return false;
  (async () => {
    if (message.kind === "CHECK_FILES") return { ok: message.documentIds.every(id => filesById.get(id)?.batchId === message.batchId) };
    const row = filesById.get(message.documentId);
    if (!row || row.batchId !== message.batchId) throw new Error("原始文件已更换，请重新打开此文档。");
    if (message.kind === "READ_CHUNK") {
      if (!Number.isInteger(message.offset) || !Number.isInteger(message.length) || message.offset < 0 || message.length < 1 || message.length > CHUNK_BYTES || message.offset + message.length > row.file.size) throw new Error("文件读取范围无效。");
      row.tabId = message.tabId; setState(row, "loading"); armTimeout(row);
      const bytes = new Uint8Array(await row.file.slice(message.offset, message.offset + message.length).arrayBuffer());
      return { ok: true, data: bytesToBase64(bytes) };
    }
    if (message.kind === "STATUS") {
      row.tabId = message.tabId;
      if (!["clicking", "clicked", "uncertain"].includes(row.state)) setState(row, message.state, message.detail);
      queue.kick(); return { ok: true };
    }
    if (message.kind === "TAB_CLOSED") {
      if (!["clicked", "uncertain"].includes(row.state)) setState(row, "error", "标签页已关闭");
      queue.kick();
      return { ok: true };
    }
    throw new Error("未知的文档操作。");
  })().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
update();

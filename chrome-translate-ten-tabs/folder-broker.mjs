import { translationUrl } from "./languages.mjs";
import { CHUNK_BYTES, MAX_DOCUMENT_BYTES } from "./folder-files.mjs";

const key = tabId => `folder-document:${tabId}`;
const validId = value => typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value);

export function createFolderBroker(api) {
  let opening = null;
  const clicks = new Map();
  const folderUrl = api.runtime.getURL("folder.html");
  function fromManager(sender) {
    return sender.id === api.runtime.id && sender.url?.split("?")[0] === folderUrl;
  }
  function fromTranslate(sender) {
    if (sender.id !== api.runtime.id || !sender.tab?.incognito || sender.frameId !== 0) return false;
    try {
      const url = new URL(sender.url);
      return url.origin === "https://translate.google.com" && ["docs", "translate"].includes(url.searchParams.get("op"));
    } catch { return false; }
  }
  async function assignment(sender) {
    if (!fromTranslate(sender)) throw new Error("当前页面不属于文档翻译窗口。");
    if (opening) await opening.catch(() => {});
    return (await api.storage.session.get(key(sender.tab.id)))[key(sender.tab.id)];
  }
  async function toManager(item, data) {
    let result;
    try {
      result = await api.runtime.sendMessage({ target: "folder-manager", managerId: item.managerId, batchId: item.batchId, documentId: item.documentId, ...data });
    } catch { throw new Error("文件夹页面已关闭或重新加载，请重新选择文件夹。"); }
    if (!result?.ok) throw new Error(result?.error || "文件夹页面已关闭或重新加载，请重新选择文件夹。");
    return result;
  }
  async function open(message, sender) {
    if (!fromManager(sender)) throw new Error("请从文件夹页面开始。");
    if (opening) throw new Error("正在打开文档，请稍候。");
    const task = (async () => {
      const url = translationUrl(message.language);
      if (!validId(message.managerId) || !validId(message.batchId) || !Array.isArray(message.documents) || !message.documents.length) throw new Error("请先选择文档文件夹。");
      const ids = new Set();
      const documents = message.documents.map(doc => {
        if (!doc || !validId(doc.id) || ids.has(doc.id) || typeof doc.name !== "string" || doc.name.length > 255 || !/\.(pdf|docx|pptx|xlsx)$/i.test(doc.name) || !Number.isInteger(doc.size) || doc.size < 1 || doc.size > MAX_DOCUMENT_BYTES) throw new Error("文档列表无效，请重新选择文件夹。");
        ids.add(doc.id);
        return { id: doc.id, name: doc.name, size: doc.size, type: typeof doc.type === "string" ? doc.type.slice(0,150) : "", lastModified: Number.isFinite(doc.lastModified) ? doc.lastModified : 0 };
      });
      if (!await api.extension.isAllowedIncognitoAccess()) throw new Error("请先在扩展详情中开启「在无痕模式下启用」，再回来点击开始。");
      const ready = await api.runtime.sendMessage({ target: "folder-manager", kind: "CHECK_FILES", managerId: message.managerId, batchId: message.batchId, documentIds: documents.map(doc => doc.id) });
      if (!ready?.ok) throw new Error("文件夹页面未准备好，请重新选择文件夹。");
      await api.storage.local.set({ targetLanguage: message.language, autoTranslate: message.autoTranslate === true });
      const window = await api.windows.create({ incognito: true, type: "normal", focused: false, url: documents.map(() => url) });
      if (!window?.tabs || window.tabs.length !== documents.length) throw new Error("未能取得完整标签页列表，请检查新开的窗口。");
      const tabs = [...window.tabs].sort((a, b) => a.index - b.index);
      const entries = {};
      tabs.forEach((tab, index) => {
        const doc = documents[index];
        entries[key(tab.id)] = { managerId: message.managerId, batchId: message.batchId, documentId: doc.id, metadata: doc, language: message.language, autoTranslate: message.autoTranslate === true, windowId: window.id, index, total: documents.length };
      });
      await api.storage.session.set(entries);
      return { ok: true, windowId: window.id, tabs: tabs.map((tab, index) => ({ tabId: tab.id, documentId: documents[index].id })) };
    })();
    opening = task;
    try { return await task; } finally { opening = null; }
  }
  async function click(message, sender) {
    if (!fromManager(sender) || !Number.isInteger(message.tabId)) throw new Error("请从文件夹页面启动自动翻译。");
    if (clicks.has(message.tabId)) return clicks.get(message.tabId);
    const task = (async () => {
      const item = (await api.storage.session.get(key(message.tabId)))[key(message.tabId)];
      if (!item || !item.autoTranslate || item.managerId !== message.managerId || item.batchId !== message.batchId || item.documentId !== message.documentId) throw new Error("此标签页未开启本次自动翻译。");
      if (item.translation) return item.translation.result || { ok: false, uncertain: true, error: "已发送过点击指令，请到页面确认，避免重复提交。" };
      const tab = await api.tabs.get(message.tabId);
      const url = new URL(tab.url || "about:blank");
      // Google may rewrite op=docs to op=translate without leaving the document
      // pane. The content script checks the active pane and assigned filename.
      if (!tab.incognito || tab.windowId !== item.windowId || url.origin !== "https://translate.google.com" || !["docs", "translate"].includes(url.searchParams.get("op")) || url.searchParams.get("tl") !== item.language) throw new Error("页面或目标语言已经改变，请手动确认。");
      // Persist the attempt before sending it. A lost reply must not cause a
      // duplicate translation after a service-worker restart or retry.
      item.translation = { state: "requested" };
      await api.storage.session.set({ [key(message.tabId)]: item });
      let result;
      try {
        const response = await api.tabs.sendMessage(message.tabId, { type: "CLICK_ASSIGNED_TRANSLATE", batchId: item.batchId, documentId: item.documentId, language: item.language }, { frameId: 0 });
        result = response?.clicked === true ? { ok: true, clicked: true } : { ok: false, error: response?.error || "未能点击翻译，请查看页面。" };
      } catch {
        result = { ok: false, uncertain: true, error: "点击指令的返回结果中断，请查看翻译页确认。" };
      }
      item.translation = { state: result.clicked ? "clicked" : result.uncertain ? "uncertain" : "failed", result };
      await api.storage.session.set({ [key(message.tabId)]: item }).catch(() => {});
      return result;
    })();
    clicks.set(message.tabId, task);
    try { return await task; } finally { clicks.delete(message.tabId); }
  }
  return {
    async handle(message, sender) {
      if (message.type === "OPEN_FOLDER_BATCH") return open(message, sender);
      if (message.type === "CLICK_FOLDER_TRANSLATE") return click(message, sender);
      const item = await assignment(sender);
      if (!item) return { ok: true, document: null };
      if (message.type === "GET_FOLDER_DOCUMENT") return { ok: true, document: { ...item.metadata, batchId: item.batchId, index: item.index, total: item.total } };
      if (message.batchId !== item.batchId) throw new Error("文档批次已改变，请刷新页面。");
      if (message.type === "READ_FOLDER_CHUNK") {
        if (!Number.isInteger(message.offset) || message.offset < 0 || message.offset >= item.metadata.size || message.offset % CHUNK_BYTES) throw new Error("文件读取位置无效。");
        return toManager(item, { kind: "READ_CHUNK", offset: message.offset, length: Math.min(CHUNK_BYTES, item.metadata.size - message.offset), tabId: sender.tab.id });
      }
      if (message.type === "REPORT_FOLDER_DOCUMENT") {
        if (!["loaded", "error"].includes(message.state)) throw new Error("文档状态无效。");
        return toManager(item, { kind: "STATUS", state: message.state, detail: String(message.detail || "").slice(0,400), tabId: sender.tab.id });
      }
      throw new Error("未知的文档请求。");
    },
    async tabRemoved(tabId) {
      const item = (await api.storage.session.get(key(tabId)))[key(tabId)];
      if (item) {
        await toManager(item, { kind: "TAB_CLOSED", tabId }).catch(() => {});
        await api.storage.session.remove(key(tabId));
      }
    }
  };
}

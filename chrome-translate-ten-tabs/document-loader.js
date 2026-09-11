(() => {
  if (new URL(location.href).searchParams.get("op") !== "docs") return;
  let note;
  let readyDoc, clickAttempt;
  function show(text, error = false) {
    if (!note) {
      const host = document.createElement("div");
      host.id = "codex-folder-document-status";
      host.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;max-width:420px";
      const shadow = host.attachShadow({ mode: "open" });
      note = document.createElement("div");
      note.setAttribute("role", "status");
      note.style.cssText = "font:13px/1.6 system-ui,sans-serif;padding:12px 16px;border:1px solid #cdd6f4;border-radius:10px;box-shadow:0 4px 20px #0002;background:#f6f8ff;color:#30459b;overflow-wrap:anywhere";
      shadow.append(note); document.documentElement.append(host);
    }
    note.textContent = text;
    note.style.color = error ? "#a43139" : "#30459b";
  }
  async function ask(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || "扩展未响应，请检查文件夹页面是否仍然打开。");
    return result;
  }
  async function clickTranslate(message) {
    if (!readyDoc || message.batchId !== readyDoc.batchId || message.documentId !== readyDoc.id) return { ok: false, error: "文档尚未就绪或批次已变化。" };
    if (clickAttempt) return clickAttempt;
    clickAttempt = (async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const url = new URL(location.href);
        const documentMode = [...document.querySelectorAll('[aria-current="page"], [aria-current="true"]')].some(element => /^(文档|Documents)$/i.test((element.innerText || "").trim()) && element.getClientRects().length);
        if (!documentMode || url.searchParams.get("tl") !== message.language || !document.body?.innerText.includes(readyDoc.name)) throw new Error("页面文档或目标语言已改变，请手动确认。");
        const button = [...document.querySelectorAll('button, [role="button"]')].find(element => {
          // Match only the visible document action, excluding mode selectors.
          const label = (element.innerText || "").trim();
          return /^(翻译|Translate)$/i.test(label) && element.getAttribute("role") !== "tab" && !element.disabled && element.getAttribute("aria-disabled") !== "true" && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
        });
        if (button) {
          button.click();
          show(`已点击翻译：${readyDoc.name}。翻译进度和结果请查看页面。`);
          return { ok: true, clicked: true };
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error("未找到可点击的「翻译」按钮，页面可能正在翻译或已完成，请查看页面。");
    })().catch(error => { show(error.message, true); return { ok: false, error: error.message }; });
    return clickAttempt;
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== "CLICK_ASSIGNED_TRANSLATE") return false;
    clickTranslate(message).then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  });
  async function findInput() {
    const find = () => [...document.querySelectorAll('input[type="file"]')].find(input => /\.pdf|application\/pdf|\.docx/i.test(input.accept));
    if (find()) return find();
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => { const input = find(); if (input) { observer.disconnect(); clearTimeout(timer); resolve(input); } });
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error("未找到文档上传控件，请确认谷歌翻译页面已正常加载。")); }, 45000);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
  (async () => {
    let doc;
    try {
      const result = await ask({ type: "GET_FOLDER_DOCUMENT" });
      doc = result.document;
      if (!doc) return;
      show(`文档 ${doc.index + 1}/${doc.total}：正在放入 ${doc.name}…`);
      let input = await findInput();
      if (input.files.length) throw new Error("此页面已选择其他文件，未覆盖。请刷新页面后重试。");
      const parts = [];
      let offset = 0;
      while (offset < doc.size) {
        const chunk = await ask({ type: "READ_FOLDER_CHUNK", batchId: doc.batchId, offset });
        const binary = atob(chunk.data);
        if (!binary.length || binary.length > 192 * 1024 || offset + binary.length > doc.size) throw new Error("文档数据不完整，请重试。");
        parts.push(Uint8Array.from(binary, char => char.charCodeAt(0)));
        offset += binary.length;
      }
      input = await findInput();
      if (input.files.length) throw new Error("此页面已选择其他文件，未覆盖。");
      const file = new File(parts, doc.name, { type: doc.type, lastModified: doc.lastModified });
      const data = new DataTransfer(); data.items.add(file);
      let accepted = false;
      // Google's file input can appear before its lazy event handler is ready.
      // Confirm the site displays the filename before reporting completion.
      for (let attempt = 0; attempt < 4 && !accepted; attempt++) {
        input = await findInput();
        if (input.files[0] && input.files[0] !== file) throw new Error("此页面已选择其他文件，未覆盖。");
        input.files = data.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        for (let check = 0; check < 16; check++) {
          if (document.body?.innerText.includes(doc.name)) { accepted = true; break; }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      if (!accepted) throw new Error("谷歌页面尚未确认文档，请检查页面后重试。");
      readyDoc = doc;
      show(`已放入：${doc.name}。可在页面中点击「翻译」。`);
      await ask({ type: "REPORT_FOLDER_DOCUMENT", batchId: doc.batchId, state: "loaded" });
    } catch (error) {
      if (!doc) return;
      show(`放入失败：${error.message}`, true);
      await ask({ type: "REPORT_FOLDER_DOCUMENT", batchId: doc.batchId, state: "error", detail: error.message }).catch(() => {});
    }
  })();
})();

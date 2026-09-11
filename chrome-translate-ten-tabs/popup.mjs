import { DEFAULT_LANGUAGE, findLanguage } from "./languages.mjs";
import { createLanguagePicker } from "./language-picker.mjs";
import { DEFAULT_TAB_COUNT, MIN_TAB_COUNT, MAX_TAB_COUNT, isValidTabCount, validateTabCount } from "./tab-count.mjs";

const form = document.querySelector("#launch-form");
const button = document.querySelector("#open-button");
const buttonLabel = document.querySelector("#button-label");
const target = document.querySelector("#target-label");
const status = document.querySelector("#status");
const countInput = document.querySelector("#tab-count");
const countBadge = document.querySelector("#count-badge");
const tabStrip = document.querySelector("#tab-strip");
let busy = false;

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
  status.hidden = false;
}

const picker = createLanguagePicker(language => {
  target.textContent = language?.[1] ?? "请选择语言";
  status.hidden = true;
});
picker.choose(findLanguage(DEFAULT_LANGUAGE));
countInput.min = MIN_TAB_COUNT;
countInput.max = MAX_TAB_COUNT;
countInput.value = DEFAULT_TAB_COUNT;

function updateCountPreview() {
  const count = countInput.valueAsNumber;
  const valid = isValidTabCount(count);
  countBadge.textContent = valid ? `${count} 个标签页` : "请输入数量";
  buttonLabel.textContent = valid ? `打开 ${count} 个无痕翻译页` : "打开无痕翻译页";
  // Keep the illustration compact; the badge always shows the exact count.
  tabStrip.replaceChildren(...Array.from({ length: valid ? Math.min(count, 10) : 0 }, () => document.createElement("i")));
}

try {
  const saved = await chrome.storage.local.get(["targetLanguage", "tabCount"]);
  if (findLanguage(saved.targetLanguage)) picker.choose(findLanguage(saved.targetLanguage));
  if (isValidTabCount(saved.tabCount)) countInput.value = saved.tabCount;
} catch {
  showStatus("暂时无法读取上次的设置，本次默认使用德语、10 个标签页。");
}
updateCountPreview();
picker.setDisabled(false);
countInput.disabled = false;
button.disabled = false;

countInput.addEventListener("input", () => {
  updateCountPreview();
  countInput.removeAttribute("aria-invalid");
  status.hidden = true;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || picker.composing) return;
  const language = picker.resolve();
  if (!language) {
    showStatus("请输入有效的语言名称或代码，并从匹配结果中选择一种语言。", true);
    return;
  }
  const count = countInput.valueAsNumber;
  try {
    validateTabCount(count);
  } catch (error) {
    countInput.setAttribute("aria-invalid", "true");
    showStatus(error.message, true);
    countInput.focus();
    return;
  }
  picker.choose(language);
  busy = true;
  button.disabled = true;
  picker.setDisabled(true);
  countInput.disabled = true;
  buttonLabel.textContent = "正在打开…";
  status.hidden = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "OPEN_TRANSLATION_TABS",
      language: language[0],
      count
    });
    if (!result?.ok) throw new Error(result?.error || "未收到启动结果，请检查窗口是否已经打开。");
    showStatus(result.remembered
      ? `已打开 ${result.count} 个${target.textContent}文档翻译页。`
      : `已打开 ${result.count} 个翻译页，但未能保存语言和数量设置。`);
    // A focused new Chrome window normally closes this popup automatically.
    window.close();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true);
    busy = false;
    button.disabled = false;
    picker.setDisabled(false);
    countInput.disabled = false;
    updateCountPreview();
  }
});

document.querySelector("#help-button").addEventListener("click", (event) => {
  const help = document.querySelector("#help");
  help.hidden = !help.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!help.hidden));
});

document.querySelector("#settings-button").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  } catch {
    showStatus("请在地址栏输入 chrome://extensions，找到本扩展并打开详情。", true);
  }
});

document.querySelector("#folder-button").addEventListener("click", async () => {
  try {
    const language = picker.resolve();
    const url = new URL(chrome.runtime.getURL("folder.html"));
    if (language) url.searchParams.set("language", language[0]);
    // Spanning extensions cannot host their own pages in incognito tabs.
    const current = await chrome.windows.getCurrent();
    const regular = current.incognito
      ? (await chrome.windows.getAll({ windowTypes: ["normal"] })).find(item => !item.incognito)
      : current;
    if (regular) await chrome.tabs.create({ windowId: regular.id, url: url.href });
    else await chrome.windows.create({ incognito: false, url: url.href });
    window.close();
  } catch (error) {
    showStatus(error.message, true);
  }
});

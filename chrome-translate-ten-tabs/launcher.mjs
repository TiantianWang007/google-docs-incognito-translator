import { translationUrl } from "./languages.mjs";
import { DEFAULT_TAB_COUNT, validateTabCount } from "./tab-count.mjs";

export function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/incognito.*(disabled|not allowed|unavailable)/i.test(message)) {
    return "Chrome 的无痕模式已被停用。请检查浏览器的管理策略或家长控制设置。";
  }
  return `未能打开无痕窗口：${message}`;
}

export function createLauncher(api) {
  let opening = false;
  return async function launch(language, count = DEFAULT_TAB_COUNT) {
    if (opening) throw new Error("正在打开，请勿重复点击。");
    // Reject invalid input before either saving settings or opening a window.
    const url = translationUrl(language);
    validateTabCount(count);
    opening = true;
    try {
      let remembered = true;
      try {
        await api.storage.local.set({ targetLanguage: language, tabCount: count });
      } catch {
        // A preference write failure must not prevent the requested launch.
        remembered = false;
      }
      // One atomic API call creates one new window with the requested tab count.
      // Chrome may return undefined when incognito access is not enabled;
      // a resolved promise still means the create operation succeeded.
      await api.windows.create({
        incognito: true,
        type: "normal",
        focused: true,
        url: Array(count).fill(url)
      });
      return { ok: true, count, remembered };
    } finally {
      opening = false;
    }
  };
}

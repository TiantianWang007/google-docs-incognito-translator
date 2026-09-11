import { createLauncher, friendlyError } from "./launcher.mjs";
import { createFolderBroker } from "./folder-broker.mjs";

const launch = createLauncher(chrome);
const folder = createFolderBroker(chrome);
const folderTypes = new Set(["OPEN_FOLDER_BATCH", "GET_FOLDER_DOCUMENT", "READ_FOLDER_CHUNK", "REPORT_FOLDER_DOCUMENT", "CLICK_FOLDER_TRANSLATE"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && folderTypes.has(message?.type)) {
    folder.handle(message, sender).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || message?.type !== "OPEN_TRANSLATION_TABS") {
    return false;
  }
  launch(message.language, message.count).then(
    sendResponse,
    (error) => sendResponse({ ok: false, error: friendlyError(error) })
  );
  // The worker continues opening tabs even when the popup loses focus.
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => { folder.tabRemoved(tabId).catch(() => {}); });

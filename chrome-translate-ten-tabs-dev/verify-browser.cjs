const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const extensionPath = path.resolve(__dirname, '../chrome-translate-ten-tabs');

async function until(read, accept, label) {
  const deadline = Date.now() + 20000;
  do {
    const result = await read();
    if (accept(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}

(async () => {
  const profile = await fs.mkdtemp(path.join(__dirname, 'test-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP translate.google.com ~NOTFOUND'],
    viewport: { width: 420, height: 680 }
  });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath, enableInIncognito: false });
    console.log('Chrome loaded extension:', id);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.waitForFunction(() => !document.querySelector('#open-button').disabled);
    assert.equal(await page.locator('#language').inputValue(), '德语 · Deutsch');
    assert.equal(await page.locator('#tab-count').inputValue(), '10');
    const input = page.locator('#language');
    await input.focus();
    assert.equal(await page.getByRole('option').count(), 64);
    assert.equal(await page.evaluate(() => chrome.extension.isAllowedIncognitoAccess()), false);
    await input.fill('不存在的语言');
    assert.equal(await page.getByRole('option').count(), 0);
    assert.equal(await page.locator('#language-empty').isVisible(), true);
    await page.locator('#open-button').click();
    assert.match(await page.locator('#status').textContent(), /有效的语言/);
    assert.equal((await cdp.send('Target.getTargets')).targetInfos.filter(info => info.url.startsWith('https://translate.google.com/')).length, 0);
    await input.fill('中文');
    assert.equal(await page.getByRole('option').count(), 2);
    await input.press('ArrowDown');
    await input.press('Enter');
    assert.equal(await input.inputValue(), '中文（繁体） · 繁體中文');
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    for (const query of ['德语', 'Deutsch', 'German', 'DE']) {
      await input.fill(query);
      assert.equal(await page.locator('#target-label').textContent(), '德语');
      await input.press('Enter');
      assert.equal(await input.inputValue(), '德语 · Deutsch');
    }
    await input.fill('德');
    await input.dispatchEvent('compositionstart');
    await input.press('Enter');
    assert.equal(await page.locator('#language-menu').isVisible(), true);
    assert.equal((await cdp.send('Target.getTargets')).targetInfos.filter(info => info.url.startsWith('https://translate.google.com/')).length, 0);
    await input.dispatchEvent('compositionend');
    await page.locator('main').screenshot({ path: path.join(__dirname, 'popup-search-preview.png') });
    await page.getByRole('option').click();
    assert.equal(await input.inputValue(), '德语 · Deutsch');
    await page.locator('main').screenshot({ path: path.join(__dirname, 'popup-preview.png') });
    const countInput = page.locator('#tab-count');
    for (const invalid of ['', '0', '1.5', '101']) {
      await countInput.fill(invalid);
      await page.locator('#open-button').click();
      assert.match(await page.locator('#status').textContent(), /1–100.*整数/);
      assert.equal(await countInput.getAttribute('aria-invalid'), 'true');
      assert.equal((await cdp.send('Target.getTargets')).targetInfos.filter(info => info.url.startsWith('https://translate.google.com/')).length, 0);
    }
    await countInput.fill('3');
    await countInput.press('ArrowUp');
    assert.equal(await countInput.inputValue(), '4');
    await countInput.press('ArrowDown');
    assert.equal(await countInput.inputValue(), '3');
    assert.equal(await page.locator('#count-badge').textContent(), '3 个标签页');
    assert.equal(await page.locator('#button-label').textContent(), '打开 3 个无痕翻译页');
    await page.locator('main').screenshot({ path: path.join(__dirname, 'popup-count-preview.png') });
    await input.fill('fr');
    assert.equal(await page.locator('#target-label').textContent(), '法语');
    await page.locator('#open-button').click();

    const getTranslations = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(info => info.type === 'page' && info.url.startsWith('https://translate.google.com/'));
    const targets = await until(getTranslations, result => result.length === 3, 'three real incognito tabs');
    assert.ok(targets.every(info => new URL(info.url).searchParams.get('tl') === 'fr'));
    assert.ok(targets.every(info => new URL(info.url).searchParams.get('sl') === 'auto'));
    assert.ok(targets.every(info => new URL(info.url).searchParams.get('op') === 'docs'));
    const windowIds = await Promise.all(targets.map(info => cdp.send('Browser.getWindowForTarget', { targetId: info.targetId }).then(data => data.windowId)));
    assert.equal(new Set(windowIds).size, 1);
    const worker = context.serviceWorkers().find(item => item.url().startsWith(`chrome-extension://${id}/`));
    assert.ok(worker, 'The extension service worker is running');
    const stored = await worker.evaluate(() => chrome.storage.local.get(['targetLanguage', 'tabCount']));
    assert.equal(stored.targetLanguage, 'fr');
    assert.equal(stored.tabCount, 3);
    console.log('PASS: one real Chrome window, exactly 3 French document tabs, language and count saved, incognito extension access off.');

    // Enable only in this isolated test profile to inspect the incognito flag.
    await cdp.send('Extensions.loadUnpacked', { path: extensionPath, enableInIncognito: true });
    const check = await context.newPage();
    await check.goto(`chrome-extension://${id}/popup.html`);
    await check.waitForFunction(() => !document.querySelector('#open-button').disabled);
    assert.equal(await check.locator('#language').inputValue(), '法语 · Français');
    assert.equal(await check.locator('#tab-count').inputValue(), '3');
    const windows = await check.evaluate(() => chrome.windows.getAll({ populate: true }));
    const actual = windows.find(item => item.id === windowIds[0]);
    assert.ok(actual, 'The new window is visible after enabling incognito access');
    assert.equal(actual.incognito, true);
    assert.equal(actual.tabs.length, 3);
    await check.locator('#help-button').click();
    assert.equal(await check.locator('#help').isVisible(), true);
    assert.equal(await check.locator('#help-button').getAttribute('aria-expanded'), 'true');
    await check.locator('#help-button').click();
    assert.equal(await check.locator('#help').isVisible(), false);
    await check.locator('#language').fill('zh-tw');
    await check.locator('#tab-count').fill('1');
    await check.locator('#open-button').click();
    const allTargets = await until(getTranslations, result => result.length === 4, 'second intentional window');
    const chineseTargets = allTargets.filter(info => new URL(info.url).searchParams.get('tl') === 'zh-TW');
    assert.equal(chineseTargets.length, 1);
    const chineseWindows = await Promise.all(chineseTargets.map(info => cdp.send('Browser.getWindowForTarget', { targetId: info.targetId }).then(data => data.windowId)));
    assert.equal(new Set(chineseWindows).size, 1);
    assert.notEqual(chineseWindows[0], windowIds[0]);
    const restored = await context.newPage();
    await restored.goto(`chrome-extension://${id}/popup.html`);
    await restored.waitForFunction(() => !document.querySelector('#open-button').disabled);
    assert.equal(await restored.locator('#tab-count').inputValue(), '1');
    assert.equal(await restored.locator('#language').inputValue(), '中文（繁体） · 繁體中文');
    await restored.evaluate(() => chrome.storage.local.set({ tabCount: -1 }));
    await restored.reload();
    await restored.waitForFunction(() => !document.querySelector('#open-button').disabled);
    assert.equal(await restored.locator('#tab-count').inputValue(), '10');
    const folderPageEvent = context.waitForEvent('page');
    await restored.locator('#folder-button').click();
    const folderPage = await folderPageEvent;
    await folderPage.waitForURL(`chrome-extension://${id}/folder.html?language=zh-TW`);
    await folderPage.waitForFunction(() => !document.querySelector('#language').disabled);
    assert.equal(await folderPage.locator('#language').inputValue(), '中文（繁体） · 繁體中文');
    assert.deepEqual(errors, []);
    console.log('PASS: Chinese/native/English/code search; mouse and keyboard selection; IME Enter protection; invalid input opens no windows.');
    console.log('PASS: incognito=true; reopening restores language and count; Traditional Chinese creates a separate 1-tab window; invalid stored count defaults to 10.');
    console.log('PASS: empty/fractional/out-of-range counts open no tabs; numeric arrows and live preview reflect the chosen count.');
    await fs.writeFile(path.join(__dirname, 'browser-verification.json'), JSON.stringify({
      browser: await context.browser().version(), extensionId: id,
      firstWindow: { incognito: actual.incognito, tabCount: actual.tabs.length, language: 'fr' },
      secondWindow: { tabCount: chineseTargets.length, language: 'zh-TW', separateWindow: true },
      savedLanguageRestored: true, savedCountRestored: true, popupErrors: errors,
      inputChecks: ['Chinese', 'native names', 'English names', 'case-insensitive codes', 'mouse selection', 'keyboard selection', 'IME composition', 'invalid input'],
      countChecks: ['default 10', 'custom 3', 'single tab', 'invalid counts', 'live preview', 'numeric arrows', 'invalid saved count'],
      note: 'Isolated headless Chrome profile. Google network loads are disabled; actual Chrome extension and window APIs are exercised.'
    }, null, 2));
  } finally {
    await context.close();
    // Delete only the temporary profile created by this run, in the dev directory.
    if (path.dirname(profile) !== __dirname || !path.basename(profile).startsWith('test-profile-')) throw new Error('Unexpected cleanup path');
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

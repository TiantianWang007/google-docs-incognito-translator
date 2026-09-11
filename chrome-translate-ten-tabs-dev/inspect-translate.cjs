const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://translate.google.com/?hl=zh-cn&sl=auto&tl=de&op=docs', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 15000 });
    console.log(JSON.stringify(await page.evaluate(() => ({ url: location.href, inputs: [...document.querySelectorAll('input[type=file]')].map(el => ({ html: el.outerHTML, parent: el.parentElement.outerHTML.slice(0,4000) })), text: document.body.innerText.slice(0,5500) })), null, 2));
    await page.evaluate(() => {
      const file = new File(['%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'], 'codex-upload-test.pdf', { type: 'application/pdf' });
      const data = new DataTransfer(); data.items.add(file);
      const input = [...document.querySelectorAll('input[type=file]')].find(el => el.accept.includes('.pdf'));
      input.files = data.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByText('codex-upload-test.pdf', { exact: true }).waitFor({ timeout: 10000 });
    console.log('AUTO_FILL_ACCEPTED', (await page.locator('body').innerText()).slice(-1500));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

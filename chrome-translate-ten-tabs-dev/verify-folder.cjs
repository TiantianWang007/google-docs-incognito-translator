const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const live = process.argv.includes('--live');
const auto = process.argv.includes('--auto');
const stop = process.argv.includes('--stop');
const clicks = [];
let lastStates = '';
const extensionPath = path.resolve(__dirname, '../chrome-translate-ten-tabs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, label) {
  const deadline = Date.now() + 60000;
  do { const value = await read(); if (accept(value)) return value; await delay(100); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
const fixture = '<!doctype html><html><head><meta charset="UTF-8"><title>Document upload test</title></head><body><nav><button aria-current="page">文档</button></nav><h1>文档翻译</h1><input type="file" accept="image/png,.png"><input type="file" accept="application/pdf,.pdf,.docx,.pptx,.xlsx" id="document"><p id="filename"></p><button disabled id="translate">翻译</button><script>document.querySelector("#document").addEventListener("change",event=>{const name=event.target.files[0]?.name;setTimeout(()=>{document.querySelector("#filename").textContent=name;document.querySelector("#translate").disabled=false;history.replaceState(null,"",location.href.replace("op=docs","op=translate"));},name.includes("1.pdf")?1800:0);});document.querySelector("#translate").addEventListener("click",()=>{document.body.dataset.translated="true";document.querySelector("#translate").disabled=true;});</script></body></html>';

function makePdf(text, padding=0) {
  const stream=`BT /F1 12 Tf 72 720 Td (${text}) Tj ET\n`;
  const objects=['<</Type/Catalog/Pages 2 0 R>>','<</Type/Pages/Kids[3 0 R]/Count 1>>','<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',`<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}endstream`,'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  if(padding)pdf+=`%${'x'.repeat(padding)}\n`;
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

(async () => {
  const root = await fs.mkdtemp(path.join(__dirname, 'folder-test-'));
  const inputDir = path.join(root, '测试文档'); await fs.mkdir(inputDir);
  const content = new Map([
    ['文档10.pdf', makePdf('This is document ten.',470000)],
    ['文档2.pdf', makePdf('This is document two.')],
    ['文档1.pdf', makePdf('This is document one.')]
  ]);
  for (const [name, data] of content) await fs.writeFile(path.join(inputDir, name), data);
  await fs.writeFile(path.join(inputDir, '说明.txt'), 'This file should be skipped.');
  await fs.mkdir(path.join(inputDir, '子文件夹')); await fs.writeFile(path.join(inputDir, '子文件夹', '额外.pdf'), '%PDF-1.4\n%%EOF');
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1180, height: 900 }
  });
  try {
    await context.exposeBinding('recordTranslationClick',(_source,data)=>{clicks.push(data);});
    await context.addInitScript(() => {
      document.addEventListener('click',event=>{
        const button=event.target.closest?.('button, [role="button"]');
        if(button && /^(翻译|Translate)$/i.test((button.getAttribute('aria-label')||button.innerText||'').trim())) {
          window.recordTranslationClick({name:window.__folderTestFile?.name,time:Date.now(),visibleText:button.innerText,markup:button.outerHTML.slice(0,700)}).catch(()=>{});
        }
      },true);
      document.addEventListener('change', event => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'file') {
          if (/\.pdf/.test(event.target.accept)) window.__folderTestFile = event.target.files[0];
          else if (/image\/png|\.png/.test(event.target.accept)) window.__folderImageChanges = (window.__folderImageChanges || 0) + 1;
        }
      }, true);
    });
    if (!live) await context.route('https://translate.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath, enableInIncognito: false });
    let page = await context.newPage();
    const errors = [];
    context.on('page', child => child.on('pageerror', error => { if (child.url().startsWith('chrome-extension:')) errors.push(error.message); }));
    await page.goto(`chrome-extension://${id}/folder.html?language=fr`);
    await page.waitForFunction(() => !document.querySelector('#language').disabled);
    await page.locator('#folder-input').setInputFiles(inputDir);
    assert.equal(await page.locator('#document-count').textContent(), '3');
    assert.equal(await page.locator('#permission-note').isVisible(), true);
    await page.locator('#start-button').click();
    assert.match(await page.locator('#status').textContent(), /无痕模式下启用/);
    assert.equal(context.pages().filter(item => item.url().startsWith('https://translate.google.com/')).length, 0);
    await cdp.send('Extensions.loadUnpacked', { path: extensionPath, enableInIncognito: true });
    page = await context.newPage();
    await page.goto(`chrome-extension://${id}/folder.html?language=fr`);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => !document.querySelector('#language').disabled);
    await page.locator('#folder-input').setInputFiles(inputDir);
    assert.equal(await page.locator('#document-count').textContent(), '3');
    assert.equal(await page.locator('#skipped-summary').textContent(), '已跳过 2 个文件（点击查看原因）');
    await page.locator('#include-subfolders').check();
    assert.equal(await page.locator('#document-count').textContent(), '4');
    await page.locator('#include-subfolders').uncheck();
    const order = await page.locator('.document-name').allTextContents();
    assert.deepEqual(order, ['文档1.pdf', '文档2.pdf', '文档10.pdf']);
    await page.locator('#auto-translate').setChecked(auto);
    await page.screenshot({ path: path.join(__dirname, 'folder-preview.png'), fullPage: true });
    await page.locator('#start-button').click();
    if(stop){await until(async()=>clicks.length,count=>count===1,'first translation click');await page.locator('#stop-translate').click();await delay(2600);assert.equal(clicks.length,1);}
    else await until(async () => {
      const progress = await page.locator('#progress').textContent();
      const states = await page.locator('.document-state').allTextContents();
      if (process.argv.includes('--debug') && states.join('|') !== lastStates) { lastStates = states.join('|'); console.log('STATES', progress, lastStates, 'ERRORS', errors); }
      if (progress.includes('未完成') || states.some(text=>text.includes('待确认'))) {
        const details = await page.evaluate(async()=>{const all=await chrome.storage.session.get(null);return Promise.all(Object.entries(all).filter(([key])=>key.startsWith('folder-document:')).map(async([key,item])=>({expected:{windowId:item.windowId,language:item.language,name:item.metadata.name},actual:await chrome.tabs.get(Number(key.split(':')[1]))})));});
        const googleState = await Promise.all(context.pages().filter(p=>p.url().startsWith('https://translate.google.com/')).map(p=>p.evaluate(()=>({url:location.href,text:document.body.innerText,buttons:[...document.querySelectorAll('button,[role="button"]')].filter(el=>/翻译|Translate/i.test(el.innerText+' '+el.getAttribute('aria-label'))).map(el=>({text:el.innerText,aria:el.getAttribute('aria-label'),html:el.outerHTML.slice(0,1000)}))}))));
        throw new Error(`Document error: ${states}\n${JSON.stringify({details,googleState,clicks})}`);
      }
      return progress;
    }, text => text === (auto?'已点击 3/3':'已放入 3/3'), 'all three documents handled');
    if(auto&&!stop){
      await until(async()=>clicks.length,count=>count===3,'all translation clicks');
      assert.deepEqual(clicks.map(item=>item.name),order);
      assert.ok(clicks[1].time-clicks[0].time>=1800);assert.ok(clicks[2].time-clicks[1].time>=1800);
      const repeated=await page.evaluate(async()=>{const all=await chrome.storage.session.get(null);const entry=Object.entries(all).find(([key,item])=>key.startsWith('folder-document:')&&item.index===0);const [key,item]=entry;return chrome.runtime.sendMessage({type:'CLICK_FOLDER_TRANSLATE',managerId:item.managerId,batchId:item.batchId,documentId:item.documentId,tabId:Number(key.split(':')[1])});});
      assert.equal(repeated.clicked,true);await delay(100);assert.equal(clicks.length,3);
    }else if(!auto)assert.equal(clicks.length,0);
    const targets = await page.evaluate(async () => (await chrome.windows.getAll({ populate: true })).filter(window => window.incognito));
    assert.equal(targets.length, 1); assert.equal(targets[0].tabs.length, 3);
    const tabs = targets[0].tabs.sort((a,b) => a.index-b.index);
    const results = [];
    for (let i = 0; i < tabs.length; i++) {
      const tabId = tabs[i].id;
      const googlePage = await until(async () => {
        for (const candidate of context.pages().filter(p => p.url().startsWith('https://translate.google.com/'))) {
          await candidate.bringToFront();
          const activeId = await page.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, targets[0].id);
          if (activeId === tabId) return candidate;
        }
      }, Boolean, `document tab ${i+1}`);
      const data = await googlePage.evaluate(async () => {
        // Google removes its file input after accepting a document. Keep the
        // actual File received by its change event in the test-only observer.
        const file = window.__folderTestFile;
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(n => n.toString(16).padStart(2,'0')).join('');
        return { name: file.name, size: file.size, hash, imageCount: window.__folderImageChanges || 0, text: document.body.innerText, translated: document.body.dataset.translated };
      });
      assert.equal(data.name, order[i]);
      assert.equal(data.hash, crypto.createHash('sha256').update(content.get(data.name)).digest('hex'));
      assert.equal(data.imageCount, 0);
      assert.ok(data.text.includes(data.name), `Filename missing from Google UI: ${data.name}\n${data.text.slice(-2000)}`);
      if(!auto)assert.notEqual(data.translated, 'true');
      assert.equal(new URL(googlePage.url()).searchParams.get('tl'), 'fr');
      results.push({ tabId, name: data.name, size: data.size, hash: data.hash });
    }
    assert.deepEqual(errors, []);
    const suffix=live?'live-auto':stop?'stop':auto?'auto':'manual';
    await page.screenshot({ path: path.join(__dirname, `folder-${suffix}-complete.png`), fullPage: true });
    await fs.writeFile(path.join(__dirname, `folder-${suffix}-verification.json`), JSON.stringify({ mode: live ? 'live Google Translate' : 'local document page fixture', browser: await context.browser().version(), tabs: results, incognito: true, pageErrors: errors, autoTranslate:auto, stopped:stop, clicks }, null, 2));
    console.log('PASS', live ? 'LIVE GOOGLE' : 'FIXTURE',suffix,'folder selection, natural order, SHA-256 integrity, translation click count/order/spacing, duplicate prevention.');
  } finally {
    await context.close();
    if (path.dirname(root) !== __dirname || !path.basename(root).startsWith('folder-test-')) throw new Error('Unexpected cleanup path');
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


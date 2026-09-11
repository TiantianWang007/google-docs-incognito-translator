import test from 'node:test';
import assert from 'node:assert/strict';
import { listDocuments, MAX_DOCUMENT_BYTES, CHUNK_BYTES } from '../chrome-translate-ten-tabs/folder-files.mjs';
import { createFolderBroker } from '../chrome-translate-ten-tabs/folder-broker.mjs';

const file = (name, extra = {}) => ({ name, size: 42, webkitRelativePath: `folder/${name}`, ...extra });
test('natural file ordering, supported formats, and explicit skip reasons', () => {
  const files = [file('10.pdf'), file('2.DOCX'), file('1.pptx'), file('3.xlsx'), file('note.txt'), file('empty.pdf', {size:0}), file('large.pdf', {size:MAX_DOCUMENT_BYTES+1}), file('~$temp.docx'), file('nested.pdf', {webkitRelativePath:'folder/sub/nested.pdf'})];
  const { accepted, skipped } = listDocuments(files);
  assert.deepEqual(accepted.map(f => f.name), ['1.pptx','2.DOCX','3.xlsx','10.pdf']);
  assert.equal(skipped.length, 5);
  assert.equal(listDocuments(files, true).accepted.length, 5);
  assert.equal(listDocuments([file('max.pdf', {size:MAX_DOCUMENT_BYTES})]).accepted.length, 1);
});

function setup({ allowed = true } = {}) {
  const store = {}, windows = [], messages = [], saved = [];
  const api = {
    runtime: { id:'test', getURL: path => `chrome-extension://test/${path}`, sendMessage: async message => { messages.push(message); return {ok:true, data:'YWJj'}; } },
    extension: { isAllowedIncognitoAccess: async () => allowed },
    storage: {
      session: { get: async key => ({[key]:store[key]}), set: async entries => Object.assign(store,entries), remove: async key => { delete store[key]; } },
      local: { set: async data => { saved.push(data); } }
    },
    windows: { create: async data => { windows.push(data); return {id:5, tabs:data.url.map((_,index)=>({id:100+index,index})).reverse()}; } }
  };
  const manager = { id:'test', url:'chrome-extension://test/folder.html?language=de' };
  const page = { id:'test', frameId:0, tab:{id:100,incognito:true}, url:'https://translate.google.com/?sl=auto&tl=de&op=docs' };
  const request = { type:'OPEN_FOLDER_BATCH', managerId:'manager', batchId:'batch', language:'de', documents:[{id:'document1',name:'1.pdf',size:CHUNK_BYTES+3,type:'application/pdf',lastModified:0}] };
  return { broker:createFolderBroker(api), api, store, windows, messages, saved, manager, page, request };
}

test('folder size determines tab count beyond the ordinary 100-tab setting and maps by index', async () => {
  const { broker, manager, request, windows, store, saved } = setup();
  request.documents = Array.from({length:103}, (_,index)=>({id:`doc${index}`,name:`${index}.pdf`,size:20}));
  const result = await broker.handle(request,manager);
  assert.equal(windows.length,1); assert.equal(windows[0].url.length,103); assert.equal(windows[0].incognito,true);
  assert.equal(result.tabs[0].documentId,'doc0'); assert.equal(result.tabs[102].tabId,202);
  assert.equal(store['folder-document:100'].metadata.name,'0.pdf');
  assert.deepEqual(saved,[{targetLanguage:'de',autoTranslate:false}]);
});

test('incognito permission or invalid files cause no partial opening', async () => {
  const denied = setup({allowed:false});
  await assert.rejects(denied.broker.handle(denied.request,denied.manager),/无痕模式下启用/);
  assert.equal(denied.windows.length,0);
  const invalid = setup(); invalid.request.documents[0].size=MAX_DOCUMENT_BYTES+1;
  await assert.rejects(invalid.broker.handle(invalid.request,invalid.manager),/文档列表无效/);
  assert.equal(invalid.windows.length,0);
});

test('only the assigned incognito document tab can request its file chunks', async () => {
  const { broker, request, manager, page, messages } = setup();
  await broker.handle(request,manager);
  const context = await broker.handle({type:'GET_FOLDER_DOCUMENT'},page);
  assert.equal(context.document.name,'1.pdf');
  const chunk = {type:'READ_FOLDER_CHUNK',batchId:'batch',offset:CHUNK_BYTES};
  await broker.handle(chunk,page);
  assert.equal(messages.at(-1).documentId,'document1'); assert.equal(messages.at(-1).length,3);
  for (const sender of [{...page,url:'https://example.com/?op=docs'}, {...page,frameId:1}, {...page,tab:{id:100,incognito:false}}]) {
    await assert.rejects(broker.handle(chunk,sender),/不属于/);
  }
  await assert.rejects(broker.handle({...chunk,batchId:'wrong'},page),/批次/);
  await assert.rejects(broker.handle({...chunk,offset:1},page),/位置/);
  const before=messages.length;
  assert.equal((await broker.handle(chunk,{...page,tab:{id:999,incognito:true}})).document,null);
  assert.equal(messages.length,before);
});

test('closing a tab removes its assignment and a lost source yields an actionable error', async () => {
  const { broker, request, manager, page, store, api }=setup();
  await broker.handle(request,manager);
  api.runtime.sendMessage=async()=>{throw new Error('Receiving end does not exist');};
  await assert.rejects(broker.handle({type:'READ_FOLDER_CHUNK',batchId:'batch',offset:0},page),/文件夹页面已关闭/);
  await broker.tabRemoved(100);
  assert.equal(store['folder-document:100'],undefined);
});

test('auto-click is opt-in and a completed request is never sent twice, even after worker restart', async () => {
  const { broker, api, request, manager, store }=setup();
  let clicks=0;
  api.tabs={get:async()=>({incognito:true,windowId:5,url:'https://translate.google.com/?tl=de&op=docs'}),sendMessage:async()=>{clicks++;return {ok:true,clicked:true};}};
  await broker.handle(request,manager);
  const command={type:'CLICK_FOLDER_TRANSLATE',managerId:'manager',batchId:'batch',documentId:'document1',tabId:100};
  await assert.rejects(broker.handle(command,manager),/未开启/);
  store['folder-document:100'].autoTranslate=true;
  const results=await Promise.all([broker.handle(command,manager),broker.handle(command,manager)]);
  assert.ok(results.every(result=>result.clicked)); assert.equal(clicks,1);
  assert.equal((await createFolderBroker(api).handle(command,manager)).clicked,true);
  assert.equal(clicks,1);
});

test('lost click replies are marked uncertain and never automatically retried', async () => {
  const { broker, api, request, manager }=setup(); request.autoTranslate=true;
  let clicks=0;
  api.tabs={get:async()=>({incognito:true,windowId:5,url:'https://translate.google.com/?tl=de&op=docs'}),sendMessage:async()=>{clicks++;throw new Error('Port closed');}};
  await broker.handle(request,manager);
  const command={type:'CLICK_FOLDER_TRANSLATE',managerId:'manager',batchId:'batch',documentId:'document1',tabId:100};
  assert.equal((await broker.handle(command,manager)).uncertain,true);
  assert.equal((await createFolderBroker(api).handle(command,manager)).uncertain,true);
  assert.equal(clicks,1);
});

test('a navigated tab or a different manager cannot trigger a translation', async () => {
  const { broker, api, request, manager }=setup(); request.autoTranslate=true;
  let clicks=0;
  api.tabs={get:async()=>({incognito:true,windowId:5,url:'https://translate.google.com/?tl=fr&op=docs'}),sendMessage:async()=>{clicks++;}};
  await broker.handle(request,manager);
  const command={type:'CLICK_FOLDER_TRANSLATE',managerId:'manager',batchId:'batch',documentId:'document1',tabId:100};
  await assert.rejects(broker.handle({...command,managerId:'other'},manager),/未开启/);
  await assert.rejects(broker.handle(command,manager),/语言已经改变/);
  assert.equal(clicks,0);
});

test('Google document route rewrites are checked by the content script before clicking', async () => {
  const { broker, api, request, manager, page }=setup(); request.autoTranslate=true;
  const responses=[];
  api.tabs={get:async()=>({incognito:true,windowId:5,url:'https://translate.google.com/?tl=de&op=translate'}),sendMessage:async(tabId,message)=>{responses.push(message);return {ok:true,clicked:true};}};
  await broker.handle(request,manager);
  const rewritten={...page,url:page.url.replace('op=docs','op=translate')};
  assert.equal((await broker.handle({type:'GET_FOLDER_DOCUMENT'},rewritten)).document.name,'1.pdf');
  const result=await broker.handle({type:'CLICK_FOLDER_TRANSLATE',managerId:'manager',batchId:'batch',documentId:'document1',tabId:100},manager);
  assert.equal(result.clicked,true); assert.equal(responses.length,1);
  assert.equal(responses[0].language,'de'); assert.equal(responses[0].documentId,'document1');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createTranslationQueue } from '../chrome-translate-ten-tabs/translation-queue.mjs';
async function until(predicate) { for(let i=0;i<100;i++){if(predicate())return;await setImmediate();}throw new Error('Queue did not settle'); }
test('later pages wait for the first document; clicks follow list order with spacing', async()=>{
  const rows=[{id:1,state:'waiting'},{id:2,state:'loaded'},{id:10,state:'loaded'}];
  const clicked=[],waits=[];
  const queue=createTranslationQueue({translate:async row=>{clicked.push(row.id);return {clicked:true};},onStart:row=>row.state='clicking',onResult:row=>row.state='clicked',onChange:()=>{},wait:async ms=>{waits.push(ms);}});
  queue.start(rows); await setImmediate(); assert.deepEqual(clicked,[]);
  rows[0].state='loaded';queue.kick();queue.kick();
  await until(()=>!queue.active);
  assert.deepEqual(clicked,[1,2,10]);assert.deepEqual(waits,[2000,2000]);
});
test('failed file loads are skipped and uncertain click results are not retried',async()=>{
  const rows=[{id:1,state:'error'},{id:2,state:'loaded'},{id:3,state:'loaded'}]; const clicked=[];
  const queue=createTranslationQueue({translate:async row=>{clicked.push(row.id);if(row.id===2)throw new Error('Lost response');return {clicked:true};},onStart:row=>row.state='clicking',onResult:(row,result)=>row.state=result.uncertain?'uncertain':'clicked',onChange:()=>{},wait:async()=>{}});
  queue.start(rows);await until(()=>!queue.active);queue.kick();
  assert.deepEqual(clicked,[2,3]);assert.equal(rows[1].state,'uncertain');
});
test('stop during a pending click prevents every later click',async()=>{
  const rows=[{id:1,state:'loaded'},{id:2,state:'loaded'}];const clicked=[];let finish;
  const queue=createTranslationQueue({translate:row=>{clicked.push(row.id);return new Promise(resolve=>{finish=resolve;});},onStart:row=>row.state='clicking',onResult:row=>row.state='clicked',onChange:()=>{},wait:async()=>{}});
  queue.start(rows);queue.stop();finish({clicked:true});await setImmediate();
  assert.deepEqual(clicked,[1]);assert.equal(rows[1].state,'loaded');assert.equal(queue.active,false);
});

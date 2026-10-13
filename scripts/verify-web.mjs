import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/model.mjs';

const cacheRoot=path.join(ROOT,'.cache');
await mkdir(cacheRoot,{recursive:true});
const work=await mkdtemp(path.join(cacheRoot,'web-test-'));
const server=spawn(process.execPath,[path.join(ROOT,'scripts/serve-web.mjs')],{windowsHide:true,env:{...process.env,RELEASE_SIEVE_PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
const evidence={verifiedAt:new Date().toISOString(),checks:{},runs:[]};
const url=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Local app server did not start.')),15000);
  server.stdout.on('data',bytes=>{const match=bytes.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  server.once('error',reject);
  server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local server exited ${code}`));});
});

async function exportJSON(page,name){
  const pending=page.waitForEvent('download');
  await page.locator('#export-json').click();
  const download=await pending;
  const target=path.join(work,name+'.json');
  await download.saveAs(target);
  return JSON.parse(await readFile(target,'utf8'));
}
async function ready(page){
  await Promise.race([
    page.locator('#run-status').filter({hasText:'Review ready.'}).waitFor({timeout:120000}),
    page.locator('#retry-button').waitFor({timeout:120000}).then(async()=>{throw new Error(await page.locator('#run-detail').innerText());}),
  ]);
  assert.equal(await page.locator('#results').isVisible(),true);
}
async function run(page){await page.locator('#run-button').click();await ready(page);}
try{
  browser=await chromium.launch({channel:process.env.RELEASE_SIEVE_BROWSER||'msedge',headless:true,chromiumSandbox:true,env:{...process.env,...(process.env.RELEASE_SIEVE_TEST_TMP?{TEMP:process.env.RELEASE_SIEVE_TEST_TMP,TMP:process.env.RELEASE_SIEVE_TEST_TMP}:{})}});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
  const requests=[],errors=[];
  context.on('request',request=>requests.push({url:request.url(),method:request.method(),body:request.postData()}));
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url,{waitUntil:'load'});
  await page.locator('#changes-input').waitFor();
  assert.equal(await page.locator('#changes-count').innerText(),'6 changes');
  assert.equal(await page.locator('#notes-count').innerText(),'4 notes');
  await run(page);
  const cold=await exportJSON(page,'cold');
  assert.deepEqual(cold.summary,{changes:6,notes:4,needsReview:3,matched:1,internal:2});
  assert.equal(cold.model.device,'wasm');
  assert.equal(cold.diagnostics.reusedModel,false);
  assert.equal(cold.diagnostics.downloadedBytes,37974266);
  evidence.runs.push({name:'cold synthetic example',summary:cold.summary,diagnostics:cold.diagnostics});
  evidence.checks.realWasmInference=true;
  console.log('PASS: real cold WASM inference, SHA-verified assets, expected 3/1/2 synthetic result.');

  await page.locator('[data-filter="review"]').click();
  assert.equal(await page.locator('#change-results .change-card:visible').count(),3);
  await page.locator('#result-search').fill('timezone');
  assert.equal(await page.locator('#change-results .change-card:visible').count(),1);
  await page.locator('#result-search').fill('no-such-synthetic-evidence');
  assert.equal(await page.locator('#no-results').isVisible(),true);
  await page.locator('#result-search').fill('');
  await page.locator('[data-filter="all"]').click();
  assert.equal(await page.locator('#change-results .change-card:visible').count(),6);
  await page.locator('[data-filter="all"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-filter="review"]').evaluate(node=>node===document.activeElement),true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#change-results .change-card:visible').count(),3);
  await page.locator('[data-filter="all"]').click();
  evidence.checks.filtersSearchKeyboard=true;

  for(const [selector,name,pattern] of [['#export-markdown','review.md',/^# Release Sieve/],['#export-html','review.html',/<!doctype html>/i]]){
    const pending=page.waitForEvent('download');await page.locator(selector).click();
    const download=await pending;await download.saveAs(path.join(work,name));
    assert.match(await readFile(path.join(work,name),'utf8'),pattern);
  }
  evidence.checks.exports=['json','markdown','html'];
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#workbench').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(ROOT,'demo/web-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(ROOT,'demo/web-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  evidence.checks.desktopAndMobileNoOverflow=true;

  const beforeWarm=requests.filter(request=>/^https?:/.test(request.url)).length;
  await context.setOffline(true);
  await run(page);
  const warm=await exportJSON(page,'warm');
  assert.equal(warm.diagnostics.reusedModel,true);
  assert.equal(warm.diagnostics.downloadedBytes,0);
  assert.equal(requests.filter(request=>/^https?:/.test(request.url)).length,beforeWarm);
  assert.deepEqual(warm.summary,cold.summary);
  await context.setOffline(false);
  evidence.runs.push({name:'warm open-page offline review',summary:warm.summary,diagnostics:warm.diagnostics});
  evidence.checks.warmOfflineReuse=true;

  await page.locator('#example-select').selectOption('missing-note');
  await page.locator('#load-example').click();
  await run(page);
  const before=await exportJSON(page,'missing');
  assert.equal(before.summary.needsReview,1);
  await page.locator('#add-example-note').click();
  await run(page);
  const after=await exportJSON(page,'repaired');
  assert.equal(after.summary.matched,1);
  assert.equal(after.summary.needsReview,0);
  evidence.checks.noteEditChangesRealResult=true;
  evidence.runs.push({name:'missing note before and after edit',before:before.summary,after:after.summary});

  const marker='SYNTHETIC_LOCAL_EVIDENCE_42';
  await page.locator('#changes-file').setInputFiles({name:'changes.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{id:'uploaded',subject:`feat: restore deleted workspaces ${marker}`,files:['src/restore.ts']}]))});
  await page.locator('#notes-file').setInputFiles({name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('- Deleted workspaces can now be restored.')});
  await run(page);
  const uploaded=await exportJSON(page,'uploaded');
  assert.equal(uploaded.changes[0].id,'uploaded');
  assert.ok(uploaded.changes[0].subject.includes(marker));
  assert.ok(requests.every(request=>!request.url.includes(marker)&&!String(request.body).includes(marker)));
  const networkRequests=requests.filter(request=>/^https?:/.test(request.url));
  const unexpectedRequests=networkRequests.filter(request=>request.method!=='GET'||request.body!=null||new URL(request.url).origin!==url);
  if(unexpectedRequests.length)console.log(JSON.stringify({unexpectedRequests}));
  assert.deepEqual(unexpectedRequests,[]);
  assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
  const cacheKeys=await page.evaluate(async()=>{const keys=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())keys.push(request.url);return keys;});
  assert.equal(cacheKeys.length,6);
  assert.ok(cacheKeys.every(key=>key.includes('/models/')||key.endsWith('.wasm')||key.endsWith('.mjs')));
  evidence.checks.uploadsAndDataIsolation=true;

  await page.evaluate(()=>{
    const original=File.prototype.text;
    globalThis.restoreFileReader=()=>{File.prototype.text=original;};
    File.prototype.text=function(){return new Promise(resolve=>{globalThis.finishSyntheticRead=()=>original.call(this).then(resolve);});};
  });
  await page.locator('#changes-file').setInputFiles({name:'slow.json',mimeType:'application/json',buffer:Buffer.from('[{"id":"slow","subject":"feat: restore a workspace"}]')});
  assert.equal(await page.locator('#run-button').isEnabled(),false);
  assert.match(await page.locator('#changes-feedback').innerText(),/Reading file/);
  await page.locator('#clear-button').click();
  await page.evaluate(async()=>{await globalThis.finishSyntheticRead();globalThis.restoreFileReader();});
  assert.equal(await page.locator('#changes-input').inputValue(),'');
  assert.equal(await page.locator('#run-button').isEnabled(),true);
  evidence.checks.slowUploadGateAndClear=true;

  const beforeMalformed=requests.length;
  await page.locator('#changes-input').fill('[{"id":]');
  await page.locator('#run-button').click();
  await page.locator('#run-status').filter({hasText:'Check your inputs'}).waitFor();
  assert.match(await page.locator('#changes-feedback').innerText(),/Invalid JSON/);
  assert.equal(requests.length,beforeMalformed);
  assert.equal(await page.locator('#results').isVisible(),false);
  evidence.checks.malformedInputBeforeDownloads=true;
  await page.locator('#clear-button').click();
  assert.equal(await page.locator('#changes-input').inputValue(),'');
  assert.equal(await page.locator('#notes-input').inputValue(),'');
  assert.equal(await page.locator('#results').isVisible(),false);
  evidence.checks.clearRemovesDraftAndResult=true;

  // A fresh context with a deliberately delayed fixed public asset exercises true download cancellation.
  const cancelContext=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const cancelPage=await cancelContext.newPage();
  let intercepted;
  const paused=new Promise(resolve=>{intercepted=resolve;});
  let heldRoute;
  await cancelContext.route('**/models/**/config.json',route=>{heldRoute=route;intercepted();});
  await cancelPage.goto(url);
  await cancelPage.locator('#run-button').click();
  await paused;
  await cancelPage.locator('#cancel-button').click();
  await cancelPage.locator('#run-status').filter({hasText:'cancelled'}).waitFor();
  assert.equal(await cancelPage.locator('#run-button').isEnabled(),true);
  assert.equal(await cancelPage.locator('#results').isVisible(),false);
  assert.ok((await cancelPage.locator('#changes-input').inputValue()).length>0);
  await heldRoute.abort().catch(()=>{});
  await cancelContext.unroute('**/models/**/config.json');
  await run(cancelPage);
  evidence.checks.cancelAndRestart=true;
  await cancelContext.close();

  // A failed fixed-asset download must show a retry flow; the eventual result still uses the actual model.
  const failureContext=await browser.newContext();
  const failurePage=await failureContext.newPage();
  await failureContext.route('**/models/**/config.json',route=>route.fulfill({status:503,body:'Synthetic unavailable-asset test'}));
  await failurePage.goto(url);await failurePage.locator('#run-button').click();
  await failurePage.locator('#retry-button').waitFor();
  assert.equal(await failurePage.locator('#results').isVisible(),false);
  assert.match(await failurePage.locator('#run-detail').innerText(),/503/);
  await failureContext.unroute('**/models/**/config.json');
  await failurePage.locator('#retry-button').click();await ready(failurePage);
  evidence.checks.assetFailureAndRetry=true;
  await failureContext.close();
  assert.deepEqual(errors,[]);
  evidence.checks.javascriptErrors=0;
  evidence.checks.requestsContainedInput=false;
  evidence.browser=await browser.version();
  evidence.caveat='Synthetic workflow verification with real WASM inference; no production accuracy or performance claim.';
  await writeFile(path.join(ROOT,'demo/web-verification.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('PASS: warm offline reuse, repaired note, uploads, exports, keyboard/mobile, malformed input, cancel/restart, asset failure/retry, and no input network or draft storage.');
}finally{
  if(browser)await browser.close();
  server.kill();
  const resolved=path.resolve(work);
  if(path.dirname(resolved)!==path.resolve(cacheRoot)||!path.basename(resolved).startsWith('web-test-'))throw new Error('Unsafe test artifact cleanup');
  await rm(resolved,{recursive:true,force:true});
}

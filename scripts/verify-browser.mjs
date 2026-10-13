import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/model.mjs';

// Use an installed browser; no browser binary is downloaded by this script.
const browser = await chromium.launch({
  channel: process.env.RELEASE_SIEVE_BROWSER || 'msedge', headless: true, chromiumSandbox: true,
  env: { ...process.env, ...(process.env.RELEASE_SIEVE_TEST_TMP ? { TEMP:process.env.RELEASE_SIEVE_TEST_TMP, TMP:process.env.RELEASE_SIEVE_TEST_TMP } : {}) },
});
try {
  const page = await browser.newPage({ viewport: { width:1280, height:900 }, reducedMotion:'reduce' });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.setContent(await readFile(path.join(ROOT,'demo/output/audit.html'),'utf8'), {waitUntil:'load'});
  assert.equal(await page.locator('[data-change-index]:visible').count(),6);
  assert.ok(await page.getByText('Synthetic demo', {exact:false}).count());
  await page.locator('[data-filter="all"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-filter="review"]').evaluate(node=>node===document.activeElement),true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-change-index]:visible').count(),3);
  await page.locator('#evidence-search').fill('timezone');
  assert.equal(await page.locator('[data-change-index]:visible').count(),1);
  await page.locator('#evidence-search').fill('no-such-change');
  assert.equal(await page.locator('[data-change-index]:visible').count(),0);
  assert.equal(await page.locator('#empty-state').isVisible(),true);
  await page.locator('#evidence-search').fill('');
  await page.locator('[data-filter="matched"]').click();
  assert.equal(await page.locator('[data-change-index]:visible').count(),1);
  await page.locator('[data-filter="internal"]').click();
  assert.equal(await page.locator('[data-change-index]:visible').count(),2);
  await page.locator('[data-filter="all"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(ROOT,'demo/report-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(ROOT,'demo/report-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests,[]);
  await writeFile(path.join(ROOT,'demo/browser-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),browser:await browser.version(),checks:{keyboardFilters:true,search:true,emptyState:true,desktopNoOverflow:true,mobileNoOverflow:true,externalRequests:0,javascriptErrors:0},screenshots:['report-desktop.png','report-mobile.png']},null,2)+'\n');
  console.log('PASS: real browser keyboard filters, search, empty states, 1280/390px layout, no network requests or JavaScript errors.');
} finally { await browser.close(); }

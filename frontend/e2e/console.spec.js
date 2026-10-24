import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function login(page) {
  const text=fs.readFileSync('../.local/dev.env','utf8');
  const token=text.match(/^CLOUDSPHERE_OPERATOR_TOKEN=(.+)$/m)[1];
  await page.goto('/');
  const health=await page.request.get('/api/health');
  expect(health.ok()).toBe(true);expect((await health.json()).service).toBe('cloudsphere');
  await page.getByLabel('Operator token',{exact:true}).fill(token);
  await page.getByRole('button',{name:'Open workspace'}).click();
  await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
}
async function finish(page,name) {
  await page.getByRole('button',{name:'Submit workload',exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible({timeout:45000});
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download results',exact:true}).click();
  const download=await downloaded;
  expect(download.suggestedFilename()).toMatch(/cloudsphere-.*\.zip/);
  const stream=await download.createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  expect(Buffer.concat(chunks).subarray(0,2).toString()).toBe('PK');
}

test('CSV upload is discoverable, previews data, runs the selected aggregation and downloads output',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:1000});
  await login(page);
  await page.getByRole('button',{name:'How CloudSphere works'}).click();
  await expect(page.getByRole('dialog',{name:'How a workload runs'})).toBeVisible();
  await page.getByRole('button',{name:'Got it'}).click();
  await page.screenshot({path:'../.local/overview-redesigned.png',fullPage:true});
  await page.getByRole('link',{name:'Upload & run',exact:true}).click();
  await expect(page.getByRole('button',{name:'Browse files',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'../.local/upload-redesigned.png',fullPage:true});
  await page.getByLabel('Upload CSV file',{exact:true}).setInputFiles({name:'sales-demo.csv',mimeType:'text/csv',buffer:fs.readFileSync('../examples/sales.csv')});
  await expect(page.getByRole('columnheader',{name:'category',exact:true})).toBeVisible();
  await page.screenshot({path:'../.local/upload-preview.png',fullPage:true});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel(/Workload name/).fill('Sales summary from browser');
  await page.getByLabel(/Group rows by/).selectOption('category');
  await page.getByLabel(/Calculate the sum of/).selectOption('amount');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ready to submit',exact:true})).toBeVisible();
  await expect(page.getByText('sales-demo.csv',{exact:true})).toBeVisible();
  await finish(page,'Sales summary from browser');
  await expect(page.getByText('Rows processed',{exact:true})).toBeVisible();
  await expect(page.locator('.result-stats').getByText('4',{exact:true})).toBeVisible();
  await expect(page.locator('.input-file').getByText('sales-demo.csv',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Scheduling decision inspector',exact:true})).toBeVisible();
  await page.screenshot({path:'../.local/results-redesigned.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('CPU benchmark requires no upload and mobile navigation stays within the viewport',async({page})=>{
  await login(page);
  await page.getByRole('link',{name:/Run a CPU benchmark/}).click();
  await expect(page.getByRole('heading',{name:'No file upload needed'})).toBeVisible();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel(/Workload name/).fill('Browser prime benchmark');
  await page.getByLabel(/Find primes up to/).fill('100');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await finish(page,'Browser prime benchmark');
  await expect(page.locator('.result-stats').getByText('25',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Toggle navigation'}).click();
  await page.getByRole('link',{name:'Workloads',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Workloads',exact:true})).toBeVisible();
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  await page.locator('.sidebar').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'../.local/workloads-mobile.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Toggle navigation'}).click();
  await page.locator('.sidebar').getByRole('link',{name:/New workload/}).click();
  await expect(page.getByRole('button',{name:'Browse files',exact:true})).toBeVisible();
  await page.locator('.sidebar').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'../.local/upload-mobile.png',fullPage:true,animations:'disabled'});
});

test('image upload runs a real resize job with the configured output size',async({page})=>{
  await login(page);await page.getByRole('link',{name:/Resize images/}).click();
  await page.getByLabel('Upload image or ZIP file',{exact:true}).setInputFiles({name:'source-image.png',mimeType:'image/png',buffer:fs.readFileSync('../examples/sample.png')});
  await expect(page.getByRole('img',{name:'Preview of source-image.png'})).toBeVisible();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel(/Workload name/).fill('Browser image resize');
  await page.getByLabel(/Maximum thumbnail size/).selectOption('64');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await finish(page,'Browser image resize');
  await expect(page.getByText('Images processed',{exact:true})).toBeVisible();
  await expect(page.locator('.result-stats').getByText('1',{exact:true})).toBeVisible();
  await expect(page.locator('.result-stats').getByText('64 × 64 px',{exact:true})).toBeVisible();
});

test('the documented messy sample produces actual quality statistics, grouped output and an explained download',async({page})=>{
  await login(page);await page.goto('/workloads/new');
  await expect(page.getByRole('heading',{name:'Your CSV. A specific question. A usable result.'})).toBeVisible();
  const card=page.locator('.dataset-examples article').filter({has:page.getByRole('heading',{name:'Clean a messy dataset'})});
  await card.getByRole('button',{name:'Use sample'}).click();
  await expect(page.getByRole('columnheader',{name:'order_id',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Remove exact duplicate rows')).toBeChecked();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await finish(page,'Clean a messy dataset');
  await expect(page.getByRole('heading',{name:'Data quality report',exact:true})).toBeVisible();
  await expect(page.getByText('Removed: 3 rows',{exact:true})).toBeVisible();
  const aggregate=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'amount by category',exact:true})});
  await expect(aggregate.getByRole('cell',{name:'10,300',exact:true})).toBeVisible();
  await expect(page.getByText('Statistical outliers: 1',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Inside your results ZIP',exact:true})).toBeVisible();
  await page.screenshot({path:'../.local/data-quality-report.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('scheduling lab executes two real policy batches and compares measured results',async({page})=>{
  test.setTimeout(150000);
  await login(page);await page.getByRole('link',{name:'Scheduling lab',exact:true}).click();
  for(const [algorithm,name] of [['round_robin','Browser RR trial'],['least_loaded','Browser LL trial']]) {
    await page.getByLabel('Experiment name',{exact:true}).fill(name);
    await page.getByLabel('Jobs in batch').fill('2');
    await page.getByRole('combobox',{name:'Scheduling policy',exact:true}).selectOption(algorithm);
    await page.getByRole('button',{name:'Start real batch'}).click();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(page.getByText('2 / 2 completed · 0 failed · 0 cancelled',{exact:true})).toBeVisible({timeout:65000});
    await expect(page.locator('.lab-measures').getByText('Batch time')).toBeVisible();
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export measurements'}).click();
    const download=await event;expect(download.suggestedFilename()).toMatch(/experiment.*\.csv/);
    await page.getByRole('link',{name:'Scheduling lab',exact:true}).last().click();
  }
  await page.getByLabel('Select Browser RR trial',{exact:true}).first().check();
  await page.getByLabel('Select Browser LL trial',{exact:true}).first().check();
  await page.getByRole('button',{name:'Compare selected'}).click();
  await expect(page.getByRole('heading',{name:'Policy comparison',exact:true})).toBeVisible();
  await expect(page.getByText(/Matching conditions do not control host background load/)).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'../.local/scheduling-comparison.png',fullPage:true});
});

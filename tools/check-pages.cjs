const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  let server;
  if(process.argv.includes('--serve')){
    const {spawn} = require('node:child_process');
    const path = require('node:path');
    server = spawn(process.execPath, [path.join(__dirname,'serve.mjs'), path.join(__dirname,'../release'), '5185'], {stdio:['ignore','pipe','inherit']});
    await new Promise((resolve,reject) => { server.stdout.once('data',resolve); server.once('error',reject); server.once('exit',code=>reject(Error('Server exited '+code))); });
  }
  const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_PATH});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => console.log('FAILED', r.url(), r.failure()?.errorText));
    page.on('response', r => { if(r.status() >= 400) console.log('HTTP',r.status(),r.url()); });
    const target = process.argv[2] || 'https://reeyan-afzal-khan.github.io/HANZAI-ORIGINS/';
    await page.goto(target, {waitUntil:'load'});
    await page.waitForTimeout(3000);
    console.log(JSON.stringify({errors, state:await page.evaluate(() => ({
      title:document.title, text:document.body.innerText.slice(-4500),
      scripts:[...document.scripts].map(s=>s.src).filter(Boolean),
      worker:navigator.serviceWorker.controller?.scriptURL,
    }))},null,2));
    if(process.argv.includes('--verify')){
      if(errors.length) throw Error(errors.join('\n'));
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      await page.evaluate(() => localStorage.setItem('pages-check-progress', 'preserve-me'));
      await page.reload();
      await page.waitForFunction(() => typeof booted !== 'undefined' && booted);
      await page.context().setOffline(true);
      await page.reload();
      await page.waitForFunction(() => typeof booted !== 'undefined' && booted);
      await page.context().setOffline(false);
      await page.goto(new URL('recover.html', target).href);
      await page.locator('#refresh').click();
      await page.waitForURL('**/index.html?refresh=*');
      await page.waitForFunction(() => typeof booted !== 'undefined' && booted);
      if(await page.evaluate(() => localStorage.getItem('pages-check-progress')) !== 'preserve-me') throw Error('Recovery removed saved state');
      console.log('PASS: HTTP subpath startup, worker-controlled reload, offline reload, recovery preserving saved state');
    }
  } finally { await browser.close(); if(server) server.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1});

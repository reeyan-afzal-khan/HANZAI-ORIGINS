// Smoke-test the built app with Playwright. Set PLAYWRIGHT_MODULE and BROWSER_PATH
// when using an existing local installation instead of Playwright's defaults.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../release/web/index.html')).href);
    await page.waitForTimeout(1500);
    const welcome = page.locator('#welcome');
    if (await welcome.isVisible()) await page.locator('#wl-go').click();
    await page.waitForFunction(() => typeof CT !== 'undefined' && CT.root === '\u6c38');
    for (const width of [1850, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['chars', 'read', 'settings']) {
        await page.locator(`#nav [data-v="${view}"]`).click();
        await page.waitForTimeout(400);
        if (!(await page.locator(`#v-${view}`).isVisible())) throw Error(`${view} not visible`);
        if (await page.locator('#boom').count()) throw Error(await page.locator('#boom').innerText());
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        if (overflow) throw Error(`Horizontal overflow: ${view} at ${width}`);
        if (view === 'settings') {
          for (const column of ['.settings-primary', '.settings-secondary']) {
          const panels = await page.locator(`#v-settings ${column} > .panel`).evaluateAll(els => els.map(el => {
            const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left };
          }));
          if (panels.some((p, i) => i && (p.top < panels[i - 1].bottom || Math.abs(p.left - panels[0].left) > 2))) throw Error('Settings panels are not vertically stacked');
          }
          await page.screenshot({ path: path.resolve(__dirname, `../release/settings-${width}.png`) });
          await page.locator('#v-settings [data-fold="set-about"]').scrollIntoViewIfNeeded();
          if (!(await page.locator('#about').isVisible())) throw Error('Settings bottom is inaccessible');
        }
        if (view === 'chars') {
          const workspace = await page.locator('.wrap').boundingBox();
          if (workspace.width < width - 30) throw Error('Workspace does not fill the window');
          const picker = page.locator('#cidx-keys');
          if (await picker.isVisible()) throw Error('Picker should start collapsed');
          const canvas = page.locator('#ctstage');
          const before = await canvas.boundingBox();
          await page.locator('#radical-picker').click();
          if (!(await picker.isVisible())) throw Error('Picker did not expand');
          const expanded = await canvas.boundingBox();
          if (before && expanded && (Math.abs(before.y - expanded.y) > 2 || Math.abs(before.height - expanded.height) > 2)) throw Error('Floating picker resized the canvas');
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Expanded picker overflows');
          await page.locator('[data-rxtoggle]').click();
          if (await picker.isVisible()) throw Error('Picker did not collapse');
          const after = await canvas.boundingBox();
          if (before && after && Math.abs(before.y - after.y) > 2) throw Error('Canvas did not reclaim picker space');
          await page.screenshot({ path: path.resolve(__dirname, `../release/layout-${width}.png`) });
        }
      }
    }
    await page.keyboard.press('1');
    if (!(await page.locator('#v-chars').isVisible())) throw Error('Characters shortcut failed');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-cv="grid"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.resolve(__dirname, '../release/grid-spacing.png') });
    await page.evaluate(() => openChar('\u5012'));
    await page.waitForTimeout(400);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const words = page.locator('#detail .char-words');
      const scrollable = await words.evaluate(el => el.scrollHeight > el.clientHeight);
      if (!scrollable) throw Error('Long word list does not scroll independently');
      const footer = await page.locator('#detail .acts').boundingBox();
      if (!footer || footer.y < 0 || footer.y + footer.height > 900) throw Error('Entry actions are offscreen');
      await words.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.screenshot({ path: path.resolve(__dirname, `../release/entry-${width}.png`) });
    }
    await page.locator('#detail [data-close]').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('?');
    if (!(await page.locator('#help').isVisible())) throw Error('Help shortcut failed');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.locator('#nav [data-v="read"]').click();
    await page.locator('[data-shelf-paste]').click();
    await page.locator('#paste-title').fill('Layout check');
    await page.locator('#paste-text').fill('\u6211\u7231\u5b66\u4e60\u4e2d\u6587\u3002'.repeat(300));
    await page.locator('#b-paste-go').click();
    await page.waitForTimeout(600);
    if (!(await page.locator('#read-book').isVisible())) await page.locator('.bk-open').first().click();
    for (const [width, height] of [[1440, 900], [390, 700], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(600);
      const foot = await page.locator('.rd-foot').boundingBox();
      if (!foot || foot.y + foot.height > height + 2) throw Error(`Reader footer outside viewport at ${width}x${height}`);
      await page.screenshot({ path: path.resolve(__dirname, `../release/reader-${width}.png`) });
      await page.locator('#nav [data-v="chars"]').click();
      await page.locator('[data-cv="tree"]').click();
      await page.waitForTimeout(400);
      const stage = await page.locator('#ctstage').boundingBox();
      if (!stage || stage.y + stage.height > height + 2) throw Error(`Canvas outside viewport at ${width}x${height}`);
      await page.locator('#nav [data-v="read"]').click();
    }
    await page.locator('#rd-back').click();
    await page.waitForSelector('.now-levels');
    const analytics = await page.evaluate(() => {
      const b = R.shelf[0], st = b.stats;
      return { total: st.running, sum: Object.values(st.byLevel).reduce((a,b)=>a+b,0),
        sections: st.sizes.length, expectedSections: b.chapters,
        cards: document.querySelectorAll('#read-now .kpi').length };
    });
    if (!analytics.total || analytics.sum !== analytics.total || analytics.sections !== analytics.expectedSections || analytics.cards !== 3) throw Error('Incomplete or inconsistent book analytics');
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      await page.locator('#read-now').scrollIntoViewIfNeeded();
      if(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth || document.querySelector('#read-library').scrollWidth > document.querySelector('#read-library').clientWidth + 2)) throw Error('Book analytics overflow');
      await page.screenshot({path:path.resolve(__dirname, `../release/analytics-${width}.png`)});
    }
    if (errors.length) throw Error(errors.join('\n'));
    console.log('PASS: startup, three tabs, desktop/mobile widths, keyboard shortcuts, no page errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

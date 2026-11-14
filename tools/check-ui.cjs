// Smoke-test the built app with Playwright. Set PLAYWRIGHT_MODULE and BROWSER_PATH
// when using an existing local installation instead of Playwright's defaults.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const shots = path.resolve(__dirname, "local", "screenshots");
require("node:fs").mkdirSync(shots, {recursive:true});
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
    if(await page.locator('#ct-i-host svg').count()) throw Error('Tree should not load stroke animation before it is requested');
    await page.locator('#ct-insp [data-ct="strokes"]').click();
    await page.waitForSelector('#ct-i-host svg');
    if(await page.evaluate(()=>ctExtent(CT.lay)!==ctExtent(CT.lay))) throw Error('Tree geometry cache is not reused');
    const guideErrors=await page.evaluate(async()=>{
      return (await getChars()).filter(c=>/undefined|NaN/.test(characterGuideHTML(c))).map(c=>c.h);
    });
    if(guideErrors.length) throw Error('Incomplete character explanations: '+guideErrors.join(','));
    await page.locator('#quest-open').click();
    if(!(await page.locator('.quest-route').isVisible())) throw Error('Family learning path missing');
    await page.locator('#quest-task .character-guide summary').click();
    if(!(await page.locator('#quest-task .learning-prompt').isVisible())) throw Error('Learning explanation missing');
    await page.locator('#quest-next').click();
    const meaning = await page.evaluate(() => questMeaning(questRun.c));
    const choices = page.locator('.quest-choices button');
    for (const b of await choices.all()) {
      if (await b.textContent() !== meaning) { await b.click(); break; }
    }
    if (!(await page.locator('#quest-feedback').textContent()).includes('try another')) throw Error('Quest retry feedback missing');
    await page.getByRole('button', {name:meaning,exact:true}).click();
    await page.waitForFunction(() => questRun.stats.xp === 10);
    // Capture the completion callback while retaining the real stroke writer.
    await page.evaluate(() => {
      const original = mountWriter;
      window.questOriginalMount = original;
      mountWriter = (host,c,opts) => { window.questWritingComplete = opts.onComplete; return original(host,c,opts); };
    });
    await page.locator('#quest-next').click();
    await page.waitForSelector('#quest-writer svg');
    await page.screenshot({path:path.join(shots, 'quest-writing.png')});
    await page.evaluate(async () => { await window.questWritingComplete(2); mountWriter=window.questOriginalMount; });
    await page.waitForFunction(() => questRun.stage === 'done');
    const questData = await page.evaluate(async () => {
      const duplicate = await questAward('write',questRun);
      const backup=await exportAll();
      return {duplicate,xp:questStats(await questRecords()).xp,saved:backup.results.filter(r=>r.kind==='character-quest').length};
    });
    if (questData.duplicate || questData.xp !== 30 || questData.saved !== 2) throw Error('Quest reward persistence or duplicate protection failed');
    await page.setViewportSize({width:390,height:700});
    if(await page.locator('#quest').evaluate(el=>el.scrollWidth>el.clientWidth+2)) throw Error('Quest overflows on mobile');
    await page.screenshot({path:path.join(shots, 'quest-mobile.png')});
    await page.locator('#quest-close').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#quest-open').textContent.includes('30 XP'));
    if(!(await page.locator('#ct-plane .quest-badge').count())) throw Error('Writing quest is not marked in the tree');
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>ctStart('\u6728',{trail:true}));
    await page.waitForTimeout(650);
    if(await page.evaluate(()=>CT.tree.size<50)) throw Error('Large character family did not load');
    await page.screenshot({path:path.join(shots, 'tree-family.png')});
    await page.locator('#ct-insp [data-ct="quest"]').click();
    if(await page.evaluate(()=>questRun.c.h!=='\u6728')) throw Error('Selected-character lesson opened a different character');
    await page.locator('#quest-close').click();
    await page.setViewportSize({width:390,height:700});
    await page.evaluate(()=>ctStart('\u6c38',{fresh:true}));
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
          const settingsBox = await page.locator('#v-settings').boundingBox();
          const mainBox = await page.locator('#main').boundingBox();
          if (settingsBox.width < mainBox.width - 4) throw Error('Settings does not use the available page width');
          for (const section of ['display', 'type', 'theme', 'lookup', 'about']) {
            await page.locator(`[data-setting-tab="${section}"]`).click();
            if (!(await page.locator(`#settings-${section}`).isVisible())) throw Error('Settings category did not open: ' + section);
            if (await page.locator('[data-setting-section]:visible').count() !== 1) throw Error('Multiple settings categories visible');
            if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Settings category overflows');
          }
          await page.locator('[data-setting-tab="display"]').click();
          await page.screenshot({ path: path.join(shots, `settings-${width}.png`) });
          await page.locator('[data-setting-tab="type"]').click();
          await page.locator('#font-zh [data-font="kaiti"]').click();
          if (await page.locator('#font-zh [data-font="kaiti"]').getAttribute('aria-pressed') !== 'true') throw Error('Chinese font selection failed');
          await page.screenshot({ path: path.join(shots, `typography-${width}.png`) });
          await page.locator('[data-setting-tab="display"]').focus();
          await page.keyboard.press('ArrowRight');
          if (!(await page.locator('#settings-type').isVisible())) throw Error('Settings keyboard navigation failed');
        }
        if (view === 'chars') {
          const switchBox = await page.locator('#cview').boundingBox();
          await page.locator('[data-cv="grid"]').click();
          await page.waitForSelector('#grid-level:visible');
          const gridBox = await page.locator('#cview').boundingBox();
          if (Math.abs(gridBox.x-switchBox.x)>1 || Math.abs(gridBox.y-switchBox.y)>1) throw Error('View switch moved at width '+width);
          await page.locator('#grid-level').selectOption('7');
          if (!await page.evaluate(()=>C.shown.length && C.shown.every(h=>+CT.g.by.get(h).lv===7))) throw Error('Grid level filter failed');
          for (const sort of ['frequency','radical','alphabetical']) {
            await page.locator(`#csort [data-s="${sort}"]`).click();
            const ordered = await page.evaluate(mode => {
              const rows = C.shown.map(h => CT.g.by.get(h));
              return rows.every((c,i) => {
                if (!i) return true;
                const prev=rows[i-1];
                if (mode==='alphabetical') return flatPinyin(prev.p).localeCompare(flatPinyin(c.p),'en') <= 0;
                const field=mode==='frequency' ? 'rank' : 'radn';
                return (prev[field] || Infinity) <= (c[field] || Infinity);
              });
            },sort);
            if (!ordered) throw Error('Incorrect grid order: '+sort);
          }
          await page.locator('#grid-level').selectOption('all');
          await page.locator('[data-cv="tree"]').click();
          await page.waitForSelector('#ctstage:visible');
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
          await page.screenshot({ path: path.join(shots, `layout-${width}.png`) });
        }
      }
    }
    await page.keyboard.press('1');
    if (!(await page.locator('#v-chars').isVisible())) throw Error('Characters shortcut failed');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-cv="grid"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, 'grid-spacing.png') });
    await page.evaluate(() => openChar('\u5012'));
    await page.waitForTimeout(400);
    if (!(await page.locator('#detail .writing-tip').isVisible())) throw Error('Writing guidance missing');
    await page.locator('#detail .char-context summary').click();
    if (!(await page.locator('#detail .char-sentence').count())) throw Error('Context examples missing');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const words = page.locator('#detail .char-words');
      const scrollable = await words.evaluate(el => el.scrollHeight > el.clientHeight);
      if (!scrollable) throw Error('Long word list does not scroll independently');
      const footer = await page.locator('#detail .acts').boundingBox();
      if (!footer || footer.y < 0 || footer.y + footer.height > 900) throw Error('Entry actions are offscreen');
      await words.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.screenshot({ path: path.join(shots, `entry-${width}.png`) });
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
      await page.screenshot({ path: path.join(shots, `reader-${width}.png`) });
      await page.locator('#nav [data-v="chars"]').click();
      await page.locator('[data-cv="tree"]').click();
      await page.waitForTimeout(400);
      const stage = await page.locator('#ctstage').boundingBox();
      if (!stage || stage.y + stage.height > height + 2) throw Error(`Canvas outside viewport at ${width}x${height}`);
      await page.locator('#nav [data-v="read"]').click();
    }
    await page.locator('#rd-back').click();
    await page.waitForSelector('#read-now .mixbar');
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
      await page.screenshot({path:path.join(shots, `analytics-${width}.png`)});
    }
    if (errors.length) throw Error(errors.join('\n'));
    console.log('PASS: startup, three tabs, desktop/mobile widths, keyboard shortcuts, no page errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

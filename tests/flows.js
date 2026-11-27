// Flow tests: full mock with breaks and pause/resume, export/import, profiles, new-topic task.
//   python3 -m http.server -d site 8765 &   then   node tests/flows.js [baseURL]
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8765/';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('Second') : d.accept());
  const ok = (c, msg) => { if (!c) errors.push('FAIL: ' + msg); else console.log('ok -', msg); };

  await page.goto(BASE);
  await page.waitForSelector('#modal[open]');
  for (let i = 0; i < 5; i++) await page.click('[data-act="ob-next"]');

  // New-topic task from Today: lesson, then 5-item check marks the line started and the task done
  const first = await page.$('[data-act="task"]');
  const title = await page.textContent('.checklist li .task-title');
  ok(/New topic/.test(title), 'first task is a new topic: ' + title);
  await first.click();
  ok(await page.isVisible('text=New topic.'), 'lesson opens with the new-topic banner');
  await page.click('.banner [data-act="line-check"]');
  for (let i = 0; i < 5; i++) {
    const k = await page.evaluate(() => App.session.items[App.session.i].k);
    await page.click(`[data-act="pick"][data-i="${k}"]`);
    await page.click('[data-act="conf"][data-c="sure"]');
    await page.click('#btn-next');
  }
  await page.click('[data-act="back-today"]');
  ok(await page.isVisible('.checklist li.done'), 'task ticked after the 5-item check');
  ok(await page.evaluate(() => Object.keys(Store.state.linesStarted).length === 1), 'line marked started');

  // Full mock: answer 2, submit part 1, break, pause, resume from Practice
  await page.click('.tabs [data-tab="practice"]');
  await page.click('[data-mode="mock"]');
  await page.click('[data-act="start-mock"]');
  ok(await page.isVisible('text=Full mock · part 1 of 3'), 'full mock starts');
  ok(await page.evaluate(() => App.session.parts.map(p => p.ids.length).join()) === '150,150,150', '450 items in three parts');
  await page.keyboard.press('2'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('3');
  await page.click('[data-act="ex-submit"]');
  ok(await page.isVisible('text=Break'), 'break screen between parts');
  await page.click('[data-act="ex-pause"]');
  ok(await page.isVisible('text=unfinished timed exam'), 'exam saved for later');
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.click('.tabs [data-tab="practice"]');
  await page.click('[data-act="resume-exam"]');
  ok(await page.isVisible('text=Break'), 'resumes at the break after reload');
  await page.click('[data-act="ex-resume-part"]');
  ok(await page.isVisible('text=part 2 of 3'), 'part 2 starts');
  await page.click('[data-act="ex-submit"]');
  await page.click('[data-act="ex-resume-part"]');
  await page.click('[data-act="ex-submit"]');
  ok(await page.isVisible('text=Weighted general average'), 'full mock scored with the weighted average');
  ok(await page.isVisible('text=reported passing rule'), 'passing rule shown as reported');

  // Export, then reset, then import
  await page.click('[data-act="back-tab"]');
  await page.click('.tabs [data-tab="progress"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.card [data-act="export"]')]);
  const file = await dl.path();
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(backup.state && Object.keys(backup.state.items).length > 400, 'export holds the progress');
  const before = await page.evaluate(() => Object.keys(Store.state.items).length);
  await page.evaluate(() => { Store.reset(); App.render(); });
  ok(await page.evaluate(() => Object.keys(Store.state.items).length) === 0, 'reset clears progress');
  await page.setInputFiles('#import-file', file);
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => Object.keys(Store.state.items).length) === before, 'import restores progress');

  // Profiles: create a second profile, it starts empty, switch back
  await page.click('#btn-settings');
  await page.click('[data-act="profile-new"]');
  await page.waitForSelector('#modal[open]');
  ok(await page.evaluate(() => Store.state.profile) === 'Second', 'new profile active');
  for (let i = 0; i < 5; i++) await page.click('[data-act="ob-next"]');
  ok(await page.evaluate(() => Object.keys(Store.state.items).length) === 0, 'new profile has its own empty progress');
  await page.click('#btn-settings');
  await page.selectOption('#set-profile', 'Me');
  await page.click('[data-act="profile-switch"]');
  ok(await page.evaluate(() => Object.keys(Store.state.items).length) === before, 'switching back restores the first profile');

  // Text size and dark theme settings apply
  await page.click('#btn-settings');
  await page.selectOption('#set-size', 'xl');
  await page.selectOption('#set-theme', 'dark');
  await page.click('[data-act="save-settings"]');
  ok(await page.evaluate(() => document.documentElement.dataset.size === 'xl' && document.documentElement.dataset.theme === 'dark'), 'text size and theme apply');

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('ALL OK');
})();

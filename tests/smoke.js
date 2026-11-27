// Smoke test for the app. Usage:
//   python3 -m http.server -d site 8765 &   then   node tests/smoke.js [baseURL]
// Set SHOTS=<dir> to save screenshots.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS || '';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const shot = async n => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
  const ok = (c, msg) => { if (!c) errors.push('FAIL: ' + msg); else console.log('ok -', msg); };

  await page.goto(BASE);
  await page.waitForSelector('#modal[open]');
  ok(await page.isVisible('text=Welcome'), 'onboarding shows on first launch');
  await shot('01-onboarding');
  await page.fill('#ob-name', 'Tester');
  for (let i = 0; i < 5; i++) await page.click('[data-act="ob-next"]');
  ok(!(await page.isVisible('#modal[open]')), 'onboarding closes');
  ok(await page.isVisible('text=placeholder'), 'exam date labelled placeholder');
  await shot('02-today');
  const tasks = await page.$$eval('.checklist li', l => l.length);
  ok(tasks >= 1, 'today plan has tasks: ' + tasks);

  // Practice: quick quiz; miss the first item on purpose
  await page.click('.tabs [data-tab="practice"]');
  await page.click('[data-mode="quick"]');
  await page.waitForSelector('.q-stem');
  const correct = await page.evaluate(() => App.session.items[0].k);
  await page.click(`[data-act="pick"][data-i="${(correct + 1) % 4}"]`);
  await page.click('[data-act="conf"][data-c="sure"]');
  ok(await page.isVisible('.mini'), 'mini-lesson after a miss');
  ok(await page.isVisible('.refute'), 'refutation after a sure miss');
  await shot('03-miss');
  await page.click('#btn-next');
  for (let i = 1; i < 10; i++) {
    const k = await page.evaluate(() => App.session.items[App.session.i].k);
    await page.keyboard.press(String(k + 1));
    await page.keyboard.press(i % 2 ? 's' : 'u');
    await page.click('#btn-next');
  }
  ok(await page.isVisible('text=Quick quiz: done'), 'session summary');
  await shot('04-summary');
  const missed = await page.evaluate(() => { const s = Store.state; const id = Object.keys(s.items).find(k => s.items[k].hist.some(h => !h[1])); return s.items[id]; });
  const tomorrow = await page.evaluate(() => Store.addDays(Store.today(), 1));
  ok(missed && missed.due === tomorrow, 'missed item due tomorrow');

  // Timed exam (20 items)
  await page.click('[data-act="back-tab"]');
  await page.click('[data-mode="exam"]');
  await page.selectOption('#ex-size', '20');
  await page.click('[data-act="start-exam"]');
  ok(await page.isVisible('#ex-timer'), 'exam timer shown');
  await page.keyboard.press('1'); await page.keyboard.press('f'); await page.keyboard.press('ArrowRight');
  await shot('05-exam');
  await page.click('[data-act="ex-submit"]');
  ok(await page.isVisible('text=Exam results'), 'exam results');
  await shot('06-exam-results');

  // Learn tab
  await page.click('[data-act="back-tab"]');
  await page.click('.tabs [data-tab="learn"]');
  await page.click('[data-line="HE-B4"]');
  ok(await page.isVisible('article.md h2'), 'lesson renders');
  await shot('07-lesson');
  await page.click('[data-act="cheat"]');
  ok(await page.isVisible('text=cheat sheet'), 'cheat sheet');
  await page.click('[data-act="learn-home"]');
  await page.fill('#learn-search', 'Baumrind');
  ok((await page.$$('#search-results li')).length > 0, 'search finds results');
  await page.fill('#learn-search', '');
  await page.click('[data-act="learn-page"][data-p="glossary"]');
  ok((await page.$$('#glo li')).length > 50, 'glossary built');

  // Review and flashcards
  await page.click('.tabs [data-tab="review"]');
  await shot('08-review');
  await page.click('[data-act="rev-cards"]');
  await page.keyboard.press(' ');
  await page.click('[data-act="card-ans"][data-ok="1"]');
  ok(await page.evaluate(() => Object.keys(Store.state.cards).length) === 1, 'flashcard recorded');
  await page.click('[data-act="quit"]');

  // Progress and settings
  await page.click('.tabs [data-tab="progress"]');
  await shot('09-progress');
  await page.click('#btn-settings');
  await page.fill('#set-exam', '2027-04-25');
  await page.check('#set-official');
  await page.click('[data-act="save-settings"]');
  await page.click('.tabs [data-tab="today"]');
  ok(await page.isVisible('text=set by you'), 'exam date editable and marked official');

  // Rapid fire
  await page.click('.tabs [data-tab="practice"]');
  await page.click('[data-mode="rapid"]');
  ok(await page.isVisible('#rf-timer'), 'rapid fire timer');
  await page.evaluate(() => { App.session.left = 0.1; });
  await page.waitForSelector('text=Rapid fire: time!', { timeout: 3000 });
  ok(true, 'rapid fire ends');

  // Offline after first visit
  await page.goto(BASE);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.tabs', { timeout: 5000 });
  await page.waitForTimeout(800);
  ok(await page.isVisible('text=days to the exam'), 'works offline after first visit');
  await ctx.setOffline(false);

  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('10-dark');

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('ALL OK');
})();

// Logic tests for the scheduler and the daily plan, run in the real page with a mocked "today".
//   python3 -m http.server -d site 8765 &   then   node tests/logic.js [baseURL]
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8765/';

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => window.Engine && Engine.D.Q.length > 0);
  const results = await page.evaluate(() => {
    const out = [];
    const ok = (c, m) => out.push([!!c, m]);
    const S = Store, E = Engine, P = { today: () => Plan.build(S.today()), isRest: Plan.isRest };
    let fake = '2026-12-01';
    S.today = () => fake;
    S.state.onboarded = true;
    S.state.settings.startDate = '2026-12-01';
    S.state.settings.examDate = '2027-03-28';
    S.state.settings.restDays = [0];
    const q = E.D.Q[0];

    // --- scheduler ---
    E.record(q, false, 'sure', 1000);
    ok(S.state.items[q.id].due === '2026-12-02', 'miss -> due in 1 day');
    fake = '2026-12-02'; E.record(q, true, 'unsure', 1000);
    ok(S.state.items[q.id].due === '2026-12-05', 'then correct-unsure -> 3 days');
    fake = '2026-12-05'; E.record(q, true, 'guess', 1000);
    ok(S.state.items[q.id].due === '2026-12-12', 'then correct-guess -> 7 days');
    fake = '2026-12-12'; E.record(q, true, 'unsure', 1000);
    ok(S.state.items[q.id].due === '2026-12-26', 'then -> 14 days');
    fake = '2026-12-26'; E.record(q, false, 'unsure', 1000);
    ok(S.state.items[q.id].due === '2026-12-27', 'another miss resets to 1 day');
    const q2 = E.D.Q[1];
    fake = '2026-12-01'; E.record(q2, true, 'sure', 1000);
    ok(S.state.items[q2.id].due === '2026-12-04', 'new sure-correct -> 3 days');
    fake = '2026-12-04'; E.record(q2, true, 'sure', 1000);
    ok(S.state.items[q2.id].due === '2026-12-10', 'sure-correct doubles -> 6 days');
    fake = '2026-12-10'; E.record(q2, true, 'sure', 1000);
    ok(S.state.items[q2.id].retired === true && S.state.items[q2.id].due === null, 'retires after 3 sure-correct');
    ok(!E.isDue(S.state.items[q2.id], '2027-01-15'), 'retired item not due mid-way');
    ok(E.isDue(S.state.items[q2.id], '2027-02-26'), 'retired item resurfaces 30 days before exam');

    // --- bigger lesson after two misses on a subtopic in 7 days ---
    const m = E.D.Q.find(x => (E.D.byMini[x.m] || []).length >= 6);
    const sibs = E.D.byMini[m.m].filter(x => x.id !== m.id);
    fake = '2026-12-03';
    const r1 = E.record(m, false, 'unsure', 1000);
    const r2 = E.record(sibs[0], false, 'unsure', 1000);
    ok(!r1.boost && r2.boost === m.m, 'second miss in a week triggers the bigger lesson');
    const boosted = Object.keys(S.state.items).filter(id => S.state.items[id].boost);
    ok(boosted.length === 3, '3 extra items scheduled');
    ok(boosted.map(id => S.state.items[id].due).sort().join() === '2026-12-04,2026-12-05,2026-12-06', 'spread over the next 3 days');

    // --- plan phases ---
    S.state.items = {}; S.state.days = {}; S.state.linesStarted = {};
    fake = '2026-12-01';
    let p = P.today();
    ok(p.phase.id === 'learn', 'day 1 is Phase 1 learn');
    ok(p.tasks.some(t => t.key.startsWith('lesson:')), 'learn phase has a new-topic task');
    ok(p.minutes <= 120 && p.minutes > 0, 'plan within cap: ' + p.minutes + ' min');
    fake = '2026-12-06'; // Sunday
    ok(P.today().status === 'rest', 'Sunday is a rest day');
    fake = '2027-02-01';
    ok(P.today().phase.id === 'mix', 'February is phase 2 mix: ' + P.today().phase.id);
    fake = '2027-03-10';
    ok(P.today().phase.id === 'timed', 'March 10 is phase 3 timed: ' + P.today().phase.id);
    let timedDays = 0;
    for (let d = '2027-03-01'; d < '2027-03-20'; d = S.addDays(d, 1)) { fake = d; if (P.today().tasks.some(t => t.key.startsWith('timed:'))) timedDays++; }
    ok(timedDays >= 3, 'timed sets appear every few days in phase 3: ' + timedDays);
    fake = '2027-03-21'; // Sunday, rest day
    ok(P.today().status === 'rest', 'final-week Sunday stays a rest day');
    S.state.settings.dailyMinutes = 120;
    const mocks = [];
    for (let d = '2027-03-21'; d < '2027-03-28'; d = S.addDays(d, 1)) { fake = d; P.today().tasks.filter(t => t.key.startsWith('mock:')).forEach(t => mocks.push(t.action.area + t.action.size)); }
    ok(mocks.join() === 'GenEd150,ProfEd75,ProfEd75,TLE75,TLE75', 'full mock spread over 5 final-week days: ' + mocks.join());
    S.state.settings.dailyMinutes = 90;
    fake = '2027-03-22';
    p = P.today();
    ok(p.minutes <= 90, 'mock shrinks to a 90-minute day: ' + p.minutes);
    S.state.settings.dailyMinutes = 60;
    S.state.settings.restDays = [6]; // Saturday rest: the day before the exam
    fake = '2027-03-27';
    ok(P.today().tasks.some(t => t.key === 'checklist'), 'day before the exam shows the checklist even on a rest day');
    S.state.settings.restDays = [0];
    fake = '2027-03-27';
    p = P.today();
    ok(p.tasks.some(t => t.key === 'checklist'), 'last day has the exam-day checklist');
    let maxMin = 0;
    for (let d = '2026-12-01'; d < '2027-03-28'; d = S.addDays(d, 1)) { fake = d; maxMin = Math.max(maxMin, P.today().minutes); }
    ok(maxMin <= 125, 'no day above the 2-hour cap (max ' + maxMin + ' min)');
    E.D.Q.slice(0, 300).forEach(x => { S.state.items[x.id] = { step: 0, iv: 1, due: '2026-12-01', hist: [], streak: 0, retired: false }; });
    S.state.settings.dailyMinutes = 120; maxMin = 0;
    for (let d = '2026-12-01'; d < '2027-03-28'; d = S.addDays(d, 1)) { fake = d; maxMin = Math.max(maxMin, P.today().minutes); }
    ok(maxMin <= 125, 'with 300 items due, still no day above 2 hours (max ' + maxMin + ' min)');
    S.state.settings.dailyMinutes = 60; S.state.items = {};
    fake = '2027-03-28';
    ok(P.today().status === 'examday', 'exam day has no plan');

    // --- behind schedule ---
    S.state.items = {};
    fake = '2027-01-11';
    E.D.Q.slice(0, 80).forEach(x => { S.state.items[x.id] = { step: 0, iv: 1, due: '2027-01-02', hist: [['2027-01-01T00:00:00Z', 0, 'sure', 1]], streak: 0, retired: false }; });
    p = P.today();
    ok(p.behind && p.behind.overdue === 80, 'behind banner with overdue count');
    ok(p.behind.topics >= 2, 'topics behind counted: ' + p.behind.topics);
    S.state.settings.catchUp = 'order';
    const nOrder = p.tasks.find(t => t.key === 'reviews').action.n;
    S.state.settings.catchUp = 'replan';
    const nRe = P.today().tasks.find(t => t.key === 'reviews').action.n;
    ok(nOrder > nRe, 'catch-up in order does more reviews today than re-plan (' + nOrder + ' vs ' + nRe + ')');
    ok(E.dueItems().length === 80, 'missed work is kept');

    // --- exam builder follows TOS ---
    const ex = E.buildExam('TLE', 150);
    const byLine = {}; ex.forEach(x => byLine[x.l] = (byLine[x.l] || 0) + 1);
    ok(ex.length === 150 && new Set(ex.map(x => x.id)).size === 150, '150 unique items');
    ok(byLine['HE-B4'] === 15 && byLine['HE-A6'] === 3, 'TOS counts per line (HE-B4 15, HE-A6 3)');
    const ge = E.buildExam('GenEd', 150), gl = {}; ge.forEach(x => gl[x.l] = (gl[x.l] || 0) + 1);
    ok(Object.values(gl).every(n => n === 15), 'GenEd 15 per unit');

    // --- interleaving ---
    const mix = E.interleavedMix(20);
    let same = 0; for (let i = 1; i < mix.length; i++) if (mix[i].l === mix[i - 1].l) same++;
    ok(mix.length === 20 && same <= 4, 'interleaved mix of 20 with few same-line neighbours (' + same + ')');

    // --- readiness ---
    S.state.items = {};
    ['GenEd', 'ProfEd', 'TLE'].forEach(a => E.D.byArea[a].slice(0, 40).forEach((x, i) => {
      S.state.items[x.id] = { step: 0, iv: 1, due: null, hist: [['2027-01-0' + (1 + i % 9) + 'T00:00:00Z', i % 5 ? 1 : 0, 'sure', 1]], streak: 0, retired: false };
    }));
    const r = E.readiness();
    ok(r.enough && Math.abs(r.overall - 0.8) < 0.08, 'readiness about 80%: ' + r.overall.toFixed(2));
    ok(['green', 'amber'].includes(r.status), 'status ' + r.status);
    return out;
  });
  results.forEach(([pass, msg]) => { console.log((pass ? 'ok - ' : 'FAIL - ') + msg); if (!pass) errors.push(msg); });
  await browser.close();
  if (errors.length) { console.error(errors.length + ' failures'); process.exit(1); }
  console.log('ALL OK');
})();

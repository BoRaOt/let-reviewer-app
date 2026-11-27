/* Daily plan engine (app spec §6.4): phases, daily budget, behind-schedule handling. */
(function () {
  'use strict';
  var S = window.Store, E = window.Engine;
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var AVG_SEC = 95;      // mixed item: average exam pace (≈68 s) + ≈30 s reading the explanation
  var LESSON_MIN = 15;   // short lesson + 5-item check
  var CARD_SEC = 15;

  function settings() { return S.state.settings; }
  function isRest(isoDate) { return settings().restDays.indexOf(new Date(isoDate + 'T12:00:00').getDay()) >= 0; }

  function studyDays(from, to) { // [from, to) excluding rest days
    var out = [], d = from, guard = 0;
    while (d < to && guard++ < 2000) { if (!isRest(d)) out.push(d); d = S.addDays(d, 1); }
    return out;
  }

  function phaseOf(t) {
    var s = settings(), ex = s.examDate;
    var left = S.daysBetween(t, ex);
    if (left <= 0) return { id: 'after', name: 'Exam date reached' };
    if (left <= 7) return { id: 'final', name: 'Final week' };
    var all = studyDays(s.startDate, S.addDays(ex, -7));
    var idx = all.filter(function (d) { return d < t; }).length;
    var f = all.length ? idx / all.length : 1;
    if (f < 0.40) return { id: 'learn', name: 'Phase 1 · Learn', f: f };
    if (f < 0.75) return { id: 'mix', name: 'Phase 2 · Mix and space', f: f };
    return { id: 'timed', name: 'Phase 3 · Timed practice', f: f };
  }

  function minutes() { return Math.min(120, Math.max(15, Number(settings().dailyMinutes) || 60)); }

  function lineBacklog(t) {
    var s = settings(), order = E.learnOrder();
    var unstarted = order.filter(function (l) { return !S.state.linesStarted[l.id]; });
    var learnEnd = learnPhaseEnd();
    var remainingLearnDays = Math.max(1, studyDays(t, learnEnd).length);
    var allLearn = Math.max(1, studyDays(s.startDate, learnEnd).length);
    var elapsed = studyDays(s.startDate, t).length;
    var expected = Math.min(order.length, Math.ceil(order.length * Math.min(1, elapsed / allLearn)));
    var started = order.length - unstarted.length;
    return { unstarted: unstarted, perDay: Math.ceil(unstarted.length / remainingLearnDays), behind: Math.max(0, expected - started) };
  }

  function learnPhaseEnd() {
    var s = settings(), all = studyDays(s.startDate, S.addDays(s.examDate, -7));
    return all[Math.floor(all.length * 0.40)] || S.addDays(s.examDate, -7);
  }

  function timedPartFor(t) {
    // rotate parts, weakest estimated part first
    var r = E.readiness();
    var parts = E.AREAS.slice().sort(function (a, b) {
      var pa = r.parts[a].p === null ? 0 : r.parts[a].p, pb = r.parts[b].p === null ? 0 : r.parts[b].p;
      return pa - pb;
    });
    var n = studyDays(settings().startDate, t).length;
    return parts[Math.floor(n / 3) % 3];
  }

  /** Build today's plan. */
  function today(t) {
    t = t || S.today();
    var s = settings(), ex = s.examDate, budget = minutes() * 60;
    var daysLeft = S.daysBetween(t, ex);
    var out = { date: t, daysLeft: daysLeft, phase: phaseOf(t), tasks: [], minutes: 0, behind: null, rest: false };
    if (t < s.startDate) { out.status = 'before'; return out; }
    if (daysLeft < 0) { out.status = 'after'; return out; }
    if (daysLeft === 0) { out.status = 'examday'; return out; }
    out.status = 'study';
    if (isRest(t)) { out.rest = true; out.status = 'rest'; return out; }

    var due = E.dueItems(t), overdue = E.overdueCount(t);
    var dueToday = due.length - overdue;
    var cap = Math.floor(budget * 0.5 / AVG_SEC);
    var reviewN;
    if (s.catchUp === 'replan') {
      var rem = Math.max(1, Math.min(7, studyDays(t, ex).length));
      reviewN = Math.min(due.length, Math.max(0, dueToday) + Math.ceil(overdue / rem), cap);
    } else {
      reviewN = Math.min(due.length, Math.floor(budget * (overdue > cap ? 0.8 : 0.5) / AVG_SEC));
    }
    var used = 0;
    function add(task) { out.tasks.push(task); used += task.min * 60; }

    if (reviewN > 0) add({ key: 'reviews', title: 'Warm-up: ' + reviewN + ' due review' + (reviewN > 1 ? 's' : ''),
      detail: 'Retrieval first. Oldest due items first.' + (due.length > reviewN ? ' (' + (due.length - reviewN) + ' more wait for later days.)' : ''),
      min: Math.ceil(reviewN * AVG_SEC / 60), action: { type: 'reviews', n: reviewN } });

    var lb = lineBacklog(t), ph = out.phase.id;
    var nLines = 0;
    if (lb.unstarted.length) {
      if (ph === 'learn') nLines = Math.max(1, lb.perDay);
      else nLines = 1; // later phases still finish any topic not yet started
      if (s.catchUp !== 'replan' && lb.behind >= 2) nLines = Math.max(nLines, 2);
      if (ph === 'final') nLines = Math.min(nLines, 1);
      nLines = Math.min(nLines, 2, lb.unstarted.length);
    }
    lb.unstarted.slice(0, nLines).forEach(function (l) {
      add({ key: 'lesson:' + l.id, title: 'New topic: ' + l.id + ' — ' + shortTitle(l.title),
        detail: 'Short lesson, then a 5-item check. (' + E.PART_SHORT[l.area] + ', ' + l.items + ' exam items)',
        min: LESSON_MIN, action: { type: 'newline', line: l.id } });
    });

    var remain = Math.max(0, budget - used);
    if (ph === 'learn') {
      var n = clamp(Math.floor(remain * 0.85 / AVG_SEC), 5, 40);
      add({ key: 'new', title: 'Mixed practice: ' + n + ' items', detail: 'New items from topics you have started, mixed across lines.',
        min: Math.ceil(n * AVG_SEC / 60), action: { type: 'quick', n: n } });
    } else if (ph === 'mix') {
      var m = clamp(Math.floor(remain * 0.85 / AVG_SEC), 10, 40);
      add({ key: 'mix', title: 'Interleaved mix: ' + m + ' items', detail: 'Mixed lines, weighted to easily confused topics.',
        min: Math.ceil(m * AVG_SEC / 60), action: { type: 'mix', n: m } });
    } else if (ph === 'timed') {
      var dayNo = studyDays(s.startDate, t).length;
      if (dayNo % 3 === 0) {
        var area = timedPartFor(t), size = Math.min(150, Math.floor(remain * 0.9 / E.PACE[area]));
        size = Math.max(20, size);
        add({ key: 'timed:' + area, title: 'Timed set: ' + E.PART_SHORT[area] + ', ' + size + ' items',
          detail: 'Exam pace (' + E.PACE[area] + ' s per item), TOS-weighted, flag and review.', min: Math.ceil(size * E.PACE[area] / 60),
          action: { type: 'exam', area: area, size: size } });
      } else {
        var k = clamp(Math.floor(remain * 0.5 / AVG_SEC), 10, 30);
        add({ key: 'mix', title: 'Interleaved mix: ' + k + ' items', detail: 'Mixed lines, weighted to easily confused topics.',
          min: Math.ceil(k * AVG_SEC / 60), action: { type: 'mix', n: k } });
        var j = clamp(Math.floor(Math.max(0, budget - used) * 0.8 / AVG_SEC), 5, 20);
        add({ key: 'smart', title: 'Smart review: ' + j + ' items', detail: 'Your missed, guessed and slow items.',
          min: Math.ceil(j * AVG_SEC / 60), action: { type: 'smart', n: j } });
      }
    } else if (ph === 'final') {
      // A full mock spread over five days so no day breaks the 2-hour cap.
      var mock = { 7: ['GenEd', 150], 6: ['ProfEd', 75], 5: ['ProfEd', 75], 4: ['TLE', 75], 3: ['TLE', 75] }[daysLeft];
      if (mock) {
        var mins = Math.ceil(mock[1] * E.PACE[mock[0]] / 60);
        add({ key: 'mock:' + daysLeft, title: 'Mock exam: ' + E.PART_SHORT[mock[0]] + ' (' + mock[1] + ' items' + (mock[1] < 150 ? ', half of the part' : '') + ')',
          detail: 'Part of a full mock spread over five days. Exam pace, TOS-weighted.', min: mins, action: { type: 'exam', area: mock[0], size: mock[1], mock: true } });
      }
      if (daysLeft === 2) {
        add({ key: 'weak', title: 'Weak spots', detail: 'Drill your weakest TOS lines.', min: 20, action: { type: 'weak' } });
      }
      if (daysLeft === 2) add({ key: 'yield', title: 'Highest-yield flashcards', detail: 'Cards from the heaviest TOS lines.', min: 10, action: { type: 'yield' } });
      if (daysLeft === 1) {
        add({ key: 'light', title: 'Light review: 15 flashcards', detail: 'Keep it short. Rest tonight.', min: 5, action: { type: 'yield', n: 15 } });
        add({ key: 'checklist', title: 'Exam-day checklist', detail: 'What to prepare tonight.', min: 5, action: { type: 'checklist' } });
      }
    }

    var cd = E.cardDue(t), nc = cd.due.length + cd.fresh.length;
    if (nc && Math.max(0, budget - used) >= 120 && daysLeft > 1) {
      var shown = Math.min(nc, Math.floor((budget - used) / CARD_SEC), 40);
      if (shown > 0) add({ key: 'cards', title: 'Flashcards: ' + shown, detail: cd.due.length + ' due, ' + cd.fresh.length + ' new.',
        min: Math.max(1, Math.ceil(shown * CARD_SEC / 60)), action: { type: 'cards', n: shown } });
    }

    out.minutes = out.tasks.reduce(function (a, x) { return a + x.min; }, 0);
    if (overdue > cap || lb.behind >= 2) out.behind = { overdue: overdue, topics: lb.behind };
    return out;
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function shortTitle(t) { return String(t).split(' — ')[0]; }

  window.Plan = { today: today, phaseOf: phaseOf, studyDays: studyDays, isRest: isRest, DAY_NAMES: DAY_NAMES, minutes: minutes, shortTitle: shortTitle };
})();

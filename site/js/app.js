/* LET Study App — UI. Plain JavaScript, no frameworks. */
(function () {
  'use strict';
  var S = window.Store, E = window.Engine, P = window.Plan, M = window.MD;
  var esc = M.esc, D = E.D;
  var main, VERSION = 'v1';
  var LETTERS = ['A', 'B', 'C', 'D'];
  var TAB_HINT = {
    today: 'Use this every day: it tells you what to do and in what order.',
    learn: 'Use this when a topic is new or you keep missing it. Reading comes after quizzing.',
    practice: 'Use this to quiz yourself in a chosen mode, or to take a timed exam.',
    review: 'Use this to clear items that are due, flashcards, weak spots and bookmarks.',
    progress: 'Use this to check readiness per part, accuracy by TOS line, and to back up your data.'
  };
  var App = window.App = { tab: 'today', session: null };

  // ---------------- utilities ----------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function st() { return S.state; }
  function pct(x) { return x === null || x === undefined ? '—' : Math.round(x * 100) + '%'; }
  function fmtDate(isoDate) {
    var d = new Date(isoDate + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600); }
  App.toast = toast;
  function addMs(ms) { var t = S.today(), d = st().days[t] = st().days[t] || { ms: 0, n: 0, ok: 0, done: {} }; d.ms = (d.ms || 0) + Math.min(ms, 300000); }
  function markDone(key) { if (!key) return; var t = S.today(), d = st().days[t] = st().days[t] || { ms: 0, n: 0, ok: 0, done: {} }; d.done = d.done || {}; d.done[key] = true; S.save(); }
  function isDone(key) { var d = st().days[S.today()]; return !!(d && d.done && d.done[key]); }
  function lineTitle(id) { var l = D.lineById[id]; return l ? P.shortTitle(l.title) : id; }
  function stemHtml(q) {
    var s = esc(q.s);
    if (q.t === 'negative') s = s.replace(/\b(NOT|EXCEPT|LEAST|HINDI|MALIBAN)\b/g, '<strong>$1</strong>');
    return s;
  }
  function srcLine(ids) {
    return (ids || []).map(function (id) { var s = window.SOURCES[id];
      return '<span class="cite" title="' + esc(s ? s.title + ' (' + s.lic + ')' : id) + '">' + id + '</span>'; }).join(' ');
  }
  function miniHtml(id) {
    var m = D.minis[id];
    if (!m) return '';
    var lines = m.md.trim().split('\n'), body = [], aid = '', src = '';
    lines.forEach(function (l) {
      if (/^Memory aid:/i.test(l)) aid = l.replace(/^Memory aid:\s*/i, '');
      else if (/^Sources:/i.test(l)) src = l;
      else body.push(l);
    });
    return '<div class="mini" aria-label="Mini-lesson"><h3 class="mini-h">Mini-lesson: ' + esc(m.title) + '</h3><div class="md">' + M.render(body.join('\n')) + '</div>' +
      (aid ? '<p><strong>Memory aid:</strong> ' + M.inline(aid) + '</p>' : '') +
      '<p class="small muted">Sources: ' + srcLine(m.src) + '</p></div>';
  }

  function openModal(html, onClose) {
    var dlg = $('#modal');
    $('#modal-body').innerHTML = html;
    dlg._onClose = onClose;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    var f = $('#modal-body [autofocus]') || $('#modal-body button, #modal-body input');
    if (f) f.focus();
  }
  function closeModal() { var dlg = $('#modal'); if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); } }
  App.closeModal = closeModal;

  // ---------------- theme ----------------
  function applyLook() {
    var s = st().settings, r = document.documentElement;
    if (s.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', s.theme);
    r.setAttribute('data-size', s.textSize || 'm');
    $('#profile-chip').textContent = st().profile;
  }

  // ---------------- navigation ----------------
  function setTab(tab, sub) {
    if (App.session) {
      var live = App.session.active && !App.session.done;
      if (live && App.session.kind === 'exam') {
        if (!confirm('Pause this exam? It is saved and you can resume it from Practice.')) return;
        saveExam();
      } else if (live && !confirm('Leave this session? Answers so far are saved.')) return;
      if (live && App.session.kind === 'practice' && App.session.results.length && App.session.taskKey) markDone(App.session.taskKey);
      endTimers();
      App.session = null;
    }
    App.tab = tab; App.sub = sub || null;
    $all('.tabs button').forEach(function (b) { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    render();
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  App.setTab = setTab;

  function render() {
    if (App.session) return renderSession();
    var fn = { today: renderToday, learn: renderLearn, practice: renderPractice, review: renderReview, progress: renderProgress }[App.tab];
    fn();
  }
  App.render = render;

  function header(title) { return '<h2>' + title + '</h2><p class="hint">' + TAB_HINT[App.tab] + '</p>'; }

  // ---------------- TODAY ----------------
  function renderToday() {
    var s = st().settings, plan = P.today();
    var h = header('Today');
    h += '<div class="card"><div class="spread"><div><div class="muted small">' + esc(fmtDate(plan.date)) + '</div>';
    if (plan.daysLeft > 0) h += '<div><span class="big-num">' + plan.daysLeft + '</span> day' + (plan.daysLeft === 1 ? '' : 's') + ' to the exam</div>';
    h += '<div class="small">Exam date: ' + esc(fmtDate(s.examDate)) + ' ' + (s.examDateIsPlaceholder ? '<span class="tag">placeholder</span>' : '<span class="tag ok">set by you</span>') + '</div>';
    h += '</div></div><div class="small muted">' + esc(plan.phase.name || '') + ' · ' + P.minutes() + ' min a day</div>';
    if (s.examDateIsPlaceholder) h += '<p class="small muted">PRC has not announced the next LET date. Late March 2027 is a placeholder. <button class="btn small secondary" data-act="settings">Set the date</button></p>';
    h += '</div>';

    if (plan.behind) {
      h += '<div class="banner warn" role="alert"><strong>Behind schedule.</strong> ' +
        (plan.behind.overdue ? plan.behind.overdue + ' overdue review' + (plan.behind.overdue === 1 ? '' : 's') : '') +
        (plan.behind.overdue && plan.behind.topics ? ' and ' : '') + (plan.behind.topics ? plan.behind.topics + ' topic' + (plan.behind.topics === 1 ? '' : 's') + ' not started yet' : '') +
        '. Nothing is deleted. Choose how to catch up:<div class="row" style="margin-top:8px">' +
        '<button class="btn small ' + (s.catchUp === 'order' ? '' : 'secondary') + '" data-act="catchup" data-v="order" aria-pressed="' + (s.catchUp === 'order') + '">Catch up in order</button>' +
        '<button class="btn small ' + (s.catchUp === 'replan' ? '' : 'secondary') + '" data-act="catchup" data-v="replan" aria-pressed="' + (s.catchUp === 'replan') + '">Re-plan across remaining days</button></div></div>';
    }

    if (plan.status === 'before') h += '<div class="card">Your plan starts on ' + esc(fmtDate(s.startDate)) + '. You can still practise from the Practice tab.</div>';
    else if (plan.status === 'after') h += '<div class="card">The exam date has passed. <button class="btn small" data-act="settings">Set the next exam date</button></div>';
    else if (plan.status === 'examday') h += '<div class="card"><h3>Exam day</h3><p>No studying today. Good luck!</p><button class="btn secondary" data-act="checklist">Exam-day checklist</button></div>';
    else if (plan.rest) {
      h += '<div class="card"><h3>Rest day</h3><p>Nothing is scheduled today. Rest helps memory. If you want something light, try a few flashcards.</p>' +
        '<button class="btn secondary" data-act="cards">Optional: 10 flashcards</button></div>';
    } else {
      var all = plan.tasks.length, done = plan.tasks.filter(function (t) { return isDone(t.key); }).length;
      h += '<div class="card"><div class="spread"><h3 style="margin:0">Your plan</h3><span class="small muted">about ' + plan.minutes + ' min · ' + done + '/' + all + ' done</span></div>';
      if (all && done === all) h += '<div class="banner good"><strong>Done for today.</strong> Well done — stop here or do an extra quick quiz.</div>';
      h += '<ol class="checklist">';
      plan.tasks.forEach(function (t, i) {
        var d = isDone(t.key);
        h += '<li class="' + (d ? 'done' : '') + '"><button class="tick" data-act="tick" data-key="' + esc(t.key) + '" aria-label="' + (d ? 'Mark not done' : 'Mark done') + ': ' + esc(t.title) + '">' + (d ? '✓' : '') + '</button>' +
          '<div class="task"><div class="task-title">' + esc(t.title) + '</div><div class="small muted">' + esc(t.detail) + ' · ~' + t.min + ' min</div></div>' +
          '<button class="btn small" data-act="task" data-i="' + i + '">' + (d ? 'Again' : 'Start') + '</button></li>';
      });
      h += '</ol></div>';
      App._plan = plan;
    }
    var tday = st().days[S.today()];
    if (tday && tday.n) h += '<p class="small muted">Today so far: ' + tday.n + ' items, ' + pct(tday.ok / tday.n) + ' correct, ' + Math.round((tday.ms || 0) / 60000) + ' min.</p>';
    h += '<p class="small muted">This is a free study aid. It is not a PRC product. Check official PRC announcements for exam details.</p>';
    main.innerHTML = h;
  }

  function runTask(t) {
    var a = t.action, key = t.key;
    if (a.type === 'reviews') return startPractice('Due review', E.dueItems().slice(0, a.n), { taskKey: key });
    if (a.type === 'quick') return startPractice('Mixed practice', E.quickQuiz(a.n), { taskKey: key });
    if (a.type === 'mix') return startPractice('Interleaved mix', E.interleavedMix(a.n), { taskKey: key });
    if (a.type === 'smart') { var sm = E.smartReview(a.n); if (!sm.length) sm = E.quickQuiz(a.n); return startPractice('Smart review', sm, { taskKey: key }); }
    if (a.type === 'newline') { App.tab = 'learn'; App.sub = { line: a.line, taskKey: key, newline: true }; return setTab('learn', App.sub); }
    if (a.type === 'exam') return startExam([{ area: a.area, size: a.size }], { taskKey: key, mock: a.mock });
    if (a.type === 'cards') return startCards(a.n || 20, { taskKey: key });
    if (a.type === 'yield') return startYield(a.n || 30, key);
    if (a.type === 'weak') { var w = E.weakSpots(); var items = [];
      w.slice(0, 3).forEach(function (x) { items = items.concat(E.topicDrill(x.line.id, null, 7)); });
      if (!items.length) items = E.smartReview(20).length ? E.smartReview(20) : E.quickQuiz(20);
      return startPractice('Weak spots', E.interleave(items), { taskKey: key }); }
    if (a.type === 'checklist') { showChecklist(); markDone(key); render(); }
  }

  function startYield(n, key) {
    var top = E.learnOrder().slice(0, 12).map(function (l) { return l.id; });
    var cards = E.shuffle(D.cards.filter(function (c) { return top.indexOf(c.l) >= 0; })).slice(0, n);
    startCardList(cards, { taskKey: key, title: 'Highest-yield flashcards' });
  }

  function showChecklist() {
    openModal('<h2 id="modal-title">Exam-day checklist</h2>' +
      '<p class="small muted">General preparation steps. For the exact list of what to bring and what is not allowed, follow your PRC Notice of Admission and the latest PRC announcement.</p>' +
      '<ul><li>Read your Notice of Admission again tonight: venue, room, reporting time, and the items it tells you to bring.</li>' +
      '<li>Prepare those items in one bag tonight.</li><li>Plan your route and leave early; allow for traffic and finding the room.</li>' +
      '<li>Sleep at your usual time. No new topics tonight.</li><li>Eat before you leave and bring water if allowed.</li>' +
      '<li>In the exam: answer every item, flag hard ones and come back, and watch the time for each part.</li></ul>' +
      '<button class="btn" data-act="close" autofocus>Close</button>');
  }

  // ---------------- PRACTICE ----------------
  function renderPractice() {
    var h = header('Practice');
    h += '<div class="grid2">' +
      mode('quick', 'Quick quiz', '10 mixed items: due reviews and new ones.') +
      mode('drill', 'Topic drill', 'One TOS line or subtopic. Good right after a short lesson.') +
      mode('mix', 'Interleaved mix', '20 items across lines, weighted to easily confused topics.') +
      mode('rapid', 'Rapid fire', '60-second rounds of quick recall items and flashcards.') +
      mode('smart', 'Smart review', 'Your missed, guessed, slow and twice-missed items.') +
      mode('exam', 'Timed part exam', 'One part at exam pace: GenEd 48 s, ProfEd 72 s, Specialization 84 s per item.') +
      mode('mock', 'Full mock', '450 items in three timed parts with breaks, scored with the reported passing rule.') +
      '</div>';
    if (st().examInProgress) h += '<div class="banner info">You have an unfinished timed exam. <button class="btn small" data-act="resume-exam">Resume</button> <button class="btn small ghost" data-act="discard-exam">Discard</button></div>';
    main.innerHTML = h;
  }
  function mode(id, t, d) { return '<button class="mode" data-act="mode" data-mode="' + id + '"><strong>' + t + '</strong><span class="small muted">' + d + '</span></button>'; }

  function pickMode(m) {
    if (m === 'quick') return startPractice('Quick quiz', E.quickQuiz(10));
    if (m === 'mix') return startPractice('Interleaved mix', E.interleavedMix(20));
    if (m === 'smart') { var s = E.smartReview(15); if (!s.length) { toast('Nothing to review yet — answer some questions first.'); return; } return startPractice('Smart review', s); }
    if (m === 'rapid') return startRapid();
    if (m === 'drill') return drillPicker();
    if (m === 'exam') return examPicker();
    if (m === 'mock') {
      openModal('<h2 id="modal-title">Full mock exam</h2><p>450 items: GenEd 150 (2 h), ProfEd 150 (3 h), Specialization 150 (3 h 30 min), with a break screen between parts. That is longer than your daily limit; take it on a day you set aside, or use the five-day mock in the final-week plan.</p>' +
        '<p class="small muted">Scored with the reported rule: general average at least 75% (weights 20/40/40) and no part below 50%. This rule is reported, not verified from an official text.</p>' +
        '<div class="row"><button class="btn" data-act="start-mock" autofocus>Start full mock</button><button class="btn ghost" data-act="close">Cancel</button></div>');
    }
  }

  function drillPicker() {
    var h = '<h2 id="modal-title">Topic drill</h2><label class="field">TOS line<select id="drill-line">';
    E.AREAS.forEach(function (a) {
      h += '<optgroup label="' + esc(E.PART_NAME[a]) + '">';
      D.lines.filter(function (l) { return l.area === a; }).forEach(function (l) { h += '<option value="' + l.id + '">' + l.id + ' — ' + esc(P.shortTitle(l.title)) + '</option>'; });
      h += '</optgroup>';
    });
    h += '</select></label><label class="field">Subtopic (optional)<select id="drill-mini"></select></label>' +
      '<label class="field">Number of items<select id="drill-n"><option>5</option><option selected>10</option><option>20</option></select></label>' +
      '<div class="row"><button class="btn" data-act="start-drill">Start</button><button class="btn ghost" data-act="close">Cancel</button></div>';
    openModal(h);
    var sel = $('#drill-line');
    function fill() {
      var l = D.lineById[sel.value];
      $('#drill-mini').innerHTML = '<option value="">All subtopics</option>' + l.minis.filter(function (m) { return D.byMini[m]; })
        .map(function (m) { return '<option value="' + m + '">' + esc(D.minis[m] ? D.minis[m].title : m) + ' (' + D.byMini[m].length + ')</option>'; }).join('');
    }
    sel.onchange = fill; fill();
  }

  function examPicker() {
    var h = '<h2 id="modal-title">Timed part exam</h2><label class="field">Part<select id="ex-area">' +
      E.AREAS.map(function (a) { return '<option value="' + a + '">' + esc(E.PART_NAME[a]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field">Length<select id="ex-size"><option value="150">Full part: 150 items</option><option value="75">Half: 75 items</option><option value="40" selected>Short: 40 items</option><option value="20">Mini: 20 items</option></select>' +
      '<span class="desc" id="ex-time"></span></label>' +
      '<p class="small muted">Items follow the TOS item counts per line. Flag items to come back to. Flagged items count as "unsure" for review scheduling.</p>' +
      '<div class="row"><button class="btn" data-act="start-exam">Start</button><button class="btn ghost" data-act="close">Cancel</button></div>';
    openModal(h);
    function upd() { $('#ex-time').textContent = 'Time limit: ' + mmss($('#ex-size').value * E.PACE[$('#ex-area').value]); }
    $('#ex-area').onchange = upd; $('#ex-size').onchange = upd; upd();
  }

  // ---------------- practice session (item flow §6.1) ----------------
  function startPractice(title, items, opts) {
    opts = opts || {};
    items = (items || []).filter(Boolean);
    if (!items.length) { toast('No items available for this right now.'); return; }
    closeModal();
    App.session = { kind: 'practice', active: true, title: title, items: items, i: 0, results: [], taskKey: opts.taskKey, onDone: opts.onDone, newline: opts.newline, t0s: Date.now() };
    newItem();
  }
  App.startPractice = startPractice;

  function newItem() { var s = App.session; s.pick = null; s.conf = null; s.revealed = false; s.t0 = Date.now(); s.boost = null; render(); window.scrollTo(0, 0); }

  function renderSession() {
    var s = App.session;
    if (s.kind === 'practice') return s.done ? renderSummary() : renderItem();
    if (s.kind === 'exam') return s.done ? renderExamResult() : (s.onBreak ? renderBreak() : renderExamItem());
    if (s.kind === 'cards') return s.done ? renderCardSummary() : renderCard();
    if (s.kind === 'rapid') return s.done ? renderRapidSummary() : renderRapid();
  }

  function renderItem() {
    var s = App.session, q = s.items[s.i];
    var h = '<div class="spread no-print"><h2 style="margin:8px 0">' + esc(s.title) + '</h2><button class="btn small ghost" data-act="quit">End session</button></div>';
    h += '<div class="progressbar" aria-hidden="true"><div style="width:' + (100 * s.i / s.items.length) + '%"></div></div>';
    h += '<div class="card"><div class="q-meta"><span>Item ' + (s.i + 1) + ' of ' + s.items.length + '</span><span>' + esc(E.PART_SHORT[q.a]) + ' · ' + q.l + ' ' + esc(lineTitle(q.l)) + (q.t !== 'mcq' ? ' · ' + q.t : '') + '</span></div>';
    h += '<p class="q-stem" id="stem">' + stemHtml(q) + '</p><div class="opts" role="group" aria-labelledby="stem">';
    q.o.forEach(function (o, i) {
      var cls = 'opt';
      if (s.revealed) { if (i === q.k) cls += ' correct'; else if (i === s.pick) cls += ' wrong'; }
      else if (i === s.pick) cls += ' picked';
      h += '<button class="' + cls + '" data-act="pick" data-i="' + i + '"' + (s.revealed ? ' disabled' : '') + ' aria-pressed="' + (i === s.pick) + '"><span class="letter">' + LETTERS[i] + '</span><span>' + esc(o) + '</span></button>';
    });
    h += '</div>';
    if (!s.revealed && s.pick !== null) {
      h += '<div class="conf"><p class="small"><strong>How sure are you?</strong> (rate before you see the answer)</p><div class="row">' +
        '<button class="btn" data-act="conf" data-c="sure">Sure <kbd>S</kbd></button><button class="btn secondary" data-act="conf" data-c="unsure">Unsure <kbd>U</kbd></button><button class="btn secondary" data-act="conf" data-c="guess">Guess <kbd>G</kbd></button></div></div>';
    }
    if (s.revealed) h += feedbackHtml(q, s.pick, s.conf, s.boost);
    h += '</div>';
    if (s.revealed) {
      var bm = st().bookmarks.indexOf(q.id) >= 0;
      h += '<div class="row no-print"><button class="btn" data-act="next" id="btn-next">' + (s.i + 1 < s.items.length ? 'Next item' : 'Finish') + ' <kbd>Enter</kbd></button>' +
        '<button class="btn ghost" data-act="bookmark" data-id="' + q.id + '">' + (bm ? '★ Bookmarked' : '☆ Bookmark') + '</button>' +
        '<button class="btn ghost" data-act="open-line" data-line="' + q.l + '">Full lesson</button></div>';
    } else h += '<p class="small muted no-print">Keys: 1–4 or A–D to choose.</p>';
    main.innerHTML = h;
    if (s.revealed) { var n = $('#btn-next'); if (n) n.focus({ preventScroll: true }); }
  }

  function feedbackHtml(q, pick, conf, boost) {
    var ok = pick === q.k;
    var h = '<div class="feedback ' + (ok ? 'ok' : 'no') + '" role="status" aria-live="polite"><div class="verdict">' + (ok ? '✓ Correct' : '✗ Not quite') + '</div>';
    h += '<p><strong>Answer: ' + LETTERS[q.k] + '. ' + esc(q.o[q.k]) + '</strong><br>' + esc(q.e[q.k]) + '</p>';
    if (pick === null || pick === undefined) h += '<p><strong>Not answered.</strong></p>';
    else if (!ok) h += '<p><strong>You chose ' + LETTERS[pick] + ':</strong> ' + esc(q.e[pick]) + '</p>';
    if (!ok && conf === 'sure') h += '<div class="refute"><strong>High-confidence error.</strong> You were sure that “' + esc(q.o[pick]) + '” was right. It is not: ' + esc(q.e[pick]) + ' The correct answer is “' + esc(q.o[q.k]) + '”.</div>';
    if (ok && conf !== 'sure') h += '<p class="small">Right, but you marked it <em>' + conf + '</em>, so it comes back tomorrow like a miss.</p>';
    h += '<details' + (ok ? '' : ' open') + '><summary>Why each option is right or wrong</summary><ul class="why-list">';
    q.o.forEach(function (o, i) { h += '<li><strong>' + LETTERS[i] + (i === q.k ? ' (correct)' : '') + ':</strong> ' + esc(o) + ' — ' + esc(q.e[i]) + '</li>'; });
    h += '</ul></details><p class="small muted">Sources: ' + srcLine(q.src) + '</p></div>';
    if (!ok) h += miniHtml(q.m);
    if (boost) h += '<div class="banner warn"><strong>Second miss on “' + esc(D.minis[boost] ? D.minis[boost].title : boost) + '” this week.</strong> Read the full lesson for ' + q.l + '. Three extra items on this subtopic are scheduled over the next three days. <button class="btn small" data-act="open-line" data-line="' + q.l + '">Open the full lesson</button></div>';
    return h;
  }

  function pick(i) {
    var s = App.session;
    if (!s || s.revealed) return;
    if (s.pick === null) s.ms = Date.now() - s.t0;
    s.pick = i; render();
    var c = $('[data-act="conf"]'); if (c) c.focus({ preventScroll: true });
  }
  function confirmConf(c) {
    var s = App.session, q = s.items[s.i];
    if (s.pick === null || s.revealed) return;
    s.conf = c; s.revealed = true;
    var ok = s.pick === q.k;
    var r = E.record(q, ok, c, s.ms);
    s.boost = r.boost;
    s.results.push({ q: q, ok: ok, conf: c, pick: s.pick });
    render();
  }
  function nextItem() {
    var s = App.session;
    addMs(Date.now() - s.t0); S.save();
    if (s.i + 1 < s.items.length) { s.i++; newItem(); }
    else finishPractice();
  }
  function finishPractice() {
    var s = App.session;
    s.done = true;
    if (s.results.length && s.taskKey) markDone(s.taskKey);
    if (s.newline && s.results.length) { st().linesStarted[s.newline] = st().linesStarted[s.newline] || S.today(); S.save(); }
    render();
  }
  function renderSummary() {
    var s = App.session, n = s.results.length, ok = s.results.filter(function (r) { return r.ok; }).length;
    var mins = Math.round((Date.now() - s.t0s) / 60000);
    var h = '<h2>' + esc(s.title) + ': done</h2><div class="card"><p class="big-num">' + ok + ' / ' + n + '</p><p>' + pct(n ? ok / n : null) + ' correct · about ' + mins + ' min</p>';
    var unsure = s.results.filter(function (r) { return r.ok && r.conf !== 'sure'; }).length;
    if (unsure) h += '<p class="small">' + unsure + ' correct but not sure — they come back tomorrow.</p>';
    h += '</div>';
    var missed = s.results.filter(function (r) { return !r.ok; });
    if (missed.length) {
      h += '<div class="card"><h3>Missed (scheduled for 1 day → 3 → 7 → 14)</h3><ul class="list">';
      missed.forEach(function (r) { h += '<li><button class="item" data-act="show-q" data-id="' + r.q.id + '"><span>' + esc(r.q.s.slice(0, 110)) + (r.q.s.length > 110 ? '…' : '') + '</span><span class="muted small">' + r.q.l + '</span></button></li>'; });
      h += '</ul></div>';
    }
    h += '<div class="row"><button class="btn" data-act="back-today">Back to Today</button><button class="btn ghost" data-act="back-tab">Close</button></div>';
    main.innerHTML = h;
  }

  function showQuestion(id) {
    var q = D.qById[id];
    if (!q) return;
    openModal('<h2 id="modal-title">' + q.l + ' · ' + esc(lineTitle(q.l)) + '</h2><p class="q-stem">' + stemHtml(q) + '</p>' + feedbackHtml(q, q.k, 'sure', null) +
      miniHtml(q.m) + '<div class="row" style="margin-top:12px"><button class="btn" data-act="close" autofocus>Close</button></div>');
  }

  // ---------------- timed exams ----------------
  var timerId = null;
  function endTimers() { if (timerId) { clearInterval(timerId); timerId = null; } if (App._rapidTimer) { clearInterval(App._rapidTimer); App._rapidTimer = null; } }

  function startExam(parts, opts) {
    opts = opts || {};
    closeModal();
    var ps = parts.map(function (p) {
      var items = E.buildExam(p.area, p.size);
      return { area: p.area, ids: items.map(function (q) { return q.id; }), answers: {}, flags: {}, timeLeft: items.length * E.PACE[p.area], ms: {} };
    });
    App.session = { kind: 'exam', active: true, parts: ps, pi: 0, i: 0, taskKey: opts.taskKey, mock: !!opts.mock, full: !!opts.full, started: new Date().toISOString(), t0: Date.now() };
    saveExam();
    beginPartTimer();
    render();
  }
  function saveExam() {
    var s = App.session;
    st().examInProgress = { parts: s.parts, pi: s.pi, i: s.i, taskKey: s.taskKey, mock: s.mock, full: s.full, started: s.started, onBreak: !!s.onBreak };
    S.save();
  }
  function resumeExam() {
    var x = st().examInProgress;
    if (!x) return;
    App.session = { kind: 'exam', active: true, parts: x.parts, pi: x.pi, i: x.i, taskKey: x.taskKey, mock: x.mock, full: x.full, started: x.started, onBreak: x.onBreak, t0: Date.now() };
    if (!x.onBreak) beginPartTimer();
    render();
  }
  function beginPartTimer() {
    endTimers();
    var s = App.session, last = Date.now();
    s.qShown = Date.now();
    timerId = setInterval(function () {
      if (!App.session || App.session !== s) return endTimers();
      var now = Date.now(), p = s.parts[s.pi];
      p.timeLeft -= (now - last) / 1000; last = now;
      var el = $('#ex-timer');
      if (el) { el.textContent = mmss(p.timeLeft); el.classList.toggle('low', p.timeLeft < 300); }
      if (Math.floor(p.timeLeft) % 10 === 0) saveExam();
      if (p.timeLeft <= 0) { toast('Time is up for this part.'); submitPart(); }
    }, 1000);
  }
  function renderExamItem() {
    var s = App.session, p = s.parts[s.pi], q = D.qById[p.ids[s.i]];
    var answered = Object.keys(p.answers).length;
    var h = '<div class="spread"><h2 style="margin:8px 0">' + (s.full ? 'Full mock · part ' + (s.pi + 1) + ' of 3: ' : 'Timed: ') + esc(E.PART_SHORT[p.area]) + '</h2>' +
      '<span>⏱ <span id="ex-timer" class="timer" role="timer" aria-label="Time left">' + mmss(p.timeLeft) + '</span></span></div>';
    h += '<div class="progressbar" aria-hidden="true"><div style="width:' + (100 * answered / p.ids.length) + '%"></div></div>';
    h += '<div class="card"><div class="q-meta"><span>Item ' + (s.i + 1) + ' of ' + p.ids.length + ' · ' + answered + ' answered</span><span>' + (p.flags[q.id] ? '⚑ flagged' : '') + '</span></div>';
    h += '<p class="q-stem" id="stem">' + stemHtml(q) + '</p><div class="opts" role="group" aria-labelledby="stem">';
    q.o.forEach(function (o, i) {
      var sel = p.answers[q.id] === i;
      h += '<button class="opt' + (sel ? ' picked' : '') + '" data-act="ex-pick" data-i="' + i + '" aria-pressed="' + sel + '"><span class="letter">' + LETTERS[i] + '</span><span>' + esc(o) + '</span></button>';
    });
    h += '</div></div><div class="row"><button class="btn ghost" data-act="ex-prev"' + (s.i ? '' : ' disabled') + '>← Prev</button>' +
      '<button class="btn ghost" data-act="ex-flag">' + (p.flags[q.id] ? 'Unflag' : '⚑ Flag') + '</button>' +
      '<button class="btn" data-act="ex-next">' + (s.i + 1 < p.ids.length ? 'Next →' : 'Review') + '</button></div>';
    h += '<details style="margin-top:12px"' + (s.showNav ? ' open' : '') + ' id="ex-navd"><summary>Navigator (answered, ⚑ flagged)</summary><div class="navgrid">';
    p.ids.forEach(function (id, k) {
      h += '<button data-act="ex-go" data-k="' + k + '" class="' + (p.answers[id] !== undefined ? 'answered ' : '') + (p.flags[id] ? 'flagged ' : '') + (k === s.i ? 'current' : '') + '" aria-label="Item ' + (k + 1) + '">' + (k + 1) + '</button>';
    });
    h += '</div></details><div class="row" style="margin-top:12px"><button class="btn secondary" data-act="ex-submit">Submit this part</button>' +
      '<button class="btn ghost" data-act="ex-pause">Pause and leave</button></div>';
    main.innerHTML = h;
  }
  function exMove(k) {
    var s = App.session, p = s.parts[s.pi], id = p.ids[s.i];
    p.ms[id] = (p.ms[id] || 0) + (Date.now() - (s.qShown || Date.now()));
    s.i = Math.max(0, Math.min(p.ids.length - 1, k)); s.qShown = Date.now();
    var nav = $('#ex-navd'); s.showNav = nav && nav.open;
    saveExam(); render();
  }
  function submitPart(confirmFirst) {
    var s = App.session, p = s.parts[s.pi];
    if (confirmFirst) {
      var un = p.ids.length - Object.keys(p.answers).length, fl = Object.keys(p.flags).filter(function (k) { return p.flags[k]; }).length;
      if (!confirm('Submit this part? ' + (un ? un + ' unanswered. ' : '') + (fl ? fl + ' flagged.' : ''))) return;
    }
    endTimers();
    addMs(Math.min((p.ids.length * E.PACE[p.area] - Math.max(0, p.timeLeft)) * 1000, 4 * 3600 * 1000));
    p.submitted = true;
    if (s.pi + 1 < s.parts.length) { s.pi++; s.i = 0; s.onBreak = true; saveExam(); render(); return; }
    finishExam();
  }
  function renderBreak() {
    var s = App.session, p = s.parts[s.pi];
    main.innerHTML = '<h2>Break</h2><div class="card"><p>Part ' + s.pi + ' is done. Stretch, drink water, rest your eyes.</p><p>Next: <strong>' + esc(E.PART_NAME[p.area]) + '</strong>, ' + p.ids.length + ' items, ' + mmss(p.timeLeft) + '.</p>' +
      '<div class="row"><button class="btn" data-act="ex-resume-part">Start next part</button><button class="btn ghost" data-act="ex-pause">Leave and resume later</button></div></div>';
  }
  function finishExam() {
    var s = App.session, perPart = {}, perLine = {};
    s.parts.forEach(function (p) {
      var ok = 0;
      p.ids.forEach(function (id) {
        var q = D.qById[id], a = p.answers[id], good = a === q.k;
        if (good) ok++;
        var L = perLine[q.l] = perLine[q.l] || { n: 0, ok: 0 }; L.n++; L.ok += good ? 1 : 0;
        if (a !== undefined) E.record(q, good, p.flags[id] ? 'unsure' : 'sure', p.ms[id] || 0, { noBoost: true });
        else E.record(q, false, 'guess', 0, { noBoost: true });
      });
      perPart[p.area] = { n: p.ids.length, ok: ok };
    });
    var result = { date: S.today(), kind: s.full ? 'full-mock' : (s.mock ? 'plan-mock' : 'part'), parts: perPart, perLine: perLine };
    if (s.full) {
      var avg = E.AREAS.reduce(function (acc, a) { return acc + E.WEIGHT[a] * perPart[a].ok / perPart[a].n; }, 0);
      result.avg = avg;
      result.pass = avg >= 0.75 && E.AREAS.every(function (a) { return perPart[a].ok / perPart[a].n >= 0.5; });
    }
    st().exams.push(result);
    st().examInProgress = null;
    if (s.taskKey) markDone(s.taskKey);
    S.save();
    s.done = true; s.result = result; s.reviewFilter = 'wrong';
    render();
  }
  function renderExamResult() {
    var s = App.session, r = s.result;
    var h = '<h2>Exam results</h2><div class="card">';
    Object.keys(r.parts).forEach(function (a) { var x = r.parts[a]; h += '<p><strong>' + esc(E.PART_NAME[a]) + ':</strong> ' + x.ok + ' / ' + x.n + ' (' + pct(x.ok / x.n) + ')</p>'; });
    if (r.kind === 'full-mock') {
      h += '<p class="big-num">' + pct(r.avg) + '</p><p>Weighted general average (20/40/40). ' + (r.pass ? '<span class="tag ok">meets the reported passing rule</span>' : '<span class="tag">below the reported passing rule</span>') + '</p>' +
        '<p class="small muted">Reported rule (unverified): average at least 75% and no part below 50%.</p>';
    }
    h += '</div><div class="card"><h3>By TOS line</h3><div class="tbl-wrap" tabindex="0" role="region" aria-label="Score by TOS line"><table class="data"><thead><tr><th>Line</th><th class="num">Score</th><th class="num">%</th></tr></thead><tbody>';
    Object.keys(r.perLine).sort().forEach(function (l) { var x = r.perLine[l]; h += '<tr><td>' + l + ' ' + esc(lineTitle(l)) + '</td><td class="num">' + x.ok + '/' + x.n + '</td><td class="num">' + pct(x.ok / x.n) + '</td></tr>'; });
    h += '</tbody></table></div></div>';
    h += '<div class="card"><div class="spread"><h3 style="margin:0">Review answers</h3><div class="seg" role="group" aria-label="Filter">' +
      '<button data-act="ex-filter" data-f="wrong" aria-pressed="' + (s.reviewFilter === 'wrong') + '">Wrong</button><button data-act="ex-filter" data-f="flagged" aria-pressed="' + (s.reviewFilter === 'flagged') + '">Flagged</button><button data-act="ex-filter" data-f="all" aria-pressed="' + (s.reviewFilter === 'all') + '">All</button></div></div>';
    var shown = 0;
    s.parts.forEach(function (p) {
      p.ids.forEach(function (id, k) {
        var q = D.qById[id], a = p.answers[id], good = a === q.k;
        if (s.reviewFilter === 'wrong' && good) return;
        if (s.reviewFilter === 'flagged' && !p.flags[id]) return;
        if (shown++ > 200) return;
        h += '<details><summary>' + (good ? '✓' : '✗') + ' ' + (p.flags[id] ? '⚑ ' : '') + E.PART_SHORT[p.area] + ' #' + (k + 1) + ': ' + esc(q.s.slice(0, 90)) + (q.s.length > 90 ? '…' : '') + '</summary>' +
          '<p class="q-stem">' + stemHtml(q) + '</p>' +
          feedbackHtml(q, a === undefined ? null : a, p.flags[id] ? 'unsure' : 'sure', null) + '</details>';
      });
    });
    if (!shown) h += '<p class="muted">Nothing to show for this filter.</p>';
    h += '</div><div class="row"><button class="btn" data-act="back-today">Back to Today</button><button class="btn ghost" data-act="back-tab">Close</button></div>';
    main.innerHTML = h;
  }

  // ---------------- flashcards ----------------
  function startCards(n, opts) {
    var cd = E.cardDue();
    var cards = cd.due.concat(cd.fresh).slice(0, n || 20);
    if (!cards.length) { toast('No flashcards due. Start a topic in Learn to unlock its cards.'); return; }
    startCardList(cards, opts);
  }
  function startCardList(cards, opts) {
    opts = opts || {};
    closeModal();
    App.session = { kind: 'cards', active: true, title: opts.title || 'Flashcards', cards: cards, i: 0, shown: false, res: [], taskKey: opts.taskKey, t0: Date.now() };
    render();
  }
  function renderCard() {
    var s = App.session, c = s.cards[s.i];
    var h = '<div class="spread"><h2 style="margin:8px 0">' + esc(s.title) + '</h2><button class="btn small ghost" data-act="quit">End</button></div>' +
      '<div class="progressbar" aria-hidden="true"><div style="width:' + (100 * s.i / s.cards.length) + '%"></div></div>' +
      '<div class="card flash"><div class="q-meta"><span>Card ' + (s.i + 1) + ' of ' + s.cards.length + '</span><span>' + c.l + ' · ' + esc(c.sub) + '</span></div>' +
      '<div class="md">' + M.inline(c.f) + '</div>';
    if (s.shown) h += '<div class="back" role="status"><div class="md">' + M.inline(c.b) + '</div><p class="small muted">Sources: ' + srcLine(c.src) + '</p></div>';
    h += '</div><div class="row">';
    if (!s.shown) h += '<button class="btn block" data-act="card-show" id="card-main">Show answer <kbd>Space</kbd></button>';
    else h += '<button class="btn" data-act="card-ans" data-ok="1" id="card-main">Got it</button><button class="btn secondary" data-act="card-ans" data-ok="0">Missed it</button>';
    h += '</div>';
    main.innerHTML = h;
    $('#card-main').focus({ preventScroll: true });
  }
  function cardAnswer(ok) {
    var s = App.session, c = s.cards[s.i];
    E.recordCard(c, ok); s.res.push(ok);
    addMs(Math.min(Date.now() - (s.tc || s.t0), 60000)); s.tc = Date.now();
    if (s.i + 1 < s.cards.length) { s.i++; s.shown = false; render(); }
    else { s.done = true; if (s.taskKey) markDone(s.taskKey); S.save(); render(); }
  }
  function renderCardSummary() {
    var s = App.session, ok = s.res.filter(Boolean).length;
    main.innerHTML = '<h2>' + esc(s.title) + ': done</h2><div class="card"><p class="big-num">' + ok + ' / ' + s.res.length + '</p><p>Missed cards come back tomorrow.</p></div>' +
      '<div class="row"><button class="btn" data-act="back-today">Back to Today</button><button class="btn ghost" data-act="back-tab">Close</button></div>';
  }

  // ---------------- rapid fire ----------------
  function startRapid() {
    var items = E.quickQuiz(40), cd = E.cardDue(), cards = E.shuffle(cd.due.concat(cd.fresh, D.cards.slice(0))).slice(0, 20);
    var mixed = [];
    items.forEach(function (q, i) { mixed.push({ q: q }); if (i % 2 === 1 && cards.length) mixed.push({ c: cards.shift() }); });
    App.session = { kind: 'rapid', active: true, list: mixed, i: 0, left: 60, res: [], t0: Date.now() };
    endTimers();
    var last = Date.now();
    App._rapidTimer = setInterval(function () {
      var s = App.session; if (!s || s.kind !== 'rapid') return endTimers();
      s.left -= (Date.now() - last) / 1000; last = Date.now();
      var el = $('#rf-timer'); if (el) el.textContent = Math.max(0, Math.ceil(s.left)) + ' s';
      if (s.left <= 0) { endTimers(); s.done = true; addMs(60000); S.save(); render(); }
    }, 250);
    render();
  }
  function renderRapid() {
    var s = App.session, x = s.list[s.i];
    if (!x) { s.done = true; endTimers(); return render(); }
    var h = '<div class="spread"><h2 style="margin:8px 0">Rapid fire</h2><span>⏱ <span id="rf-timer" class="timer">' + Math.ceil(s.left) + ' s</span></span></div><div class="card">';
    if (x.q) {
      var q = x.q;
      h += '<p class="q-stem">' + stemHtml(q) + '</p><div class="opts">';
      q.o.forEach(function (o, i) {
        var cls = 'opt';
        if (s.ans !== undefined) { if (i === q.k) cls += ' correct'; else if (i === s.ans) cls += ' wrong'; }
        h += '<button class="' + cls + '" data-act="rf-pick" data-i="' + i + '"' + (s.ans !== undefined ? ' disabled' : '') + '><span class="letter">' + LETTERS[i] + '</span><span>' + esc(o) + '</span></button>';
      });
      h += '</div>';
      if (s.ans !== undefined) h += '<p class="small">' + (s.ans === q.k ? '✓ ' : '✗ ') + esc(q.e[q.k]) + '</p><button class="btn" data-act="rf-next" id="rf-next">Next</button>';
    } else {
      h += '<div class="flash"><div>' + M.inline(x.c.f) + '</div>' + (s.shown ? '<div class="back">' + M.inline(x.c.b) + '</div>' : '') + '</div>';
      h += s.shown ? '<div class="row"><button class="btn" data-act="rf-card" data-ok="1" id="rf-next">Got it</button><button class="btn secondary" data-act="rf-card" data-ok="0">Missed it</button></div>'
        : '<button class="btn block" data-act="rf-show" id="rf-next">Show</button>';
    }
    h += '</div>';
    main.innerHTML = h;
    var n = $('#rf-next'); if (n) n.focus({ preventScroll: true });
  }
  function renderRapidSummary() {
    var s = App.session, ok = s.res.filter(function (r) { return r.ok; }).length;
    var h = '<h2>Rapid fire: time!</h2><div class="card"><p class="big-num">' + ok + ' / ' + s.res.length + '</p><p>Items answered in 60 seconds. Missed items are scheduled for tomorrow.</p></div>';
    var missed = s.res.filter(function (r) { return !r.ok && r.q; });
    if (missed.length) { h += '<div class="card"><h3>Missed</h3><ul class="list">'; missed.forEach(function (r) { h += '<li><button class="item" data-act="show-q" data-id="' + r.q.id + '"><span>' + esc(r.q.s.slice(0, 100)) + '</span></button></li>'; }); h += '</ul></div>'; }
    h += '<div class="row"><button class="btn" data-act="mode" data-mode="rapid">Another round</button><button class="btn ghost" data-act="back-tab">Close</button></div>';
    main.innerHTML = h;
  }

  // ---------------- LEARN ----------------
  function renderLearn() {
    var sub = App.sub || {};
    if (sub.line) return renderLine(sub);
    if (sub.page) return renderLearnPage(sub.page);
    var h = header('Learn');
    h += '<input type="search" id="learn-search" placeholder="Search lessons and mini-lessons" aria-label="Search lessons" value="' + esc(sub.q || '') + '">';
    h += '<div id="search-results"></div>';
    h += '<div class="row" style="margin:12px 0"><button class="btn small ghost" data-act="learn-page" data-p="glossary">Glossary</button><button class="btn small ghost" data-act="learn-page" data-p="mistakes">Common mistakes</button>' +
      '<button class="btn small ghost" data-act="learn-page" data-p="aids">Memory aids</button><button class="btn small ghost" data-act="learn-page" data-p="sources">Sources and licences</button></div>';
    E.AREAS.forEach(function (a) {
      h += '<div class="card"><h3>' + esc(E.PART_NAME[a]) + '</h3><ul class="list">';
      D.lines.filter(function (l) { return l.area === a; }).forEach(function (l) {
        var acc = E.lineAccuracy(l.id, 20), started = st().linesStarted[l.id];
        h += '<li><button class="item" data-act="open-line" data-line="' + l.id + '"><span><strong>' + l.id + '</strong> ' + esc(P.shortTitle(l.title)) + '</span>' +
          '<span class="small muted">' + l.items + ' items' + (acc.n ? ' · ' + pct(acc.acc) : '') + (started ? ' ✓' : '') + '</span></button></li>';
      });
      h += '</ul></div>';
    });
    main.innerHTML = h;
    var inp = $('#learn-search');
    inp.oninput = function () { App.sub = { q: inp.value }; searchLearn(inp.value); };
    if (sub.q) searchLearn(sub.q);
  }
  function searchLearn(q) {
    var box = $('#search-results'); q = String(q || '').trim().toLowerCase();
    if (q.length < 2) { box.innerHTML = ''; return; }
    var res = [];
    D.lines.forEach(function (l) { var i = (l.title + ' ' + l.md).toLowerCase().indexOf(q); if (i >= 0) res.push({ t: 'Lesson ' + l.id + ': ' + P.shortTitle(l.title), line: l.id, snip: snip(l.md, i, q) }); });
    Object.keys(D.minis).forEach(function (id) { var m = D.minis[id], i = (m.title + ' ' + m.md).toLowerCase().indexOf(q); if (i >= 0) res.push({ t: 'Mini-lesson: ' + m.title + ' (' + m.line + ')', mini: id, snip: snip(m.md, i, q) }); });
    box.innerHTML = '<div class="card"><h3>' + res.length + ' result' + (res.length === 1 ? '' : 's') + '</h3><ul class="list">' + res.slice(0, 60).map(function (r) {
      return '<li><button class="item" data-act="' + (r.line ? 'open-line' : 'open-mini') + '" data-line="' + (r.line || '') + '" data-id="' + (r.mini || '') + '"><span><strong>' + esc(r.t) + '</strong><br><span class="small muted">' + esc(r.snip) + '</span></span></button></li>';
    }).join('') + '</ul></div>';
  }
  function snip(md, i, q) { var plain = md.replace(/\*\*|\[SRC[^\]]*\]|[#*_`]/g, ''); var j = plain.toLowerCase().indexOf(q); j = j < 0 ? 0 : j; return (j > 40 ? '…' : '') + plain.slice(Math.max(0, j - 40), j + 90).replace(/\s+/g, ' ') + '…'; }

  function renderLine(sub) {
    var l = D.lineById[sub.line];
    if (!l) { App.sub = null; return renderLearn(); }
    var secs = M.sections(l.md);
    var started = st().linesStarted[l.id];
    var h = '<div class="row no-print"><button class="btn small ghost" data-act="learn-home">← All lessons</button></div>';
    if (sub.cheat) {
      h += '<div class="no-print row" style="margin:8px 0"><button class="btn small" data-act="print">Print</button><button class="btn small ghost" data-act="open-line" data-line="' + l.id + '">Full lesson</button></div>' +
        '<div class="md card"><h2>' + l.id + ' cheat sheet — ' + esc(P.shortTitle(l.title)) + '</h2><h3>Testable facts</h3>' + M.render(secs['2'] || '') +
        '<h3>Common mistakes</h3>' + M.render(secs['3'] || '') + '<h3>Memory aid</h3>' + M.render(secs['4'] || '') + '</div>';
      main.innerHTML = h; return;
    }
    if (sub.newline) {
      h += '<div class="banner info no-print"><strong>New topic.</strong> Read the plain explanation and memory aid (about 8 minutes), then take the 5-item check. ' +
        '<button class="btn small" data-act="line-check" data-line="' + l.id + '">Start the 5-item check</button></div>';
    }
    h += '<div class="row no-print" style="margin:8px 0"><button class="btn small" data-act="line-check" data-line="' + l.id + '">5-item check</button>' +
      '<button class="btn small secondary" data-act="line-drill" data-line="' + l.id + '">Drill 10</button>' +
      '<button class="btn small ghost" data-act="cheat" data-line="' + l.id + '">Cheat sheet</button>' +
      (started ? '<span class="tag ok">started ' + esc(started) + '</span>' : '') + '</div>';
    h += '<article class="md card">' + M.render(l.md) + '</article>';
    h += '<div class="card"><h3>Mini-lessons for this line</h3>';
    l.minis.filter(function (m) { return D.minis[m]; }).forEach(function (m) {
      h += '<details><summary>' + esc(D.minis[m].title) + (D.byMini[m] ? ' <span class="small muted">(' + D.byMini[m].length + ' items)</span>' : '') + '</summary>' + miniHtml(m) +
        (D.byMini[m] ? '<button class="btn small secondary" data-act="mini-drill" data-id="' + m + '" style="margin-top:6px">Drill this subtopic</button>' : '') + '</details>';
    });
    h += '</div><div class="card"><h3>Sources</h3><ul>' + l.src.map(function (id) { var s = window.SOURCES[id];
      return s ? '<li>' + id + ' — ' + esc(s.title) + ', ' + esc(s.by) + ' (' + esc(s.lic) + ')' + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">link</a>' : '') + '</li>' : ''; }).join('') + '</ul></div>';
    main.innerHTML = h;
  }

  function lessonModal(id) {
    var l = D.lineById[id];
    openModal('<h2 id="modal-title" class="sr-only">Lesson ' + id + '</h2><article class="md">' + M.render(l.md) + '</article><div class="row" style="margin-top:12px"><button class="btn" data-act="close" autofocus>Back to the session</button></div>');
  }

  function renderLearnPage(p) {
    var h = '<div class="row"><button class="btn small ghost" data-act="learn-home">← All lessons</button></div>';
    if (p === 'sources') {
      var ids = Object.keys(window.SOURCES).sort();
      h += '<h2>Sources and licences</h2><p class="small muted">All lessons, mini-lessons, flashcards and questions are original text written from facts in these sources. Philippine government works are not subject to copyright (RA 8293 Sec. 176). Wikipedia (CC BY-SA 4.0) was used only as a tertiary source.</p><div class="card"><ul>';
      ids.forEach(function (id) { var s = window.SOURCES[id]; h += '<li><strong>' + id + '</strong> ' + esc(s.title) + ' — ' + esc(s.by) + ' <span class="tag plain">' + esc(s.lic) + '</span>' + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">link</a>' : '') + '</li>'; });
      h += '</ul></div>';
      main.innerHTML = h; return;
    }
    var title = { glossary: 'Glossary', mistakes: 'Common mistakes', aids: 'Memory aids' }[p];
    h += '<h2>' + title + '</h2>';
    if (p === 'glossary') {
      h += '<input type="search" id="glo-q" placeholder="Filter terms" aria-label="Filter glossary"><div id="glo"></div>';
      main.innerHTML = h;
      var terms = glossary();
      var draw = function () {
        var q = $('#glo-q').value.trim().toLowerCase();
        var list = terms.filter(function (t) { return !q || t.term.toLowerCase().indexOf(q) >= 0 || t.fact.toLowerCase().indexOf(q) >= 0; });
        $('#glo').innerHTML = '<p class="small muted">' + list.length + ' terms' + (list.length > 300 ? ' (first 300 shown; type to filter)' : '') + '</p><div class="card"><ul class="list">' +
          list.slice(0, 300).map(function (t) { return '<li style="padding:8px 0"><strong>' + esc(t.term) + '</strong> <span class="small muted">' + t.line + '</span><br><span class="small">' + M.inline(t.fact) + '</span></li>'; }).join('') + '</ul></div>';
      };
      $('#glo-q').oninput = draw; draw();
      return;
    }
    var key = p === 'mistakes' ? '3' : '4';
    E.AREAS.forEach(function (a) {
      h += '<h3>' + esc(E.PART_NAME[a]) + '</h3>';
      D.lines.filter(function (l) { return l.area === a; }).forEach(function (l) {
        var sec = M.sections(l.md)[key];
        if (sec && sec.trim()) h += '<div class="card md"><h4>' + l.id + ' ' + esc(P.shortTitle(l.title)) + '</h4>' + M.render(sec) + '</div>';
      });
    });
    main.innerHTML = h;
  }
  var _glo = null;
  function glossary() {
    if (_glo) return _glo;
    var seen = {}, out = [];
    D.lines.forEach(function (l) {
      (M.sections(l.md)['2'] || '').split('\n').forEach(function (line) {
        if (!/^\s*-\s/.test(line)) return;
        var m = line.match(/\*\*([^*]{2,60})\*\*/);
        if (!m) return;
        var term = m[1].replace(/[.:,;]$/, '');
        var k = term.toLowerCase();
        if (seen[k]) return; seen[k] = 1;
        out.push({ term: term, line: l.id, fact: line.replace(/^\s*-\s*/, '').replace(/\s*\[SRC[^\]]*\]\s*/g, ' ') });
      });
    });
    out.sort(function (a, b) { return a.term.localeCompare(b.term); });
    return (_glo = out);
  }

  // ---------------- REVIEW ----------------
  function renderReview() {
    var due = E.dueItems(), cd = E.cardDue(), weak = E.weakSpots(), bm = E.bookmarked();
    var h = header('Review');
    h += '<div class="grid2"><div class="card"><h3>Due items</h3><p class="big-num">' + due.length + '</p><p class="small muted">Missed or unsure items return after 1, 3, 7 and 14 days.</p>' +
      '<button class="btn" data-act="rev-due"' + (due.length ? '' : ' disabled') + '>Review ' + Math.min(30, due.length) + ' now</button></div>' +
      '<div class="card"><h3>Flashcards</h3><p class="big-num">' + cd.due.length + '</p><p class="small muted">due · ' + cd.fresh.length + ' new available today</p>' +
      '<button class="btn" data-act="rev-cards"' + (cd.due.length + cd.fresh.length ? '' : ' disabled') + '>Study cards</button></div></div>';
    h += '<div class="card"><h3>Smart review</h3><p class="small muted">Weighted to missed, guessed, slow and twice-missed items.</p><button class="btn secondary" data-act="mode" data-mode="smart">Start smart review</button></div>';
    h += '<div class="card"><h3>Weak spots</h3>';
    if (!weak.length) h += '<p class="muted small">No weak spots yet. A TOS line shows here when your last 20 answers on it fall below 70% (at least 5 answers).</p>';
    else { h += '<ul class="list">'; weak.forEach(function (w) { h += '<li><button class="item" data-act="line-drill" data-line="' + w.line.id + '"><span><strong>' + w.line.id + '</strong> ' + esc(P.shortTitle(w.line.title)) + '</span><span class="small">' + pct(w.acc) + ' of ' + w.n + ' · drill</span></button></li>'; }); h += '</ul>'; }
    h += '</div><div class="card"><h3>Bookmarks (' + bm.length + ')</h3>';
    if (!bm.length) h += '<p class="muted small">Tap ☆ Bookmark after any answer to save it here.</p>';
    else { h += '<button class="btn small secondary" data-act="rev-bm">Quiz my bookmarks</button><ul class="list">'; bm.forEach(function (q) { h += '<li><button class="item" data-act="show-q" data-id="' + q.id + '"><span>' + esc(q.s.slice(0, 100)) + '</span><span class="small muted">' + q.l + '</span></button></li>'; }); h += '</ul>'; }
    h += '</div>';
    var recent = E.attempts().filter(function (a) { return !a.ok; }).slice(-15).reverse();
    if (recent.length) { h += '<div class="card"><h3>Recently missed</h3><ul class="list">'; recent.forEach(function (a) { h += '<li><button class="item" data-act="show-q" data-id="' + a.q.id + '"><span>' + esc(a.q.s.slice(0, 100)) + '</span><span class="small muted">' + a.q.l + '</span></button></li>'; }); h += '</ul></div>'; }
    main.innerHTML = h;
  }

  // ---------------- PROGRESS ----------------
  function renderProgress() {
    var r = E.readiness(), s = st();
    var h = header('Progress');
    h += '<div class="card"><h3>Readiness</h3>';
    if (!r.enough) h += '<p class="small muted">Answer at least 20 items in each part to see an estimate. Estimates use your last 150 answers per part, weighted by TOS line.</p>';
    else h += '<p><span class="status-dot ' + r.status + '"></span><strong>' + ({ green: 'On track', amber: 'Close — keep going', red: 'Not yet at the passing level' }[r.status]) + '</strong> · overall estimate ' + pct(r.overall) + '</p>';
    E.AREAS.forEach(function (a) {
      var p = r.parts[a];
      h += '<div class="meter"><span class="small">' + esc(E.PART_SHORT[a]) + '</span><div class="bar" role="img" aria-label="' + esc(E.PART_SHORT[a]) + ' estimate ' + pct(p.p) + '">' +
        (p.p !== null ? '<div class="fill" style="width:' + (p.p * 100) + '%"></div><div class="range" style="left:' + (p.lo * 100) + '%;width:' + ((p.hi - p.lo) * 100) + '%"></div>' : '') +
        '<div class="mark" style="left:50%" title="50%"></div><div class="mark" style="left:75%" title="75%"></div></div><span class="small">' + pct(p.p) + (p.n ? ' <span class="muted">(' + p.n + ')</span>' : '') + '</span></div>';
      if (p.p !== null && p.p < 0.6) h += '<p class="small" style="color:var(--bad)">⚠ ' + esc(E.PART_SHORT[a]) + ' is near or below the 50% part minimum.</p>';
    });
    h += '<p class="small muted">Green: overall ≥ 80% and every part ≥ 60%. Amber: overall 75–80% or a part at 50–60%. Red: otherwise. Bars show a 95% range. Rule used: general average ≥ 75% (weights 20/40/40) and no part below 50% — <em>reported, unverified</em>. Readiness covers only the TOS lines you have practised (' +
      E.AREAS.map(function (a) { return r.parts[a].coverage + '/' + r.parts[a].lines; }).join(', ') + ').</p></div>';

    var days = s.days, streak = 0, d = S.today();
    if (!(days[d] && days[d].n)) d = S.addDays(d, -1);
    for (var k = 0; k < 400; k++) { if (days[d] && days[d].n) streak++; else if (!P.isRest(d)) break; d = S.addDays(d, -1); }
    var att = E.attempts(), okAll = att.filter(function (a) { return a.ok; }).length;
    var seen = Object.keys(s.items).filter(function (id) { return s.items[id].hist.length; }).length;
    h += '<div class="grid2"><div class="card"><h3>Streak</h3><p class="big-num">' + streak + '</p><p class="small muted">study days in a row (rest days do not break it)</p></div>' +
      '<div class="card"><h3>Answered</h3><p class="big-num">' + att.length + '</p><p class="small muted">' + pct(att.length ? okAll / att.length : null) + ' correct · ' + seen + ' of ' + D.Q.length + ' items seen</p></div></div>';
    h += '<div class="card"><h3>Minutes per day (last 14 days)</h3><div class="bars" role="img" aria-label="Minutes studied per day">';
    var labels = '', maxm = 1, arr = [];
    for (var j = 13; j >= 0; j--) { var dd = S.addDays(S.today(), -j), mm = Math.round(((days[dd] || {}).ms || 0) / 60000); arr.push([dd, mm]); maxm = Math.max(maxm, mm); }
    arr.forEach(function (x) { h += '<div style="height:' + (100 * x[1] / maxm) + '%" title="' + x[0] + ': ' + x[1] + ' min"></div>'; labels += '<span>' + x[0].slice(8) + '</span>'; });
    h += '</div><div class="bars-labels">' + labels + '</div><p class="small muted">Daily limit: ' + P.minutes() + ' min (hard cap 120).</p></div>';

    h += '<div class="card"><h3>Accuracy by TOS line</h3><div class="tbl-wrap" tabindex="0" role="region" aria-label="Accuracy by TOS line"><table class="data"><thead><tr><th>Line</th><th class="num">TOS items</th><th class="num">Answered</th><th>Accuracy (last 20)</th></tr></thead><tbody>';
    E.AREAS.forEach(function (a) {
      h += '<tr><th colspan="4">' + esc(E.PART_NAME[a]) + '</th></tr>';
      D.lines.filter(function (l) { return l.area === a; }).forEach(function (l) {
        var all = E.lineAccuracy(l.id), last = E.lineAccuracy(l.id, 20);
        h += '<tr><td>' + l.id + ' <span class="small muted">' + esc(P.shortTitle(l.title)) + '</span></td><td class="num">' + l.items + '</td><td class="num">' + all.n + '</td><td>' +
          (last.n ? '<div class="row" style="flex-wrap:nowrap"><div class="minibar" style="flex:1"><div style="width:' + last.acc * 100 + '%"></div></div><span class="small">' + pct(last.acc) + '</span></div>' : '<span class="muted small">—</span>') + '</td></tr>';
      });
    });
    h += '</tbody></table></div></div>';

    if (s.exams.length) {
      h += '<div class="card"><h3>Timed exams</h3><ul>';
      s.exams.slice(-12).reverse().forEach(function (x) {
        h += '<li>' + esc(x.date) + ' · ' + (x.kind === 'full-mock' ? 'Full mock ' + pct(x.avg) + (x.pass ? ' ✓' : '') : x.kind === 'plan-mock' ? 'Plan mock' : 'Part') + ': ' +
          Object.keys(x.parts).map(function (a) { return E.PART_SHORT[a] + ' ' + x.parts[a].ok + '/' + x.parts[a].n; }).join(', ') + '</li>';
      });
      h += '</ul></div>';
    }
    h += '<div class="card"><h3>Your data</h3><p class="small muted">Progress is stored only on this device, per profile. Back it up with Export; restore with Import.</p>' +
      '<div class="row"><button class="btn secondary" data-act="export">Export backup</button><label class="btn secondary" for="import-file" tabindex="0">Import backup</label>' +
      '<input type="file" id="import-file" accept="application/json,.json" hidden></div></div>';
    h += '<div class="card"><h3>About</h3><p class="small">A free study aid for the Philippine Licensure Examination for Teachers (Secondary level, TLE major, Home Economics specialization). It is <strong>not a PRC product</strong>. ' +
      D.Q.length + ' questions, ' + D.cards.length + ' flashcards, ' + D.lines.length + ' lessons and ' + Object.keys(D.minis).length + ' mini-lessons, each traced to cited sources. ' +
      '<button class="btn small ghost" data-act="learn-page" data-p="sources">Sources and licences</button></p><p class="small muted">App ' + VERSION + ' · content exported ' + esc(App.meta.exported) + '</p></div>';
    main.innerHTML = h;
    $('#import-file').onchange = importFile;
  }

  function exportData() {
    var blob = new Blob([S.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'let-study-backup-' + st().profile.replace(/[^\w-]+/g, '_') + '-' + S.today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function importFile(ev) {
    var f = ev.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        if (!confirm('Replace the progress of profile "' + st().profile + '" with this backup?')) return;
        S.importJSON(rd.result); applyLook(); toast('Backup imported.'); render();
      } catch (e) { alert('Could not import: ' + e.message); }
    };
    rd.readAsText(f);
  }

  // ---------------- settings and onboarding ----------------
  function settingsHtml(onboarding) {
    var s = st().settings;
    var days = P.DAY_NAMES.map(function (d, i) { return '<label><input type="checkbox" name="rest" value="' + i + '"' + (s.restDays.indexOf(i) >= 0 ? ' checked' : '') + '> ' + d + '</label>'; }).join('');
    return '<label class="field">Exam date<span class="desc">PRC has not announced the next LET date. Late March 2027 is a placeholder; change it when PRC posts the schedule.</span>' +
      '<input type="date" id="set-exam" value="' + s.examDate + '"></label>' +
      '<label class="field" style="font-weight:400"><input type="checkbox" id="set-official"' + (s.examDateIsPlaceholder ? '' : ' checked') + '> This is the official date (removes the "placeholder" tag)</label>' +
      '<label class="field">Start date<input type="date" id="set-start" value="' + s.startDate + '"></label>' +
      '<label class="field">Minutes per day<span class="desc">1–2 hours is the plan; 120 is the hard cap.</span><select id="set-min">' +
      [30, 45, 60, 75, 90, 105, 120].map(function (m) { return '<option' + (Number(s.dailyMinutes) === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></label>' +
      '<fieldset class="field" style="border:0;padding:0"><legend>Rest days</legend><div class="days">' + days + '</div></fieldset>' +
      (onboarding ? '' : '<label class="field">Text size<select id="set-size">' + [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']].map(function (x) { return '<option value="' + x[0] + '"' + (s.textSize === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Theme<select id="set-theme">' + [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(function (x) { return '<option value="' + x[0] + '"' + (s.theme === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>');
  }
  function readSettings() {
    var s = st().settings;
    var ex = $('#set-exam').value, sd = $('#set-start').value;
    if (ex) { if (ex !== s.examDate && !$('#set-official').checked) s.examDateIsPlaceholder = true; s.examDate = ex; }
    s.examDateIsPlaceholder = !$('#set-official').checked;
    if (sd) s.startDate = sd;
    s.dailyMinutes = Math.min(120, Number($('#set-min').value) || 60);
    s.restDays = $all('input[name="rest"]:checked').map(function (x) { return Number(x.value); });
    if (s.restDays.length > 4) { s.restDays = s.restDays.slice(0, 4); toast('At most 4 rest days a week.'); }
    if ($('#set-size')) s.textSize = $('#set-size').value;
    if ($('#set-theme')) s.theme = $('#set-theme').value;
    if (s.startDate > s.examDate) s.startDate = S.today();
    S.save(); applyLook();
  }
  function openSettings() {
    var profiles = S.profiles();
    openModal('<h2 id="modal-title">Settings</h2>' + settingsHtml(false) +
      '<div class="row"><button class="btn" data-act="save-settings">Save</button><button class="btn ghost" data-act="close">Cancel</button></div><hr>' +
      '<h3>Profile</h3><p class="small muted">Each profile keeps its own progress on this device.</p><label class="field">Switch profile<select id="set-profile">' +
      profiles.map(function (p) { return '<option' + (p === st().profile ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></label>' +
      '<div class="row"><button class="btn small secondary" data-act="profile-switch">Switch</button><button class="btn small secondary" data-act="profile-new">New profile</button>' +
      '<button class="btn small secondary" data-act="profile-rename">Rename</button>' + (profiles.length > 1 ? '<button class="btn small danger" data-act="profile-delete">Delete this profile</button>' : '') + '</div><hr>' +
      '<h3>Data</h3><div class="row"><button class="btn small secondary" data-act="export">Export backup</button><button class="btn small danger" data-act="reset">Reset progress</button></div>' +
      '<p class="small muted">Offline: after the first visit, the app works without internet. To install, use your browser\'s "Add to Home Screen" or "Install app". After an update, reload the page; on iPhone, if it does not update, remove and re-add the home-screen icon.</p>');
  }

  var OB = 0;
  function onboarding(step) {
    OB = step || 0;
    var steps = [
      '<h2 id="modal-title">Welcome</h2><p>This app helps you prepare for the <strong>LET (Secondary), TLE major, Home Economics</strong>: General Education, Professional Education and the Specialization.</p>' +
        '<p>It is a free study aid, <strong>not a PRC product</strong>. Everything stays on this device.</p><label class="field">Your name (for your profile)<input type="text" id="ob-name" value="' + esc(st().profile) + '" maxlength="30"></label>',
      '<h2 id="modal-title">Exam date</h2>' + '<p class="small">The plan counts down to this date.</p>',
      '<h2 id="modal-title">Daily time and rest days</h2><p class="small">Plan for 1–2 hours a day with rest days. The app never plans more than 2 hours.</p>',
      '<h2 id="modal-title">How a session works</h2><ol><li><strong>Questions first.</strong> Each session starts with retrieval, not rereading.</li><li>Pick an answer, then rate how sure you are: <em>sure, unsure or guess</em>.</li>' +
        '<li>You see why the right answer is right and why your choice is wrong.</li><li>After a miss, a short <strong>mini-lesson</strong> appears, and the item returns after 1, 3, 7 and 14 days.</li><li>Correct but unsure counts like a miss for scheduling.</li></ol>',
      '<h2 id="modal-title">Why questions feel harder</h2><p>Testing yourself feels harder and slower than rereading, and you will miss items. That is expected: effortful retrieval and spacing produce better long-term memory than rereading, even though rereading feels more fluent.</p>' +
        '<p>Use the <strong>Today</strong> tab each day and tick off the plan. Press <strong>?</strong> at the top to see this again.</p>'
    ];
    var body = steps[OB];
    if (OB === 1 || OB === 2) {
      var full = settingsHtml(true), tmp = document.createElement('div'); tmp.innerHTML = full;
      var parts = $all('label.field, fieldset', tmp);
      var keep = OB === 1 ? parts.slice(0, 3) : parts.slice(3);
      body += keep.map(function (x) { return x.outerHTML; }).join('');
      // keep hidden copies so readSettings() finds every field
      body += '<div hidden>' + (OB === 1 ? parts.slice(3) : parts.slice(0, 3)).map(function (x) { return x.outerHTML; }).join('') + '</div>';
    }
    body += '<p class="small muted">Step ' + (OB + 1) + ' of 5</p><div class="row">' + (OB ? '<button class="btn ghost" data-act="ob-back">Back</button>' : '') +
      '<button class="btn" data-act="ob-next" autofocus>' + (OB === 4 ? 'Start studying' : 'Next') + '</button></div>';
    openModal(body);
  }
  function obNext() {
    if (OB === 0) { var n = $('#ob-name').value.trim(); if (n && n !== st().profile) S.rename(n); applyLook(); }
    if (OB === 1 || OB === 2) readSettings();
    if (OB === 4) { st().onboarded = true; S.save(); closeModal(); render(); return; }
    onboarding(OB + 1);
  }

  // ---------------- events ----------------
  function onClick(ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act, s = App.session;
    switch (act) {
      case 'close': closeModal(); break;
      case 'settings': openSettings(); break;
      case 'save-settings': readSettings(); closeModal(); render(); toast('Settings saved. Plan updated.'); break;
      case 'catchup': st().settings.catchUp = el.dataset.v; S.save(); render(); break;
      case 'tick': { var k = el.dataset.key, t = S.today(), d = st().days[t] = st().days[t] || { ms: 0, n: 0, ok: 0, done: {} }; d.done = d.done || {}; d.done[k] = !d.done[k]; S.save(); render(); break; }
      case 'task': runTask(App._plan.tasks[Number(el.dataset.i)]); break;
      case 'checklist': showChecklist(); break;
      case 'cards': startCards(10); break;
      case 'mode': pickMode(el.dataset.mode); break;
      case 'start-drill': { var line = $('#drill-line').value, mini = $('#drill-mini').value, n = Number($('#drill-n').value);
        startPractice('Topic drill: ' + (mini ? D.minis[mini].title : line), E.topicDrill(line, mini || null, n)); break; }
      case 'start-exam': startExam([{ area: $('#ex-area').value, size: Number($('#ex-size').value) }]); break;
      case 'start-mock': startExam(E.AREAS.map(function (a) { return { area: a, size: 150 }; }), { full: true }); break;
      case 'resume-exam': resumeExam(); break;
      case 'discard-exam': if (confirm('Discard the unfinished exam? Its answers are not scored.')) { st().examInProgress = null; S.save(); render(); } break;
      case 'pick': pick(Number(el.dataset.i)); break;
      case 'conf': confirmConf(el.dataset.c); break;
      case 'next': nextItem(); break;
      case 'quit':
        if (s && s.kind === 'practice') { if (s.revealed) addMs(Date.now() - s.t0); if (s.results.length) finishPractice(); else { App.session = null; render(); } }
        else if (s && s.kind === 'cards') { if (s.res.length) { s.done = true; render(); } else { App.session = null; render(); } }
        break;
      case 'bookmark': { var id = el.dataset.id, b = st().bookmarks, i = b.indexOf(id); if (i >= 0) b.splice(i, 1); else b.push(id); S.save(); render(); break; }
      case 'open-line':
        if (App.session && !App.session.done) { lessonModal(el.dataset.line); break; }
        closeModal(); App.session = null; setTab('learn', { line: el.dataset.line }); break;
      case 'open-mini': { var m = D.minis[el.dataset.id]; openModal(miniHtml(el.dataset.id) + '<div class="row" style="margin-top:12px"><button class="btn" data-act="open-line" data-line="' + m.line + '">Full lesson ' + m.line + '</button><button class="btn ghost" data-act="close">Close</button></div>'); break; }
      case 'learn-home': App.sub = null; render(); window.scrollTo(0, 0); break;
      case 'learn-page': closeModal(); App.session = null; setTab('learn', { page: el.dataset.p }); break;
      case 'cheat': App.sub = { line: el.dataset.line, cheat: true }; render(); window.scrollTo(0, 0); break;
      case 'print': window.print(); break;
      case 'line-check': { var ln = el.dataset.line, sub = App.sub || {};
        var items = E.topicDrill(ln, null, 5);
        startPractice('5-item check: ' + ln, items, { taskKey: sub.line === ln ? sub.taskKey : null, newline: ln }); break; }
      case 'line-drill': startPractice('Topic drill: ' + el.dataset.line, E.topicDrill(el.dataset.line, null, 10), { newline: el.dataset.line }); break;
      case 'mini-drill': startPractice('Drill: ' + D.minis[el.dataset.id].title, E.topicDrill(null, el.dataset.id, 10)); break;
      case 'show-q': showQuestion(el.dataset.id); break;
      case 'back-today': endTimers(); App.session = null; setTab('today'); break;
      case 'back-tab': endTimers(); App.session = null; render(); break;
      case 'rev-due': startPractice('Due review', E.dueItems().slice(0, 30)); break;
      case 'rev-cards': startCards(20); break;
      case 'rev-bm': startPractice('Bookmarks', E.shuffle(E.bookmarked().slice())); break;
      case 'ex-pick': { var p = s.parts[s.pi], q = D.qById[p.ids[s.i]]; p.answers[q.id] = Number(el.dataset.i); saveExam(); render(); break; }
      case 'ex-prev': exMove(s.i - 1); break;
      case 'ex-next': if (s.i + 1 < s.parts[s.pi].ids.length) exMove(s.i + 1); else { s.showNav = true; render(); var nd = $('#ex-navd'); if (nd) { nd.open = true; nd.scrollIntoView(); } } break;
      case 'ex-go': exMove(Number(el.dataset.k)); break;
      case 'ex-flag': { var pp = s.parts[s.pi], qid = pp.ids[s.i]; pp.flags[qid] = !pp.flags[qid]; saveExam(); render(); break; }
      case 'ex-submit': submitPart(true); break;
      case 'ex-pause': saveExam(); endTimers(); App.session = null; toast('Exam saved. Resume it from Practice.'); setTab('practice'); break;
      case 'ex-resume-part': s.onBreak = false; saveExam(); beginPartTimer(); render(); break;
      case 'ex-filter': s.reviewFilter = el.dataset.f; render(); break;
      case 'card-show': s.shown = true; render(); break;
      case 'card-ans': cardAnswer(el.dataset.ok === '1'); break;
      case 'rf-pick': { var x = s.list[s.i].q, ii = Number(el.dataset.i); s.ans = ii; E.record(x, ii === x.k, 'unsure', 0, { noBoost: true }); s.res.push({ q: x, ok: ii === x.k }); render(); break; }
      case 'rf-next': s.ans = undefined; s.i++; render(); break;
      case 'rf-show': s.shown = true; render(); break;
      case 'rf-card': { E.recordCard(s.list[s.i].c, el.dataset.ok === '1'); s.res.push({ ok: el.dataset.ok === '1' }); s.shown = false; s.i++; render(); break; }
      case 'export': exportData(); break;
      case 'reset': if (confirm('Erase all progress for "' + st().profile + '"? Settings are kept. This cannot be undone (export a backup first).')) { S.reset(); closeModal(); render(); toast('Progress reset.'); } break;
      case 'profile-switch': S.switchTo($('#set-profile').value); afterProfileChange(); break;
      case 'profile-new': { var nn = prompt('Name for the new profile:'); if (nn && S.create(nn)) { S.switchTo(nn.trim().slice(0, 30)); afterProfileChange(); } else if (nn) alert('That name is empty or already used.'); break; }
      case 'profile-rename': { var rn = prompt('New name for this profile:', st().profile); if (rn && !S.rename(rn)) alert('That name is empty or already used.'); applyLook(); openSettings(); break; }
      case 'profile-delete': if (confirm('Delete profile "' + st().profile + '" and all its progress?')) { S.remove(); afterProfileChange(); } break;
      case 'ob-next': obNext(); break;
      case 'ob-back': if (OB === 1 || OB === 2) readSettings(); onboarding(OB - 1); break;
    }
  }
  function afterProfileChange() { closeModal(); applyLook(); App.session = null; setTab('today'); if (!st().onboarded) onboarding(0); }

  function onKey(ev) {
    if (ev.target.matches('input, select, textarea') || $('#modal').open) return;
    var s = App.session;
    if (!s || s.done) return;
    var k = ev.key.toLowerCase();
    if (s.kind === 'practice') {
      if (!s.revealed) {
        var idx = '1234'.indexOf(k); if (idx < 0) idx = 'abcd'.indexOf(k);
        if (idx >= 0) { pick(idx); ev.preventDefault(); return; }
        if (s.pick !== null && ({ s: 'sure', u: 'unsure', g: 'guess' })[k]) { confirmConf({ s: 'sure', u: 'unsure', g: 'guess' }[k]); ev.preventDefault(); }
      } else if (k === 'enter' && ev.target.tagName !== 'BUTTON') { nextItem(); ev.preventDefault(); }
    } else if (s.kind === 'cards') {
      if (k === ' ' && !s.shown) { s.shown = true; render(); ev.preventDefault(); }
    } else if (s.kind === 'exam' && !s.onBreak) {
      var j = '1234'.indexOf(k); if (j < 0) j = 'abcd'.indexOf(k);
      if (j >= 0) { var p = s.parts[s.pi]; p.answers[p.ids[s.i]] = j; saveExam(); render(); }
      else if (k === 'arrowright') exMove(s.i + 1); else if (k === 'arrowleft') exMove(s.i - 1);
      else if (k === 'f') { var pp = s.parts[s.pi]; pp.flags[pp.ids[s.i]] = !pp.flags[pp.ids[s.i]]; saveExam(); render(); }
    }
  }

  // ---------------- startup ----------------
  function loadJSON(p) { return fetch(p).then(function (r) { if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); }); }
  function init() {
    main = $('#main');
    S.load(); applyLook();
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal' && st().onboarded) closeModal(); });
    $('#modal').addEventListener('cancel', function (e) { if (!st().onboarded) e.preventDefault(); });
    $all('.tabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });
    $('#btn-settings').onclick = openSettings;
    $('#btn-help').onclick = function () { onboarding(0); };
    Promise.all(['questions', 'flashcards', 'lessons', 'minis', 'sources', 'meta'].map(function (n) { return loadJSON('data/' + n + '.json'); }))
      .then(function (r) {
        E.index({ questions: r[0], flashcards: r[1], lessons: r[2], minis: r[3], sources: r[4] });
        App.meta = r[5];
        var tab = (location.hash || '').replace('#', '');
        setTab(['today', 'learn', 'practice', 'review', 'progress'].indexOf(tab) >= 0 ? tab : 'today');
        if (!st().onboarded) onboarding(0);
        else if (st().examInProgress) toast('You have an unfinished timed exam — resume it from Practice.');
      })
      .catch(function (e) { main.innerHTML = '<div class="card"><h2>Could not load the study data</h2><p>' + esc(e.message) + '</p><p>Check your connection and reload. After one successful visit the app works offline.</p></div>'; });
    registerSW();
  }
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function ask(w) { $('#update-banner').hidden = false; $('#btn-update').onclick = function () { w.postMessage('skipWaiting'); }; }
      if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
      });
    }).catch(function (e) { console.warn('SW failed', e); });
    var reloaded = false, hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; } // first install: nothing to refresh
      if (!reloaded) { reloaded = true; location.reload(); }
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();

/* Learning engine: data indexes, spaced scheduling, item selection, weak spots, readiness.
   Rules follow docs/app-spec.md §5–§6 of the study library. */
(function () {
  'use strict';
  var S = window.Store;
  var LADDER = [1, 3, 7, 14];              // miss / unsure / guess ladder (days)
  var RETIRE_AFTER = 3;                    // consecutive sure-correct answers
  var PACE = { GenEd: 48, ProfEd: 72, TLE: 84 };   // seconds per item at the exam
  var WEIGHT = { GenEd: 0.2, ProfEd: 0.4, TLE: 0.4 };
  var PART_NAME = { GenEd: 'General Education', ProfEd: 'Professional Education', TLE: 'Specialization (Home Economics)' };
  var PART_SHORT = { GenEd: 'GenEd', ProfEd: 'ProfEd', TLE: 'Specialization' };
  var AREAS = ['GenEd', 'ProfEd', 'TLE'];

  // Sets of easily confused subtopics (mini-lesson ids without the "ml-" prefix). Interleaving
  // within these sets is where the evidence for interleaving is strongest (learning-science R4).
  var CONFUSABLE = [
    ['PE-C1-piaget', 'PE-C1-vygotsky', 'PE-C1-erikson', 'PE-C1-kohlberg', 'PE-C1-freud', 'PE-C1-bronfenbrenner'],
    ['PE-C1-classical', 'PE-C1-operant', 'PE-C1-bandura'],
    ['PE-C1-maslow-motivation', 'PE-C1-self-determination-goals', 'PE-C1-attribution-self-efficacy'],
    ['HE-A1-series-parallel', 'HE-A1-ohms-law-power', 'HE-A1-resistor-code'],
    ['HE-B4-void-voidable', 'HE-B4-marriage-requisites', 'HE-B4-parental-authority'],
    ['HE-B7-food-handler-rules', 'HE-B3-food-service-hygiene', 'HE-B3-food-business-responsibility'],
    ['HE-C1-formative-summative', 'PE-D1-norm-criterion', 'HE-C1-performance-authentic', 'HE-C1-rubrics'],
    ['PE-D1-validity', 'PE-D1-reliability-bias'],
    ['PE-D1-central-tendency', 'PE-D1-variability', 'PE-D1-standard-scores', 'PE-D1-normal-curve'],
    ['GE-09-utilitarianism', 'GE-09-kant', 'GE-09-virtue-ethics', 'GE-09-ross-pluralism', 'GE-09-care-ethics'],
    ['HE-B2-vitamin-deficiencies', 'HE-B2-mineral-deficiencies', 'HE-B2-vitamin-classes', 'HE-B2-protein-energy-malnutrition'],
    ['HE-B2-cooking-methods', 'HE-B2-knife-cuts-prep'],
    ['PE-E1-kolb-cycle', 'PE-E1-schon-reflection', 'PE-E1-gibbs-brookfield'],
    ['PE-A1-functionalism', 'PE-A1-conflict-interactionist'],
    ['PE-B1-tyler-rationale', 'PE-B1-backward-design', 'PE-B1-spiral', 'PE-B1-hidden-curriculum'],
    ['HE-D1-sampling-methods', 'HE-D1-population-sample-data', 'HE-D1-experiment-variables'],
    ['HE-A2-fibers', 'HE-A2-weaves', 'HE-A2-fabric-construction', 'HE-A2-philippine-fabrics'],
    ['GE-10-looking-glass-mead', 'GE-10-rogers-maslow', 'GE-10-neo-freudians', 'GE-10-big-five'],
    ['HE-A3-data-privacy-act', 'HE-A3-cybercrime-copyright', 'HE-A7-fair-use-privacy'],
    ['GE-04-noli', 'GE-04-fili'],
    ['GE-05-world-systems', 'GE-05-modernization-dependency', 'GE-05-globalization']
  ].map(function (set) { return set.map(function (s) { return 'ml-' + s; }); });

  var D = { Q: [], qById: {}, byLine: {}, byMini: {}, byArea: {}, lines: [], lineById: {}, minis: {}, cards: [], cardsByLine: {} };

  function shuffle(a, rnd) {
    rnd = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function push(map, k, v) { (map[k] = map[k] || []).push(v); }

  function index(data) {
    D.Q = data.questions;
    D.Q.forEach(function (q) { D.qById[q.id] = q; push(D.byLine, q.l, q); push(D.byMini, q.m, q); push(D.byArea, q.a, q); });
    D.lines = data.lessons.map(function (l) { return { id: l.id, area: l.area, title: l.title, items: l.items, minis: l.minis, md: l.md, src: l.src }; });
    // Learning order: by TOS weight (items) within the whole exam, then id
    D.lines.forEach(function (l) { D.lineById[l.id] = l; });
    data.minis.forEach(function (m) { D.minis[m.id] = m; });
    D.cards = data.flashcards;
    D.cards.forEach(function (c) { push(D.cardsByLine, c.l, c); });
    window.SOURCES = {};
    data.sources.forEach(function (s) { window.SOURCES[s.id] = s; });
  }

  function learnOrder() {
    // Highest exam weight first: weight of the part × the line's share of that part.
    return D.lines.slice().sort(function (a, b) {
      var wa = WEIGHT[a.area] * a.items / 150, wb = WEIGHT[b.area] * b.items / 150;
      return wb - wa || a.id.localeCompare(b.id);
    });
  }

  // ---------- scheduling ----------
  function st() { return S.state; }
  function itemState(id) { return st().items[id]; }

  /** Record an answer and reschedule. conf: 'sure' | 'unsure' | 'guess'. Returns {boost: miniId|null}. */
  function record(q, ok, conf, ms, opts) {
    opts = opts || {};
    var s = st(), now = new Date().toISOString(), t = S.today();
    var it = s.items[q.id] || { step: -1, iv: 0, due: null, hist: [], streak: 0, retired: false };
    it.hist.push([now, ok ? 1 : 0, conf, Math.round(ms || 0)]);
    if (it.hist.length > 12) it.hist = it.hist.slice(-12);
    schedule(it, ok, conf);
    it.last = t;
    s.items[q.id] = it;
    // daily log
    var day = s.days[t] = s.days[t] || { ms: 0, n: 0, ok: 0, done: {} };
    day.n += 1; day.ok += ok ? 1 : 0;
    var boost = null;
    if (!ok && !opts.noBoost) boost = noteMiss(q);
    S.save();
    return { boost: boost };
  }

  function schedule(it, ok, conf) {
    var t = S.today();
    var isNew = it.step < 0 && it.hist.length <= 1;
    if (!ok) {
      it.step = 0; it.iv = LADDER[0]; it.streak = 0; it.retired = false;
    } else if (conf !== 'sure') {
      it.step = isNew ? 0 : Math.min((it.step < 0 ? 0 : it.step) + 1, LADDER.length - 1);
      it.iv = LADDER[it.step]; it.streak = 0; it.retired = false;
    } else {
      it.streak = (it.streak || 0) + 1;
      it.iv = isNew ? 3 : Math.max(3, (it.iv || 1) * 2);
      if (it.step < 0) it.step = 1;
      if (it.streak >= RETIRE_AFTER) it.retired = true;
    }
    it.due = it.retired ? null : S.addDays(t, it.iv);
  }

  function noteMiss(q) {
    var s = st(), t = S.today(), m = q.m;
    var list = (s.subMiss[m] || []).filter(function (d) { return S.daysBetween(d, t) < 7; });
    list.push(t);
    s.subMiss[m] = list;
    var last = s.boosted[m];
    if (list.length >= 2 && (!last || S.daysBetween(last, t) >= 7)) {
      s.boosted[m] = t;
      // add 3 not-yet-seen items on this subtopic (fall back to the same line), over the next 3 days
      var pool = (D.byMini[m] || []).filter(function (x) { return !s.items[x.id] && x.id !== q.id; });
      if (pool.length < 3) pool = pool.concat((D.byLine[q.l] || []).filter(function (x) { return !s.items[x.id] && x.m !== m; }));
      shuffle(pool).slice(0, 3).forEach(function (x, i) {
        s.items[x.id] = { step: 0, iv: 0, due: S.addDays(t, i + 1), hist: [], streak: 0, retired: false, boost: true };
      });
      return m;
    }
    return null;
  }

  function examDate() { return st().settings.examDate; }

  function isDue(it, t) {
    if (!it) return false;
    if (it.retired) {
      // retired items resurface once 30 days before the exam and once in the final week
      var ex = examDate(), last = it.last || '0000-00-00';
      var d30 = S.addDays(ex, -30), d7 = S.addDays(ex, -7);
      return (t >= d7 && last < d7) || (t >= d30 && last < d30);
    }
    return !!it.due && it.due <= t;
  }

  function dueItems(t) {
    t = t || S.today();
    var s = st(), out = [];
    Object.keys(s.items).forEach(function (id) {
      var q = D.qById[id];
      if (q && isDue(s.items[id], t)) out.push(q);
    });
    out.sort(function (a, b) {
      var A = s.items[a.id], B = s.items[b.id];
      return String(A.due || '').localeCompare(String(B.due || '')) || (A.step - B.step);
    });
    return out;
  }
  function overdueCount(t) {
    t = t || S.today();
    var s = st(), n = 0;
    Object.keys(s.items).forEach(function (id) { var it = s.items[id]; if (!it.retired && it.due && it.due < t && D.qById[id]) n++; });
    return n;
  }

  function unseen(pool) { var s = st(); return pool.filter(function (q) { return !s.items[q.id]; }); }

  function startedLines() { return Object.keys(st().linesStarted); }

  /** Pool of new items for mixed practice: lines already started, or every line if none started. */
  function newPool(restrictLines) {
    var lines = restrictLines && restrictLines.length ? restrictLines : startedLines();
    var pool = [];
    if (!lines.length) pool = D.Q; else lines.forEach(function (l) { pool = pool.concat(D.byLine[l] || []); });
    return unseen(pool);
  }

  /** Avoid two items from the same TOS line in a row where possible. */
  function interleave(items) {
    var out = [], rest = items.slice();
    while (rest.length) {
      var prev = out.length ? out[out.length - 1].l : null;
      var i = rest.findIndex(function (q) { return q.l !== prev; });
      if (i < 0) i = 0;
      out.push(rest.splice(i, 1)[0]);
    }
    return out;
  }

  function quickQuiz(n) {
    n = n || 10;
    var due = dueItems().slice(0, Math.ceil(n / 2));
    var fresh = shuffle(newPool()).slice(0, n - due.length);
    var got = due.concat(fresh);
    if (got.length < n) got = got.concat(shuffle(D.Q.filter(function (q) { return got.indexOf(q) < 0; })).slice(0, n - got.length));
    return interleave(shuffle(got));
  }

  function topicDrill(line, mini, n) {
    n = n || 10;
    var pool = mini ? (D.byMini[mini] || []) : (D.byLine[line] || []);
    var s = st(), t = S.today();
    var due = pool.filter(function (q) { return isDue(s.items[q.id], t); });
    var fresh = shuffle(unseen(pool));
    var old = shuffle(pool.filter(function (q) { return s.items[q.id] && !isDue(s.items[q.id], t); }));
    return due.concat(fresh, old).slice(0, n);
  }

  function interleavedMix(n, area) {
    n = n || 20;
    var s = st();
    var sets = shuffle(CONFUSABLE.filter(function (set) {
      return set.some(function (m) { var q = (D.byMini[m] || [])[0]; return q && (!area || q.a === area); });
    })).slice(0, 2);
    var picked = [];
    sets.forEach(function (set) {
      // alternate subtopics within the set
      var pools = set.map(function (m) { return shuffle((D.byMini[m] || []).slice()).sort(function (a, b) { return (s.items[a.id] ? 1 : 0) - (s.items[b.id] ? 1 : 0); }); });
      for (var k = 0; k < 3; k++) pools.forEach(function (p) { if (p[k] && picked.length < Math.ceil(n * 0.6)) picked.push(p[k]); });
    });
    var rest = shuffle((area ? D.byArea[area] : D.Q).filter(function (q) { return picked.indexOf(q) < 0; }));
    rest.sort(function (a, b) { return (s.items[a.id] ? 1 : 0) - (s.items[b.id] ? 1 : 0); });
    picked = picked.concat(rest.slice(0, n - picked.length));
    return interleave(shuffle(picked));
  }

  function smartReview(n) {
    n = n || 15;
    var s = st(), scored = [];
    Object.keys(s.items).forEach(function (id) {
      var q = D.qById[id], it = s.items[id];
      if (!q || !it.hist.length) return;
      var miss = 0, guess = 0, unsure = 0, slow = 0;
      it.hist.forEach(function (h) {
        if (!h[1]) miss++;
        if (h[2] === 'guess') guess++;
        if (h[2] === 'unsure') unsure++;
        if (h[3] > PACE[q.a] * 1500) slow++;
      });
      var score = miss * 3 + guess * 2 + unsure + slow + (miss >= 2 ? 3 : 0) + (it.hist[it.hist.length - 1][1] ? 0 : 2);
      if (score > 0) scored.push([score + Math.random(), q]);
    });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    return interleave(scored.slice(0, n).map(function (x) { return x[1]; }));
  }

  function bookmarked() { return st().bookmarks.map(function (id) { return D.qById[id]; }).filter(Boolean); }

  /** Draw an exam for one part following TOS item counts per line. size = 150 for a full part. */
  function buildExam(area, size) {
    var lines = D.lines.filter(function (l) { return l.area === area; });
    var total = lines.reduce(function (a, l) { return a + l.items; }, 0) || 1;
    var picked = [], s = st();
    // largest-remainder allocation of `size` across lines by TOS items
    var alloc = lines.map(function (l) { var x = size * l.items / total; return { l: l, n: Math.floor(x), r: x - Math.floor(x) }; });
    var left = size - alloc.reduce(function (a, x) { return a + x.n; }, 0);
    alloc.slice().sort(function (a, b) { return b.r - a.r; }).slice(0, left).forEach(function (x) { x.n++; });
    alloc.forEach(function (x) {
      var pool = shuffle((D.byLine[x.l.id] || []).slice());
      // prefer items not answered recently
      pool.sort(function (a, b) { return String((s.items[a.id] || {}).last || '').localeCompare(String((s.items[b.id] || {}).last || '')); });
      picked = picked.concat(pool.slice(0, x.n));
    });
    if (picked.length < size) {
      var extra = shuffle((D.byArea[area] || []).filter(function (q) { return picked.indexOf(q) < 0; }));
      picked = picked.concat(extra.slice(0, size - picked.length));
    }
    return shuffle(picked);
  }

  // ---------- flashcards ----------
  function cardDue(t) {
    t = t || S.today();
    var s = st(), due = [], fresh = [];
    var lines = startedLines();
    D.cards.forEach(function (c) {
      var cs = s.cards[c.id];
      if (cs) { if (!cs.retired && cs.due && cs.due <= t) due.push(c); }
      else if (!lines.length || lines.indexOf(c.l) >= 0) fresh.push(c);
    });
    var newToday = Object.keys(s.cards).filter(function (id) { return s.cards[id].first === t; }).length;
    return { due: due, fresh: shuffle(fresh).slice(0, Math.max(0, 10 - newToday)) };
  }
  function recordCard(c, ok) {
    var s = st(), t = S.today();
    var cs = s.cards[c.id] || { step: -1, iv: 0, due: null, hist: [], streak: 0, first: t };
    cs.hist = (cs.hist || []).concat([[new Date().toISOString(), ok ? 1 : 0, ok ? 'sure' : 'guess', 0]]).slice(-8);
    schedule(cs, ok, ok ? 'sure' : 'guess');
    cs.last = t;
    s.cards[c.id] = cs;
    S.save();
  }

  // ---------- statistics ----------
  function attempts(filter) {
    var s = st(), out = [];
    Object.keys(s.items).forEach(function (id) {
      var q = D.qById[id];
      if (!q || (filter && !filter(q))) return;
      s.items[id].hist.forEach(function (h) { out.push({ q: q, t: h[0], ok: h[1], conf: h[2], ms: h[3] }); });
    });
    out.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    return out;
  }

  function lineAccuracy(lineId, lastN) {
    var a = attempts(function (q) { return q.l === lineId; });
    if (lastN) a = a.slice(-lastN);
    var ok = a.filter(function (x) { return x.ok; }).length;
    return { n: a.length, ok: ok, acc: a.length ? ok / a.length : null };
  }

  function weakSpots() {
    var out = [];
    D.lines.forEach(function (l) {
      var r = lineAccuracy(l.id, 20);
      if (r.n >= 5 && r.acc < 0.7) out.push({ line: l, acc: r.acc, n: r.n, score: l.items * (0.7 - r.acc) * WEIGHT[l.area] });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  /** Readiness per part: last 150 attempts of that part, accuracy per line weighted by TOS share. */
  function readiness() {
    var parts = {};
    AREAS.forEach(function (area) {
      var a = attempts(function (q) { return q.a === area; }).slice(-150);
      var byLine = {};
      a.forEach(function (x) { var r = byLine[x.q.l] = byLine[x.q.l] || { n: 0, ok: 0 }; r.n++; r.ok += x.ok; });
      var wsum = 0, est = 0;
      Object.keys(byLine).forEach(function (l) { var w = D.lineById[l] ? D.lineById[l].items : 1; wsum += w; est += w * byLine[l].ok / byLine[l].n; });
      var p = wsum ? est / wsum : null, n = a.length;
      var se = p === null ? null : Math.sqrt(Math.max(p * (1 - p), 0.0025) / Math.max(n, 1));
      parts[area] = { n: n, p: p, lo: p === null ? null : Math.max(0, p - 1.96 * se), hi: p === null ? null : Math.min(1, p + 1.96 * se),
                      coverage: Object.keys(byLine).length, lines: D.lines.filter(function (l) { return l.area === area; }).length };
    });
    var enough = AREAS.every(function (k) { return parts[k].n >= 20; });
    var overall = enough ? AREAS.reduce(function (acc, k) { return acc + WEIGHT[k] * parts[k].p; }, 0) : null;
    var status = 'grey';
    if (enough) {
      var minPart = Math.min.apply(null, AREAS.map(function (k) { return parts[k].p; }));
      // green: overall ≥ 80% and every part ≥ 60%; red: overall < 75% or any part < 50%; amber between
      if (overall < 0.75 || minPart < 0.5) status = 'red';
      else if (overall >= 0.8 && minPart >= 0.6) status = 'green';
      else status = 'amber';
    }
    return { parts: parts, overall: overall, status: status, enough: enough };
  }

  window.Engine = {
    D: D, LADDER: LADDER, PACE: PACE, WEIGHT: WEIGHT, PART_NAME: PART_NAME, PART_SHORT: PART_SHORT, AREAS: AREAS, CONFUSABLE: CONFUSABLE,
    index: index, learnOrder: learnOrder, record: record, schedule: schedule, dueItems: dueItems, overdueCount: overdueCount,
    isDue: isDue, newPool: newPool, quickQuiz: quickQuiz, topicDrill: topicDrill, interleavedMix: interleavedMix,
    smartReview: smartReview, bookmarked: bookmarked, buildExam: buildExam, cardDue: cardDue, recordCard: recordCard,
    attempts: attempts, lineAccuracy: lineAccuracy, weakSpots: weakSpots, readiness: readiness, shuffle: shuffle,
    interleave: interleave, unseen: unseen, itemState: itemState
  };
})();

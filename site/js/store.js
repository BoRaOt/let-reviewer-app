/* Per-profile storage in localStorage. Nothing leaves the device.
   Keys: let.profiles = ["name", ...], let.current = "name", let.p.<name> = profile state JSON. */
(function () {
  'use strict';
  var SCHEMA = 1;
  var PLACEHOLDER_EXAM = '2027-03-28'; // late March 2027 placeholder (PRC has not announced the date)

  function today() { return iso(new Date()); }
  function iso(d) {
    var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  function addDays(isoDate, n) {
    var d = new Date(isoDate + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return iso(d);
  }
  function daysBetween(a, b) { // b - a in days
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  }

  function blank(name) {
    return {
      v: SCHEMA, profile: name, created: today(), onboarded: false,
      settings: { examDate: PLACEHOLDER_EXAM, examDateIsPlaceholder: true, startDate: today(), dailyMinutes: 60,
                  restDays: [0], textSize: 'm', theme: 'system', catchUp: 'order' },
      items: {},          // qid -> {step, iv, due, hist:[[isoTime, ok(0/1), conf, ms]], streak, retired, last}
      cards: {},          // card id -> {step, iv, due, streak, last}
      subMiss: {},        // mini id -> [iso dates of misses]
      boosted: {},        // mini id -> iso date of last bigger-lesson boost
      linesStarted: {},   // tos line -> iso date the learner did its first lesson + check
      days: {},           // iso date -> {ms, n, ok, done:{taskKey:true}}
      bookmarks: [],
      exams: [],          // {date, kind, parts:{GenEd:{n,ok}}, pct, perLine}
      examInProgress: null,
      planCache: null     // {key, plan}: today's frozen plan
    };
  }

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) { console.warn('storage failed', e); return false; }
  }

  var Store = {
    SCHEMA: SCHEMA, PLACEHOLDER_EXAM: PLACEHOLDER_EXAM,
    today: today, iso: iso, addDays: addDays, daysBetween: daysBetween,
    state: null,
    profiles: function () { try { return JSON.parse(safeGet('let.profiles') || '[]'); } catch (e) { return []; } },
    load: function () {
      var list = this.profiles();
      var cur = safeGet('let.current');
      if (!cur || list.indexOf(cur) < 0) cur = list[0];
      if (!cur) { cur = 'Me'; list = [cur]; safeSet('let.profiles', JSON.stringify(list)); }
      safeSet('let.current', cur);
      var raw = safeGet('let.p.' + cur), st = null;
      try { st = raw ? JSON.parse(raw) : null; } catch (e) { st = null; }
      this.state = this.upgrade(st || blank(cur));
      this.state.profile = cur;
      return this.state;
    },
    upgrade: function (st) {
      var b = blank(st.profile || 'Me');
      Object.keys(b).forEach(function (k) { if (st[k] === undefined) st[k] = b[k]; });
      Object.keys(b.settings).forEach(function (k) { if (st.settings[k] === undefined) st.settings[k] = b.settings[k]; });
      st.v = SCHEMA;
      return st;
    },
    save: function () {
      var ok = safeSet('let.p.' + this.state.profile, JSON.stringify(this.state));
      if (!ok && window.App) window.App.toast('Could not save progress (storage full or blocked). Export a backup.');
    },
    switchTo: function (name) { safeSet('let.current', name); return this.load(); },
    create: function (name) {
      name = String(name || '').trim().slice(0, 30);
      if (!name) return false;
      var list = this.profiles();
      if (list.indexOf(name) >= 0) return false;
      list.push(name);
      safeSet('let.profiles', JSON.stringify(list));
      safeSet('let.p.' + name, JSON.stringify(blank(name)));
      return true;
    },
    rename: function (name) {
      name = String(name || '').trim().slice(0, 30);
      var old = this.state.profile, list = this.profiles();
      if (!name || list.indexOf(name) >= 0) return false;
      list[list.indexOf(old)] = name;
      this.state.profile = name;
      safeSet('let.profiles', JSON.stringify(list));
      safeSet('let.p.' + name, JSON.stringify(this.state));
      try { localStorage.removeItem('let.p.' + old); } catch (e) { /* ignore */ }
      safeSet('let.current', name);
      return true;
    },
    remove: function () {
      var old = this.state.profile, list = this.profiles().filter(function (n) { return n !== old; });
      try { localStorage.removeItem('let.p.' + old); } catch (e) { /* ignore */ }
      safeSet('let.profiles', JSON.stringify(list));
      safeSet('let.current', list[0] || '');
      return this.load();
    },
    reset: function () {
      var s = this.state.settings, name = this.state.profile;
      this.state = blank(name);
      this.state.settings = s; this.state.onboarded = true;
      this.save();
    },
    exportJSON: function () {
      return JSON.stringify({ app: 'let-study-app', schema: SCHEMA, exported: new Date().toISOString(), state: this.state }, null, 1);
    },
    importJSON: function (text) {
      var obj = JSON.parse(text);
      var st = obj && obj.state;
      if (!st || typeof st !== 'object' || !st.settings || !st.items) throw new Error('Not a LET Study backup file');
      st = this.upgrade(st);
      st.profile = this.state.profile;
      st.planCache = null;
      this.state = st;
      this.save();
    }
  };
  window.Store = Store;
})();

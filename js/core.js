'use strict';

/* ============================== utils ============================== */
const DAY = 864e5;
const clock = { offset: 0, now() { return Date.now() + this.offset; } };
const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const parseDay = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const daysUntil = key => Math.round((parseDay(key) - startOfDay(clock.now())) / DAY);
const todayKey = () => dayKey(clock.now());
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const uniq = a => [...new Set(a)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const fmtDay = key => new Date(parseDay(key)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// Matches the word and its common inflections (persuade → persuaded, happy → happily).
function stemRe(word, flags = 'i') {
  const w = word.toLowerCase();
  let src;
  if (w.length <= 3) src = escRe(w) + '(?:s|es|ed|ing)?\\b';
  else if (w.endsWith('y')) src = escRe(w.slice(0, -1)) + '(?:y|i)[a-z]*';
  else if (w.endsWith('e')) src = escRe(w.slice(0, -1)) + 'e?[a-z]*';
  else src = escRe(w) + '[a-z]*';
  return new RegExp('\\b' + src, flags);
}

/* ============================== store ============================== */
const KEY = 'rememberit:v1';
const DEFAULT_SETTINGS = {
  provider: 'codex', deepseekKey: '', bridgeToken: '', model: 'deepseek-flash', grade: 11, retention: 0.9,
  newPerDay: 15, dailyCap: 100, sessionSize: 20, batchSize: 8, learnChecks: 2, useSpeed: true,
};
// Allowed range for each number setting.
const SETTING_LIMITS = {
  grade: [3, 12], newPerDay: [1, 50], dailyCap: [10, 400], sessionSize: [5, 60], batchSize: [3, 100], learnChecks: [1, 3],
};
let db;
const store = {
  blank() {
    return { version: 2, lists: {}, words: {}, settings: { ...DEFAULT_SETTINGS }, daily: { date: '', done: 0 }, streak: { last: '', count: 0 }, apiLog: [], rt: {}, model: null };
  },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
    if (!isObj(d)) d = null;
    db = d ? { ...this.blank(), ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } } : this.blank();
    db.words = fixAll(db.words, fixWord);
    db.lists = fixAll(db.lists, fixList);
    for (const k of ['daily', 'streak', 'rt']) if (!isObj(db[k])) db[k] = this.blank()[k];
    if (!Array.isArray(db.apiLog)) db.apiLog = [];
    // deepseek-chat is no longer offered; deepseek-flash (V4.1 Flash) replaces it.
    if (!db.settings.model || db.settings.model === 'deepseek-chat') db.settings.model = 'deepseek-flash';
    // Saved before Codex and Claude Code were offered: keep using DeepSeek if a key was set.
    if (!d?.settings?.provider) db.settings.provider = db.settings.deepseekKey ? 'deepseek' : DEFAULT_SETTINGS.provider;
    for (const [k, [lo, hi]] of Object.entries(SETTING_LIMITS)) db.settings[k] = clamp(Math.round(Number(db.settings[k]) || DEFAULT_SETTINGS[k]), lo, hi);
    // Version 1 kept one list per word; version 2 lets a word sit in several lists. Lists' units already say which words they hold, so rebuild from them.
    db.version = 2;
    units.reindex();
    units.adoptOrphans();
    return db;
  },
  stale: false,
  save() {
    if (store.stale) return; // another tab has newer data; saving here would overwrite it
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch { toast('Could not save — browser storage is full or blocked', 'bad'); }
  },
  exportJSON() {
    const copy = JSON.parse(JSON.stringify(db));
    copy.settings.deepseekKey = '';
    copy.settings.bridgeToken = '';
    copy.apiLog = [];
    return JSON.stringify(copy);
  },
  importJSON(text) {
    const inc = JSON.parse(text);
    if (!isObj(inc) || !isObj(inc.words)) throw new Error('Not an AceTheWords backup');
    let added = 0, updated = 0;
    for (const [k, w] of Object.entries(fixAll(inc.words, fixWord))) {
      const cur = db.words[k];
      if (!cur) { db.words[k] = w; added++; }
      else if ((w.mem?.lastReview || 0) > (cur.mem?.lastReview || 0)) { db.words[k] = w; updated++; }
    }
    for (const [name, l] of Object.entries(fixAll(inc.lists, fixList))) {
      const cur = db.lists[name];
      if (!cur) { db.lists[name] = l; continue; }
      const have = new Set(cur.units.flat());
      const missing = l.units.flat().filter(k => !have.has(k));
      if (missing.length) units.append(name, missing);
      if (!cur.testDate && l.testDate) cur.testDate = l.testDate;
    }
    units.reindex();
    units.adoptOrphans();
    this.save();
    return { added, updated };
  },
};

// Saved data can come from an older version or a hand-edited backup. These fill in anything missing or damaged,
// so one bad word or list can't stop the app from loading. Entries that aren't objects are dropped.
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = x => (Array.isArray(x) ? x : []);
// Names like "__proto__" would reach the object's own machinery instead of being a word or list, so they are dropped.
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const fixAll = (o, fix) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k]) => !RESERVED_KEYS.has(k)).map(([k, v]) => [k, fix(k, v)]).filter(([, v]) => v));
const GEN_LISTS = ['blank_sentences', 'blank_easy_distractors', 'blank_hard_distractors', 'meaning_hard_distractors', 'lookalike_words', 'correct_usages', 'incorrect_usages'];
function fixWord(k, w) {
  if (!isObj(w)) return null;
  const mem = { ...newMem(), ...(isObj(w.mem) ? w.mem : {}) };
  for (const n of ['S', 'D', 'lastReview', 'reps', 'lapses']) if (!Number.isFinite(mem[n])) mem[n] = 0;
  mem.successDays = arr(mem.successDays);
  mem.history = arr(mem.history).filter(isObj);
  const primary = { m: 0, d: 0, manual: false, ...(isObj(w.primary) ? w.primary : {}) };
  // Dropping a damaged meaning or definition shifts the ones after it, so the chosen sense is followed to its new place.
  let data = null, pm = 0, pd = 0;
  if (isObj(w.data) && Array.isArray(w.data.meanings)) {
    const meanings = [];
    w.data.meanings.forEach((m, mi) => {
      if (!isObj(m)) return;
      const defs = [];
      arr(m.defs).forEach((d, di) => {
        if (!isObj(d) || typeof d.def !== 'string') return;
        if (mi === primary.m && di === primary.d) { pm = meanings.length; pd = defs.length; }
        defs.push(d);
      });
      meanings.push({ ...m, defs, synonyms: arr(m.synonyms), antonyms: arr(m.antonyms) });
    });
    data = { ...w.data, meanings };
    // Pronunciation audio only ever comes from the dictionary; any other address (from an edited file) is dropped.
    if (!/^https:\/\/api\.dictionaryapi\.dev\//.test(String(data.audio || ''))) data.audio = '';
  }
  const g = isObj(w.gen) ? { ...w.gen } : null;
  if (g) {
    for (const f of GEN_LISTS) g[f] = arr(g[f]);
    g.incorrect_usages = g.incorrect_usages.filter(isObj);
    const strs = x => arr(x).filter(y => typeof y === 'string');
    g.blank_items = arr(g.blank_items).filter(x => isObj(x) && typeof x.sentence === 'string')
      .map(x => ({ sentence: x.sentence, tempting: strs(x.tempting), easy: strs(x.easy) }));
  }
  return { ...newWord(k, typeof w.list === 'string' ? w.list : ''), ...w, word: k, mem, data, gen: g, primary: { ...primary, m: pm, d: pd } };
}
function fixList(name, l) {
  if (!isObj(l)) return null;
  const us = arr(l.units).filter(Array.isArray).map(u => u.filter(k => typeof k === 'string'));
  return {
    ...l, name, units: us,
    testDate: /^\d{4}-\d{2}-\d{2}$/.test(l.testDate) ? l.testDate : '',
    unitSize: Number(l.unitSize) > 0 ? Number(l.unitSize) : Math.max(10, ...us.map(u => u.length)),
    unlocked: clamp(Math.round(Number(l.unlocked)) || 1, 1, Math.max(1, us.length)),
  };
}

function newMem() {
  return { S: 0, D: 0, lastReview: 0, lastDay: '', reps: 0, lapses: 0, successDays: [], memorized: false, history: [] };
}
function newWord(word, list) {
  return {
    word, list, unit: 0, lists: {}, addedAt: clock.now(), data: null, dictStatus: 'pending',
    primary: { m: 0, d: 0, manual: false }, customDef: '', gen: null, genStatus: 'none', genError: '', mem: newMem(),
  };
}

/* ============================== word info ============================== */
const info = {
  senses(w) {
    const out = [];
    (w.data?.meanings || []).forEach((m, mi) => m.defs.forEach((d, di) => out.push({ m: mi, d: di, pos: m.pos, def: d.def, example: d.example })));
    return out;
  },
  primarySense(w) {
    const m = w.data?.meanings?.[w.primary.m];
    const d = m?.defs?.[w.primary.d];
    return d ? { pos: m.pos, def: d.def, example: d.example } : null;
  },
  // Default sense without DeepSeek: skip labelled senses like "(slang)", prefer early, short ones with an example.
  bestSense(w) {
    let best = null, bestScore = -Infinity;
    for (const s of info.senses(w)) {
      const score = (/^\(/.test(s.def) ? -4 : 0) + (s.example && stemRe(w.word).test(s.example) ? 1 : 0) +
        (s.def.length < 90 ? 0.5 : 0) - s.m * 0.6 - s.d * 0.35;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best ? { m: best.m, d: best.d, manual: false } : { m: 0, d: 0, manual: false };
  },
  def(w) { return w.customDef || w.gen?.simple_definition || info.primarySense(w)?.def || ''; },
  pos(w) {
    if (w.gen?.pos) return w.gen.pos;
    // A custom definition may not match the dictionary sense, so guess from its wording.
    if (w.customDef) return /^to /i.test(w.customDef) ? 'verb' : /^(a|an|the|someone|something) /i.test(w.customDef) ? 'noun' : '';
    return info.primarySense(w)?.pos || '';
  },
  example(w) {
    if (w.gen?.example) return w.gen.example;
    if (w.customDef) return '';
    const p = info.primarySense(w);
    if (p?.example && stemRe(w.word).test(p.example)) return p.example;
    return info.examplesWithWord(w)[0] || '';
  },
  examplesWithWord(w) {
    const re = stemRe(w.word);
    const ex = [];
    if (w.customDef && !w.gen) return ex; // dictionary examples may be for a different meaning
    const p = info.primarySense(w);
    if (p?.example) ex.push(p.example);
    if (w.gen?.example) ex.push(w.gen.example);
    for (const m of w.data?.meanings || []) for (const d of m.defs) if (d.example) ex.push(d.example);
    return uniq(ex).filter(s => re.test(s));
  },
  synonyms(w) { const m = w.data?.meanings?.[w.primary.m]; return m ? m.synonyms.slice(0, 4) : []; },
  antonyms(w) { const m = w.data?.meanings?.[w.primary.m]; return m ? m.antonyms.slice(0, 2) : []; },
  state(w) {
    const m = w.mem;
    if (!m.reps) return 'new';
    if (m.memorized) return 'memorized';
    // Practicing = recalled on at least one later day, not just right after learning.
    return m.S < 1 || !m.successDays.length ? 'learning' : 'practicing';
  },
  // 0..1 progress toward Memorized, used for the per-word and per-unit bars.
  progress(w) {
    const st = info.state(w);
    if (st === 'new') return 0;
    if (st === 'memorized') return 1;
    const sMem = plan.sMem(w);
    return Math.min(0.95, 0.1 + 0.85 * Math.min(1, Math.log1p(w.mem.S) / Math.log1p(sMem)));
  },
  studyable(w) { return !!info.def(w) && info.active(w); },
  // A word is paused when every list it is in has been archived.
  active(w) { const ns = Object.keys(w.lists || {}); return !ns.length || ns.some(n => !db.lists[n]?.archived); },
};
// Lists that aren't archived, in their usual order.
const liveLists = () => Object.keys(db.lists).filter(n => !db.lists[n].archived);
// Is the word in this list? An empty name means any list.
const inList = (w, name) => !name || Object.hasOwn(w.lists || {}, name);
const STATE_LABEL = { new: 'New', learning: 'Learning', practicing: 'Practicing', memorized: 'Memorized' };
const highlight = (text, word) => esc(text).replace(stemRe(word, 'gi'), m => `<mark>${m}</mark>`);

/* ============================== AI providers ============================== */
// DeepSeek is called directly with an API key. Codex and Claude Code run on the student's own computer through
// bridge/acethewords-bridge.mjs, which uses the login (ChatGPT or Claude plan) the CLI already has.
const BRIDGE_URL = 'http://127.0.0.1:7313/v1/chat/completions';
const BRIDGE_SCRIPT = 'https://raw.githubusercontent.com/itsyuranwei/acethewords/main/bridge/acethewords-bridge.mjs';
const PROVIDERS = {
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', key: s => s.deepseekKey },
  codex: { name: 'Codex', cli: 'Codex CLI', plan: 'ChatGPT', url: BRIDGE_URL, key: s => s.bridgeToken },
  claude: { name: 'Claude', cli: 'Claude Code', plan: 'Claude', url: BRIDGE_URL, key: s => s.bridgeToken },
};

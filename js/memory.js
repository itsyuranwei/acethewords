'use strict';

/* ============================== memory model (FSRS-5) ============================== */
// Default FSRS-5 parameters (open-spaced-repetition). S = stability in days, D = difficulty 1..10,
// R = probability of recall. Grades: 1 Again, 2 Hard, 3 Good, 4 Easy.
const FSRS_W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;
/* ============================== answer speed ============================== */
// The hidden timer measures thinking time per question. Raw seconds mean little on their own (a usage question
// takes longer to read than a flashcard), so each time is compared with this student's own recent correct
// answers of the same question type, as a z-score of log time (response times are roughly log-normal).
// Typical thinking time per question type before the student has a history (ms).
const RT_DEFAULT = { card: 4000, meanEasy: 4500, wordEasy: 4500, meanHard: 6000, blankEasy: 7000, wordHard: 6000, blankHard: 8000, usage: 10000 };
const RT_MAX = 60000; // longer than this, the student probably looked away, so the time says nothing
const rt = {
  stats(type) {
    const xs = db.rt?.[type] || [], n = xs.length, k = 10;
    const mu0 = Math.log(RT_DEFAULT[type] || 6000);
    const mean = n ? xs.reduce((a, b) => a + b, 0) / n : mu0;
    const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0.5;
    // Shrink toward the defaults until there are enough answers.
    return { mu: (n * mean + k * mu0) / (n + k), sd: Math.max(0.25, (n * sd + k * 0.5) / (n + k)) };
  },
  usable: ms => ms > 0 && ms <= RT_MAX,
  // Negative = faster than usual for this student, positive = slower. null when the time is unusable.
  z(type, ms) { if (!rt.usable(ms)) return null; const { mu, sd } = rt.stats(type); return clamp((Math.log(ms) - mu) / sd, -3, 3); },
  // Too fast to have read the question: likely a guess or a misclick (rapid guessing, Wise & Kong 2005).
  rapid(type, ms) { return rt.usable(ms) && ms < Math.max(700, 0.3 * Math.exp(rt.stats(type).mu)); },
  observe(type, ms, ok) {
    if (!ok || !rt.usable(ms) || rt.rapid(type, ms)) return;
    const xs = ((db.rt ||= {})[type] ||= []);
    xs.push(Math.log(ms));
    if (xs.length > 80) xs.splice(0, xs.length - 80);
  },
  // Builds the baselines from saved answers the first time this version runs.
  seed() {
    if (db.rt && Object.keys(db.rt).length) return;
    db.rt = {};
    const hs = Object.values(db.words).flatMap(w => w.mem.history).filter(h => h.g > 1 && rt.usable(h.ms)).sort((a, b) => a.t - b.t);
    for (const h of hs) rt.observe(h.type, h.ms, true);
  },
};

/* ============================== speed-aware recall model ============================== */
// Logistic regression on top of FSRS, predicting whether the next later-day answer to a word will be right:
//   P(correct) = σ(b · x),  x = [1, logit(FSRS recall), speed if last answer right, speed if wrong, last answer too fast, last answer right]
// Speed already shapes the FSRS grade (gradeFor), so the model only needs what speed adds beyond that. It starts
// from small weights in the direction the research points (faster correct answers → stronger memory; very fast
// answers → possible guesses; wrong-answer speed unknown) and learns the real sizes from this student's own answers,
// pulled back toward the starting weights so a few odd answers can't swing it. Logistic, not linear, regression
// because the outcome is right/wrong.
const MODEL_PRIOR = [0, 1, -0.1, 0, -0.2, 0];
const MODEL_LABELS = ['baseline', 'FSRS recall', 'speed of right answers', 'speed of wrong answers', 'too-fast answers', 'last answer right'];
const sigmoid = x => 1 / (1 + Math.exp(-x));
const logit = p => { p = clamp(p, 0.01, 0.99); return Math.log(p / (1 - p)); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const logLoss = (p, y) => -Math.log(clamp(y ? p : 1 - p, 1e-4, 1));
const model = {
  get() {
    if (!db.model || db.model.w?.length !== MODEL_PRIOR.length) db.model = { w: MODEL_PRIOR.slice(), n: 0, recent: [] };
    return db.model;
  },
  features(R, h) {
    // A too-fast answer is flagged on its own; its speed isn't read as fluency.
    const ok = h ? h.g > 1 : true, z = h?.fast ? 0 : h?.z ?? 0;
    return [1, logit(R), ok ? z : 0, ok ? 0 : z, h?.fast ? 1 : 0, ok ? 1 : 0];
  },
  predict(R, h) { return sigmoid(dot(model.get().w, model.features(R, h))); },
  // Chance the student gets the word right now, using FSRS plus how the last answer went.
  pNow(w) { return w.mem.reps ? (db.settings.useSpeed ? model.predict(mem.Rnow(w), w.mem.history.at(-1)) : mem.Rnow(w)) : 0; },
  // One online gradient step on a later-day answer. Also keeps a running score of model vs plain FSRS.
  learn(R, h, y) {
    const m = model.get(), x = model.features(R, h), p = sigmoid(dot(m.w, x));
    m.recent.push([+logLoss(p, y).toFixed(4), +logLoss(R, y).toFixed(4)]);
    if (m.recent.length > 300) m.recent.splice(0, m.recent.length - 300);
    const lr = 0.05, l2 = 0.02;
    m.w = m.w.map((b, i) => +(b + lr * ((y - p) * x[i] - l2 * (b - MODEL_PRIOR[i]))).toFixed(5));
    m.w[1] = Math.max(0.3, m.w[1]);
    m.n++;
  },
  // The FSRS recall level at which the model's chance reaches the target: fast confident answers lower it
  // (a longer gap before the next review), slow or too-fast answers raise it (sooner).
  thresholdR(target, h) {
    if (!db.settings.useSpeed || !h) return target;
    const b = model.get().w;
    const c = dot(b, model.features(0.5, h)); // logit(0.5) = 0, so this leaves out the recall term
    return clamp(sigmoid((logit(target) - c) / b[1]), Math.max(0.5, target - 0.2), Math.min(0.98, target + 0.05));
  },
  // How much the next gap stretches or shrinks for an answer of this kind versus a normal-speed one with the same result, for Settings.
  gapFactor(h) {
    const S = 10, base = mem.interval(model.thresholdR(db.settings.retention, { g: h.g, z: 0 }), S);
    return mem.interval(model.thresholdR(db.settings.retention, h), S) / base;
  },
  score() {
    const r = model.get().recent;
    if (r.length < 20) return null;
    const m = r.reduce((a, x) => a + x[0], 0) / r.length, f = r.reduce((a, x) => a + x[1], 0) / r.length;
    return { n: r.length, model: m, fsrs: f, better: (f - m) / f };
  },
};

const TIERS = [['card', 'meanEasy', 'wordEasy'], ['meanHard', 'blankEasy'], ['wordHard', 'blankHard'], ['blankHard', 'usage']];
const HARD_TYPES = ['wordHard', 'blankHard', 'usage'];
const TYPE_TIER = { intro: 0, card: 0, meanEasy: 0, wordEasy: 0, meanHard: 1, blankEasy: 1, wordHard: 2, blankHard: 2, usage: 3 };

const mem = {
  R: (t, S) => Math.pow(1 + FACTOR * t / S, DECAY),
  interval: (r, S) => S / FACTOR * (Math.pow(r, 1 / DECAY) - 1),
  clampD: d => clamp(d, 1, 10),
  D0: G => mem.clampD(FSRS_W[4] - Math.exp(FSRS_W[5] * (G - 1)) + 1),
  S0: G => FSRS_W[G - 1],
  nextD(D, G) {
    const dp = D - FSRS_W[6] * (G - 3) * (10 - D) / 9;
    return mem.clampD(FSRS_W[7] * mem.D0(4) + (1 - FSRS_W[7]) * dp);
  },
  recallS(D, S, R, G) {
    const hard = G === 2 ? FSRS_W[15] : 1, easy = G === 4 ? FSRS_W[16] : 1;
    return S * (1 + Math.exp(FSRS_W[8]) * (11 - D) * Math.pow(S, -FSRS_W[9]) * (Math.exp(FSRS_W[10] * (1 - R)) - 1) * hard * easy);
  },
  forgetS(D, S, R) {
    return Math.min(S, FSRS_W[11] * Math.pow(D, -FSRS_W[12]) * (Math.pow(S + 1, FSRS_W[13]) - 1) * Math.exp(FSRS_W[14] * (1 - R)));
  },
  shortTermS(S, G) {
    let inc = Math.exp(FSRS_W[17] * (G - 3 + FSRS_W[18]));
    if (G >= 2) inc = Math.max(1, inc); // a correct same-day answer never lowers stability
    return S * inc;
  },
  Rnow(w) { const m = w.mem; return m.reps ? mem.R((clock.now() - m.lastReview) / DAY, m.S) : 0; },

  // Converts a question result into an FSRS grade (recognition counts less than recall).
  // Speed is judged against this student's usual time for the question type, not fixed seconds.
  gradeFor(type, ok, ms) {
    if (!ok) return 1;
    let g = (type === 'meanEasy' || type === 'wordEasy') ? 2 : 3;
    if (!db.settings.useSpeed) return g;
    if (rt.rapid(type, ms)) return 2; // too fast to have read it: might be a lucky guess
    const z = rt.z(type, ms);
    // Quick, correct recall on a hard question (not 2-option usage, where guessing is easy) shows fluency.
    if (z != null && z < -0.8 && HARD_TYPES.includes(type) && type !== 'usage') g = 4;
    if (z != null && z > 1.2) g = Math.max(2, g - 1); // right, but slow for this student
    return g;
  },

  review(w, G, type, ms) {
    const m = w.mem, now = clock.now(), today = dayKey(now);
    const longTerm = m.reps > 0 && m.lastDay !== today;
    if (!m.reps) {
      m.S = mem.S0(G); m.D = mem.D0(G);
    } else {
      if (longTerm) {
        const r = mem.R((now - m.lastReview) / DAY, m.S);
        m.S = G === 1 ? mem.forgetS(m.D, m.S, r) : mem.recallS(m.D, m.S, r, G);
      } else {
        m.S = mem.shortTermS(m.S, G);
      }
      m.D = mem.nextD(m.D, G);
    }
    m.S = Math.max(0.01, m.S);
    if (G === 1) { if (longTerm || m.memorized) m.lapses++; m.memorized = false; }
    if (longTerm && G >= 2 && !m.successDays.includes(today)) m.successDays.push(today);
    m.reps++; m.lastReview = now; m.lastDay = today;
    m.history.push({ t: now, type, g: G, ms: Math.round(ms || 0) });
    if (m.history.length > 40) m.history.splice(0, m.history.length - 40);
    if (!m.memorized && G >= 2 && HARD_TYPES.includes(type) && m.S >= plan.sMem(w) && m.successDays.length >= 3) m.memorized = true;
  },

  // Memorized words that have faded too far go back to practice.
  refreshAll() {
    for (const w of Object.values(db.words)) if (w.mem.memorized && mem.Rnow(w) < 0.6) w.mem.memorized = false;
  },

  // Picks a question type a little above the word's current strength (desirable difficulty).
  ladder(w, allowed = null) {
    const m = w.mem;
    let tier = !m.reps ? 0 : m.S < 1 ? 0 : m.S < 4 ? 1 : m.S < 10 ? 2 : 3;
    if (m.reps && mem.Rnow(w) < 0.75) tier = Math.max(0, tier - 1);
    const last = m.history[m.history.length - 1]?.type;
    for (let t = tier; t >= 0; t--) {
      let types = TIERS[t].filter(x => (!allowed || allowed.includes(x)) && qfx.can(x, w));
      if (types.length > 1) types = types.filter(x => x !== last);
      if (types.length) return pick(types);
    }
    return allowed ? (allowed.find(x => qfx.can(x, w)) || 'meanEasy') : 'meanEasy';
  },
  easier(type, w) {
    const t = Math.max(0, (TYPE_TIER[type] || 0) - 1);
    const types = TIERS[t].filter(x => x !== 'card' && qfx.can(x, w));
    return types.length ? pick(types) : 'meanEasy';
  },
};

/* ============================== planner ============================== */
const plan = {
  listWords(name) { return (db.lists[name]?.units || []).flat().map(k => db.words[k]).filter(Boolean); },
  testInfo(list) {
    if (!list?.testDate) return null;
    const d = daysUntil(list.testDate);
    return { d, start: parseDay(list.testDate), upcoming: d >= 0, passed: d < 0 };
  },
  // Desired retention rises toward 0.95 in the final week before a test; maintenance after it.
  retention(list) {
    const base = db.settings.retention;
    const t = plan.testInfo(list);
    if (!t) return base;
    if (t.passed) return Math.min(base, 0.85);
    if (t.d <= 7) { const top = Math.max(base, 0.95); return base + (top - base) * (1 - Math.max(0, t.d - 1) / 6); }
    return base;
  },
  // A word in several lists is paced by the one with the nearest upcoming test, then a list without a test, then one whose test has passed.
  pacingList(w) {
    let best = db.lists[w.list], bestRank = Infinity;
    for (const n of Object.keys(w.lists || {})) {
      const t = plan.testInfo(db.lists[n]);
      const rank = !t ? 1e6 : t.upcoming ? t.d : 2e6;
      if (rank < bestRank) { bestRank = rank; best = db.lists[n]; }
    }
    return best;
  },
  sMem(w) {
    const t = plan.testInfo(plan.pacingList(w));
    return t && t.upcoming ? clamp(1.5 * t.d, 7, 21) : 21;
  },
  dueAt(w) {
    const m = w.mem;
    if (!m.reps) return Infinity;
    const list = plan.pacingList(w);
    let due = m.lastReview + mem.interval(model.thresholdR(plan.retention(list), m.history.at(-1)), m.S) * DAY;
    const t = plan.testInfo(list);
    if (t && t.upcoming) {
      const cap = t.start - DAY; // make sure every word is seen the day before the test
      if (m.lastReview < cap && due > cap) due = cap;
    }
    return due;
  },
  isDueToday(w) { return plan.dueAt(w) < startOfDay(clock.now()) + DAY; },
  introducedToday(list) { return list.newLog?.date === todayKey() ? list.newLog.count : 0; },
  countNew(name) {
    const list = db.lists[name]; if (!list) return;
    const today = todayKey();
    if (list.newLog?.date !== today) list.newLog = { date: today, count: 0 };
    list.newLog.count++;
  },
  newPerDay(name, poolAtDayStart) {
    const t = plan.testInfo(db.lists[name]);
    // With a test: at least the normal daily amount, more if needed to finish 2 days early.
    if (t && t.upcoming) return Math.max(db.settings.newPerDay, Math.ceil(poolAtDayStart / Math.max(1, t.d - 2)));
    return db.settings.newPerDay;
  },
  // New words this list may still introduce today.
  newAllowance(name) {
    const list = db.lists[name]; if (!list) return 0;
    const remaining = plan.listWords(name).filter(w => !w.mem.reps && info.studyable(w)).length;
    const intro = plan.introducedToday(list);
    return Math.max(0, Math.min(remaining, plan.newPerDay(name, remaining + intro) - intro));
  },
  // New words in study order. Lists with a test unlock units by pace; others only use unlocked units.
  learnQueue(name, n = Infinity) {
    const list = db.lists[name]; if (!list) return [];
    const t = plan.testInfo(list);
    const maxUnit = t && t.upcoming ? list.units.length : list.unlocked;
    const out = [];
    for (let u = 0; u < maxUnit && out.length < n; u++) {
      for (const k of list.units[u] || []) {
        const w = db.words[k];
        if (w && !w.mem.reps && info.studyable(w)) { out.push(w); if (out.length >= n) break; }
      }
    }
    return out;
  },
  readiness(name) {
    const list = db.lists[name];
    const t = plan.testInfo(list);
    const ws = plan.listWords(name).filter(info.studyable);
    if (!ws.length) return 0;
    const at = t && t.upcoming ? t.start + DAY / 3 : clock.now();
    return ws.reduce((a, w) => a + (w.mem.reps ? mem.R(Math.max(0, at - w.mem.lastReview) / DAY, w.mem.S) : 0), 0) / ws.length;
  },
  dueWords(filter = () => true) { return Object.values(db.words).filter(w => w.mem.reps && info.studyable(w) && filter(w) && plan.isDueToday(w)); },
  // Questions answered today for one list's words.
  doneToday(name) {
    const sod = startOfDay(clock.now());
    return plan.listWords(name).reduce((a, w) => a + w.mem.history.filter(h => h.t >= sod).length, 0);
  },
  // Today's workload for one list, or for all lists when name is empty.
  today(name = '') {
    const names = name ? [name] : liveLists();
    const newLeft = names.reduce((a, n) => a + Math.min(plan.newAllowance(n), plan.learnQueue(n).length), 0);
    const due = plan.dueWords(w => inList(w, name)).length;
    const remainingQ = newLeft * 4 + due;
    const done = name ? plan.doneToday(name) : db.daily.date === todayKey() ? db.daily.done : 0;
    const times = Object.values(db.words).flatMap(w => w.mem.history.map(h => h.ms)).filter(x => x > 0 && x < 60000).slice(-200).sort((a, b) => a - b);
    const sec = (times.length ? times[Math.floor(times.length / 2)] / 1000 : 8) + 4;
    const cap = db.settings.dailyCap;
    return { newLeft, due, done, planned: Math.max(done, Math.min(done + remainingQ, Math.max(cap, done))), mins: Math.ceil(Math.min(remainingQ, cap) * sec / 60), overflow: Math.max(0, remainingQ - cap) };
  },
  forecast(days = 14, only = '') {
    const sod = startOfDay(clock.now());
    const cols = Array.from({ length: days }, (_, i) => ({ day: dayKey(sod + i * DAY + DAY / 2), rev: 0, nw: 0, test: false }));
    for (const w of Object.values(db.words)) {
      if (!w.mem.reps || !info.studyable(w) || !inList(w, only)) continue;
      const i = Math.max(0, Math.floor((startOfDay(plan.dueAt(w)) - sod) / DAY + 0.5));
      if (i < days) cols[i].rev++;
    }
    for (const [name, list] of Object.entries(db.lists)) {
      if (only && name !== only) continue;
      const t = plan.testInfo(list);
      let rem = plan.listWords(name).filter(w => !w.mem.reps && info.studyable(w)).length;
      for (let i = 0; i < days && rem > 0; i++) {
        let n;
        if (i === 0) n = plan.newAllowance(name);
        else if (t && t.upcoming) n = t.d - i >= 1 ? Math.max(db.settings.newPerDay, Math.ceil(rem / Math.max(1, t.d - i - 2))) : 0;
        else n = db.settings.newPerDay;
        n = Math.min(rem, n); cols[i].nw += n; rem -= n;
      }
      if (t && t.upcoming && t.d < days) cols[t.d].test = true;
    }
    return cols;
  },
  warnings(name) {
    const list = db.lists[name];
    const t = plan.testInfo(list);
    const out = [];
    if (t && t.upcoming) {
      const remaining = plan.listWords(name).filter(w => !w.mem.reps && info.studyable(w)).length;
      const per = plan.newPerDay(name, remaining + plan.introducedToday(list));
      if (remaining && per > 25) out.push(`${remaining} new words in ${plural(t.d, 'day')} means about ${per} new words a day — that's a lot. Consider moving the test date or focusing on the most important units.`);
      if (t.d <= 1 && remaining) out.push(`${plural(remaining, 'word')} still not learned and the test is ${t.d === 0 ? 'today' : 'tomorrow'}.`);
    }
    if (t && t.passed) out.push('The test date has passed — this list is in maintenance mode (longer gaps). Set a new date for the next test.');
    return out;
  },
};

/* ============================== units ============================== */
const units = {
  defaultSize(name, total) {
    const t = plan.testInfo(db.lists[name] || { testDate: units._pendingTest });
    if (t && t.upcoming) return clamp(Math.max(db.settings.newPerDay, Math.ceil(total / Math.max(1, t.d - 2))), 10, 30);
    const g = Number(db.settings.grade);
    return g <= 5 ? 12 : g <= 8 ? 20 : 25;
  },
  split(keys, size) {
    if (!keys.length) return [];
    const n = keys.length <= size * 1.25 ? 1 : Math.ceil(keys.length / size);
    const base = Math.floor(keys.length / n), extra = keys.length % n;
    const out = []; let i = 0;
    for (let u = 0; u < n; u++) { const len = base + (u < extra ? 1 : 0); out.push(keys.slice(i, i + len)); i += len; }
    return out;
  },
  create(name, keys, testDate) {
    units._pendingTest = testDate || '';
    const size = units.defaultSize(name, keys.length);
    units._pendingTest = '';
    db.lists[name] = { name, testDate: testDate || '', unitSize: size, units: units.split(keys, size), unlocked: 1, newLog: null, createdAt: clock.now() };
    units.reindex(name);
  },
  // New words fill the last unit up to the unit size, then start new units.
  append(name, keys) {
    const list = db.lists[name];
    if (!list) return units.create(name, keys, '');
    keys = keys.slice();
    // A list created empty picks its unit size when the first words arrive.
    if (!list.units.length) list.unitSize = units.defaultSize(name, keys.length);
    const last = list.units[list.units.length - 1];
    if (last) while (keys.length && last.length < list.unitSize) last.push(keys.shift());
    if (keys.length) list.units.push(...units.split(keys, list.unitSize));
    units.reindex(name);
  },
  // Rebuilds every word's lists (w.lists: list name → unit index) from the lists' units.
  // w.list / w.unit keep the first one so older copies of the app can still read the data.
  reindex() {
    for (const w of Object.values(db.words)) w.lists = {};
    for (const [name, list] of Object.entries(db.lists)) {
      list.units.forEach((u, i) => u.forEach(k => { const w = db.words[k]; if (w && !Object.hasOwn(w.lists, name)) w.lists[name] = i; }));
    }
    for (const w of Object.values(db.words)) { const first = Object.entries(w.lists)[0]; if (first) [w.list, w.unit] = first; }
  },
  // A word that no list holds (from a damaged backup) goes back into the list it last named.
  adoptOrphans() {
    for (const w of Object.values(db.words)) if (!Object.keys(w.lists).length) units.append(w.list || 'My words', [w.word]);
  },
  // Takes a word out of one list only. Call reindex afterwards.
  removeFrom(name, k) {
    const list = db.lists[name]; if (!list) return;
    list.units = list.units.map(u => u.filter(x => x !== k)).filter(u => u.length);
    list.unlocked = clamp(list.unlocked, 1, Math.max(1, list.units.length));
  },
  unitWords(list, i) { return (list.units[i] || []).map(k => db.words[k]).filter(w => w && info.studyable(w)); },
  progress(list, i) { const ws = units.unitWords(list, i); return ws.length ? ws.reduce((a, w) => a + info.progress(w), 0) / ws.length : 0; },
  // The next unit opens when 80% of the current one is Practicing or better.
  autoUnlock(name) {
    const list = db.lists[name]; if (!list) return false;
    let changed = false;
    while (list.unlocked < list.units.length) {
      const ws = units.unitWords(list, list.unlocked - 1);
      const ready = ws.filter(w => ['practicing', 'memorized'].includes(info.state(w))).length;
      if (ws.length && ready < 0.8 * ws.length) break;
      list.unlocked++; changed = true;
    }
    return changed;
  },
  currentUnit(list) {
    for (let i = 0; i < list.units.length; i++) if (units.unitWords(list, i).some(w => !w.mem.reps)) return i;
    return list.units.length - 1;
  },
};

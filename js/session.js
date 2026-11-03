'use strict';

/* ============================== session runner ============================== */
const runner = {
  s: null,
  start(s) {
    s.stages = s.stages.filter(st => st.length);
    if (!s.stages.length) { toast('Nothing to study here right now'); return; }
    s.queue = s.stages.shift();
    // past: questions already shown, so the student can step back and re-read them. view: index into past, or null.
    Object.assign(s, { done: 0, correct: 0, strong: new Set(), log: [], reinserts: {}, maxReinsert: s.maxReinsert ?? 2, past: [], view: null, sel: -1, finished: false });
    runner.s = s;
    $('#session').hidden = false;
    document.body.classList.add('in-session');
    runner.next();
  },
  remaining() { const s = runner.s; return s.queue.length + s.stages.reduce((a, b) => a + b.length, 0); },
  next() {
    const s = runner.s;
    if (s.cur) { s.past.push(s.cur); s.cur = null; }
    s.view = null;
    while (!s.queue.length && s.stages.length) s.queue = s.stages.shift();
    const item = s.queue.shift();
    if (!item) return runner.finish();
    const w = db.words[item.key];
    if (!w || !info.studyable(w)) return runner.next();
    const q = qfx.build(w, item.type || mem.ladder(w, s.allowed));
    s.cur = { item, q, w, t0: performance.now(), answered: null, flipped: false };
    runner.render();
    window.scrollTo?.(0, 0);
  },
  answer(i) {
    const s = runner.s, c = s?.cur;
    if (!c || c.answered || !['mcq', 'usage'].includes(c.q.kind)) return;
    const opt = c.q.options[i]; if (!opt) return;
    const ms = performance.now() - c.t0;
    c.answered = { i, ok: opt.correct };
    runner.result(mem.gradeFor(c.q.type, opt.correct, ms), opt.correct, ms);
    runner.render();
  },
  flip() { const c = runner.s?.cur; if (c && c.q.kind === 'card' && !c.flipped) { c.flipped = true; c.flipMs = performance.now() - c.t0; runner.render(); } },
  rate(g) {
    const c = runner.s?.cur;
    if (!c || c.q.kind !== 'card' || !c.flipped || c.answered) return;
    c.answered = { ok: g > 1, g };
    runner.result(g, g > 1, c.flipMs);
    runner.next();
  },
  // Looking back is read-only: past answers can be re-read but not changed (that would skew the memory model).
  prev() {
    const s = runner.s; if (!s) return;
    if (s.view == null) { if (!s.past.length) return; s.view = s.past.length - 1; s.viewT0 = performance.now(); }
    else if (s.view > 0) s.view--;
    else return;
    runner.render();
  },
  // Next works when there is somewhere to go: a later past question, or past the current one once it's done.
  canFwd() {
    const s = runner.s; if (!s) return false;
    if (s.view != null) return true;
    const c = s.cur;
    return !!c && (c.q.kind === 'intro' || (c.answered && c.q.kind !== 'card'));
  },
  fwd() {
    const s = runner.s; if (!s) return;
    if (s.view == null) {
      if (!runner.canFwd()) return;
      return s.cur.q.kind === 'intro' ? runner.introNext() : runner.next();
    }
    if (s.view < s.past.length - 1) { s.view++; runner.render(); } else runner.resume();
  },
  resume() {
    const s = runner.s; if (!s || s.view == null) return;
    if (s.cur) s.cur.t0 += performance.now() - s.viewT0; // time spent looking back doesn't count as thinking time
    s.view = null;
    runner.render();
  },
  // Arrow keys move a highlight over the screen's choices ([data-nav]); Enter picks it.
  moveSel(dir, nav) {
    const s = runner.s;
    s.sel = s.sel < 0 ? (dir > 0 ? 0 : nav.length - 1) : (s.sel + dir + nav.length) % nav.length;
    nav.forEach((el, i) => el.classList.toggle('sel', i === s.sel));
    nav[s.sel].scrollIntoView?.({ block: 'nearest' });
  },
  prevHint(arrow = true) {
    return runner.s?.past.length ? ` · ${arrow ? '←' : 'Backspace'} previous word` : '';
  },
  introNext() { const s = runner.s; if (s?.cur?.q.kind === 'intro') { s.done++; runner.next(); } },
  result(grade, ok, ms) {
    const s = runner.s, c = s.cur;
    const stronger = record(c.w, grade, c.q.type, ms);
    s.done++;
    if (ok) s.correct++;
    if (ok && stronger) s.strong.add(c.w.word);
    s.log.push({ key: c.w.word, ok });
    if (!ok && s.requeue) {
      const n = s.reinserts[c.w.word] || 0;
      if (n < s.maxReinsert) {
        s.reinserts[c.w.word] = n + 1;
        const type = s.requeue(c.item, c.w, c.q.type);
        const pos = s.requeueAt === 'end' ? s.queue.length : Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3));
        s.queue.splice(pos, 0, { key: c.w.word, type });
      }
    }
  },
  exit() {
    runner.s = null;
    $('#session').hidden = true;
    $('#session').innerHTML = '';
    document.body.classList.remove('in-session');
    ui.render();
    askai.sync();
  },
  finish() {
    const s = runner.s;
    s.cur = null; s.finished = true; s.view = null;
    runner.renderSummary();
  },
  renderSummary() {
    const s = runner.s;
    s.sel = -1;
    const byWord = {};
    for (const l of s.log) { const b = byWord[l.key] ||= { ok: 0, n: 0 }; b.n++; if (l.ok) b.ok++; }
    const keys = uniq([...(s.introKeys || []), ...s.log.map(l => l.key)]);
    const pct = s.done ? Math.round(100 * s.correct / Math.max(1, s.log.length)) : 0;
    $('#session').innerHTML = `
      <div class="sess-top"><button class="iconbtn" data-act="sessExit" aria-label="Close">✕</button>
        <button class="iconbtn" data-act="sessPrev" ${s.past.length ? '' : 'disabled'} aria-label="Previous word" title="Look back at the words (Backspace)">←</button>
        <div class="bar"><span style="width:100%"></span></div></div>
      <div class="sess-body">
        <div class="empty" style="padding-bottom:10px"><div class="emoji">${pct >= 80 ? '🌟' : pct >= 50 ? '👍' : '💪'}</div>
          <h1 style="margin:8px 0">${esc(s.title)} done!</h1>
          <div class="muted">${s.log.length ? `${s.correct} of ${s.log.length} correct (${pct}%) · ` : ''}${plural(s.strong.size, 'word')} got stronger</div>
        </div>
        <div class="card">
          ${keys.map(k => { const w = db.words[k]; if (!w) return ''; const b = byWord[k]; const st = info.state(w);
            return `<div class="sum-row"><div><b>${esc(w.word)}</b> <span class="muted small">${b ? `${b.ok}/${b.n} correct` : 'introduced'}</span></div>
              <span class="chip ${st}">${STATE_LABEL[st]}</span>
              <div class="bar thin" title="Progress to memorized"><span style="width:${Math.round(info.progress(w) * 100)}%;background:var(--st-${st})"></span></div></div>`; }).join('')}
        </div>
        <div class="row" style="justify-content:center;margin-top:18px">
          ${s.again ? '<button class="btn" data-act="sessAgain" data-nav>Go again</button>' : ''}
          <button class="btn primary big" data-act="sessExit" data-nav>Done</button>
        </div>
        <div class="keyhint">Enter to finish${runner.prevHint(false)}</div>
      </div>`;
    askai.sync();
  },
  render() {
    const s = runner.s;
    s.sel = -1;
    const viewing = s.view != null;
    if (!viewing && s.finished) return runner.renderSummary();
    const c = viewing ? s.past[s.view] : s.cur, q = c.q, w = c.w;
    const rem = s.cur ? runner.remaining() + (s.cur.answered ? 0 : 1) : 0;
    const pct = Math.round(100 * s.done / Math.max(1, s.done + rem));
    let body = '';
    if (q.kind === 'intro') body = runner.renderIntro(w, viewing);
    else if (q.kind === 'card') body = runner.renderCard(w, c, viewing);
    else body = runner.renderMcq(q, c, viewing);
    const canPrev = viewing ? s.view > 0 : s.past.length > 0;
    // Questions are numbered in the order they were shown; the total grows when a missed word comes back.
    const curNo = s.past.length + 1, total = s.past.length + (s.cur ? 1 + runner.remaining() : 0);
    const shownNo = viewing ? s.view + 1 : curNo;
    // Previous and Next stay in the same place on every screen, whether looking back or on the current question.
    const navRow = `<div class="sess-nav">
        <button class="btn sm" data-act="sessPrev" ${canPrev ? '' : 'disabled'} title="Previous (← or Backspace)">← Previous</button>
        <button class="btn sm" data-act="sessFwd" ${runner.canFwd() ? '' : 'disabled'} title="Next (→)">Next →</button></div>`;
    $('#session').innerHTML = `
      <div class="sess-top">
        <button class="iconbtn" data-act="sessExit" aria-label="Exit session" title="Exit (Esc)">✕</button>
        <div class="bar" title="${pct}% done"><span style="width:${pct}%"></span></div>
        <div class="sess-pos${viewing ? ' viewing' : ''}" title="Question ${shownNo} of ${total} in this session">${shownNo} / ${total}</div>
        <div class="sess-count" title="Words that got stronger this session">💪 ${s.strong.size}</div>
      </div>
      <div class="sess-body">${navRow}${body}${viewing ? `<div class="keyhint">← → to move between words · Esc to return to question ${s.finished ? 'summary' : curNo}</div>` : ''}</div>`;
    askai.sync();
  },
  wordHead(w, size = '') {
    return `<div class="qword ${size}">${esc(w.word)} ${w.data?.audio || window.speechSynthesis ? `<button class="iconbtn" data-act="say" data-w="${esc(w.word)}" title="Hear it">🔊</button>` : ''}</div>
      ${w.data?.phonetic ? `<div class="qphon">${esc(w.data.phonetic)}</div>` : ''}`;
  },
  wordFacts(w) {
    const syn = info.synonyms(w), ant = info.antonyms(w), ex = info.example(w);
    return `<div style="margin-top:6px">${info.pos(w) ? `<span class="chip">${esc(info.pos(w))}</span> ` : ''}<b style="font-size:19px">${esc(info.def(w))}</b></div>
      ${ex ? `<div class="ex">“${highlight(ex, w.word)}”</div>` : ''}
      ${syn.length ? `<div class="small muted" style="margin-top:8px">Similar: ${syn.map(esc).join(', ')}${ant.length ? ` · Opposite: ${ant.map(esc).join(', ')}` : ''}</div>` : ''}`;
  },
  renderIntro(w, viewing = false) {
    return `<div class="qtype">${TYPE_LABEL.intro}</div>
      <div class="flash">${runner.wordHead(w)}<div class="back" style="margin-top:14px;padding-top:14px">${runner.wordFacts(w)}</div></div>
      ${viewing ? '' : `<div class="row" style="justify-content:center;margin-top:20px"><button class="btn primary big" data-act="introNext" data-nav>Got it — next</button></div>
      <div class="keyhint">Space, Enter or → to continue${runner.prevHint()}</div>`}`;
  },
  renderCard(w, c, viewing = false) {
    const flipped = c.flipped || viewing;
    const rates = [[1, 'Forgot'], [2, 'Hard'], [3, 'Got it'], [4, 'Easy']].map(([g, l]) =>
      `<button class="btn rate-${g} ${viewing && c.answered?.g === g ? 'picked' : ''}" data-act="rate" data-g="${g}" ${viewing ? 'disabled' : 'data-nav'}>${l}<small>${g}</small></button>`).join('');
    return `<div class="qtype">${TYPE_LABEL.card}</div>
      <div class="qinst">Think of what it means, then flip the card.</div>
      <div class="flash">${runner.wordHead(w)}
        ${flipped ? `<div class="back">${runner.wordFacts(w)}</div>` : ''}
      </div>
      ${flipped ? `<div class="qinst" style="text-align:center;margin:18px 0 0">${viewing ? (c.answered ? 'Your rating:' : 'Not rated yet') : 'How well did you know it?'}</div>
        <div class="rates">${rates}</div>${viewing ? '' : `<div class="keyhint">Keys 1–4, or ← → then Enter${runner.prevHint(false)}</div>`}`
        : `<div class="row" style="justify-content:center;margin-top:20px"><button class="btn primary big" data-act="flip" data-nav>Show answer</button></div><div class="keyhint">Space, Enter or → to flip${runner.prevHint()}</div>`}`;
  },
  renderMcq(q, c, viewing = false) {
    const w = q.w, a = c.answered;
    let prompt = '', inst = '';
    switch (q.type) {
      case 'meanEasy': case 'meanHard':
        inst = 'What does this word mean?'; prompt = runner.wordHead(w); break;
      case 'wordEasy': case 'wordHard':
        inst = 'Which word has this meaning?';
        prompt = `<div class="qdef">“${esc(info.def(w))}”</div>${info.pos(w) ? `<div style="margin-top:8px"><span class="chip">${esc(info.pos(w))}</span></div>` : ''}`; break;
      case 'blankEasy': case 'blankHard':
        inst = 'Choose the word that best completes the sentence.';
        prompt = `<div class="qsent">${esc(q.sentence).replace('____', '<span class="blank">' + (a ? `<b class="ok">${esc(w.word)}</b>` : '&nbsp;') + '</span>').replace(/____/g, '<span class="blank">&nbsp;</span>')}</div>`; break;
      case 'usage':
        inst = `Which sentence uses <b>“${esc(w.word)}”</b> correctly?`; break;
    }
    const keys = q.kind === 'usage' ? ['A', 'B'] : ['1', '2', '3', '4'];
    const opts = q.options.map((o, i) => {
      let cls = '';
      if (a) { if (o.correct) cls = 'correct'; else if (a.i === i) cls = 'wrong'; }
      const label = q.kind === 'usage' ? highlight(o.label, w.word) : esc(o.label);
      const why = a && q.kind === 'usage' && !o.correct && o.why ? `<span class="why">✗ ${esc(o.why)}</span>` : '';
      return `<button class="opt ${cls}" data-act="ans" data-i="${i}" ${a || viewing ? 'disabled' : 'data-nav'}><span class="key">${keys[i]}</span><span>${label}${why}</span></button>`;
    }).join('');
    let fb = '';
    if (a) {
      const chosen = q.options[a.i];
      let note = '';
      if (!a.ok && ['wordEasy', 'wordHard', 'blankEasy', 'blankHard'].includes(q.type)) {
        const other = db.words[norm(chosen.label)] || null;
        const fbw = FALLBACK.find(f => f.w === chosen.label);
        const d = other ? info.def(other) : fbw?.d;
        if (d) note = `<div class="small muted" style="margin-top:8px">“${esc(chosen.label)}” means: ${esc(d)}</div>`;
      }
      fb = `<div class="feedback"><div class="verdict ${a.ok ? 'ok' : 'bad'}">${a.ok ? pick(['✓ Correct!', '✓ Nice!', '✓ Great job!', '✓ You got it!']) : '✗ Not quite'}</div>
        ${runner.wordHead(w, 'small')}${runner.wordFacts(w)}${note}</div>
        ${viewing ? '' : `<div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary big" data-act="cont" data-nav>Continue</button></div>
        <div class="keyhint">Space, Enter or → to continue${runner.prevHint()}</div>`}`;
    }
    return `<div class="qtype">${TYPE_LABEL[q.type]}</div><div class="qinst">${inst}</div>${prompt}
      <div class="options">${opts}</div>${fb}
      ${!a && !viewing ? `<div class="keyhint">↑ ↓ to choose, Enter to answer · or keys ${q.kind === 'usage' ? 'A / B' : '1–4'}${runner.prevHint(false)}</div>` : ''}`;
  },
};

/* ============================== modes ============================== */
const studyWordsIn = (listName = '', unit = '') => Object.values(db.words).filter(w => info.studyable(w) &&
  inList(w, listName) && (unit === '' || String(listName ? w.lists[listName] : w.unit) === String(unit)));

const modes = {
  learn(name, extra = false) {
    const list = db.lists[name]; if (!list) return;
    const bs = Number(db.settings.batchSize) || 5;
    const n = extra ? bs : Math.min(bs, plan.newAllowance(name));
    const words = plan.learnQueue(name, n);
    if (!words.length) { toast('No new words available right now'); return; }
    const maxUnit = Math.max(...words.map(w => w.lists[name]));
    if (maxUnit + 1 > list.unlocked) list.unlocked = maxUnit + 1;
    const keys = words.map(w => w.word);
    // Each word gets only some of the three quick checks (2 by default), picked at random, to cut same-day repetition.
    const CHECKS = ['meanEasy', 'wordEasy', 'blankEasy'];
    const nChecks = clamp(Number(db.settings.learnChecks) || 2, 1, 3);
    const chosen = Object.fromEntries(keys.map(k => [k, new Set(shuffle(CHECKS).slice(0, nChecks))]));
    const step = type => shuffle(keys.filter(k => chosen[k].has(type))).map(k => ({ key: k, type }));
    runner.start({
      title: 'Learn', introKeys: keys,
      stages: [keys.map(k => ({ key: k, type: 'intro' })), step('meanEasy'), step('wordEasy'), step('blankEasy')],
      requeue: (item, w, type) => type, requeueAt: 'end', maxReinsert: 2,
      again: () => modes.learn(name, extra),
    });
  },
  practicePool(extra, name = '') {
    const eligible = Object.values(db.words).filter(w => w.mem.reps && info.studyable(w) && !w.mem.memorized &&
      Object.entries(w.lists).some(([n, u]) => (!name || n === name) && u < (db.lists[n]?.unlocked ?? 99)));
    let pool = extra ? eligible : eligible.filter(plan.isDueToday);
    const now = clock.now();
    const score = w => {
      const ln = name || w.list, l = db.lists[ln];
      const cur = l && w.lists[ln] === units.currentUnit(l) ? 0.1 : 0;
      const miss = w.mem.history.slice(-3).some(h => h.g === 1 && now - h.t < 3 * DAY) ? 0.15 : 0;
      return model.pNow(w) - cur - miss;
    };
    return pool.sort((a, b) => score(a) - score(b));
  },
  practice(extra = false, name = '') {
    const words = modes.practicePool(extra, name).slice(0, Number(db.settings.sessionSize) || 15);
    if (!words.length) { toast(extra ? 'Learn some words first!' : 'Nothing due right now 🎉'); return; }
    runner.start({
      title: 'Practice', stages: [shuffle(words).map(w => ({ key: w.word, type: null }))],
      requeue: (item, w, type) => mem.easier(type, w),
      again: () => modes.practice(true, name),
    });
  },
  drill(type, listName, unit) {
    let words = studyWordsIn(listName, unit).filter(w => w.mem.reps);
    if (!words.length) words = studyWordsIn(listName, unit);
    words = shuffle(words).slice(0, Number(db.settings.sessionSize) || 15);
    if (!words.length) { toast('No words in this selection'); return; }
    const families = {
      meaning: ['meanEasy', 'wordEasy', 'meanHard', 'wordHard'], blank: ['blankEasy', 'blankHard'], usage: ['usage'], card: ['card'],
    };
    const allowed = families[type];
    const usable = words.filter(w => allowed.some(t => qfx.can(t, w)));
    if (!usable.length) { toast(type === 'usage' || type === 'blank' ? 'These words need example sentences — set up AI in Settings' : 'No words to drill'); return; }
    const titles = { meaning: 'Meaning drill', blank: 'Fill-in-the-blank drill', usage: 'Correct usage drill', card: 'Flashcards' };
    runner.start({
      title: titles[type], allowed,
      stages: [usable.map(w => ({ key: w.word, type: null }))],
      requeue: (item, w, t) => (allowed.length > 1 ? mem.easier(t, w) : t),
      again: () => modes.drill(type, listName, unit),
    });
  },
  reviewDue(name = '') {
    const words = plan.dueWords(w => w.mem.memorized && inList(w, name));
    if (!words.length) { toast('No memorized words are due — nice!'); return; }
    const allowed = ['blankHard', 'usage', 'card'];
    runner.start({
      title: 'Review', allowed,
      stages: [shuffle(words).map(w => ({ key: w.word, type: pick(allowed.filter(t => qfx.can(t, w))) || 'card' }))],
      requeue: (item, w, t) => mem.easier(t, w),
      again: () => modes.reviewAny({ scope: 'memorized', format: 'quiz', count: 15, list: name }),
    });
  },
  reviewAny({ scope, format, count, list = '' }) {
    let words;
    if (scope === 'memorized') words = Object.values(db.words).filter(w => w.mem.memorized && info.studyable(w) && inList(w, list));
    else if (scope === 'studied') words = Object.values(db.words).filter(w => w.mem.reps && info.studyable(w) && inList(w, list));
    else { const [, li, unit] = scope.split(':'); words = studyWordsIn(Object.keys(db.lists)[Number(li)] || '\u0000none', unit).filter(w => w.mem.reps); }
    words = shuffle(words).slice(0, count === 'all' ? Infinity : Number(count));
    if (!words.length) { toast('No studied words in this selection yet'); return; }
    runner.start({
      title: format === 'cards' ? 'Flashcard review' : 'Review quiz',
      stages: [words.map(w => ({ key: w.word, type: format === 'cards' ? 'card' : null }))],
      requeue: format === 'cards' ? null : (item, w, t) => mem.easier(t, w),
      again: () => modes.reviewAny({ scope, format, count, list }),
    });
  },
  testPrep(name) {
    const list = db.lists[name]; const t = plan.testInfo(list);
    const at = t && t.upcoming ? t.start + DAY / 3 : clock.now();
    const Rat = w => mem.R(Math.max(0, at - w.mem.lastReview) / DAY, w.mem.S);
    const words = plan.listWords(name).filter(w => w.mem.reps && info.studyable(w) && Rat(w) < 0.9).sort((a, b) => Rat(a) - Rat(b));
    if (!words.length) { toast('Every studied word looks ready for the test! 🎉'); return; }
    runner.start({
      title: 'Test prep', stages: [words.slice(0, 40).map(w => ({ key: w.word, type: null }))],
      requeue: (item, w, ty) => mem.easier(ty, w),
      again: () => modes.testPrep(name),
    });
  },
};

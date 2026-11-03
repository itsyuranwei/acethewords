'use strict';

/* ============================== fallback words ============================== */
const FALLBACK = [
  ['ancient', 'adjective', 'very old; from long ago'], ['brave', 'adjective', 'not afraid to face danger'],
  ['calm', 'adjective', 'quiet and peaceful'], ['curious', 'adjective', 'wanting to know or learn about something'],
  ['eager', 'adjective', 'wanting to do something very much'], ['fragile', 'adjective', 'easily broken'],
  ['generous', 'adjective', 'happy to give and share with others'], ['gloomy', 'adjective', 'dark, sad, or without hope'],
  ['humble', 'adjective', 'not proud; not thinking you are better than others'], ['honest', 'adjective', 'always telling the truth'],
  ['jealous', 'adjective', 'upset because someone has what you want'], ['loyal', 'adjective', 'always supporting a friend or group'],
  ['nervous', 'adjective', 'worried and a little scared'], ['polite', 'adjective', 'having good manners'],
  ['rapid', 'adjective', 'very fast'], ['rare', 'adjective', 'not often found or seen'],
  ['rough', 'adjective', 'not smooth'], ['silent', 'adjective', 'making no sound at all'],
  ['timid', 'adjective', 'shy and easily frightened'], ['vast', 'adjective', 'very large in size or area'],
  ['weary', 'adjective', 'very tired'], ['cheerful', 'adjective', 'happy and full of good spirits'],
  ['clumsy', 'adjective', 'often dropping things or bumping into things'], ['fierce', 'adjective', 'wild, strong, and ready to attack'],
  ['grateful', 'adjective', 'feeling thankful'], ['hollow', 'adjective', 'empty inside'],
  ['fortunate', 'adjective', 'lucky'], ['stubborn', 'adjective', 'refusing to change your mind'],
  ['ordinary', 'adjective', 'normal; not special'], ['obvious', 'adjective', 'easy to see or understand'],
  ['admire', 'verb', 'to look up to and respect someone'], ['avoid', 'verb', 'to stay away from something'],
  ['borrow', 'verb', 'to take something you will give back later'], ['collapse', 'verb', 'to fall down suddenly'],
  ['combine', 'verb', 'to join two or more things together'], ['defend', 'verb', 'to protect from attack'],
  ['discover', 'verb', 'to find something for the first time'], ['encourage', 'verb', 'to give someone hope or confidence'],
  ['exhaust', 'verb', 'to make someone very tired'], ['gather', 'verb', 'to bring things together in one place'],
  ['hesitate', 'verb', 'to pause before doing something because you are unsure'], ['ignore', 'verb', 'to pay no attention to'],
  ['imitate', 'verb', 'to copy the way someone acts or speaks'], ['inspect', 'verb', 'to look at something closely'],
  ['predict', 'verb', 'to say what will happen in the future'], ['protect', 'verb', 'to keep safe from harm'],
  ['refuse', 'verb', 'to say no to something'], ['scatter', 'verb', 'to spread things in many directions'],
  ['shiver', 'verb', 'to shake because you are cold or scared'], ['wander', 'verb', 'to walk around without a plan'],
  ['whisper', 'verb', 'to speak very softly'], ['explore', 'verb', 'to travel through a place to learn about it'],
  ['complain', 'verb', 'to say that you are unhappy about something'], ['celebrate', 'verb', 'to do something fun for a special event'],
  ['observe', 'verb', 'to watch carefully'], ['vanish', 'verb', 'to disappear suddenly'],
  ['repair', 'verb', 'to fix something that is broken'], ['attempt', 'verb', 'to try to do something'],
  ['deliver', 'verb', 'to bring something to a person or place'], ['courage', 'noun', 'the ability to do something that frightens you'],
  ['journey', 'noun', 'a long trip from one place to another'], ['habit', 'noun', 'something you do often, almost without thinking'],
  ['harvest', 'noun', 'the gathering of crops when they are ripe'], ['shelter', 'noun', 'a place that protects you from weather or danger'],
  ['victory', 'noun', 'a win in a game, contest, or battle'], ['disaster', 'noun', 'a terrible event that causes great damage'],
  ['feast', 'noun', 'a large, special meal'], ['glimpse', 'noun', 'a very quick look'],
  ['hazard', 'noun', 'something that could cause harm; a danger'], ['opinion', 'noun', 'what someone thinks or believes about something'],
  ['puzzle', 'noun', 'a problem or game that is hard to solve'], ['rumor', 'noun', 'a story that is passed around but may not be true'],
  ['talent', 'noun', 'a natural ability to do something well'], ['cottage', 'noun', 'a small house, often in the countryside'],
  ['knowledge', 'noun', 'information and understanding you have learned'], ['tradition', 'noun', 'a custom passed down over many years'],
  ['argument', 'noun', 'an angry disagreement'], ['evidence', 'noun', 'facts or signs that show something is true'],
  ['gently', 'adverb', 'in a soft, careful way'], ['rarely', 'adverb', 'not often'],
  ['swiftly', 'adverb', 'very quickly'], ['eagerly', 'adverb', 'with great interest and excitement'],
  ['finally', 'adverb', 'at last; after a long time'],
].map(([w, p, d]) => ({ w, p, d }));

/* ============================== question functions ============================== */
const TYPE_LABEL = {
  intro: 'New word', card: 'Flashcard', meanEasy: 'Pick the meaning', wordEasy: 'Pick the word',
  meanHard: 'Pick the meaning', blankEasy: 'Fill in the blank', wordHard: 'Pick the word',
  blankHard: 'Fill in the blank', usage: 'Correct usage',
};
const FALLBACK_CHAIN = {
  usage: ['blankHard', 'wordHard', 'meanHard', 'meanEasy'], blankHard: ['blankEasy', 'wordHard', 'meanHard', 'meanEasy'],
  blankEasy: ['meanHard', 'meanEasy'], wordHard: ['meanHard', 'wordEasy', 'meanEasy'], meanHard: ['meanEasy'],
  wordEasy: ['meanEasy'], meanEasy: ['card'], card: [],
};

function takeUnique(cands, exclude, n) {
  const seen = new Set(exclude.map(norm)); const out = [];
  for (const c of cands) {
    if (!c) continue;
    const k = norm(c);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(c);
    if (out.length >= n) break;
  }
  return out;
}
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// How alike two words look at a glance: overall spelling, plus a shared start and ending (students skim those first).
function looksLike(a, b) {
  a = norm(a); b = norm(b);
  let pre = 0; while (pre < a.length && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < a.length && suf < b.length && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length, 1) + 0.5 * Math.min(pre, 4) / 4 + 0.25 * Math.min(suf, 4) / 4;
}
// Two forms of one word ("commence" / "commencement", "decide" / "decision"). As a wrong option such a word gives the
// answer away or feels like a trick, so options never come from the target's family. Errs on the side of "same family":
// a pair like "moral" / "morale" is dropped too, which only costs one candidate.
const WORD_ENDING = /(ments?|tions?|sions?|ness|ities|ity|ives?|ally|ly|ances?|ences?|ings?|ed|ers?|able|ible|ous|ful|less|al|es|s|e|y)$/;
function sameFamily(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true;
  const ra = a.replace(WORD_ENDING, ''), rb = b.replace(WORD_ENDING, '');
  const [rs, rl] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  return rs.length >= 4 && rl.startsWith(rs);
}
// Most look-alike first. The closest few are shuffled so the same three options don't come up every time.
function closest(word, cands) {
  const sorted = cands.map(c => [c, looksLike(word, c)]).sort((x, y) => y[1] - x[1]).map(x => x[0]);
  return [...shuffle(sorted.slice(0, 5)), ...sorted.slice(5)];
}
const others = w => Object.values(db.words).filter(x => x.word !== w.word && info.studyable(x));
const fallbackFor = w => FALLBACK.filter(f => f.w !== w.word);

const qfx = {
  wrongDefs(w, hard) {
    const pos = info.pos(w), o = others(w), f = fallbackFor(w);
    const same = x => pos && info.pos(x) === pos, sameF = x => pos && x.p === pos;
    const c = hard
      ? [...shuffle(w.gen?.meaning_hard_distractors || []), ...shuffle(o.filter(same)).map(info.def), ...shuffle(f.filter(sameF)).map(x => x.d), ...shuffle(o).map(info.def), ...shuffle(f).map(x => x.d)]
      : [...shuffle(o.filter(x => !same(x))).map(info.def), ...shuffle(f.filter(x => !sameF(x))).map(x => x.d), ...shuffle(f).map(x => x.d)];
    return takeUnique(c, [info.def(w)], 3);
  },
  wrongWords(w, hard) {
    const pos = info.pos(w), o = others(w), f = fallbackFor(w);
    const same = x => pos && info.pos(x) === pos, sameF = x => pos && x.p === pos;
    const c = hard
      ? [...closest(w.word, w.gen?.lookalike_words || []), ...closest(w.word, o.filter(same).map(x => x.word)), ...closest(w.word, f.filter(sameF).map(x => x.w)), ...shuffle(f).map(x => x.w)]
      : [...shuffle(o.filter(x => !same(x))).map(x => x.word), ...shuffle(f.filter(x => !sameF(x))).map(x => x.w), ...shuffle(f).map(x => x.w)];
    return takeUnique(c.filter(x => !sameFamily(w.word, x)), [w.word], 3);
  },
  // Wrong options for one blank sentence. Sentences written with their own options (item.tempting / item.easy) use those
  // first: they were checked against that sentence, while a word ruled out by one sentence can fit another.
  wrongBlank(w, hard, item = null) {
    const pos = info.pos(w), o = others(w), f = fallbackFor(w);
    const same = x => pos && info.pos(x) === pos, sameF = x => pos && x.p === pos;
    const g = w.gen || {};
    const look = closest(w.word, g.lookalike_words || []), mine = closest(w.word, o.filter(same).map(x => x.word));
    const c = item
      ? hard
        ? [...shuffle(item.tempting), ...shuffle(item.easy), ...look, ...mine, ...shuffle(f.filter(sameF)).map(x => x.w)]
        // Learning-phase blanks: one tempting option, then clearly wrong ones.
        : [...shuffle(item.tempting).slice(0, 1), ...shuffle(item.easy), ...mine, ...shuffle(f.filter(sameF)).map(x => x.w), ...shuffle(f).map(x => x.w)]
      : hard
        ? [...shuffle(g.blank_hard_distractors || []), ...look, ...mine, ...shuffle(f.filter(sameF)).map(x => x.w)]
        : [...shuffle(g.blank_hard_distractors || []).slice(0, 1), ...shuffle([...(g.blank_easy_distractors || []), ...o.filter(same).map(x => x.word)]),
          ...shuffle(f.filter(sameF)).map(x => x.w), ...shuffle(f).map(x => x.w)];
    return takeUnique(c.filter(x => !sameFamily(w.word, x)), [w.word], 3);
  },
  // A blank sentence, with its own wrong options when it has them: { sentence, item }.
  blank(w) {
    const items = w.gen?.blank_items || [];
    if (items.length) { const item = pick(items); return { sentence: item.sentence, item }; }
    const g = w.gen?.blank_sentences || [];
    if (g.length) return { sentence: pick(g), item: null };
    const ex = info.examplesWithWord(w);
    return ex.length ? { sentence: pick(ex).replace(stemRe(w.word, 'gi'), '____'), item: null } : null;
  },
  // Fallback misuse: another word's sentence with this word swapped in. A different part of speech makes the misuse clear.
  usageOther(w) {
    const pos = info.pos(w);
    const c = others(w).filter(x => info.examplesWithWord(x).some(e => e.split(' ').length >= 5));
    const diff = c.filter(x => pos && info.pos(x) && info.pos(x) !== pos);
    return pick(diff.length ? diff : c);
  },
  can(type, w) {
    if (!info.studyable(w)) return false;
    const g = w.gen || {};
    switch (type) {
      case 'card': case 'meanEasy': case 'wordEasy': case 'meanHard': case 'wordHard': return true;
      case 'blankEasy': return !!(g.blank_sentences?.length || info.examplesWithWord(w).length);
      case 'blankHard': {
        if (!qfx.can('blankEasy', w)) return false;
        const pos = info.pos(w);
        return (g.blank_hard_distractors?.length || 0) + (g.lookalike_words?.length || 0) >= 3 ||
          others(w).filter(x => pos && info.pos(x) === pos).length >= 3;
      }
      case 'usage': return !!((g.correct_usages?.length && g.incorrect_usages?.length) || (info.examplesWithWord(w).length && qfx.usageOther(w)));
      default: return false;
    }
  },
  mcq(type, w, extra, correctLabel, wrongs) {
    if (wrongs.length < 2) return null;
    const options = shuffle([{ label: correctLabel, correct: true }, ...wrongs.map(l => ({ label: l, correct: false }))]);
    return { type, kind: 'mcq', w, options, ...extra };
  },
  make: {
    card: w => ({ type: 'card', kind: 'card', w }),
    meanEasy: w => qfx.mcq('meanEasy', w, {}, info.def(w), qfx.wrongDefs(w, false)),
    meanHard: w => qfx.mcq('meanHard', w, {}, info.def(w), qfx.wrongDefs(w, true)),
    wordEasy: w => qfx.mcq('wordEasy', w, {}, w.word, qfx.wrongWords(w, false)),
    wordHard: w => qfx.mcq('wordHard', w, {}, w.word, qfx.wrongWords(w, true)),
    blankEasy: w => { const b = qfx.blank(w); return b && qfx.mcq('blankEasy', w, { sentence: b.sentence }, w.word, qfx.wrongBlank(w, false, b.item)); },
    blankHard: w => { const b = qfx.blank(w); return b && qfx.mcq('blankHard', w, { sentence: b.sentence }, w.word, qfx.wrongBlank(w, true, b.item)); },
    usage: w => {
      const g = w.gen || {};
      if (g.correct_usages?.length && g.incorrect_usages?.length) {
        const bad = pick(g.incorrect_usages);
        return { type: 'usage', kind: 'usage', w, options: shuffle([{ label: pick(g.correct_usages), correct: true }, { label: bad.sentence, correct: false, why: bad.why }]) };
      }
      const ex = info.examplesWithWord(w), other = qfx.usageOther(w);
      if (!ex.length || !other) return null;
      const badS = pick(info.examplesWithWord(other).filter(e => e.split(' ').length >= 5)).replace(stemRe(other.word, 'gi'), w.word)
        .replace(new RegExp('\\b(a|an)\\s+(?=' + escRe(w.word) + ')', 'gi'), art => (/^[aeiou]/i.test(w.word) ? 'an ' : 'a ').replace(/^a/, art[0]));
      return { type: 'usage', kind: 'usage', w, options: shuffle([
        { label: pick(ex), correct: true },
        { label: badS, correct: false, why: `This sentence needs a word that means “${info.def(other)}”, like “${other.word}”.` },
      ]) };
    },
  },
  build(w, type) {
    if (type === 'intro') return { type: 'intro', kind: 'intro', w };
    for (const t of [type, ...(FALLBACK_CHAIN[type] || [])]) {
      if (qfx.can(t, w)) { const q = qfx.make[t](w); if (q) return q; }
    }
    return qfx.make.card(w);
  },
};

/* ============================== recording answers ============================== */
function record(w, grade, type, ms) {
  const before = info.state(w);
  const wasNew = !w.mem.reps;
  const S0 = w.mem.S;
  const z = rt.z(type, ms), fast = db.settings.useSpeed && rt.rapid(type, ms);
  // Later-day answers train the speed model: what FSRS predicted plus how the previous answer went → right or wrong now.
  if (!wasNew && w.mem.lastDay !== todayKey()) model.learn(mem.Rnow(w), w.mem.history.at(-1), grade > 1 ? 1 : 0);
  mem.review(w, grade, type, ms);
  Object.assign(w.mem.history.at(-1), { z: z == null ? null : +z.toFixed(2), fast });
  // A possible guess doesn't prove mastery.
  if (fast && before !== 'memorized' && w.mem.memorized) w.mem.memorized = false;
  rt.observe(type, ms, grade > 1);
  // A shared word counts toward the list being studied, else its first list.
  if (wasNew) plan.countNew(inList(w, ui.scope) && ui.scope ? ui.scope : w.list);
  const today = todayKey();
  if (db.daily.date !== today) db.daily = { date: today, done: 0 };
  db.daily.done++;
  if (db.streak.last !== today) {
    const yesterday = dayKey(startOfDay(clock.now()) - DAY / 2);
    db.streak.count = db.streak.last === yesterday ? db.streak.count + 1 : 1;
    db.streak.last = today;
  }
  const after = info.state(w);
  if (after === 'memorized' && before !== 'memorized') toast(`🎉 “${w.word}” is memorized!`, 'good');
  if (before === 'memorized' && after !== 'memorized') toast(`Let's practice “${w.word}” again`, 'warn');
  for (const n of Object.keys(w.lists)) if (units.autoUnlock(n)) toast(`🔓 A new unit in “${n}” is unlocked!`, 'good');
  store.save();
  return w.mem.S > S0;
}

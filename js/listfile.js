'use strict';

/* ============================== list files (.atw) ============================== */
// One word list in a file of its own, to move between devices or share with classmates. It is plain JSON with a format
// marker; it isn't encrypted, because without a password the key would have to sit in this page's code for anyone to read.
// A file from someone else is untrusted, so every word and the list go through the same repair as a backup, sizes are capped,
// and the list's own words are the only ones it can touch.
const ATW = { format: 'acethewords-list', version: 1, maxBytes: 10 * 1024 * 1024, maxWords: 5000 };
const listfile = {
  // Word fields that travel with the list. Which other lists a word is in stays on this device.
  WORD_FIELDS: ['word', 'addedAt', 'data', 'dictStatus', 'primary', 'customDef', 'gen', 'genVer', 'genStatus', 'mem'],
  export(name) {
    const list = db.lists[name]; if (!list) return;
    const keys = uniq(list.units.flat()).filter(k => db.words[k]);
    const words = Object.fromEntries(keys.map(k => {
      const w = Object.fromEntries(listfile.WORD_FIELDS.filter(f => f in db.words[k]).map(f => [f, db.words[k][f]]));
      // Importing keeps only the latest 200 answers, so there's no point saving more.
      if (w.mem) w.mem = { ...w.mem, history: (w.mem.history || []).slice(-200) };
      return [k, w];
    }));
    const out = { format: ATW.format, version: ATW.version, about: 'An AceTheWords word list. To open it in AceTheWords, click ＋ New list → Import a list.', exportedAt: new Date(clock.now()).toISOString(),
      list: { name, testDate: list.testDate, unitSize: list.unitSize, units: list.units.map(u => u.filter(k => db.words[k])), unlocked: list.unlocked }, words };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([listfile.pretty(out) + '\n'], { type: 'application/json' }));
    a.download = (name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'word-list') + '.atw';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported “${name}” (${plural(keys.length, 'word')})`, 'good');
  },
  // Readable JSON: one entry per line, anything short on a single line, and plain lists (a unit's words) wrapped like text.
  pretty(v, ind = '') {
    const skip = x => x === undefined || typeof x === 'function';
    const inline = x => skip(x) ? 'null' : x === null || typeof x !== 'object' ? JSON.stringify(x)
      : Array.isArray(x) ? `[${x.map(inline).join(', ')}]`
      : (e => (e.length ? `{ ${e.map(([k, y]) => `${JSON.stringify(k)}: ${inline(y)}`).join(', ')} }` : '{}'))(Object.entries(x).filter(([, y]) => !skip(y)));
    const one = inline(v);
    if (v === null || typeof v !== 'object' || ind.length + one.length <= 100) return one;
    const next = ind + '  ';
    if (Array.isArray(v)) {
      if (v.every(x => x === null || typeof x !== 'object')) {
        const lines = [''];
        for (const item of v.map(inline)) {
          const cur = lines[lines.length - 1];
          if (cur && next.length + cur.length + item.length + 2 > 100) lines.push(item); else lines[lines.length - 1] = cur ? `${cur}, ${item}` : item;
        }
        return `[\n${lines.map(l => next + l).join(',\n')}\n${ind}]`;
      }
      return `[\n${v.map(x => next + listfile.pretty(x, next)).join(',\n')}\n${ind}]`;
    }
    const items = Object.entries(v).filter(([, x]) => !skip(x));
    return `{\n${items.map(([k, x]) => `${next}${JSON.stringify(k)}: ${listfile.pretty(x, next)}`).join(',\n')}\n${ind}}`;
  },
  // Checks and repairs a file's contents. Throws with a message the student can read.
  parse(text) {
    let inc;
    try { inc = JSON.parse(text); } catch { throw new Error('This file is damaged or not an AceTheWords list'); }
    if (!isObj(inc) || inc.format !== ATW.format || !isObj(inc.list) || !isObj(inc.words)) throw new Error('This is not an AceTheWords list file');
    if (!(Number(inc.version) >= 1)) throw new Error('This list file is damaged');
    if (inc.version > ATW.version) throw new Error('This list was made by a newer version of AceTheWords. Reload the page and try again.');
    const okKey = k => k.length <= 60 && /\S/.test(k) && !/[\u0000-\u001f]/.test(k);
    const entries = Object.entries(inc.words).filter(([k]) => okKey(k)).slice(0, ATW.maxWords)
      .map(([k, w]) => [k, isObj(w) ? Object.fromEntries(listfile.WORD_FIELDS.filter(f => f in w).map(f => [f, w[f]])) : null]);
    const words = fixAll(Object.fromEntries(entries), fixWord);
    for (const w of Object.values(words)) { delete w.lists; delete w.list; delete w.unit; w.genError = ''; w.mem.history = w.mem.history.slice(-200); }
    if (!Object.keys(words).length) throw new Error('This list file has no words in it');
    let name = String(inc.list.name ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name || RESERVED_KEYS.has(name)) name = 'Imported list';
    const l = fixList(name, inc.list);
    // Each word once, in the file's units; words the units forgot go at the end.
    const seen = new Set();
    let us = l.units.map(u => u.filter(k => words[k] && !seen.has(k) && seen.add(k))).filter(u => u.length);
    const rest = Object.keys(words).filter(k => !seen.has(k));
    if (rest.length) us = [...us, ...units.split(rest, l.unitSize)];
    return { name, testDate: l.testDate, unitSize: l.unitSize, units: us, unlocked: clamp(l.unlocked, 1, Math.max(1, us.length)), words };
  },
  // A name that isn't taken yet: "Unit 3", "Unit 3 (2)", …
  freeName(name) {
    if (!db.lists[name]) return name;
    for (let i = 2; ; i++) if (!db.lists[`${name} (${i})`]) return `${name} (${i})`;
  },
  // Adds the list. With keepProgress off, new words start fresh. Words already on this device always keep their own
  // progress, unless the file's is more recent and keepProgress is on.
  apply(f, name, keepProgress) {
    let added = 0, updated = 0;
    for (const [k, w] of Object.entries(f.words)) {
      const cur = db.words[k];
      if (!cur) { db.words[k] = { ...w, lists: {}, mem: keepProgress ? w.mem : newMem() }; added++; continue; }
      if (keepProgress && (w.mem.lastReview || 0) > (cur.mem.lastReview || 0)) { cur.mem = w.mem; updated++; }
      if (!cur.data && w.data) Object.assign(cur, { data: w.data, dictStatus: w.dictStatus, primary: w.primary });
      if (!cur.gen && w.gen) Object.assign(cur, { gen: w.gen, genVer: w.genVer, genStatus: w.genStatus });
    }
    db.lists[name] = { name, testDate: f.testDate, unitSize: f.unitSize, units: f.units, unlocked: keepProgress ? f.unlocked : 1, newLog: null, createdAt: clock.now() };
    units.reindex();
    store.save();
    return { added, updated, shared: Object.keys(f.words).length - added };
  },
};

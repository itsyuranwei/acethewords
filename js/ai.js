'use strict';

/* ============================== API status ============================== */
const VISION_MODELS = ['deepseek-flash'];
const api = {
  inFlight: 0,
  lastToast: 0,
  log(e) {
    e.t = clock.now();
    db.apiLog = [e, ...(db.apiLog || [])].slice(0, 40);
    store.save();
    api.paint();
    if (!e.ok && Date.now() - api.lastToast > 8000) {
      api.lastToast = Date.now();
      toast(`${e.svc}: ${api.explain(e.status, e.msg)} Tap “AI” at the top for details.`, 'bad');
    }
  },
  explain(status, msg = '') {
    const p = gen.provider();
    if (status === 0) return p.cli ? 'Could not reach the bridge. Is it running? (node acethewords-bridge.mjs)' : 'Could not connect. Check the internet connection.';
    if (p.cli && status === 401) return 'The bridge token is wrong. Copy it again from the bridge window.';
    if (p.cli && status === 503) return `${p.cli} is not installed on this computer.`;
    if (p.cli && status >= 500) return `${p.cli} failed. Check that it is signed in (run it once in a terminal).`;
    if (status === 'parse') return 'Replied, but not in the expected format.';
    if (status === 400 || status === 422) return /model/i.test(msg) ? 'The model name in Settings is not accepted.' : 'The request was rejected.';
    if (status === 401 || status === 403) return 'The API key is wrong, expired or deleted.';
    if (status === 402) return 'The DeepSeek account has no balance left.';
    if (status === 429) return 'Too many requests at once. Wait a minute and retry.';
    if (status >= 500) return `${p.name} is having problems right now. Try again later.`;
    return 'Something went wrong.';
  },
  lastDS() { return (db.apiLog || []).find(e => e.svc !== 'Dictionary'); },
  state() {
    if (!gen.hasKey()) return 'off';
    if (api.inFlight) return 'busy';
    const l = api.lastDS();
    return !l ? 'idle' : l.ok ? 'ok' : 'bad';
  },
  paint() {
    if (typeof document === 'undefined') return;
    const el = $('#apiPill'); if (!el) return;
    const st = api.state();
    el.className = 'apipill ' + st;
    el.querySelector('.lab').textContent = { off: ' off', busy: ' working', ok: ' ok', bad: ' error', idle: ' ready' }[st];
    const n = gen.provider().name;
    el.title = { off: 'AI not set up', busy: `Talking to ${n}…`, ok: `Last ${n} call worked`, bad: `Last ${n} call failed`, idle: 'Set up, no calls yet' }[st];
    if ($('#apiPanelBody')) $('#apiPanelBody').innerHTML = api.panelHtml();
  },
  panelHtml() {
    const st = api.state(), l = api.lastDS();
    const head = {
      off: 'AI is not set up yet. Connect Codex, Claude Code or a DeepSeek key in Settings to get kid-friendly definitions, sentence questions and photo import.',
      busy: `Working… (${plural(api.inFlight, 'request')} in progress)`,
      ok: `Connected. Last call worked at ${l ? new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}.`,
      bad: l ? `Last call failed: ${api.explain(l.status, l.msg)}` : '',
      idle: 'Set up. No calls made yet. Press “Test connection” to check it.',
    }[st];
    const failedWords = Object.values(db.words).filter(w => w.genStatus === 'error').length;
    const rows = (db.apiLog || []).slice(0, 25).map(e => `<div class="log-row">
        <span class="muted">${new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span><b>${esc(e.svc)}</b> · ${esc(e.what || '')}${e.ok ? '' : `<div class="err small">${esc(api.explain(e.status, e.msg))}</div><div class="muted small">${esc(String(e.msg || '').slice(0, 160))}</div>`}</span>
        <span class="${e.ok ? 'ok' : 'err'}">${e.ok ? '✓' : '✗'}${e.ms ? ` <span class="muted small">${(e.ms / 1000).toFixed(1)}s</span>` : ''}</span></div>`).join('');
    return `<div class="statusbox ${st}">${esc(head)}</div>
      ${st === 'bad' && [401, 402, 403].includes(l?.status) ? `<p class="small">${l.status === 402 ? 'Top up the balance at platform.deepseek.com, then retry.' : `Check the ${gen.provider().cli ? 'bridge token' : 'key'} in <a href="#settings" data-act="closeModal">Settings</a>.`}</p>` : ''}
      <div class="row">
        ${gen.hasKey() ? '<button class="btn sm" data-act="apiTest">Test connection</button>' : '<a class="btn sm primary" href="#settings" data-act="closeModal">Open Settings</a>'}
        ${failedWords && gen.hasKey() ? `<button class="btn sm" data-act="apiRetry">Retry ${plural(failedWords, 'failed word')}</button>` : ''}
        <span class="spacer"></span>${rows ? '<button class="btn sm ghost" data-act="apiClear">Clear log</button>' : ''}
      </div>
      <h2 style="font-size:16px">Recent calls</h2>
      ${rows || '<p class="small muted">No calls yet.</p>'}`;
  },
};

/* ============================== dictionary ============================== */
const dict = {
  async lookup(word) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return dict.parse(await res.json());
      } catch (e) {
        if (attempt === 2) {
          const m = /HTTP (\d+)/.exec(e.message);
          api.log({ svc: 'Dictionary', what: word, ok: false, status: m ? Number(m[1]) : 0, msg: e.message });
          throw e;
        }
        await sleep(800 * 2 ** attempt);
      }
    }
  },
  parse(entries) {
    const out = { phonetic: '', audio: '', meanings: [] };
    for (const e of entries) {
      if (!out.phonetic) out.phonetic = e.phonetic || (e.phonetics || []).find(p => p.text)?.text || '';
      const auds = (e.phonetics || []).map(p => p.audio).filter(Boolean);
      if (!out.audio) out.audio = auds.find(a => /-us\.mp3$/.test(a)) || auds[0] || '';
      for (const m of e.meanings || []) {
        const defs = m.definitions || [];
        out.meanings.push({
          pos: m.partOfSpeech || '',
          defs: defs.slice(0, 6).map(d => ({ def: d.definition, example: d.example || '' })),
          synonyms: uniq([...(m.synonyms || []), ...defs.flatMap(d => d.synonyms || [])]).slice(0, 8),
          antonyms: uniq([...(m.antonyms || []), ...defs.flatMap(d => d.antonyms || [])]).slice(0, 6),
        });
      }
    }
    return out;
  },
};

/* ============================== question writing (AI) ============================== */
const gen = {
  provider() { return PROVIDERS[db.settings.provider] || PROVIDERS.deepseek; },
  hasKey() { return !!String(gen.provider().key(db.settings) || '').trim(); },
  // One request (retried on network errors, 429 and 5xx). Every outcome goes into the API log.
  async call(messages, maxTokens = 1800, { what = '', model = '', json = true } = {}) {
    const p = gen.provider();
    const useModel = p.cli ? db.settings.provider : model || db.settings.model || 'deepseek-flash';
    const t0 = performance.now();
    api.inFlight++; api.paint();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await gen.request(messages, maxTokens, useModel, json, what, t0);
        } catch (e) {
          if (e.cutOff && attempt < 2) { maxTokens *= 2; continue; } // reply ran out of room: retry with double the limit
          const retryable = e.status === 0 || e.status === 429 || e.status >= 500;
          if (!retryable || attempt >= 2) {
            api.log({ svc: p.name, what, ok: false, status: e.status, msg: e.message, model: useModel });
            throw e;
          }
          await sleep(1500 * 2 ** attempt);
        }
      }
    } finally { api.inFlight--; api.paint(); }
  },
  // A plain-text reply that arrives a few words at a time; onText gets each new piece. Used by the chat, where waiting for the
  // whole answer feels slow. Not retried: a reply that already started showing can't be restarted cleanly.
  // The Codex/Claude bridge returns the whole reply at once, so it is handed out word by word to look the same.
  async stream(messages, maxTokens, onText, { what = '' } = {}) {
    const p = gen.provider(), t0 = performance.now();
    const model = p.cli ? db.settings.provider : db.settings.model || 'deepseek-flash';
    api.inFlight++; api.paint();
    try {
      let res;
      try {
        res = await fetch(p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(p.key(db.settings)).trim() },
          body: JSON.stringify(p.cli ? { model, messages } : { model, messages, thinking: { type: 'disabled' }, stream: true, temperature: 0.7, max_tokens: maxTokens }),
        });
      } catch (e) { const err = new Error('Network error: ' + e.message); err.status = 0; throw err; }
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { const j = await res.json(); if (j.error?.message) msg += ': ' + j.error.message; } catch { /* keep status */ }
        const err = new Error(msg); err.status = res.status; throw err;
      }
      if (p.cli) {
        const text = (await res.json()).choices?.[0]?.message?.content || '';
        for (const piece of text.match(/\S+\s*|\s+/g) || []) { onText(piece); await sleep(35); }
        api.log({ svc: p.name, what, ok: true, ms: Math.round(performance.now() - t0), model });
        return text;
      }
      // Server-sent events: lines of "data: {json}", ending with "data: [DONE]". A line can be split across chunks.
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', text = '';
      for (;;) {
        const { value, done } = await reader.read();
        buf += dec.decode(value || new Uint8Array(), { stream: !done });
        const lines = buf.split('\n'); buf = done ? '' : lines.pop();
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, '').trim();
          if (!line.startsWith('data:') || !data || data === '[DONE]') continue;
          let piece = '';
          try { piece = JSON.parse(data).choices?.[0]?.delta?.content || ''; } catch { /* skip a malformed event */ }
          if (piece) { text += piece; onText(piece); }
        }
        if (done) break;
      }
      api.log({ svc: p.name, what, ok: true, ms: Math.round(performance.now() - t0), model });
      return text;
    } catch (e) {
      api.log({ svc: p.name, what, ok: false, status: e.status, msg: e.message, model });
      throw e;
    } finally { api.inFlight--; api.paint(); }
  },
  async request(messages, maxTokens, model, json, what, t0) {
    let res;
    try {
      const p = gen.provider();
      res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(p.key(db.settings)).trim() },
        // Thinking mode is on by default for DeepSeek V4 models; these short, structured jobs don't need it.
        body: JSON.stringify(p.cli ? { model, messages } : { model, messages, thinking: { type: 'disabled' }, ...(json ? { response_format: { type: 'json_object' } } : {}), temperature: 0.7, max_tokens: maxTokens }),
      });
    } catch (e) {
      const err = new Error('Network error: ' + e.message); err.status = 0; throw err;
    }
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j.error?.message) msg += ': ' + j.error.message; } catch { /* keep status */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const j = await res.json();
    const txt = j.choices?.[0]?.message?.content || '';
    let out = null;
    try { out = JSON.parse(txt); } catch {
      const m = txt.match(/\{[\s\S]*\}/);
      try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
    }
    if (!out) {
      const cutOff = j.choices?.[0]?.finish_reason === 'length';
      const err = new Error('Reply was not valid JSON' + (cutOff ? ' (cut off)' : '')); err.status = 'parse'; err.cutOff = cutOff; throw err;
    }
    api.log({ svc: gen.provider().name, what, ok: true, ms: Math.round(performance.now() - t0), model });
    return out;
  },
  async test() {
    const r = await gen.call([
      { role: 'system', content: 'You reply in JSON.' },
      { role: 'user', content: 'Return the JSON object {"ok": true}.' },
    ], 200, { what: 'Connection test' });
    return !!r;
  },
  prompt(w) {
    const g = db.settings.grade;
    const senses = info.senses(w).slice(0, 12);
    const senseList = senses.length ? senses.map((s, i) => `${i + 1}. (${s.pos}) ${s.def}`).join('\n') : '(none found)';
    const chosen = senses.findIndex(s => s.m === w.primary.m && s.d === w.primary.d);
    let which;
    if (w.customDef) which = `Teach this meaning (the teacher's definition): "${w.customDef}".`;
    else if (w.primary.manual && chosen >= 0) which = `Teach sense #${chosen + 1} only.`;
    else which = `Choose the sense a Grade ${g} student is most likely to be tested on, and teach only that sense.`;
    const system = `You create vocabulary practice material for a Grade ${g} student studying for a school English vocabulary midterm. ` +
      `Write like a good school vocabulary test: everyday situations (school, home, friends, sports, nature, community), age-appropriate, ` +
      `with simple surrounding words so the target word is the only hard word. Respond with a single JSON object only.`;
    const user = `Target word: "${w.word}"
Dictionary senses:
${senseList}

${which}

Return a JSON object with exactly these keys:
- "sense_index": number of the sense you taught (1-based), or 0 if none fits
- "pos": part of speech of that sense
- "simple_definition": at most 15 words a Grade ${g} student understands; do not use the target word
- "example": one natural sentence using "${w.word}"
- "blank_items": 10 objects {"sentence": "...", "tempting": [...], "easy": [...]}, each in a different situation.
  "sentence": 12–25 words, written for the exact form "${w.word}", with that word replaced by "____". Only "${w.word}" may fit, but the student must understand the whole sentence to see why: show the meaning through the situation (a cause, a result, a contrast, or how someone acts or feels). Never put the definition, a synonym or an explanation right next to the blank.
  "tempting": 3 words with the same part of speech and form as "${w.word}" that a student might pick at first glance (same topic or a similar feeling) but that clearly do NOT fit THIS sentence once it is read carefully.
  "easy": 3 everyday words a Grade ${g} student knows, with the same part of speech and form, that fit the grammar of THIS sentence but clearly not its meaning.
  Check every "tempting" and "easy" word by putting it in the blank: if the sentence would still make sense, replace it. Never use a synonym of "${w.word}" or a word from its family (like "commence" for "commencement", or "decide" for "decision").
- "meaning_hard_distractors": 10 short, plausible but clearly WRONG definitions for "${w.word}" (for example the meanings of words it is often confused with), similar in length and style to simple_definition
- "lookalike_words": up to 8 real English words a student could easily mistake for "${w.word}" at a glance, hardest first. Each must be the same part of speech and the same form (both plural, both past tense…) so grammar gives nothing away; look or sound very close: only 1–3 letters different, or a swapped prefix or ending (like adverse/averse, eminent/imminent, illicit/elicit); be a word a Grade ${g} student may have seen; and have a clearly DIFFERENT meaning (never a synonym, and never a word from the same family as "${w.word}", like "commence" for "commencement"). Give fewer rather than add loosely similar words
- "correct_usages": 10 sentences in different situations that use "${w.word}" correctly with this meaning
- "incorrect_usages": 10 objects {"sentence": "...", "why": "..."}: sentences that use "${w.word}" in a natural-looking but WRONG way (wrong meaning or wrong part of speech); "why" explains the mistake in at most 20 simple words`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  },
  // Reads photos of a vocabulary list and returns [{word, definition}] plus a suggested list name.
  async readPhotos(images, instructions, keepMeanings) {
    const g = db.settings.grade;
    const model = VISION_MODELS.includes(db.settings.model) ? db.settings.model : 'deepseek-flash';
    const text = `Extract the vocabulary words a student has to learn from ${images.length > 1 ? 'these photos' : 'this photo'}.
Rules:
- Give each word in its dictionary form (lowercase unless it is a proper noun). Keep multi-word phrases together.
- ${keepMeanings ? 'If the photo gives a meaning, definition or translation for a word, copy it into "definition" (shorten to at most 20 words, keep its sense). If none is given, use "". Never invent meanings.' : 'Use "" for every "definition".'}
- Ignore headings, page numbers, instructions and example sentences unless they are the vocabulary items themselves.
- Only correct a misread letter if you are certain.
${instructions ? `Extra instructions from the parent or teacher (follow them): «${instructions}»\n` : ''}Return JSON: {"words": [{"word": "...", "definition": "..."}], "list_name": "the list's title if the photo shows one, else empty", "notes": "anything unclear or skipped, else empty"}`;
    const messages = [
      { role: 'system', content: `You read photos of English vocabulary lists, worksheets and textbook pages for a Grade ${g} student. Respond with a single JSON object only.` },
      { role: 'user', content: [{ type: 'text', text }, ...images.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } }))] },
    ];
    const what = `Read ${plural(images.length, 'photo')}`;
    let r;
    try { r = await gen.call(messages, 8000, { what, model }); }
    catch (e) {
      if (e.status !== 400) throw e;
      r = await gen.call(messages, 8000, { what: what + ' (retry)', model, json: false });
    }
    const words = (Array.isArray(r?.words) ? r.words : [])
      .map(x => (typeof x === 'string' ? { word: x, definition: '' } : x))
      .map(x => ({ word: String(x?.word || '').trim(), definition: keepMeanings ? String(x?.definition || '').replace(/\s+/g, ' ').trim() : '' }))
      .filter(x => x.word && x.word.length < 40);
    return { words, listName: String(r?.list_name || '').trim(), notes: String(r?.notes || '').trim() };
  },
  validate(w, j) {
    if (!j || typeof j !== 'object') return null;
    const word = w.word.toLowerCase();
    const re = stemRe(w.word);
    const str = x => (typeof x === 'string' ? x.trim() : '');
    const arr = x => (Array.isArray(x) ? x : []);
    // A wrong option that is really a synonym would be marked wrong unfairly.
    const syn = new Set((w.data?.meanings?.[w.primary.m]?.synonyms || []).map(norm));
    const words = x => uniq(arr(x).map(str).map(s => s.toLowerCase()).filter(s => s && s !== word && !re.test(s) && !syn.has(norm(s)) && !sameFamily(word, s)));
    const blank = s => str(s).replace(/_{3,}/g, '____');
    const items = arr(j.blank_items).filter(isObj).map(x => ({ sentence: blank(x.sentence), tempting: words(x.tempting), easy: words(x.easy) }))
      .filter(x => x.sentence.includes('____') && !re.test(x.sentence) && x.tempting.length + x.easy.length >= 2);
    const out = {
      pos: str(j.pos).toLowerCase(),
      sense_index: Number(j.sense_index) || 0,
      simple_definition: str(j.simple_definition),
      example: re.test(str(j.example)) ? str(j.example) : '',
      // Each sentence keeps its own wrong options. The flat lists are for older code and counts only.
      blank_items: items,
      blank_sentences: items.map(x => x.sentence),
      blank_easy_distractors: uniq(items.flatMap(x => x.easy)),
      blank_hard_distractors: uniq(items.flatMap(x => x.tempting)),
      meaning_hard_distractors: uniq(arr(j.meaning_hard_distractors).map(str).filter(Boolean)),
      lookalike_words: words(j.lookalike_words),
      correct_usages: arr(j.correct_usages).map(str).filter(s => re.test(s)),
      incorrect_usages: arr(j.incorrect_usages).filter(x => x && re.test(str(x.sentence))).map(x => ({ sentence: str(x.sentence), why: str(x.why) })),
    };
    out.complete = !!(out.simple_definition && out.blank_sentences.length >= 2 && out.blank_easy_distractors.length >= 3 &&
      out.correct_usages.length >= 1 && out.incorrect_usages.length >= 1);
    return out;
  },
  // Bump when the question prompt changes, so Settings can offer to rewrite older questions.
  VERSION: 4,
  outdated() { return Object.values(db.words).filter(w => w.gen && (w.genVer || 1) < gen.VERSION && info.def(w)); },
  async generate(w) {
    let best = null;
    for (let attempt = 0; attempt < 2 && !best?.complete; attempt++) {
      const out = gen.validate(w, await gen.call(gen.prompt(w), 6000, { what: `Questions for “${w.word}”` }));
      if (out && (!best || out.complete)) best = out;
    }
    if (!best?.simple_definition) throw new Error(`${gen.provider().name} returned unusable content`);
    const senses = info.senses(w).slice(0, 12);
    const s = senses[best.sense_index - 1];
    if (s && !w.primary.manual && !w.customDef) w.primary = { m: s.m, d: s.d, manual: false };
    w.gen = best;
    w.genVer = gen.VERSION;
    w.genStatus = best.complete ? 'ok' : 'partial';
    w.genError = '';
    return best;
  },
};

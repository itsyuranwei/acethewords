'use strict';

/* ============================== UI helpers ============================== */
const $ = s => document.querySelector(s);
function toast(msg, kind = '') {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function say(word) {
  const w = db.words[word];
  const speak = () => { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(word); u.lang = 'en-US'; speechSynthesis.cancel(); speechSynthesis.speak(u); } };
  if (w?.data?.audio) new Audio(w.data.audio).play().catch(speak); else speak();
}
function stateCounts(ws) {
  const c = { new: 0, learning: 0, practicing: 0, memorized: 0 };
  for (const w of ws) c[info.state(w)]++;
  return c;
}
function stackedBar(c, cls = 'thick') {
  const total = c.new + c.learning + c.practicing + c.memorized || 1;
  return `<div class="bar ${cls}">${['memorized', 'practicing', 'learning', 'new'].map(k => `<span class="s-${k}" style="width:${100 * c[k] / total}%" title="${STATE_LABEL[k]}: ${c[k]}"></span>`).join('')}</div>`;
}
const pctBar = (p, cls = '', color = '') => `<div class="bar ${cls}"><span style="width:${Math.round(clamp(p, 0, 1) * 100)}%${color ? `;background:${color}` : ''}"></span></div>`;
// Archived lists are left out, except one that is already selected.
const listOptions = (sel, all = 'All lists') => `<option value="">${all}</option>` + Object.keys(db.lists).filter(n => !db.lists[n].archived || n === sel)
  .map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}${db.lists[n].archived ? ' (archived)' : ''}</option>`).join('');
const unitOptions = (listName, sel) => {
  const l = db.lists[listName];
  return `<option value="">All units</option>` + (l ? l.units.map((_, i) => `<option value="${i}" ${String(i) === String(sel) ? 'selected' : ''}>Unit ${i + 1}</option>`).join('') : '');
};
const stabilityText = S => S < 1 ? `about ${Math.max(1, Math.round(S * 24))} hours` : `about ${Math.round(S)} day${Math.round(S) === 1 ? '' : 's'}`;
const testText = t => t.d === 0 ? 'Test is today' : t.d === 1 ? 'Test is tomorrow' : `Test in ${t.d} days`;

/* ============================== screens ============================== */
const ui = {
  route: 'home',
  scope: '', // list name when viewing one list's dashboard or its Learn/Practice/Review
  wf: { q: '', list: '', unit: '', state: '' },
  drill: { list: '', unit: '' },
  rev: { scope: 'memorized', format: 'quiz', count: '15' },
  addPrefill: '',
  addJob: null,
  photos: [],
  photoPrompt: '',
  photoMeanings: true,
  thumbsHtml() { return ui.photos.map((p, i) => `<div class="thumb"><img src="${p.url}" alt="${esc(p.name)}"><button data-act="removePhoto" data-i="${i}" aria-label="Remove photo">✕</button></div>`).join(''); },
  async addPhotos(files) {
    const room = Math.max(0, 4 - ui.photos.length);
    if (files.length > room) toast('Up to 4 photos at a time');
    for (const f of [...files].slice(0, room)) {
      try { ui.photos.push({ name: f.name, url: await shrinkImage(f) }); }
      catch (e) { toast(e.message, 'bad'); }
    }
    if ($('#photoThumbs')) $('#photoThumbs').innerHTML = ui.thumbsHtml();
  },
  async readPhoto() {
    if (!ui.photos.length) { toast('Choose a photo first'); return; }
    const st = $('#photoStatus'), btn = document.querySelector('[data-act=readPhoto]');
    btn.disabled = true; st.textContent = 'Reading the photo… this can take 20–40 seconds.';
    try {
      const r = await gen.readPhotos(ui.photos.map(p => p.url), ui.photoPrompt.trim(), ui.photoMeanings);
      if (!r.words.length) { st.innerHTML = `<span class="err">No words found.</span> ${esc(r.notes)}`; return; }
      const ta = $('#addText');
      const lines = r.words.map(x => (x.definition ? `${x.word} : ${x.definition}` : x.word));
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + lines.join('\n');
      if (r.listName && !$('#addList').value.trim()) $('#addList').value = r.listName;
      ui.updateAddPreview();
      st.innerHTML = `<span class="ok">✓ Found ${plural(r.words.length, 'word')}.</span> Check them in the box above, then click “Add & look up”.${r.notes ? `<br><span class="muted">Note: ${esc(r.notes)}</span>` : ''}`;
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      st.innerHTML = `<span class="err">✗ ${esc(api.explain(e.status, e.message))}</span>`;
    } finally { btn.disabled = false; }
  },
  apiPanel() {
    $('#modal').innerHTML = `<div class="modal-back" data-act="closeModalBack"><div class="modal">
      <button class="iconbtn close" data-act="closeModal" aria-label="Close">✕</button>
      <h2 style="margin-top:0">${esc(gen.provider().name)} connection</h2>
      <div id="apiPanelBody">${api.panelHtml()}</div></div></div>`;
  },

  init() {
    store.load();
    rt.seed();
    mem.refreshAll();
    for (const n of Object.keys(db.lists)) units.autoUnlock(n);
    store.save();
    window.addEventListener('hashchange', () => ui.render());
    // The hidden answer timer stops while the app is in the background.
    document.addEventListener('visibilitychange', () => {
      const s = runner.s, now = performance.now();
      if (document.hidden) { runner.hiddenAt = now; return; }
      if (!s || runner.hiddenAt == null) return;
      const gone = now - runner.hiddenAt; runner.hiddenAt = null;
      if (s.view != null) s.viewT0 += gone;
      else if (s.cur && !s.cur.answered && !s.cur.flipped) s.cur.t0 += gone;
    });
    // Another tab or window saved progress. This tab's copy is now out of date, so it stops saving
    // (it would overwrite that progress) until it reloads the latest data.
    window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) ui.stale(); });
    document.addEventListener('click', ui.onClick);
    document.addEventListener('keydown', ui.onKey);
    document.addEventListener('input', ui.onInput);
    document.addEventListener('change', ui.onChange);
    $('#importFile').addEventListener('change', ui.onImport);
    $('#importList').addEventListener('change', ui.onImportList);
    ui.render();
    api.paint();
    askai.render();
    ui.loadStars();
  },
  // The repo's star count for the footer button. Kept for an hour so reloading doesn't call GitHub again (it allows 60 calls an hour
  // per network, which a school can use up); any failure just hides the count.
  async loadStars() {
    const show = n => { if (Number.isFinite(n) && n > 0) $('#starCount').textContent = n.toLocaleString(); }; // "0" isn't worth showing
    try { const c = JSON.parse(sessionStorage.getItem('stars') || 'null'); if (c && Date.now() - c.t < 36e5) return show(c.n); } catch { /* fetch below */ }
    try {
      const r = await fetch('https://api.github.com/repos/itsyuranwei/acethewords');
      const n = r.ok ? (await r.json()).stargazers_count : NaN;
      show(n);
      try { if (Number.isFinite(n)) sessionStorage.setItem('stars', JSON.stringify({ n, t: Date.now() })); } catch { /* not saved */ }
    } catch { /* offline: no count */ }
  },
  // Routes: #home (all lists), #list/<name> (one list's dashboard), #list/<name>/learn|practice|review, #add, #words, #settings.
  render() {
    const parts = ((location.hash || '#home').slice(1) || 'home').split('/');
    let r = parts[0] || 'home', scope = '';
    if (r === 'list') {
      try { scope = decodeURIComponent(parts[1] || ''); } catch { scope = ''; }
      r = parts[2] || 'list';
      if (!db.lists[scope] || !['list', 'learn', 'practice', 'review'].includes(r)) { r = 'home'; scope = ''; }
    }
    ui.route = ui.screens[r] ? r : 'home';
    ui.scope = scope;
    // The star button stays out of the way on study screens (sessions hide it through body.in-session).
    document.body.classList.toggle('studying', ['learn', 'practice', 'review'].includes(ui.route));
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === ui.route || (a.dataset.r === 'home' && ['list', 'learn', 'practice', 'review'].includes(ui.route))));
    $('#app').innerHTML = ui.screens[ui.route]();
  },
  go(r) { if (location.hash === '#' + r) ui.render(); else location.hash = r; },
  listHash: n => 'list/' + encodeURIComponent(n),
  backLink() {
    return ui.scope ? `<a class="backlink" href="#${esc(ui.listHash(ui.scope))}">← ${esc(ui.scope)}</a>` : `<a class="backlink" href="#home">← All lists</a>`;
  },
  streakHtml() {
    return db.streak.count && [todayKey(), dayKey(startOfDay(clock.now()) - DAY / 2)].includes(db.streak.last) ? `<div class="streak">🔥 ${plural(db.streak.count, 'day')}</div>` : '';
  },
  goalCard(td, title = "Today's goal") {
    return `<div class="card">
        <div class="row"><b>${title}</b><span class="spacer"></span><span class="muted small">${td.done} / ${td.planned} questions</span></div>
        <div style="margin:8px 0">${pctBar(td.planned ? td.done / td.planned : 1, '', 'var(--good)')}</div>
        <div class="muted small">${td.newLeft || td.due ? `Still to do: ${plural(td.newLeft, 'new word')} + ${plural(td.due, 'review')} · about ${td.mins} min` : 'All done for today — great work! 🎉'}
          ${td.overflow ? ` · Busy day: about ${td.overflow} questions can wait until tomorrow.` : ''}</div>
      </div>`;
  },
  forecastCard(only = '') {
    const fc = plan.forecast(14, only);
    const fmax = Math.max(1, ...fc.map(x => x.rev + x.nw));
    return `<h2>Next 14 days</h2>
      <div class="card">
        <div class="forecast">${fc.map((x, i) => `<div class="fc-col ${x.test ? 'test' : ''}" title="${fmtDay(x.day)}: ${x.rev} reviews, ${x.nw} new${x.test ? ' · TEST' : ''}">
          <span class="fc-num">${x.rev + x.nw || ''}</span>
          <div class="fc-stack" style="height:${Math.round(80 * (x.rev + x.nw) / fmax)}px"><div class="r" style="flex:${x.rev}"></div><div class="n" style="flex:${x.nw}"></div></div>
          <span class="fc-lab">${x.test ? '📝' : i === 0 ? 'Today' : new Date(parseDay(x.day)).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`).join('')}</div>
        <div class="legend"><span><i style="background:var(--primary)"></i>Reviews due</span><span><i style="background:var(--st-learning)"></i>New words planned</span><span>📝 Test day</span></div>
      </div>`;
  },

  screens: {
    // All lists, each opening its own dashboard.
    home() {
      const names = liveLists(), archived = Object.keys(db.lists).filter(n => db.lists[n].archived);
      if (!names.length && !archived.length) {
        return `<div class="card empty" style="margin-top:28px"><div class="emoji">📚</div><h1>Welcome to AceTheWords</h1>
          <p class="muted">Make a word list for each test or class — like “Lit Midterm” or “Unit 3 vocab”. The app looks up the meanings, then helps you remember them for good with short Learn, Practice and Review sessions.</p>
          <button class="btn primary big" data-act="newList">＋ Create your first list</button>
          ${gen.hasKey() ? '' : `<p class="small muted" style="margin-top:16px">Tip: connect Codex, Claude Code or DeepSeek in <a href="#settings">Settings</a> for fill-in-the-blank and usage questions.</p>`}</div>`;
      }
      const td = plan.today();
      return `
        <div class="list-head" style="margin-top:22px"><h1>Your lists</h1>${ui.streakHtml()}<button class="btn primary" data-act="newList">＋ New list</button></div>
        ${ui.goalCard(td, 'Today, all lists')}
        <div class="lists-grid">
          ${names.map(ui.listTile).join('')}
          <button class="ltile newtile" data-act="newList"><span style="font-size:30px;line-height:1">＋</span>New list</button>
          ${archived.map(ui.listTile).join('')}
        </div>`;
    },
    // One list's dashboard.
    list() {
      const n = ui.scope, list = db.lists[n];
      const all = plan.listWords(n), ws = all.filter(info.studyable);
      const base = ui.listHash(n);
      const head = `<a class="backlink" href="#home">← All lists</a>
        <div class="list-head"><h1>${esc(n)}</h1>
          <button class="btn sm ghost" data-act="listWords" data-list="${esc(n)}">📖 Words</button>
          ${ui.listMenuHtml(n)}</div>`;
      if (list.archived) {
        return head + `<div class="card empty"><div class="emoji">🗄️</div><h2 style="margin-top:6px">This list is archived</h2>
          <p class="muted">Its ${plural(all.length, 'word')} are paused: they don't come up in Learn, Practice or Review${all.some(w => Object.keys(w.lists).length > 1) ? ' (unless they are also in a list you still use)' : ''}. Progress is kept.</p>
          <button class="btn primary big" data-act="unarchiveList" data-list="${esc(n)}">Unarchive</button></div>`;
      }
      if (!all.length) {
        return head + `<div class="card empty"><div class="emoji">📝</div><h2 style="margin-top:6px">No words in this list yet</h2>
          <p class="muted">Paste words, or import them from a photo of your vocabulary sheet.</p>
          <button class="btn primary big" data-act="addToList" data-list="${esc(n)}">＋ Add words</button></div>`;
      }
      const c = stateCounts(ws);
      const pct = ws.length ? Math.round(100 * c.memorized / ws.length) : 0;
      const td = plan.today(n);
      const reviewDue = plan.dueWords(w => w.mem.memorized && inList(w, n)).length;
      const practiceDue = modes.practicePool(false, n).length;
      return head + `
        <div class="card hero">
          <div class="hero-top"><div><div class="big">${pct}%</div><div class="muted">memorized · ${c.memorized} of ${ws.length} words</div></div>${ui.streakHtml()}</div>
          ${stackedBar(c)}
          <div class="legend">${['memorized', 'practicing', 'learning', 'new'].map(k => `<span><i class="s-${k}" style="background:var(--st-${k})"></i>${STATE_LABEL[k]} ${c[k]}</span>`).join('')}</div>
        </div>
        ${ui.goalCard(td)}
        <div class="modes">
          <button class="mode" data-act="go" data-to="${esc(base)}/learn"><span class="emoji">🌱</span><span class="mtext"><span class="title">Learn</span><span class="muted small">Meet new words</span><span class="count">${plural(td.newLeft, 'new word')} today</span></span></button>
          <button class="mode" data-act="go" data-to="${esc(base)}/practice"><span class="emoji">🎯</span><span class="mtext"><span class="title">Practice</span><span class="muted small">Make words stick</span><span class="count">${practiceDue} due</span></span></button>
          <button class="mode" data-act="go" data-to="${esc(base)}/review"><span class="emoji">🔁</span><span class="mtext"><span class="title">Review</span><span class="muted small">Keep memorized words fresh</span><span class="count">${reviewDue} due · ${c.memorized} memorized</span></span></button>
        </div>
        <h2>Units & test</h2>
        ${ui.listCard(n)}
        ${ui.forecastCard(n)}`;
    },
    learn() {
      const names = ui.scope ? [ui.scope] : liveLists();
      return `${ui.backLink()}<h1 style="margin-top:6px">🌱 Learn</h1><p class="muted">Meet new words in small batches: see each word, then answer ${db.settings.learnChecks === 1 ? 'a quick question' : `${['', '', 'two', 'three'][db.settings.learnChecks]} quick questions`} about it.</p>
        ${names.map(n => {
          const list = db.lists[n];
          const allow = plan.newAllowance(n), avail = plan.learnQueue(n).length;
          const totalNew = plan.listWords(n).filter(w => !w.mem.reps && info.studyable(w)).length;
          const t = plan.testInfo(list);
          let action;
          if (!totalNew) action = `<span class="ok"><b>✓ All words learned</b></span>`;
          else if (!avail) action = `<span class="muted small">Unit ${list.unlocked + 1} unlocks when 80% of Unit ${list.unlocked} is practiced.</span> <button class="btn sm" data-act="unlockNext" data-list="${esc(n)}">Unlock now</button>`;
          else if (allow) action = `<button class="btn primary" data-act="startLearn" data-list="${esc(n)}">Learn ${Math.min(allow, avail, Number(db.settings.batchSize) || 5)} words</button>`;
          else action = `<span class="ok small"><b>✓ Today's new words done</b></span> <button class="btn sm" data-act="startLearn" data-list="${esc(n)}" data-extra="1">Learn ${Math.min(avail, Number(db.settings.batchSize) || 5)} extra</button>`;
          return `<div class="card"><div class="row"><b style="font-size:18px">${esc(n)}</b><span class="spacer"></span>${t && t.upcoming ? `<span class="chip">${testText(t)}</span>` : ''}</div>
            <div class="muted small" style="margin:4px 0 10px">${totalNew} new · ${allow} left for today${t && t.upcoming ? ` (pace: ${plan.newPerDay(n, totalNew + plan.introducedToday(list))}/day to finish before the test)` : ''}</div>
            <div class="row">${action}</div>${ui.unitTrack(n)}</div>`;
        }).join('') || `<div class="card empty"><p>No lists yet.</p><button class="btn primary" data-act="go" data-to="add">Add words</button></div>`}`;
    },
    practice() {
      const sc = ui.scope;
      const due = modes.practicePool(false, sc).length;
      const studied = modes.practicePool(true, sc).length;
      const d = ui.drill;
      if (sc && d.list !== sc) { d.list = sc; d.unit = ''; }
      const learnTo = sc ? `${ui.listHash(sc)}/learn` : 'learn';
      return `${ui.backLink()}<h1 style="margin-top:6px">🎯 Practice</h1><p class="muted">Questions get harder as each word gets stronger. Words you miss come back a few questions later.</p>
        <div class="card"><div class="row"><div><b style="font-size:18px">${due ? plural(due, 'word') + ' due' : 'Nothing due right now 🎉'}</b>
          <div class="muted small">${due ? `A session is up to ${db.settings.sessionSize} questions.` : studied ? 'You can still practice your weakest words.' : 'Learn some words first.'}</div></div><span class="spacer"></span>
          ${due ? `<button class="btn primary big" data-act="startPractice" data-list="${esc(sc)}">Start practice</button>` : studied ? `<button class="btn big" data-act="startPractice" data-list="${esc(sc)}" data-extra="1">Extra practice</button>` : `<button class="btn primary" data-act="go" data-to="${esc(learnTo)}">Go to Learn</button>`}</div></div>
        <h2>Drill one type</h2>
        <div class="card">
          <div class="grid2">${sc ? '' : `<label class="field"><span>List</span><select data-scope="list">${listOptions(d.list)}</select></label>`}
            <label class="field"><span>Unit</span><select data-scope="unit" ${d.list ? '' : 'disabled'}>${unitOptions(d.list, d.unit)}</select></label></div>
          <div class="grid2" style="margin-top:8px">
            <button class="btn" data-act="startDrill" data-type="meaning">📖 Meaning</button>
            <button class="btn" data-act="startDrill" data-type="blank">✏️ Fill in the blank</button>
            <button class="btn" data-act="startDrill" data-type="usage">✅ Correct usage</button>
            <button class="btn" data-act="startDrill" data-type="card">🃏 Flashcards</button>
          </div>
          ${gen.hasKey() ? '' : `<p class="small muted">Fill-in-the-blank and usage work best with AI set up (<a href="#settings">Settings</a>).</p>`}
        </div>`;
    },
    review() {
      const sc = ui.scope;
      const due = plan.dueWords(w => w.mem.memorized && inList(w, sc)).length;
      const memd = Object.values(db.words).filter(w => w.mem.memorized && inList(w, sc)).length;
      const r = ui.rev;
      const testLists = liveLists().filter(n => (!sc || n === sc) && plan.testInfo(db.lists[n])?.upcoming);
      const scopes = [['memorized', `${sc ? 'Memorized words in this list' : 'All memorized words'} (${memd})`], ['studied', sc ? 'Studied words in this list' : 'All studied words']];
      Object.entries(db.lists).forEach(([n, l], li) => {
        if ((sc && n !== sc) || l.archived) return;
        scopes.push([`L:${li}:`, `${n} — all units`]);
        if (l.units.length > 1) l.units.forEach((_, i) => scopes.push([`L:${li}:${i}`, `${n} — Unit ${i + 1}`]));
      });
      if (!scopes.some(([v]) => v === r.scope)) r.scope = 'memorized';
      return `${ui.backLink()}<h1 style="margin-top:6px">🔁 Review</h1><p class="muted">Memorized words still fade over time. Review brings them back right before you'd forget.</p>
        <div class="card"><div class="row"><div><b style="font-size:18px">${due ? plural(due, 'memorized word') + ' due' : 'No memorized words due'}</b>
          <div class="muted small">${memd} memorized in total</div></div><span class="spacer"></span>
          <button class="btn primary big" data-act="startReviewDue" data-list="${esc(sc)}" ${due ? '' : 'disabled'}>Start review</button></div></div>
        ${testLists.length ? `<h2>Test prep</h2>${testLists.map(n => { const t = plan.testInfo(db.lists[n]); return `<div class="card"><div class="row"><div><b>${esc(n)}</b> · ${testText(t)}
            <div class="muted small">Practices the words most likely to be forgotten by test day.</div></div><span class="spacer"></span><button class="btn primary" data-act="startTestPrep" data-list="${esc(n)}">Test prep</button></div>
            <div style="margin-top:10px">${pctBar(plan.readiness(n), '', 'var(--good)')}</div><div class="small muted" style="margin-top:4px">${Math.round(plan.readiness(n) * 100)}% ready</div></div>`; }).join('')}` : ''}
        <h2>Review anything</h2>
        <div class="card">
          <label class="field"><span>Words</span><select data-rev="scope">${scopes.map(([v, l]) => `<option value="${esc(v)}" ${v === r.scope ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <div class="grid2">
            <label class="field"><span>Style</span><select data-rev="format"><option value="quiz" ${r.format === 'quiz' ? 'selected' : ''}>Mixed quiz</option><option value="cards" ${r.format === 'cards' ? 'selected' : ''}>Flashcards</option></select></label>
            <label class="field"><span>How many</span><select data-rev="count">${['10', '20', '30', 'all'].map(v => `<option ${v === r.count ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          </div>
          <button class="btn primary" data-act="startReviewAny">Start</button>
        </div>`;
    },
    add() {
      const names = liveLists();
      return `<h1>Add words</h1>
        <div class="card">
          <label class="field"><span>Words</span>
            <textarea id="addText" placeholder="One word per line, or separated by commas.\n\nreluctant\ngenerous, fragile, persuade\nbrave : not afraid  (your own definition)"></textarea></label>
          <div class="grid2">
            <label class="field"><span>List name</span><input type="text" id="addList" list="listNames" placeholder="e.g. Unit 3 vocabulary" value="${esc(ui.addPrefill)}"><datalist id="listNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
            <label class="field"><span>Test date (optional)</span><input type="date" id="addTest" min="${todayKey()}"></label>
          </div>
          <label class="check small"><input type="checkbox" id="addShuffle"> Shuffle words before splitting into units</label>
          <div id="addPreview" class="small muted" style="margin:12px 0"></div>
          <button class="btn primary big" data-act="addSubmit">Add & look up</button>
          ${gen.hasKey() ? '' : `<p class="small muted">AI isn't set up — meanings come from the free dictionary. Connect Codex, Claude Code or DeepSeek in <a href="#settings">Settings</a> for kid-friendly definitions and sentence questions.</p>`}
        </div>
        <div class="card">
          <b style="font-size:17px">📷 Import from a photo</b>
          <p class="small muted" style="margin:4px 0 10px">Take a photo of a vocabulary list, worksheet or textbook page. The AI reads it and fills in the word box above so you can check it before adding. The photo is sent to ${esc(gen.provider().name)}.</p>
          ${gen.hasKey() ? `
          <input type="file" id="photoInput" accept="image/*" multiple>
          <div class="thumbs" id="photoThumbs">${ui.thumbsHtml()}</div>
          <label class="field"><span>Instructions (optional)</span><textarea id="photoPrompt" style="min-height:70px" placeholder="e.g. Only the words in bold. Skip the example sentences. Words 1–20 only.">${esc(ui.photoPrompt)}</textarea></label>
          <label class="check small"><input type="checkbox" id="photoMeanings" ${ui.photoMeanings ? 'checked' : ''}> Keep the meanings written in the photo</label>
          <div class="row" style="margin-top:12px"><button class="btn primary" data-act="readPhoto">Read photo</button><span id="photoStatus" class="small muted"></span></div>`
          : `<p class="small">Needs AI — set it up in <a href="#settings">Settings</a>.</p>`}
          <details style="margin-top:14px"><summary>Use another AI instead (ChatGPT, Claude, Gemini…)</summary>
            <p class="small muted" style="margin:4px 0 8px">Copy this prompt, paste it into the other AI together with the photo, then paste its answer into the word box above.</p>
            <textarea id="otherAiPrompt" readonly style="min-height:220px;font-size:13px">${esc(otherAiPrompt())}</textarea>
            <button class="btn sm" data-act="copyPrompt" style="margin-top:8px">Copy prompt</button>
          </details>
        </div>
        <div id="addProgress">${ui.addProgressHtml()}</div>`;
    },
    words() {
      const f = ui.wf;
      return `<h1>Words</h1>
        <div class="wl-filters">
          <input type="search" placeholder="Search…" data-wf="q" value="${esc(f.q)}">
          <select data-wf="list">${listOptions(f.list)}</select>
          <select data-wf="unit" ${f.list ? '' : 'disabled'}>${unitOptions(f.list, f.unit)}</select>
          <select data-wf="state"><option value="">All states</option>${Object.entries(STATE_LABEL).map(([k, v]) => `<option value="${k}" ${f.state === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <div class="card" id="wordRows" style="padding:6px 14px">${ui.wordRowsHtml()}</div>`;
    },
    settings() {
      const s = db.settings, p = gen.provider();
      return `<h1>Settings</h1>
        <div class="card">
          <h2 style="margin-top:0">AI</h2>
          <p class="small muted">Used once per word to write kid-friendly definitions, fill-in-the-blank sentences and usage questions (they are saved, so studying makes no calls), and to read photos of word lists.</p>
          <label class="field"><span>Connect with</span><select data-set="provider">
            ${[['codex', 'Codex — use your ChatGPT plan'], ['claude', 'Claude Code — use your Claude plan'], ['deepseek', 'DeepSeek — API key']]
              .map(([v, l]) => `<option value="${v}" ${v === s.provider ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${p.cli ? `
          <p class="small">Uses the ${p.cli} login you already have, so it counts against your ${p.plan} plan and needs no API key. A web page can't start programs, so a small bridge runs on your computer while you use the app.</p>
          <ol class="tight small">
            <li>Install ${p.cli} and sign in once by running <code>${s.provider}</code> in a terminal.</li>
            <li>With Node.js 18 or newer installed, run this in a terminal and leave it open:
              <div class="row" style="flex-wrap:nowrap;margin:6px 0"><code id="bridgeCmd" style="overflow-wrap:anywhere">curl -fsSLO ${BRIDGE_SCRIPT} &amp;&amp; node acethewords-bridge.mjs</code><button class="btn sm" data-act="copyBridgeCmd">Copy</button></div>
              Or <a href="https://github.com/itsyuranwei/acethewords/blob/main/bridge/acethewords-bridge.mjs" target="_blank" rel="noopener">download the bridge</a> and run <code>node acethewords-bridge.mjs</code> in its folder.</li>
            <li>Paste the token the bridge prints:</li>
          </ol>
          <label class="field"><span>Bridge token</span><input type="password" data-set="bridgeToken" value="${esc(s.bridgeToken)}" placeholder="Paste the token here" autocomplete="off"></label>
          <p class="small muted">The token is saved only in this browser and is never included in exports. The bridge only answers requests that carry it, and runs ${p.cli} with no tools in an empty folder. If the browser asks to allow access to devices on your local network, allow it.</p>`
          : `
          <p class="small muted">Your key is saved only in this browser on this device and is never included in exports.</p>
          <label class="field"><span>API key</span><div class="row" style="flex-wrap:nowrap"><input type="password" id="keyInput" data-set="deepseekKey" value="${esc(s.deepseekKey)}" placeholder="sk-…" autocomplete="off"><button class="btn sm" data-act="toggleKey">Show</button></div></label>
          <label class="field"><span>Model</span><select data-set="model">
            ${[['deepseek-flash', 'deepseek-flash — V4.1 Flash (recommended, reads photos)'], ['deepseek-v4-pro', 'deepseek-v4-pro — V4 Pro (stronger writing, ~3× cost, no photos)'],
              ...(['deepseek-flash', 'deepseek-v4-pro'].includes(s.model) ? [] : [[s.model, s.model + ' (custom)']])]
              .map(([v, l]) => `<option value="${esc(v)}" ${v === s.model ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`}
          <div class="row"><button class="btn" data-act="testKey">${p.cli ? 'Test connection' : 'Test key'}</button><button class="btn" data-act="genMissing">Generate missing content</button>${gen.outdated().length ? `<button class="btn" data-act="regenOutdated">Rewrite older questions (${gen.outdated().length})</button>` : ''}<span id="keyStatus" class="small muted"></span></div>
          ${gen.outdated().length ? `<p class="small muted">${plural(gen.outdated().length, 'word')} still ${gen.outdated().length === 1 ? 'has' : 'have'} questions from an older, easier prompt. Rewriting makes one AI request per word; progress is kept.</p>` : ''}
        </div>
        <div class="card">
          <h2 style="margin-top:0">Student</h2>
          <div class="grid2">
            <label class="field"><span>Grade level</span><select data-set="grade">${Array.from({ length: 10 }, (_, i) => i + 3).map(g => `<option value="${g}" ${Number(s.grade) === g ? 'selected' : ''}>Grade ${g}</option>`).join('')}</select></label>
            <label class="field"><span>Target recall: ${Math.round(s.retention * 100)}%</span><input type="range" min="0.8" max="0.95" step="0.01" data-set="retention" value="${s.retention}" style="width:100%"></label>
            <label class="field"><span>New words per day (no test date)</span><input type="number" min="1" max="50" data-set="newPerDay" value="${s.newPerDay}"></label>
            <label class="field"><span>Daily question limit</span><input type="number" min="10" max="400" data-set="dailyCap" value="${s.dailyCap}"></label>
            <label class="field"><span>Practice session length</span><input type="number" min="5" max="60" data-set="sessionSize" value="${s.sessionSize}"></label>
            <label class="field"><span>Learn batch size (3–100)</span><input type="number" min="3" max="100" data-set="batchSize" value="${s.batchSize}">
              ${s.batchSize > 15 ? `<span class="small muted" style="display:block;margin-top:4px">Long sessions: about ${Math.round(s.batchSize * (1 + Number(s.learnChecks)) * 10 / 60)} min each. 5–10 words per batch is easier to remember.</span>` : ''}</label>
            <label class="field"><span>Quick checks per new word</span><select data-set="learnChecks">${[[1, '1 — lightest'], [2, '2 of 3, picked at random (recommended)'], [3, 'All 3']].map(([v, l]) => `<option value="${v}" ${Number(s.learnChecks) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
          <button class="btn sm" data-act="recommendedSettings">Use recommended settings</button>
          <p class="small muted">Target recall is how sure the app wants to be that a word is still remembered before reviewing it. Higher means more reviews. It rises automatically in the week before a test.</p>
        </div>
        ${ui.speedCard()}
        <div class="card">
          <h2 style="margin-top:0">Data</h2>
          <div class="row"><button class="btn" data-act="exportData">Export backup</button><button class="btn" data-act="importData">Import backup</button><button class="btn" data-act="importList">Import a list (.atw)</button>
            <button class="btn" data-act="retryLookups">Retry failed lookups</button><span class="spacer"></span><button class="btn danger" data-act="resetAll">Erase everything</button></div>
          <p class="small muted">Progress is saved in this browser. Export a backup now and then so it isn't lost if browser data is cleared.</p>
        </div>
        <div class="card small muted">
          <b>How the memory model works.</b> AceTheWords uses FSRS-5, the spaced-repetition model behind Anki's modern scheduler. It tracks each word's <i>stability</i> (how many days until the chance of remembering drops to 90%) and <i>difficulty</i>, and predicts the chance of remembering it right now. Correct answers on harder questions and answers after longer gaps grow stability the most (the spacing and testing effects). A word counts as memorized once it is stable enough, has been recalled on 3 separate days, and passed a hard question.
        </div>`;
    },
  },

  speedCard() {
    const m = model.get(), sc = model.score(), on = db.settings.useSpeed;
    const pctTxt = f => { const d = Math.round((f - 1) * 100); return d === 0 ? 'no change' : `${d > 0 ? '+' : ''}${d}%`; };
    const rows = [
      ['Quick right answer', { g: 3, z: -1.5 }], ['Slow right answer', { g: 3, z: 1.5 }],
      ['Too-fast right answer (possible guess)', { g: 3, z: -2, fast: true }], ['Slow wrong answer', { g: 1, z: 1.5 }], ['Quick wrong answer', { g: 1, z: -1.5 }],
    ];
    const typical = Object.keys(RT_DEFAULT).filter(t => db.rt?.[t]?.length >= 5).map(t => `${TYPE_LABEL[t]} ${(Math.exp(rt.stats(t).mu) / 1000).toFixed(1)}s`);
    return `<div class="card">
      <h2 style="margin-top:0">Answer speed</h2>
      <p class="small muted">A hidden timer measures how long each answer takes, compared with this student's usual time for that kind of question. Quick right answers count as stronger memory and push the next review later; slow ones, and answers too fast to have been read, bring it sooner. A small model learns from this student's own answers how much speed really matters.</p>
      <label class="check"><input type="checkbox" data-set="useSpeed" ${on ? 'checked' : ''}> Use answer speed for scheduling</label>
      ${on ? `<div class="kv" style="margin-top:10px">${rows.map(([l, h]) => `<div>${l}<b>${pctTxt(model.gapFactor(h))}</b></div>`).join('')}</div>
      <p class="small muted">Change to the next review gap compared with a normal-speed answer with the same result (right or wrong).</p>` : ''}
      <p class="small muted">${m.n ? `Learned from ${plural(m.n, 'later-day answer')}.` : 'Still using the starting weights; it learns from answers on later days.'}
        ${sc ? ` Over the last ${sc.n}, its predictions were ${sc.better >= 0 ? `${Math.round(sc.better * 100)}% more accurate` : `${Math.round(-sc.better * 100)}% less accurate`} than the memory model alone (log loss).` : ''}
        ${typical.length ? `<br>Usual times: ${typical.join(' · ')}.` : ''}</p>
      <details><summary class="small">Model weights</summary><div class="small muted">${MODEL_LABELS.map((l, i) => `${l}: ${m.w[i].toFixed(2)} <span class="muted">(start ${MODEL_PRIOR[i]})</span>`).join('<br>')}</div></details>
      <button class="btn sm" data-act="resetModel" style="margin-top:8px">Reset speed model</button>
    </div>`;
  },
  // Archived lists keep their tile, greyed out, showing the progress they had when archived.
  listTile(n) {
    const list = db.lists[n], arch = !!list.archived;
    const all = plan.listWords(n), ws = all.filter(arch ? w => info.def(w) : info.studyable);
    const c = stateCounts(ws);
    const pct = ws.length ? Math.round(100 * c.memorized / ws.length) : 0;
    const t = plan.testInfo(list);
    const td = arch ? null : plan.today(n);
    const status = arch ? 'Archived — words are paused' : !all.length ? 'No words yet — tap to add some' : td.newLeft || td.due ? `${plural(td.newLeft, 'new word')} + ${td.due} due today` : '✓ Done for today';
    return `<a class="ltile${arch ? ' archived' : ''}" href="#${esc(ui.listHash(n))}"${arch ? ' title="Archived list"' : ''}>
      <div class="row" style="flex-wrap:nowrap"><span class="lname">${esc(n)}</span><span class="spacer"></span>${arch ? '<span class="chip">🗄️ Archived</span>' : t && t.upcoming ? `<span class="chip ${t.d <= 3 ? 'learning' : ''}">📝 ${testText(t)}</span>` : ''}</div>
      <div class="muted small">${plural(all.length, 'word')} · ${plural(list.units.length, 'unit')}</div>
      <div class="row" style="align-items:baseline;gap:6px"><span class="lpct">${pct}%</span><span class="muted small">memorized</span></div>
      ${stackedBar(c, '')}
      <div class="lstatus">${status}</div>
    </a>`;
  },
  listCard(n) {
    const list = db.lists[n];
    const ws = plan.listWords(n).filter(info.studyable);
    const c = stateCounts(ws);
    const t = plan.testInfo(list);
    const ready = plan.readiness(n);
    return `<div class="card">
      <div class="row"><b style="font-size:18px">${esc(n)}</b><span class="muted small">${plural(ws.length, 'word')} · ${plural(list.units.length, 'unit')}</span><span class="spacer"></span>
        <button class="btn sm ghost" data-act="editTest" data-list="${esc(n)}">📅 ${list.testDate ? 'Test date' : 'Set test date'}</button>
        <button class="btn sm ghost" data-act="addToList" data-list="${esc(n)}">＋ Words</button></div>
      <div style="margin-top:10px">${stackedBar(c, '')}</div>
      ${t && t.upcoming ? `<div class="row small" style="margin-top:12px"><b>${testText(t)}</b><span class="muted">${fmtDay(list.testDate)}</span><span class="spacer"></span><b class="${ready >= 0.8 ? 'ok' : ''}">${Math.round(ready * 100)}% ready</b></div>
        <div style="margin-top:6px" title="Average predicted chance of remembering each word on test day">${pctBar(ready, '', 'var(--good)')}</div>` : ''}
      ${ui.unitTrack(n)}
      ${plan.warnings(n).map(w => `<div class="warnbox">${esc(w)}</div>`).join('')}
    </div>`;
  },
  unitTrack(n) {
    const list = db.lists[n];
    if (list.units.length < 2) return '';
    const cur = units.currentUnit(list);
    return `<div class="units">${list.units.map((u, i) => {
      const locked = i >= list.unlocked; const p = units.progress(list, i);
      return `<div class="unit ${locked ? 'locked' : ''} ${i === cur && !locked ? 'cur' : ''}"><b>${locked ? '🔒 ' : p >= 0.999 ? '✓ ' : ''}Unit ${i + 1}</b><span class="muted">${Math.round(p * 100)}% · ${u.length} words</span>${pctBar(p, 'thin', 'var(--st-memorized)')}</div>`;
    }).join('')}</div>
    ${list.unlocked < list.units.length ? `<div style="margin-top:8px"><button class="btn sm ghost" data-act="unlockNext" data-list="${esc(n)}">🔓 Unlock Unit ${list.unlocked + 1} now</button></div>` : ''}`;
  },
  wordRowsHtml() {
    const f = ui.wf;
    const q = f.q.trim().toLowerCase();
    const ln = w => f.list || w.list, un = w => w.lists[ln(w)] ?? 0;
    const ws = Object.values(db.words).filter(w => inList(w, f.list) && (f.unit === '' || String(un(w)) === f.unit) &&
      (!f.state || info.state(w) === f.state) && (!q || w.word.includes(q) || info.def(w).toLowerCase().includes(q)))
      .sort((a, b) => ln(a).localeCompare(ln(b)) || un(a) - un(b) || a.word.localeCompare(b.word));
    if (!ws.length) return `<div class="empty muted">No words match.</div>`;
    return `<div class="small muted" style="padding:8px 4px">${plural(ws.length, 'word')}</div>` + ws.map(w => {
      const st = info.state(w); const def = info.def(w);
      return `<div class="wl-row" data-act="openWord" data-w="${esc(w.word)}">
        <div><div class="w">${esc(w.word)}</div><div class="small muted">${ui.whereHtml(w, f.list)}</div></div>
        <div class="d">${def ? esc(def) : '<span class="err">No definition — click to add one</span>'}</div>
        <span class="chip ${st}">${STATE_LABEL[st]}</span>
        <div class="bar thin" title="${w.mem.reps ? `Chance of remembering now: ${Math.round(model.pNow(w) * 100)}% · remembers ${stabilityText(w.mem.S)}` : 'Not studied yet'}"><span style="width:${Math.round(info.progress(w) * 100)}%;background:var(--st-${st})"></span></div>
      </div>`;
    }).join('');
  },
  addProgressHtml() {
    const job = ui.addJob;
    if (!job) return '';
    const ws = job.keys.map(k => db.words[k]).filter(Boolean);
    const dictDone = ws.filter(w => w.dictStatus !== 'pending').length;
    const genTargets = ws.filter(w => w.genStatus !== 'none' || job.genRunning);
    const genDone = ws.filter(w => ['ok', 'partial', 'error'].includes(w.genStatus)).length;
    const st = w => {
      const d = { pending: '<span class="wait">looking up…</span>', ok: '<span class="ok">✓ found</span>', custom: '<span class="ok">✓ your definition</span>', notfound: '<span class="err">✗ not in dictionary</span>', error: '<span class="err">✗ lookup failed</span>' }[w.dictStatus] || '';
      const g = { none: '', working: '<span class="wait">writing questions…</span>', ok: '<span class="ok">✓ questions ready</span>', partial: '<span class="ok">✓ some questions</span>', error: `<span class="err" title="${esc(w.genError)}">✗ question writing failed</span>` }[w.genStatus] || '';
      const needDef = !info.def(w) && ['notfound', 'error'].includes(w.dictStatus);
      const others = Object.keys(w.lists).filter(n => n !== job.list);
      if (job.shared?.includes(w.word)) return `<div class="ap-row"><span class="w">${esc(w.word)}</span><span class="ok">✓ shared with ${esc(others.join(', '))}</span> <span class="muted small">${STATE_LABEL[info.state(w)]}</span></div>`;
      return `<div class="ap-row"><span class="w">${esc(w.word)}</span>${d} ${g}
        ${needDef ? `<span class="spacer"></span><input type="text" style="max-width:260px" id="md_${esc(w.word)}" placeholder="Type a definition"><button class="btn sm" data-act="saveManualDef" data-w="${esc(w.word)}">Save</button>` : ''}</div>`;
    };
    return `<div class="card"><div class="row"><b>Adding ${plural(ws.length, 'word')} to “${esc(job.list)}”</b><span class="spacer"></span>
        <span class="small muted">${[job.shared?.length ? `${job.shared.length} shared from other lists` : '', job.skipped.length ? `${job.skipped.length} already in this list, skipped` : ''].filter(Boolean).join(' · ')}</span></div>
      <div style="margin:10px 0 4px" class="small muted">Dictionary ${dictDone}/${ws.length}</div>${pctBar(dictDone / Math.max(1, ws.length))}
      ${genTargets.length ? `<div style="margin:10px 0 4px" class="small muted">Questions ${genDone}/${ws.length}</div>${pctBar(genDone / Math.max(1, ws.length), '', 'var(--good)')}` : ''}
      <div style="margin-top:10px">${ws.map(st).join('')}</div>
      ${job.done && db.lists[job.list] ? `<div class="row" style="margin-top:14px"><button class="btn primary" data-act="go" data-to="${esc(ui.listHash(job.list))}/learn">Start learning</button><button class="btn" data-act="go" data-to="${esc(ui.listHash(job.list))}">Open “${esc(job.list)}”</button></div>` : ''}</div>`;
  },
  refreshAdd() { if (ui.route === 'add' && $('#addProgress')) $('#addProgress').innerHTML = ui.addProgressHtml(); },
  updateAddPreview() {
    const el = $('#addPreview'); if (!el) return;
    const items = parseInput($('#addText').value);
    const name = $('#addList').value.trim() || 'My words';
    const fresh = items.filter(p => !db.words[p.word]);
    const inThis = items.filter(p => db.words[p.word] && db.lists[name] && inList(db.words[p.word], name));
    const shared = items.filter(p => db.words[p.word] && !inThis.includes(p));
    const adding = [...fresh, ...shared];
    if (!items.length) { el.textContent = ''; return; }
    const test = $('#addTest').value;
    let msg = `${plural(fresh.length, 'new word')}`;
    if (shared.length) msg += ` + ${shared.length} from your other lists (their progress is shared)`;
    if (inThis.length) msg += ` (${inThis.length} already in this list)`;
    if (db.lists[name]) { if (adding.length) msg += ` → added to “${name}”`; }
    else if (adding.length) {
      units._pendingTest = test;
      const size = units.defaultSize('\u0000preview', adding.length);
      units._pendingTest = '';
      const parts = units.split(adding.map(p => p.word), size).map(u => u.length);
      msg += ` → ${parts.length === 1 ? '1 unit' : `${parts.length} units of ${uniq(parts).join('–')}`}`;
      if (test && daysUntil(test) >= 0) {
        const d = daysUntil(test);
        const per = Math.max(db.settings.newPerDay, Math.ceil(adding.length / Math.max(1, d - 2)));
        msg += ` · ${per} new words a day, all learned ${Math.ceil(adding.length / per) <= 1 ? 'today' : `in ${Math.ceil(fresh.length / per)} days`}, then reviews until the test`;
        if (per > 25) msg += ' ⚠️ that is a heavy load';
      }
    }
    el.textContent = msg;
  },

  openWord(key) {
    const w = db.words[key]; if (!w) return;
    ui.modalWord = key;
    const senses = info.senses(w);
    const m = w.mem, g = w.gen;
    const due = plan.dueAt(w);
    $('#modal').innerHTML = `<div class="modal-back" data-act="closeModalBack"><div class="modal">
      <button class="iconbtn close" data-act="closeModal" aria-label="Close">✕</button>
      ${runner.wordHead(w)}
      <div class="row" style="margin-top:6px"><span class="chip ${info.state(w)}">${STATE_LABEL[info.state(w)]}</span>${ui.listChipsHtml(w)}</div>
      <div style="margin-top:10px">${info.def(w) ? runner.wordFacts(w) : '<span class="err">No definition yet.</span>'}</div>
      <label class="field" style="margin-top:16px"><span>Your own definition (optional, overrides the others)</span>
        <div class="row" style="flex-wrap:nowrap"><input type="text" id="customDef" value="${esc(w.customDef)}"><button class="btn sm" data-act="saveCustomDef" data-w="${esc(key)}">Save</button></div></label>
      ${senses.length ? `<details ${w.primary.manual ? 'open' : ''}><summary>Dictionary meanings (${senses.length}) — choose the one to study</summary>
        ${senses.map(s => `<div class="sense ${s.m === w.primary.m && s.d === w.primary.d ? 'on' : ''}" data-act="setPrimary" data-w="${esc(key)}" data-m="${s.m}" data-d="${s.d}">
          <span class="chip">${esc(s.pos)}</span><div>${esc(s.def)}${s.example ? `<div class="ex small">“${esc(s.example)}”</div>` : ''}</div></div>`).join('')}</details>` : ''}
      <details><summary>Practice sentences ${g ? '' : '(none yet)'}</summary>
        ${g ? `<div class="small"><b>Fill in the blank</b><ul class="tight">${g.blank_sentences.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
          <b>Correct usage</b><ul class="tight">${g.correct_usages.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
          <b>Incorrect usage</b><ul class="tight">${g.incorrect_usages.map(s => `<li>${esc(s.sentence)} <span class="muted">— ${esc(s.why)}</span></li>`).join('')}</ul></div>`
          : `<p class="small muted">${gen.hasKey() ? 'Click Regenerate to write them.' : 'Set up AI in Settings to generate them.'}</p>`}
        ${gen.hasKey() ? `<button class="btn sm" data-act="regen" data-w="${esc(key)}">${g ? 'Regenerate' : 'Generate'}</button>` : ''}
      </details>
      <details><summary>Memory stats</summary>
        ${m.reps ? `<div class="kv"><div>Remembers<b>${stabilityText(m.S)}</b></div><div>Recall now<b>${Math.round(model.pNow(w) * 100)}%</b></div>
          <div>Difficulty<b>${m.D.toFixed(1)}/10</b></div><div>Next review<b>${due === Infinity ? '—' : due < clock.now() ? 'now' : fmtDay(dayKey(due))}</b></div></div>
          <p class="small muted">${plural(m.reps, 'answer')} · ${plural(m.lapses, 'lapse')} · recalled on ${plural(m.successDays.length, 'separate day')}</p>
          <div class="small muted">Recent: ${m.history.slice(-12).map(h => `<span title="${TYPE_LABEL[h.type]}">${h.g === 1 ? '✗' : '✓'}</span>`).join(' ')}</div>`
          : '<p class="small muted">Not studied yet.</p>'}
      </details>
      <div class="row" style="margin-top:16px">${info.studyable(w) ? `<button class="btn sm" data-act="markKnown" data-w="${esc(key)}" ${known.markedToday(w) ? 'disabled title="Already marked today — come back tomorrow"' : 'title="Counts as a good review: the word gets stronger and its next review moves later"'}>✓ I know this word</button>` : ''}<button class="btn sm" data-act="resetWord" data-w="${esc(key)}">Reset progress</button><button class="btn sm danger" data-act="deleteWord" data-w="${esc(key)}">${Object.keys(w.lists).length > 1 ? 'Delete from all lists' : 'Delete word'}</button></div>
    </div></div>`;
    askai.sync();
  },
  // "SAT · Unit 2, also in TOEFL" — the filtered list first.
  whereHtml(w, first = '') {
    const names = Object.keys(w.lists).sort((a, b) => (b === first) - (a === first));
    if (!names.length) return '';
    const head = `${esc(names[0])} · Unit ${w.lists[names[0]] + 1}`;
    return names.length > 1 ? `${head} <span class="chip" title="${esc(names.slice(1).join(', '))}">also in ${esc(names.slice(1).join(', '))}</span>` : head;
  },
  // The word's lists, each removable while it is in more than one, plus a picker to add it to another.
  listChipsHtml(w) {
    const names = Object.keys(w.lists), multi = names.length > 1;
    const others = liveLists().filter(n => !inList(w, n));
    return names.map(n => `<span class="chip lchip">${esc(n)} · Unit ${w.lists[n] + 1}${multi ? `<button class="x" data-act="removeFromList" data-w="${esc(w.word)}" data-list="${esc(n)}" title="Remove from “${esc(n)}” (progress is kept)" aria-label="Remove from ${esc(n)}">✕</button>` : ''}</span>`).join('')
      + (others.length ? `<select id="alsoAdd" data-w="${esc(w.word)}" style="width:auto;padding:2px 8px;font-size:12px"><option value="">＋ Add to another list…</option>${others.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>` : '')
      + (multi ? `<div class="small muted" style="flex-basis:100%">Shared word: studying it in any list counts for all of them.</div>` : '');
  },
  closeModal() { $('#modal').innerHTML = ''; ui.modalWord = ''; askai.sync(); },
  // Create a list (n empty) or edit one: name and test date.
  // The list's ⚙️ menu: edit, export, archive and delete in one place.
  listMenuHtml(n) {
    const l = db.lists[n], d = `data-list="${esc(n)}" role="menuitem"`;
    return `<div class="menu-wrap"><button class="btn sm ghost" data-act="toggleMenu" aria-haspopup="menu" aria-expanded="false">⚙️ Edit ▾</button>
      <div class="menu" role="menu" hidden>
        <button data-act="editList" ${d}>✏️ Edit list</button>
        <button data-act="exportList" ${d} title="Save this list as a .atw file">📤 Export (.atw)</button>
        <button data-act="${l.archived ? 'unarchiveList' : 'archiveList'}" ${d}>🗄️ ${l.archived ? 'Unarchive' : 'Archive'}</button>
        <button data-act="resetList" ${d}>↺ Reset progress</button>
        <button class="danger" data-act="deleteList" ${d}>🗑️ Delete list</button>
      </div></div>`;
  },
  closeMenus(except = null) {
    document.querySelectorAll('.menu-wrap').forEach(w => {
      if (w === except) return;
      w.querySelector('.menu').hidden = true; w.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
    });
  },
  // Sends every word in the list back to New. A word has one progress record however many lists it is in,
  // so words shared with other lists reset there too, and the dialog says so.
  resetListModal(n) {
    const ws = uniq(db.lists[n].units.flat()).map(k => db.words[k]).filter(Boolean);
    const studied = ws.filter(w => w.mem.reps), shared = studied.filter(w => Object.keys(w.lists).length > 1).length;
    if (!studied.length) { toast('Nothing to reset: no words in this list have been studied yet'); return; }
    $('#modal').innerHTML = `<div class="modal-back" data-act="closeModalBack"><div class="modal" style="max-width:460px">
      <button class="iconbtn close" data-act="closeModal" aria-label="Close">✕</button>
      <h2 style="margin-top:0">Reset progress for “${esc(n)}”?</h2>
      <p>${plural(studied.length, 'studied word')} go${studied.length === 1 ? 'es' : ''} back to New, and the units lock again from Unit 1. Meanings and practice questions are kept.</p>
      ${shared ? `<p><b>${shared} of these words ${shared === 1 ? 'is' : 'are'} also in other lists</b>, so ${shared === 1 ? 'its' : 'their'} progress resets there too.</p>` : ''}
      <p class="small muted">Want a copy first? <b>Export</b> saves the list with its progress.</p>
      <div class="row" style="margin-top:14px"><button class="btn danger-solid" data-act="resetListConfirm" data-list="${esc(n)}">Reset progress</button>
        <button class="btn" data-act="exportList" data-list="${esc(n)}">Export first</button><span class="spacer"></span><button class="btn ghost" data-act="closeModal">Cancel</button></div>
    </div></div>`;
    $('#modal .btn.ghost').focus();
  },
  // Deleting takes two steps: what will be lost (with safer options), then a final "can't be undone".
  deleteListModal(n, step = 1) {
    const keys = uniq(db.lists[n].units.flat()).filter(k => db.words[k]);
    const shared = keys.filter(k => Object.keys(db.words[k].lists).length > 1).length;
    const body = step === 1
      ? `<h2 style="margin-top:0">Delete “${esc(n)}”?</h2>
        <p>${keys.length - shared ? `This deletes the list, plus ${plural(keys.length - shared, 'word')} and ${keys.length - shared === 1 ? 'its' : 'their'} progress.` : 'This deletes the list.'}${shared ? ` ${shared === keys.length ? 'Its words are' : `${plural(shared, 'word')} ${shared === 1 ? 'is' : 'are'}`} also in other lists and will be kept there.` : ''}</p>
        <p class="small muted">Might you want it later? <b>Archive</b> pauses it and keeps everything, and <b>Export</b> saves a copy as a file.</p>
        <div class="row" style="margin-top:14px"><button class="btn danger" data-act="deleteListNext" data-list="${esc(n)}">Delete list…</button>
          <button class="btn" data-act="archiveList" data-list="${esc(n)}">Archive instead</button><span class="spacer"></span><button class="btn ghost" data-act="closeModal">Cancel</button></div>`
      : `<h2 style="margin-top:0">Are you sure?</h2>
        <p>“${esc(n)}” and its progress will be gone for good. <b>This can't be undone.</b></p>
        <div class="row" style="margin-top:14px"><button class="btn danger-solid" data-act="deleteListConfirm" data-list="${esc(n)}">Yes, delete forever</button>
          <span class="spacer"></span><button class="btn ghost" data-act="closeModal">Cancel</button></div>`;
    $('#modal').innerHTML = `<div class="modal-back" data-act="closeModalBack"><div class="modal" style="max-width:460px">
      <button class="iconbtn close" data-act="closeModal" aria-label="Close">✕</button>${body}</div></div>`;
    // Focus lands on Cancel, so a stray Enter doesn't delete anything.
    [...document.querySelectorAll('#modal .btn.ghost')].at(-1)?.focus();
  },
  listModal(n = '') {
    const list = n ? db.lists[n] : null;
    $('#modal').innerHTML = `<div class="modal-back" data-act="closeModalBack"><div class="modal" style="max-width:440px">
      <button class="iconbtn close" data-act="closeModal" aria-label="Close">✕</button>
      <h2 style="margin-top:0">${list ? 'Edit list' : 'New word list'}</h2>
      <label class="field"><span>List name</span><input type="text" id="listNameInput" maxlength="60" value="${esc(n)}" placeholder="e.g. Lit Midterm, Unit 3 vocab"></label>
      <label class="field"><span>Test date (optional)</span><input type="date" id="testDateInput" value="${esc(list?.testDate || '')}" min="${todayKey()}"></label>
      <p class="small muted">With a test date, the app spreads new words out so they're all learned before the test, adds extra reviews in the final week, and makes sure every word is reviewed the day before.</p>
      <div class="row" style="margin-top:14px">
        <button class="btn primary" data-act="saveList" data-list="${esc(n)}" data-enter="1">${list ? 'Save' : 'Create list'}</button>
        ${list?.testDate ? `<button class="btn" data-act="clearTest" data-list="${esc(n)}">Remove test date</button>` : ''}</div>
      ${list ? '' : `<div class="modal-alt"><span class="muted small">Got a list file from another device or a classmate?</span>
        <button class="btn sm" data-act="importList" title="Open a .atw list file">📥 Import a list (.atw)</button></div>`}
    </div></div>`;
    setTimeout(() => { const i = $('#listNameInput'); if (i && !n) i.focus(); }, 0);
  },
  saveList(old) {
    const name = $('#listNameInput').value.trim().replace(/\s+/g, ' ');
    const test = $('#testDateInput').value;
    if (!name) { toast('Give the list a name'); return; }
    if (name !== old && db.lists[name]) { toast(`There is already a list called “${name}”`, 'bad'); return; }
    if (!old) {
      units.create(name, [], test);
      store.save(); ui.closeModal(); ui.go(ui.listHash(name));
      toast(`Created “${name}”`, 'good');
      return;
    }
    db.lists[old].testDate = test;
    if (name !== old) {
      // Rebuild the object so the list keeps its place in the order.
      db.lists = Object.fromEntries(Object.entries(db.lists).map(([k, v]) => (k === old ? [name, { ...v, name }] : [k, v])));
      units.reindex(name);
      for (const f of [ui.wf, ui.drill]) if (f.list === old) f.list = name;
    }
    store.save(); ui.closeModal();
    if (name !== old && ui.scope === old) location.hash = ui.listHash(name) + (ui.route === 'list' ? '' : '/' + ui.route);
    else ui.render();
  },

  async runLookups(ws) {
    await pool(ws, 3, async w => {
      try { const d = await dict.lookup(w.word); w.data = d; if (d && !w.primary.manual) w.primary = info.bestSense(w); w.dictStatus = d ? (w.customDef ? 'custom' : 'ok') : (w.customDef ? 'custom' : 'notfound'); }
      catch { w.dictStatus = w.customDef ? 'custom' : 'error'; }
      store.save(); ui.refreshAdd();
    });
  },
  // Writes questions for many words, showing progress next to the Settings buttons. Returns how many came back complete.
  async bulkGen(ws) {
    const status = () => { const st = $('#keyStatus'); if (st) st.textContent = `Writing questions… ${ws.filter(w => ['ok', 'partial', 'error'].includes(w.genStatus)).length}/${ws.length}`; };
    ws.forEach(w => { w.genStatus = 'none'; });
    status();
    ui.refreshAdd = status;
    try { await ui.runGen(ws); } finally { ui.refreshAdd = ui._refreshAdd; }
    store.save();
    return ws.filter(w => w.gen?.complete && w.genStatus !== 'error').length;
  },
  async runGen(ws) {
    if (!gen.hasKey() || !ws.length) return;
    let fatal = null;
    await pool(ws, 2, async w => {
      if (fatal) return;
      w.genStatus = 'working'; ui.refreshAdd();
      try { await gen.generate(w); }
      catch (e) {
        w.genStatus = 'error'; w.genError = e.message;
        if ([401, 402, 403].includes(e.status)) fatal = e;
      }
      store.save(); ui.refreshAdd();
    });
    for (const w of ws) if (w.genStatus === 'working') w.genStatus = 'none';
    if (fatal) { api.lastToast = 0; toast(`${gen.provider().name}: ${api.explain(fatal.status)} Stopped writing questions.`, 'bad'); }
  },
  async addSubmit() {
    const items = parseInput($('#addText').value);
    if (!items.length) { toast('Type or paste some words first'); return; }
    const name = $('#addList').value.trim() || 'My words';
    const test = $('#addTest').value;
    // A word already in another list is shared into this one (same progress); one already in this list is skipped.
    let fresh = [], shared = [], skipped = [];
    for (const p of items) {
      const cur = db.words[p.word];
      if (cur) { (db.lists[name] && inList(cur, name) ? skipped : shared).push(p.word); continue; }
      const w = newWord(p.word, name);
      if (p.def) { w.customDef = p.def; }
      db.words[p.word] = w; fresh.push(w);
    }
    if (!fresh.length && !shared.length) { toast(`All of these words are already in “${name}”`); return; }
    let keys = [...fresh.map(w => w.word), ...shared];
    if ($('#addShuffle').checked) keys = shuffle(keys);
    if (db.lists[name]) { units.append(name, keys); if (test) db.lists[name].testDate = test; }
    else units.create(name, keys, test);
    store.save();
    ui.addJob = { list: name, keys, skipped, shared, done: false, genRunning: false };
    $('#addText').value = ''; ui.updateAddPreview(); ui.refreshAdd();
    await ui.runLookups(fresh);
    ui.addJob.genRunning = gen.hasKey(); ui.refreshAdd();
    await ui.runGen(fresh.filter(w => info.def(w) || w.data));
    ui.addJob.done = true; ui.addJob.genRunning = false;
    store.save(); ui.refreshAdd();
    toast(`Added ${plural(keys.length, 'word')} to “${name}”`, 'good');
  },

  onClick(e) {
    const el = e.target.closest('[data-act]');
    // A click anywhere except the menu button closes open menus (picking an item closes them too).
    if (el?.dataset.act !== 'toggleMenu') ui.closeMenus();
    if (!el) return;
    const act = el.dataset.act;
    const fn = ui.actions[act];
    if (fn) { if (act === 'closeModalBack' && e.target !== el) return; e.preventDefault?.(); fn(el); }
  },
  actions: {
    go: el => { ui.addPrefill = ''; ui.go(el.dataset.to); },
    say: el => say(el.dataset.w),
    startLearn: el => modes.learn(el.dataset.list, !!el.dataset.extra),
    startPractice: el => modes.practice(!!el.dataset.extra, el.dataset.list || ''),
    startDrill: el => modes.drill(el.dataset.type, ui.drill.list, ui.drill.unit),
    startReviewDue: el => modes.reviewDue(el.dataset.list || ''),
    startTestPrep: el => modes.testPrep(el.dataset.list),
    startReviewAny: () => modes.reviewAny({ ...ui.rev, list: ui.scope }),
    ans: el => runner.answer(Number(el.dataset.i)),
    flip: () => runner.flip(),
    rate: el => runner.rate(Number(el.dataset.g)),
    introNext: () => runner.introNext(),
    cont: () => runner.next(),
    sessExit: () => runner.exit(),
    sessPrev: () => runner.prev(),
    sessFwd: () => runner.fwd(),
    sessResume: () => runner.resume(),
    sessAgain: () => { const again = runner.s?.again; runner.exit(); again?.(); },
    openWord: el => ui.openWord(el.dataset.w),
    closeModal: el => { ui.closeModal(); if (el.tagName === 'A') location.hash = el.getAttribute('href'); },
    closeModalBack: () => ui.closeModal(),
    askToggle: el => { askai.toggle(); if (el.tagName === 'A') location.hash = el.getAttribute('href'); },
    askClear: () => { askai.msgs = []; askai.render(); },
    askChip: el => { const c = askai.chips(askai.word())[Number(el.dataset.i)]; if (c) askai.send(c.ask, c.label); },
    askSend: () => askai.submit($('#askInput')?.value),
    setPrimary: el => {
      const w = db.words[el.dataset.w];
      w.primary = { m: Number(el.dataset.m), d: Number(el.dataset.d), manual: true };
      store.save(); ui.openWord(w.word);
      if (w.gen && gen.hasKey()) toast('Meaning changed — click Regenerate to update the practice sentences');
    },
    saveCustomDef: el => {
      const w = db.words[el.dataset.w];
      w.customDef = $('#customDef').value.trim();
      store.save(); ui.openWord(w.word); ui.render();
      toast('Saved', 'good');
      if (w.gen && gen.hasKey()) toast('Click Regenerate to update the practice sentences');
    },
    regen: async el => {
      const w = db.words[el.dataset.w];
      el.disabled = true; el.textContent = 'Writing…';
      try { await gen.generate(w); store.save(); toast('Practice sentences updated', 'good'); }
      catch { /* the API log shows the error */ }
      if ($('#modal').innerHTML) ui.openWord(w.word);
    },
    markKnown: el => { if (known.mark(db.words[el.dataset.w])) { ui.openWord(el.dataset.w); ui.render(); } },
    introKnown: () => runner.introKnown(),
    resetWord: el => {
      if (!confirm('Reset all progress for this word?')) return;
      db.words[el.dataset.w].mem = newMem(); store.save(); ui.openWord(el.dataset.w); ui.render();
    },
    deleteWord: el => {
      const k = el.dataset.w, w = db.words[k];
      const names = Object.keys(w.lists);
      if (!confirm(names.length > 1 ? `Delete “${k}” from all ${names.length} lists (${names.join(', ')}) and lose its progress?` : `Delete “${k}”?`)) return;
      // An emptied list is kept so its dashboard stays; delete it from Edit list.
      for (const n of names) units.removeFrom(n, k);
      delete db.words[k]; units.reindex(); store.save(); ui.closeModal(); ui.render();
    },
    removeFromList: el => {
      const k = el.dataset.w, n = el.dataset.list;
      if (Object.keys(db.words[k].lists).length < 2) return;
      units.removeFrom(n, k); units.reindex(); store.save(); ui.openWord(k); ui.render();
      toast(`Removed “${k}” from “${n}”`);
    },
    editTest: el => ui.listModal(el.dataset.list),
    editList: el => ui.listModal(el.dataset.list),
    newList: () => ui.listModal(''),
    saveList: el => ui.saveList(el.dataset.list),
    listWords: el => { ui.wf = { q: '', list: el.dataset.list, unit: '', state: '' }; ui.go('words'); },
    clearTest: el => { db.lists[el.dataset.list].testDate = ''; store.save(); ui.closeModal(); ui.render(); },
    archiveList: el => {
      const n = el.dataset.list;
      db.lists[n].archived = true;
      for (const f of [ui.wf, ui.drill]) if (f.list === n) { f.list = ''; f.unit = ''; }
      store.save(); ui.closeModal();
      if (ui.scope === n) ui.go('home'); else ui.render();
      toast(`Archived “${n}”. Its words are paused until you unarchive it.`);
    },
    unarchiveList: el => {
      const n = el.dataset.list;
      delete db.lists[n].archived;
      store.save(); ui.closeModal(); ui.render();
      toast(`“${n}” is back`, 'good');
    },
    toggleMenu: el => {
      const wrap = el.closest('.menu-wrap'), menu = wrap.querySelector('.menu');
      ui.closeMenus(wrap);
      menu.hidden = !menu.hidden; el.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button')?.focus();
    },
    resetList: el => ui.resetListModal(el.dataset.list),
    resetListConfirm: el => {
      const n = el.dataset.list, l = db.lists[n]; if (!l) return;
      const keys = uniq(l.units.flat()).filter(k => db.words[k]);
      for (const k of keys) db.words[k].mem = newMem();
      l.unlocked = 1; l.newLog = null;
      store.save(); ui.closeModal(); ui.render();
      toast(`Progress reset for “${n}”`, 'good');
    },
    deleteList: el => ui.deleteListModal(el.dataset.list, 1),
    deleteListNext: el => ui.deleteListModal(el.dataset.list, 2),
    deleteListConfirm: el => {
      const n = el.dataset.list;
      if (!db.lists[n]) return;
      const keys = db.lists[n].units.flat();
      for (const k of keys) if (Object.keys(db.words[k]?.lists || {}).length <= 1) delete db.words[k];
      delete db.lists[n];
      units.reindex();
      for (const f of [ui.wf, ui.drill]) if (f.list === n) { f.list = ''; f.unit = ''; }
      store.save(); ui.closeModal();
      if (ui.scope === n) ui.go('home'); else ui.render();
      toast(`Deleted “${n}”`);
    },
    unlockNext: el => { const l = db.lists[el.dataset.list]; if (l.unlocked < l.units.length) l.unlocked++; store.save(); ui.render(); toast(`Unit ${l.unlocked} unlocked`, 'good'); },
    addToList: el => { ui.addPrefill = el.dataset.list; ui.go('add'); },
    addSubmit: () => ui.addSubmit(),
    readPhoto: () => ui.readPhoto(),
    recommendedSettings: () => {
      const { provider, deepseekKey, bridgeToken, model, ...rec } = DEFAULT_SETTINGS;
      Object.assign(db.settings, rec); store.save(); ui.render(); toast('Recommended settings applied', 'good');
    },
    copyPrompt: async el => {
      const ta = $('#otherAiPrompt');
      try { await navigator.clipboard.writeText(ta.value); }
      catch { ta.select(); document.execCommand('copy'); }
      el.textContent = '✓ Copied'; setTimeout(() => { el.textContent = 'Copy prompt'; }, 1800);
    },
    removePhoto: el => { ui.photos.splice(Number(el.dataset.i), 1); $('#photoThumbs').innerHTML = ui.thumbsHtml(); },
    apiPanel: () => ui.apiPanel(),
    reloadStale: () => location.reload(),
    apiTest: async el => { el.disabled = true; try { await gen.test(); } catch { /* logged */ } },
    apiRetry: async () => { const ws = Object.values(db.words).filter(w => w.genStatus === 'error'); await ui.runGen(ws); store.save(); api.paint(); },
    apiClear: () => { db.apiLog = []; store.save(); api.paint(); },
    saveManualDef: async el => {
      const w = db.words[el.dataset.w];
      const v = $('#md_' + CSS.escape(w.word))?.value.trim();
      if (!v) return;
      w.customDef = v; w.dictStatus = 'custom'; store.save(); ui.refreshAdd();
      await ui.runGen([w]); ui.refreshAdd();
    },
    retryLookups: async () => {
      const ws = Object.values(db.words).filter(w => w.dictStatus === 'error');
      if (!ws.length) { toast('No failed lookups'); return; }
      toast(`Retrying ${plural(ws.length, 'word')}…`);
      await ui.runLookups(ws); toast('Done', 'good');
    },
    copyBridgeCmd: async el => {
      const cmd = $('#bridgeCmd').textContent;
      try { await navigator.clipboard.writeText(cmd); el.textContent = '✓ Copied'; } catch { el.textContent = 'Select and copy it'; }
      setTimeout(() => { el.textContent = 'Copy'; }, 1800);
    },
    toggleKey: el => { const i = $('#keyInput'); i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? 'Show' : 'Hide'; },
    testKey: async () => {
      const st = $('#keyStatus');
      if (!gen.hasKey()) { st.textContent = gen.provider().cli ? 'Paste the bridge token first.' : 'Enter a key first.'; return; }
      st.textContent = 'Testing…';
      try { st.innerHTML = (await gen.test()) ? `<span class="ok">✓ ${gen.provider().cli ? 'Connected' : 'Key works'}</span>` : '<span class="err">Unexpected reply</span>'; }
      catch (e) { st.innerHTML = `<span class="err">✗ ${esc(api.explain(e.status, e.message))}</span> <span class="muted">${esc(e.message)}</span>`; }
    },
    genMissing: async () => {
      if (!gen.hasKey()) { toast('Set up AI in Settings first'); return; }
      const ws = Object.values(db.words).filter(w => info.def(w) && !w.gen?.complete);
      if (!ws.length) { toast('Every word already has practice sentences'); return; }
      const n = await ui.bulkGen(ws);
      $('#keyStatus') && ($('#keyStatus').textContent = `Done: ${n}/${ws.length} complete.`);
    },
    regenOutdated: async el => {
      if (!gen.hasKey()) { toast('Set up AI in Settings first'); return; }
      const ws = gen.outdated();
      if (!ws.length || !confirm(`Rewrite the questions for ${plural(ws.length, 'word')} with the newer, harder prompt?\n\nThis makes ${plural(ws.length, `${gen.provider().name} request`)}. Memory progress is kept, and a word keeps its old questions if its rewrite fails.`)) return;
      el.disabled = true;
      const n = await ui.bulkGen(ws);
      const failed = ws.filter(w => (w.genVer || 1) < gen.VERSION).length;
      toast(failed ? `Rewrote ${n}, ${failed} failed — press the button again to retry them` : `Rewrote questions for ${plural(n, 'word')}`, failed ? 'warn' : 'good');
      if (ui.route === 'settings') ui.render();
    },
    exportData: () => {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `acethewords-backup-${todayKey()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    importData: () => $('#importFile').click(),
    importList: () => $('#importList').click(),
    importListGo: () => ui.importListGo(),
    exportList: el => listfile.export(el.dataset.list),
    resetModel: () => {
      if (!confirm('Reset the answer-speed model to its starting weights? Saved answers are kept.')) return;
      db.model = null; db.rt = {}; rt.seed(); store.save(); ui.render(); toast('Speed model reset', 'good');
    },
    resetAll: () => {
      if (!confirm('Erase all words, lists and progress? This cannot be undone. (Export a backup first if unsure.)')) return;
      const { provider, deepseekKey, bridgeToken } = db.settings;
      db = store.blank(); Object.assign(db.settings, { provider, deepseekKey, bridgeToken }); store.save(); ui.go('home');
    },
  },
  // Shows what a .atw file holds and asks for a name and whether to keep its progress.
  onImportList(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    if (file.size > ATW.maxBytes) { toast('That file is too big to be a word list', 'bad'); return; }
    file.text().then(text => {
      const f = listfile.parse(text);
      const n = Object.keys(f.words).length, studied = Object.values(f.words).filter(w => w.mem.reps).length;
      const have = Object.keys(f.words).filter(k => db.words[k]).length;
      ui.pendingList = f;
      $('#modal').innerHTML = `<div class="modal-back" data-act="closeModalBack"><div class="modal" style="max-width:460px">
        <button class="iconbtn close" data-act="closeModal" aria-label="Close">✕</button>
        <h2 style="margin-top:0">Import word list</h2>
        <p class="muted">${plural(n, 'word')} in ${plural(f.units.length, 'unit')}${studied ? ` · ${studied} studied` : ''}${have ? ` · you already have ${have}` : ''}</p>
        <label class="field"><span>List name</span><input type="text" id="importListName" maxlength="60" value="${esc(listfile.freeName(f.name))}"></label>
        <label class="check"><input type="checkbox" id="importKeep" ${studied ? '' : 'disabled'}> Keep progress from the file</label>
        <p class="small muted">${studied ? 'Turn this on for your own list from another device. Leave it off for a list someone shared, so the words start fresh for you.' : 'Nobody has studied these words yet, so there is no progress to keep.'}${have ? ' Words you already have keep your progress' + (studied ? ', unless the file’s is more recent and you keep it.' : '.') : ''}</p>
        <div class="row" style="margin-top:14px"><button class="btn primary" data-act="importListGo" data-enter="1">Import</button></div>
      </div></div>`;
      $('#importListName').select();
    }).catch(err => toast(err.message, 'bad'));
  },
  importListGo() {
    const f = ui.pendingList; if (!f) return;
    const name = $('#importListName').value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('Give the list a name'); return; }
    if (Object.hasOwn(db.lists, name) || RESERVED_KEYS.has(name)) { toast(`There is already a list called “${name}”`, 'bad'); return; }
    const r = listfile.apply(f, name, $('#importKeep').checked);
    ui.pendingList = null; ui.closeModal(); ui.go(ui.listHash(name));
    toast(`Imported “${name}”: ${plural(r.added, 'new word')}${r.shared ? `, ${r.shared} you already had` : ''}`, 'good');
  },
  onImport(e) {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { const r = store.importJSON(t); toast(`Imported: ${r.added} new, ${r.updated} updated`, 'good'); ui.render(); })
      .catch(err => toast('Import failed: ' + err.message, 'bad'))
      .finally(() => { e.target.value = ''; });
  },
  onInput(e) {
    const t = e.target;
    if (t.id === 'askInput') { askai.draft = t.value; return; }
    if (t.dataset.wf === 'q') { ui.wf.q = t.value; $('#wordRows').innerHTML = ui.wordRowsHtml(); }
    if (['addText', 'addList', 'addTest'].includes(t.id)) ui.updateAddPreview();
    if (t.id === 'photoPrompt') ui.photoPrompt = t.value;
    if (t.dataset.set === 'retention') { const lab = t.closest('label').querySelector('span'); lab.textContent = `Target recall: ${Math.round(t.value * 100)}%`; }
  },
  onChange(e) {
    const t = e.target;
    if (t.id === 'alsoAdd' && t.value && db.words[t.dataset.w]) {
      const k = t.dataset.w, n = t.value;
      units.append(n, [k]); store.save(); ui.openWord(k); ui.render();
      toast(`Added “${k}” to “${n}” — its progress comes along`, 'good');
      return;
    }
    if (t.dataset.wf && t.dataset.wf !== 'q') {
      ui.wf[t.dataset.wf] = t.value;
      if (t.dataset.wf === 'list') ui.wf.unit = '';
      ui.render(); return;
    }
    if (t.dataset.scope) { ui.drill[t.dataset.scope] = t.value; if (t.dataset.scope === 'list') ui.drill.unit = ''; ui.render(); return; }
    if (t.dataset.rev) { ui.rev[t.dataset.rev] = t.value; return; }
    if (t.dataset.set) {
      const k = t.dataset.set;
      let v = t.type === 'checkbox' ? t.checked : t.value;
      if (SETTING_LIMITS[k]) { v = clamp(Math.round(Number(v) || DEFAULT_SETTINGS[k]), ...SETTING_LIMITS[k]); t.value = v; }
      if (k === 'retention') v = clamp(Number(v), 0.8, 0.95);
      if (k === 'deepseekKey' || k === 'bridgeToken' || k === 'model') v = String(v).trim();
      db.settings[k] = v; store.save();
      if (k === 'deepseekKey' || k === 'bridgeToken') toast(v ? `${k === 'bridgeToken' ? 'Token' : 'Key'} saved in this browser` : `${k === 'bridgeToken' ? 'Token' : 'Key'} removed`);
      if (k === 'provider') ui.render();
    }
    if (t.id === 'addShuffle') ui.updateAddPreview();
    if (t.id === 'photoMeanings') ui.photoMeanings = t.checked;
    if (t.id === 'photoInput') ui.addPhotos(t.files).then(() => { t.value = ''; });
    if (['provider', 'deepseekKey', 'bridgeToken', 'model'].includes(t.dataset.set)) api.paint();
  },
  stale() {
    if (store.stale) return;
    store.stale = true;
    // Everything behind the dialog stops taking focus and keys, so nothing can be answered while saving is off.
    document.querySelectorAll('body > :not(#stale)').forEach(el => { el.inert = true; });
    $('#stale').innerHTML = `<div class="modal-back" style="z-index:70"><div class="modal" style="max-width:440px">
      <h2 style="margin-top:0">AceTheWords is open somewhere else</h2>
      <p class="muted">It was just used in another tab or window. This tab has paused so it doesn't overwrite that progress.</p>
      <button class="btn primary" data-act="reloadStale">Use it here</button></div></div>`;
    $('#stale button').focus();
  },
  onKey(e) {
    if (store.stale) return;
    if (e.target.id === 'askInput') {
      if (e.key === 'Enter') { e.preventDefault(); askai.submit(e.target.value); } else if (e.key === 'Escape') askai.toggle();
      return;
    }
    if (e.target.matches?.('input, textarea, select')) {
      // Enter in a modal's text field presses its main button.
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const b = $('#modal [data-enter]'); if (b) { e.preventDefault(); b.click(); } }
      return;
    }
    if (e.key === 'Escape' && document.querySelector('.menu:not([hidden])')) { ui.closeMenus(); return; }
    if ($('#modal').innerHTML && e.key === 'Escape') { ui.closeModal(); return; }
    const s = runner.s;
    if (!s || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (s.view != null) {
      if (k === 'escape') runner.resume();
      else if (k === 'arrowleft' || k === 'backspace') { e.preventDefault(); runner.prev(); }
      else if (k === 'arrowright' || k === 'enter' || k === ' ') { e.preventDefault(); runner.fwd(); }
      return;
    }
    if (k === 'escape') { runner.exit(); return; }
    if (k === 'backspace') { e.preventDefault(); runner.prev(); return; }
    // With several choices, all four arrows move the highlight. With one action, ← goes back and → goes forward.
    const nav = [...document.querySelectorAll('#session [data-nav]')];
    const dir = { arrowdown: 1, arrowright: 1, arrowup: -1, arrowleft: -1 }[k];
    if (dir && nav.length > 1) { e.preventDefault(); runner.moveSel(dir, nav); return; }
    if (k === 'arrowleft') { e.preventDefault(); runner.prev(); return; }
    if (k === 'arrowright' && nav.length === 1) { e.preventDefault(); nav[0].click(); return; }
    if (k === 'enter' && s.sel >= 0 && nav[s.sel]) { e.preventDefault(); nav[s.sel].click(); return; }
    const c = s.cur;
    if (!c) { if (k === 'enter' || k === ' ') { e.preventDefault(); runner.exit(); } return; }
    if (c.q.kind === 'intro' && (k === ' ' || k === 'enter')) { e.preventDefault(); runner.introNext(); return; }
    if (c.q.kind === 'intro' && k === 'k') { runner.introKnown(); return; }
    if (c.q.kind === 'card') {
      if (!c.flipped && (k === ' ' || k === 'enter')) { e.preventDefault(); runner.flip(); return; }
      if (c.flipped && '1234'.includes(k) && k.length === 1) { runner.rate(Number(k)); return; }
      return;
    }
    if (c.answered) { if (k === ' ' || k === 'enter') { e.preventDefault(); runner.next(); } return; }
    if (c.q.kind === 'usage') { const m = { a: 0, b: 1, 1: 0, 2: 1 }; if (k in m) runner.answer(m[k]); return; }
    if ('1234'.includes(k) && k.length === 1) runner.answer(Number(k) - 1);
  },
};
ui._refreshAdd = ui.refreshAdd;

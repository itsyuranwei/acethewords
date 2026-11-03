'use strict';

/* ============================== prompt for other AIs ============================== */
// For users who photograph the list with a different AI; its output matches what the word box accepts.
function otherAiPrompt() {
  return `I'm attaching a photo of an English vocabulary list for a Grade ${db.settings.grade} student. Please turn it into a word list I can paste into a flashcard app.

Rules:
1. Find every vocabulary word or phrase the student has to learn. Ignore headings, page numbers, instructions and example sentences unless they are the vocabulary items themselves.
2. Write each word in its dictionary form, lowercase (unless it is a proper noun). Keep multi-word phrases together, e.g. "look forward to".
3. If the photo gives a meaning, definition or translation for a word, copy it, shortened to at most 20 simple words. Do not invent meanings: if the photo has none, write the word alone.
4. If a word is hard to read, give your best guess and list it under "Unsure" after the code block.

Output format: put the list inside one code block, one word per line, exactly like this:
word : meaning
word

Example:
\`\`\`
reluctant : not wanting to do something
generous : happy to give and share
look forward to : to feel happy about something that will happen
fragile
\`\`\`

Do not number the lines and do not add anything else inside the code block.`;
}

/* ============================== images ============================== */
// Downscales a photo to at most 1600px and re-encodes it as JPEG to keep uploads small.
async function shrinkImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`Could not open “${file.name}”. Try a JPG or PNG photo.`));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

/* ============================== input parsing ============================== */
function parseInput(raw) {
  const text = raw.trim();
  if (!text) return [];
  const multi = /[\n,;\t]/.test(text);
  const clean = s => s.toLowerCase().replace(/[‘’]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '').replace(/\s+/g, ' ');
  const out = [], seen = new Set();
  for (let line of text.split(/\r?\n/)) {
    line = line.trim().replace(/^(\d+[.)]|[-*•])\s*/, '');
    if (!line) continue;
    const colon = line.match(/^([^:=]+?)\s*[:=]\s*(.+)$/);
    const parts = colon ? [[colon[1], colon[2].trim()]] : (multi ? line.split(/[,;\t]+/) : line.split(/\s+/)).map(p => [p, '']);
    for (const [p, def] of parts) {
      const w = clean(p);
      if (w && w.length < 40 && !seen.has(w)) { seen.add(w); out.push({ word: w, def }); }
    }
  }
  return out;
}

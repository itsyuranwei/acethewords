// Checks that the site still works before it goes live on GitHub Pages.
//
//   1. Every JavaScript file parses (a syntax error would blank the whole app).
//   2. Every local file the HTML pages link to exists (catches renames/typos).
//   3. The app opens in a headless browser, both from a web server (like GitHub
//      Pages) and straight from disk (like a downloaded copy), and every page in
//      the menu renders without a JavaScript error.
//
// Outside services (fonts, GitHub star count, dictionary, AI) are blocked so the
// result depends only on this repo's code.
//
// Run locally (installs the browser tools outside the repo, in ~/.cache/acethewords-check):
//   npm install --prefix ~/.cache/acethewords-check playwright@1.56.1
//   ~/.cache/acethewords-check/node_modules/.bin/playwright install chromium
//   PLAYWRIGHT_FROM=~/.cache/acethewords-check node .github/scripts/check-site.mjs

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);

// ---------- 1. JavaScript syntax ----------
console.log('JavaScript syntax');
const scripts = [
  ...readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
  ...readdirSync(path.join(root, 'bridge')).filter((f) => /\.m?js$/.test(f)).map((f) => `bridge/${f}`),
];
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
    pass(file);
  } catch (err) {
    fail(`${file} has a syntax error:\n${String(err.stderr).trim()}`);
  }
}

// ---------- 2. Local links in the HTML pages ----------
console.log('Local files referenced by the pages');
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
for (const page of pages) {
  const html = readFileSync(path.join(root, page), 'utf8');
  const refs = [...html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const local = refs.filter((r) => !/^(?:[a-z]+:|\/\/|#)/i.test(r));
  for (const ref of new Set(local)) {
    const file = decodeURIComponent(ref.split(/[?#]/)[0]);
    if (existsSync(path.join(root, file))) pass(`${page} → ${file}`);
    else fail(`${page} links to ${file}, which does not exist`);
  }
}

// ---------- 3. The app opens and every page renders ----------
console.log('App opens in a browser');
let chromium;
try {
  ({ chromium } = createRequire(path.join(process.env.PLAYWRIGHT_FROM || root, 'noop.js'))('playwright'));
} catch {
  fail('Playwright is not installed (see the "Run locally" note at the top of this file)');
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

if (chromium) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const httpBase = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const routes = ['home', 'add', 'words', 'settings'];

  for (const [label, base] of [['web server', httpBase], ['opened from disk', pathToFileURL(root + path.sep).href]]) {
    const context = await browser.newContext();
    // Allow only this repo's own files; block every outside service.
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(httpBase) || url.startsWith('file:') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.stack || err.message));
    page.on('console', (msg) => {
      // Blocked outside requests show up as "Failed to load resource"; those are expected.
      if (msg.type() === 'error' && !/Failed to load resource|net::ERR_/i.test(msg.text())) errors.push(msg.text());
    });

    const entry = base + (label === 'web server' ? '' : 'index.html'); // index.html redirects to the app
    await page.goto(entry, { waitUntil: 'load' });
    await page.waitForURL(/acethewords\.html/, { timeout: 10000 }).catch(() => fail(`${label}: index.html did not open the app`));
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    if (errors.length) fail(`${label}: JavaScript errors while starting up:\n    ${errors.join('\n    ')}`);
    else pass(`${label}: starts up`);
    errors.length = 0;

    for (const route of routes) {
      const before = errors.length;
      await page.evaluate((r) => { location.hash = r; }, route);
      const rendered = await page
        .waitForFunction(() => document.querySelector('#app')?.children.length > 0, null, { timeout: 10000 })
        .then(() => true, () => false);
      await page.waitForTimeout(300); // let late errors from this page surface
      const newErrors = errors.slice(before);
      if (!rendered) fail(`${label}: #${route} rendered nothing`);
      else if (newErrors.length) fail(`${label}: #${route} threw JavaScript errors:\n    ${newErrors.join('\n    ')}`);
      else pass(`${label}: #${route}`);
    }
    await context.close();
  }
  await browser.close();
  server.close();
}

console.log(failures.length ? `\n${failures.length} problem(s) found.` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);

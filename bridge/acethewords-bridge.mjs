#!/usr/bin/env node
// AceTheWords bridge: lets the app write questions with the Codex or Claude Code login you already have,
// instead of a DeepSeek API key. A web page can't start programs, so this small local server does it for
// the app, the same way T3 Code drives these CLIs. No dependencies; needs Node 18 or newer.
//
//   node acethewords-bridge.mjs
//
// It prints a token. Paste it into AceTheWords → Settings → AI. Only requests carrying that token are served,
// and only on 127.0.0.1. The CLIs run with their tools switched off, in an empty temporary folder, and a Codex reply
// is refused if it used a tool anyway, so a request can only get text back; it can't make them run commands or read your files.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST = '127.0.0.1';
const PORT = 7313;
const TIMEOUT_MS = 180_000;
const MAX_BODY = 30 * 1024 * 1024; // up to 4 photos as data URLs

// The token is kept between runs so it only has to be pasted once.
const TOKEN_FILE = path.join(os.homedir(), '.acethewords-bridge-token');
function loadToken() {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (/^[a-f0-9]{32,}$/.test(t)) return t; } catch { /* make one */ }
  const t = randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// Splits OpenAI-style chat messages into a system prompt, the user's text and any images (data URLs).
function readMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new HttpError(400, 'messages must be a non-empty array');
  const system = [], text = [], images = [];
  for (const m of messages) {
    const parts = typeof m?.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m?.content) ? m.content : [];
    for (const p of parts) {
      if (p?.type === 'text' && typeof p.text === 'string') (m.role === 'system' ? system : text).push(p.text);
      else if (p?.type === 'image_url') {
        const hit = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(p.image_url?.url || '');
        if (!hit) throw new HttpError(400, 'images must be base64 data URLs (png, jpeg, gif or webp)');
        images.push({ type: hit[1], data: hit[2] });
      }
    }
  }
  if (!text.length) throw new HttpError(400, 'no user text in messages');
  return { system: system.join('\n\n'), text: text.join('\n\n'), images };
}

// Runs a CLI with stdin and resolves with its exit code and output. Windows needs a shell to find the npm .cmd shims; every argument
// here is a fixed flag or a temp path, so quoting paths is enough.
function run(cmd, args, stdin, cwd) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const child = spawn(cmd, win ? args.map(a => (/[\s"]/.test(a) ? `"${a}"` : a)) : args, { cwd, shell: win, env: process.env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new HttpError(504, `${cmd} took longer than ${TIMEOUT_MS / 1000}s`)); }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new HttpError(503, e.code === 'ENOENT' ? `${cmd} is not installed or not on PATH` : e.message)); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on('error', () => { /* the exit code reports the failure */ });
    child.stdin.end(stdin);
  });
}
const failed = (cmd, { code, out, err }) => new HttpError(502, `${cmd} exited with code ${code}: ${(err || out).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`);

// Every Codex feature that gives the model a tool (commands, files, images by path, apps, plugins, browsers, the computer, the web).
// Codex rejects names it doesn't know, so only the ones this version lists are passed; the event check covers the rest.
const CODEX_TOOL_FEATURES = ['shell_tool', 'unified_exec', 'code_mode_host', 'view_image', 'apps', 'plugins', 'browser_use', 'browser_use_external',
  'in_app_browser', 'computer_use', 'image_generation', 'skill_search', 'tool_suggest'];
let codexToolsOff = null;
async function codexToolFlags(dir) {
  if (!codexToolsOff) {
    const r = await run('codex', ['features', 'list'], '', dir);
    const known = new Set(r.code === 0 ? r.out.split('\n').map(l => l.split(/\s+/)[0]) : CODEX_TOOL_FEATURES);
    codexToolsOff = CODEX_TOOL_FEATURES.filter(f => known.has(f)).flatMap(f => ['--disable', f]).concat(['-c', 'web_search=disabled']);
  }
  return codexToolsOff;
}

const providers = {
  // Codex CLI (ChatGPT plan). Its read-only sandbox still lets it run commands and read any file, so every tool
  // it offers is switched off, and the reply is refused if the event log shows it used any tool anyway.
  async codex({ system, text, images }, dir) {
    const files = images.map((im, i) => {
      const f = path.join(dir, `photo${i + 1}.${im.type.split('/')[1]}`);
      fs.writeFileSync(f, Buffer.from(im.data, 'base64'));
      return f;
    });
    const r = await run('codex', ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      ...await codexToolFlags(dir), '-C', dir, ...files.flatMap(f => ['-i', f]), '-'], (system ? system + '\n\n' : '') + text, dir);
    if (r.code !== 0) throw failed('codex', r);
    const items = r.out.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e?.item).map(e => e.item);
    const tool = items.find(it => !['agent_message', 'reasoning', 'error'].includes(it.type));
    if (tool) throw new HttpError(502, `codex tried to use a tool (${tool.type}), so its reply was refused`);
    const reply = items.filter(it => it.type === 'agent_message').at(-1);
    if (!reply) throw failed('codex', r);
    return reply.text || '';
  },
  // Claude Code CLI (Claude plan). All tools off, no MCP servers or settings files, nothing saved.
  async claude({ system, text, images }, dir) {
    const sys = path.join(dir, 'system.txt');
    fs.writeFileSync(sys, system || 'Follow the instructions in the user message.');
    const content = [{ type: 'text', text }, ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } }))];
    const r = await run('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '',
      '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--system-prompt-file', sys],
    JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n', dir);
    // The result record explains most failures (for example "Not logged in"), even when the exit code isn't 0.
    const result = r.out.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(e => e?.type === 'result');
    if (!result) throw failed('claude', r);
    if (result.is_error) throw new HttpError(502, `claude: ${String(result.result || result.subtype).slice(0, 400)}`);
    return result.result || '';
  },
};

async function complete(body) {
  const ask = providers[body?.model];
  if (!ask) throw new HttpError(400, `model must be "codex" or "claude"`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acethewords-'));
  try { return await ask(readMessages(body.messages), dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'body is not JSON')); } });
    req.on('error', reject);
  });
}

const tokenOk = header => {
  const got = Buffer.from(String(header || '').replace(/^Bearer\s+/i, '')), want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};

const server = http.createServer(async (req, res) => {
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  // CORS for the online app and downloaded copies (Origin "null"). The token is what keeps other pages out.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  // A page on another host name pointed at 127.0.0.1 (DNS rebinding) is refused.
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${PORT}$`).test(req.headers.host || '')) return send(403, { error: { message: 'wrong host' } });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: { message: 'not found' } });
  if (!tokenOk(req.headers.authorization)) return send(401, { error: { message: 'wrong bridge token' } });
  const t0 = Date.now();
  try {
    const body = await readBody(req);
    const content = await complete(body);
    console.log(`${new Date().toLocaleTimeString()}  ${body.model}  ok  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    send(200, { object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
  } catch (e) {
    const status = e.status || 500;
    console.log(`${new Date().toLocaleTimeString()}  error ${status}: ${e.message}`);
    send(status, { error: { message: e.message } });
  }
});

server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Is the bridge already running in another window?` : e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`AceTheWords bridge is running on http://${HOST}:${PORT}`);
  console.log(`\nPaste this token into AceTheWords → Settings → AI:\n\n  ${TOKEN}\n`);
  console.log('Keep this window open while you use the app. Press Ctrl+C to stop.');
});

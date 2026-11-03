<h1 align="center">AceTheWords</h1>

<p align="center"><b>Learn vocabulary for good — before the test.</b><br>
A free web app that runs in your browser, looks up your words, quizzes you, and schedules reviews right before you'd forget.</p>

<p align="center">
  <a href="docs/AceTheWords-User-Manual.pdf"><img alt="Read the User Manual (PDF)" src="https://img.shields.io/badge/%F0%9F%93%98%20READ%20THE%20USER%20MANUAL-PDF-5b5bd6?style=for-the-badge"></a>
  &nbsp;
  <a href="https://itsyuranwei.github.io/acethewords/"><img alt="Use it online" src="https://img.shields.io/badge/%E2%96%B6%20USE%20IT%20ONLINE-no%20download-16955a?style=for-the-badge"></a>
</p>

> ### 📘 New here? Start with the [**User Manual (PDF)**](docs/AceTheWords-User-Manual.pdf)
> It walks you through downloading AceTheWords from this page, opening it, and using every feature step by step.

---

## Quick start

**Fastest:** open **https://itsyuranwei.github.io/acethewords/** — the app runs right in your browser.

**Or download your own copy:**

1. Click the green **Code** button near the top of this page, then **Download ZIP**.
2. Unzip the downloaded file.
3. Double-click **`acethewords.html`**. It opens in your web browser — no install, no account.

Prefer the command line?

```bash
git clone https://github.com/itsyuranwei/acethewords.git
```

Then open `acethewords/acethewords.html` in Chrome, Edge, Safari or Firefox.

> Progress is saved per browser *and* per location, so the online version and a downloaded copy each keep their own progress. Use **Settings → Export / Import backup** to move between them.

## What it does

- **Word lists per test or class** — paste words (or import them from a photo) and the app looks up meanings, pronunciation and examples automatically.
- **Learn → Practice → Review** — meet new words in small batches, practice with questions that get harder as each word gets stronger, and review memorized words just before they fade.
- **Test-date planning** — set a test date and the app spreads new words out so everything is learned and reviewed in time.
- **Smart scheduling** — uses FSRS-5, the spaced-repetition model behind Anki's modern scheduler, plus a hidden answer-speed signal.
- **Optional AI** — student-friendly definitions, fill-in-the-blank and correct-usage questions, and photo import. Use the Codex or Claude Code plan you already have, or a DeepSeek API key.
- **Private by default** — everything is saved in your own browser. Export a backup file any time.
- **Share a list** — export any list as a `.atw` file (list → ⚙️ Edit → Export) and import it with ＋ New list → Import a list, with or without its progress.

## Use your Codex or Claude plan for AI

A web page can't start programs, so a small bridge runs on your computer and passes the app's requests to the Codex CLI or Claude Code, using the login you already have. No API key needed.

1. Install [Codex CLI](https://github.com/openai/codex) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and sign in once (run `codex` or `claude` in a terminal).
2. Install [Node.js](https://nodejs.org) 18 or newer, then run this and leave the window open:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/itsyuranwei/acethewords/main/bridge/acethewords-bridge.mjs && node acethewords-bridge.mjs
   ```

3. In the app, open **Settings → AI**, choose Codex or Claude Code, and paste the token the bridge prints.

The bridge listens only on `127.0.0.1:7313`, answers only requests that carry its token, and runs the CLI with no tools in an empty temporary folder. Chrome and Edge may ask to let the page reach devices on your local network; allow it.

## Files

| File | What it is |
| --- | --- |
| `acethewords.html` | The app's page. Open it in a browser (it needs the `css` and `js` folders next to it). |
| `css/acethewords.css` | All of the app's styles. |
| `js/` | The app's code, loaded in this order: `core` (helpers, saving, word info), `ai` (dictionary and AI requests), `memory` (memory model, planner, units), `questions`, `session` (study sessions), `ui` (screens), `askai` (the Ask AI chat), `listfile` (.atw files), `input` (photos and pasted words), `main` (start-up). |
| `index.html` | Sends the online version's home page to the app. |
| `bridge/acethewords-bridge.mjs` | Optional local bridge for using Codex or Claude Code. |
| `docs/AceTheWords-User-Manual.pdf` | The illustrated user manual. |

## Privacy

Your words and progress stay in your browser's local storage on your device. Word lookups go to the free [Dictionary API](https://dictionaryapi.dev/). The app asks GitHub for this repository's star count to show on the "Star it on GitHub" button; nothing about you or your words is sent. If you set up AI, words (and any photos you import) are sent to the provider you chose to write questions: DeepSeek directly, or OpenAI or Anthropic through the Codex or Claude Code CLI on your computer. Keys and bridge tokens are stored only in your browser and are never included in backup exports.

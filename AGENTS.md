# Repository Guidelines

## Project Structure & Module Organization
- Root-level source files drive this Chrome Extension (Manifest V3):
  - `manifest.json`: extension metadata, permissions, content script/background wiring.
  - `background.js`: translation routing, provider calls, queue/cache, security checks.
  - `content.js`: Twitch chat DOM observer, message extraction, translated line injection.
  - `popup.html`/`popup.css`/`popup.js`: primary user controls in action popup.
  - `options.html`/`options.css`/`options.js`: extended settings and translation test panel.
- Documentation: `README.md`, `SECURITY.md`.
- Visual assets: `assets/` (banner, architecture, popup preview).

## Build, Test, and Development Commands
- No build step is required (plain JS/CSS/HTML extension).
- Syntax check before committing:
  - `node --check background.js`
  - `node --check content.js`
  - `node --check popup.js`
  - `node --check options.js`
- Load locally in Chrome:
  1. Open `chrome://extensions`
  2. Enable Developer mode
  3. Click **Load unpacked** and select this repo folder

## Coding Style & Naming Conventions
- JavaScript style in this repo:
  - 2-space indentation, semicolons, single-responsibility functions.
  - Prefer `const`/`let`, early returns, and explicit validation.
- Naming:
  - `camelCase` for variables/functions.
  - `UPPER_SNAKE_CASE` for constants (e.g., `MAX_QUEUE_LENGTH`).
  - Provider IDs use `snake_case` (e.g., `google_free`).
- Keep UI strings and behavior consistent between `popup.*` and `options.*`.

## Testing Guidelines
- There is currently no automated test framework.
- Minimum validation for PRs:
  - Run all `node --check` commands above.
  - Manual smoke test on Twitch chat (`https://twitch.tv/*`):
    - translation appears under incoming messages,
    - provider switch works,
    - API key save/clear works.
- If UI changes are made, include before/after screenshots in PR.

## Commit & Pull Request Guidelines
- Follow Conventional Commits used in history:
  - `feat(security): ...`, `docs: ...`, `feat: ...`.
- Keep commits scoped and atomic; avoid mixing refactor + behavior change without reason.
- PRs should include:
  - concise summary,
  - rationale/risk notes,
  - manual verification steps,
  - linked issue (if available).

## Security & Configuration Notes
- Store secrets in `chrome.storage.local` only; never reintroduce synced secret storage.
- Do not loosen provider endpoint allowlists or sender validation without explicit threat-model discussion.

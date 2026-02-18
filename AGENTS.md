# Repository Guidelines

## Project Structure & Module Organization
This repository is a Chrome Extension (Manifest V3) with flat, root-level modules:
- `manifest.json`: permissions, host matches, content/background registration.
- `background.js`: provider routing, request queue/cache, security validation, API calls.
- `content.js`: Twitch chat DOM observer, message extraction, translated message rendering.
- `popup.html` / `popup.css` / `popup.js`: primary runtime controls.
- `options.html` / `options.css` / `options.js`: advanced settings and translation testing UI.
- `assets/`: static visuals (banner, architecture, previews).
- `README.md`, `SECURITY.md`: user and security documentation.

## Build, Test, and Development Commands
No build pipeline is required for this project.
- `node --check background.js`
- `node --check content.js`
- `node --check popup.js`
- `node --check options.js`  
These commands validate JavaScript syntax before committing.

Local run:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the repo directory
4. Reload extension after code changes

## Coding Style & Naming Conventions
- Use 2-space indentation, semicolons, and `const`/`let` (no `var`).
- Prefer small functions with early returns and explicit input validation.
- Naming: `camelCase` for functions/variables, `UPPER_SNAKE_CASE` for constants, `snake_case` provider IDs (for example `google_free`).
- Keep behavior and validation logic aligned between popup/options and background modules.

## Testing Guidelines
There is no automated test framework yet. Minimum PR validation:
- Run all `node --check` commands.
- Manually test on `https://www.twitch.tv/*`:
  - translations appear under incoming messages,
  - provider switching works,
  - API key save/clear works,
  - no runtime errors in extension/content consoles.

## Commit & Pull Request Guidelines
Follow Conventional Commits as used in history:
- `feat(security): ...`
- `fix(content): ...`
- `docs: ...`
- `chore(release): ...`

PRs should include a concise summary, risk notes, manual verification steps, and screenshots for UI changes.

## Security & Configuration Tips
- Store secrets only in `chrome.storage.local`.
- Do not relax sender validation or provider endpoint allowlists without a documented security review.

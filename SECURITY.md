# Security Policy

## Scope

This extension focuses on secure-by-default behavior for local translation on Twitch chat.

## Implemented Safeguards

- API keys are stored in `chrome.storage.local` only (device-local), not `chrome.storage.sync`.
- Legacy `chrome.storage.sync.apiKey` is migrated to local storage and removed automatically.
- Provider endpoints are allowlisted per provider:
  - OpenAI: `api.openai.com`
  - OpenRouter: `openrouter.ai`
  - Groq: `api.groq.com`
  - DeepSeek: `api.deepseek.com`
  - Gemini: `generativelanguage.googleapis.com`
  - Anthropic: `api.anthropic.com`
  - Ollama: `localhost`, `127.0.0.1`, `::1`
- HTTPS is required for all cloud providers.
- Background message handling validates sender origin and request schema before processing.
- Outbound requests use timeout + abort and safe fetch defaults (`credentials: omit`, `referrerPolicy: no-referrer`).
- Settings are sanitized in both UI and background layers.

## Threat Model Notes

- This extension does not execute remote scripts.
- Translation text can be sent to third-party model providers selected by the user.
- If a provider key is compromised, rotate it at the provider side immediately.

## Reporting a Vulnerability

If you discover a security issue, open a private report to the maintainer before public disclosure.
Include:

- Impact summary
- Reproduction steps
- Affected version (`manifest.json`)
- Suggested mitigation (if available)

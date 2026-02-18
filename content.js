(function bootstrap() {
  const DEFAULT_VIEW_SETTINGS = {
    enabled: true,
    minChars: 2
  };

  const CHAT_LINE_SELECTOR = [
    '[data-a-target="chat-line-message"]',
    '[data-test-selector="chat-line-message"]',
    ".chat-line__message"
  ].join(",");

  const TRANSLATION_CLASS = "tw-ai-zh-translation";
  const LAST_TEXT_ATTR = "data-tw-ai-last-text";

  const state = {
    enabled: true,
    minChars: 2,
    recentMessages: []
  };

  const pendingNodes = new Set();
  let flushScheduled = false;

  injectStyle();
  loadSettings().then(startObserver).catch(startObserver);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }
    if (changes.enabled) {
      state.enabled = Boolean(changes.enabled.newValue);
    }
    if (changes.minChars) {
      state.minChars = Number(changes.minChars.newValue || 2);
    }
  });

  async function loadSettings() {
    const loaded = await chrome.storage.sync.get(DEFAULT_VIEW_SETTINGS);
    state.enabled = Boolean(loaded.enabled);
    state.minChars = Number(loaded.minChars || 2);
  }

  function startObserver() {
    enqueueNode(document.body);

    const observer = new MutationObserver((mutations) => {
      if (!state.enabled) {
        return;
      }
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => enqueueNode(node));
        } else if (mutation.type === "characterData" && mutation.target.parentElement) {
          enqueueNode(mutation.target.parentElement);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function enqueueNode(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    pendingNodes.add(node);
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    requestAnimationFrame(flushPendingNodes);
  }

  function flushPendingNodes() {
    flushScheduled = false;
    const nodes = Array.from(pendingNodes);
    pendingNodes.clear();
    for (const node of nodes) {
      scanNode(node);
    }
  }

  function scanNode(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.matches(CHAT_LINE_SELECTOR)) {
      processChatLine(node);
    }

    node.querySelectorAll(CHAT_LINE_SELECTOR).forEach((line) => processChatLine(line));
  }

  function processChatLine(line) {
    if (!(line instanceof HTMLElement)) {
      return;
    }

    const text = extractMessageText(line);
    if (!text) {
      return;
    }

    if (line.getAttribute(LAST_TEXT_ATTR) === text) {
      return;
    }
    line.setAttribute(LAST_TEXT_ATTR, text);
    removeExistingTranslation(line);

    if (!state.enabled || shouldSkipLocal(text)) {
      rememberMessage(text);
      return;
    }

    const context = state.recentMessages.slice(-6);
    rememberMessage(text);

    chrome.runtime.sendMessage(
      {
        type: "TRANSLATE_TEXT",
        text,
        context
      },
      (response) => {
        if (chrome.runtime.lastError) {
          return;
        }
        if (!response || !response.ok || response.skip || !response.translated) {
          return;
        }
        appendTranslation(line, response.translated, response.detectedLanguage);
      }
    );
  }

  function appendTranslation(line, translatedText, detectedLanguage) {
    if (!document.contains(line)) {
      return;
    }
    if (line.querySelector(`.${TRANSLATION_CLASS}`)) {
      return;
    }

    const target =
      line.querySelector('[data-a-target="chat-line-message-body"]') ||
      line.querySelector(".chat-line__message") ||
      line;

    const wrapper = document.createElement("span");
    wrapper.className = TRANSLATION_CLASS;

    const label = document.createElement("span");
    label.className = `${TRANSLATION_CLASS}__label`;
    label.textContent = detectedLanguage ? `[中譯 ${detectedLanguage}]` : "[中譯]";

    const message = document.createElement("span");
    message.className = `${TRANSLATION_CLASS}__text`;
    message.textContent = translatedText;

    wrapper.append(label, message);
    target.appendChild(wrapper);
  }

  function removeExistingTranslation(line) {
    line.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((element) => element.remove());
  }

  function extractMessageText(line) {
    const body = line.querySelector('[data-a-target="chat-line-message-body"]') || line;

    const fragments = body.querySelectorAll(
      [
        '[data-a-target="chat-message-text"]',
        ".text-fragment",
        ".mention-fragment",
        ".link-fragment",
        "img.chat-image__image[alt]",
        "button.chat-line__message--emote-button img[alt]",
        'img[alt][class*="emote"]'
      ].join(",")
    );

    const parts = [];
    if (fragments.length) {
      fragments.forEach((fragment) => {
        if (!(fragment instanceof HTMLElement)) {
          return;
        }
        if (fragment.closest(`.${TRANSLATION_CLASS}`)) {
          return;
        }
        const value =
          fragment.tagName === "IMG"
            ? fragment.getAttribute("alt") || fragment.getAttribute("aria-label") || ""
            : fragment.textContent || "";
        const cleaned = value.replace(/\s+/g, " ").trim();
        if (cleaned) {
          parts.push(cleaned);
        }
      });
    }

    if (parts.length) {
      return parts.join(" ").trim();
    }

    const clone = body.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return "";
    }
    clone
      .querySelectorAll(
        [
          ".chat-author__display-name",
          ".chat-line__username",
          '[data-a-target="chat-message-username"]',
          ".chat-badge",
          `.${TRANSLATION_CLASS}`
        ].join(",")
      )
      .forEach((node) => node.remove());

    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function shouldSkipLocal(text) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return true;
    }
    if (normalized.length < state.minChars) {
      return true;
    }
    if (normalized.startsWith("/")) {
      return true;
    }
    if (/^(https?:\/\/|www\.)\S+$/i.test(normalized)) {
      return true;
    }
    const compact = normalized.replace(/\s+/g, "");
    return compact.length > 0 && !/[\p{L}\p{N}]/u.test(compact);
  }

  function rememberMessage(text) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return;
    }
    state.recentMessages.push(normalized);
    if (state.recentMessages.length > 12) {
      state.recentMessages.shift();
    }
  }

  function injectStyle() {
    if (document.getElementById("tw-ai-zh-translation-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "tw-ai-zh-translation-style";
    style.textContent = `
      .${TRANSLATION_CLASS} {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.35;
        color: #9fb3c8;
        white-space: pre-wrap;
      }
      .${TRANSLATION_CLASS}__label {
        display: inline-block;
        margin-right: 6px;
        font-size: 11px;
        color: #5ad0ff;
        opacity: 0.95;
      }
      .${TRANSLATION_CLASS}__text {
        color: inherit;
      }
    `;
    document.documentElement.appendChild(style);
  }
})();

const PROVIDER_CONFIG = Object.freeze({
  google_free: {
    label: "免 API",
    mode: "google_free",
    needsApiKey: false,
    defaultApiUrl: "",
    defaultModel: "",
    endpointRule: null
  },
  openai: {
    label: "OpenAI",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4.1-mini",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.openai.com"]
    }
  },
  openrouter: {
    label: "OpenRouter",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["openrouter.ai"]
    }
  },
  groq: {
    label: "Groq",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.1-8b-instant",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.groq.com"]
    }
  },
  deepseek: {
    label: "DeepSeek",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.deepseek.com"]
    }
  },
  gemini: {
    label: "Google Gemini",
    mode: "gemini",
    needsApiKey: true,
    defaultApiUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["generativelanguage.googleapis.com"]
    }
  },
  anthropic: {
    label: "Anthropic Claude",
    mode: "anthropic",
    needsApiKey: true,
    defaultApiUrl: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-3-5-haiku-latest",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.anthropic.com"]
    }
  },
  ollama: {
    label: "Ollama (Local)",
    mode: "openai_compatible",
    needsApiKey: false,
    defaultApiUrl: "http://127.0.0.1:11434/v1/chat/completions",
    defaultModel: "qwen2.5:7b",
    endpointRule: {
      allowedProtocols: ["http:", "https:"],
      allowedHosts: ["127.0.0.1", "localhost", "::1"]
    }
  }
});

const DEFAULT_PUBLIC_SETTINGS = Object.freeze({
  enabled: true,
  provider: "google_free",
  apiUrl: "",
  model: "",
  temperature: 0.2,
  translationStyle: "natural_taiwan",
  minChars: 2
});

const DEFAULT_SECRET_SETTINGS = Object.freeze({
  apiKey: ""
});

const DEFAULT_SETTINGS = Object.freeze({
  ...DEFAULT_PUBLIC_SETTINGS,
  ...DEFAULT_SECRET_SETTINGS
});

const TRANSLATE_STYLE_SET = new Set(["natural_taiwan", "faithful"]);

const MAX_CACHE_SIZE = 600;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_QUEUE_LENGTH = 80;
const TRIMMED_QUEUE_LENGTH = 40;
const MAX_INPUT_TEXT_LENGTH = 600;
const MAX_TRANSLATED_TEXT_LENGTH = 1200;
const MAX_CONTEXT_ITEMS = 6;
const MAX_CONTEXT_ITEM_LENGTH = 240;
const MAX_MODEL_LENGTH = 120;
const MAX_API_URL_LENGTH = 512;
const MAX_API_KEY_LENGTH = 512;
const FETCH_TIMEOUT_MS = 15000;

let settingsPromise = null;
let settingsCache = { ...DEFAULT_SETTINGS };

const translationCache = new Map();
const inFlightByCacheKey = new Map();
const requestQueue = [];
let queueRunningCount = 0;

bootstrapSettings();
chrome.runtime.onInstalled.addListener(() => {
  settingsPromise = bootstrapSettings();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" && areaName !== "local") {
    return;
  }

  const next = { ...settingsCache };
  if (areaName === "sync") {
    for (const [key, change] of Object.entries(changes)) {
      if (key === "apiKey") {
        continue;
      }
      next[key] = change.newValue;
    }
  }

  if (areaName === "local" && changes.apiKey) {
    next.apiKey = changes.apiKey.newValue;
  }

  settingsCache = sanitizeSettings(next);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAllowedSender(sender)) {
    sendResponse({ ok: false, error: "未授權的訊息來源" });
    return false;
  }

  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "TRANSLATE_TEXT") {
    const validatedMessage = validateTranslateMessage(message);
    if (!validatedMessage.ok) {
      sendResponse({ ok: false, error: validatedMessage.error });
      return false;
    }

    enqueueTask(() => processTranslateRequest(validatedMessage.payload))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "翻譯失敗"
        })
      );
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "讀取設定失敗"
        })
      );
    return true;
  }

  return false;
});

function bootstrapSettings() {
  settingsPromise = (async () => {
    await migrateLegacyApiKey();

    const [publicStored, secretStored] = await Promise.all([
      chrome.storage.sync.get(DEFAULT_PUBLIC_SETTINGS),
      chrome.storage.local.get(DEFAULT_SECRET_SETTINGS)
    ]);

    settingsCache = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      ...publicStored,
      ...secretStored
    });

    await Promise.all([
      chrome.storage.sync.set(toPublicSettings(settingsCache)),
      chrome.storage.local.set(toSecretSettings(settingsCache))
    ]);

    return settingsCache;
  })().catch((error) => {
    console.error("初始化設定失敗", error);
    settingsCache = sanitizeSettings(settingsCache);
    return settingsCache;
  });

  return settingsPromise;
}

async function migrateLegacyApiKey() {
  const legacy = await chrome.storage.sync.get(["apiKey"]);
  if (!Object.prototype.hasOwnProperty.call(legacy, "apiKey")) {
    return;
  }

  const currentLocal = await chrome.storage.local.get(DEFAULT_SECRET_SETTINGS);
  const legacyKey = sanitizeApiKey(legacy.apiKey);
  const localKey = sanitizeApiKey(currentLocal.apiKey);

  if (!localKey && legacyKey) {
    await chrome.storage.local.set({ apiKey: legacyKey });
  }

  await chrome.storage.sync.remove("apiKey");
}

async function getSettings() {
  if (!settingsPromise) {
    settingsPromise = bootstrapSettings();
  }
  await settingsPromise;
  return settingsCache;
}

function toPublicSettings(settings) {
  return {
    enabled: Boolean(settings.enabled),
    provider: normalizeProvider(settings.provider),
    apiUrl: String(settings.apiUrl || ""),
    model: String(settings.model || ""),
    temperature: toNumberInRange(settings.temperature, 0, 1, DEFAULT_PUBLIC_SETTINGS.temperature),
    translationStyle: normalizeTranslationStyle(settings.translationStyle),
    minChars: toIntegerInRange(settings.minChars, 1, 20, DEFAULT_PUBLIC_SETTINGS.minChars)
  };
}

function toSecretSettings(settings) {
  return {
    apiKey: sanitizeApiKey(settings.apiKey)
  };
}

function sanitizeSettings(rawSettings) {
  const provider = normalizeProvider(rawSettings.provider);
  const providerConfig = getProviderConfig(provider);
  const normalized = {
    enabled: Boolean(rawSettings.enabled),
    provider,
    apiKey: sanitizeApiKey(rawSettings.apiKey),
    apiUrl: sanitizeApiUrl(rawSettings.apiUrl),
    model: sanitizeModel(rawSettings.model),
    temperature: toNumberInRange(rawSettings.temperature, 0, 1, DEFAULT_PUBLIC_SETTINGS.temperature),
    translationStyle: normalizeTranslationStyle(rawSettings.translationStyle),
    minChars: toIntegerInRange(rawSettings.minChars, 1, 20, DEFAULT_PUBLIC_SETTINGS.minChars)
  };

  if (providerConfig.mode === "google_free") {
    normalized.apiKey = "";
    normalized.apiUrl = "";
    normalized.model = "";
    normalized.temperature = DEFAULT_PUBLIC_SETTINGS.temperature;
    return normalized;
  }

  if (!normalized.apiUrl) {
    normalized.apiUrl = providerConfig.defaultApiUrl;
  }

  const endpointValidation = validateProviderEndpoint(provider, normalized.apiUrl);
  normalized.apiUrl = endpointValidation.ok ? endpointValidation.url : providerConfig.defaultApiUrl;

  if (!normalized.model) {
    normalized.model = providerConfig.defaultModel;
  }

  return normalized;
}

function validateTranslateMessage(message) {
  const text = normalizeText(message.text).slice(0, MAX_INPUT_TEXT_LENGTH);
  if (!text) {
    return { ok: false, error: "翻譯文字不可為空" };
  }

  const context = Array.isArray(message.context)
    ? message.context
        .slice(-MAX_CONTEXT_ITEMS)
        .map((line) => normalizeText(line).slice(0, MAX_CONTEXT_ITEM_LENGTH))
        .filter(Boolean)
    : [];

  return {
    ok: true,
    payload: {
      text,
      context
    }
  };
}

function isAllowedSender(sender) {
  if (!sender) {
    return false;
  }

  if (typeof sender.id === "string" && sender.id !== chrome.runtime.id) {
    return false;
  }

  const rawUrl =
    (typeof sender.url === "string" && sender.url) ||
    (typeof sender.origin === "string" && sender.origin) ||
    (typeof sender.documentUrl === "string" && sender.documentUrl) ||
    (typeof sender.tab?.url === "string" && sender.tab.url) ||
    "";
  if (!rawUrl) {
    return Boolean(sender.id === chrome.runtime.id);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    return false;
  }

  if (parsed.protocol === "chrome-extension:") {
    return parsed.host === chrome.runtime.id;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return hostname === "twitch.tv" || hostname === "www.twitch.tv" || hostname === "m.twitch.tv";
}

function enqueueTask(task) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ task, resolve, reject });
    trimQueueIfNeeded();
    drainQueue();
  });
}

function trimQueueIfNeeded() {
  if (requestQueue.length <= MAX_QUEUE_LENGTH) {
    return;
  }

  const dropCount = requestQueue.length - TRIMMED_QUEUE_LENGTH;
  const dropped = requestQueue.splice(0, dropCount);
  for (const item of dropped) {
    item.reject(new Error("聊天室訊息過快，已略過較舊翻譯任務"));
  }
}

function drainQueue() {
  while (queueRunningCount < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const { task, resolve, reject } = requestQueue.shift();
    queueRunningCount += 1;

    Promise.resolve()
      .then(task)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        queueRunningCount -= 1;
        drainQueue();
      });
  }
}

async function processTranslateRequest(request) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { skip: true, reason: "disabled" };
  }

  const normalizedText = normalizeText(request.text).slice(0, MAX_INPUT_TEXT_LENGTH);
  if (!normalizedText) {
    return { skip: true, reason: "empty_text" };
  }
  if (normalizedText.length < Number(settings.minChars || DEFAULT_PUBLIC_SETTINGS.minChars)) {
    return { skip: true, reason: "too_short" };
  }
  if (shouldSkipTranslation(normalizedText)) {
    return { skip: true, reason: "not_translatable" };
  }

  const normalizedSettings = sanitizeSettings(settings);
  const cacheKey = buildCacheKey(normalizedSettings, normalizedText);
  const cached = readCache(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const inFlight = inFlightByCacheKey.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pendingPromise = (async () => {
    const context = Array.isArray(request.context)
      ? request.context
          .slice(-MAX_CONTEXT_ITEMS)
          .map((line) => normalizeText(line).slice(0, MAX_CONTEXT_ITEM_LENGTH))
          .filter(Boolean)
      : [];

    const rawResult = await requestTranslation({
      text: normalizedText,
      context,
      settings: normalizedSettings
    });

    const translated = normalizeText(rawResult.translated).slice(0, MAX_TRANSLATED_TEXT_LENGTH);
    if (!translated || translated === normalizedText || !rawResult.shouldTranslate) {
      return {
        skip: true,
        reason: "already_chinese_or_no_need",
        detectedLanguage: rawResult.detectedLanguage
      };
    }

    const result = {
      skip: false,
      translated,
      detectedLanguage: rawResult.detectedLanguage
    };

    writeCache(cacheKey, result);
    return result;
  })();

  inFlightByCacheKey.set(cacheKey, pendingPromise);
  try {
    return await pendingPromise;
  } finally {
    inFlightByCacheKey.delete(cacheKey);
  }
}

function buildCacheKey(settings, text) {
  const providerConfig = getProviderConfig(settings.provider);
  if (providerConfig.mode === "google_free") {
    return [settings.provider, text].join("::");
  }

  return [
    settings.provider,
    getEffectiveApiUrl(settings),
    getEffectiveModel(settings),
    String(settings.translationStyle || DEFAULT_PUBLIC_SETTINGS.translationStyle),
    text
  ].join("::");
}

async function requestTranslation({ text, context, settings }) {
  const providerConfig = getProviderConfig(settings.provider);

  if (providerConfig.mode === "google_free") {
    return requestTranslationFromGoogle(text);
  }

  const hasApiKey = Boolean(String(settings.apiKey || "").trim());
  if (providerConfig.needsApiKey && !hasApiKey) {
    return requestTranslationFromGoogle(text);
  }

  if (providerConfig.mode === "openai_compatible") {
    return requestTranslationFromOpenAiCompatible({ text, context, settings, providerConfig });
  }
  if (providerConfig.mode === "gemini") {
    return requestTranslationFromGemini({ text, context, settings, providerConfig });
  }
  if (providerConfig.mode === "anthropic") {
    return requestTranslationFromAnthropic({ text, context, settings, providerConfig });
  }

  return requestTranslationFromGoogle(text);
}

async function requestTranslationFromGoogle(text) {
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(text)}`;

  const { response, responseBody } = await fetchJsonWithTimeout(url, {
    method: "GET"
  }, "免 API 翻譯");

  if (!response.ok) {
    throw new Error(formatGoogleError(response.status));
  }

  return parseGoogleResponse(responseBody, text);
}

async function requestTranslationFromOpenAiCompatible({ text, context, settings, providerConfig }) {
  const apiUrl = getEffectiveApiUrl(settings);
  const model = getEffectiveModel(settings);
  if (!apiUrl) {
    throw new Error(`${providerConfig.label} API URL 未設定`);
  }
  if (!model) {
    throw new Error(`${providerConfig.label} Model 未設定`);
  }

  const endpointValidation = validateProviderEndpoint(settings.provider, apiUrl);
  if (!endpointValidation.ok) {
    throw new Error(endpointValidation.error);
  }

  const headers = {
    "Content-Type": "application/json"
  };

  const apiKey = String(settings.apiKey || "").trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (settings.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://twitch.tv";
    headers["X-Title"] = "Twitch Chat AI Translator";
  }

  const payload = {
    model,
    temperature: toNumberInRange(settings.temperature, 0, 1, DEFAULT_PUBLIC_SETTINGS.temperature),
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(settings.translationStyle)
      },
      {
        role: "user",
        content: buildUserPrompt(text, context)
      }
    ]
  };

  const { response, responseBody } = await fetchJsonWithTimeout(endpointValidation.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  }, providerConfig.label);

  if (!response.ok) {
    throw new Error(formatProviderError(response.status, responseBody, providerConfig));
  }

  const content = extractOpenAiCompatibleContent(responseBody);
  if (!content) {
    throw new Error(`${providerConfig.label} 沒有回傳可用翻譯內容`);
  }

  return parseModelOutput(content, text);
}

async function requestTranslationFromGemini({ text, context, settings, providerConfig }) {
  const baseUrl = getEffectiveApiUrl(settings);
  const model = getEffectiveModel(settings);
  const apiKey = String(settings.apiKey || "").trim();

  if (!baseUrl) {
    throw new Error("Gemini API URL 未設定");
  }
  if (!model) {
    throw new Error("Gemini Model 未設定");
  }
  if (!apiKey) {
    throw new Error("Gemini API Key 未設定");
  }

  const endpointValidation = validateProviderEndpoint(settings.provider, baseUrl);
  if (!endpointValidation.ok) {
    throw new Error(endpointValidation.error);
  }

  const endpoint = buildGeminiEndpoint(endpointValidation.url, model);
  if (!endpoint) {
    throw new Error("Gemini API URL 格式錯誤");
  }

  const fullUrl = `${endpoint}${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
  const payload = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(settings.translationStyle) }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: buildUserPrompt(text, context) }]
      }
    ],
    generationConfig: {
      temperature: toNumberInRange(settings.temperature, 0, 1, DEFAULT_PUBLIC_SETTINGS.temperature),
      responseMimeType: "application/json"
    }
  };

  const { response, responseBody } = await fetchJsonWithTimeout(fullUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, providerConfig.label);

  if (!response.ok) {
    throw new Error(formatProviderError(response.status, responseBody, providerConfig));
  }

  const content = extractGeminiContent(responseBody);
  if (!content) {
    throw new Error("Gemini 沒有回傳可用翻譯內容");
  }

  return parseModelOutput(content, text);
}

async function requestTranslationFromAnthropic({ text, context, settings, providerConfig }) {
  const apiUrl = getEffectiveApiUrl(settings);
  const model = getEffectiveModel(settings);
  const apiKey = String(settings.apiKey || "").trim();

  if (!apiUrl) {
    throw new Error("Anthropic API URL 未設定");
  }
  if (!model) {
    throw new Error("Anthropic Model 未設定");
  }
  if (!apiKey) {
    throw new Error("Anthropic API Key 未設定");
  }

  const endpointValidation = validateProviderEndpoint(settings.provider, apiUrl);
  if (!endpointValidation.ok) {
    throw new Error(endpointValidation.error);
  }

  const payload = {
    model,
    max_tokens: 220,
    temperature: toNumberInRange(settings.temperature, 0, 1, DEFAULT_PUBLIC_SETTINGS.temperature),
    system: buildSystemPrompt(settings.translationStyle),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(text, context)
      }
    ]
  };

  const { response, responseBody } = await fetchJsonWithTimeout(endpointValidation.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  }, providerConfig.label);

  if (!response.ok) {
    throw new Error(formatProviderError(response.status, responseBody, providerConfig));
  }

  const content = extractAnthropicContent(responseBody);
  if (!content) {
    throw new Error("Anthropic 沒有回傳可用翻譯內容");
  }

  return parseModelOutput(content, text);
}

async function fetchJsonWithTimeout(url, options, providerLabel) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer"
    });

    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch (_error) {
      responseBody = null;
    }

    return { response, responseBody };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${providerLabel} 連線逾時，請稍後再試`);
    }
    if (error instanceof TypeError) {
      throw new Error(`${providerLabel} 連線失敗，請檢查網路或端點設定`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateProviderEndpoint(provider, apiUrl) {
  const config = getProviderConfig(provider);
  if (!config.endpointRule) {
    return { ok: true, url: "" };
  }

  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch (_error) {
    return { ok: false, error: `${config.label} API URL 格式錯誤` };
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const rule = config.endpointRule;

  if (!rule.allowedProtocols.includes(protocol)) {
    return {
      ok: false,
      error: `${config.label} 僅允許 ${rule.allowedProtocols.join(" / ")} 端點`
    };
  }

  if (!rule.allowedHosts.includes(hostname)) {
    return {
      ok: false,
      error: `${config.label} 僅允許官方端點或本機 localhost`
    };
  }

  return { ok: true, url: parsed.toString() };
}

function parseGoogleResponse(payload, originalText) {
  if (!Array.isArray(payload)) {
    throw new Error("翻譯服務回應格式錯誤");
  }

  const translatedParts = [];
  const segments = Array.isArray(payload[0]) ? payload[0] : [];
  for (const segment of segments) {
    if (Array.isArray(segment) && typeof segment[0] === "string") {
      translatedParts.push(segment[0]);
    }
  }

  const translated = normalizeText(translatedParts.join(""));
  const detectedLanguage = typeof payload[2] === "string" ? payload[2] : "unknown";
  const shouldTranslate =
    Boolean(translated) &&
    translated !== normalizeText(originalText) &&
    !isChineseLanguageCode(detectedLanguage);

  return {
    translated: translated || originalText,
    detectedLanguage,
    shouldTranslate
  };
}

function extractOpenAiCompatibleContent(responseBody) {
  const content = responseBody?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  return "";
}

function extractGeminiContent(responseBody) {
  const candidates = Array.isArray(responseBody?.candidates) ? responseBody.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function extractAnthropicContent(responseBody) {
  const contentArray = Array.isArray(responseBody?.content) ? responseBody.content : [];
  return contentArray
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function buildGeminiEndpoint(apiUrl, model) {
  if (!apiUrl || !model) {
    return "";
  }

  const trimmedApiUrl = apiUrl.replace(/\/+$/, "");
  if (trimmedApiUrl.includes(":generateContent")) {
    return trimmedApiUrl;
  }

  return `${trimmedApiUrl}/models/${encodeURIComponent(model)}:generateContent`;
}

function buildSystemPrompt(style) {
  const styleInstruction =
    style === "faithful"
      ? "翻譯偏忠實，但仍要自然，不要逐字直譯。"
      : "翻譯請像台灣觀眾常用的自然口語，避免生硬書面句。";

  return [
    "你是 Twitch 直播聊天室的即時口譯員。",
    "任務：把非中文訊息翻成自然繁體中文（台灣用語）。",
    styleInstruction,
    "規則：",
    "1) 原文若已是中文，should_translate 必須是 false。",
    "2) 保留語氣、俚語、梗、專有名詞、emoji；必要時可音譯。",
    "3) 不要逐字硬翻，要讓中文讀起來像真人聊天室語氣。",
    "4) 僅輸出 JSON，格式固定為 {\"translated\":\"...\",\"detected_language\":\"...\",\"should_translate\":true/false}",
    "5) 不可輸出任何 JSON 以外內容。"
  ].join("\n");
}

function buildUserPrompt(text, context) {
  if (!context.length) {
    return `請翻譯以下訊息：\n${text}`;
  }

  return [
    "以下是最近聊天室上下文（僅供語氣理解）：",
    ...context.map((line) => `- ${line}`),
    "",
    "請翻譯這一則訊息：",
    text
  ].join("\n");
}

function parseModelOutput(rawValue, originalText) {
  const raw = String(rawValue || "");
  const parsed = tryParseJson(raw);
  if (parsed) {
    const translated = typeof parsed.translated === "string" ? parsed.translated.trim() : "";
    const detectedLanguage =
      typeof parsed.detected_language === "string" && parsed.detected_language.trim()
        ? parsed.detected_language.trim()
        : "unknown";
    const shouldTranslate = Boolean(parsed.should_translate);
    if (translated) {
      return { translated, detectedLanguage, shouldTranslate };
    }
  }

  const plain = raw
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  return {
    translated: plain || originalText,
    detectedLanguage: "unknown",
    shouldTranslate: plain !== originalText
  };
}

function tryParseJson(raw) {
  const candidate = String(raw || "").trim();
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    // pass
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const possibleJson = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(possibleJson);
  } catch (_error) {
    return null;
  }
}

function formatGoogleError(status) {
  if (status === 429) {
    return "免 API 翻譯請求過多，請稍後再試";
  }
  return `免 API 翻譯服務錯誤 (${status})`;
}

function formatProviderError(status, body, providerConfig) {
  const detail =
    (body &&
      typeof body === "object" &&
      (readNestedMessage(body, ["error", "message"]) ||
        readNestedMessage(body, ["error", "details"]) ||
        readNestedMessage(body, ["message"]))) ||
    "";

  if (status === 401 || status === 403) {
    return `${providerConfig.label} 驗證失敗，請檢查 API Key 或權限`;
  }
  if (status === 404) {
    return `${providerConfig.label} 端點或模型不存在`;
  }
  if (status === 429) {
    return `${providerConfig.label} 請求過多，請稍後再試`;
  }
  if (detail) {
    return `${providerConfig.label} API 錯誤 (${status}): ${detail}`;
  }
  return `${providerConfig.label} API 錯誤 (${status})`;
}

function readNestedMessage(obj, path) {
  let current = obj;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return "";
    }
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

function normalizeText(text) {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/\s+/g, " ").trim();
}

function sanitizeApiKey(value) {
  return String(value || "").trim().slice(0, MAX_API_KEY_LENGTH);
}

function sanitizeApiUrl(value) {
  return String(value || "").trim().slice(0, MAX_API_URL_LENGTH);
}

function sanitizeModel(value) {
  return String(value || "").trim().slice(0, MAX_MODEL_LENGTH);
}

function normalizeTranslationStyle(style) {
  return TRANSLATE_STYLE_SET.has(style) ? style : DEFAULT_PUBLIC_SETTINGS.translationStyle;
}

function toIntegerInRange(value, min, max, fallback) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, normalized));
}

function toNumberInRange(value, min, max, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, normalized));
}

function shouldSkipTranslation(text) {
  if (text.startsWith("/")) {
    return true;
  }
  if (/^(https?:\/\/|www\.)\S+$/i.test(text)) {
    return true;
  }

  const compact = text.replace(/\s+/g, "");
  return compact.length > 0 && !/[\p{L}\p{N}]/u.test(compact);
}

function isChineseLanguageCode(languageCode) {
  if (typeof languageCode !== "string") {
    return false;
  }
  return /^zh(-|$)/i.test(languageCode.trim());
}

function normalizeProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CONFIG, provider) ? provider : "google_free";
}

function getProviderConfig(provider) {
  return PROVIDER_CONFIG[normalizeProvider(provider)];
}

function getEffectiveApiUrl(settings) {
  const config = getProviderConfig(settings.provider);
  const apiUrl = sanitizeApiUrl(settings.apiUrl);
  if (!apiUrl) {
    return config.defaultApiUrl;
  }

  const endpointValidation = validateProviderEndpoint(settings.provider, apiUrl);
  return endpointValidation.ok ? endpointValidation.url : config.defaultApiUrl;
}

function getEffectiveModel(settings) {
  const config = getProviderConfig(settings.provider);
  const model = sanitizeModel(settings.model);
  return model || config.defaultModel;
}

function readCache(key) {
  if (!translationCache.has(key)) {
    return null;
  }

  const value = translationCache.get(key);
  translationCache.delete(key);
  translationCache.set(key, value);
  return value;
}

function writeCache(key, value) {
  if (translationCache.has(key)) {
    translationCache.delete(key);
  }

  translationCache.set(key, value);
  if (translationCache.size > MAX_CACHE_SIZE) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }
}

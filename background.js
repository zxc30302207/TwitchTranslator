const PROVIDER_CONFIG = Object.freeze({
  google_free: {
    label: "免 API",
    mode: "google_free",
    needsApiKey: false,
    defaultApiUrl: "",
    defaultModel: ""
  },
  openai: {
    label: "OpenAI",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4.1-mini"
  },
  openrouter: {
    label: "OpenRouter",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini"
  },
  groq: {
    label: "Groq",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.1-8b-instant"
  },
  deepseek: {
    label: "DeepSeek",
    mode: "openai_compatible",
    needsApiKey: true,
    defaultApiUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat"
  },
  gemini: {
    label: "Google Gemini",
    mode: "gemini",
    needsApiKey: true,
    defaultApiUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash"
  },
  anthropic: {
    label: "Anthropic Claude",
    mode: "anthropic",
    needsApiKey: true,
    defaultApiUrl: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-3-5-haiku-latest"
  },
  ollama: {
    label: "Ollama (Local)",
    mode: "openai_compatible",
    needsApiKey: false,
    defaultApiUrl: "http://127.0.0.1:11434/v1/chat/completions",
    defaultModel: "qwen2.5:7b"
  }
});

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  provider: "google_free",
  apiKey: "",
  apiUrl: "",
  model: "",
  temperature: 0.2,
  translationStyle: "natural_taiwan",
  minChars: 2
});

const MAX_CACHE_SIZE = 600;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_QUEUE_LENGTH = 80;
const TRIMMED_QUEUE_LENGTH = 40;

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
  if (areaName !== "sync") {
    return;
  }
  for (const [key, change] of Object.entries(changes)) {
    settingsCache[key] = change.newValue;
  }
  settingsCache.provider = normalizeProvider(settingsCache.provider);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "TRANSLATE_TEXT") {
    enqueueTask(() => processTranslateRequest(message))
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
  settingsPromise = chrome.storage.sync
    .get(DEFAULT_SETTINGS)
    .then(async (stored) => {
      settingsCache = applyProviderDefaults({ ...DEFAULT_SETTINGS, ...stored }, false);
      await chrome.storage.sync.set(settingsCache);
      return settingsCache;
    })
    .catch((error) => {
      console.error("初始化設定失敗", error);
      return settingsCache;
    });
  return settingsPromise;
}

async function getSettings() {
  if (!settingsPromise) {
    settingsPromise = bootstrapSettings();
  }
  await settingsPromise;
  return settingsCache;
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

async function processTranslateRequest(message) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { skip: true, reason: "disabled" };
  }

  const normalizedText = normalizeText(message.text);
  if (!normalizedText) {
    return { skip: true, reason: "empty_text" };
  }
  if (normalizedText.length < Number(settings.minChars || 2)) {
    return { skip: true, reason: "too_short" };
  }
  if (shouldSkipTranslation(normalizedText)) {
    return { skip: true, reason: "not_translatable" };
  }

  const normalizedSettings = applyProviderDefaults(
    {
      ...settings,
      provider: normalizeProvider(settings.provider)
    },
    false
  );

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
    const context = Array.isArray(message.context)
      ? message.context.slice(-6).map((item) => normalizeText(item)).filter(Boolean)
      : [];

    const rawResult = await requestTranslation({
      text: normalizedText,
      context,
      settings: normalizedSettings
    });

    const translated = normalizeText(rawResult.translated);
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
    String(settings.translationStyle || "natural_taiwan"),
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

  const response = await fetch(url, { method: "GET" });
  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch (_error) {
    responseBody = null;
  }

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
    temperature: Number(settings.temperature ?? 0.2),
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

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch (_error) {
    responseBody = null;
  }

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
  const apiUrl = buildGeminiEndpoint(getEffectiveApiUrl(settings), getEffectiveModel(settings));
  const model = getEffectiveModel(settings);
  const apiKey = String(settings.apiKey || "").trim();

  if (!apiUrl) {
    throw new Error("Gemini API URL 未設定");
  }
  if (!model) {
    throw new Error("Gemini Model 未設定");
  }
  if (!apiKey) {
    throw new Error("Gemini API Key 未設定");
  }

  const endpoint = `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
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
      temperature: Number(settings.temperature ?? 0.2),
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch (_error) {
    responseBody = null;
  }

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

  const payload = {
    model,
    max_tokens: 220,
    temperature: Number(settings.temperature ?? 0.2),
    system: buildSystemPrompt(settings.translationStyle),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(text, context)
      }
    ]
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });

  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch (_error) {
    responseBody = null;
  }

  if (!response.ok) {
    throw new Error(formatProviderError(response.status, responseBody, providerConfig));
  }

  const content = extractAnthropicContent(responseBody);
  if (!content) {
    throw new Error("Anthropic 沒有回傳可用翻譯內容");
  }

  return parseModelOutput(content, text);
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

  const separator = trimmedApiUrl.endsWith("/v1") || trimmedApiUrl.endsWith("/v1beta") ? "" : "";
  return `${trimmedApiUrl}${separator}/models/${encodeURIComponent(model)}:generateContent`;
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

function parseModelOutput(raw, originalText) {
  const parsed = tryParseJson(raw);
  if (parsed) {
    const translated =
      typeof parsed.translated === "string" ? parsed.translated.trim() : "";
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
    (body && typeof body === "object" &&
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
  if (typeof current === "string") {
    return current;
  }
  return "";
}

function normalizeText(text) {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/\s+/g, " ").trim();
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
  return Object.prototype.hasOwnProperty.call(PROVIDER_CONFIG, provider)
    ? provider
    : "google_free";
}

function getProviderConfig(provider) {
  return PROVIDER_CONFIG[normalizeProvider(provider)];
}

function getEffectiveApiUrl(settings) {
  const config = getProviderConfig(settings.provider);
  const apiUrl = String(settings.apiUrl || "").trim();
  return apiUrl || config.defaultApiUrl;
}

function getEffectiveModel(settings) {
  const config = getProviderConfig(settings.provider);
  const model = String(settings.model || "").trim();
  return model || config.defaultModel;
}

function applyProviderDefaults(settings, force) {
  const normalizedProvider = normalizeProvider(settings.provider);
  const providerConfig = getProviderConfig(normalizedProvider);
  const next = {
    ...settings,
    provider: normalizedProvider
  };

  if (force || !String(next.apiUrl || "").trim()) {
    next.apiUrl = providerConfig.defaultApiUrl;
  }
  if (force || !String(next.model || "").trim()) {
    next.model = providerConfig.defaultModel;
  }

  return next;
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

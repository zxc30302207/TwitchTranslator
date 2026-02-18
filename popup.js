const PROVIDER_PRESETS = Object.freeze({
  google_free: {
    label: "免 API",
    needsApiKey: false,
    apiKeyLabel: "API Key（不需要）",
    apiKeyPlaceholder: "免填",
    defaultApiUrl: "",
    defaultModel: "",
    endpointRule: null
  },
  openai: {
    label: "OpenAI",
    needsApiKey: true,
    apiKeyLabel: "OpenAI API Key",
    apiKeyPlaceholder: "sk-...",
    defaultApiUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4.1-mini",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.openai.com"]
    }
  },
  openrouter: {
    label: "OpenRouter",
    needsApiKey: true,
    apiKeyLabel: "OpenRouter API Key",
    apiKeyPlaceholder: "sk-or-...",
    defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["openrouter.ai"]
    }
  },
  groq: {
    label: "Groq",
    needsApiKey: true,
    apiKeyLabel: "Groq API Key",
    apiKeyPlaceholder: "gsk_...",
    defaultApiUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.1-8b-instant",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.groq.com"]
    }
  },
  deepseek: {
    label: "DeepSeek",
    needsApiKey: true,
    apiKeyLabel: "DeepSeek API Key",
    apiKeyPlaceholder: "sk-...",
    defaultApiUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.deepseek.com"]
    }
  },
  gemini: {
    label: "Google Gemini",
    needsApiKey: true,
    apiKeyLabel: "Google AI API Key",
    apiKeyPlaceholder: "AIza...",
    defaultApiUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["generativelanguage.googleapis.com"]
    }
  },
  anthropic: {
    label: "Anthropic Claude",
    needsApiKey: true,
    apiKeyLabel: "Anthropic API Key",
    apiKeyPlaceholder: "sk-ant-...",
    defaultApiUrl: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-3-5-haiku-latest",
    endpointRule: {
      allowedProtocols: ["https:"],
      allowedHosts: ["api.anthropic.com"]
    }
  },
  ollama: {
    label: "Ollama（本機）",
    needsApiKey: false,
    apiKeyLabel: "API Key（通常不需要）",
    apiKeyPlaceholder: "可留空",
    defaultApiUrl: "http://127.0.0.1:11434/v1/chat/completions",
    defaultModel: "qwen2.5:7b",
    endpointRule: {
      allowedProtocols: ["http:", "https:"],
      allowedHosts: ["127.0.0.1", "localhost", "::1"]
    }
  }
});

const DEFAULT_SYNC_SETTINGS = Object.freeze({
  enabled: true,
  provider: "google_free",
  apiUrl: "",
  model: "",
  temperature: 0.2,
  translationStyle: "natural_taiwan",
  minChars: 2
});

const DEFAULT_LOCAL_SETTINGS = Object.freeze({
  apiKey: ""
});

const TRANSLATION_STYLES = new Set(["natural_taiwan", "faithful"]);
const MAX_MODEL_LENGTH = 120;
const MAX_API_URL_LENGTH = 512;
const MAX_API_KEY_LENGTH = 512;

const enabledInput = document.getElementById("enabled");
const styleSelect = document.getElementById("translationStyle");
const apiStatus = document.getElementById("apiStatus");
const settingsForm = document.getElementById("settingsForm");
const clearApiKeyButton = document.getElementById("clearApiKey");
const saveStatus = document.getElementById("saveStatus");
const providerFields = document.getElementById("providerFields");
const apiKeyLabel = document.getElementById("apiKeyLabel");

const fields = {
  provider: document.getElementById("provider"),
  apiKey: document.getElementById("apiKey"),
  apiUrl: document.getElementById("apiUrl"),
  model: document.getElementById("model"),
  temperature: document.getElementById("temperature"),
  minChars: document.getElementById("minChars")
};

initialize().catch((error) => {
  apiStatus.textContent = `讀取設定失敗: ${error instanceof Error ? error.message : "未知錯誤"}`;
});

enabledInput.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledInput.checked });
});

styleSelect.addEventListener("change", async () => {
  const translationStyle = TRANSLATION_STYLES.has(styleSelect.value)
    ? styleSelect.value
    : DEFAULT_SYNC_SETTINGS.translationStyle;
  styleSelect.value = translationStyle;
  await chrome.storage.sync.set({ translationStyle });
});

fields.provider.addEventListener("change", () => {
  const provider = normalizeProvider(fields.provider.value);
  updateProviderUi(provider, { overwriteWithPreset: true, applyDefaultsIfEmpty: false });
  renderProviderStatus({ provider, apiKey: fields.apiKey.value });
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = collectSettingsFromForm();
  if (!payload) {
    return;
  }

  await persistSettings(payload);
  renderSaveStatus(`已儲存 ${getProviderPreset(payload.provider).label} 設定。`, false);
  renderProviderStatus(payload);
});

clearApiKeyButton.addEventListener("click", async () => {
  fields.apiKey.value = "";
  await chrome.storage.local.set({ apiKey: "" });
  await chrome.storage.sync.remove("apiKey");
  renderSaveStatus("API Key 已清除。", false);
  renderProviderStatus({ provider: normalizeProvider(fields.provider.value), apiKey: "" });
});

async function initialize() {
  const [syncSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS)
  ]);

  const settings = {
    ...DEFAULT_SYNC_SETTINGS,
    ...syncSettings,
    apiKey: sanitizeApiKey(localSettings.apiKey)
  };

  enabledInput.checked = Boolean(settings.enabled);

  const translationStyle = TRANSLATION_STYLES.has(settings.translationStyle)
    ? settings.translationStyle
    : DEFAULT_SYNC_SETTINGS.translationStyle;
  styleSelect.value = translationStyle;

  const provider = normalizeProvider(settings.provider);
  fields.provider.value = provider;
  fields.apiKey.value = settings.apiKey;
  fields.apiUrl.value = sanitizeApiUrl(settings.apiUrl);
  fields.model.value = sanitizeModel(settings.model);
  fields.temperature.value = String(toNumberInRange(settings.temperature, 0, 1, 0.2));
  fields.minChars.value = String(toIntegerInRange(settings.minChars, 1, 20, 2));

  updateProviderUi(provider, { overwriteWithPreset: false, applyDefaultsIfEmpty: true });
  renderProviderStatus(settings);
}

async function persistSettings(payload) {
  const syncPayload = {
    enabled: Boolean(enabledInput.checked),
    provider: payload.provider,
    apiUrl: payload.apiUrl,
    model: payload.model,
    temperature: payload.temperature,
    translationStyle: payload.translationStyle,
    minChars: payload.minChars
  };

  await Promise.all([
    chrome.storage.sync.set(syncPayload),
    chrome.storage.local.set({ apiKey: payload.apiKey }),
    chrome.storage.sync.remove("apiKey")
  ]);
}

function collectSettingsFromForm() {
  const provider = normalizeProvider(fields.provider.value);
  const preset = getProviderPreset(provider);
  const minChars = toIntegerInRange(fields.minChars.value, 1, 20, NaN);

  if (!Number.isInteger(minChars)) {
    renderSaveStatus("最小字數必須是 1 到 20 的整數。", true);
    return null;
  }

  const translationStyle = TRANSLATION_STYLES.has(styleSelect.value)
    ? styleSelect.value
    : DEFAULT_SYNC_SETTINGS.translationStyle;
  styleSelect.value = translationStyle;

  if (provider === "google_free") {
    return {
      provider,
      apiKey: "",
      apiUrl: "",
      model: "",
      temperature: DEFAULT_SYNC_SETTINGS.temperature,
      translationStyle,
      minChars
    };
  }

  const apiKey = sanitizeApiKey(fields.apiKey.value);
  const apiUrl = sanitizeApiUrl(fields.apiUrl.value) || preset.defaultApiUrl;
  const model = sanitizeModel(fields.model.value) || preset.defaultModel;
  const temperature = toNumberInRange(fields.temperature.value, 0, 1, NaN);

  if (preset.needsApiKey && !apiKey) {
    renderSaveStatus(`${preset.label} 需要 API Key。`, true);
    return null;
  }

  const endpointValidation = validateProviderEndpoint(provider, apiUrl);
  if (!endpointValidation.ok) {
    renderSaveStatus(endpointValidation.error, true);
    return null;
  }

  if (!model) {
    renderSaveStatus("Model 不能空白。", true);
    return null;
  }

  if (!Number.isFinite(temperature)) {
    renderSaveStatus("Temperature 必須在 0 到 1 之間。", true);
    return null;
  }

  return {
    provider,
    apiKey,
    apiUrl: endpointValidation.url,
    model,
    temperature,
    translationStyle,
    minChars
  };
}

function updateProviderUi(provider, options) {
  const { overwriteWithPreset, applyDefaultsIfEmpty } = options;
  const preset = getProviderPreset(provider);
  const shouldShowProviderFields = provider !== "google_free";

  providerFields.classList.toggle("is-hidden", !shouldShowProviderFields);
  clearApiKeyButton.disabled = !shouldShowProviderFields;

  apiKeyLabel.textContent = preset.apiKeyLabel;
  fields.apiKey.placeholder = preset.apiKeyPlaceholder;

  if (overwriteWithPreset || (applyDefaultsIfEmpty && !fields.apiUrl.value.trim())) {
    fields.apiUrl.value = preset.defaultApiUrl;
  }
  if (overwriteWithPreset || (applyDefaultsIfEmpty && !fields.model.value.trim())) {
    fields.model.value = preset.defaultModel;
  }
  if (!Number.isFinite(Number(fields.temperature.value))) {
    fields.temperature.value = String(DEFAULT_SYNC_SETTINGS.temperature);
  }
}

function renderProviderStatus(settings) {
  const provider = normalizeProvider(settings.provider);
  const providerLabel = getProviderPreset(provider).label;
  const hasApiKey = Boolean(sanitizeApiKey(settings.apiKey));

  if (provider === "google_free") {
    apiStatus.textContent = "免 API 翻譯模式已啟用，可直接使用。";
    return;
  }

  if (getProviderPreset(provider).needsApiKey && !hasApiKey) {
    apiStatus.textContent = `${providerLabel} 未填 API Key，已自動改用免 API 翻譯。`;
    return;
  }

  apiStatus.textContent = `目前使用 ${providerLabel} 翻譯模式（API Key 僅儲存在本機）。`;
}

function renderSaveStatus(message, isError) {
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? "#ff9da8" : "#89d0ff";
}

function validateProviderEndpoint(provider, value) {
  const preset = getProviderPreset(provider);
  if (!preset.endpointRule) {
    return { ok: true, url: "" };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    return { ok: false, error: `${preset.label} API URL 格式錯誤。` };
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();

  if (!preset.endpointRule.allowedProtocols.includes(protocol)) {
    return {
      ok: false,
      error: `${preset.label} 僅允許 ${preset.endpointRule.allowedProtocols.join(" / ")} 端點。`
    };
  }

  if (!preset.endpointRule.allowedHosts.includes(hostname)) {
    return { ok: false, error: `${preset.label} 僅允許官方端點或本機 localhost。` };
  }

  return { ok: true, url: parsed.toString() };
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

function normalizeProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, provider)
    ? provider
    : "google_free";
}

function getProviderPreset(provider) {
  return PROVIDER_PRESETS[normalizeProvider(provider)];
}

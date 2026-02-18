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

const settingsForm = document.getElementById("settingsForm");
const saveStatus = document.getElementById("saveStatus");
const clearApiKeyButton = document.getElementById("clearApiKey");
const testInput = document.getElementById("testInput");
const testTranslateButton = document.getElementById("testTranslate");
const testOutput = document.getElementById("testOutput");
const providerFields = document.getElementById("providerFields");
const apiKeyLabel = document.getElementById("apiKeyLabel");

const fields = {
  provider: document.getElementById("provider"),
  apiKey: document.getElementById("apiKey"),
  apiUrl: document.getElementById("apiUrl"),
  model: document.getElementById("model"),
  temperature: document.getElementById("temperature"),
  translationStyle: document.getElementById("translationStyle"),
  minChars: document.getElementById("minChars")
};

init().catch((error) => {
  renderSaveStatus(`初始化失敗: ${error instanceof Error ? error.message : "未知錯誤"}`, true);
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = collectSettingsFromForm();
  if (!payload) {
    return;
  }

  await persistSettings(payload);
  const preset = getProviderPreset(payload.provider);
  renderSaveStatus(`已儲存 ${preset.label} 模式設定。`);
});

clearApiKeyButton.addEventListener("click", async () => {
  fields.apiKey.value = "";
  await chrome.storage.local.set({ apiKey: "" });
  await chrome.storage.sync.remove("apiKey");
  renderSaveStatus("API Key 已清除。", false);
});

fields.provider.addEventListener("change", () => {
  const provider = normalizeProvider(fields.provider.value);
  updateProviderUi(provider, { overwriteWithPreset: true, applyDefaultsIfEmpty: false });
});

testTranslateButton.addEventListener("click", async () => {
  const text = testInput.value.trim();
  if (!text) {
    testOutput.textContent = "請先輸入要測試的訊息。";
    return;
  }
  testOutput.textContent = "翻譯中...";

  chrome.runtime.sendMessage(
    {
      type: "TRANSLATE_TEXT",
      text,
      context: []
    },
    (response) => {
      if (chrome.runtime.lastError) {
        testOutput.textContent = `執行失敗: ${chrome.runtime.lastError.message}`;
        return;
      }
      if (!response || !response.ok) {
        testOutput.textContent = `執行失敗: ${response?.error || "未知錯誤"}`;
        return;
      }
      if (response.skip) {
        testOutput.textContent = `未翻譯（${response.reason || "系統判定不需要"}）`;
        return;
      }
      testOutput.textContent = response.translated || "模型未回傳翻譯內容。";
    }
  );
});

async function init() {
  const [syncSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS)
  ]);

  const settings = {
    ...DEFAULT_SYNC_SETTINGS,
    ...syncSettings,
    apiKey: sanitizeApiKey(localSettings.apiKey)
  };

  const provider = normalizeProvider(settings.provider);
  fields.provider.value = provider;
  fields.apiKey.value = settings.apiKey;
  fields.apiUrl.value = sanitizeApiUrl(settings.apiUrl);
  fields.model.value = sanitizeModel(settings.model);
  fields.temperature.value = String(toNumberInRange(settings.temperature, 0, 1, 0.2));

  const translationStyle = TRANSLATION_STYLES.has(settings.translationStyle)
    ? settings.translationStyle
    : DEFAULT_SYNC_SETTINGS.translationStyle;
  fields.translationStyle.value = translationStyle;
  fields.minChars.value = String(toIntegerInRange(settings.minChars, 1, 20, 2));

  updateProviderUi(provider, { overwriteWithPreset: false, applyDefaultsIfEmpty: true });
}

async function persistSettings(payload) {
  const syncPayload = {
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

  const translationStyle = TRANSLATION_STYLES.has(fields.translationStyle.value)
    ? fields.translationStyle.value
    : DEFAULT_SYNC_SETTINGS.translationStyle;
  fields.translationStyle.value = translationStyle;

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

function renderSaveStatus(message, isError = false) {
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

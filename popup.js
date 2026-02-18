const PROVIDER_PRESETS = Object.freeze({
  google_free: {
    label: "免 API",
    needsApiKey: false,
    apiKeyLabel: "API Key（不需要）",
    apiKeyPlaceholder: "免填",
    defaultApiUrl: "",
    defaultModel: ""
  },
  openai: {
    label: "OpenAI",
    needsApiKey: true,
    apiKeyLabel: "OpenAI API Key",
    apiKeyPlaceholder: "sk-...",
    defaultApiUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4.1-mini"
  },
  openrouter: {
    label: "OpenRouter",
    needsApiKey: true,
    apiKeyLabel: "OpenRouter API Key",
    apiKeyPlaceholder: "sk-or-...",
    defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini"
  },
  groq: {
    label: "Groq",
    needsApiKey: true,
    apiKeyLabel: "Groq API Key",
    apiKeyPlaceholder: "gsk_...",
    defaultApiUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.1-8b-instant"
  },
  deepseek: {
    label: "DeepSeek",
    needsApiKey: true,
    apiKeyLabel: "DeepSeek API Key",
    apiKeyPlaceholder: "sk-...",
    defaultApiUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat"
  },
  gemini: {
    label: "Google Gemini",
    needsApiKey: true,
    apiKeyLabel: "Google AI API Key",
    apiKeyPlaceholder: "AIza...",
    defaultApiUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash"
  },
  anthropic: {
    label: "Anthropic Claude",
    needsApiKey: true,
    apiKeyLabel: "Anthropic API Key",
    apiKeyPlaceholder: "sk-ant-...",
    defaultApiUrl: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-3-5-haiku-latest"
  },
  ollama: {
    label: "Ollama（本機）",
    needsApiKey: false,
    apiKeyLabel: "API Key（通常不需要）",
    apiKeyPlaceholder: "可留空",
    defaultApiUrl: "http://127.0.0.1:11434/v1/chat/completions",
    defaultModel: "qwen2.5:7b"
  }
});

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: "google_free",
  apiKey: "",
  apiUrl: "",
  model: "",
  temperature: 0.2,
  translationStyle: "natural_taiwan",
  minChars: 2
};

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
  await chrome.storage.sync.set({ translationStyle: styleSelect.value });
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
  await chrome.storage.sync.set(payload);
  renderSaveStatus(`已儲存 ${getProviderPreset(payload.provider).label} 設定。`, false);
  renderProviderStatus(payload);
});

clearApiKeyButton.addEventListener("click", async () => {
  fields.apiKey.value = "";
  await chrome.storage.sync.set({ apiKey: "" });
  renderSaveStatus("API Key 已清除。", false);
  renderProviderStatus({ provider: normalizeProvider(fields.provider.value), apiKey: "" });
});

async function initialize() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = Boolean(settings.enabled);
  styleSelect.value = settings.translationStyle || DEFAULT_SETTINGS.translationStyle;

  const provider = normalizeProvider(settings.provider);
  fields.provider.value = provider;
  fields.apiKey.value = settings.apiKey || "";
  fields.apiUrl.value = settings.apiUrl || "";
  fields.model.value = settings.model || "";
  fields.temperature.value = String(
    Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2
  );
  fields.minChars.value = String(Number(settings.minChars || 2));

  updateProviderUi(provider, { overwriteWithPreset: false, applyDefaultsIfEmpty: true });
  renderProviderStatus(settings);
}

function collectSettingsFromForm() {
  const provider = normalizeProvider(fields.provider.value);
  const preset = getProviderPreset(provider);
  const minChars = Number(fields.minChars.value);

  if (!Number.isInteger(minChars) || minChars < 1 || minChars > 20) {
    renderSaveStatus("最小字數必須是 1 到 20 的整數。", true);
    return null;
  }

  if (provider === "google_free") {
    return {
      provider,
      apiKey: "",
      apiUrl: "",
      model: "",
      temperature: DEFAULT_SETTINGS.temperature,
      translationStyle: styleSelect.value,
      minChars
    };
  }

  const apiKey = fields.apiKey.value.trim();
  const apiUrl = fields.apiUrl.value.trim() || preset.defaultApiUrl;
  const model = fields.model.value.trim() || preset.defaultModel;
  const temperature = Number(fields.temperature.value);

  if (preset.needsApiKey && !apiKey) {
    renderSaveStatus(`${preset.label} 需要 API Key。`, true);
    return null;
  }
  if (!apiUrl || !isHttpUrl(apiUrl)) {
    renderSaveStatus("API URL 格式錯誤。", true);
    return null;
  }
  if (!model) {
    renderSaveStatus("Model 不能空白。", true);
    return null;
  }
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    renderSaveStatus("Temperature 必須在 0 到 1 之間。", true);
    return null;
  }

  return {
    provider,
    apiKey,
    apiUrl,
    model,
    temperature,
    translationStyle: styleSelect.value,
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
    fields.temperature.value = String(DEFAULT_SETTINGS.temperature);
  }
}

function renderProviderStatus(settings) {
  const provider = normalizeProvider(settings.provider);
  const providerLabel = getProviderPreset(provider).label;
  const hasApiKey = Boolean(String(settings.apiKey || "").trim());

  if (provider === "google_free") {
    apiStatus.textContent = "免 API 翻譯模式已啟用，可直接使用。";
    return;
  }

  if (getProviderPreset(provider).needsApiKey && !hasApiKey) {
    apiStatus.textContent = `${providerLabel} 未填 API Key，已自動改用免 API 翻譯。`;
    return;
  }

  apiStatus.textContent = `目前使用 ${providerLabel} 翻譯模式。`;
}

function renderSaveStatus(message, isError) {
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? "#ff9da8" : "#89d0ff";
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function normalizeProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, provider)
    ? provider
    : "google_free";
}

function getProviderPreset(provider) {
  return PROVIDER_PRESETS[normalizeProvider(provider)];
}

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
  await chrome.storage.sync.set(payload);
  const preset = getProviderPreset(payload.provider);
  renderSaveStatus(`已儲存 ${preset.label} 模式設定。`);
});

clearApiKeyButton.addEventListener("click", async () => {
  fields.apiKey.value = "";
  await chrome.storage.sync.set({ apiKey: "" });
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
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const provider = normalizeProvider(settings.provider);
  fields.provider.value = provider;
  fields.apiKey.value = settings.apiKey || "";
  fields.apiUrl.value = settings.apiUrl || "";
  fields.model.value = settings.model || "";
  fields.temperature.value = String(
    Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2
  );
  fields.translationStyle.value = settings.translationStyle || DEFAULT_SETTINGS.translationStyle;
  fields.minChars.value = String(Number(settings.minChars || 2));

  updateProviderUi(provider, { overwriteWithPreset: false, applyDefaultsIfEmpty: true });
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
      translationStyle: fields.translationStyle.value,
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
    translationStyle: fields.translationStyle.value,
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

function renderSaveStatus(message, isError = false) {
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

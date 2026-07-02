const DEFAULT_GENERAL_SETTINGS = {
  primaryLang: "en",
  secondaryLang: "",
  showSidebar: true,
  pinSidebar: false,
  playWordAudio: true,
  enableAiTooltip: true,
  preferredAiProvider: "auto",
};

const DEFAULT_LOCAL_SETTINGS = {
  googleAiStudioApiKey: "",
  groqApiKey: "",
};

const DEBUG_LOGS_KEY = "debugLogs";
const DEBUG_LOGS_MAX = 400;

const els = {
  saveBtn: document.getElementById("saveBtn"),
  saveStatus: document.getElementById("saveStatus"),
  form: document.getElementById("optionsForm"),
  primaryLang: document.getElementById("primaryLang"),
  secondaryLang: document.getElementById("secondaryLang"),
  showSidebar: document.getElementById("showSidebar"),
  pinSidebar: document.getElementById("pinSidebar"),
  playWordAudio: document.getElementById("playWordAudio"),
  enableAiTooltip: document.getElementById("enableAiTooltip"),
  googleAiStudioApiKey: document.getElementById("googleAiStudioApiKey"),
  groqApiKey: document.getElementById("groqApiKey"),
  toggleGoogleKey: document.getElementById("toggleGoogleKey"),
  toggleGroqKey: document.getElementById("toggleGroqKey"),

  debugSectionToggle: document.getElementById("debugSectionToggle"),
  debugSectionBody: document.getElementById("debugSectionBody"),
  debugLogOutput: document.getElementById("debugLogOutput"),
  debugCopyBtn: document.getElementById("debugCopyBtn"),
  debugDownloadBtn: document.getElementById("debugDownloadBtn"),
  debugClearBtn: document.getElementById("debugClearBtn"),
};

function maskSensitive(value) {
  if (typeof value !== "string") return value;
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

function sanitizeForLog(payload) {
  if (payload == null) return payload;

  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(payload));
  } catch (_) {
    return { note: "unserializable payload" };
  }

  function walk(obj) {
    if (!obj || typeof obj !== "object") return obj;

    for (const key of Object.keys(obj)) {
      const value = obj[key];

      if (key === "googleAiStudioApiKey" || key === "groqApiKey") {
        obj[key] = value ? maskSensitive(value) : "";
        continue;
      }

      if (typeof value === "object" && value !== null) {
        walk(value);
      }
    }

    return obj;
  }

  return walk(cloned);
}

function debugLog(scope, message, payload = null) {
  const time = new Date().toISOString();
  const safePayload = sanitizeForLog(payload);
  console.log(`[ATVB][${time}][${scope}] ${message}`, safePayload ?? "");
  return { time, scope, message, payload: safePayload };
}

async function appendDebugLog(line) {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);

  debugLogs.push(line);

  if (debugLogs.length > DEBUG_LOGS_MAX) {
    debugLogs.splice(0, debugLogs.length - DEBUG_LOGS_MAX);
  }

  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
}

function formatDebugLine(line) {
  const payloadText =
    line.payload != null ? ` ${JSON.stringify(line.payload)}` : "";
  return `[${line.time}] [${line.scope}] ${line.message}${payloadText}`;
}

async function renderDebugLogs() {
  if (!els.debugLogOutput) return;

  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);

  els.debugLogOutput.value = debugLogs.map(formatDebugLine).join("\n");
  els.debugLogOutput.scrollTop = els.debugLogOutput.scrollHeight;
}

async function copyDebugLogs() {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);

  const text = debugLogs.map(formatDebugLine).join("\n");
  await navigator.clipboard.writeText(text);

  const line = debugLog("options", "Copied debug logs", {
    lineCount: debugLogs.length,
  });
  await appendDebugLog(line);
  await renderDebugLogs();
  showSaveStatus("デバッグログをコピーしました");
}

async function downloadDebugLogs() {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);

  const text = debugLogs.map(formatDebugLine).join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `atvb-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  const line = debugLog("options", "Downloaded debug logs", {
    lineCount: debugLogs.length,
  });
  await appendDebugLog(line);
  await renderDebugLogs();
  showSaveStatus("デバッグログをダウンロードしました");
}

async function clearDebugLogs() {
  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: [] });
  if (els.debugLogOutput) {
    els.debugLogOutput.value = "";
  }

  const line = debugLog("options", "Cleared debug logs");
  await appendDebugLog(line);
  await renderDebugLogs();
  showSaveStatus("デバッグログをクリアしました");
}

function getPreferredAiProvider() {
  const checked = document.querySelector(
    'input[name="preferredAiProvider"]:checked',
  );
  return checked ? checked.value : "auto";
}

function setPreferredAiProvider(value) {
  const target =
    document.querySelector(
      `input[name="preferredAiProvider"][value="${value}"]`,
    ) ||
    document.querySelector('input[name="preferredAiProvider"][value="auto"]');
  if (target) target.checked = true;
}

function showSaveStatus(message, isError = false) {
  els.saveStatus.textContent = message;
  els.saveStatus.style.color = isError ? "#ff8b8b" : "#7bd88f";
  clearTimeout(showSaveStatus._timer);
  showSaveStatus._timer = setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 2800);
}

function toggleSecretInput(inputEl, buttonEl) {
  const show = inputEl.type === "password";
  inputEl.type = show ? "text" : "password";
  buttonEl.textContent = show ? "非表示" : "表示";
}

async function loadSettings() {
  const lineStart = debugLog("options", "Loading settings");
  await appendDebugLog(lineStart);

  const [general, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_GENERAL_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS),
  ]);

  els.primaryLang.value = general.primaryLang;
  els.secondaryLang.value = general.secondaryLang;
  els.showSidebar.checked = Boolean(general.showSidebar);
  els.pinSidebar.checked = Boolean(general.pinSidebar);
  els.playWordAudio.checked = Boolean(general.playWordAudio);
  els.enableAiTooltip.checked = Boolean(general.enableAiTooltip);
  setPreferredAiProvider(general.preferredAiProvider);

  els.googleAiStudioApiKey.value = local.googleAiStudioApiKey || "";
  els.groqApiKey.value = local.groqApiKey || "";

  const lineLoadedGeneral = debugLog(
    "options",
    "Loaded general settings",
    general,
  );
  await appendDebugLog(lineLoadedGeneral);

  const lineLoadedLocal = debugLog("options", "Loaded API key flags", {
    hasGoogleAiStudioApiKey: !!local.googleAiStudioApiKey,
    hasGroqApiKey: !!local.groqApiKey,
  });
  await appendDebugLog(lineLoadedLocal);

  const lineProvider = debugLog("options", "Loaded preferred AI provider", {
    preferredAiProvider: general.preferredAiProvider,
  });
  await appendDebugLog(lineProvider);

  await renderDebugLogs();
}

async function saveSettings() {
  const primaryLang = els.primaryLang.value;
  if (!primaryLang) {
    const line = debugLog("options", "Save blocked: primaryLang missing");
    await appendDebugLog(line);

    showSaveStatus("勉強している言語を選択してください", true);
    els.primaryLang.focus();
    await renderDebugLogs();
    return;
  }

  const generalSettings = {
    primaryLang,
    secondaryLang: els.secondaryLang.value,
    showSidebar: els.showSidebar.checked,
    pinSidebar: els.pinSidebar.checked,
    playWordAudio: els.playWordAudio.checked,
    enableAiTooltip: els.enableAiTooltip.checked,
    preferredAiProvider: getPreferredAiProvider(),
  };

  const localSettings = {
    googleAiStudioApiKey: els.googleAiStudioApiKey.value.trim(),
    groqApiKey: els.groqApiKey.value.trim(),
  };

  const lineGeneral = debugLog(
    "options",
    "Saving general settings",
    generalSettings,
  );
  await appendDebugLog(lineGeneral);

  const lineApiFlags = debugLog("options", "Saving API key flags", {
    hasGoogleAiStudioApiKey: !!localSettings.googleAiStudioApiKey,
    hasGroqApiKey: !!localSettings.groqApiKey,
  });
  await appendDebugLog(lineApiFlags);

  if (!generalSettings.secondaryLang) {
    const lineSecondaryEmpty = debugLog(
      "options",
      "secondaryLang is empty; content fallback expected",
      {
        secondaryLang: generalSettings.secondaryLang,
      },
    );
    await appendDebugLog(lineSecondaryEmpty);
  }

  const lineProvider = debugLog("options", "Saving preferred AI provider", {
    preferredAiProvider: generalSettings.preferredAiProvider,
  });
  await appendDebugLog(lineProvider);

  await Promise.all([
    chrome.storage.sync.set(generalSettings),
    chrome.storage.local.set(localSettings),
  ]);

  showSaveStatus("設定を保存しました");

  const lineDone = debugLog("options", "Settings saved successfully");
  await appendDebugLog(lineDone);
  await renderDebugLogs();
}

function bindEvents() {
  els.saveBtn.addEventListener("click", saveSettings);

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings();
  });

  els.toggleGoogleKey.addEventListener("click", () => {
    toggleSecretInput(els.googleAiStudioApiKey, els.toggleGoogleKey);
  });

  els.toggleGroqKey.addEventListener("click", () => {
    toggleSecretInput(els.groqApiKey, els.toggleGroqKey);
  });

  if (els.debugCopyBtn) {
    els.debugCopyBtn.addEventListener("click", copyDebugLogs);
  }

  if (els.debugDownloadBtn) {
    els.debugDownloadBtn.addEventListener("click", downloadDebugLogs);
  }

  if (els.debugClearBtn) {
    els.debugClearBtn.addEventListener("click", clearDebugLogs);
  }

  if (els.debugSectionToggle && els.debugSectionBody) {
    els.debugSectionToggle.addEventListener("click", () => {
      const isHidden = els.debugSectionBody.hidden;
      els.debugSectionBody.hidden = !isHidden;
      els.debugSectionToggle.textContent = isHidden ? "▲" : "▼";
      els.debugSectionToggle.setAttribute("aria-expanded", String(isHidden));
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();

  const line = debugLog("options", "options page initialized");
  await appendDebugLog(line);

  await loadSettings();
});

// =============================================================
// popup.js - Popup UI for subtitle language settings (v2.6.0)
// -------------------------------------------------------------
// Responsibilities:
// - Show a fixed supported-language list for primary/secondary.
// - Allow empty secondaryLang as "Browser language" in stored spec.
// - Treat raw stored settings as the source of truth for setup completion.
// - Require primary + secondary selection for initial setup completion.
// - Disallow selecting the same language for primary and secondary.
// - Save settings to chrome.storage.sync.
// - Notify the active Apple TV+ tab immediately after save.
// - Keep debug logging behavior for troubleshooting.
// =============================================================

const SUPPORTED_LANGS = [
  { lang: "en", label: "English" },
  { lang: "ja", label: "日本語" },
  { lang: "zh", label: "中文" },
  { lang: "ko", label: "한국어" },
  { lang: "fr", label: "Français" },
  { lang: "de", label: "Deutsch" },
  { lang: "es", label: "Español" },
];

const GENERAL_KEYS = [
  "primaryLang",
  "secondaryLang",
  "showSidebar",
  "pinSidebar",
  "playWordAudio",
  "enableAiTooltip",
  "preferredAiProvider",
];

const DEBUG_LOGS_KEY = "debugLogs";
const DEBUG_LOGS_MAX = 400;

const primarySel = document.getElementById("primary-lang");
const secondarySel = document.getElementById("secondary-lang");
const applyBtn = document.getElementById("apply-btn");
const statusEl = document.getElementById("status");
const openOptionsBtn = document.getElementById("open-options-btn");
const noticeEl = document.getElementById("language-setup-notice");

let isLanguageSelectionIncomplete = true;

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

function formatLanguageLabel(lang) {
  return lang.label ? `${lang.label} (${lang.lang})` : lang.lang;
}

function populateSelects(langs, savedPrimary = "en", savedSecondary = "") {
  [primarySel, secondarySel].forEach((sel, idx) => {
    const saved = idx === 0 ? savedPrimary : savedSecondary;
    sel.innerHTML = "";

    if (idx === 1) {
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "Browser language";
      if (saved === "") emptyOpt.selected = true;
      sel.appendChild(emptyOpt);
    }

    langs.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.lang;
      opt.textContent = formatLanguageLabel(l);
      if (l.lang === saved) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function getValidationResult() {
  const primaryLang = String(primarySel.value || "").trim();
  const secondaryLang = String(secondarySel.value || "").trim();

  if (!primaryLang) {
    return {
      ok: false,
      message: "主言語を選択してください。",
    };
  }

  if (!secondaryLang) {
    return {
      ok: false,
      message: "副言語を選択してください。",
    };
  }

  if (primaryLang === secondaryLang) {
    return {
      ok: false,
      message: "主言語と副言語には別の言語を選択してください。",
    };
  }

  return {
    ok: true,
    message: "",
  };
}

function updatePopupUI() {
  const validation = getValidationResult();

  applyBtn.disabled = !validation.ok;

  if (noticeEl) {
    noticeEl.style.display = isLanguageSelectionIncomplete ? "block" : "none";
  }

  if (!validation.ok) {
    statusEl.textContent = validation.message;
    return;
  }

  statusEl.textContent = "";
}

async function notifyActiveAppleTvTab(settingsToSend) {
  const lineNotifyStart = debugLog(
    "popup",
    "Dispatching APPLY_SETTINGS_TO_APPLE_TV",
    settingsToSend,
  );
  await appendDebugLog(lineNotifyStart);

  chrome.runtime.sendMessage(
    {
      type: "APPLY_SETTINGS_TO_APPLE_TV",
      reason: "popup_save",
      settings: settingsToSend,
    },
    async (response) => {
      if (chrome.runtime.lastError) {
        const lineSendError = debugLog(
          "popup",
          "APPLY_SETTINGS_TO_APPLE_TV failed",
          {
            error: chrome.runtime.lastError.message,
          },
        );
        await appendDebugLog(lineSendError);

        statusEl.textContent =
          "✓ Saved. Message delivery failed, but settings are stored.";
        setTimeout(() => window.close(), 1500);
        return;
      }

      if (!response?.ok) {
        const lineDispatchFailed = debugLog(
          "popup",
          "APPLY_SETTINGS_TO_APPLE_TV rejected",
          {
            response,
          },
        );
        await appendDebugLog(lineDispatchFailed);

        statusEl.textContent =
          "✓ Saved. Could not apply now, retry on Apple TV+ tab.";
        setTimeout(() => window.close(), 1500);
        return;
      }

      const lineSendOk = debugLog(
        "popup",
        "APPLY_SETTINGS_TO_APPLE_TV success",
        {
          response: response || null,
          settings: settingsToSend,
        },
      );
      await appendDebugLog(lineSendOk);

      statusEl.textContent = "✓ Saved and applied.";
      setTimeout(() => window.close(), 1000);
    },
  );
}

async function initPopup() {
  const lineInit = debugLog("popup", "popup initialized");
  await appendDebugLog(lineInit);

  chrome.storage.sync.get(GENERAL_KEYS, async (result) => {
    const hasStoredPrimaryLang = Boolean(result.primaryLang);
    const hasStoredSecondaryLang = Boolean(result.secondaryLang);

    isLanguageSelectionIncomplete = !(
      hasStoredPrimaryLang && hasStoredSecondaryLang
    );

    const savedPrimary = result.primaryLang || "en";
    const savedSecondary = result.secondaryLang ?? "";

    const lineLoaded = debugLog("popup", "Loaded general settings", {
      ...result,
      hasStoredPrimaryLang,
      hasStoredSecondaryLang,
      isLanguageSelectionIncomplete,
    });
    await appendDebugLog(lineLoaded);

    populateSelects(SUPPORTED_LANGS, savedPrimary, savedSecondary);

    const lineFixed = debugLog("popup", "Using fixed language list", {
      languageCount: SUPPORTED_LANGS.length,
      primaryLang: savedPrimary,
      secondaryLang: savedSecondary,
      isLanguageSelectionIncomplete,
    });
    await appendDebugLog(lineFixed);

    updatePopupUI();
  });
}

applyBtn.addEventListener("click", async () => {
  const validation = getValidationResult();

  if (!validation.ok) {
    statusEl.textContent = validation.message;

    const lineBlocked = debugLog(
      "popup",
      "Saving popup settings blocked by validation",
      {
        primaryLang: primarySel.value,
        secondaryLang: secondarySel.value,
        validationMessage: validation.message,
      },
    );
    await appendDebugLog(lineBlocked);
    return;
  }

  const primaryLang = primarySel.value;
  const secondaryLang = secondarySel.value;

  const settingsToSave = {
    primaryLang,
    secondaryLang,
  };

  const lineSave = debugLog("popup", "Saving popup settings", settingsToSave);
  await appendDebugLog(lineSave);

  chrome.storage.sync.set(settingsToSave, async () => {
    isLanguageSelectionIncomplete = false;
    updatePopupUI();

    const lineSaved = debugLog(
      "popup",
      "Saved popup settings to sync",
      settingsToSave,
    );
    await appendDebugLog(lineSaved);

    await notifyActiveAppleTvTab(settingsToSave);
  });
});

primarySel.addEventListener("change", () => {
  updatePopupUI();
});

secondarySel.addEventListener("change", () => {
  updatePopupUI();
});

if (openOptionsBtn) {
  openOptionsBtn.addEventListener("click", async () => {
    const line = debugLog("popup", "Opening options page");
    await appendDebugLog(line);
    chrome.runtime.openOptionsPage();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initPopup();
});

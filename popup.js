// =============================================================
// popup.js - 字幕言語設定用の Popup UI
// -------------------------------------------------------------
// 役割:
// - primary / secondary 用の言語一覧を、共通の language-definitions から読み込んで表示する
// - popup 上の表示言語コードと保存値を、拡張内の正本コード（例: ja, fr-FR, zh-Hant）に統一する
// - 保存済みの生 settings を初期設定完了判定の正本として使う
// - 初回設定完了には primary / secondary の両方を必須にする
// - primary / secondary に同一言語は選べないようにする
// - 設定を chrome.storage.sync に保存する
// - 拡張が有効中なら、保存後に Apple TV+ タブへ即時通知する
// - デバッグ用ログを残して調査しやすくする
//
// 補足:
// - secondaryLang の空文字は保存値としては許可せず、必須入力として扱う
// - extensionEnabled が未保存でも、popup 初回保存時に false を明示保存する
// - 拡張が OFF のときでも、言語設定保存後は popup を自動で閉じる
// - 言語一覧の正本は modules/language-definitions.js とし、このファイルでは直書きしない
// =============================================================

// 共通の言語定義ファイルから、popup / options 共通で使う言語一覧を取得する。
// 取得失敗時は空配列とし、初期化ログで異常を追えるようにする。
const SUPPORTED_LANGS =
  globalThis.ATVB?.languageDefinitions?.getSupportedLanguages?.() ?? [];

// popup 起動時に読む一般設定キー。
// extensionEnabled は保存時に個別取得・正規化するため、ここには含めない。
// ATVB_SCHEMA (modules/settings-schema.js) がこのスクリプトより先に実行されていること。
const GENERAL_KEYS = (globalThis.ATVB_SCHEMA?.SETTINGS_KEYS_SYNC ?? []).filter(
  (k) => k !== "extensionEnabled",
);

const DEBUG_LOGS_KEY = "debugLogs";
const DEBUG_LOGS_MAX = 400;

const primarySel = document.getElementById("primary-lang");
const secondarySel = document.getElementById("secondary-lang");
const applyBtn = document.getElementById("apply-btn");
const statusEl = document.getElementById("status");
const openOptionsBtn = document.getElementById("open-options-btn");
const noticeEl = document.getElementById("language-setup-notice");

// 保存済み primary / secondary が両方あるまでは初期設定未完了として扱う。
let isLanguageSelectionIncomplete = true;

// API キーなどの機微値はログへそのまま残さない。
function maskSensitive(value) {
  if (typeof value !== "string") return value;
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

// デバッグログへ保存する payload を安全化する。
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

// popup / options / content 間で見やすい共通ログ形式を作る。
function debugLog(scope, message, payload = null) {
  const time = new Date().toISOString();
  const safePayload = sanitizeForLog(payload);
  return { time, scope, message, payload: safePayload };
}

// ローカルデバッグログを末尾追加し、上限を超えた古い分は捨てる。
async function appendDebugLog(line) {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);

  debugLogs.push(line);

  if (debugLogs.length > DEBUG_LOGS_MAX) {
    debugLogs.splice(0, debugLogs.length - DEBUG_LOGS_MAX);
  }

  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
}

// popup 上の表示文字列は language-definitions 側の label をそのまま使う。
// 今回の方針では label も code 表記（例: ja, fr-FR, zh-Hant）に統一する。
function formatLanguageLabel(lang) {
  return lang?.label || lang?.code || "";
}

// primary / secondary の select を共通言語一覧で再構築する。
// secondary 側も必須入力にするため、空文字 option は置かない。
function populateSelects(langs, savedPrimary = "en", savedSecondary = "") {
  [primarySel, secondarySel].forEach((sel, idx) => {
    const saved = idx === 0 ? savedPrimary : savedSecondary;
    sel.innerHTML = "";

    langs.forEach((l) => {
      const opt = document.createElement("option");
      const value = String(l.code || l.lang || "").trim();
      opt.value = value;
      opt.textContent = formatLanguageLabel(l);

      if (value === saved) {
        opt.selected = true;
      }

      sel.appendChild(opt);
    });
  });
}

// popup 上の入力値を検証する。
// 現仕様では secondary も必須で、primary と同一言語は不可。
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

// バリデーション結果と初期設定未完了状態を popup UI へ反映する。
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

// 有効中の Apple TV+ タブへ、保存済み言語設定を即時通知する。
// 失敗時も popup は閉じ、保存自体は成功扱いにする。
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

// popup 初期表示時に保存済み settings を読み、共通言語一覧へ反映する。
async function initPopup() {
  const lineInit = debugLog("popup", "popup initialized", {
    supportedLanguageCount: SUPPORTED_LANGS.length,
  });
  await appendDebugLog(lineInit);

  if (!SUPPORTED_LANGS.length) {
    statusEl.textContent = "言語定義の読み込みに失敗しました。";
    applyBtn.disabled = true;

    const lineNoLangs = debugLog(
      "popup",
      "Language definitions are missing",
      {
        supportedLanguageCount: 0,
      },
    );
    await appendDebugLog(lineNoLangs);
    return;
  }

  chrome.storage.sync.get(GENERAL_KEYS, async (result) => {
    const schema = globalThis.ATVB_SCHEMA;
    const merged = schema ? schema.mergeSyncSettings(result) : result;
    const hasStoredPrimaryLang = Boolean(result.primaryLang);
    const hasStoredSecondaryLang = Boolean(result.secondaryLang);

    isLanguageSelectionIncomplete = !(
      hasStoredPrimaryLang && hasStoredSecondaryLang
    );

    const savedPrimary = String(merged.primaryLang || "").trim();
    const savedSecondary = String(merged.secondaryLang || "").trim();

    const lineLoaded = debugLog("popup", "Loaded general settings", {
      ...result,
      hasStoredPrimaryLang,
      hasStoredSecondaryLang,
      isLanguageSelectionIncomplete,
    });
    await appendDebugLog(lineLoaded);

    populateSelects(SUPPORTED_LANGS, savedPrimary, savedSecondary);

    const lineFixed = debugLog("popup", "Using shared language definitions", {
      languageCount: SUPPORTED_LANGS.length,
      primaryLang: savedPrimary,
      secondaryLang: savedSecondary,
      isLanguageSelectionIncomplete,
    });
    await appendDebugLog(lineFixed);

    updatePopupUI();
  });
}

// Apply 押下時は、言語設定を保存する。
// extensionEnabled が未保存なら false として正規化し、一緒に sync へ保存する。
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

  const primaryLang = String(primarySel.value || "").trim();
  const secondaryLang = String(secondarySel.value || "").trim();

  const currentSettings = await chrome.storage.sync.get(["extensionEnabled"]);
  const schema = globalThis.ATVB_SCHEMA;
  const normalizedEnabled = schema
    ? schema.normalizeExtensionEnabled(currentSettings.extensionEnabled)
    : currentSettings.extensionEnabled === true;

  const settingsToSave = {
    primaryLang,
    secondaryLang,
    extensionEnabled: normalizedEnabled,
  };

  const lineSave = debugLog("popup", "Saving popup settings", {
    ...settingsToSave,
  });
  await appendDebugLog(lineSave);

  chrome.storage.sync.set(settingsToSave, async () => {
    isLanguageSelectionIncomplete = false;
    updatePopupUI();

    const lineSaved = debugLog("popup", "Saved popup settings to sync", {
      ...settingsToSave,
    });
    await appendDebugLog(lineSaved);

    if (normalizedEnabled === true) {
      await notifyActiveAppleTvTab({
        primaryLang,
        secondaryLang,
      });
      return;
    }

    const lineDeferred = debugLog(
      "popup",
      "Skipped APPLY_SETTINGS_TO_APPLE_TV because extension is disabled",
      settingsToSave,
    );
    await appendDebugLog(lineDeferred);

    statusEl.textContent = "✓ Saved. Extension is currently off.";
    setTimeout(() => window.close(), 1000);
  });
});

// primary / secondary の変更時は都度バリデーションを更新する。
primarySel.addEventListener("change", () => {
  updatePopupUI();
});

secondarySel.addEventListener("change", () => {
  updatePopupUI();
});

// Options 画面を別タブで開く。
if (openOptionsBtn) {
  openOptionsBtn.addEventListener("click", async () => {
    const line = debugLog("popup", "Opening options page");
    await appendDebugLog(line);
    chrome.runtime.openOptionsPage();
  });
}

// DOM 構築後に popup 初期化を開始する。
document.addEventListener("DOMContentLoaded", () => {
  initPopup();
});

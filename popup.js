// =============================================================
// popup.js - 字幕言語設定用の Popup UI
// -------------------------------------------------------------
// 役割:
// - primary / secondary 用の言語一覧を、共通の language-definitions から読み込んで表示する
// - popup 上の表示言語コードと保存値を、拡張内の正本コード（例: ja, fr-FR, zh-Hant）に統一する
// - 保存済みの sync settings を初期表示へ反映する
// - 初回設定完了には primary / secondary の両方を必須にする
// - primary / secondary に同一言語は選べないようにする
// - popup から更新した言語設定を chrome.storage.sync へ保存する
// - 保存後、現在の Apple TV+ タブへ設定反映メッセージを送る
// - デバッグ用ログを残して popup / options / content 間の調査をしやすくする
//
// 補足:
// - secondaryLang の空文字は保存値として許可せず、必須入力として扱う
// - extensionEnabled は永続設定ではなく runtime state として扱うため、この popup では保存しない
// - 言語一覧の正本は modules/language-definitions.js とし、このファイルでは直書きしない
// =============================================================

// =============================================================
// 共通設定・DOM 参照
// =============================================================

// 共通の言語定義ファイルから、popup / options 共通で使う言語一覧を取得する。
// 取得失敗時は空配列とし、初期化ログで異常を追えるようにする。
const SUPPORTED_LANGS =
  globalThis.ATVB?.languageDefinitions?.getSupportedLanguages?.() ?? [];

// popup 起動時に読む sync 設定キー。
// extensionEnabled は runtime state のため、永続設定キーには含めない。
// ATVB_SCHEMA (modules/settings-schema.js) がこのスクリプトより先に実行されていること。
const GENERAL_KEYS = globalThis.ATVB_SCHEMA?.SETTINGS_KEYS_SYNC ?? [];

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

// =============================================================
// ログ補助
// =============================================================

/**
 * API キーなどの機微値をログ出力用にマスクする。
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function maskSensitive(value) {
  if (typeof value !== "string") return value;
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

/**
 * デバッグログへ保存する payload を安全化する。
 *
 * @param {unknown} payload
 * @returns {unknown}
 */
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

/**
 * popup / options / content 間で見やすい共通ログ形式を作る。
 *
 * @param {string} scope
 * @param {string} message
 * @param {unknown} [payload=null]
 * @returns {{time: string, scope: string, message: string, payload: unknown}}
 */
function debugLog(scope, message, payload = null) {
  const time = new Date().toISOString();
  const safePayload = sanitizeForLog(payload);
  return { time, scope, message, payload: safePayload };
}

/**
 * ローカルデバッグログを末尾追加し、上限を超えた古い分を捨てる。
 *
 * @param {{time: string, scope: string, message: string, payload: unknown}} line
 * @returns {Promise<void>}
 */
async function appendDebugLog(line) {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);

  debugLogs.push(line);

  if (debugLogs.length > DEBUG_LOGS_MAX) {
    debugLogs.splice(0, debugLogs.length - DEBUG_LOGS_MAX);
  }

  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
}

// =============================================================
// 言語選択 UI
// =============================================================

/**
 * popup 上の表示文字列を language-definitions 側の label から組み立てる。
 * 今回の方針では label も code 表記（例: ja, fr-FR, zh-Hant）に統一する。
 *
 * @param {{label?: string, code?: string}|null|undefined} lang
 * @returns {string}
 */
function formatLanguageLabel(lang) {
  return lang?.label || lang?.code || "";
}

/**
 * primary / secondary の select を共通言語一覧で再構築する。
 * secondary 側も必須入力にするため、空文字 option は置かない。
 *
 * @param {Array<{code?: string, lang?: string, label?: string}>} langs
 * @param {string} [savedPrimary="en"]
 * @param {string} [savedSecondary=""]
 * @returns {void}
 */
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

/**
 * popup 上の入力値を検証する。
 * 現仕様では secondary も必須で、primary と同一言語は不可。
 *
 * @returns {{ok: boolean, message: string}}
 */
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

/**
 * バリデーション結果と初期設定未完了状態を popup UI へ反映する。
 *
 * @returns {void}
 */
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

  if (isLanguageSelectionIncomplete) {
    statusEl.textContent = "主言語・副言語を選んで保存してください。";
    return;
  }

  statusEl.textContent = "";
}
// =============================================================
// Apple TV+ タブ通知
// =============================================================

/**
 * 現在アクティブな Apple TV+ タブへ設定反映メッセージを送る。
 *
 * @param {Record<string, unknown>} settings
 * @returns {Promise<void>}
 */
async function notifyActiveAppleTvTab(settings) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id || !tab.url || !tab.url.includes("tv.apple.com")) {
    const line = debugLog("popup", "Skipped notify: active tab is not Apple TV+", {
      hasTabId: Boolean(tab?.id),
      tabUrl: tab?.url ?? null,
      settings,
    });
    await appendDebugLog(line);

    statusEl.textContent = "✓ Saved. Open an Apple TV+ tab to apply now.";
    setTimeout(() => window.close(), 1000);
    return;
  }

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "SETTINGS_CHANGED",
      settings,
    },
    async () => {
      if (chrome.runtime.lastError) {
        const line = debugLog("popup", "Failed to notify Apple TV+ tab", {
          message: chrome.runtime.lastError.message,
          settings,
        });
        await appendDebugLog(line);

        statusEl.textContent = "✓ Saved. Reload the Apple TV+ tab to apply.";
        setTimeout(() => window.close(), 1200);
        return;
      }

      const line = debugLog("popup", "Notified Apple TV+ tab with popup settings", {
        settings,
      });
      await appendDebugLog(line);

      statusEl.textContent = "✓ Saved and applied.";
      setTimeout(() => window.close(), 800);
    },
  );
}

// =============================================================
// 初期化
// =============================================================

/**
 * popup 初期表示を初期化する。
 * 保存済み sync settings を読み、共通言語一覧と合わせて UI を構築する。
 *
 * @returns {Promise<void>}
 */
async function initPopup() {
  if (!SUPPORTED_LANGS.length) {
    statusEl.textContent = "言語一覧の読み込みに失敗しました。";
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

// =============================================================
// イベント
// =============================================================

// Apply 押下時は、popup で編集した言語設定だけを sync へ保存する。
// extensionEnabled は runtime state のため、popup の apply では保存しない。
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

  const settingsToSave = {
    primaryLang,
    secondaryLang,
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

    await notifyActiveAppleTvTab({
      primaryLang,
      secondaryLang,
    });
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

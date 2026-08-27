// =============================================================
// options.js - Options page logic
// version: 2.6.4
// -------------------------------------------------------------
// 役割:
// - Options 画面の設定 UI を初期化し、保存・再読込・即時反映を担当する
// - popup と同じ共通言語定義を使って primary / secondary 言語一覧を表示する
// - 一般設定(sync)とローカル設定(local)を分けて保存する
// - 保存後、現在の Apple TV+ タブへ設定変更を即時送信する
// - デバッグログの表示・絞り込み・コピー・保存・削除を扱う
// - storage 変更を監視し、デバッグログをリアルタイム更新する
// - settings 用 debug panel shell を shared builder から差し込む
//
// 補足:
// - extensionEnabled は永続設定ではなく runtime state として扱うため、この画面では保存しない
// - 設定キー・デフォルト値の正本は settings-schema.js を参照する
// - 言語一覧の正本は language-definitions.js とする
// - Debug Download は background 経由(saveAs)に統一する
// =============================================================

// =============================================================
// 共通設定・DOM 参照
// =============================================================

// popup と同じ共通言語定義を使う。
// 取得できない場合でも壊れにくいよう空配列 fallback を置く。
const SUPPORTED_LANGS =
  globalThis.ATVB?.languageDefinitions?.getSupportedLanguages?.() ?? [];

// 設定キー・デフォルト値は settings-schema.js の正本を参照する。
// extensionEnabled は runtime state のため、sync default へ含めない。
const DEFAULT_GENERAL_SETTINGS = globalThis.ATVB_SCHEMA
  ? { ...globalThis.ATVB_SCHEMA.DEFAULT_SYNC_SETTINGS }
  : {
      primaryLang: "en",
      secondaryLang: "",
      panelDefaultOpen: true,
      playWordAudio: true,
      enableAiTooltip: false,
      preferredAiProvider: "auto",
    };

const DEFAULT_LOCAL_SETTINGS = globalThis.ATVB_SCHEMA
  ? { ...globalThis.ATVB_SCHEMA.DEFAULT_LOCAL_SETTINGS }
  : {
      googleAiStudioApiKey: "",
      groqApiKey: "",
    };

// デバッグログ関連の定数。
const DEBUG_LOGS_KEY = "debugLogs";
const DEBUG_LOGS_MAX = 300;
const LOG_CATEGORIES = Object.freeze({
  SETTINGS: "settings",
  SUBTITLE: "subtitle",
  UI: "ui",
  API: "api",
  ERROR: "error",
  DEFAULT: "default",
});
const KNOWN_CATEGORIES = new Set(Object.values(LOG_CATEGORIES));
const OPTIONS_DEFAULT_VISIBLE_CATEGORIES = new Set(
  Object.values(LOG_CATEGORIES),
);

// Options 画面で使う主要 DOM 要素をまとめる。
const els = {
  saveBtn: document.getElementById("saveBtn"),
  saveStatus: document.getElementById("saveStatus"),
  form: document.getElementById("optionsForm"),
  primaryLang: document.getElementById("primaryLang"),
  secondaryLang: document.getElementById("secondaryLang"),
  panelDefaultOpen: document.getElementById("panelDefaultOpen"),
  playWordAudio: document.getElementById("playWordAudio"),
  enableAiTooltip: document.getElementById("enableAiTooltip"),
  googleAiStudioApiKey: document.getElementById("googleAiStudioApiKey"),
  groqApiKey: document.getElementById("groqApiKey"),
  toggleGoogleKey: document.getElementById("toggleGoogleKey"),
  toggleGroqKey: document.getElementById("toggleGroqKey"),
  debugPanelMount: document.getElementById("debugPanelMount"),
  debugSectionToggle: document.getElementById("debugSectionToggle"),
  debugSectionBody: document.getElementById("debugSectionBody"),
  debugLogOutput: document.getElementById("debugLogOutput"),
  debugCopyBtn: document.getElementById("debugCopyBtn"),
  debugDownloadBtn: document.getElementById("debugDownloadBtn"),
  debugClearBtn: document.getElementById("debugClearBtn"),
  debugShowAll: document.getElementById("debugShowAll"),
  debugFilterSource: document.getElementById("debugFilterSource"),
  debugFilterCategory: document.getElementById("debugFilterCategory"),
  debugFilterText: document.getElementById("debugFilterText"),
  debugLogCount: document.getElementById("debugLogCount"),
  debugRealtimeBadge: document.getElementById("debugRealtimeBadge"),
};

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
 * ログ保存前に payload を安全化する。
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
 * 未知カテゴリを ui 扱いへ寄せる。
 *
 * @param {unknown} category
 * @returns {string}
 */
function normalizeCategory(category) {
  const normalized = String(category || "")
    .trim()
    .toLowerCase();

  if (KNOWN_CATEGORIES.has(normalized)) return normalized;
  return LOG_CATEGORIES.UI;
}

/**
 * 共通的なログ構造を組み立てる。
 *
 * @param {string} scope
 * @param {string} categoryOrMessage
 * @param {unknown} [messageOrPayload]
 * @param {unknown} [payloadMaybe]
 * @returns {{time: string, source: string, category: string, message: string, payload: unknown}}
 */
function debugLog(scope, categoryOrMessage, messageOrPayload, payloadMaybe) {
  const source = String(scope || "options");
  let category = LOG_CATEGORIES.UI;
  let message = "";
  let payload = null;

  if (
    typeof categoryOrMessage === "string" &&
    KNOWN_CATEGORIES.has(String(categoryOrMessage).toLowerCase())
  ) {
    category = normalizeCategory(categoryOrMessage);
    message = String(messageOrPayload || "");
    payload = payloadMaybe ?? null;
  } else {
    message = String(categoryOrMessage || "");
    payload = messageOrPayload ?? null;
  }

  return {
    time: new Date().toISOString(),
    source,
    category,
    message,
    payload: sanitizeForLog(payload),
  };
}

/**
 * ローカルデバッグログを末尾へ追加し、上限を超えた古い分を捨てる。
 *
 * @param {{time: string, source: string, category: string, message: string, payload: unknown}} line
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
// 表示補助
// =============================================================

/**
 * 短い保存ステータスメッセージを表示する。
 *
 * @param {string} message
 * @returns {void}
 */
function showSaveStatus(message) {
  if (!els.saveStatus) return;
  els.saveStatus.textContent = message;
}

/**
 * popup / options 共通の言語ラベルを組み立てる。
 *
 * @param {{label?: string, code?: string}|null|undefined} lang
 * @returns {string}
 */
function formatLanguageLabel(lang) {
  return lang?.label || lang?.code || "";
}

/**
 * 言語 select を共通言語一覧で再構築する。
 *
 * @param {HTMLSelectElement|null} select
 * @param {Array<{code?: string, lang?: string, label?: string}>} langs
 * @param {string} selectedValue
 * @returns {void}
 */
function populateLanguageSelect(select, langs, selectedValue) {
  if (!select) return;

  select.innerHTML = "";

  langs.forEach((lang) => {
    const option = document.createElement("option");
    const value = String(lang.code || lang.lang || "").trim();
    option.value = value;
    option.textContent = formatLanguageLabel(lang);

    if (value === String(selectedValue || "").trim()) {
      option.selected = true;
    }

    select.appendChild(option);
  });
}

/**
 * 現在のフォーム入力値を読み取る。
 *
 * @returns {{
 *   primaryLang: string,
 *   secondaryLang: string,
 *   panelDefaultOpen: boolean,
 *   playWordAudio: boolean,
 *   enableAiTooltip: boolean,
 *   googleAiStudioApiKey: string,
 *   groqApiKey: string
 * }}
 */
function readFormSettings() {
  return {
    primaryLang: String(els.primaryLang?.value || "").trim(),
    secondaryLang: String(els.secondaryLang?.value || "").trim(),
    panelDefaultOpen: Boolean(els.panelDefaultOpen?.checked),
    playWordAudio: Boolean(els.playWordAudio?.checked),
    enableAiTooltip: Boolean(els.enableAiTooltip?.checked),
    googleAiStudioApiKey: String(els.googleAiStudioApiKey?.value || "").trim(),
    groqApiKey: String(els.groqApiKey?.value || "").trim(),
  };
}

/**
 * フォームへ設定値を反映する。
 *
 * @param {Record<string, unknown>} syncSettings
 * @param {Record<string, unknown>} localSettings
 * @returns {void}
 */
function applySettingsToForm(syncSettings, localSettings) {
  populateLanguageSelect(
    els.primaryLang,
    SUPPORTED_LANGS,
    String(syncSettings.primaryLang || DEFAULT_GENERAL_SETTINGS.primaryLang || "en"),
  );
  populateLanguageSelect(
    els.secondaryLang,
    SUPPORTED_LANGS,
    String(syncSettings.secondaryLang || DEFAULT_GENERAL_SETTINGS.secondaryLang || ""),
  );

  if (els.panelDefaultOpen) {
    els.panelDefaultOpen.checked = Boolean(syncSettings.panelDefaultOpen);
  }
  if (els.playWordAudio) {
    els.playWordAudio.checked = Boolean(syncSettings.playWordAudio);
  }
  if (els.enableAiTooltip) {
    els.enableAiTooltip.checked = Boolean(syncSettings.enableAiTooltip);
  }
  if (els.googleAiStudioApiKey) {
    els.googleAiStudioApiKey.value = String(
      localSettings.googleAiStudioApiKey || "",
    );
  }
  if (els.groqApiKey) {
    els.groqApiKey.value = String(localSettings.groqApiKey || "");
  }
}

/**
 * Options 画面の入力値を検証する。
 *
 * @param {ReturnType<typeof readFormSettings>} settings
 * @returns {{ok: boolean, message: string}}
 */
function validateFormSettings(settings) {
  if (!settings.primaryLang) {
    return { ok: false, message: "主言語を選択してください。" };
  }

  if (!settings.secondaryLang) {
    return { ok: false, message: "副言語を選択してください。" };
  }

  if (settings.primaryLang === settings.secondaryLang) {
    return {
      ok: false,
      message: "主言語と副言語には別の言語を選択してください。",
    };
  }

  return { ok: true, message: "" };
}

/**
 * API キー入力欄の表示/非表示を切り替える。
 *
 * @param {HTMLInputElement|null} input
 * @returns {void}
 */
function toggleSecretInputVisibility(input) {
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
}
// =============================================================
// デバッグログ表示
// =============================================================

/**
 * 既存ログを共通ログ構造へ正規化する。
 *
 * @param {any} line
 * @returns {{time: string, source: string, category: string, message: string, payload: unknown}|null}
 */
function ensureLogShape(line) {
  if (!line || typeof line !== "object") return null;

  const source = String(line.source || line.scope || "options");
  const category = normalizeCategory(line.category || line.level || "ui");
  const message = String(line.message || "");
  const payload = line.payload ?? null;
  const time = String(line.time || new Date().toISOString());

  return { time, source, category, message, payload };
}

/**
 * ローカル時刻文字列へ整形する。
 *
 * @param {string} isoString
 * @returns {string}
 */
function formatLocalTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleString();
  } catch (_) {
    return isoString;
  }
}

/**
 * クリップボード・ダウンロード向けに 1 行ログ文字列へ整形する。
 *
 * @param {any} line
 * @returns {string}
 */
function formatDebugLine(line) {
  const normalizedLine = ensureLogShape(line);
  if (!normalizedLine) return "";

  const localTime = formatLocalTimestamp(normalizedLine.time);
  const payloadText =
    normalizedLine.payload != null
      ? ` ${JSON.stringify(normalizedLine.payload)}`
      : "";
  return `[${localTime}] [${normalizedLine.category}] [${normalizedLine.source}] ${normalizedLine.message}${payloadText}`;
}

/**
 * UI 上のフィルター値を読む。
 * 字幕パネル debug panel と同じ ID 構造に合わせる。
 *
 * @returns {{source: string, category: string, text: string, showAll: boolean}}
 */
function readUiFilters() {
  return (
    globalThis.ATVB?.debugPanelRuntime?.readUiFilters?.(document) ?? {
      source: "",
      category: "",
      text: "",
      showAll: false,
    }
  );
}

/**
 * 1 行のログが現在の UI フィルターに一致するか判定する。
 *
 * @param {{time: string, source: string, category: string, message: string, payload: unknown}|null} line
 * @param {{source: string, category: string, text: string, showAll: boolean}} filter
 * @returns {boolean}
 */
function matchesDebugFilter(line, filter) {
  if (!line) return false;

  if (filter.source && line.source !== filter.source) {
    return false;
  }

  if (filter.category && line.category !== filter.category) {
    return false;
  }

  if (filter.text) {
    const haystack = [
      line.time,
      line.source,
      line.category,
      line.message,
      line.payload != null ? JSON.stringify(line.payload) : "",
    ]
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(filter.text.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * カテゴリ表示対象と UI フィルターを両方適用する。
 *
 * @param {any[]} logs
 * @param {{source: string, category: string, text: string, showAll: boolean}} [filter=readUiFilters()]
 * @returns {Array<{time: string, source: string, category: string, message: string, payload: unknown}>}
 */
function getVisibleDebugLogs(logs, filter = readUiFilters()) {
  const normalizedLogs = (logs || [])
    .map((line) => ensureLogShape(line))
    .filter(Boolean);

  const matchedLogs = normalizedLogs.filter((line) =>
    matchesDebugFilter(line, filter),
  );

  if (filter.showAll) {
    return matchedLogs;
  }

  return matchedLogs.filter((line) =>
    OPTIONS_DEFAULT_VISIBLE_CATEGORIES.has(line.category),
  );
}

/**
 * フィルター適用後のログを debug panel へ再描画する。
 *
 * @returns {Promise<void>}
 */
async function renderDebugLogs() {
  await globalThis.ATVB?.debugPanelRuntime?.update?.(document);
}

/**
 * 可視ログをクリップボードへコピーする。
 *
 * @returns {Promise<void>}
 */
async function copyDebugLogsInternal() {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);
  const visibleLogs = getVisibleDebugLogs(debugLogs);
  const text = visibleLogs.map(formatDebugLine).join("\n");
  await navigator.clipboard.writeText(text);

  const line = debugLog("options", LOG_CATEGORIES.UI, "Copied debug logs", {
    lineCount: visibleLogs.length,
  });
  await appendDebugLog(line);
  showSaveStatus("デバッグログをコピーしました");
}

/**
 * 可視ログをファイル保存する。
 *
 * @returns {Promise<void>}
 */
async function downloadDebugLogsInternal() {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);
  const visibleLogs = getVisibleDebugLogs(debugLogs);
  const text = visibleLogs.map(formatDebugLine).join("\n");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `apple-tv-bilingual-debug-${timestamp}.txt`;

  await chrome.runtime.sendMessage({
    type: "SAVE_TEXT_FILE",
    filename,
    text,
  });

  const line = debugLog("options", LOG_CATEGORIES.UI, "Downloaded debug logs", {
    lineCount: visibleLogs.length,
    filename,
  });
  await appendDebugLog(line);
  showSaveStatus("デバッグログを保存しました");
}

/**
 * 保存済みデバッグログを全削除する。
 *
 * @returns {Promise<void>}
 */
async function clearDebugLogsInternal() {
  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: [] });

  const line = debugLog("options", LOG_CATEGORIES.UI, "Cleared debug logs");
  await appendDebugLog(line);
  await renderDebugLogs();
  showSaveStatus("デバッグログを削除しました");
}


// =============================================================
// Apple TV+ タブ通知
// =============================================================

/**
 * 現在アクティブな Apple TV+ タブへ設定変更を送る。
 * options では sync/local の保存後に、反映対象だけを content へ渡す。
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
    const line = debugLog(
      "options",
      LOG_CATEGORIES.SETTINGS,
      "Skipped notifying Apple TV+ tab",
      {
        hasTabId: Boolean(tab?.id),
        tabUrl: tab?.url ?? null,
        settings,
      },
    );
    await appendDebugLog(line);
    showSaveStatus("保存しました。Apple TV+ タブを開くと反映されます。");
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
        const line = debugLog(
          "options",
          LOG_CATEGORIES.ERROR,
          "Failed to notify Apple TV+ tab",
          {
            message: chrome.runtime.lastError.message,
            settings,
          },
        );
        await appendDebugLog(line);
        showSaveStatus("保存しました。Apple TV+ タブを再読み込みすると反映されます。");
        return;
      }

      const line = debugLog(
        "options",
        LOG_CATEGORIES.SETTINGS,
        "Notified Apple TV+ tab with updated settings",
        {
          settings,
        },
      );
      await appendDebugLog(line);
      showSaveStatus("保存して現在の Apple TV+ タブへ反映しました。");
    },
  );
}

// =============================================================
// 設定の読込・保存
// =============================================================

/**
 * storage から sync/local 設定を読み、schema の merge を通して返す。
 *
 * @returns {Promise<{
 *   syncSettings: Record<string, unknown>,
 *   localSettings: Record<string, unknown>
 * }>}
 */
async function loadSettings() {
  const schema = globalThis.ATVB_SCHEMA;
  const syncKeys = schema?.SETTINGS_KEYS_SYNC ?? Object.keys(DEFAULT_GENERAL_SETTINGS);
  const localKeys = schema?.SETTINGS_KEYS_LOCAL ?? Object.keys(DEFAULT_LOCAL_SETTINGS);

  const [syncRaw, localRaw] = await Promise.all([
    chrome.storage.sync.get(syncKeys),
    chrome.storage.local.get(localKeys),
  ]);

  const syncSettings = schema
    ? schema.mergeSyncSettings(syncRaw)
    : {
        ...DEFAULT_GENERAL_SETTINGS,
        ...syncRaw,
      };

  const localSettings = schema
    ? schema.mergeLocalSettings(localRaw)
    : {
        ...DEFAULT_LOCAL_SETTINGS,
        ...localRaw,
      };

  return {
    syncSettings,
    localSettings,
  };
}

/**
 * 現在フォームに入っている値を storage へ保存する。
 * extensionEnabled は runtime state のため、options からは保存しない。
 *
 * @returns {Promise<void>}
 */
async function saveSettings() {
  const formSettings = readFormSettings();
  const validation = validateFormSettings(formSettings);

  if (!validation.ok) {
    showSaveStatus(validation.message);

    const line = debugLog(
      "options",
      LOG_CATEGORIES.SETTINGS,
      "Saving options settings blocked by validation",
      {
        ...formSettings,
        validationMessage: validation.message,
      },
    );
    await appendDebugLog(line);
    return;
  }

  const syncSettings = {
    primaryLang: formSettings.primaryLang,
    secondaryLang: formSettings.secondaryLang,
    panelDefaultOpen: formSettings.panelDefaultOpen,
    playWordAudio: formSettings.playWordAudio,
    enableAiTooltip: formSettings.enableAiTooltip,
  };

  const localSettings = {
    googleAiStudioApiKey: formSettings.googleAiStudioApiKey,
    groqApiKey: formSettings.groqApiKey,
  };

  const lineSaving = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Saving options settings",
    {
      syncSettings,
      localSettings,
    },
  );
  await appendDebugLog(lineSaving);

  await Promise.all([
    chrome.storage.sync.set(syncSettings),
    chrome.storage.local.set(localSettings),
  ]);

  const lineSaved = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Saved options settings",
    {
      syncSettings,
      localSettings,
    },
  );
  await appendDebugLog(lineSaved);

  await notifyActiveAppleTvTab(syncSettings);
}

/**
 * storage から読んだ設定をフォームへ再反映する。
 *
 * @returns {Promise<void>}
 */
async function reloadSettingsIntoForm() {
  const { syncSettings, localSettings } = await loadSettings();
  applySettingsToForm(syncSettings, localSettings);

  const line = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Reloaded settings into options form",
    {
      syncSettings,
      localSettings,
    },
  );
  await appendDebugLog(line);
}

// =============================================================
// デバッグ UI 初期化
// =============================================================

/**
 * settings 用 debug panel shell を shared builder から差し込む。
 *
 * @returns {void}
 */
function mountDebugPanelShell() {
  if (!els.debugPanelMount) return;

  globalThis.ATVB?.debugPanelRuntime?.mountShell?.(els.debugPanelMount, {
    scope: "settings",
  });
}

/**
 * debug section の開閉 UI を初期化する。
 *
 * @returns {void}
 */
function initDebugSectionToggle() {
  if (!els.debugSectionToggle || !els.debugSectionBody) return;

  els.debugSectionToggle.addEventListener("click", () => {
    const isOpen = els.debugSectionBody.hidden === false;
    els.debugSectionBody.hidden = isOpen;
    els.debugSectionToggle.setAttribute("aria-expanded", String(!isOpen));
  });
}

/**
 * デバッグログ関連ボタンとフィルター UI を初期化する。
 *
 * @returns {void}
 */
function initDebugActions() {
  els.debugCopyBtn?.addEventListener("click", async () => {
    await copyDebugLogsInternal();
  });

  els.debugDownloadBtn?.addEventListener("click", async () => {
    await downloadDebugLogsInternal();
  });

  els.debugClearBtn?.addEventListener("click", async () => {
    await clearDebugLogsInternal();
  });

  els.debugShowAll?.addEventListener("change", async () => {
    await renderDebugLogs();
  });

  els.debugFilterSource?.addEventListener("change", async () => {
    await renderDebugLogs();
  });

  els.debugFilterCategory?.addEventListener("change", async () => {
    await renderDebugLogs();
  });

  els.debugFilterText?.addEventListener("input", async () => {
    await renderDebugLogs();
  });
}

// =============================================================
// storage 監視
// =============================================================

/**
 * local storage 上の debugLogs 変更を監視し、options の表示を追従させる。
 *
 * @returns {void}
 */
function watchDebugLogStorage() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes[DEBUG_LOGS_KEY]) return;

    await renderDebugLogs();
  });
}

// =============================================================
// ページ初期化
// =============================================================

/**
 * Options 画面全体を初期化する。
 *
 * @returns {Promise<void>}
 */
async function initOptionsPage() {
  mountDebugPanelShell();
  initDebugSectionToggle();
  initDebugActions();
  watchDebugLogStorage();

  if (!SUPPORTED_LANGS.length) {
    showSaveStatus("言語一覧の読み込みに失敗しました。");

    const line = debugLog(
      "options",
      LOG_CATEGORIES.ERROR,
      "Language definitions are missing",
      {
        supportedLanguageCount: 0,
      },
    );
    await appendDebugLog(line);
    return;
  }

  await reloadSettingsIntoForm();
  await renderDebugLogs();

  const line = debugLog(
    "options",
    LOG_CATEGORIES.UI,
    "Initialized options page",
    {
      supportedLanguageCount: SUPPORTED_LANGS.length,
    },
  );
  await appendDebugLog(line);
}

// =============================================================
// イベント
// =============================================================

els.saveBtn?.addEventListener("click", async (event) => {
  event.preventDefault();
  await saveSettings();
});

els.toggleGoogleKey?.addEventListener("click", () => {
  toggleSecretInputVisibility(els.googleAiStudioApiKey);
});

els.toggleGroqKey?.addEventListener("click", () => {
  toggleSecretInputVisibility(els.groqApiKey);
});

document.addEventListener("DOMContentLoaded", () => {
  initOptionsPage();
});

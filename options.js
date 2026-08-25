// =============================================================
// options.js - Options page logic
// version: 2.6.4
// -------------------------------------------------------------
// 役割:
// - Options 画面の設定 UI を初期化し、保存・再読込・即時反映を担当する
// - popup と同じ共通言語定義を使って primary / secondary 言語一覧を表示する
// - 一般設定(sync)とローカル設定(local)を分けて保存する
// - 保存後、拡張が有効なら Apple TV+ タブへ設定を即時送信する
// - デバッグログの表示・絞り込み・コピー・保存・削除を扱う
// - storage 変更を監視し、デバッグログをリアルタイム更新する
// - settings 用 debug panel shell を shared builder から差し込む
//
// 補足:
// - 設定キー・デフォルト値の正本は settings-schema.js を参照する
// - 言語一覧の正本は language-definitions.js とする
// - Debug Download は background 経由(saveAs)に統一する
// =============================================================


// popup と同じ共通言語定義を使う。
// 取得できない場合でも壊れにくいよう空配列 fallback を置く。
const SUPPORTED_LANGS =
  globalThis.ATVB?.languageDefinitions?.getSupportedLanguages?.() ?? [];

// 設定キー・デフォルト値は settings-schema.js の正本を参照する。
const DEFAULT_GENERAL_SETTINGS = globalThis.ATVB_SCHEMA
  ? { ...globalThis.ATVB_SCHEMA.DEFAULT_SYNC_SETTINGS }
  : {
      extensionEnabled: false,
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

// API キーなどの機微値をログにそのまま出さない。
function maskSensitive(value) {
  if (typeof value !== "string") return value;
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

// ログ保存前に payload を安全化する。
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

// 未知カテゴリは ui 扱いへ寄せる。
function normalizeCategory(category) {
  const normalized = String(category || "")
    .trim()
    .toLowerCase();
  if (KNOWN_CATEGORIES.has(normalized)) return normalized;
  return LOG_CATEGORIES.UI;
}

// 共通的なログ構造を組み立てる。
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

  const time = new Date().toISOString();
  const safePayload = sanitizeForLog(payload);
  return {
    time,
    scope: source,
    source,
    category,
    message,
    payload: safePayload,
  };
}

// ログの shape を揃えて後段処理を簡単にする。
function ensureLogShape(line) {
  if (!line || typeof line !== "object") return null;
  const source = String(line.source || line.scope || "unknown");
  return {
    time: line.time || new Date().toISOString(),
    scope: source,
    source,
    category: normalizeCategory(line.category),
    message: String(line.message || ""),
    payload: sanitizeForLog(line.payload ?? null),
  };
}

// 日時表示用のゼロ埋め。
function padNumber(value, width = 2) {
  return String(value).padStart(width, "0");
}

// ローカルタイム文字列へ変換する。
function formatLocalTimestamp(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return String(timestamp || "");

  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  const milliseconds = padNumber(date.getMilliseconds(), 3);

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = padNumber(Math.floor(absOffsetMinutes / 60));
  const offsetRemainder = padNumber(absOffsetMinutes % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainder}`;
}

// debugLogs 配列へ1行追加し、上限を超えたら古いものを削る。
async function appendDebugLog(line) {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);
  debugLogs.push(line);
  if (debugLogs.length > DEBUG_LOGS_MAX) {
    debugLogs.splice(0, debugLogs.length - DEBUG_LOGS_MAX);
  }
  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
}

// 言語表示文字列を整える。
// 共通定義側が code を持つ構造を優先し、旧 lang 形式にも fallback する。
function formatLanguageLabel(lang) {
  const code = String(lang?.code || lang?.lang || "").trim();
  const label = String(lang?.label || "").trim();
  return label ? `${label} (${code})` : code;
}

// select を共通言語定義から再構築する。
function populateLangSelect(selectEl, langs, saved, allowEmpty) {
  if (!selectEl) return;

  selectEl.innerHTML = "";

  if (allowEmpty) {
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "Browser language";
    if (!saved) emptyOpt.selected = true;
    selectEl.appendChild(emptyOpt);
  }

  langs.forEach((l) => {
    const value = String(l?.code || l?.lang || "").trim();
    if (!value) return;

    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = formatLanguageLabel(l);
    if (value === saved) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

// テキスト出力用の1行ログ形式を作る。
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

// ログ削除用に内容比較しやすい署名を作る。
function buildDebugLineSignature(line) {
  const normalizedLine = ensureLogShape(line);
  if (!normalizedLine) return "";
  return JSON.stringify({
    time: normalizedLine.time,
    category: normalizedLine.category,
    source: normalizedLine.source,
    message: normalizedLine.message,
    payload: normalizedLine.payload,
  });
}

// UI 上のフィルター値を読む。
// 字幕パネル debug panel と同じ ID 構造に合わせる。
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

// 1行のログが現在の UI フィルターに一致するか判定する。
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

// カテゴリ表示対象と UI フィルターを両方適用する。
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

// ログカード DOM を1件ぶん組み立てる。
function createDebugLogItem(line) {
  const normalizedLine = ensureLogShape(line);
  if (!normalizedLine) return null;

  const item = document.createElement("article");
  item.className = "debug-log-item";
  item.dataset.category = normalizedLine.category;

  const meta = document.createElement("div");
  meta.className = "debug-log-meta";

  const time = document.createElement("span");
  time.textContent = formatLocalTimestamp(normalizedLine.time);

  const category = document.createElement("span");
  category.className = "debug-log-category";
  category.textContent = normalizedLine.category;

  const source = document.createElement("span");
  source.textContent = normalizedLine.source;

  meta.append(time, category, source);

  const message = document.createElement("div");
  message.className = "debug-log-message";
  message.textContent = normalizedLine.message || "(no message)";

  item.append(meta, message);

  if (normalizedLine.payload != null) {
    const payload = document.createElement("pre");
    payload.className = "debug-log-payload";
    payload.textContent = JSON.stringify(normalizedLine.payload, null, 2);
    item.appendChild(payload);
  }

  return item;
}

function getAllDebugLogs() {
  return chrome.storage.local
    .get(DEBUG_LOGS_KEY)
    .then(({ [DEBUG_LOGS_KEY]: debugLogs = [] }) => debugLogs);
}

function renderDebugLogItems(root, visibleLogs) {
  const output = root.getElementById("debugLogOutput");
  if (!output) return;

  visibleLogs.forEach((line) => {
    const item = createDebugLogItem(line);
    if (item) output.appendChild(item);
  });
}

function renderDebugLogEmptyState(root) {
  const output = root.getElementById("debugLogOutput");
  if (!output) return;

  const empty = document.createElement("div");
  empty.className = "debug-log-empty";
  empty.textContent = "表示できるデバッグログはまだありません。";
  output.appendChild(empty);
}

function updateDebugLogMeta(root, meta = {}) {
  const countEl = root.getElementById("debugLogCount");
  const badgeEl = root.getElementById("debugRealtimeBadge");

  if (countEl) {
    const visibleCount = Number(meta.visibleCount || 0);
    const totalCount = Number(meta.totalCount || 0);
    countEl.textContent = `${visibleCount} / ${totalCount} logs`;
  }

  if (badgeEl) {
    badgeEl.hidden = false;
    badgeEl.textContent = "LIVE";
  }
}

// フィルター適用後のログを debug panel へ再描画する。
async function renderDebugLogs() {
  await globalThis.ATVB?.debugPanelRuntime?.update?.(document);
}

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

async function downloadDebugLogsInternal() {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);
  const visibleLogs = getVisibleDebugLogs(debugLogs);
  const text = visibleLogs.map(formatDebugLine).join("\n");

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "DOWNLOAD_DEBUG_LOG", text }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: "no_response" });
    });
  });

  if (!response?.ok) {
    showSaveStatus(
      `デバッグログの保存に失敗しました: ${response?.error ?? "unknown"}`,
      true,
    );
    return;
  }

  const line = debugLog(
    "options",
    LOG_CATEGORIES.API,
    "Downloaded debug logs",
    {
      lineCount: visibleLogs.length,
      downloadId: response.downloadId ?? null,
    },
  );
  await appendDebugLog(line);
  showSaveStatus("デバッグログをダウンロードしました");
}

async function clearDebugLogsInternal() {
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);

  const visibleLogs = getVisibleDebugLogs(debugLogs);
  const visibleSignatures = new Set(
    visibleLogs.map((line) => buildDebugLineSignature(line)).filter(Boolean),
  );

  const remainingLogs = (debugLogs || [])
    .map((line) => ensureLogShape(line))
    .filter(Boolean)
    .filter((line) => !visibleSignatures.has(buildDebugLineSignature(line)));

  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: remainingLogs });
  showSaveStatus("デバッグログをクリアしました");
}

// 現在選択中の AI Provider を読む。
function getPreferredAiProvider() {
  const checked = document.querySelector(
    'input[name="preferredAiProvider"]:checked',
  );
  return checked ? checked.value : "auto";
}

// 保存済み AI Provider をラジオへ反映する。
function setPreferredAiProvider(value) {
  const target =
    document.querySelector(
      `input[name="preferredAiProvider"][value="${value}"]`,
    ) ||
    document.querySelector('input[name="preferredAiProvider"][value="auto"]');

  if (target) target.checked = true;
}

// 一時的な保存結果メッセージを表示する。
function showSaveStatus(message, isError = false) {
  els.saveStatus.textContent = message;
  els.saveStatus.style.color = isError ? "#ff8b8b" : "#7bd88f";

  clearTimeout(showSaveStatus._timer);
  showSaveStatus._timer = setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 2800);
}

// content 側へそのまま渡す設定 payload を作る。
function buildLanguageSettingsPayload(settings) {
  return {
    ...settings,
  };
}

// 拡張有効中なら Apple TV+ タブへ設定反映を依頼する。
async function dispatchSettingsChangedFromOptions(settingsPayload) {
  const lineDispatchStart = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "options dispatch APPLY_SETTINGS_TO_APPLE_TV",
    {
      settings: settingsPayload,
    },
  );
  await appendDebugLog(lineDispatchStart);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "APPLY_SETTINGS_TO_APPLE_TV",
        reason: "options_save",
        settings: settingsPayload,
      },
      async (response) => {
        if (chrome.runtime.lastError) {
          const lineError = debugLog(
            "options",
            LOG_CATEGORIES.ERROR,
            "options dispatch APPLY_SETTINGS_TO_APPLE_TV failed",
            {
              error: chrome.runtime.lastError.message,
            },
          );
          await appendDebugLog(lineError);
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        resolve(response || { ok: false, error: "no_response" });
      },
    );
  });
}

// パスワード入力欄の表示/非表示を切り替える。
function toggleSecretInput(inputEl, buttonEl) {
  const show = inputEl.type === "password";
  inputEl.type = show ? "text" : "password";
  buttonEl.textContent = show ? "非表示" : "表示";
}

// 設定を storage から読み込み UI に反映する。
async function loadSettings() {
  const lineStart = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Loading settings",
    {
      supportedLanguageCount: SUPPORTED_LANGS.length,
    },
  );
  await appendDebugLog(lineStart);

  const [general, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_GENERAL_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS),
  ]);

  populateLangSelect(
    els.primaryLang,
    SUPPORTED_LANGS,
    general.primaryLang,
    false,
  );
  populateLangSelect(
    els.secondaryLang,
    SUPPORTED_LANGS,
    general.secondaryLang,
    true,
  );

  els.panelDefaultOpen.checked = Boolean(general.panelDefaultOpen);
  els.playWordAudio.checked = Boolean(general.playWordAudio);
  els.enableAiTooltip.checked = Boolean(general.enableAiTooltip);

  setPreferredAiProvider(general.preferredAiProvider);

  els.googleAiStudioApiKey.value = local.googleAiStudioApiKey || "";
  els.groqApiKey.value = local.groqApiKey || "";

  const lineLoadedGeneral = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Loaded general settings",
    general,
  );
  await appendDebugLog(lineLoadedGeneral);

  const lineLoadedLocal = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Loaded API key flags",
    {
      hasGoogleAiStudioApiKey: !!local.googleAiStudioApiKey,
      hasGroqApiKey: !!local.groqApiKey,
    },
  );
  await appendDebugLog(lineLoadedLocal);

  const lineProvider = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Loaded preferred AI provider",
    {
      preferredAiProvider: general.preferredAiProvider,
    },
  );
  await appendDebugLog(lineProvider);

  await renderDebugLogs();
}

// フォーム入力を保存し、必要なら content 側へ即時反映する。
async function saveSettings() {
  const primaryLang = els.primaryLang.value;
  const secondaryLang = els.secondaryLang.value;

  const lineFormValues = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "options save form values",
    {
      primaryLang,
      secondaryLang,
    },
  );
  await appendDebugLog(lineFormValues);

  if (!primaryLang) {
    const line = debugLog(
      "options",
      LOG_CATEGORIES.ERROR,
      "Save blocked: primaryLang missing",
    );
    await appendDebugLog(line);
    showSaveStatus("勉強している言語を選択してください", true);
    els.primaryLang.focus();
    await renderDebugLogs();
    return;
  }

  const generalSettings = {
    primaryLang,
    secondaryLang,
    panelDefaultOpen: els.panelDefaultOpen.checked,
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
    LOG_CATEGORIES.SETTINGS,
    "Saving general settings",
    generalSettings,
  );
  await appendDebugLog(lineGeneral);

  const lineApiFlags = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Saving API key flags",
    {
      hasGoogleAiStudioApiKey: !!localSettings.googleAiStudioApiKey,
      hasGroqApiKey: !!localSettings.groqApiKey,
    },
  );
  await appendDebugLog(lineApiFlags);

  if (!generalSettings.secondaryLang) {
    const lineSecondaryEmpty = debugLog(
      "options",
      LOG_CATEGORIES.SETTINGS,
      "secondaryLang is empty; content fallback expected",
      { secondaryLang: generalSettings.secondaryLang },
    );
    await appendDebugLog(lineSecondaryEmpty);
  }

  const lineProvider = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Saving preferred AI provider",
    {
      preferredAiProvider: generalSettings.preferredAiProvider,
    },
  );
  await appendDebugLog(lineProvider);

  await Promise.all([
    chrome.storage.sync.set(generalSettings),
    chrome.storage.local.set(localSettings),
  ]);

  const savedValues = await chrome.storage.sync.get([
    "primaryLang",
    "secondaryLang",
  ]);
  const lineReadback = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "options saved values readback",
    savedValues,
  );
  await appendDebugLog(lineReadback);

  const enabledState = await chrome.storage.sync.get(["extensionEnabled"]);
  const languageSettingsPayload = buildLanguageSettingsPayload(
    generalSettings,
  );

  let dispatchResult = {
    ok: false,
    skipped: true,
    reason: "extension-disabled",
  };

  if (enabledState.extensionEnabled === true) {
    dispatchResult = await dispatchSettingsChangedFromOptions(
      languageSettingsPayload,
    );
  }

  const lineDispatchResult = debugLog(
    "options",
    dispatchResult?.ok ? LOG_CATEGORIES.SETTINGS : LOG_CATEGORIES.ERROR,
    "options dispatch APPLY_SETTINGS_TO_APPLE_TV result",
    {
      payload: languageSettingsPayload,
      extensionEnabled: enabledState.extensionEnabled,
      result: dispatchResult,
    },
  );
  await appendDebugLog(lineDispatchResult);

  if (dispatchResult?.ok) {
    showSaveStatus("Saved and applied.");
  } else if (dispatchResult?.skipped) {
    showSaveStatus("Saved. Changes apply when the extension is enabled.");
  } else {
    showSaveStatus("Saved. Open Apple TV+ tab to apply immediately.");
  }

  const lineDone = debugLog(
    "options",
    LOG_CATEGORIES.SETTINGS,
    "Settings saved successfully",
  );
  await appendDebugLog(lineDone);
  await renderDebugLogs();
}

// debugLogs の storage 更新を監視し、リアルタイムで再描画する。
function bindDebugLogRealtimeWatch() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes[DEBUG_LOGS_KEY]) return;

    renderDebugLogs().catch(() => {
      // storage 更新を伴うログ記録は再帰発火し得るため、ここでは何もしない。
    });
  });
}

// 画面上のイベントをまとめて bind する。
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
}


// -------------------------------------------------------------
// settings debug panel shell
// -------------------------------------------------------------

/**
 * settings 画面用 debug panel shell を shared builder から差し込む。
 *
 * 前提:
 * - options.html に #debugPanelMount を置く
 * - modules/debug-panel-shell.js が options.js より先に読み込まれている
 *
 * @returns {void}
 */
function mountOptionsDebugPanelShell() {
  const mountEl = els.debugPanelMount;
  if (!mountEl) return;

  const html =
    globalThis.ATVB?.debugPanelShell?.buildDebugPanelShellHTML?.({
      variant: "options",
    }) ?? "";

  if (!html) return;

  mountEl.innerHTML = html;

  els.debugSectionToggle = document.getElementById("debugSectionToggle");
  els.debugSectionBody = document.getElementById("debugSectionBody");
  els.debugLogOutput = document.getElementById("debugLogOutput");
  els.debugCopyBtn = document.getElementById("debugCopyBtn");
  els.debugDownloadBtn = document.getElementById("debugDownloadBtn");
  els.debugClearBtn = document.getElementById("debugClearBtn");
  els.debugShowAll = document.getElementById("debugShowAll");
  els.debugFilterSource = document.getElementById("debugFilterSource");
  els.debugFilterCategory = document.getElementById("debugFilterCategory");
  els.debugFilterText = document.getElementById("debugFilterText");
  els.debugLogCount = document.getElementById("debugLogCount");
  els.debugRealtimeBadge = document.getElementById("debugRealtimeBadge");
}

function mountOptionsDebugPanelRuntime() {
  globalThis.ATVB?.debugPanelRuntime?.mount?.(document, {
    variant: "options",

    getLogs: async () => getAllDebugLogs(),

    getVisibleLogs: (logs, uiFilter) => getVisibleDebugLogs(logs, uiFilter),

    getMeta: (logs, visibleLogs) => ({
      totalCount: Array.isArray(logs) ? logs.length : 0,
      visibleCount: Array.isArray(visibleLogs) ? visibleLogs.length : 0,
    }),

    renderLogItems: (root, visibleLogs) => {
      renderDebugLogItems(root, visibleLogs);
    },

    renderEmptyState: (root) => {
      renderDebugLogEmptyState(root);
    },

    updateMeta: (root, meta) => {
      updateDebugLogMeta(root, meta);
    },

    copyLogs: async () => {
      await copyDebugLogsInternal();
    },

    downloadLogs: async () => {
      await downloadDebugLogsInternal();
    },

    clearLogs: async () => {
      await clearDebugLogsInternal();
    },
  });
}

// 初期化エントリポイント。
// DOM 準備後にイベント bind、初期ログ追加、設定読込を行う。
document.addEventListener("DOMContentLoaded", async () => {
  mountOptionsDebugPanelShell();
  mountOptionsDebugPanelRuntime();
  bindEvents();
  bindDebugLogRealtimeWatch();

  const line = debugLog(
    "options",
    LOG_CATEGORIES.UI,
    "options page initialized",
  );
  await appendDebugLog(line);

  await loadSettings();
  await globalThis.ATVB?.debugPanelRuntime?.update?.(document);
});

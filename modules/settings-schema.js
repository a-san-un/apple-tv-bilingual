// =============================================================
// Apple TV+ Bilingual Subtitles - modules/settings-schema.js
//
// 役割: 設定キー・デフォルト値・正規化ルールの正本 (Step 1)
//
// 利用方法:
//   - manifest.json の content_scripts に追加して globalThis.ATVB_SCHEMA を公開する
//   - options.js / popup.js は chrome.runtime.getURL + import() で利用する
// =============================================================

(function (root) {
  "use strict";

  // -------------------------------------------------------
  // 設定キー定義
  // -------------------------------------------------------
  const SETTINGS_KEYS_SYNC = Object.freeze([
    "enabled",
    "primaryLang",
    "secondaryLang",
    "showSidebar",
    "playWordAudio",
    "enableAiTooltip",
    "preferredAiProvider",
  ]);

  const SETTINGS_KEYS_LOCAL = Object.freeze([
    "googleAiStudioApiKey",
    "groqApiKey",
  ]);

  // -------------------------------------------------------
  // デフォルト値の正本 (全ファイル共通)
  // enableAiTooltip は false に統一 (options.js の true を修正)
  // enabled は storage に保存されるが、未保存時は false
  // -------------------------------------------------------
  const DEFAULT_SYNC_SETTINGS = Object.freeze({
    enabled: false,
    primaryLang: "en",
    secondaryLang: "",
    showSidebar: true,
    playWordAudio: true,
    enableAiTooltip: false,
    preferredAiProvider: "auto",
  });

  const DEFAULT_LOCAL_SETTINGS = Object.freeze({
    googleAiStudioApiKey: "",
    groqApiKey: "",
  });

  // -------------------------------------------------------
  // 正規化ルール
  // -------------------------------------------------------

  // enabled: storage 上の値が厳密に true のときだけ true とみなす
  function normalizeEnabled(value) {
    return value === true;
  }

  // showSidebar: undefined / null のときは true (デフォルト) 扱い
  function normalizeShowSidebar(value) {
    return value !== false;
  }

  // secondaryLang のフォールバック: 空文字なら navigator.language の言語部分を使う
  // この関数は副作用なし・純粋関数
  function applySecondaryLangFallback(settings, navLanguage) {
    const result = { ...settings };
    if (!result.secondaryLang) {
      const lang = navLanguage || "en";
      result.secondaryLang = lang.toLowerCase().split("-")[0];
    }
    return result;
  }

  // sync 設定を正規化してマージする
  // stored の値を DEFAULT_SYNC_SETTINGS で補完し、enabled / showSidebar を正規化する
  function mergeSyncSettings(stored) {
    const merged = { ...DEFAULT_SYNC_SETTINGS, ...(stored || {}) };
    merged.enabled = normalizeEnabled(merged.enabled);
    // showSidebar は永続設定として保存される (panelVisible とは別)
    merged.showSidebar = normalizeShowSidebar(merged.showSidebar);
    return merged;
  }

  // language selection が完了しているか (primaryLang が空でなければ完了とみなす)
  function isLanguageSelectionReady(settings) {
    return Boolean(settings && settings.primaryLang);
  }

  // -------------------------------------------------------
  // エクスポート
  // -------------------------------------------------------
  const ATVB_SCHEMA = Object.freeze({
    SETTINGS_KEYS_SYNC,
    SETTINGS_KEYS_LOCAL,
    DEFAULT_SYNC_SETTINGS,
    DEFAULT_LOCAL_SETTINGS,
    normalizeEnabled,
    normalizeShowSidebar,
    applySecondaryLangFallback,
    mergeSyncSettings,
    isLanguageSelectionReady,
  });

  // globalThis 経由で公開 (content script / options / popup 共通)
  root.ATVB_SCHEMA = ATVB_SCHEMA;

  // ES Module 互換のために module.exports も設定する (vitest / Node.js テスト用)
  // eslint-disable-next-line no-undef
  if (typeof module !== "undefined" && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = ATVB_SCHEMA;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);

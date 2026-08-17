// =============================================================
// Apple TV+ Bilingual Subtitles - modules/settings-schema.js
// version: 2.6.3
//
// 役割:
// - 設定キー・デフォルト値・正規化ルールの正本を担当する。
// - sync / local 設定のキー定義と、保存値の merge / fallback ルールを一箇所へ集約する。
// - content / popup / options が共通の設定解釈を使えるよう globalThis.ATVB_SCHEMA を公開する。
//
// このファイルのメンテナンス方針:
// - デフォルト値の変更は DEFAULT_SYNC_SETTINGS / DEFAULT_LOCAL_SETTINGS に集約する。
// - storage から読んだ値の正規化は schema 層で完結させ、呼び出し側へ条件分岐を漏らさない。
// - secondaryLang の browser language fallback は applySecondaryLangFallback() に寄せ、
//   language-definitions.js の canonicalizeLanguageCode() を通して正本 code にそろえる。
// - popup / options / content で設定解釈がズレないよう、共通 helper を優先して再利用する。
// =============================================================

(function (root) {
  "use strict";

  // -------------------------------------------------------
  // 設定キー定義
  // -------------------------------------------------------
  const SETTINGS_KEYS_SYNC = Object.freeze([
    "extensionEnabled",
    "primaryLang",
    "secondaryLang",
    "panelDefaultOpen",
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
  // enableAiTooltip は false に統一
  // extensionEnabled は storage に保存されるが、未保存時は false
  // -------------------------------------------------------
  const DEFAULT_SYNC_SETTINGS = Object.freeze({
    extensionEnabled: false,
    primaryLang: "en",
    secondaryLang: "",
    panelDefaultOpen: true,
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

  // extensionEnabled: storage 上の値が厳密に true のときだけ true とみなす。
  function normalizeExtensionEnabled(value) {
    return value === true;
  }

  // panelDefaultOpen: undefined / null のときは true (デフォルト) 扱い。
  function normalizePanelDefaultOpen(value) {
    return value !== false;
  }

  // language-definitions.js が先に読まれていれば、その canonicalize を優先利用する。
  // 未読込時でも壊れないよう、最低限の language-part fallback を残す。
  function canonicalizeLanguageCode(value) {
    const canonicalized =
      root.ATVB?.languageDefinitions?.canonicalizeLanguageCode?.(value) || "";

    if (canonicalized) {
      return canonicalized;
    }

    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "";
    return normalized.split("-")[0] || "";
  }

  // secondaryLang が空のときだけ browser language を補完する。
  // 補完値は language-definitions.js の canonicalize を通して正本 code にそろえる。
  function applySecondaryLangFallback(settings, navLanguage) {
    const result = { ...settings };

    if (!result.secondaryLang) {
      const fallbackLanguage = canonicalizeLanguageCode(navLanguage || "en");
      result.secondaryLang = fallbackLanguage || "en";
    }

    return result;
  }

  // sync 設定を正規化してマージする。
  // stored の値を DEFAULT_SYNC_SETTINGS で補完し、extensionEnabled / panelDefaultOpen を正規化する。
  function mergeSyncSettings(stored) {
    const merged = { ...DEFAULT_SYNC_SETTINGS, ...(stored || {}) };

    merged.extensionEnabled = normalizeExtensionEnabled(merged.extensionEnabled);

    // panelDefaultOpen は永続設定として保存される (panelOpen とは別)。
    merged.panelDefaultOpen = normalizePanelDefaultOpen(merged.panelDefaultOpen);

    return merged;
  }

  // language selection が完了しているかを返す。
  // primaryLang が空でなければ完了とみなす。
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
    normalizeExtensionEnabled,
    normalizePanelDefaultOpen,
    canonicalizeLanguageCode,
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

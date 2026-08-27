// =============================================================
// Apple TV+ Bilingual Subtitles - modules/settings-schema.js
//
// 役割:
// - 永続設定のキー、デフォルト値、正規化ルールの正本を提供する。
// - sync / local の設定境界を定義し、各 UI と content script が
//   同じ保存値解釈を利用できるようにする。
// - storage 値の補完・正規化・言語 fallback を schema 層へ集約する。
//
// 公開先:
// - globalThis.ATVB_SCHEMA
//
// 設計メモ:
// - sync 設定: primaryLang, secondaryLang, panelDefaultOpen,
//              playWordAudio, enableAiTooltip, preferredAiProvider
// - local 設定: googleAiStudioApiKey, groqApiKey
// - panelDefaultOpen は永続設定、panelOpen はランタイム UI 状態。
// - extensionEnabled はセッション単位の runtime state として扱い、
//   settings schema では保存・復元・正規化しない。
// =============================================================

(function (root) {
  "use strict";

  // -------------------------------------------------------
  // persistent setting keys
  // -------------------------------------------------------

  /**
   * chrome.storage.sync に保存する設定キー。
   *
   * @type {readonly string[]}
   */
  const SETTINGS_KEYS_SYNC = Object.freeze([
    "primaryLang",
    "secondaryLang",
    "panelDefaultOpen",
    "playWordAudio",
    "enableAiTooltip",
    "preferredAiProvider",
  ]);

  /**
   * chrome.storage.local に保存する設定キー。
   *
   * @type {readonly string[]}
   */
  const SETTINGS_KEYS_LOCAL = Object.freeze([
    "googleAiStudioApiKey",
    "groqApiKey",
  ]);

  // -------------------------------------------------------
  // default values
  // -------------------------------------------------------

  /**
   * sync 設定のデフォルト値。
   *
   * extensionEnabled は永続設定ではないため含めない。
   *
   * @type {Readonly<{
   *   primaryLang: string,
   *   secondaryLang: string,
   *   panelDefaultOpen: boolean,
   *   playWordAudio: boolean,
   *   enableAiTooltip: boolean,
   *   preferredAiProvider: string
   * }>}
   */
  const DEFAULT_SYNC_SETTINGS = Object.freeze({
    primaryLang: "en",
    secondaryLang: "",
    panelDefaultOpen: true,
    playWordAudio: true,
    enableAiTooltip: false,
    preferredAiProvider: "auto",
  });

  /**
   * local 設定のデフォルト値。
   *
   * @type {Readonly<{
   *   googleAiStudioApiKey: string,
   *   groqApiKey: string
   * }>}
   */
  const DEFAULT_LOCAL_SETTINGS = Object.freeze({
    googleAiStudioApiKey: "",
    groqApiKey: "",
  });

  // -------------------------------------------------------
  // normalization
  // -------------------------------------------------------

  /**
   * panelDefaultOpen を boolean へ正規化する。
   * undefined / null を含む false 以外は、既定どおり true と扱う。
   *
   * @param {*} value
   * @returns {boolean}
   */
  function normalizePanelDefaultOpen(value) {
    return value !== false;
  }

  /**
   * 言語コードを拡張内の canonical な language-part へ正規化する。
   * language-definitions.js が利用可能な場合は、その正本 helper を優先する。
   *
   * @param {*} value
   * @returns {string}
   */
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

  /**
   * secondaryLang が未指定の場合のみ、browser language を fallback として補完する。
   *
   * この関数は入力を破壊せず、新しい settings object を返す。
   *
   * @param {Object} settings
   * @param {string} [navLanguage]
   * @returns {Object}
   */
  function applySecondaryLangFallback(settings, navLanguage) {
    const result = { ...settings };

    if (!result.secondaryLang) {
      const fallbackLanguage = canonicalizeLanguageCode(navLanguage || "en");
      result.secondaryLang = fallbackLanguage || "en";
    }

    return result;
  }

  /**
   * storage から取得した sync 設定をデフォルト値と merge し、
   * 永続設定として定義された値を正規化する。
   *
   * panelOpen / extensionEnabled などのランタイム状態は解釈しない。
   *
   * @param {Object|null|undefined} stored
   * @returns {Object}
   */
  function mergeSyncSettings(stored) {
    const merged = { ...DEFAULT_SYNC_SETTINGS, ...(stored || {}) };

    merged.panelDefaultOpen = normalizePanelDefaultOpen(merged.panelDefaultOpen);

    return merged;
  }

  // -------------------------------------------------------
  // validation
  // -------------------------------------------------------

  /**
   * 字幕言語の選択が起動可能な状態かを判定する。
   *
   * @param {Object|null|undefined} settings
   * @returns {boolean}
   */
  function isLanguageSelectionReady(settings) {
    return Boolean(settings && settings.primaryLang);
  }

  // -------------------------------------------------------
  // exports
  // -------------------------------------------------------

  const ATVB_SCHEMA = Object.freeze({
    SETTINGS_KEYS_SYNC,
    SETTINGS_KEYS_LOCAL,
    DEFAULT_SYNC_SETTINGS,
    DEFAULT_LOCAL_SETTINGS,
    normalizePanelDefaultOpen,
    canonicalizeLanguageCode,
    applySecondaryLangFallback,
    mergeSyncSettings,
    isLanguageSelectionReady,
  });

  // content script / popup / options から共通参照する。
  root.ATVB_SCHEMA = ATVB_SCHEMA;

  // Node.js / Vitest 環境では CommonJS export も提供する。
  // eslint-disable-next-line no-undef
  if (typeof module !== "undefined" && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = ATVB_SCHEMA;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);

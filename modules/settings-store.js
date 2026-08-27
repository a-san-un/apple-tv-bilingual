// =============================================================
// Apple TV+ Bilingual Subtitles - modules/settings-store.js
//
// 役割:
// - 設定 storage の読み込み・正規化・保存を集約する。
// - sync/local の保存責務を分離し、popup / options / background から
//   共通の設定アクセス経路として利用できるようにする。
// - 永続設定だけを扱い、panelOpen や extensionEnabled などの
//   ランタイム状態は保存対象に含めない。
//
// 依存:
// - modules/settings-schema.js (globalThis.ATVB_SCHEMA)
//
// 設計メモ:
// - sync 設定: primaryLang, secondaryLang, panelDefaultOpen,
//              playWordAudio, enableAiTooltip, preferredAiProvider
// - local 設定: googleAiStudioApiKey, groqApiKey
// - panelDefaultOpen は永続設定、panelOpen はランタイム UI 状態。
// - extensionEnabled はセッション単位の runtime state として扱い、
//   この store では保存・復元しない。
// =============================================================

(function (root) {
  "use strict";

  // settings schema が未読込なら storage access の前提が崩れるため中断する。
  const schema = root.ATVB_SCHEMA;
  if (!schema) {
    console.error("[ATVB_STORE] settings-schema.js が先に読み込まれていません"); // eslint-disable-line no-console
    return;
  }

  const {
    DEFAULT_SYNC_SETTINGS: _DEFAULT_SYNC_SETTINGS,
    DEFAULT_LOCAL_SETTINGS,
    mergeSyncSettings,
    applySecondaryLangFallback,
  } = schema;

  // -------------------------------------------------------
  // sync settings
  // -------------------------------------------------------

  /**
   * chrome.storage.sync から全設定を読み込み、
   * requested / effective の両方を含む snapshot を返す。
   *
   * - requestedSettings: storage に保存された値を schema で merge したもの
   * - effectiveSettings: requestedSettings に browser language fallback を適用したもの
   *
   * @returns {Promise<{
   *   storedSettings: Object,
   *   requestedSettings: Object,
   *   effectiveSettings: Object,
   *   requestedSecondaryLang: string
   * }>}
   */
  function loadSyncSnapshot() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(null, (stored) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const storedSettings = stored || {};
        const requestedSettings = mergeSyncSettings(storedSettings);
        const effectiveSettings = applySecondaryLangFallback(
          requestedSettings,
          navigator.language
        );

        resolve({
          storedSettings,
          requestedSettings,
          effectiveSettings,
          requestedSecondaryLang: storedSettings.secondaryLang ?? "",
        });
      });
    });
  }

  /**
   * Apple TV タブへ通知してよい sync 設定だけを返す。
   * background.js の SETTINGS_CHANGED 配信で使う。
   *
   * @returns {Promise<Object>}
   */
  function loadDispatchableSyncSettings() {
    return loadSyncSnapshot().then((snapshot) => ({
      ...snapshot.effectiveSettings,
    }));
  }

  /**
   * sync 設定を保存する。
   *
   * - generalSettings に含まれる sync 対象キーだけを保存対象とする
   * - panelOpen / extensionEnabled はランタイム状態なので保存しない
   * - panelDefaultOpen は永続設定としてここで保存する
   *
   * @param {Object} generalSettings
   * @returns {Promise<void>}
   */
  function saveSyncSettings(generalSettings) {
    return new Promise((resolve, reject) => {
      const safeSettings = { ...generalSettings };

      // ランタイム状態が誤って混入しても永続化しない。
      delete safeSettings.panelOpen;
      delete safeSettings.extensionEnabled;

      chrome.storage.sync.set(safeSettings, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  // -------------------------------------------------------
  // local settings
  // -------------------------------------------------------

  /**
   * chrome.storage.local から local 設定を読み込む。
   *
   * @returns {Promise<Object>}
   */
  function loadLocalSettings() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result || {});
      });
    });
  }

  /**
   * local 設定を保存する。
   *
   * @param {Object} localSettings
   * @returns {Promise<void>}
   */
  function saveLocalSettings(localSettings) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(localSettings, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  // -------------------------------------------------------
  // combined access
  // -------------------------------------------------------

  /**
   * sync + local を同時に読み込み、用途別に分けて返す。
   * options.js の初期表示や保存後再読込で利用する。
   *
   * @returns {Promise<{
   *   sync: {
   *     storedSettings: Object,
   *     requestedSettings: Object,
   *     effectiveSettings: Object,
   *     requestedSecondaryLang: string
   *   },
   *   local: Object
   * }>}
   */
  function loadAllSettings() {
    return Promise.all([loadSyncSnapshot(), loadLocalSettings()]).then(
      ([syncResult, localResult]) => ({
        sync: syncResult,
        local: localResult,
      })
    );
  }

  /**
   * sync + local を同時に保存し、保存後の sync snapshot を返す。
   * options.js の saveSettings() で使う。
   *
   * @param {Object} generalSettings
   * @param {Object} localSettings
   * @returns {Promise<{
   *   storedSettings: Object,
   *   requestedSettings: Object,
   *   effectiveSettings: Object,
   *   requestedSecondaryLang: string
   * }>}
   */
  function saveAllSettings(generalSettings, localSettings) {
    const safeGeneral = { ...generalSettings };
    delete safeGeneral.panelOpen;
    delete safeGeneral.extensionEnabled;

    return Promise.all([
      saveSyncSettings(safeGeneral),
      saveLocalSettings(localSettings),
    ]).then(() => loadSyncSnapshot());
  }

  // -------------------------------------------------------
  // exports
  // -------------------------------------------------------

  const ATVB_STORE = Object.freeze({
    loadSyncSnapshot,
    loadDispatchableSyncSettings,
    loadLocalSettings,
    loadAllSettings,
    saveSyncSettings,
    saveLocalSettings,
    saveAllSettings,
  });

  root.ATVB_SETTINGS_STORE = ATVB_STORE;
})(typeof globalThis !== "undefined" ? globalThis : window);

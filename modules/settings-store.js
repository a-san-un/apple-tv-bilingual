// =============================================================
// Apple TV+ Bilingual Subtitles - modules/settings-store.js
//
// 役割: storage の読み込み・merge・保存の共通処理を集約する (Step 1)
//
// 依存: modules/settings-schema.js (globalThis.ATVB_SCHEMA)
//
// 設計原則:
//   - 永続設定 (sync): extensionEnabled, primaryLang, secondaryLang,
//                      panelDefaultOpen, playWordAudio, enableAiTooltip,
//                      preferredAiProvider
//   - 永続設定 (local): googleAiStudioApiKey, groqApiKey
//   - ランタイムUI状態 (保存しない): panelOpen など
//   - panelDefaultOpen は永続設定。panelOpen と混同しないこと。
// =============================================================

(function (root) {
  "use strict";

  // ATVB_SCHEMA が読み込まれていない場合は即時エラー
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
  // 内部ユーティリティ
  // -------------------------------------------------------

  /** chrome.storage.sync から全キーを取得して merge した snapshot を返す */
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
   * Apple TV タブへ通知してよい完成済み sync 設定だけを返す。
   * background.js の SETTINGS_CHANGED 配信で使う。
   */
  function loadDispatchableSyncSettings() {
    return loadSyncSnapshot().then((snapshot) => ({
      ...snapshot.effectiveSettings,
    }));
  }

  /** chrome.storage.local から LOCAL キーを取得する */
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
   * sync + local を同時に読み込み、{ sync, local } で返す。
   * options.js の loadSettings() で使う。
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
   * sync 設定を保存する。
   * 渡した generalSettings オブジェクトのキーだけを storage に書き込む。
   * extensionEnabled は呼び出し元が「今の extensionEnabled 値」を含めて渡す責任を持つ。
   * panelDefaultOpen は永続設定なのでここで保存する。
   * panelOpen は渡してはいけない（ランタイムUI状態は保存しない）。
   *
   * @param {Object} generalSettings - SETTINGS_KEYS_SYNC のキーを含むオブジェクト
   */
  function saveSyncSettings(generalSettings) {
    return new Promise((resolve, reject) => {
      // panelOpen が誤って混入した場合に除去（防御）
      const safeSettings = { ...generalSettings };
      delete safeSettings.panelOpen;

      chrome.storage.sync.set(safeSettings, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * local 設定を保存する。
   * @param {Object} localSettings - SETTINGS_KEYS_LOCAL のキーを含むオブジェクト
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

  /**
   * sync + local を同時に保存して、保存後の sync snapshot を返す。
   * options.js の saveSettings() で使う。
   *
   * @param {Object} generalSettings - sync に保存するオブジェクト
   * @param {Object} localSettings   - local に保存するオブジェクト
   */
  function saveAllSettings(generalSettings, localSettings) {
    const safeGeneral = { ...generalSettings };
    delete safeGeneral.panelOpen;

    return Promise.all([
      saveSyncSettings(safeGeneral),
      saveLocalSettings(localSettings),
    ]).then(() => loadSyncSnapshot());
  }

  /**
   * extensionEnabled だけを sync から読み込む（popup.js の applySettings で使う）。
   * @returns {Promise<boolean>}
   */
  function loadEnabledFlag() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(["extensionEnabled"], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(schema.normalizeExtensionEnabled(result.extensionEnabled));
      });
    });
  }

  /**
   * extensionEnabled だけを sync に保存する。
   * @param {boolean} extensionEnabled
   */
  function saveEnabledFlag(extensionEnabled) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(
        { extensionEnabled: extensionEnabled === true },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        }
      );
    });
  }

  // -------------------------------------------------------
  // エクスポート
  // -------------------------------------------------------
  const ATVB_STORE = Object.freeze({
    loadSyncSnapshot,
    loadDispatchableSyncSettings,
    loadLocalSettings,
    loadAllSettings,
    saveSyncSettings,
    saveLocalSettings,
    saveAllSettings,
    loadEnabledFlag,
    saveEnabledFlag,
  });

  root.ATVB_SETTINGS_STORE = ATVB_STORE;
})(typeof globalThis !== "undefined" ? globalThis : window);
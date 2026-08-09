// =============================================================
// Apple TV+ Bilingual Subtitles - modules/panel-visibility-state.js
//
// 役割: panelVisible（ランタイムUI状態）の load / persist を管理する (Step 2)
//
// 設計原則:
//   - panelVisible = パネル開閉のランタイムUI状態。chrome.storage.local に保存。
//   - showSidebar  = 永続設定。chrome.storage.sync に保存。
//   - 両者を混同・相互保存しないこと。
//   - load:    chrome.storage.local から panelVisible を読む。
//              キーが未保存の場合は引数 showSidebarSetting（設定値）を初期値とする。
//   - persist: chrome.storage.local に panelVisible だけ書く。
//              chrome.storage.sync（showSidebar）には一切書かない。
//
// 利用方法:
//   manifest.json の content_scripts に追加して
//   globalThis.ATVB_PANEL_VISIBILITY を公開する。
// =============================================================

(function (root) {
  "use strict";

  const STORAGE_KEY = "panelVisible";

  /**
   * パネル表示状態を chrome.storage.local から読み込む。
   *
   * local にキーが未保存の場合は showSidebarSetting（settings.showSidebar）を
   * 初期値として返す。設定値は起動時の1回だけ初期値として参照する。
   *
   * @param {boolean} showSidebarSetting - state.contentSettings.showSidebar の値
   * @returns {Promise<boolean>}
   */
  function load(showSidebarSetting) {
    const fallback = showSidebarSetting !== false;
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(STORAGE_KEY, (result = {}) => {
          if (chrome.runtime.lastError) {
            resolve(fallback);
            return;
          }
          if (Object.prototype.hasOwnProperty.call(result, STORAGE_KEY)) {
            resolve(result[STORAGE_KEY] !== false);
          } else {
            resolve(fallback);
          }
        });
      } catch (e) {
        void e;
        resolve(fallback);
      }
    });
  }

  /**
   * パネル表示状態を chrome.storage.local に保存する。
   *
   * chrome.storage.sync（showSidebar）には書かない。
   *
   * @param {boolean} panelVisible
   * @param {Function} [logFn] - オプションのログ関数
   */
  function persist(panelVisible, logFn) {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: panelVisible }, () => {
        if (chrome.runtime.lastError) {
          logFn?.("panelVisible persist failed", {
            error: chrome.runtime.lastError.message,
            panelVisible,
          });
          return;
        }
        logFn?.("panelVisible persisted", { panelVisible });
      });
    } catch (e) {
      logFn?.("panelVisible persist exception", {
        error: e?.message,
        panelVisible,
      });
    }
  }

  // globalThis への公開
  root.ATVB_PANEL_VISIBILITY = { load, persist };

}(typeof globalThis !== "undefined" ? globalThis : this));

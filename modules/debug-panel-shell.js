// =============================================================
// Apple TV+ Bilingual Subtitles - modules/debug-panel-shell.js
// version: 2.6.4
// -------------------------------------------------------------
// 役割:
// - debug panel の共通 HTML shell を返す。
// - panel-ui / options など複数 owner から再利用できるようにする。
// - panel 用と options 用で必要な DOM 構造を variant ごとに切り替える。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  // -----------------------------------------------------------
  // Section: panel variant
  // -----------------------------------------------------------

  /**
   * 再生画面の字幕パネル向け debug shell HTML を返す。
   *
   * @param {object} [options]
   * @param {string[]} [options.sourceOptions=["content"]]
   * @param {string[]} [options.categoryOptions=["subtitle"]]
   * @param {string} [options.placeholder="cuechange / overlay / current subtitle block"]
   * @returns {string}
   */
  function buildPanelDebugShellHTML(options = {}) {
    const {
      sourceOptions = ["content"],
      categoryOptions = ["subtitle"],
      placeholder = "cuechange / overlay / current subtitle block",
    } = options;

    const sourceOptionHtml = [
      '<option value="">all</option>',
      ...sourceOptions.map(
        (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      ),
    ].join("");

    const categoryOptionHtml = [
      '<option value="">all</option>',
      ...categoryOptions.map(
        (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      ),
    ].join("");

    return `
      <div id="debug-section" class="debug-section">
        <div class="debug-section__header">
          <span class="debug-section__title">デバッグログ（開発者向け）</span>
          <button
            id="debugSectionToggle"
            class="debug-toggle-button"
            type="button"
            aria-expanded="false"
            aria-controls="debugSectionBody"
          >▶</button>
        </div>
        <div id="debugSectionBody" class="debug-section__body" hidden>
          <div class="debug-filters">
            <label class="debug-filter">
              <span class="debug-filter__label">source</span>
              <select id="debugFilterSource" class="debug-filter__control">
                ${sourceOptionHtml}
              </select>
            </label>
            <label class="debug-filter">
              <span class="debug-filter__label">category</span>
              <select id="debugFilterCategory" class="debug-filter__control">
                ${categoryOptionHtml}
              </select>
            </label>
            <label class="debug-filter debug-filter--text">
              <span class="debug-filter__label">text</span>
              <input
                id="debugFilterText"
                class="debug-filter__control"
                type="text"
                placeholder="${escapeHtml(placeholder)}"
              />
            </label>
          </div>
          <div class="debug-toolbar">
            <button id="debugCopyBtn" class="debug-btn" type="button">Copy</button>
            <button id="debugDownloadBtn" class="debug-btn" type="button">Download</button>
            <button id="debugClearBtn" class="debug-btn" type="button">Clear</button>
          </div>
          <textarea id="debug-log" readonly></textarea>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------
  // Section: options variant
  // -----------------------------------------------------------

  /**
   * settings 画面向け debug shell HTML を返す。
   *
   * @param {object} [options]
   * @param {string[]} [options.sourceOptions=["content","options","popup","background","debug-panel"]]
   * @param {string[]} [options.categoryOptions=["settings","subtitle","ui","api","error","default"]]
   * @param {string} [options.placeholder="メッセージ / payload を検索"]
   * @returns {string}
   */
  function buildOptionsDebugShellHTML(options = {}) {
    const {
      sourceOptions = ["content", "options", "popup", "background", "debug-panel"],
      categoryOptions = ["settings", "subtitle", "ui", "api", "error", "default"],
      placeholder = "メッセージ / payload を検索",
    } = options;

    const sourceOptionHtml = [
      '<option value="">すべての発生元</option>',
      ...sourceOptions.map(
        (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      ),
    ].join("");

    const categoryOptionHtml = [
      '<option value="">すべてのカテゴリ</option>',
      ...categoryOptions.map(
        (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      ),
    ].join("");

    return `
      <section class="settings-section debug-section">
        <div class="debug-section__header">
          <div>
            <h2>デバッグログ（開発者向け）</h2>
            <p class="helper-text">
              popup / options / background / content
              から収集したログをリアルタイム表示します
            </p>
          </div>
          <button
            id="debugSectionToggle"
            class="secondary-button debug-toggle-button"
            type="button"
            aria-expanded="false"
            aria-controls="debugSectionBody"
          >
            ▶
          </button>
        </div>

        <div id="debugSectionBody" class="debug-section__body" hidden>
          <div class="debug-toolbar">
            <div class="debug-toolbar__top">
              <div class="debug-toolbar__meta">
                <span id="debugRealtimeBadge" class="debug-badge">LIVE</span>
                <span id="debugLogCount" class="debug-count">0 / 0 logs</span>
              </div>

              <div class="debug-toolbar__actions">
                <button id="debugCopyBtn" class="secondary-button" type="button">
                  Copy
                </button>
                <button
                  id="debugDownloadBtn"
                  class="secondary-button"
                  type="button"
                >
                  Download
                </button>
                <button
                  id="debugClearBtn"
                  class="secondary-button danger-button"
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>

            <div class="debug-toolbar__filters">
              <label class="toggle-row debug-toggle-row">
                <span class="switch">
                  <input id="debugShowAll" type="checkbox" />
                  <span class="slider"></span>
                </span>
                <span class="toggle-label">
                  全ログ表示（source / category / text フィルタを無視）
                </span>
              </label>

              <select
                id="debugFilterSource"
                class="debug-filter-select"
                aria-label="ログ発生元で絞り込み"
              >
                ${sourceOptionHtml}
              </select>

              <select
                id="debugFilterCategory"
                class="debug-filter-select"
                aria-label="カテゴリで絞り込み"
              >
                ${categoryOptionHtml}
              </select>

              <input
                id="debugFilterText"
                class="debug-filter-text"
                type="search"
                placeholder="${escapeHtml(placeholder)}"
                autocomplete="off"
                spellcheck="false"
                aria-label="テキスト検索"
              />
            </div>

            <p class="helper-text">
              全ログ表示を ON にすると、保存済み debugLogs をそのまま表示します。
            </p>
          </div>

          <div class="field">
            <span class="field-label">ログ出力</span>
            <div
              id="debugLogOutput"
              class="debug-log-view"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              tabindex="0"
            >
              <div class="debug-log-empty">
                表示できるデバッグログはまだありません。
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  // -----------------------------------------------------------
  // Section: public builder
  // -----------------------------------------------------------

  /**
   * debug panel の共通 shell HTML を返す。
   *
   * @param {object} [options]
   * @param {"panel"|"options"} [options.variant="panel"] - 返す shell の種別。
   * @param {string[]} [options.sourceOptions]
   * @param {string[]} [options.categoryOptions]
   * @param {string} [options.placeholder]
   * @returns {string}
   */
  function buildDebugPanelShellHTML(options = {}) {
    const { variant = "panel" } = options;

    if (variant === "options") {
      return buildOptionsDebugShellHTML(options);
    }

    return buildPanelDebugShellHTML(options);
  }

  /**
   * HTML 文字列へ埋め込む値を最小限エスケープする。
   *
   * @param {string} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  window.ATVB.debugPanelShell = {
    buildDebugPanelShellHTML,
  };
})();

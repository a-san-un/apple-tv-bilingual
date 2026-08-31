// =============================================================
// Apple TV+ Bilingual Subtitles - modules/debug-panel-runtime.js
// version: 2.6.8
// -------------------------------------------------------------
// 役割:
// - playback session に従属する debug panel runtime を提供する。
// - panel / options の variant ごとに UI 更新先を切り替える。
// - shell 上のイベント配線、再描画、clear、unmount を内部で閉じる。
// - 起動・撤収の判断は上位 lifecycle に従い、
//   shadow root / document 単位の handler / timer / observer / state を管理・解放する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  const ROOT_STATE_KEY = "__atvbDebugPanelRuntimeState";

  // -----------------------------------------------------------
  // Section: context / state
  // -----------------------------------------------------------

  /**
   * Chrome 拡張コンテキストが有効かを返す。
   *
   * @returns {boolean}
   */
  function isChromeContextAlive() {
    try {
      return !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  /**
   * root ごとの runtime state を返す。
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @returns {{deps: object, handlers: object|null, refreshTimer: number|null, variant: string}|null}
   */
  function getRootState(root) {
    if (!root) return null;

    if (!root[ROOT_STATE_KEY]) {
      root[ROOT_STATE_KEY] = {
        deps: {},
        handlers: null,
        refreshTimer: null,
        variant: "panel",
      };
    }

    return root[ROOT_STATE_KEY];
  }

  // -----------------------------------------------------------
  // Section: filter helpers
  // -----------------------------------------------------------

  /**
   * UI 上の filter 値を読む。
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @returns {{source: string, category: string, text: string, showAll: boolean}}
   */
  function readUiFilters(root) {
    if (!root) {
      return {
        source: "",
        category: "",
        text: "",
        showAll: false,
      };
    }

    return {
      source: root.getElementById("debugFilterSource")?.value?.trim() || "",
      category: root.getElementById("debugFilterCategory")?.value?.trim() || "",
      text: root.getElementById("debugFilterText")?.value?.trim() || "",
      showAll: Boolean(root.getElementById("debugShowAll")?.checked),
    };
  }

  /**
   * panel variant 用の filter 形式へ変換する。
   *
   * @param {{source: string, category: string, text: string}} filter
   * @returns {{scopes?: string[], categories?: string[], text?: string}}
   */
  function toPanelFilter(filter) {
    const next = {};
    if (filter.source) next.scopes = [filter.source];
    if (filter.category) next.categories = [filter.category];
    if (filter.text) next.text = filter.text;
    return next;
  }

  /**
   * baseFilter と UI filter を merge する。
   *
   * @param {object} [baseFilter={}]
   * @param {object} [uiFilter={}]
   * @returns {object}
   */
  function mergeDebugFilters(baseFilter = {}, uiFilter = {}) {
    return {
      ...baseFilter,
      ...uiFilter,
    };
  }

  // -----------------------------------------------------------
  // Section: data loading
  // -----------------------------------------------------------

  /**
   * variant に応じて描画用データを読む。
   *
   * panel:
   * - deps.getFilter(): object
   * - deps.getLogText(filter): Promise<string>|string
   *
   * options:
   * - deps.getLogs(): Promise<Array>|Array
   * - deps.getVisibleLogs(logs, uiFilter): Array
   * - deps.getMeta(logs, visibleLogs, uiFilter): object
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @returns {Promise<object>}
   */
  async function readRenderData(root) {
    const state = getRootState(root);
    if (!state) return { variant: "panel", text: "" };

    const { deps, variant } = state;
    const uiFilter = readUiFilters(root);

    if (variant === "options") {
      const logs =
        typeof deps.getLogs === "function" ? await deps.getLogs() : [];
      const visibleLogs =
        typeof deps.getVisibleLogs === "function"
          ? deps.getVisibleLogs(logs, uiFilter)
          : logs;
      const meta =
        typeof deps.getMeta === "function"
          ? deps.getMeta(logs, visibleLogs, uiFilter)
          : {
              totalCount: Array.isArray(logs) ? logs.length : 0,
              visibleCount: Array.isArray(visibleLogs) ? visibleLogs.length : 0,
            };

      return {
        variant,
        logs,
        visibleLogs,
        meta,
        uiFilter,
      };
    }

    const baseFilter =
      typeof deps.getFilter === "function" ? deps.getFilter() : {};
    const mergedFilter = mergeDebugFilters(baseFilter, toPanelFilter(uiFilter));
    const text =
      typeof deps.getLogText === "function"
        ? (await deps.getLogText(mergedFilter)) || ""
        : "";

    return {
      variant,
      text,
      uiFilter,
    };
  }

  // -----------------------------------------------------------
  // Section: UI rendering
  // -----------------------------------------------------------

  /**
   * panel variant の textarea を更新する。
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @param {string} text
   * @returns {void}
   */
  function renderPanelText(root, text) {
    const textarea = root?.getElementById("debug-log");
    if (!textarea) return;

    textarea.value = text || "";
    textarea.scrollTop = textarea.scrollHeight;
  }

  /**
   * options variant のログ出力領域を更新する。
   *
   * deps:
   * - renderLogItems(root, visibleLogs): void
   * - renderEmptyState(root): void
   * - updateMeta(root, meta): void
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @param {object} renderData
   * @returns {void}
   */
  function renderOptionsLogs(root, renderData) {
    const state = getRootState(root);
    if (!state) return;

    const output = root?.getElementById("debugLogOutput");
    if (!output) return;

    const { deps } = state;
    const { visibleLogs = [], meta = {} } = renderData;

    output.innerHTML = "";

    if (
      Array.isArray(visibleLogs) &&
      visibleLogs.length > 0 &&
      typeof deps.renderLogItems === "function"
    ) {
      deps.renderLogItems(root, visibleLogs);
    } else if (typeof deps.renderEmptyState === "function") {
      deps.renderEmptyState(root);
    }

    if (typeof deps.updateMeta === "function") {
      deps.updateMeta(root, meta);
    }
  }

  /**
   * variant に応じて UI を更新する。
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @returns {Promise<void>}
   */
  async function update(root) {
    if (!root) return;
    if (!isChromeContextAlive()) return;

    const renderData = await readRenderData(root);
    if (renderData.variant === "options") {
      renderOptionsLogs(root, renderData);
      return;
    }

    renderPanelText(root, renderData.text || "");
  }

  /**
   * clear 実行後に UI を更新する。
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @returns {Promise<void>}
   */
  async function clear(root) {
    const state = getRootState(root);
    if (!state) return;

    if (typeof state.deps.clearLogs === "function") {
      const uiFilter = readUiFilters(root);
      await state.deps.clearLogs(uiFilter);
    }

    await update(root);
  }

  // -----------------------------------------------------------
  // Section: expand / collapse
  // -----------------------------------------------------------

  /**
   * section の展開状態を返す。
   *
   * @param {HTMLElement|null} section
   * @returns {boolean}
   */
  function readExpandedState(section) {
    return section?.dataset?.expanded === "1";
  }

  /**
   * section の展開状態を書き込む。
   *
   * @param {HTMLElement|null} section
   * @param {boolean} expanded
   * @returns {void}
   */
  function writeExpandedState(section, expanded) {
    if (!section) return;
    section.dataset.expanded = expanded ? "1" : "0";
  }

  /**
   * トグル UI を展開状態に同期する。
   *
   * @param {HTMLElement|null} section
   * @param {HTMLElement|null} toggleBtn
   * @param {HTMLElement|null} body
   * @param {boolean} expanded
   * @returns {void}
   */
  function syncExpandedUi(section, toggleBtn, body, expanded) {
    if (!toggleBtn || !body) return;
    body.hidden = !expanded;
    toggleBtn.textContent = expanded ? "▼" : "▶";
    toggleBtn.setAttribute("aria-expanded", String(expanded));
    writeExpandedState(section, expanded);
  }

  // -----------------------------------------------------------
  // Section: handler lifecycle
  // -----------------------------------------------------------

  /**
   * 既存 handler を root から detach する。
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @param {object|null} handlers
   * @returns {void}
   */
  function detachHandlers(root, handlers) {
    if (!root || !handlers) return;

    root
      .getElementById("debugSectionToggle")
      ?.removeEventListener("click", handlers.onToggle);
    root
      .getElementById("debugCopyBtn")
      ?.removeEventListener("click", handlers.onCopy);
    root
      .getElementById("debugDownloadBtn")
      ?.removeEventListener("click", handlers.onDownload);
    root
      .getElementById("debugClearBtn")
      ?.removeEventListener("click", handlers.onClear);
    root
      .getElementById("debugFilterSource")
      ?.removeEventListener("change", handlers.onFilterChange);
    root
      .getElementById("debugFilterCategory")
      ?.removeEventListener("change", handlers.onFilterChange);
    root
      .getElementById("debugFilterText")
      ?.removeEventListener("input", handlers.onFilterInput);
    root
      .getElementById("debugShowAll")
      ?.removeEventListener("change", handlers.onFilterChange);
  }

  /**
   * debug panel runtime を撤収する。
   *
   * playback session cleanup owner など上位 lifecycle から呼ばれ、
   * runtime 内部の handler / timer / observer / DOM 結び付きを解放する。
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @returns {void}
   */
  function unmount(root) {
    if (!root) return;

    const state = getRootState(root);
    if (!state?.handlers) return;

    detachHandlers(root, state.handlers);

    const section = root.getElementById("debug-section");
    if (section) delete section.dataset.bound;

    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }

    state.handlers = null;
  }

  // -----------------------------------------------------------
  // Section: public API
  // -----------------------------------------------------------

  /**
   * debug panel runtime を root に mount する。
   *
   * panel deps:
   * - getFilter(): object
   * - getLogText(filter): Promise<string>|string
   * - copyLogs(uiFilter): Promise<void>|void
   * - downloadLogs(uiFilter): Promise<void>|void
   * - clearLogs(uiFilter): Promise<void>|void
   *
   * options deps:
   * - getLogs(): Promise<Array>|Array
   * - getVisibleLogs(logs, uiFilter): Array
   * - getMeta(logs, visibleLogs, uiFilter): object
   * - renderLogItems(root, visibleLogs): void
   * - renderEmptyState(root): void
   * - updateMeta(root, meta): void
   * - copyLogs(uiFilter): Promise<void>|void
   * - downloadLogs(uiFilter): Promise<void>|void
   * - clearLogs(uiFilter): Promise<void>|void
   *
   * @param {ShadowRoot|Document|Element|null} root
   * @param {object} [deps={}]
   * @param {"panel"|"options"} [deps.variant="panel"]
   * @returns {ShadowRoot|Document|Element|null}
   */
  function mount(root, deps = {}) {
    if (!root) return null;

    const section = root.getElementById("debug-section");
    if (!section) return null;

    const toggleBtn = root.getElementById("debugSectionToggle");
    const body = root.getElementById("debugSectionBody");
    const state = getRootState(root);

    if (!section.dataset.expanded) {
      section.dataset.expanded = "0";
    }

    if (state.handlers) {
      unmount(root);
    }

    state.deps = { ...deps };
    state.variant = deps.variant === "options" ? "options" : "panel";

    const handlers = {
      onToggle() {
        const expanded = !readExpandedState(section);
        syncExpandedUi(section, toggleBtn, body, expanded);
      },

      async onCopy() {
        if (typeof state.deps.copyLogs === "function") {
          await state.deps.copyLogs(readUiFilters(root));
        }
        await update(root);
      },

      async onDownload() {
        if (typeof state.deps.downloadLogs === "function") {
          await state.deps.downloadLogs(readUiFilters(root));
        }
        await update(root);
      },

      async onClear() {
        await clear(root);
      },

      async onFilterChange() {
        await update(root);
      },

      async onFilterInput() {
        await update(root);
      },
    };

    toggleBtn?.addEventListener("click", handlers.onToggle);
    root.getElementById("debugCopyBtn")?.addEventListener("click", handlers.onCopy);
    root
      .getElementById("debugDownloadBtn")
      ?.addEventListener("click", handlers.onDownload);
    root.getElementById("debugClearBtn")?.addEventListener("click", handlers.onClear);
    root
      .getElementById("debugFilterSource")
      ?.addEventListener("change", handlers.onFilterChange);
    root
      .getElementById("debugFilterCategory")
      ?.addEventListener("change", handlers.onFilterChange);
    root
      .getElementById("debugFilterText")
      ?.addEventListener("input", handlers.onFilterInput);
    root
      .getElementById("debugShowAll")
      ?.addEventListener("change", handlers.onFilterChange);

    state.handlers = handlers;
    section.dataset.bound = "1";

    syncExpandedUi(section, toggleBtn, body, readExpandedState(section));

    state.refreshTimer = setInterval(() => {
      update(root).catch(() => {
        // noop
      });
    }, 500);

    update(root).catch(() => {
      // noop
    });

    return root;
  }

  window.ATVB.debugPanelRuntime = {
    mount,
    update,
    clear,
    unmount,
    readUiFilters,
  };
})();

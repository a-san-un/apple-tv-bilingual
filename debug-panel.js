// =============================================================
// Apple TV+ Bilingual Subtitles - debug-panel.js
// version: 2.6.6
// 役割: 右字幕パネル下部の Debug UI 入口を提供する。
// Phase C: mount/update/clear/unmount の API スケルトンのみを固定する。
// Fix: VM/world をまたいでも shadow root 単位で handler/state を管理する。
// Fix: Extension context invalidated を防ぐ chrome context guard を追加。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  const ROOT_STATE_KEY = "__atvbDebugPanelState";

  // Chrome 拡張コンテキストが有効かどうかを確認する
  function isChromeContextAlive() {
    try {
      return !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  function getRootState(root) {
    if (!root) return null;
    if (!root[ROOT_STATE_KEY]) {
      root[ROOT_STATE_KEY] = {
        deps: {},
        handlers: null,
        refreshTimer: null,
      };
    }
    return root[ROOT_STATE_KEY];
  }

  function readUiFilters(root) {
    if (!root) return {};

    const source =
      root.getElementById("debugFilterSource")?.value?.trim() || "";
    const category =
      root.getElementById("debugFilterCategory")?.value?.trim() || "";
    const text = root.getElementById("debugFilterText")?.value?.trim() || "";

    const filter = {};
    if (source) filter.scopes = [source];
    if (category) filter.categories = [category];
    if (text) filter.text = text;
    return filter;
  }

  function mergeDebugFilters(baseFilter = {}, uiFilter = {}) {
    const merged = { ...baseFilter };

    if (Array.isArray(uiFilter.scopes)) {
      merged.scopes = uiFilter.scopes;
    }
    if (Array.isArray(uiFilter.categories)) {
      merged.categories = uiFilter.categories;
    }
    if (typeof uiFilter.text === "string") {
      merged.text = uiFilter.text;
    }

    return merged;
  }

  async function readLogText(root) {
    const state = getRootState(root);
    if (!state || typeof state.deps.getLogText !== "function") return "";

    const baseFilter =
      typeof state.deps.getFilter === "function" ? state.deps.getFilter() : {};
    const uiFilter = readUiFilters(root);
    const filter = mergeDebugFilters(baseFilter, uiFilter);
    return (await state.deps.getLogText(filter)) || "";
  }

  async function update(root) {
    if (!root) return;
    if (!isChromeContextAlive()) return;
    
    const textarea = root.getElementById("debug-log");
    if (!textarea) return;

    const text = await readLogText(root);
    textarea.value = text;
    textarea.scrollTop = textarea.scrollHeight;
  }

  async function clear(root) {
    const state = getRootState(root);
    if (!state) return;

    if (typeof state.deps.clearLogs === "function") {
      await state.deps.clearLogs();
    }
    await update(root);
  }

  function readExpandedState(section) {
    return section?.dataset?.expanded === "1";
  }

  function writeExpandedState(section, expanded) {
    if (!section) return;
    section.dataset.expanded = expanded ? "1" : "0";
  }

  function syncExpandedUi(section, toggleBtn, body, expanded) {
    if (!toggleBtn || !body) return;
    body.hidden = !expanded;
    toggleBtn.textContent = expanded ? "▼" : "▶";
    toggleBtn.setAttribute("aria-expanded", String(expanded));
    writeExpandedState(section, expanded);
  }

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
  }

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
      detachHandlers(root, state.handlers);
      state.handlers = null;
    }

    state.deps = deps;

    const handlers = {
      onToggle: () => {
        if (!toggleBtn || !body) return;
        const nextExpanded = body.hidden;
        syncExpandedUi(section, toggleBtn, body, nextExpanded);
      },
      onCopy: async () => {
        const text = await readLogText(root);
        try {
          if (typeof state.deps.copyText === "function") {
            await state.deps.copyText(text);
          } else {
            await navigator.clipboard.writeText(text);
          }
          if (typeof state.deps.logInfo === "function") {
            state.deps.logInfo("Debug panel copied logs", {
              lineCount: text ? text.split("\n").length : 0,
            });
          }
        } catch (error) {
          if (typeof state.deps.logError === "function") {
            state.deps.logError("Debug panel copy failed", {
              error: String(error),
            });
          }
        }
      },
      onDownload: async () => {
        const text = await readLogText(root);
        if (typeof state.deps.downloadLogs !== "function") return;

        state.deps.downloadLogs(text, (result = {}) => {
          if (result.ok) {
            if (typeof state.deps.logInfo === "function") {
              state.deps.logInfo("Debug panel downloaded logs", {
                lineCount: text ? text.split("\n").length : 0,
                downloadId: result.downloadId ?? null,
              });
            }
            return;
          }

          if (typeof state.deps.logError === "function") {
            state.deps.logError("Debug panel download failed", {
              error: result.error ?? "unknown",
            });
          }
        });
      },
      onClear: async () => {
        try {
          await clear(root);
        } catch (error) {
          if (typeof state.deps.logError === "function") {
            state.deps.logError("Debug panel clear failed", {
              error: String(error),
            });
          }
        }
      },
      onFilterChange: async () => {
        await update(root);
      },
      onFilterInput: async () => {
        await update(root);
      },
    };

    state.handlers = handlers;

    if (toggleBtn && body) {
      const expanded = readExpandedState(section);
      syncExpandedUi(section, toggleBtn, body, expanded);
      toggleBtn.addEventListener("click", handlers.onToggle);
    }

    root
      .getElementById("debugCopyBtn")
      ?.addEventListener("click", handlers.onCopy);
    root
      .getElementById("debugDownloadBtn")
      ?.addEventListener("click", handlers.onDownload);
    root
      .getElementById("debugClearBtn")
      ?.addEventListener("click", handlers.onClear);
    root
      .getElementById("debugFilterSource")
      ?.addEventListener("change", handlers.onFilterChange);
    root
      .getElementById("debugFilterCategory")
      ?.addEventListener("change", handlers.onFilterChange);
    root
      .getElementById("debugFilterText")
      ?.addEventListener("input", handlers.onFilterInput);

    section.dataset.bound = "1";
    update(root);

    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }

    state.refreshTimer = setInterval(() => {
      // 拡張コンテキストが無効化されていたらタイマーを自己停止する
      if (!isChromeContextAlive()) {
        const s = getRootState(root);
        if (s?.refreshTimer) {
          clearInterval(s.refreshTimer);
          s.refreshTimer = null;
        }
        return;
      }
      update(root).catch(() => {});
    }, 500);

    return {
      root,
      handlers,
    };
  }

  window.ATVB.debugPanel = {
    mount,
    update(root) {
      return update(root);
    },
    clear(root) {
      return clear(root);
    },
    unmount,
  };
})();

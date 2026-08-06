// =============================================================
// Apple TV Bilingual Subtitles - panel-ui.js
// version: 1.0.5
// Issue #32 Round 11 後半: panel host / shell 責務へ限定し、
// shared view を正本とする現在の構成に合わせて、panel header の
// secondary language selector と旧 secondary subtitle DOM 依存を除去。
// Debug panel は初期 mount のみ行い、applyPanelState では再 mount しない。
// PR3: layout / playback controls orchestration は content.js の
// applyLayout → layout controller 側へ寄せ、ここは薄い UI 配線に保つ。
// =============================================================

(function () {
  "use strict";

  function createPanelUi(deps) {
    const {
      state,
      getTarget,
      getLiveDebugLogFilter,
      getDebugLogText,
      clearDebugLogs,
      sendToBackground,
      onClosePanel,
      applyLayout,
      persistPanelVisibility,
      logContent,
      renderCurrentSnapshot,
      renderPanel,
      rebuildSubtitleBlocksForPanelOpen,
    } = deps;

    const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";

    function ensurePanelSlotLayerStyle() {
      if (document.getElementById(PANEL_SLOT_LAYER_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = PANEL_SLOT_LAYER_STYLE_ID;
      style.textContent = ``;
      document.head.appendChild(style);
    }

    function buildPanelDebugShellHTML() {
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
                  <option value="">all</option>
                  <option value="content">content</option>
                </select>
              </label>
              <label class="debug-filter">
                <span class="debug-filter__label">category</span>
                <select id="debugFilterCategory" class="debug-filter__control">
                  <option value="">all</option>
                  <option value="subtitle">subtitle</option>
                </select>
              </label>
              <label class="debug-filter debug-filter--text">
                <span class="debug-filter__label">text</span>
                <input
                  id="debugFilterText"
                  class="debug-filter__control"
                  type="text"
                  placeholder="cuechange / overlay / current subtitle block"
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

    function buildPanelShellHTML() {
      const panelCssUrl = chrome.runtime.getURL("panel.css");
      return `
        <link rel="stylesheet" href="${panelCssUrl}">
        <div id="panel" class="dual-subtitles-panel" data-dual-subtitles-panel>
          <div id="panel-header">
            <span>📋 字幕履歴</span>
            <div class="panel-header-actions">
              <button id="settings-btn" type="button" title="設定">⚙️</button>
              <button id="close-btn" type="button">✕ 閉じる</button>
            </div>
          </div>
          ${buildPanelDebugShellHTML()}
          <div id="panel-scroll">
            <div id="subtitle-list"></div>
          </div>
        </div>
      `;
    }

    function wirePanelHeaderActions() {
      const root = state.panelShadowRoot;
      if (!root) return;

      root.getElementById("settings-btn")?.addEventListener("click", () => {
        try {
          chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
        } catch (_) {}
      });

      root.getElementById("close-btn")?.addEventListener("click", () => {
        if (typeof onClosePanel === "function") {
          onClosePanel();
          return;
        }
        hideRightPanel();
      });
    }

    function createRightPanel() {
      const target = getTarget?.();
      if (!target) return null;

      let existingHost = target.querySelector("#atv-panel-host");
      if (existingHost) {
        state.panelShadowRoot = existingHost.shadowRoot || state.panelShadowRoot;
        return existingHost;
      }

      const host = document.createElement("div");
      host.id = "atv-panel-host";
      host.style.cssText = [
        "position:fixed",
        "top:0",
        "right:0",
        "width:30%",
        "height:100vh",
        "z-index:999997",
        "pointer-events:auto",
        "box-sizing:border-box",
      ].join(";");

      target.appendChild(host);
      ensurePanelSlotLayerStyle();
      state.panelShadowRoot = host.attachShadow({ mode: "open" });
      state.panelShadowRoot.innerHTML = buildPanelShellHTML();
      wirePanelHeaderActions();

      return host;
    }

    function createDebugPanel() {
      if (!state.panelShadowRoot) return;
      state.debugPanelRoot = state.panelShadowRoot;

      const debugPanel = window.ATVB?.debugPanel;
      if (!debugPanel?.mount) return;

      debugPanel.mount(state.debugPanelRoot, {
        getFilter: getLiveDebugLogFilter,
        getLogText: getDebugLogText,
        clearLogs: clearDebugLogs,
        downloadLogs: (text, done) => {
          sendToBackground({ type: "DOWNLOAD_DEBUG_LOG", text }, (res) => {
            if (typeof done === "function") {
              done({
                ok: !!res?.ok,
                downloadId: res?.downloadId ?? null,
                error: res?.error ?? "unknown",
              });
            }
          });
        },
      });
    }

    function getPanelUiElements() {
      const target = getTarget();
      return {
        panelHost: target.querySelector("#atv-panel-host"),
        overlayHost: target.querySelector("#atv-overlay-host"),
        toggleBtn: target.querySelector("#atv-toggle-btn"),
      };
    }

    function applyPanelVisibility(show) {
      const { panelHost, overlayHost } = getPanelUiElements();

      if (panelHost) panelHost.style.display = show ? "" : "none";
      if (overlayHost) {
        overlayHost.style.width = show ? "70%" : "100%";
        overlayHost.style.display = show ? "none" : "";
      }

      updateToggleButton(show);
    }

    function showRightPanel() {
      applyPanelVisibility(true);
    }

    function hideRightPanel() {
      applyPanelVisibility(false);
    }

    function togglePanel(force) {
      if (typeof force === "boolean") state.panelVisible = force;
      else state.panelVisible = !state.panelVisible;

      applyLayout(state.panelVisible);
      applyPanelVisibility(state.panelVisible);  // updateToggleButton はここで呼ばれる

      if (typeof persistPanelVisibility === "function") {
        persistPanelVisibility();
      }

      if (typeof logContent === "function") {
        logContent("togglePanel", { panelVisible: state.panelVisible });
      }
      // updateToggleButton(state.panelVisible); ← 削除
    }

    function applyPanelState(reason = "unknown") {
      if (typeof rebuildSubtitleBlocksForPanelOpen === "function") {
        rebuildSubtitleBlocksForPanelOpen(reason);
      }

      if (typeof renderCurrentSnapshot === "function") {
        renderCurrentSnapshot();
      }

      if (typeof renderPanel === "function") {
        renderPanel();
      }

      if (typeof logContent === "function") {
        logContent("panel state applied", {
          reason,
          contentKey: state.currentContentKey,
          panelVisible: state.panelVisible,
          hasPanelHost: Boolean(getTarget?.().querySelector("#atv-panel-host")),
          hasPanelShadowRoot: Boolean(state.panelShadowRoot),
          historySize: Array.isArray(state.subtitleHistory)
            ? state.subtitleHistory.length
            : 0,
          panelPastCount: Array.isArray(state.panelPastBlocks)
            ? state.panelPastBlocks.length
            : 0,
        });
      }
    }

    // [UI shell: toggle button]
    // パネル開閉ボタンを生成する。常時表示・左半円デザイン。
    function createToggleButton() {
      if (getTarget().querySelector("#atv-toggle-btn")) return;

      const btn = document.createElement("button");
      btn.id = "atv-toggle-btn";
      btn.textContent = "›";
      btn.title = "字幕パネルを開く";
      btn.style.cssText = [
        "position:fixed",
        "top:80px",
        "right:0",
        "transform:none",
        "z-index:2147483647",
        "background:rgba(0,0,0,0.45)",
        "color:rgba(255,255,255,0.85)",
        "border:2px solid rgba(255,255,255,0.6)",
        "border-radius:10px 0 0 10px",
        "padding:14px 12px",
        "font-size:24px",
        "font-weight:bold",
        "box-shadow:-2px 2px 8px rgba(0,0,0,0.4)",
        "line-height:1",
        "cursor:pointer",
        "backdrop-filter:blur(4px)",
        "transition:right 0.3s ease, background 0.2s",
      ].join(";");

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePanel(true);
      });

      getTarget().appendChild(btn);

      // window resize でボタン位置をパネル左端に追従させる
      window.addEventListener("resize", () => {
        if (state.panelVisible) updateToggleButton(true);
      }, { passive: true });
    }

    // パネルの開閉状態に合わせてトグルボタンの表示を更新する。
    function updateToggleButton(isOpen) {
      const btn = getTarget()?.querySelector("#atv-toggle-btn");
      if (!btn) return;
      if (isOpen) {
        const panelHost = getTarget()?.querySelector("#atv-panel-host");
        const panelWidthPx = panelHost
          ? panelHost.getBoundingClientRect().width
          : 0;
        btn.textContent = "‹";
        btn.title = "字幕パネルを閉じる";
        btn.style.right = panelWidthPx + "px";
      } else {
        btn.textContent = "›";
        btn.title = "字幕パネルを開く";
        btn.style.right = "0px";
      }
    }

    function loadPanelVisibility() {
      return new Promise((resolve) => {
        chrome.storage.local.get("panelVisible", (result = {}) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          if (Object.prototype.hasOwnProperty.call(result, "panelVisible")) {
            resolve(result.panelVisible !== false);
            return;
          }
          resolve(false);
        });
      });
    }

    return {
      createRightPanel,
      createDebugPanel,
      createToggleButton,
      showRightPanel,
      hideRightPanel,
      togglePanel,
      applyPanelState,
      loadPanelVisibility,
    };
  }

  window.ATVB = window.ATVB || {};
  window.ATVB.panelUi = { createPanelUi };
})();

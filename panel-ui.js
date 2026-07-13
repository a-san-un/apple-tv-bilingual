(function () {
  "use strict";

  function createPanelUi(deps) {
    const {
      state,
      getTarget,
      ensureSecondarySubtitleElement,
      getLiveDebugLogFilter,
      getDebugLogText,
      clearDebugLogs,
      sendToBackground,
      onClosePanel,
      applyLayout,
      persistPanelVisibility,
      scheduleAdjustPlaybackControls,
      scheduleControlSettlingBurst,
      logContent,
      renderCurrentSnapshot,
      renderPanel,
      applySecondarySubtitleFallback,
    } = deps;

    const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";

    function ensurePanelSlotLayerStyle() {
      if (document.getElementById(PANEL_SLOT_LAYER_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = PANEL_SLOT_LAYER_STYLE_ID;
      style.textContent = `
        #atv-panel-host > .dual-subtitles-secondary,
        #atv-panel-host > [data-secondary-subtitle] {
          display: none !important;
        }
      `;
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
            <slot name="secondary-subtitle-slot"></slot>
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
      const target = getTarget();
      let existingHost = target.querySelector("#atv-panel-host");
      if (existingHost) {
        state.panelShadowRoot = existingHost.shadowRoot || state.panelShadowRoot;
        ensureSecondarySubtitleElement();
        return;
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
      ensureSecondarySubtitleElement();
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

    function showRightPanel() {
      const panelHost = getTarget().querySelector("#atv-panel-host");
      const overlayHost = getTarget().querySelector("#atv-overlay-host");
      const toggleBtn = getTarget().querySelector("#atv-toggle-btn");
      if (panelHost) panelHost.style.display = "";
      if (overlayHost) {
        overlayHost.style.width = "70%";
        overlayHost.style.display = "none";
      }
      if (toggleBtn) toggleBtn.style.display = "none";
    }

    function hideRightPanel() {
      const panelHost = getTarget().querySelector("#atv-panel-host");
      const overlayHost = getTarget().querySelector("#atv-overlay-host");
      const toggleBtn = getTarget().querySelector("#atv-toggle-btn");
      if (panelHost) panelHost.style.display = "none";
      if (overlayHost) {
        overlayHost.style.width = "100%";
        overlayHost.style.display = "";
      }
      if (toggleBtn) toggleBtn.style.display = "block";
    }

    function togglePanel(force) {
      if (typeof force === "boolean") state.panelVisible = force;
      else state.panelVisible = !state.panelVisible;

      applyLayout(state.panelVisible);

      const panelHost = getTarget().querySelector("#atv-panel-host");
      const overlayHost = getTarget().querySelector("#atv-overlay-host");
      const toggleBtn = getTarget().querySelector("#atv-toggle-btn");

      if (panelHost) panelHost.style.display = state.panelVisible ? "" : "none";
      if (overlayHost) {
        overlayHost.style.display = state.panelVisible ? "none" : "";
        overlayHost.style.width = state.panelVisible ? "70%" : "100%";
      }
      if (toggleBtn) {
        toggleBtn.style.display = state.panelVisible ? "none" : "block";
      }

      if (typeof scheduleAdjustPlaybackControls === "function") {
        scheduleAdjustPlaybackControls(
          "togglePanel",
          state.panelVisible ? [700, 1600] : [],
          { immediate: !state.panelVisible },
        );
      }

      if (
        state.panelVisible &&
        typeof scheduleControlSettlingBurst === "function"
      ) {
        scheduleControlSettlingBurst("togglePanel", [180, 420, 900, 1500]);
      }

      if (typeof persistPanelVisibility === "function") {
        persistPanelVisibility();
      }

      if (typeof logContent === "function") {
        logContent("togglePanel", { panelVisible: state.panelVisible });
      }
    }

    function applyPanelState(reason = "unknown") {
      if (typeof renderCurrentSnapshot === "function") {
        renderCurrentSnapshot();
      }

      if (typeof renderPanel === "function") {
        renderPanel();
      }

      let panelHost = null;
      let secondaryText = "";

      if (typeof applySecondarySubtitleFallback === "function") {
        const result = applySecondarySubtitleFallback(reason) || {};
        panelHost = result.panelHost || null;
        secondaryText = result.secondaryText || "";
      }

      if (typeof logContent === "function") {
        logContent("panel state applied", {
          reason,
          contentKey: state.currentContentKey,
          panelVisible: state.panelVisible,
          hasPanelHost: Boolean(panelHost),
          secondaryTextLength: secondaryText.length,
          historySize: state.subtitleHistory.length,
        });
      }
    }

    function loadPanelVisibility() {
      return new Promise((resolve) => {
        chrome.storage.local.get("panelVisible", (result = {}) => {
          if (chrome.runtime.lastError) {
            resolve(true);
            return;
          }
          if (Object.prototype.hasOwnProperty.call(result, "panelVisible")) {
            resolve(result.panelVisible !== false);
            return;
          }
          resolve(true);
        });
      });
    }

    return {
      createRightPanel,
      createDebugPanel,
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

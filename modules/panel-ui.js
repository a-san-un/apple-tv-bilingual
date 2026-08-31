// =============================================================
// Apple TV Bilingual Subtitles - panel-ui.js
//
// 役割:
// - 右側字幕パネルの UI host / ShadowRoot を作る
// - 字幕パネル開閉ボタンを作る
// - ネイティブトグルを再生画面へ差し込む
// - playback session に従属する panel UI module として、
//   panel host / ShadowRoot / renderer 入力組み立て / render state を管理する
//
// 位置づけ:
// - `content.js` から panel build の順序知識を受け取り、
//   mount / render / dispose の受け口を提供する session 従属 UI module。
// - `mountForPlayback()` は再生画面用 panel UI 一式を構築する入口であり、
//   `ensurePanelToggleButton()` / `createRightPanel()` / `watchForPlayerTabs()` /
//   popup host / debug panel の呼び出し順序をこのファイル内に閉じ込める。
// - visibility の正本は `modules/panel-visibility-state.js` 側にあり、
//   このファイルは DOM 表示切り替え・render state 管理・renderer 呼び出しに留める。
// - panel-renderer.js は描画専用とし、state 収集・snapshot 保持・seek 後再描画予約はこのファイルが担う。
// - subtitle block sequence / current block / meta などの block state は subtitle 側が持ち、
//   このファイルは panel 描画入力として読み取るだけに留める。
// - overlay には「表示状態を空にして隠す」軽量 cleanup と「DOM / layout tracking を完全に破棄する」
//   完全 cleanup の 2 段階があり、このファイルは subordinate UI 側の破棄処理を提供する。
// =============================================================

(function () {
  "use strict";

  /**
   * panel-ui の公開 API 一式を組み立てる。
   *
   * @param {object} deps - 依存注入オブジェクト。
   * @param {object} deps.state - content.js 側で保持する共有 state。
   * @param {() => Element|null} deps.getTarget - panel / toggle button を差し込む対象ノードを返す関数。
   * @param {(panelOpen: boolean) => void} deps.applyLayout - panelOpen に応じてレイアウトを適用する関数。
   * @param {(...args: any[]) => void} [deps.logContent] - content ログを記録する関数。
   * @param {(message: string, payload?: any) => void} [deps.logPanelProbe] - panel/UI 観測用 probe ログ関数。
   * @param {(reason: string) => void} [deps.applyPanelStateEffects] - panel open 時の補助 effects。
   *   panel block 再構築や外部副作用が必要な場合に上位 module から注入する。
   * @param {() => void} deps.destroyOverlay - overlay UI を完全破棄する関数。
   *   overlay text / visibility を一時的に空にする軽量 cleanup ではなく、
   *   DOM と layout tracking を取り除く完全 cleanup 関数を受け取る。
   * @param {() => void} [deps.mountPopupHost] - popup host（単語ポップアップ等）を mount する関数。
   * @param {() => void} [deps.mountDebugPanel] - debug panel を mount する関数。
   * @param {object} [deps.panelRenderer] - createPanelRenderer() が返した renderer API。
   * @param {() => object|null} [deps.getPanelRenderInput] - renderer に渡す描画入力を組み立てる関数。
   * @param {() => void} [deps.onPanelOpen] - panel open 時の高レベル副作用を呼ぶ関数。
   * @param {() => void} [deps.onPanelClose] - panel close 時の高レベル cleanup を呼ぶ関数。
   * @returns {object} panel-ui の公開 API。
   */
  function createPanelUi(deps) {
    const {
      state,
      getTarget,
      applyLayout,
      logContent,
      logPanelProbe,
      applyPanelStateEffects,
      destroyOverlay,
      mountPopupHost,
      mountDebugPanel,
      panelRenderer,
      getPanelRenderInput,
      onPanelOpen,
      onPanelClose,
    } = deps;

    const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";

    const PANEL_WIDTH_PERCENT = "30%";

    function getPanelWidthPercent() {
      return PANEL_WIDTH_PERCENT;
    }

    function getToggleButtonRightWhenOpen() {
      return getPanelWidthPercent();
    }

    const NATIVE_TOGGLE_STYLE_ID = "atvb-native-toggle-style";

    /**
     * native toggle 用 CSS を document 側へ 1 回だけ注入する。
     * panel.css は ShadowRoot 内専用のため、Shadow 外の native toggle には別経路で適用する。
     *
     * @returns {void}
     */
    function ensureNativeToggleStyle() {
      if (document.getElementById(NATIVE_TOGGLE_STYLE_ID)) return;

      const href = chrome.runtime.getURL("native-toggle.css");
      const link = document.createElement("link");
      link.id = NATIVE_TOGGLE_STYLE_ID;
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }

    // -----------------------------------------------------------
    // Section: render owner state
    // -----------------------------------------------------------

    /**
     * panel renderer 呼び出しにひもづく owner 状態を初期化する。
     * snapshot / signature / current auto scroll key は panel-ui が所有する。
     *
     * @returns {void}
     */
    function ensurePanelRenderOwnerState() {
      if (!state.panelRenderOwnerState) {
        state.panelRenderOwnerState = {
          lastBlockSignature: "",
          lastScrolledCurrentKey: null,
          lastRenderResult: null,
          lastRenderReason: null,
        };
      }
    }

    /**
     * panel renderer owner 状態を初期値へ戻す。
     * panel host の dispose や playback 切り替え時に使う。
     *
     * @returns {void}
     */
    function resetPanelRenderOwnerState() {
      state.panelRenderOwnerState = {
        lastBlockSignature: "",
        lastScrolledCurrentKey: null,
        lastRenderResult: null,
        lastRenderReason: null,
      };
    }

    /**
     * renderer owner 状態から前回 render signature を返す。
     *
     * @returns {string}
     */
    function getLastPanelBlockSignature() {
      return String(state.panelRenderOwnerState?.lastBlockSignature || "");
    }

    /**
     * renderer owner 状態から前回 scroll key を返す。
     *
     * @returns {string|null}
     */
    function getLastScrolledCurrentKey() {
      return state.panelRenderOwnerState?.lastScrolledCurrentKey || null;
    }

    /**
     * renderer 実行結果を owner 状態と共有 state へ反映する。
     * snapshot の正本保持は owner 内で行い、既存観測点との互換として共有 state にも同期する。
     * `state.lastPanelRenderSnapshot` は panel render artifact の共有参照であり、
     * block state の正本化や subtitle lifecycle の判断には使わない。
     *
     * @param {object|null} result
     * @param {string} reason
     * @returns {void}
     */
    function commitPanelRenderResult(result, reason) {
      ensurePanelRenderOwnerState();

      state.panelRenderOwnerState.lastRenderResult = result || null;
      state.panelRenderOwnerState.lastRenderReason = reason || null;
      state.panelRenderOwnerState.lastBlockSignature =
        String(result?.blockSignature || "");
      state.panelRenderOwnerState.lastScrolledCurrentKey =
        result?.lastScrolledCurrentKey || null;

      state.lastPanelBlockSignature = String(result?.blockSignature || "");
      state.lastPanelRenderSnapshot = result?.snapshot || null;

      if (result?.snapshot?.currentPrimaryCueStartTime != null) {
        state.lastPrimarySnapshotAt = Date.now();
      }
    }

    /**
     * seek 後の panel 再描画予約を 1 本化する。
     * 多重 setTimeout を避けるため、既存 timer があれば先に打ち消す。
     *
     * @param {string} reason
     * @param {number} [delayMs=100]
     * @returns {void}
     */
    function schedulePanelRender(reason, delayMs = 100) {
      if (state.panelRenderTimerId) {
        clearTimeout(state.panelRenderTimerId);
        state.panelRenderTimerId = null;
      }

      state.panelRenderTimerId = setTimeout(() => {
        state.panelRenderTimerId = null;
        renderCurrentPanel(reason);
      }, delayMs);
    }

    /**
     * renderer へ seek 要求を受けたときの owner 側処理を行う。
     * video 直接操作と再描画予約は panel-ui が担う。
     *
     * @param {{ time: number, block?: object|null, reason?: string }} payload
     * @returns {void}
     */
    function handlePanelSeekRequest(payload) {
      const time = Number(payload?.time);
      if (!state.video || Number.isNaN(time)) return;

      state.video.currentTime = time;
      schedulePanelRender(payload?.reason || "panel-seek");
    }

    /**
     * renderer に渡す描画入力を組み立てる。
     * panel-renderer.js へ state を直接渡さず、この owner が入力へ分解する。
     *
     * @returns {object|null}
     */
    function buildPanelRenderInput() {
      ensurePanelRenderOwnerState();

      if (typeof getPanelRenderInput === "function") {
        const externalInput = getPanelRenderInput();
        if (!externalInput) return null;

        return {
          ...externalInput,
          shadowRoot: externalInput.shadowRoot || state.panelShadowRoot || null,
          lastBlockSignature:
            externalInput.lastBlockSignature ?? getLastPanelBlockSignature(),
          lastScrolledCurrentKey:
            externalInput.lastScrolledCurrentKey ?? getLastScrolledCurrentKey(),
          onSeekRequested:
            externalInput.onSeekRequested || handlePanelSeekRequest,
        };
      }

      return {
        shadowRoot: state.panelShadowRoot || null,
        subtitleBlocks: state.subtitleBlocks || null,
        subtitleView: state.currentSubtitleView || null,
        currentSubtitleBlock: state.currentSubtitleBlock || null,
        currentTime: state.video ? Number(state.video.currentTime || 0) : 0,
        primaryTrack: state.primaryTrack || null,
        lastBlockSignature: getLastPanelBlockSignature(),
        lastScrolledCurrentKey: getLastScrolledCurrentKey(),
        onSeekRequested: handlePanelSeekRequest,
      };
    }

    /**
     * panel renderer を実行し、owner 状態へ commit する。
     *
     * @param {string} reason
     * @returns {object|null}
     */
    function renderCurrentPanel(reason) {
      if (!state.panelOpen) return null;
      if (!state.panelShadowRoot) return null;
      if (typeof panelRenderer?.renderPanel !== "function") return null;

      const input = buildPanelRenderInput();
      if (!input?.shadowRoot) return null;

      const result = panelRenderer.renderPanel(input);
      commitPanelRenderResult(result, reason);

      logPanelProbe?.("panel render completed", {
        reason,
        hasResult: Boolean(result),
        didRebuildList: Boolean(result?.didRebuildList),
        currentBlockKey: result?.currentBlock?.key || null,
        allBlocksCount: result?.snapshot?.allBlocksCount ?? null,
      });

      return result;
    }

    // -----------------------------------------------------------
    // Section: panel slot style
    // -----------------------------------------------------------

    /**
     * パネル配置用の style 要素を 1 回だけ head へ追加する。
     * 既に存在する場合は何もしない（冪等）。
     *
     * @returns {void}
     */
    function ensurePanelSlotLayerStyle() {
      if (document.getElementById(PANEL_SLOT_LAYER_STYLE_ID)) return;

      const style = document.createElement("style");
      style.id = PANEL_SLOT_LAYER_STYLE_ID;
      style.textContent = ``;
      document.head.appendChild(style);
    }

    // -----------------------------------------------------------
    // Section: panel shell HTML builders
    // -----------------------------------------------------------

    /**
     * パネル本体（header・debug shell・字幕リスト領域）の HTML を返す。
     * ShadowRoot 内に挿入するため、panel.css へのリンクを合わせて出力する。
     *
     * @returns {string}
     */
    function buildPanelShellHTML() {
      const panelCssUrl = chrome.runtime.getURL("panel.css");
      const debugShellHtml =
        window.ATVB?.debugPanelShell?.buildDebugPanelShellHTML?.({
          variant: "panel",
          sourceOptions: ["content"],
          categoryOptions: ["subtitle"],
          placeholder: "cuechange / overlay / current subtitle block",
        }) ?? "";

      return `
        <link rel="stylesheet" href="${panelCssUrl}">
        <div id="panel" class="dual-subtitles-panel" data-dual-subtitles-panel>
          <div id="panel-header">
            <span>📋 字幕履歴</span>
            <div class="panel-header-actions">
              <button id="settings-btn" type="button" title="設定">⚙️</button>
            </div>
          </div>
          ${debugShellHtml}
          <div id="panel-scroll">
            <div id="subtitle-list"></div>
          </div>
        </div>
      `;
    }

    /**
     * パネルヘッダー内のボタン（設定ボタン等）へイベントを配線する。
     * `state.panelShadowRoot` が未生成の場合は何もしない。
     *
     * @returns {void}
     */
    function wirePanelHeaderActions() {
      const root = state.panelShadowRoot;
      if (!root) return;

      root.getElementById("settings-btn")?.addEventListener("click", () => {
        try {
          chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
        } catch (_) {}
      });
    }

    // -----------------------------------------------------------
    // Section: panel host lifecycle (create / debug mount)
    // -----------------------------------------------------------

    /**
     * 右側字幕パネルの host（ShadowRoot を持つ div）を作る。
     * 既存 host があればそれを再利用し、ShadowRoot 参照を state に同期する。
     *
     * @returns {Element|null}
     */
    function createRightPanel() {
      const target = getTarget?.();
      if (!target) return null;

      const existingHost = target.querySelector("#atv-panel-host");
      if (existingHost) {
        state.panelShadowRoot = existingHost.shadowRoot || state.panelShadowRoot;
        ensurePanelRenderOwnerState();
        wirePanelHeaderActions();
        return existingHost;
      }

      const host = document.createElement("div");
      host.id = "atv-panel-host";
      host.style.position = "fixed";
      host.style.top = "0";
      host.style.right = "0";
      host.style.width = getPanelWidthPercent();
      host.style.height = "100vh";
      host.style.display = "none";
      host.style.zIndex = "2147483647";
      host.style.pointerEvents = "auto";
      host.style.boxSizing = "border-box";

      state.panelShadowRoot = host.attachShadow({ mode: "open" });
      state.panelShadowRoot.innerHTML = buildPanelShellHTML();

      target.appendChild(host);
      ensurePanelRenderOwnerState();
      wirePanelHeaderActions();

      return host;
    }

    /**
     * panel UI 主要要素をまとめて返す。
     *
     * @returns {{
     *   target: Element|null,
     *   panelHost: Element|null,
     *   panelRoot: ShadowRoot|null,
     *   toggleButton: HTMLElement|null,
     * }}
     */
    function getPanelUiElements() {
      const target = getTarget?.() || null;
      const panelHost = target?.querySelector?.("#atv-panel-host") || null;
      const toggleButton = target?.querySelector?.("#atv-toggle-btn") || null;

      return {
        target,
        panelHost,
        panelRoot: state.panelShadowRoot || null,
        toggleButton,
      };
    }

    /**
     * 指定 id の host を target 配下から削除する。
     * 低レベルな DOM host 除去だけを担当し、observer / timer / render state / overlay の
     * cleanup は行わない。
     *
     * @param {string} id
     * @returns {void}
     */
    function removeHost(id) {
      const target = getTarget?.();
      const host = target?.querySelector?.(`#${id}`);
      host?.remove?.();
    }

    /**
     * panel renderer owner state / snapshot / signature を初期化する。
     * panel UI owner が持つ描画アーティファクトの cleanup だけを担当する。
     *
     * @returns {void}
     */
    function clearPanelRenderArtifacts() {
      state.lastPanelRenderSnapshot = null;
      state.lastPanelBlockSignature = "";
      resetPanelRenderOwnerState();
    }

    /**
     * panel session UI を撤収する。
     * panel host / toggle button / native observer / resize listener / render timer /
     * render snapshot / renderer state / overlay DOM を対称に cleanup する。
     *
     * 再起動・拡張 OFF・content switch を含む session teardown では、
     * playback-session-cleanup.js など上位 lifecycle から呼ばれる
     * subordinate UI 側の dispose として使う。
     *
     * この関数は panel host / toggle button / overlay DOM / render artifacts などの
     * panel UI 内部資源を解放する撤収口であり、session cleanup の owner にはしない。
     * 低レベルな host 除去は `removeHost()` を内部利用して行う。
     *
     * overlay については、表示テキストや visible state を空にして隠す軽量 cleanup
     * ではなく、DOM と layout tracking を取り除く完全破棄を担当する。
     *
     * 一方で subtitle block sequence / current block / block meta などの block state は
     * subtitle 側の責務であり、この関数では破棄しない。
     *
     * 冪等に呼べることを前提とし、対象が未生成・未接続でも安全に復帰する。
     *
     * @param {{ reason?: string }} [options]
     * @returns {void}
     */
    function dispose({ reason = "unknown" } = {}) {
      logContent?.("panel-ui dispose start", {
        reason,
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
        panelOpen: Boolean(state.panelOpen),
      });

      if (state.panelTabsObserver?.disconnect) {
        state.panelTabsObserver.disconnect();
        state.panelTabsObserver = null;
      }

      if (state.toggleButtonResizeHandler) {
        window.removeEventListener("resize", state.toggleButtonResizeHandler);
        state.toggleButtonResizeHandler = null;
      }

      if (state.panelRenderTimerId) {
        clearTimeout(state.panelRenderTimerId);
        state.panelRenderTimerId = null;
      }

      removeHost("atv-panel-host");
      removeHost("atv-toggle-btn");

      state.panelShadowRoot = null;
      clearPanelRenderArtifacts();

      if (typeof destroyOverlay === "function") {
        destroyOverlay();
      }

      logContent?.("panel-ui dispose done", {
        reason,
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
        panelOpen: Boolean(state.panelOpen),
      });
    }

    // -----------------------------------------------------------
    // Section: panel visibility / state application
    // -----------------------------------------------------------

    /**
     * panel 表示状態を DOM へ反映する。
     * panel host の display と toggle button の見た目更新だけを担当する。
     *
     * @param {boolean} show
     * @returns {void}
     */
    function applyPanelVisibility(show) {
      const { panelHost } = getPanelUiElements();
      if (panelHost instanceof HTMLElement) {
        panelHost.style.display = show ? "" : "none";
      }

      syncPanelToggleButton(show);
      applyLayout?.(show);
    }

    /**
     * panel 開閉状態を切り替える。
     * force 未指定時は現在値を反転し、指定時はその値へ合わせる。
     *
     * @param {boolean} [force]
     * @returns {boolean} 新しい panelOpen 状態
     */
    function togglePanel(force) {
      const prevOpen = Boolean(state.panelOpen);
      const nextOpen =
        typeof force === "boolean" ? force : !prevOpen;

      state.panelOpen = nextOpen;
      applyPanelVisibility(nextOpen);

      if (nextOpen) {
        applyPanelState("toggle-open");
        if (!prevOpen && typeof onPanelOpen === "function") {
          onPanelOpen();
        }
      } else if (prevOpen && typeof onPanelClose === "function") {
        onPanelClose();
      }

      return nextOpen;
    }

    /**
     * 外部向け panel open setter。
     *
     * @param {boolean} panelOpen
     * @returns {void}
     */
    function setPanelOpen(panelOpen) {
      togglePanel(Boolean(panelOpen));
    }

    /**
     * panel open 時に必要な state effects と renderer 反映をまとめて適用する。
     * block 再構築・外部 effects・panel render をこの owner で順序制御する。
     *
     * panel open 直後、mount 直後、再初期化完了後など、
     * 現在の subtitle / block / visibility state を panel 表示へ再適用したい場面で使う。
     * 単なる再描画 API ではなく、applyPanelStateEffects() を通した state effects を含む。
     *
     * 既存 state を前提に panel list だけを描き直したい場合は refreshPanel() を使う。
     *
     * @param {string} reason
     * @returns {void}
     */
    function applyPanelState(reason) {
      logPanelProbe?.("applyPanelState start", {
        reason,
        panelOpen: Boolean(state.panelOpen),
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
      });

      if (!state.panelOpen) return;
      if (!state.panelShadowRoot) return;

      if (typeof applyPanelStateEffects === "function") {
        applyPanelStateEffects(reason);
      }

      renderCurrentPanel(reason);

      logPanelProbe?.("applyPanelState done", {
        reason,
        panelOpen: Boolean(state.panelOpen),
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
        hasSnapshot: Boolean(state.lastPanelRenderSnapshot),
        lastPanelBlockSignature: state.lastPanelBlockSignature || "",
      });
    }

    // -----------------------------------------------------------
    // Section: 字幕パネル開閉ボタン
    // -----------------------------------------------------------

    /**
     * 字幕パネル開閉ボタンの見た目と状態を反映する。
     *
     * @param {HTMLElement} button
     * @param {boolean} isOpen
     * @returns {void}
     */
    function applyPanelToggleButtonState(button, isOpen) {
      button.style.position = "fixed";
      button.style.top = "60px";
      button.style.right = isOpen ? getToggleButtonRightWhenOpen() : "0px";
      button.style.zIndex = "2147483647";
      button.style.display = "";

      button.style.background = "rgba(0,0,0,0.7)";
      button.style.color = "white";
      button.style.border = "1px solid rgba(255,255,255,0.25)";
      button.style.borderRadius = "8px";
      button.style.padding = "4px 10px";
      button.style.fontSize = "16px";
      button.style.lineHeight = "1";
      button.style.cursor = "pointer";
      button.style.backdropFilter = "blur(4px)";
      button.style.webkitBackdropFilter = "blur(4px)";
      button.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";

      button.textContent = isOpen ? "‹" : "›";
      button.title = isOpen ? "字幕パネルを閉じる" : "字幕パネルを開く";
    }

    /**
     * 字幕パネル開閉ボタンを生成し、未生成時のみ target へ追加する。
     * 既存ボタンがある場合は再利用し、resize handler も 1 本に保つ。
     *
     * @returns {HTMLElement|null}
     */
    function ensurePanelToggleButton() {
      const target = getTarget?.();
      if (!target) return null;

      const existing = target.querySelector("#atv-toggle-btn");
      if (existing instanceof HTMLElement) {
        syncPanelToggleButton(Boolean(state.panelOpen));
        return existing;
      }

      const button = document.createElement("button");
      button.id = "atv-toggle-btn";
      button.type = "button";

      applyPanelToggleButtonState(button, Boolean(state.panelOpen));

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
      });

      target.appendChild(button);

      if (state.toggleButtonResizeHandler) {
        window.removeEventListener("resize", state.toggleButtonResizeHandler);
        state.toggleButtonResizeHandler = null;
      }

      state.toggleButtonResizeHandler = () => {
        syncPanelToggleButton(Boolean(state.panelOpen));
      };

      window.addEventListener("resize", state.toggleButtonResizeHandler, {
        passive: true,
      });

      return button;
    }

    /**
     * 字幕パネル開閉ボタンの矢印表記と位置を現在の panel 状態へ同期する。
     *
     * @param {boolean} isOpen
     * @returns {void}
     */
    function syncPanelToggleButton(isOpen) {
      const button = getTarget?.()?.querySelector?.("#atv-toggle-btn");
      if (!(button instanceof HTMLElement)) {
        logPanelProbe?.("字幕パネル開閉ボタン update skipped: button missing", {
          requestedOpen: isOpen,
          panelOpen: state.panelOpen,
        });
        return;
      }

      applyPanelToggleButtonState(button, isOpen);

      logPanelProbe?.("字幕パネル開閉ボタン update done", {
        requestedOpen: isOpen,
        panelOpen: state.panelOpen,
        buttonRight: button.style.right,
        buttonTitle: button.title,
        buttonText: button.textContent,
        buttonDisplay: button.style.display,
      });
    }

    // -----------------------------------------------------------
    // Section: native toggle injection
    // -----------------------------------------------------------

    /**
     * 再生画面のネイティブタブ横へ拡張 ON/OFF トグルを差し込む。
     * native toggle は ShadowRoot 外の document 側 DOM に置くため、
     * native-toggle.css を document.head へ注入したうえで、
     * PlayerTab の sibling として li 要素を追加する。
     *
     * @returns {void}
     */
    function injectNativeToggle() {
      if (document.getElementById("atvb-native-toggle")) return;

      const upNextBtn = document.querySelector(
        '[data-testid="uts.col.PlayerTabUpNext-trigger"]'
      );
      if (!(upNextBtn instanceof HTMLElement)) return;

      ensureNativeToggleStyle();

      const wrapper = document.createElement("li");
      wrapper.id = "atvb-native-toggle";
      wrapper.dataset.enabled = "false";

      const control = document.createElement("button");
      control.type = "button";
      control.className = "atvb-native-toggle__control";
      control.setAttribute("role", "switch");
      control.setAttribute("aria-checked", "false");

      const track = document.createElement("span");
      track.className = "atvb-native-toggle__track";

      const knob = document.createElement("span");
      knob.className = "atvb-native-toggle__knob";
      track.appendChild(knob);

      const label = document.createElement("span");
      label.className = "atvb-native-toggle__label";
      label.textContent = "拡張 OFF";

      control.appendChild(track);
      control.appendChild(label);
      wrapper.appendChild(control);

      function renderExtensionEnabled(enabled) {
        wrapper.dataset.enabled = String(enabled);
        control.setAttribute("aria-checked", String(enabled));
        label.textContent = enabled ? "拡張 ON" : "拡張 OFF";
        control.title = enabled ? "拡張 ON" : "拡張 OFF";
      }

      renderExtensionEnabled(state.extensionEnabled !== false);

      let toggleInFlight = false;

      control.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (toggleInFlight) return;
        toggleInFlight = true;

        const next = !(state.extensionEnabled !== false);

        renderExtensionEnabled(next);

        chrome.runtime.sendMessage(
          {
            type: "APPLY_SETTINGS_TO_APPLE_TV",
            reason: "native_toggle",
            settings: { extensionEnabled: next },
          },
          () => {
            if (chrome.runtime.lastError) {
              logPanelProbe?.("native toggle apply failed", {
                message: chrome.runtime.lastError.message,
                next,
              });
              renderExtensionEnabled(state.extensionEnabled !== false);
            }
            toggleInFlight = false;
          }
        );
      });

      upNextBtn.closest("li")?.after(wrapper);
    }

    /**
     * 再生タブの出現を監視し、ネイティブトグルを差し込む／再注入する。
     *
     * @returns {void}
     */
    function watchForPlayerTabs() {
      state.panelTabsObserver?.disconnect?.();
      state.panelTabsObserver = null;

      if (document.querySelector('[data-testid="uts.col.PlayerTabUpNext-trigger"]')) {
        injectNativeToggle();
      }

      const observer = new MutationObserver(() => {
        const tabExists = !!document.querySelector(
          '[data-testid="uts.col.PlayerTabUpNext-trigger"]'
        );
        const toggleExists = !!document.getElementById("atvb-native-toggle");

        if (tabExists && !toggleExists) {
          injectNativeToggle();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      state.panelTabsObserver = observer;
    }

    // -----------------------------------------------------------
    // Section: playback mount entry point
    // -----------------------------------------------------------

    /**
     * 再生画面用の panel UI 一式をまとめて mount する。
     *
     * @param {object} [options]
     * @param {boolean} [options.panelOpen=false]
     * @returns {void}
     */
    function mountForPlayback({ panelOpen = false } = {}) {
      ensurePanelSlotLayerStyle();
      ensurePanelRenderOwnerState();
      ensurePanelToggleButton();
      createRightPanel();
      watchForPlayerTabs();

      if (typeof mountPopupHost === "function") {
        mountPopupHost();
      }

      if (typeof mountDebugPanel === "function") {
        mountDebugPanel();
      }

      state.panelOpen = Boolean(panelOpen);
      applyPanelVisibility(state.panelOpen);

      if (state.panelOpen) {
        applyPanelState("mount-for-playback");
      }
    }

    /**
     * toggle-only 起動用の公開 API。
     *
     * @returns {void}
     */
    function mountToggleOnlyUi() {
      watchForPlayerTabs();
    }

    /**
     * panel renderer の再描画だけを外部から要求する。
     * content.js は renderer 実装詳細を知らず、この高レベル API のみを使う。
     *
     * 既存 state を前提に panel list を描き直したいだけの場面で使う。
     * block 再構築や外部 effects の再実行は行わず、renderCurrentPanel() だけを呼ぶ。
     *
     * panel open 時の state 再適用や、mount / 再初期化後の effects を伴う反映には
     * applyPanelState() を使う。
     *
     * @param {string} [reason="external-refresh"]
     * @returns {object|null}
     */
    function refreshPanel(reason = "external-refresh") {
      return renderCurrentPanel(reason);
    }

    return {
      dispose,
      mountForPlayback,
      setPanelOpen,
      applyPanelState,
      refreshPanel,
      mountToggleOnlyUi,
    };
  }

  const root = (window.ATVB = window.ATVB || {});
  root.panelUi = root.panelUi || {};
  root.panelUi.createPanelUi = createPanelUi;
})();

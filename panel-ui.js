// =============================================================
// Apple TV Bilingual Subtitles - panel-ui.js
//
// 役割:
// - 右側字幕パネルの UI ホストを作る
// - 字幕パネル開閉ボタンを作る
// - ネイティブトグルを再生画面へ差し込む
// - パネル表示とボタン見た目を分けて扱う
//
// 位置づけ:
// - `content.js` から panel build の「順序知識」を引き受ける owner。
// - `mountForPlayback()` が再生画面用 panel UI 一式の唯一の入口となり、
//   `createToggleButton()` / `createRightPanel()` / `watchForPlayerTabs()` /
//   popup host / debug panel の呼び出し順序をこのファイル内に閉じ込める。
// - `setPanelOpen()` は表示切り替えの外部向け窓口として `applyPanelVisibility()`
//   をラップする。呼び出し元（content.js）が内部関数名を直接知らなくてよい形にする。
// - visibility の永続化正本は `modules/panel-visibility-state.js`側にあり、
//   このファイルは DOM 表示切り替えと button 見た目の owner に留める。
// =============================================================

(function () {
  "use strict";

  /**
   * panel-ui の公開 API 一式を組み立てる。
   *
   * @param {object} deps - 依存注入オブジェクト。
   * @param {object} deps.state - content.js 側で保持する共有 state。
   * @param {() => Element} deps.getTarget - panel / toggle button を差し込む対象ノードを返す関数。
   * @param {(panelOpen: boolean) => void} deps.applyLayout - panelOpen に応じてレイアウトを適用する関数。
   * @param {(...args: any[]) => void} deps.logContent - content ログを記録する関数。
   * @param {(reason: string) => void} deps.applyPanelStateEffects - panel open 時に必要な
   *   block 再構築・snapshot 描画・履歴パネル再描画をまとめて適用する関数。
   * @param {() => void} deps.destroyOverlay - overlay UI を破棄する関数。
   * @param {() => void} [deps.mountPopupHost] - popup host（単語ポップアップ等）を mount する関数。
   * @param {() => void} [deps.mountDebugPanel] - debug panel を mount する関数。
   * @param {object} [deps.overlayController] - overlay 位置同期などを行うコントローラ。
   * @returns {object} panel-ui の公開 API。
   */
  function createPanelUi(deps) {
    const {
      state,
      getTarget,
      applyLayout,
      logContent,
      applyPanelStateEffects,
      destroyOverlay,
      mountPopupHost,
      mountDebugPanel,
    } = deps;

    const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";

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

      // panel host 用の style タグを head に追加する
      const style = document.createElement("style");
      style.id = PANEL_SLOT_LAYER_STYLE_ID;
      style.textContent = ``;
      document.head.appendChild(style);
    }

    // -----------------------------------------------------------
    // Section: panel shell HTML builders
    // -----------------------------------------------------------

    // debug panel shell は shared builder（debug-panel-shell.js）から取得する。

    /**
     * パネル本体（header・debug shell・字幕リスト領域）の HTML を返す。
     * ShadowRoot 内に挿入するため、panel.css へのリンクを合わせて出力する。
     *
     * @returns {string} panel 本体の HTML 文字列。
     */
    function buildPanelShellHTML() {
      // ShadowRoot 内で panel.css を読むための URL を解決する
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
      // panel host の ShadowRoot を参照する
      const root = state.panelShadowRoot;
      if (!root) return;

      root.getElementById("settings-btn")?.addEventListener("click", () => {
        try {
          // options ページを開く依頼を background へ送る
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
     * @returns {Element|null} 作成または再利用した panel host 要素。target が無ければ null。
     */
    function createRightPanel() {
      // パネルを差し込む対象ノードを取る
      const target = getTarget?.();
      if (!target) return null;

      // 既存 host があれば再利用する
      let existingHost = target.querySelector("#atv-panel-host");
      if (existingHost) {
        state.panelShadowRoot = existingHost.shadowRoot || state.panelShadowRoot;
        return existingHost;
      }

      // 新しい panel host を作る
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

      // target に host を追加して ShadowRoot を初期化する
      target.appendChild(host);
      ensurePanelSlotLayerStyle();
      state.panelShadowRoot = host.attachShadow({ mode: "open" });
      state.panelShadowRoot.innerHTML = buildPanelShellHTML();
      wirePanelHeaderActions();

      return host;
    }

    // -----------------------------------------------------------
    // Section: UI element lookup / destroy
    // -----------------------------------------------------------

    /**
     * 主要 UI 要素（panel host / overlay host / toggle button）をまとめて返す。
     *
     * @returns {{panelHost: Element|null, overlayHost: Element|null, toggleBtn: Element|null}}
     */
    function getPanelUiElements() {
      // target 配下の UI 要素を一か所で集める
      const target = getTarget();

      return {
        panelHost: target.querySelector("#atv-panel-host"),
        overlayHost: target.querySelector("#atv-overlay-host"),
        toggleBtn: target.querySelector("#atv-toggle-btn"),
      };
    }

    /**
     * 指定 id の UI host を DOM から削除する。
     *
     * @param {string} id - 削除対象要素の id（# は不要）。
     * @returns {void}
     */
    function removeHost(id) {
      // panel host / toggle button ともに target 配下を見る
      const root = getTarget();
      const el = root.querySelector(`#${id}`);
      if (el) el.remove();
    }

    /**
     * panel owner が保持する UI host / observer / overlay 参照を冪等に破棄する。
     * restart / extension disabled / playback close のいずれから呼ばれても壊れない。
     *
     * 注意:
     * - popup / debug host の実装 owner は Step 18 まで content.js 側に残る。
     * - ただし teardown 契約上の破棄責務は panel-ui.dispose() が持つ。
     *
     * @param {object} [options]
     * @param {string} [options.reason="unknown"] - ログ用の破棄理由。
     * @returns {void}
     */
    function dispose({ reason = "unknown" } = {}) {
      logContent?.("panelUi.dispose begin", {
        reason,
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
        hasPopupShadowRoot: Boolean(state.popupShadowRoot),
        hasDebugPanelRoot: Boolean(state.debugPanelRoot),
        hasPanelTabsObserver: Boolean(state.panelTabsObserver),
      });

      // debug panel があれば先に unmount する
      window.ATVB?.debugPanelRuntime?.unmount?.(state.debugPanelRoot);

      // panel tabs observer があれば先に止める
      state.panelTabsObserver?.disconnect?.();
      state.panelTabsObserver = null;

      // 再生画面に影響する UI host を個別に消す
      removeHost("atv-panel-host");
      removeHost("atv-popup-host");
      removeHost("atv-toggle-btn");

      const nativeToggleEl = document.getElementById("atvb-native-toggle");
      if (nativeToggleEl) {
        const liWrapper = nativeToggleEl.closest("li");
        if (liWrapper) {
          liWrapper.remove();
        } else {
          nativeToggleEl.remove();
        }
      }

      destroyOverlay?.();

      state.panelShadowRoot = null;
      state.popupShadowRoot = null;
      state.debugPanelRoot = null;

      logContent?.("panelUi.dispose done", {
        reason,
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
        hasPopupShadowRoot: Boolean(state.popupShadowRoot),
        hasDebugPanelRoot: Boolean(state.debugPanelRoot),
        hasPanelTabsObserver: Boolean(state.panelTabsObserver),
      });
    }

    // -----------------------------------------------------------
    // Section: visibility control
    // -----------------------------------------------------------

    /**
     * 右側字幕パネルと overlay の表示・非表示だけを切り替える。
     * DOM の表示切り替え後、次のフレームで overlay 位置と toggle button を
     * 再計算する（panelWidthPx のズレを防ぐため rAF 内で実行する）。
     *
     * @param {boolean} show - true でパネルを表示、false で非表示にする。
     * @returns {void}
     */
    function applyPanelVisibility(show) {
      logContent?.("右側字幕パネル applyPanelVisibility start", {
        requestedOpen: show,
        panelOpen: state.panelOpen,
        hasSubtitlePanelToggleButton: Boolean(
          getTarget?.().querySelector("#atv-toggle-btn"),
        ),
      });

      const { panelHost, overlayHost } = getPanelUiElements();

      // パネル本体の表示を先に切り替える。
      if (panelHost) panelHost.style.display = show ? "" : "none";

      // パネル DOM が確定してから overlay 位置・ボタン位置を再計算する。
      // updateToggleButton も rAF 内に移動し、panelWidthPx のズレを防ぐ。
      requestAnimationFrame(() => {
        deps.overlayController?.syncOverlayPositionToPlayer?.({
          reason: "panel-visibility-change",
          panelOpen: show,
        });
        updateToggleButton(show);
      });

      logContent?.("右側字幕パネル applyPanelVisibility done", {
        requestedOpen: show,
        panelOpen: state.panelOpen,
        hasPanelHost: Boolean(panelHost),
        hasOverlayHost: Boolean(overlayHost),
        panelHostDisplay: panelHost?.style?.display ?? null,
        overlayHostDisplay: overlayHost?.style?.display ?? null,
      });
    }

    /**
     * panel の開閉 state を切り替え、レイアウト・表示を反映してから
     * ランタイム値を local へ永続化する。
     *
     * @param {boolean} [force] - 明示的に開閉状態を指定する場合に渡す。省略時は現在値を反転する。
     * @returns {void}
     */
    function togglePanel(force) {
      // force があればそれを使い、なければ現在値を反転する
      if (typeof force === "boolean") state.panelOpen = force;
      else state.panelOpen = !state.panelOpen;

      // レイアウトとパネル表示を新しい状態へ合わせる
      applyLayout?.(state.panelOpen);
      applyPanelVisibility(state.panelOpen);

      // ランタイム状態を local へ保存する
      globalThis.ATVB_PANEL_VISIBILITY?.persist(state.panelOpen);
    }

    /**
     * `state.panelOpen` の現在値に対して表示だけを反映する。
     * `togglePanel` と異なり state 自体は変更せず、永続化も行わない。
     * 外部（content.js）から「今の panelOpen を表示へ反映したい」場合の窓口。
     *
     * @param {boolean} panelOpen - 反映したい開閉状態。
     * @returns {void}
     */
    function setPanelOpen(panelOpen) {
      applyPanelVisibility(panelOpen);
    }

    /**
     * panel 状態全体を適用する（表示制御 → panel open 時の副作用適用）。
     * `reason` はログ用のトリガー識別文字列。
     *
     * - block 再構築 / snapshot 描画 / 履歴パネル再描画の順序知識は
     *   `content.js` 側の高レベル API へ委譲し、この owner は「いつ適用するか」だけを持つ。
     *
     * @param {string} reason - 呼び出し理由（ログ用）。
     * @returns {void}
     */
    function applyPanelState(reason) {
      logContent?.("右側字幕パネル applyPanelState start", {
        reason,
        panelOpen: state.panelOpen,
        hasPanelHost: Boolean(getTarget?.().querySelector("#atv-panel-host")),
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
      });

      // 表示切り替えを先に行う
      applyPanelVisibility(state.panelOpen);

      // panel open 時に必要な block / snapshot / render 反映は
      // content.js から渡された高レベル API へまとめて委譲する。
      if (typeof applyPanelStateEffects === "function") {
        applyPanelStateEffects(reason);
      }

      // パネル状態をログへ残す
      if (typeof logContent === "function") {
        logContent("panel state applied", {
          reason,
          contentKey: state.currentContentKey,
          panelOpen: state.panelOpen,
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

    // -----------------------------------------------------------
    // Section: toggle button
    // -----------------------------------------------------------

    /**
     * 字幕パネル開閉ボタン（固定表示の ›/‹ ボタン）を作る。
     * 既にボタンが存在する場合は再作成しない。
     * クリックで `togglePanel()` を呼び、resize 時は開いている場合のみ位置を再計算する。
     *
     * @returns {void}
     */
    function createToggleButton() {
      logContent?.("字幕パネル開閉ボタン create start", {
        alreadyExists: Boolean(getTarget().querySelector("#atv-toggle-btn")),
        panelOpen: state.panelOpen,
      });

      if (getTarget().querySelector("#atv-toggle-btn")) {
        logContent?.("字幕パネル開閉ボタン create skipped: already exists", {
          panelOpen: state.panelOpen,
        });
        return;
      }

      // target 直下に置く固定ボタンを作る
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

      // クリックで panelOpen を切り替える
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePanel();
      });

      // 作ったボタンを target に追加する
      getTarget().appendChild(btn);

      logContent?.("字幕パネル開閉ボタン create appended", {
        existsAfterAppend: Boolean(getTarget().querySelector("#atv-toggle-btn")),
        panelOpen: state.panelOpen,
      });

      // 初期状態の矢印と位置を反映する
      updateToggleButton(state.panelOpen);

      logContent?.("字幕パネル開閉ボタン create done", {
        panelOpen: state.panelOpen,
        buttonRight: btn.style.right,
        buttonTitle: btn.title,
        buttonText: btn.textContent,
      });

      {
        const rect = btn.getBoundingClientRect();
        const style = window.getComputedStyle(btn);
        logContent?.("字幕パネル開閉ボタン diagnostics", {
          reason: "createToggleButton",
          isConnected: btn.isConnected,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          position: style.position,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents,
          parentTag: btn.parentElement?.tagName || null,
          parentId: btn.parentElement?.id || null,
          parentClassName: btn.parentElement?.className || null,
        });
      }

      // パネル表示中だけ resize 時の位置を再計算する
      // ★ M-1 fix: 無名関数のままだと destroy 時に removeEventListener できないため、
      // state に参照を保持して対称に解除できるようにする
      if (state.toggleButtonResizeHandler) {
        window.removeEventListener("resize", state.toggleButtonResizeHandler);
        state.toggleButtonResizeHandler = null;
      }

      state.toggleButtonResizeHandler = () => {
        if (state.panelOpen) updateToggleButton(true);
      };

      window.addEventListener(
        "resize",
        state.toggleButtonResizeHandler,
        { passive: true }
      );
    }

    /**
     * toggle button の矢印表記と位置（right オフセット）だけを更新する。
     * ボタンが存在しない場合は何もしない。
     *
     * @param {boolean} isOpen - true なら「閉じる」表記＋panel 幅ぶんオフセット、false なら「開く」表記＋右端。
     * @returns {void}
     */
    function updateToggleButton(isOpen) {
      // target 上の toggle button を取る
      const btn = getTarget().querySelector("#atv-toggle-btn");
      if (!btn) {
        logContent?.("字幕パネル開閉ボタン update skipped: button missing", {
          requestedOpen: isOpen,
          panelOpen: state.panelOpen,
        });
        return;
      }

      if (isOpen) {
        // 開いているときは panel host 幅を見て左端へ追従させる
        const panelHost = getTarget()?.querySelector("#atv-panel-host");
        const panelWidthPx = panelHost
          ? panelHost.getBoundingClientRect().width
          : 0;

        btn.textContent = "‹";
        btn.title = "字幕パネルを閉じる";
        btn.style.right = panelWidthPx + "px";
        btn.style.display = "";
      } else {
        // 閉じているときは右端へ戻して開く向きにする
        btn.textContent = "›";
        btn.title = "字幕パネルを開く";
        btn.style.right = "0px";
        btn.style.display = "";
      }

      logContent?.("字幕パネル開閉ボタン update done", {
        requestedOpen: isOpen,
        panelOpen: state.panelOpen,
        buttonRight: btn.style.right,
        buttonTitle: btn.title,
        buttonText: btn.textContent,
        buttonDisplay: btn.style.display,
      });
    }

    // -----------------------------------------------------------
    // Section: visibility persistence (load only; persist は togglePanel 内)
    // -----------------------------------------------------------
    // Section: native toggle injection
    // -----------------------------------------------------------

    /**
     * 再生画面のネイティブタブ横（Up Next タブの隣）へ拡張 ON/OFF トグルを差し込む。
     * Up Next タブが見つからない場合、または既にトグルが存在する場合は何もしない。
     *
     * @returns {void}
     */
    function injectNativeToggle() {
      if (document.getElementById("atvb-native-toggle")) return;

      // Apple TV+ の Up Next タブを差し込み位置として使う
      const upNextBtn = document.querySelector(
        '[data-testid="uts.col.PlayerTabUpNext-trigger"]'
      );
      if (!upNextBtn) return;

      // タブ列へ入れる li ラッパーを作る
      const wrapper = document.createElement("li");
      wrapper.style.cssText =
        "display:flex;align-items:center;margin-left:14px;list-style:none";

      // ネイティブトグル本体を作る
      const label = document.createElement("label");
      label.id = "atvb-native-toggle";
      label.title = "字幕拡張 ON/OFF";
      label.style.cssText = "display:inline-flex;align-items:center;cursor:pointer";
      label.innerHTML = `
        <input type="checkbox" style="display:none">
        <span id="atvb-native-slider" style="
          display:inline-block;width:36px;height:20px;
          background:rgba(255,255,255,0.25);
          border-radius:10px;position:relative;transition:background 0.2s;
        ">
          <span style="
            position:absolute;width:16px;height:16px;border-radius:50%;
            background:#fff;top:2px;
            left:2px;
            transition:left 0.2s;
          "></span>
        </span>
      `;

      // 内部の checkbox を後続処理で使う
      const checkbox = label.querySelector('input[type="checkbox"]');

      // sync に保存された extensionEnabled を初期表示へ反映する
      chrome.storage.sync.get("extensionEnabled", ({ extensionEnabled }) => {
        const isOn = extensionEnabled === true;

        // 見た目更新用に slider と knob を取る
        const sl = label.querySelector("#atvb-native-slider");
        const kn = sl.querySelector("span");

        checkbox.checked = isOn;
        sl.style.background = isOn ? "#00aaff" : "rgba(255,255,255,0.25)";
        kn.style.left = isOn ? "18px" : "2px";
      });

      // ユーザー操作でネイティブトグル状態を保存する
      checkbox.addEventListener("change", () => {
        const on = checkbox.checked;

        // まずトグル見た目をその場で更新する
        const slider = label.querySelector("#atvb-native-slider");
        const knob = slider.querySelector("span");
        slider.style.background = on ? "#00aaff" : "rgba(255,255,255,0.25)";
        knob.style.left = on ? "18px" : "2px";

        // sync の既存設定を読み、extensionEnabled だけ差し替える
        chrome.storage.sync.get(null, (stored) => {
          const next = { ...stored, extensionEnabled: on };

          // 更新後の settings を sync へ保存する
          chrome.storage.sync.set(next, () => {
            // content 側へ設定反映メッセージを送る
            chrome.runtime.sendMessage({
              type: "APPLY_SETTINGS_TO_APPLE_TV",
              reason: "NATIVE_TOGGLE",
              settings: next,
            });
          });
        });
      });

      // 作ったトグルをタブ列へ差し込む
      wrapper.appendChild(label);
      upNextBtn.closest("li").after(wrapper);

      // 注入完了をログへ残す
      if (false) {
        const rect = wrapper.getBoundingClientRect();
        const style = window.getComputedStyle(wrapper);
        logContent("injectNativeToggle: inserted", {
          isConnected: wrapper.isConnected,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          position: style.position,
          zIndex: style.zIndex,
          parentTag: wrapper.parentElement?.tagName || null,
          parentId: wrapper.parentElement?.id || null,
          parentClassName: wrapper.parentElement?.className || null,
        });
      }
    }

    /**
     * 再生タブの出現を監視し、ネイティブトグルを差し込む／再注入する。
     * 初回はタブが既に存在すれば即注入し、その後は MutationObserver で
     * Svelte 等による DOM 再構築後もトグルが消えていれば再注入する。
     *
     * ★ F-2 修正: エピソード移動時に Apple TV+ がタブ DOM を再構築する空白期間に
     *   Observer が空振りするケースに備え、まず即時チェックを行う。
     *
     * @returns {void}
     */
    function watchForPlayerTabs() {
      // ★ Svelte 再マウント対策: 注入後も Observer を継続し、
      //   atvb-native-toggle が消えたタイミングで即再注入する

      // 既存 observer があれば先に止めて積み増しを防ぐ
      state.panelTabsObserver?.disconnect?.();
      state.panelTabsObserver = null;

      // すでにタブがあれば即注入する（初回）
      if (document.querySelector('[data-testid="uts.col.PlayerTabUpNext-trigger"]')) {
        injectNativeToggle();
      }

      // Observer を継続して Svelte による再マウント後も再注入する
      const obs = new MutationObserver(() => {
        const tabExists = !!document.querySelector(
          '[data-testid="uts.col.PlayerTabUpNext-trigger"]'
        );
        const toggleExists = !!document.getElementById("atvb-native-toggle");

        // タブがあってトグルが消えていたら再注入する
        if (tabExists && !toggleExists) {
          injectNativeToggle();
          if (false) {
            logContent?.("watchForPlayerTabs: re-injected after Svelte remount", {});
          }
        }
      });

      obs.observe(document.body, { childList: true, subtree: true });
      state.panelTabsObserver = obs;
    }

    // -----------------------------------------------------------
    // Section: playback mount entry point
    // -----------------------------------------------------------

    /**
     * 再生画面用の panel UI 一式をまとめて mount する。
     *
     * panel build 順序知識を owner 化するための入口関数。
     * `content.js` はこの関数を呼ぶだけでよく、
     * toggle button → right panel → native toggle watch → popup host → debug panel
     * という順序知識は、このファイル内に閉じ込める。
     *
     * @param {object} [options]
     * @param {boolean} [options.panelOpen=false] - mount 後に反映する panel 開閉状態。
     * @returns {void}
     */
    function mountForPlayback({ panelOpen = false } = {}) {
      ensurePanelSlotLayerStyle();
      createToggleButton();
      createRightPanel();
      watchForPlayerTabs();

      if (typeof mountPopupHost === "function") {
        mountPopupHost();
      }

      if (typeof mountDebugPanel === "function") {
        mountDebugPanel();
      }

      applyPanelVisibility(panelOpen);
    }

    // -----------------------------------------------------------
    // Section: public API
    // -----------------------------------------------------------

    /**
     * toggle-only 起動用の公開 API。
     * 再生画面に native toggle だけを注入し、Svelte 再マウント対策の
     * observer を張る（内部で `watchForPlayerTabs()` を呼ぶ）。
     * panel host / popup host / debug host はここでは mount しない。
     *
     * @returns {void}
     */
    function mountToggleOnlyUi() {
      watchForPlayerTabs();
    }

    // 公開する panel-ui API
    return {
      dispose,
      mountForPlayback,
      setPanelOpen,
      applyPanelState,
      mountToggleOnlyUi,
    };
  }

  // グローバルへ登録する
  const root = (window.ATVB = window.ATVB || {});
  root.panelUi = root.panelUi || {};
  root.panelUi.createPanelUi = createPanelUi;
})();


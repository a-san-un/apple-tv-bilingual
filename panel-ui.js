// =============================================================
// Apple TV Bilingual Subtitles - panel-ui.js
// 役割:
// - 右側字幕パネルの UI ホストを作る
// - 字幕パネル開閉ボタンを作る
// - ネイティブトグルを再生画面へ差し込む
// - パネル表示とボタン見た目を分けて扱う
// =============================================================

(function () {
  "use strict";

  // panel-ui の公開 API 一式を組み立てる
  function createPanelUi(deps) {
    const {
      state,
      getTarget,
      getLiveDebugLogFilter,
      getDebugLogText,
      clearDebugLogs,
      sendToBackground,
      applyLayout,
      logContent,
      renderCurrentSnapshot,
      renderPanel,
      rebuildSubtitleBlocksForPanelOpen,
      destroyOverlay,
    } = deps;

    const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";

    // パネル配置用の style 要素を 1 回だけ入れる
    function ensurePanelSlotLayerStyle() {
      if (document.getElementById(PANEL_SLOT_LAYER_STYLE_ID)) return;

      // panel host 用の style タグを head に追加する
      const style = document.createElement("style");
      style.id = PANEL_SLOT_LAYER_STYLE_ID;
      style.textContent = ``;
      document.head.appendChild(style);
    }

    // デバッグ領域の HTML を返す
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

    // パネル本体の HTML を返す
    function buildPanelShellHTML() {
      // ShadowRoot 内で panel.css を読むための URL を解決する
      const panelCssUrl = chrome.runtime.getURL("panel.css");

      return `
        <link rel="stylesheet" href="${panelCssUrl}">
        <div id="panel" class="dual-subtitles-panel" data-dual-subtitles-panel>
          <div id="panel-header">
            <span>📋 字幕履歴</span>
            <div class="panel-header-actions">
              <button id="settings-btn" type="button" title="設定">⚙️</button>
            </div>
          </div>
          ${buildPanelDebugShellHTML()}
          <div id="panel-scroll">
            <div id="subtitle-list"></div>
          </div>
        </div>
      `;
    }

    // ヘッダーの設定ボタンにイベントを付ける
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

    // 右側字幕パネルの host を作る
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

    // debug panel を初回だけ mount する
    function createDebugPanel() {
      if (!state.panelShadowRoot) return;

      // debug panel の mount 先を panel shadow root に合わせる
      state.debugPanelRoot = state.panelShadowRoot;

      // debug panel モジュール本体を取る
      const debugPanel = window.ATVB?.debugPanel;
      if (!debugPanel?.mount) return;

      // 必要な getter / action を渡して mount する
      debugPanel.mount(state.debugPanelRoot, {
        getFilter: getLiveDebugLogFilter,
        getLogText: getDebugLogText,
        clearLogs: clearDebugLogs,
        downloadLogs: (text, done) => {
          // ダウンロード処理は background に委譲する
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

    // 主要 UI 要素をまとめて返す
    function getPanelUiElements() {
      // target 配下の UI 要素を一か所で集める
      const target = getTarget();

      return {
        panelHost: target.querySelector("#atv-panel-host"),
        overlayHost: target.querySelector("#atv-overlay-host"),
        toggleBtn: target.querySelector("#atv-toggle-btn"),
      };
    }

    // 指定 id の UI host を消す
    function removeHost(id) {
      // panel host / toggle button ともに target 配下を見る
      const root = getTarget();
      const el = root.querySelector(`#${id}`);
      if (el) el.remove();
    }

    // パネル系 UI をまとめて破棄する
    function destroyFeatureUiHosts() {
      // debug panel があれば先に unmount する
      window.ATVB?.debugPanel?.unmount?.();

      // 再生画面に影響する UI host を個別に消す
      removeHost("atv-panel-host");
      removeHost("atv-popup-host");
      removeHost("atv-toggle-btn");

      // ★ F-2 fix: closest("li") が null のときも要素単体で確実に除去する
      const nativeToggleEl = document.getElementById("atvb-native-toggle");
      if (nativeToggleEl) {
        const liWrapper = nativeToggleEl.closest("li");
        if (liWrapper) {
          liWrapper.remove();          // wrapper の <li> ごと消す（通常ケース）
        } else {
          nativeToggleEl.remove();     // li が見つからなければ要素単体で消す（フォールバック）
        }
      }

      // overlay も破棄する
      destroyOverlay?.();

      // 参照していた root を null に戻す
      state.panelShadowRoot = null;
      state.popupShadowRoot = null;
      state.debugPanelRoot = null;
    }

    // restart 用に UI host をまとめて破棄する
    function destroyUiHosts() {
      logContent?.("字幕パネル開閉ボタン/右側字幕パネル destroyUiHosts start", {
        hasSubtitlePanelToggleButton: Boolean(getTarget?.().querySelector("#atv-toggle-btn")),
        hasPanelHost: Boolean(getTarget?.().querySelector("#atv-panel-host")),
        panelOpen: state.panelOpen,
      });

      destroyFeatureUiHosts();

      logContent?.("字幕パネル開閉ボタン/右側字幕パネル destroyUiHosts done", {
        hasSubtitlePanelToggleButton: Boolean(getTarget?.().querySelector("#atv-toggle-btn")),
        hasPanelHost: Boolean(getTarget?.().querySelector("#atv-panel-host")),
        panelOpen: state.panelOpen,
      });
    }

    // 右側字幕パネルと overlay の表示だけを切り替える
    function applyPanelVisibility(show) {
      logContent?.("右側字幕パネル applyPanelVisibility start", {
        requestedOpen: show,
        panelOpen: state.panelOpen,
        hasSubtitlePanelToggleButton: Boolean(getTarget?.().querySelector("#atv-toggle-btn")),
      });

      // 表示対象の UI 要素を取る
      const { panelHost, overlayHost } = getPanelUiElements();

      // 右側字幕パネルの表示/非表示を切り替える
      if (panelHost) panelHost.style.display = show ? "" : "none";

      // overlay は幅だけをパネル開閉に合わせる（display は触らない → F-1 対策）
      if (overlayHost) {
        overlayHost.style.width = show ? "70%" : "100%";
      }

      // ボタンは消さず、見た目だけ開閉状態に合わせる
      updateToggleButton(show);

      logContent?.("右側字幕パネル applyPanelVisibility done", {
        requestedOpen: show,
        panelOpen: state.panelOpen,
        hasPanelHost: Boolean(panelHost),
        hasOverlayHost: Boolean(overlayHost),
        panelHostDisplay: panelHost?.style?.display ?? null,
        overlayHostDisplay: overlayHost?.style?.display ?? null,
        overlayWidth: overlayHost?.style?.width ?? null,
      });
    }

    // ランタイム状態を切り替えて保存する
    function togglePanel(force) {
      // force があればそれを使い、なければ現在値を反転する
      if (typeof force === "boolean") state.panelOpen = force;
      else state.panelOpen = !state.panelOpen;

      // レイアウトとパネル表示を新しい状態へ合わせる
      applyLayout?.();
      applyPanelVisibility(state.panelOpen);

      // ランタイム状態を local へ保存する
      globalThis.ATVB_PANEL_VISIBILITY?.persist(state.panelOpen);
    }

    // パネル状態全体を適用する（open 判定 → 表示制御 → 再描画）
    function applyPanelState(reason) {
      logContent?.("右側字幕パネル applyPanelState start", {
        reason,
        panelOpen: state.panelOpen,
        hasPanelHost: Boolean(getTarget?.().querySelector("#atv-panel-host")),
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
      });

      // 表示切り替えを先に行う
      applyPanelVisibility(state.panelOpen);

      // パネルが開いているときだけ字幕ブロックを再構築する
      if (typeof rebuildSubtitleBlocksForPanelOpen === "function") {
        rebuildSubtitleBlocksForPanelOpen(reason);
      }

      // 現在字幕の snapshot を描画する
      if (typeof renderCurrentSnapshot === "function") {
        renderCurrentSnapshot();
      }

      // 履歴パネル全体を再描画する
      if (typeof renderPanel === "function") {
        renderPanel();
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

    // 字幕パネル開閉ボタンを作る
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
      window.addEventListener(
        "resize",
        () => {
          if (state.panelOpen) updateToggleButton(true);
        },
        { passive: true }
      );
    }

    // ボタンの矢印と位置だけを更新する
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

    // panelOpen の初期値を local から読む
    function loadPanelVisibility() {
      // sync 設定の panelDefaultOpen は「初期値」としてだけ使う
      const panelDefaultOpenSetting = state.contentSettings?.panelDefaultOpen !== false;

      // local にランタイム保存値があればそちらを優先して読む
      return globalThis.ATVB_PANEL_VISIBILITY.load(panelDefaultOpenSetting);
    }

    // 再生画面のネイティブタブ横へ ON/OFF トグルを差し込む
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
      {
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

    // 再生タブ出現を監視してネイティブトグルを差し込む
    // ★ F-2 修正: エピソード移動時に Apple TV+ がタブ DOM を再構築する空白期間に
    //   Observer が空振りするケースに備え、フォールバックタイマーを追加する
    function watchForPlayerTabs() {
      // ★ Svelte 再マウント対策: 注入後も Observer を継続し、
      //   atvb-native-toggle が消えたタイミングで即再注入する

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
          logContent?.("watchForPlayerTabs: re-injected after Svelte remount", {});
        }
      });

      obs.observe(document.body, { childList: true, subtree: true });
    }

    // 公開する panel-ui API
    return {
      createRightPanel,
      createDebugPanel,
      createToggleButton,
      togglePanel,
      applyPanelVisibility,
      applyPanelState,
      destroyUiHosts,
      getPanelUiElements,
      updateToggleButton,
      loadPanelVisibility,
      watchForPlayerTabs,
      injectNativeToggle,
    };
  }

  // グローバルへ登録する
  globalThis.ATVB = globalThis.ATVB || {};
  globalThis.ATVB.panelUi = globalThis.ATVB.panelUi || {};
  globalThis.ATVB.panelUi.createPanelUi = createPanelUi;
})();

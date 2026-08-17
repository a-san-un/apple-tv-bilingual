// =============================================================
// Apple TV+ Bilingual Subtitles - overlay-controller.js
// version: 1.3.1
// 役割: overlay subtitle DOM の生成・表示更新・破棄を担当する。
// panel と同じ current block / same text を overlay に反映し、
// クリック可能な単語 span を使って popup も出せるようにする。
// =============================================================

(() => {
  try {
    const root = (window.ATVB = window.ATVB || {});

    // null / undefined を空文字へ寄せ、比較と描画を安定させる。
    function normalizeText(text) {
      return String(text || "").trim();
    }

    // 生テキストを overlay 用 HTML に変換する。
    // makeClickableSpans が無い間も最低限テキスト表示は維持する。
    function renderClickableHtml(text, sentence, makeClickableSpans) {
      const safeText = normalizeText(text);
      const safeSentence = normalizeText(sentence);

      if (!safeText) return "";
      if (typeof makeClickableSpans !== "function") {
        return safeText;
      }

      return makeClickableSpans(safeText, safeSentence || safeText);
    }

      function createOverlayController({
        getOverlayRoot,
        setOverlayRoot,
        getPanelOpen,
        getTarget,
        makeClickableSpans,
        showPopup,
        getPlaybackControlsLayoutTargets: _getPlaybackControlsLayoutTargets,
        PLAYBACK_CONTROLS_LAYOUT: _PLAYBACK_CONTROLS_LAYOUT,
      } = {}) {

      // content 切替時の残留テキストを防ぐため、簡単な前回 state を保持する。
      function ensureOverlayState() {
        if (!root.overlayState || typeof root.overlayState !== "object") {
          root.overlayState = {
            lastPrimary: "",
            lastSecondary: "",
            lastContentKey: "",
          };
        }
        return root.overlayState;
      }

      let playerResizeObserver = null;
      let layoutTrackingStarted = false;
      let boundWindowResizeHandler = null;
      let boundFullscreenChangeHandler = null;
      let boundTransitionEndHandler = null;   // ← 追加

      // state accessor を優先しつつ、DOM fallback でも root を拾えるようにする。
      function resolveOverlayRoot() {
        return (
          (typeof getOverlayRoot === "function" ? getOverlayRoot() : null) ||
          document.querySelector("#atv-overlay-host") ||
          document.querySelector(".atvb-overlay") ||
          null
        );
      }

      // overlay root 配下の primary / secondary 要素をまとめて取得する。
      function resolveOverlayElements() {
        const container = resolveOverlayRoot();

        if (!container) {
          return {
            container: null,
            primaryEl: null,
            secondaryEl: null,
          };
        }

        return {
          container,
          primaryEl:
            container.querySelector("[data-atvb-overlay-primary]") ||
            container.querySelector(".atvb-overlay__primary") ||
            null,
          secondaryEl:
            container.querySelector("[data-atvb-overlay-secondary]") ||
            container.querySelector(".atvb-overlay__secondary") ||
            null,
        };
      }

      // overlay 内の .atv-word に hover / click を結び、popup 表示へつなぐ。
      // innerHTML 再描画後に毎回呼び直して、現在の span 群へ bind し直す。
      function bindOverlayWordInteractions(scopeEl) {
        if (!scopeEl || typeof showPopup !== "function") return;

        scopeEl.querySelectorAll(".atv-word").forEach((span) => {
          span.addEventListener("mouseenter", () => {
            span.style.background = "rgba(255,220,80,0.3)";
          });

          span.addEventListener("mouseleave", () => {
            span.style.background = "";
          });

          span.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();

            const word = String(span.dataset.word || "").trim();
            const sentence = decodeURIComponent(span.dataset.sentence || "");
            if (!word) return;

            showPopup(word, sentence, span.getBoundingClientRect(), {
              source: "overlay",
            });
          });
        });
      }

      // Apple TV+ 再生領域の基準要素を探す。
      // 既知 selector を優先し、最後は video 要素へ fallback する。
      function findPlayerContainer() {
        return (
          document.querySelector("#main-video-container") ||
          document.querySelector(".video-player__video-container") ||
          document.querySelector(".video-player__content") ||
          document.querySelector(".video-player") ||
          document.querySelector("video") ||
          null
        );
      }

      // プレイヤー矩形に応じて overlay 文字サイズを決める。
      function computeOverlayTypography(rect) {
        const height = Number(rect?.height || 0);
        const width = Number(rect?.width || 0);
        const basis = Math.min(height, width || height);

        const primarySize = Math.max(18, Math.min(38, basis * 0.032));
        const secondarySize = Math.max(16, Math.min(32, basis * 0.027));

        return {
          primarySize,
          secondarySize,
          primaryLineHeight: 1.25,
          secondaryLineHeight: 1.3,
        };
      }

      // 計算した typography を primary / secondary 要素へ反映する。
      function applyOverlayTypography(rect) {
        const { primaryEl, secondaryEl } = resolveOverlayElements();
        if (!primaryEl && !secondaryEl) return;

        const typography = rect
          ? computeOverlayTypography(rect)
          : {
              primarySize: 28,
              secondarySize: 24,
              primaryLineHeight: 1.25,
              secondaryLineHeight: 1.3,
            };

        if (primaryEl) {
          primaryEl.style.fontSize = `${typography.primarySize}px`;
          primaryEl.style.lineHeight = String(typography.primaryLineHeight);
        }

        if (secondaryEl) {
          secondaryEl.style.fontSize = `${typography.secondarySize}px`;
          secondaryEl.style.lineHeight = String(typography.secondaryLineHeight);
        }
      }

      // overlay host を再生領域に追従させる。
      // 位置と幅だけをここで決め、文言更新とは分離しておく。
      function syncOverlayPositionToPlayer() {
        const container = resolveOverlayRoot();
        if (!container) return;

        const player = findPlayerContainer();
        const rect = player?.getBoundingClientRect?.();

        container.style.position = "fixed";
        container.style.zIndex = "2147483647";
        container.style.pointerEvents = "auto";
        container.style.margin = "0";
        container.style.padding = "0";
        container.style.display = container.hidden ? "none" : "block";

        if (rect && rect.width > 0 && rect.height > 0) {
          // panelOpen フラグではなく実際の DOM 矩形で判定する。
          // Apple TV+ がプレイヤーをすでに縮小済みの場合は panelOverlap が 0 になり
          // 2重計上を防ぐ。まだ transition 途中で縮小されていない場合は正しく引く。
          const panelEl = document.querySelector("#atv-panel-host");
          const panelRect = panelEl?.getBoundingClientRect?.();
          const playerRight = rect.left + rect.width;
          const panelLeft = (panelRect && panelRect.width > 0) ? panelRect.left : playerRight;
          const panelOverlap = Math.max(0, playerRight - panelLeft);

          const visibleWidth = Math.max(0, rect.width - panelOverlap);
          const centerX = rect.left + visibleWidth / 2;
          const subtitleY = rect.bottom - rect.height * 0.14;
          const overlayWidth = Math.min(visibleWidth * 0.72, 960);

          container.style.left = `${centerX}px`;
          container.style.top = `${subtitleY}px`;
          container.style.bottom = "auto";
          container.style.right = "auto";
          container.style.transform = "translate(-50%, -100%)";
          container.style.width = `${overlayWidth}px`;
          container.style.maxWidth = "90vw";
          container.style.textAlign = "center";

          applyOverlayTypography(rect);
        } else {
          container.style.left = "50%";
          container.style.top = "auto";
          container.style.bottom = "12%";
          container.style.right = "auto";
          container.style.transform = "translateX(-50%)";
          container.style.width = "72vw";
          container.style.maxWidth = "960px";
          container.style.textAlign = "center";

          applyOverlayTypography(null);
        }
      }

      // resize / fullscreen 変化に追従し、overlay の位置ずれを防ぐ。
      function startOverlayLayoutTracking() {
        if (layoutTrackingStarted) return;
        layoutTrackingStarted = true;

        // resize / fullscreen 時も最新の panelOpen を取得して渡す。
        // getPanelOpen が無い場合は引数なしにフォールバックする。
        const rerender = () => {
          const panelOpen =
            typeof getPanelOpen === "function" ? Boolean(getPanelOpen()) : undefined;
          syncOverlayPositionToPlayer(
            panelOpen !== undefined ? { panelOpen } : {}
          );
        };

        const player = findPlayerContainer();
        if (player && typeof ResizeObserver === "function") {
          playerResizeObserver = new ResizeObserver(() => {
            rerender();
          });
          playerResizeObserver.observe(player);
        }

        boundWindowResizeHandler = rerender;
        boundFullscreenChangeHandler = rerender;

        window.addEventListener("resize", boundWindowResizeHandler, {
          passive: true,
        });
        document.addEventListener(
          "fullscreenchange",
          boundFullscreenChangeHandler,
          { passive: true },
        );

        // パネル開閉アニメーション完了後に再計算する。
        // ResizeObserver だけでは transition 途中の中間値で止まることがあるため。
        if (player) {
          boundTransitionEndHandler = (e) => {
            if (e.propertyName === "width" || e.propertyName === "transform") {
              rerender();
            }
          };
          player.addEventListener("transitionend", boundTransitionEndHandler, {
            passive: true,
          });
        }
      }

      // observer / listener を解除し、再初期化時の重複監視を防ぐ。
      function stopOverlayLayoutTracking() {
        if (playerResizeObserver) {
          playerResizeObserver.disconnect();
          playerResizeObserver = null;
        }

        if (boundWindowResizeHandler) {
          window.removeEventListener("resize", boundWindowResizeHandler);
          boundWindowResizeHandler = null;
        }

        if (boundFullscreenChangeHandler) {
          document.removeEventListener(
            "fullscreenchange",
            boundFullscreenChangeHandler,
          );
          boundFullscreenChangeHandler = null;
        }

        // transitionend リスナーも確実に解除する。
        if (boundTransitionEndHandler) {
          const player = findPlayerContainer();
          if (player) {
            player.removeEventListener("transitionend", boundTransitionEndHandler);
          }
          boundTransitionEndHandler = null;
        }

        layoutTrackingStarted = false;
      }

      // overlay root が無ければ作成し、あれば再利用する。
      function createOverlay() {
        const existing = resolveOverlayRoot();
        if (existing) {
          if (typeof setOverlayRoot === "function") {
            setOverlayRoot(existing);
          }
          syncOverlayPositionToPlayer();
          startOverlayLayoutTracking();
          return existing;
        }

        const target = typeof getTarget === "function" ? getTarget() : null;
        if (!target) return null;

        const host = document.createElement("div");
        host.id = "atv-overlay-host";
        host.className = "atvb-overlay";
        host.hidden = true;
        host.setAttribute("aria-hidden", "true");

        host.innerHTML = `
          <div
            class="atvb-overlay__inner"
            data-atvb-overlay-root
            style="
              display:flex;
              flex-direction:column;
              align-items:center;
              justify-content:center;
              gap:6px;
              width:100%;
              pointer-events:auto;
            "
          >
            <div
              class="atvb-overlay__primary"
              data-atvb-overlay-primary
              style="
                color:#ffffff;
                font-size:28px;
                line-height:1.25;
                font-weight:600;
                text-align:center;
                text-shadow:
                  0 2px 8px rgba(0, 0, 0, 0.95),
                  0 0 2px rgba(0, 0, 0, 1);
                white-space:pre-wrap;
                word-break:break-word;
              "
            ></div>
            <div
              class="atvb-overlay__secondary"
              data-atvb-overlay-secondary
              style="
                color:#f2f2f2;
                font-size:24px;
                line-height:1.3;
                font-weight:500;
                text-align:center;
                text-shadow:
                  0 2px 8px rgba(0, 0, 0, 0.95),
                  0 0 2px rgba(0, 0, 0, 1);
                white-space:pre-wrap;
                word-break:break-word;
              "
            ></div>
          </div>
        `;

        target.appendChild(host);

        if (typeof setOverlayRoot === "function") {
          setOverlayRoot(host);
        }

        syncOverlayPositionToPlayer();
        startOverlayLayoutTracking();

        return host;
      }

      // hidden / aria-hidden / display を揃えて可視状態を切り替える。
      function setOverlayVisible(visible) {
        const container = resolveOverlayRoot();
        if (!container) return;

        const isVisible = visible === true;
        container.hidden = !isVisible;
        container.setAttribute("aria-hidden", isVisible ? "false" : "true");
        container.style.display = isVisible ? "block" : "none";
      }

      // view model をそのまま描画し、必要なら単語 click bind も張り直す。
      function applyOverlayView(view, options = {}) {
        const state = ensureOverlayState();
        const container = createOverlay();
        const { primaryEl, secondaryEl } = resolveOverlayElements();
        const contentKey = String(options?.contentKey || "");

        const primaryText = normalizeText(view?.primary);
        const secondaryText = normalizeText(view?.secondary);
        const isVisible = Boolean(view?.isVisible && (primaryText || secondaryText));

        if (
          state.lastContentKey &&
          contentKey &&
          state.lastContentKey !== contentKey
        ) {
          state.lastPrimary = "";
          state.lastSecondary = "";
        }

        if (contentKey) {
          state.lastContentKey = contentKey;
        }

        console.debug("[ATVB] overlay render debug", { // eslint-disable-line no-console
          contentKey,
          isVisible,
          subtitleViewPrimary: primaryText,
          subtitleViewSecondary: secondaryText,
          currentBlock: view?.currentBlock
            ? {
                key: view.currentBlock.key || "",
                startTime: Number(view.currentBlock.startTime ?? 0),
                endTime: Number(view.currentBlock.endTime ?? 0),
                state: view.currentBlock.state || "",
              }
            : null,
        });

        if (!container) return;

        if (primaryEl) {
          primaryEl.innerHTML = renderClickableHtml(
            primaryText,
            primaryText,
            makeClickableSpans,
          );
          bindOverlayWordInteractions(primaryEl);
        }

        if (secondaryEl) {
          secondaryEl.innerHTML = renderClickableHtml(
            secondaryText,
            primaryText,
            makeClickableSpans,
          );
          bindOverlayWordInteractions(secondaryEl);
        }

        setOverlayVisible(isVisible);
        syncOverlayPositionToPlayer();

        state.lastPrimary = primaryText;
        state.lastSecondary = secondaryText;
      }

      // 旧 API 互換: 生テキストから overlay を更新する。
      function updateOverlay(primaryText = "", secondaryText = "", options = {}) {
        return applyOverlayView(
          {
            primary: normalizeText(primaryText),
            secondary: normalizeText(secondaryText),
            isVisible: Boolean(
              normalizeText(primaryText) || normalizeText(secondaryText),
            ),
            currentBlock: null,
          },
          options,
        );
      }

      // 旧 API 互換: resolver view をそのまま overlay へ流す。
      function updateOverlayFromView(view, options = {}) {
        return applyOverlayView(view, options);
      }

      // 旧 API 互換: block から overlay view を組み立てて反映する。
      function updateOverlayFromBlock(block, options = {}) {
        const primaryText = normalizeText(block?.primaryText);
        const secondaryText = normalizeText(block?.secondaryText);

        return applyOverlayView(
          {
            primary: primaryText,
            secondary: secondaryText,
            isVisible: Boolean(primaryText || secondaryText),
            currentBlock: block || null,
          },
          options,
        );
      }

      // content 切替時は text と visible state を明示的に消しておく。
      function clearOverlayState() {
        root.overlayState = {
          lastPrimary: "",
          lastSecondary: "",
          lastContentKey: "",
        };

        const { container, primaryEl, secondaryEl } = resolveOverlayElements();
        if (primaryEl) primaryEl.textContent = "";
        if (secondaryEl) secondaryEl.textContent = "";
        if (container) {
          container.hidden = true;
          container.setAttribute("aria-hidden", "true");
          container.style.display = "none";
        }

        console.debug("[ATVB] overlay state cleared"); // eslint-disable-line no-console
      }

      // overlay DOM と layout tracking をまとめて破棄する。
      function destroyOverlay() {
        stopOverlayLayoutTracking();

        const container = resolveOverlayRoot();
        if (container?.parentNode) {
          container.parentNode.removeChild(container);
        }

        if (typeof setOverlayRoot === "function") {
          setOverlayRoot(null);
        }
      }

      return {
        createOverlay,
        setOverlayVisible,
        applyOverlayView,
        updateOverlay,
        updateOverlayFromView,
        updateOverlayFromBlock,
        clearOverlayState,
        destroyOverlay,
        syncOverlayPositionToPlayer,
        startOverlayLayoutTracking,
        stopOverlayLayoutTracking,
      };
    }

    root.overlayController = {
      ...(root.overlayController || {}),
      createOverlayController,
    };
  } catch (error) {
    console.error("[ATVB] overlay-controller: failed", error); // eslint-disable-line no-console
  }
})();

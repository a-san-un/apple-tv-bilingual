// =============================================================
// Apple TV+ Bilingual Subtitles - panel-renderer.js
// 役割:
// - 右字幕パネルの list 描画責務を担当する。
// - panel 用 block の truth / same-window grouping / current 派生を
//   resolver へ委譲し、renderer は描画と interaction に集中する。
// - subtitleView / currentSubtitleBlock を使って current 行の表示テキストを補強する。
// - panel 内の word popup / seek click / auto scroll を担当する。
// - DOM / listener の生成は panel 内部に閉じ、content.js へ詳細を持ち込まない。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * 右字幕パネル描画を担う renderer factory を生成する。
   * panel の current 判定や same-window grouping は resolver 側の正本を利用し、
   * renderer は displayBlocks をそのまま DOM へ反映する責務に寄せる。
   *
   * @param {{
   *   resolvePanelBlocksForRender?: Function,
   *   state: Object,
   *   makeClickableSpans: Function,
   *   formatTime: Function,
   *   showPopup: Function,
   *   findCueAt: Function,
   *   logContent?: Function,
   * }} deps
   */
  function createPanelRenderer(deps = {}) {
    const {
      resolvePanelBlocksForRender,
      state,
      makeClickableSpans,
      formatTime,
      showPopup,
      findCueAt,
      logContent,
    } = deps;

    // -------------------------------------------------------
    // subtitleView / block text 正規化
    // -------------------------------------------------------

    /**
     * subtitleView から primary / secondary テキストを安定して取り出す。
     * 新 schema を優先しつつ、旧 mainLines / subLines にも後方互換を残す。
     *
     * @param {Object|null} subtitleView
     * @returns {{ primary: string, secondary: string }}
     */
    function getSubtitleViewTexts(subtitleView) {
      const primary = String(
        subtitleView?.primary ||
          (Array.isArray(subtitleView?.mainLines)
            ? subtitleView.mainLines.join("\n")
            : "") ||
          "",
      ).trim();

      const secondary = String(
        subtitleView?.secondary ||
          (Array.isArray(subtitleView?.subLines)
            ? subtitleView.subLines.join("\n")
            : "") ||
          "",
      ).trim();

      return {
        primary,
        secondary,
      };
    }

    /**
     * panel block から primary / secondary テキストを安全に取り出す。
     * renderer が旧 field 名と新 field 名の差分を吸収する。
     *
     * @param {Object|null} block
     * @returns {{ primary: string, secondary: string }}
     */
    function getBlockTexts(block) {
      return {
        primary: String(block?.primaryText || block?.primary || "").trim(),
        secondary: String(block?.secondaryText || block?.secondary || "").trim(),
      };
    }

    // -------------------------------------------------------
    // HTML 生成
    // -------------------------------------------------------

    /**
     * panel block 1 件分の HTML を生成する。
     * current / emphasized などの表示状態は resolver の返り値をそのまま使う。
     *
     * @param {Object} block
     * @returns {string}
     */
    function buildPanelBlockHtml(block) {
      const isWindowCurrent = block.isWindowCurrent === true;
      const isSequentialCurrent =
        block.isSequentialCurrent ?? block.state === "current";
      const isPanelEmphasized =
        block.isPanelEmphasized ?? block.state === "current";

      const cls = "subtitle-block";
      const mid = isSequentialCurrent ? 'id="current-block"' : "";
      const mark = isPanelEmphasized
        ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>`
        : "";

      const { primary, secondary } = getBlockTexts(block);
      const pText = makeClickableSpans(primary, primary);
      const sText = makeClickableSpans(secondary, primary);
      const seekTime =
        Array.isArray(block.cues) && block.cues[0]
          ? Number(block.cues[0].startTime ?? block.startTime)
          : Number(block.startTime ?? 0);

      return `
        <div
          class="${cls}"
          ${mid}
          data-time="${block.startTime}"
          data-seek-time="${seekTime}"
          data-window-current="${isWindowCurrent ? "true" : "false"}"
          data-sequential-current="${isSequentialCurrent ? "true" : "false"}"
          data-panel-emphasized="${isPanelEmphasized ? "true" : "false"}"
        >
          <div class="subtitle-row">
            <div class="subtitle-mark">${mark}</div>
            <div class="subtitle-content">
              <div class="subtitle-time">${formatTime(block.startTime)}</div>
              <div class="subtitle-primary">${pText}</div>
              ${sText ? `<div class="subtitle-secondary">${sText}</div>` : ""}
            </div>
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------
    // interaction
    // -------------------------------------------------------

    /**
     * panel 内の単語 span へ hover / click interaction を結びつける。
     * click 時は popup を表示し、block click 側へイベントを流さない。
     *
     * @param {HTMLElement} blockEl
     */
    function bindPanelWordInteractions(blockEl) {
      blockEl.querySelectorAll(".atv-word").forEach((span) => {
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
            source: "panel",
          });
        });
      });
    }

    /**
     * panel list 配下の block へ click interaction を結びつける。
     * 単語 click は popup 優先のため seek 対象から除外する。
     *
     * @param {HTMLElement} list
     */
    function bindPanelBlockInteractions(list) {
      list.querySelectorAll(".subtitle-block").forEach((blockEl) => {
        bindPanelWordInteractions(blockEl);

        blockEl.addEventListener("click", (e) => {
          if (e.target.classList.contains("atv-word")) return;

          e.stopPropagation();
          e.preventDefault();

          const t = parseFloat(
            blockEl.dataset.seekTime || blockEl.dataset.time,
          );

          if (state.video && !Number.isNaN(t)) {
            state.video.currentTime = t;
            setTimeout(() => renderPanel(), 100);
          }
        });
      });
    }

    // -------------------------------------------------------
    // snapshot / observation
    // -------------------------------------------------------

    /**
     * 最後に panel へ描画した current block snapshot を state へ保存する。
     * panel / overlay / subtitleView のズレ確認時の観測点として使う。
     *
     * @param {{
     *   currentBlock: Object|null,
     *   displayBlocks: Object[],
     *   curPrimaryCue: Object|null,
     *   subtitleView: Object|null,
     * }} params
     */
    function updatePanelRenderSnapshot({
      currentBlock,
      displayBlocks,
      curPrimaryCue,
      subtitleView,
    }) {
      const renderedCurrentBlock =
        currentBlock ||
        subtitleView?.currentBlock ||
        (Array.isArray(displayBlocks)
          ? displayBlocks.find((block) => block.state === "current") || null
          : null);

      const stateCurrentBlock = state.currentSubtitleBlock || null;
      const { primary: uiPrimaryText, secondary: uiSecondaryText } =
        getSubtitleViewTexts(subtitleView);

      const currentSubtitleBlock = stateCurrentBlock
        ? {
            ...stateCurrentBlock,
            primaryText: uiPrimaryText || stateCurrentBlock.primaryText || "",
            secondaryText:
              uiSecondaryText || stateCurrentBlock.secondaryText || "",
          }
        : renderedCurrentBlock
          ? {
              ...renderedCurrentBlock,
              primaryText:
                uiPrimaryText ||
                renderedCurrentBlock.primaryText ||
                renderedCurrentBlock.primary ||
                "",
              secondaryText:
                uiSecondaryText ||
                renderedCurrentBlock.secondaryText ||
                renderedCurrentBlock.secondary ||
                "",
            }
          : uiPrimaryText || uiSecondaryText
            ? {
                primaryText: uiPrimaryText,
                secondaryText: uiSecondaryText,
              }
            : null;

      state.lastPanelRenderSnapshot = {
        allBlocksCount: Array.isArray(displayBlocks) ? displayBlocks.length : 0,
        currentSubtitleBlock,
      };

      if (curPrimaryCue && currentSubtitleBlock?.primaryText) {
        state.lastPrimarySnapshotAt = Date.now();
      }
    }

    // -------------------------------------------------------
    // auto scroll
    // -------------------------------------------------------

    /**
     * 同一 current block に対して連続スクロールしないための直近 key。
     * renderPanel() の多重呼び出しでもガクつきを抑える。
     *
     * @type {string|null}
     */
    let lastScrolledCurrentKey = null;

    /**
     * current block が可視領域の上下余白を割り込んだときだけ自動スクロールする。
     * 常時中央追従ではなく、1 ブロック分の余白を保つことで視線移動を抑える。
     */
    function scrollCurrentPanelBlockIntoView() {
      const shadowRoot = state.panelShadowRoot;
      if (!shadowRoot) return;

      const scroller = shadowRoot.getElementById("panel-scroll");
      const current = shadowRoot.getElementById("current-block");
      if (!scroller || !current) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();

      const currentTop =
        currentRect.top - scrollerRect.top + scroller.scrollTop;
      const currentBottom = currentTop + currentRect.height;

      // 1 ブロック分の余白を上下に確保する。
      const margin = currentRect.height || 56;

      const viewTop = scroller.scrollTop + margin;
      const viewBottom = scroller.scrollTop + scroller.clientHeight - margin;

      const maxScrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight,
      );

      const currentKey =
        current.getAttribute("data-seek-time") ||
        current.getAttribute("data-time") ||
        "";

      const isSameAsLastScrolled =
        Boolean(currentKey) && currentKey === lastScrolledCurrentKey;

      // 上余白を割り込んだ場合は現在行を余白位置まで戻す。
      if (currentTop < viewTop) {
        const target = Math.max(
          0,
          Math.min(maxScrollTop, currentTop - margin),
        );

        scroller.scrollTo({
          top: target,
          behavior: isSameAsLastScrolled ? "auto" : "smooth",
        });

        lastScrolledCurrentKey = currentKey;
        return;
      }

      // 下余白を割り込んだ場合のみスクロールし、同一 current では再発火させない。
      if (currentBottom > viewBottom && !isSameAsLastScrolled) {
        const target = Math.max(
          0,
          Math.min(maxScrollTop, currentTop - margin),
        );

        scroller.scrollTo({
          top: target,
          behavior: "smooth",
        });

        lastScrolledCurrentKey = currentKey;
      }
    }

    // -------------------------------------------------------
    // resolver adapter
    // -------------------------------------------------------

    /**
     * state.subtitleBlocks を panel renderer 用の displayBlocks へ解決する。
     * current 判定・same-window grouping・panel 強調フラグは resolver の正本を使う。
     *
     * @param {number} currentTime
     * @param {Object|null} subtitleView
     * @returns {{
     *   blocks: Object[],
     *   displayBlocks: Object[],
     *   currentBlocks: Object[],
     *   usedCurrentFallback: boolean,
     *   sameWindowGroups: Map<any, any>,
     * }}
     */
    function getAllPanelBlocks(currentTime, subtitleView = null) {
      const subtitleBlocksState = state.subtitleBlocks;
      const sourceBlocks = Array.isArray(subtitleBlocksState)
        ? subtitleBlocksState.slice()
        : Array.isArray(subtitleBlocksState?.blocks)
          ? subtitleBlocksState.blocks.slice()
          : [];

      const currentSubtitleBlock =
        subtitleView?.currentBlock ||
        state.currentSubtitleBlock ||
        null;

      if (typeof resolvePanelBlocksForRender !== "function") {
        return {
          blocks: sourceBlocks,
          displayBlocks: sourceBlocks,
          currentBlocks: [],
          usedCurrentFallback: false,
          sameWindowGroups: new Map(),
        };
      }

      return resolvePanelBlocksForRender({
        sourceBlocks,
        currentTime,
        currentSubtitleBlock,
        debugLog:
          typeof logContent === "function"
            ? (message, payload) =>
                logContent(`panel resolver: ${message}`, payload)
            : null,
      });
    }

    // -------------------------------------------------------
    // panel render
    // -------------------------------------------------------

    /**
     * 現在の subtitleBlocks / subtitleView / currentTime を使って panel を再描画する。
     * current block の表示テキストは subtitleView を優先して補強し、
     * DOM の全 rebuild が不要な場合は既存ノードを差分更新する。
     */
    function renderPanel() {
      if (!state.panelShadowRoot) return;

      const list = state.panelShadowRoot.getElementById("subtitle-list");
      if (!list) return;

      const currentTime = state.video ? state.video.currentTime : 0;
      const subtitleView = state.currentSubtitleView || null;
      const subtitleViewCurrentBlock = subtitleView?.currentBlock || null;
      const { primary: subtitleViewPrimary, secondary: subtitleViewSecondary } =
        getSubtitleViewTexts(subtitleView);

      const {
        displayBlocks: resolvedDisplayBlocks,
        currentBlocks,
      } = getAllPanelBlocks(currentTime, subtitleView);

      const resolvedCurrentBlock =
        (Array.isArray(currentBlocks) ? currentBlocks[0] || null : null) ||
        subtitleViewCurrentBlock ||
        state.currentSubtitleBlock ||
        null;

      // current 行だけは subtitleView を優先して表示テキストを補強する。
      const panelBlocks = (Array.isArray(resolvedDisplayBlocks)
        ? resolvedDisplayBlocks
        : []
      ).map((block) => {
        const isCurrent =
          resolvedCurrentBlock &&
          block?.key &&
          resolvedCurrentBlock?.key &&
          block.key === resolvedCurrentBlock.key;

        if (!isCurrent) {
          return {
            ...block,
            primary: block.primaryText || block.primary || "",
            secondary: block.secondaryText || block.secondary || "",
          };
        }

        const fallbackPrimary =
          subtitleViewPrimary ||
          resolvedCurrentBlock?.primaryText ||
          block.primaryText ||
          block.primary ||
          "";

        const fallbackSecondary =
          subtitleViewSecondary ||
          resolvedCurrentBlock?.secondaryText ||
          block.secondaryText ||
          block.secondary ||
          "";

        return {
          ...block,
          primary: fallbackPrimary,
          secondary: fallbackSecondary,
          primaryText: fallbackPrimary,
          secondaryText: fallbackSecondary,
        };
      });

      const currentIndex = panelBlocks.findIndex((block) => {
        return (
          resolvedCurrentBlock &&
          block?.key &&
          resolvedCurrentBlock?.key &&
          block.key === resolvedCurrentBlock.key
        );
      });

      const currentBlock =
        resolvedCurrentBlock ||
        (currentIndex >= 0 ? panelBlocks[currentIndex] || null : null) ||
        null;

      const curPrimaryCue =
        currentBlock &&
        state.primaryTrack &&
        Number.isFinite(currentBlock.startTime)
          ? findCueAt(state.primaryTrack, currentBlock.startTime + 0.01)
          : null;

      updatePanelRenderSnapshot({
        currentBlock,
        displayBlocks: panelBlocks,
        curPrimaryCue,
        subtitleView,
      });

      // -----------------------------------------------------
      // DOM rebuild 判定
      // -----------------------------------------------------

      // block 構成が同一なら list 全 rebuild を避ける。
      const blockSignature = panelBlocks
        .map((block) => `${block.key || block.startTime || ""}`)
        .join("|");

      const shouldRebuildList = state.lastPanelBlockSignature !== blockSignature;

      // -----------------------------------------------------
      // スクロール位置アンカー保存
      // -----------------------------------------------------

      // list 再構築前に、ビューポート先頭の実 block を基準位置として記録する。
      const scrollerEl =
        state.panelShadowRoot?.getElementById("panel-scroll") || null;

      let anchorKey = null;
      let anchorViewportOffset = 0;

      if (scrollerEl) {
        const scrollerRect = scrollerEl.getBoundingClientRect();
        const candidates = Array.from(
          list.querySelectorAll(".subtitle-block"),
        );

        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom > scrollerRect.top + 1) {
            anchorKey =
              el.getAttribute("data-seek-time") ||
              el.getAttribute("data-time") ||
              null;
            anchorViewportOffset = rect.top - scrollerRect.top;
            break;
          }
        }
      }

      // -----------------------------------------------------
      // DOM 反映
      // -----------------------------------------------------

      if (shouldRebuildList) {
        list.innerHTML = panelBlocks.map(buildPanelBlockHtml).join("");
        bindPanelBlockInteractions(list);
        state.lastPanelBlockSignature = blockSignature;

        // 再構築後も同じアンカーが見える位置へ scrollTop を補正する。
        if (scrollerEl && anchorKey) {
          const nextAnchor = list.querySelector(
            `.subtitle-block[data-seek-time="${anchorKey}"], .subtitle-block[data-time="${anchorKey}"]`,
          );

          if (nextAnchor) {
            const scrollerRect = scrollerEl.getBoundingClientRect();
            const nextRect = nextAnchor.getBoundingClientRect();
            const delta =
              nextRect.top - scrollerRect.top - anchorViewportOffset;
            scrollerEl.scrollTop += delta;
          }
        }
      } else {
        const existingBlocks = Array.from(
          list.querySelectorAll(".subtitle-block"),
        );

        panelBlocks.forEach((block, index) => {
          const el = existingBlocks[index];
          if (!el) return;

          const shouldBeCurrent = block.isSequentialCurrent === true;
          if (shouldBeCurrent) {
            el.id = "current-block";
          } else if (el.id === "current-block") {
            el.removeAttribute("id");
          }

          el.dataset.windowCurrent = block.isWindowCurrent ? "true" : "false";
          el.dataset.sequentialCurrent = block.isSequentialCurrent
            ? "true"
            : "false";
          el.dataset.panelEmphasized = block.isPanelEmphasized
            ? "true"
            : "false";

          const primaryEl = el.querySelector(".subtitle-primary");
          const secondaryEl = el.querySelector(".subtitle-secondary");
          const markEl = el.querySelector(".subtitle-mark");

          const { primary, secondary } = getBlockTexts(block);

          if (primaryEl) {
            primaryEl.innerHTML = makeClickableSpans(primary, primary);
          }

          if (secondary) {
            if (secondaryEl) {
              secondaryEl.innerHTML = makeClickableSpans(secondary, primary);
            } else {
              const contentEl = el.querySelector(".subtitle-content");
              if (contentEl) {
                const node = document.createElement("div");
                node.className = "subtitle-secondary";
                node.innerHTML = makeClickableSpans(secondary, primary);
                contentEl.appendChild(node);
              }
            }
          } else if (secondaryEl) {
            secondaryEl.remove();
          }

          if (markEl) {
            markEl.innerHTML = block.isPanelEmphasized
              ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>`
              : "";
          }
        });
      }

      // -----------------------------------------------------
      // current 行自動スクロール
      // -----------------------------------------------------

      scrollCurrentPanelBlockIntoView();
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------

    return {
      renderPanel,
      getSubtitleViewTexts,
      getBlockTexts,
      buildPanelBlockHtml,
      bindPanelWordInteractions,
      bindPanelBlockInteractions,
      updatePanelRenderSnapshot,
      scrollCurrentPanelBlockIntoView,
      getAllPanelBlocks,
    };
  }

  // -------------------------------------------------------
  // エクスポート（namespace形式: window.ATVB.panelRenderer.*）
  // -------------------------------------------------------

  root.panelRenderer = root.panelRenderer || {};
  root.panelRenderer.createPanelRenderer = createPanelRenderer;
})();

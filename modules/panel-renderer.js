// =============================================================
// Apple TV+ Bilingual Subtitles - panel-renderer.js
// 役割:
// - 右字幕パネルの list 描画責務を担当する。
// - panel 用 block の truth / same-window grouping / current 派生を
//   resolver へ委譲し、renderer は描画と panel 内 interaction に集中する。
// - current 行の表示テキスト補強は subtitleView / currentSubtitleBlock を入力で受け取る。
// - renderer は state を直接読まず、snapshot・signature・scroll 状態は返り値として owner へ返す。
// - panel host / shadow root / listener owner / dispose / observer 制御は panel-ui 側の責務とする。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * @typedef {object} PanelWordPopupPayload
   * @property {MouseEvent} event
   * @property {string} word
   * @property {string} sourceText
   * @property {DOMRect} anchorRect
   */

  /**
   * @typedef {object} PanelSeekRequest
   * @property {number} time
   * @property {object|null} block
   * @property {string} reason
   */

  /**
   * @typedef {object} ResolveDisplayBlocksInput
   * @property {Array<object>|{blocks?: Array<object>}|null} subtitleBlocks
   * @property {number} currentTime
   * @property {object|null} currentSubtitleBlock
   */

  /**
   * @typedef {object} ResolveDisplayBlocksResult
   * @property {Array<object>} sourceBlocks
   * @property {Array<object>} displayBlocks
   * @property {Array<object>} currentBlocks
   * @property {boolean} usedCurrentFallback
   * @property {Map<any, any>} sameWindowGroups
   */

  /**
   * @typedef {object} BuildPanelRenderSnapshotInput
   * @property {Array<object>} displayBlocks
   * @property {object|null} currentBlock
   * @property {TextTrackCue|null} currentPrimaryCue
   * @property {object|null} subtitleView
   * @property {number} renderedAt
   */

  /**
   * @typedef {object} PanelRenderSnapshot
   * @property {number} allBlocksCount
   * @property {object|null} currentSubtitleBlock
   * @property {number|null} currentPrimaryCueStartTime
   * @property {number} renderedAt
   */

  /**
   * @typedef {object} ScrollCurrentBlockInput
   * @property {ShadowRoot} shadowRoot
   * @property {string|null} lastScrolledCurrentKey
   */

  /**
   * @typedef {object} ScrollCurrentBlockResult
   * @property {string|null} lastScrolledCurrentKey
   * @property {boolean} didScroll
   */

  /**
   * @typedef {object} RenderPanelInput
   * @property {ShadowRoot} shadowRoot
   * @property {Array<object>|{blocks?: Array<object>}|null} subtitleBlocks
   * @property {object|null} subtitleView
   * @property {object|null} currentSubtitleBlock
   * @property {number} currentTime
   * @property {TextTrack|null} primaryTrack
   * @property {string} [lastBlockSignature]
   * @property {string|null} [lastScrolledCurrentKey]
   * @property {boolean} [scrollCurrentIntoView]
   * @property {(payload: PanelSeekRequest) => void} [onSeekRequested]
   */

  /**
   * @typedef {object} RenderPanelResult
   * @property {PanelRenderSnapshot|null} snapshot
   * @property {string} blockSignature
   * @property {boolean} didRebuildList
   * @property {object|null} currentBlock
   * @property {Array<object>} displayBlocks
   * @property {string|null} lastScrolledCurrentKey
   */

  /**
   * @typedef {object} PanelRendererApi
   * @property {(input: ResolveDisplayBlocksInput) => ResolveDisplayBlocksResult} resolveDisplayBlocks
   * @property {(input: BuildPanelRenderSnapshotInput) => PanelRenderSnapshot|null} buildPanelRenderSnapshot
   * @property {(input: ScrollCurrentBlockInput) => ScrollCurrentBlockResult} scrollCurrentPanelBlockIntoView
   * @property {(input: RenderPanelInput) => RenderPanelResult|null} renderPanel
   */

  /**
   * 右字幕パネル描画を担う renderer factory を生成する。
   * panel の current 判定や same-window grouping は resolver 側の正本を利用し、
   * renderer は displayBlocks を DOM へ反映する責務に寄せる。
   *
   * @param {object} deps
   * @param {(input: ResolveDisplayBlocksInput) => ResolveDisplayBlocksResult} [deps.resolvePanelBlocksForRender]
   * @param {(text: string, sourceText: string) => string} deps.makeClickableSpans
   * @param {(seconds: number) => string} deps.formatTime
   * @param {(word: string, sourceText: string, anchorRect: DOMRect, meta?: object) => void} [deps.showPopup]
   * @param {(track: TextTrack|null, time: number) => TextTrackCue|null} [deps.findCueAt]
   * @param {(message: string, payload?: any) => void} [deps.logContent]
   * @returns {PanelRendererApi}
   */
  function createPanelRenderer(deps = {}) {
    const {
      resolvePanelBlocksForRender,
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
     * @param {object|null} subtitleView
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
     * @param {object|null} block
     * @returns {{ primary: string, secondary: string }}
     */
    function getBlockTexts(block) {
      return {
        primary: String(block?.primaryText || block?.primary || "").trim(),
        secondary: String(block?.secondaryText || block?.secondary || "").trim(),
      };
    }

    /**
     * panel block の署名文字列を生成する。
     * list 全 rebuild の要否判定に使う。
     *
     * @param {Array<object>} blocks
     * @returns {string}
     */
    function buildPanelBlockSignature(blocks) {
      if (!Array.isArray(blocks) || blocks.length === 0) {
        return "";
      }

      return blocks
        .map((block) => {
          const key = String(block?.key || "");
          const startTime = Number(block?.startTime ?? 0);
          const state = String(block?.state || "");
          const primary = String(block?.primaryText || block?.primary || "");
          const secondary = String(block?.secondaryText || block?.secondary || "");

          return [key, startTime, state, primary, secondary].join("::");
        })
        .join("||");
    }

    // -------------------------------------------------------
    // HTML 生成
    // -------------------------------------------------------

    /**
     * panel block 1 件分の HTML を生成する。
     * current / emphasized などの表示状態は resolver の返り値をそのまま使う。
     *
     * @param {object} block
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
          data-block-key="${String(block?.key || "")}"
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
     * @returns {void}
     */
    function bindPanelWordInteractions(blockEl) {
      if (!(blockEl instanceof HTMLElement)) return;

      blockEl.querySelectorAll(".atv-word").forEach((span) => {
        span.addEventListener("mouseenter", () => {
          span.style.background = "rgba(255,220,80,0.3)";
        });

        span.addEventListener("mouseleave", () => {
          span.style.background = "";
        });

        span.addEventListener("click", (event) => {
          event.stopPropagation();
          event.preventDefault();

          const word = String(span.dataset.word || "").trim();
          const sourceText = decodeURIComponent(span.dataset.sentence || "");

          if (!word || typeof showPopup !== "function") return;

          showPopup(word, sourceText, span.getBoundingClientRect(), {
            source: "panel",
          });
        });
      });
    }

    /**
     * panel list 配下の block へ click interaction を結びつける。
     * seek 実行そのものは owner に委譲し、renderer は要求イベントだけを送る。
     *
     * @param {HTMLElement} list
     * @param {object} options
     * @param {Array<object>} options.displayBlocks
     * @param {(payload: PanelSeekRequest) => void} [options.onSeekRequested]
     * @returns {void}
     */
    function bindPanelBlockInteractions(list, { displayBlocks, onSeekRequested } = {}) {
      if (!(list instanceof HTMLElement)) return;

      list.querySelectorAll(".subtitle-block").forEach((blockEl) => {
        bindPanelWordInteractions(blockEl);

        blockEl.addEventListener("click", (event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.classList.contains("atv-word")) {
            return;
          }

          event.stopPropagation();
          event.preventDefault();

          const time = parseFloat(blockEl.dataset.seekTime || blockEl.dataset.time);
          if (Number.isNaN(time)) return;

          const blockKey = String(blockEl.dataset.blockKey || "");
          const block =
            Array.isArray(displayBlocks) && blockKey
              ? displayBlocks.find((item) => String(item?.key || "") === blockKey) || null
              : null;

          if (typeof onSeekRequested === "function") {
            onSeekRequested({
              time,
              block,
              reason: "panel-block-click",
            });
          }
        });
      });
    }

    // -------------------------------------------------------
    // snapshot
    // -------------------------------------------------------

    /**
     * panel 描画結果から snapshot を構築して返す。
     * renderer は snapshot を計算するだけで、保存先の state は owner が管理する。
     *
     * @param {BuildPanelRenderSnapshotInput} input
     * @returns {PanelRenderSnapshot|null}
     */
    function buildPanelRenderSnapshot(input) {
      const {
        displayBlocks,
        currentBlock,
        currentPrimaryCue,
        subtitleView,
        renderedAt,
      } = input || {};

      const renderedCurrentBlock =
        currentBlock ||
        subtitleView?.currentBlock ||
        (Array.isArray(displayBlocks)
          ? displayBlocks.find((block) => block?.state === "current") || null
          : null);

      const { primary: uiPrimaryText, secondary: uiSecondaryText } =
        getSubtitleViewTexts(subtitleView);

      const currentSubtitleBlock = renderedCurrentBlock
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

      return {
        allBlocksCount: Array.isArray(displayBlocks) ? displayBlocks.length : 0,
        currentSubtitleBlock,
        currentPrimaryCueStartTime: Number.isFinite(currentPrimaryCue?.startTime)
          ? currentPrimaryCue.startTime
          : null,
        renderedAt: Number.isFinite(renderedAt) ? renderedAt : Date.now(),
      };
    }

    // -------------------------------------------------------
    // auto scroll
    // -------------------------------------------------------

    /**
     * current block が可視領域の上下余白を割り込んだときだけ自動スクロールする。
     * scroll 状態の保持は owner 側が行い、renderer は更新済み key を返す。
     *
     * @param {ScrollCurrentBlockInput} input
     * @returns {ScrollCurrentBlockResult}
     */
    function scrollCurrentPanelBlockIntoView(input) {
      const { shadowRoot, lastScrolledCurrentKey = null } = input || {};

      if (!(shadowRoot instanceof ShadowRoot)) {
        return {
          lastScrolledCurrentKey,
          didScroll: false,
        };
      }

      const scroller = shadowRoot.getElementById("panel-scroll");
      const current = shadowRoot.getElementById("current-block");

      if (!(scroller instanceof HTMLElement) || !(current instanceof HTMLElement)) {
        return {
          lastScrolledCurrentKey,
          didScroll: false,
        };
      }

      const currentKey = String(current.dataset.blockKey || "");
      if (currentKey && currentKey === lastScrolledCurrentKey) {
        return {
          lastScrolledCurrentKey,
          didScroll: false,
        };
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();

      const margin = currentRect.height || 48;
      const isAbove = currentRect.top < scrollerRect.top + margin;
      const isBelow = currentRect.bottom > scrollerRect.bottom - margin;

      if (!isAbove && !isBelow) {
        return {
          lastScrolledCurrentKey: currentKey || lastScrolledCurrentKey,
          didScroll: false,
        };
      }

      const offsetTop = current.offsetTop;
      const targetTop = Math.max(0, offsetTop - scroller.clientHeight / 2 + current.clientHeight / 2);

      scroller.scrollTo({
        top: targetTop,
        behavior: "smooth",
      });

      return {
        lastScrolledCurrentKey: currentKey || lastScrolledCurrentKey,
        didScroll: true,
      };
    }

    // -------------------------------------------------------
    // resolver adapter
    // -------------------------------------------------------

    /**
     * subtitleBlocks を panel renderer 用の displayBlocks へ解決する。
     * current 判定・same-window grouping・panel 強調フラグは resolver の正本を使う。
     *
     * @param {ResolveDisplayBlocksInput} input
     * @returns {ResolveDisplayBlocksResult}
     */
    function resolveDisplayBlocks(input) {
      const {
        subtitleBlocks,
        currentTime = 0,
        currentSubtitleBlock = null,
      } = input || {};

      const sourceBlocks = Array.isArray(subtitleBlocks)
        ? subtitleBlocks.slice()
        : Array.isArray(subtitleBlocks?.blocks)
          ? subtitleBlocks.blocks.slice()
          : [];

      if (typeof resolvePanelBlocksForRender !== "function") {
        return {
          sourceBlocks,
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
     *
     * @param {RenderPanelInput} input
     * @returns {RenderPanelResult|null}
     */
    function renderPanel(input) {
      const {
        shadowRoot,
        subtitleBlocks,
        subtitleView = null,
        currentSubtitleBlock = null,
        currentTime = 0,
        primaryTrack = null,
        lastBlockSignature = "",
        lastScrolledCurrentKey = null,
        scrollCurrentIntoView = true,
        onSeekRequested,
      } = input || {};

      if (!(shadowRoot instanceof ShadowRoot)) return null;

      const list = shadowRoot.getElementById("subtitle-list");
      if (!(list instanceof HTMLElement)) return null;

      const subtitleViewCurrentBlock = subtitleView?.currentBlock || null;
      const { primary: subtitleViewPrimary, secondary: subtitleViewSecondary } =
        getSubtitleViewTexts(subtitleView);

      const {
        displayBlocks: resolvedDisplayBlocks,
        currentBlocks,
      } = resolveDisplayBlocks({
        subtitleBlocks,
        currentTime,
        currentSubtitleBlock: subtitleViewCurrentBlock || currentSubtitleBlock || null,
      });

      const resolvedCurrentBlock =
        (Array.isArray(currentBlocks) ? currentBlocks[0] || null : null) ||
        subtitleViewCurrentBlock ||
        currentSubtitleBlock ||
        null;

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

      const currentPrimaryCue =
        currentBlock &&
        Number.isFinite(currentBlock.startTime) &&
        typeof findCueAt === "function"
          ? findCueAt(primaryTrack, currentBlock.startTime + 0.01)
          : null;

      const snapshot = buildPanelRenderSnapshot({
        currentBlock,
        displayBlocks: panelBlocks,
        currentPrimaryCue,
        subtitleView,
        renderedAt: Date.now(),
      });

      const blockSignature = buildPanelBlockSignature(panelBlocks);
      const shouldRebuildList = blockSignature !== String(lastBlockSignature || "");

      if (shouldRebuildList) {
        list.innerHTML = panelBlocks.map(buildPanelBlockHtml).join("");
        bindPanelBlockInteractions(list, {
          displayBlocks: panelBlocks,
          onSeekRequested,
        });
      } else {
        const blockEls = list.querySelectorAll(".subtitle-block");
        panelBlocks.forEach((block, index) => {
          const blockEl = blockEls[index];
          if (!(blockEl instanceof HTMLElement)) return;

          const isSequentialCurrent =
            block.isSequentialCurrent ?? block.state === "current";
          const isPanelEmphasized =
            block.isPanelEmphasized ?? block.state === "current";
          const isWindowCurrent = block.isWindowCurrent === true;

          blockEl.id = isSequentialCurrent ? "current-block" : "";
          blockEl.dataset.windowCurrent = isWindowCurrent ? "true" : "false";
          blockEl.dataset.sequentialCurrent = isSequentialCurrent ? "true" : "false";
          blockEl.dataset.panelEmphasized = isPanelEmphasized ? "true" : "false";
          blockEl.dataset.blockKey = String(block?.key || "");

          const { primary, secondary } = getBlockTexts(block);
          const primaryEl = blockEl.querySelector(".subtitle-primary");
          const secondaryEl = blockEl.querySelector(".subtitle-secondary");
          const markEl = blockEl.querySelector(".subtitle-mark");

          if (primaryEl) {
            primaryEl.innerHTML = makeClickableSpans(primary, primary);
          }

          if (secondary) {
            if (secondaryEl) {
              secondaryEl.innerHTML = makeClickableSpans(secondary, primary);
            } else {
              const contentEl = blockEl.querySelector(".subtitle-content");
              if (contentEl) {
                const div = document.createElement("div");
                div.className = "subtitle-secondary";
                div.innerHTML = makeClickableSpans(secondary, primary);
                contentEl.appendChild(div);
              }
            }
          } else if (secondaryEl) {
            secondaryEl.remove();
          }

          if (markEl) {
            markEl.innerHTML = isPanelEmphasized
              ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>`
              : "";
          }

          bindPanelWordInteractions(blockEl);
        });
      }

      let nextScrolledCurrentKey = lastScrolledCurrentKey;
      if (scrollCurrentIntoView) {
        const scrollResult = scrollCurrentPanelBlockIntoView({
          shadowRoot,
          lastScrolledCurrentKey,
        });
        nextScrolledCurrentKey = scrollResult.lastScrolledCurrentKey;
      }

      return {
        snapshot,
        blockSignature,
        didRebuildList: shouldRebuildList,
        currentBlock,
        displayBlocks: panelBlocks,
        lastScrolledCurrentKey: nextScrolledCurrentKey,
      };
    }

    return {
      resolveDisplayBlocks,
      buildPanelRenderSnapshot,
      scrollCurrentPanelBlockIntoView,
      renderPanel,
    };
  }

  root.panelRenderer = root.panelRenderer || {};
  root.panelRenderer.createPanelRenderer = createPanelRenderer;
})();

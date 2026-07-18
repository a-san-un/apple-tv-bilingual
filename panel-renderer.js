// =============================================================
// Apple TV+ Bilingual Subtitles - panel-renderer.js
// version: 2.6.4
//
// 役割:
// - 右字幕パネルの list 描画責務を担当する
// - resolver が返す blocks/currentBlocks/sameWindowGroups を受け取り、
//   panel 用 DOM へ変換する
// - panel current UX 用の派生フラグ
//   (isWindowCurrent / isPanelEmphasized / isSequentialCurrent)
//   を描画へ反映する
//
// Phase 3-3 方針:
// - truth は resolver 側の strict state/currentBlocks に委譲する
// - panel は派生ビューとして multi-line current 表示を許容する
// - strict current は scroll anchor / debug の基準として使い、
//   panel 強調は isPanelEmphasized を使って描画する
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  // [factory]
  // panel renderer インスタンスを生成し、依存関数・state を束ねる。
  function createPanelRenderer(deps = {}) {
    const {
      state,
      makeClickableSpans,
      formatTime,
      showPopup,
      findCueAt,
      getCurrentCue,
      cleanCueText,
      logContent,
      resolvePanelBlocksForRender = () => ({
        blocks: [],
        displayBlocks: [],
        currentBlocks: [],
        usedCurrentFallback: false,
        sameWindowGroups: new Map(),
      }),
      PANEL_PRIMARY_GRACE_MS,
      DEBUG_PANEL_PROBE,
    } = deps;

    // [render block html]
    // subtitle block 1件分の HTML を組み立てる。
    // panel 強調と strict current は別フラグで扱う。
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
      const pText = makeClickableSpans(block.primary, block.primary);
      const sText = makeClickableSpans(block.secondary, block.primary);

      return `
        <div
          class="${cls}"
          ${mid}
          data-time="${block.startTime}"
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

    // [bind word interactions]
    // block 内の単語 hover / click を subtitle popup へ接続する。
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
          showPopup(
            span.dataset.word,
            decodeURIComponent(span.dataset.sentence),
            span.getBoundingClientRect(),
            { source: "panel" },
          );
        });
      });
    }

    // [bind block interactions]
    // block click と word click を panel list DOM に接続する。
    function bindPanelBlockInteractions(list) {
      list.querySelectorAll(".subtitle-block").forEach((blockEl) => {
        bindPanelWordInteractions(blockEl);

        blockEl.addEventListener("click", (e) => {
          if (e.target.classList.contains("atv-word")) return;
          e.stopPropagation();
          e.preventDefault();
          const t = parseFloat(blockEl.dataset.time);
          if (state.video && !Number.isNaN(t)) {
            state.video.currentTime = t;
            setTimeout(() => renderPanel(), 100);
          }
        });
      });
    }

    // [update render snapshot]
    // panel の最終描画状態を snapshot として保持し、必要なら primary snapshot 時刻も更新する。
    function updatePanelRenderSnapshot({
      currentBlock,
      displayBlocks,
      curPrimaryCue,
    }) {
      const renderedCurrentBlock =
        currentBlock ||
        (Array.isArray(displayBlocks)
          ? displayBlocks.find((block) => block.state === "current") || null
          : null);
      const stateCurrentBlock = state.currentSubtitleBlock || null;
      const subtitleViewResolver = window.ATVB?.subtitleViewResolver || null;
      const sequenceBlocks = Array.isArray(state.subtitleBlocks)
        ? state.subtitleBlocks
        : [];
      const currentIndex = sequenceBlocks.findIndex(
        (block) => block?.state === "current",
      );
      const uiView =
        subtitleViewResolver &&
        typeof subtitleViewResolver.resolveUiSubtitleView === "function"
          ? subtitleViewResolver.resolveUiSubtitleView(
              sequenceBlocks,
              currentIndex,
              null,
            )
          : null;

      const uiPrimaryText =
        Array.isArray(uiView?.mainLines) && uiView.mainLines.length > 0
          ? uiView.mainLines.join("\n")
          : "";
      const uiSecondaryText =
        Array.isArray(uiView?.subLines) && uiView.subLines.length > 0
          ? uiView.subLines.join("\n")
          : "";

      const currentSubtitleBlock = stateCurrentBlock
        ? {
            ...stateCurrentBlock,
            primaryText: uiPrimaryText || stateCurrentBlock.primaryText || "",
            secondaryText:
              uiSecondaryText || stateCurrentBlock.secondaryText || "",
          }
        : renderedCurrentBlock
          ? {
              primaryText: uiPrimaryText || renderedCurrentBlock.primary || "",
              secondaryText:
                uiSecondaryText || renderedCurrentBlock.secondary || "",
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

    // [scroll current block]
    // strict current block が見切れる場合だけ panel scroll position を補正する。
    function scrollCurrentPanelBlockIntoView() {
      const currentBlock =
        state.panelShadowRoot?.getElementById("current-block");
      const panelScroll = state.panelShadowRoot?.getElementById("panel-scroll");
      if (!currentBlock || !panelScroll) return;

      const scrollRect = panelScroll.getBoundingClientRect();
      const currentRect = currentBlock.getBoundingClientRect();
      const topThresholdY =
        scrollRect.top + Math.max(32, currentRect.height * 0.8);
      const bottomThresholdY =
        scrollRect.bottom - Math.max(48, currentRect.height * 1.5);

      if (
        currentRect.top < topThresholdY ||
        currentRect.bottom > bottomThresholdY
      ) {
        const targetTopOffset = Math.max(28, Math.min(72, currentRect.height));
        const targetTopY = scrollRect.top + targetTopOffset;
        const scrollBy = currentRect.top - targetTopY;
        panelScroll.scrollTo({
          top: Math.max(0, panelScroll.scrollTop + scrollBy),
          behavior: "smooth",
        });
      }
    }

    // [get render blocks]
    // subtitleBlocks の解決を resolver へ委譲し、panel 描画用 shape に整える。
    // debug 時は対象区間の block / group / current をログ出力する。
    function getPanelBlocksForRender(currentTime) {
      const result = resolvePanelBlocksForRender({
        sourceBlocks: state.subtitleBlocks,
        currentTime,
        currentSubtitleBlock: null,
        debugLog: logContent,
      });

      const shouldDebug32to40 = currentTime >= 32 && currentTime <= 40;
      const shouldDebug59to68 = currentTime >= 59 && currentTime <= 68;

      if (shouldDebug32to40 || shouldDebug59to68) {
        const debugMin = shouldDebug32to40 ? 32 : 59;
        const debugMax = shouldDebug32to40 ? 40 : 68;
        const debugLabel = shouldDebug32to40
          ? "panel debug 32-40"
          : "panel debug 59-68";

        const debugBlocks = (result.blocks || [])
          .filter(
            (block) =>
              block.startTime >= debugMin && block.startTime <= debugMax,
          )
          .map((block) => ({
            key: block.key || null,
            startTime: block.startTime,
            endTime: block.endTime,
            state: block.state,
            stable: block.stable ?? null,
            isWindowCurrent: block.isWindowCurrent ?? null,
            isSequentialCurrent: block.isSequentialCurrent ?? null,
            isPanelEmphasized: block.isPanelEmphasized ?? null,
            primaryPreview: String(block.primary || "").slice(0, 80),
            secondaryPreview: String(block.secondary || "").slice(0, 80),
          }));

        const debugGroups = Array.from(
          (result.sameWindowGroups || new Map()).entries(),
        )
          .map(([groupKey, entries]) => ({
            groupKey,
            size: entries.length,
            startTime: entries[0]?.block?.startTime ?? null,
            endTime: entries[0]?.block?.endTime ?? null,
            items: entries.map(({ block }, index) => ({
              index,
              state: block.state,
              key: block.key || null,
              primaryPreview: String(block.primary || "").slice(0, 60),
            })),
          }))
          .filter(
            (group) =>
              group.startTime >= debugMin && group.startTime <= debugMax,
          );

        logContent(debugLabel, {
          currentTime,
          currentBlocks: (result.currentBlocks || []).map((block) => ({
            key: block.key || null,
            startTime: block.startTime,
            endTime: block.endTime,
            state: block.state,
            primaryPreview: String(block.primary || "").slice(0, 80),
          })),
          debugBlocks,
          debugGroups,
        });
      }

      return {
        blocks: result.blocks || [],
        displayBlocks: result.displayBlocks || result.blocks || [],
        currentBlocks: result.currentBlocks || [],
        usedCurrentFallback: Boolean(result.usedCurrentFallback),
      };
    }

    // [render panel]
    // panel 描画本体。resolver 結果を DOM へ反映し、イベント接続と scroll 補正まで行う。
    function renderPanel() {
      if (!state.panelShadowRoot) return;
      const list = state.panelShadowRoot.getElementById("subtitle-list");
      if (!list) return;

      const currentTime = state.video ? state.video.currentTime : 0;
      const {
        displayBlocks,
        currentBlocks,
        usedCurrentFallback,
      } = getPanelBlocksForRender(currentTime);
      const currentBlock = currentBlocks[0] || null;
      const curPrimaryCue =
        currentBlock && state.primaryTrack
          ? findCueAt(state.primaryTrack, currentBlock.startTime + 0.01)
          : null;

      if (currentBlocks.length > 1) {
        logContent("panel render current candidates", {
          currentTime,
          candidateCount: currentBlocks.length,
          usedCurrentFallback,
          candidates: currentBlocks.map((block) => ({
            key: block.key || null,
            startTime: block.startTime,
            endTime: block.endTime,
            stable: block.stable ?? null,
            primaryPreview: String(block.primary || "").slice(0, 80),
            secondaryPreview: String(block.secondary || "").slice(0, 80),
          })),
        });
      }

      updatePanelRenderSnapshot({
        currentBlock,
        displayBlocks,
        curPrimaryCue,
      });

      list.innerHTML = displayBlocks
        .map((block) => buildPanelBlockHtml(block))
        .join("");

      bindPanelBlockInteractions(list);

      scrollCurrentPanelBlockIntoView();
    }

    return {
      renderPanel,
    };
  }

  window.ATVB.panelRenderer = {
    createPanelRenderer,
  };
})();

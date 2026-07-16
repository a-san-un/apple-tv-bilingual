// =============================================================
// Apple TV+ Bilingual Subtitles - panel-renderer.js
// version: 2.6.3
// 役割: 右字幕パネルの list 描画責務を担当する。
// Phase E (3): content.js から panel renderer 本体を切り出して
// window.ATVB.panelRenderer で公開する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

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
        currentBlocks: [],
        usedCurrentFallback: false,
        sameWindowGroups: new Map(),
      }),
      PANEL_PRIMARY_GRACE_MS,
      DEBUG_PANEL_PROBE,
    } = deps;

    // [render: panel block html] subtitle block 1件分の HTML を組み立てる。
    function buildPanelBlockHtml(block) {
      const isCurrent = block.state === "current";
      const cls = "subtitle-block";
      const mid = isCurrent ? 'id="current-block"' : "";
      const mark = isCurrent
        ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>`
        : "";
      const pText = makeClickableSpans(block.primary, block.primary);
      const sText = makeClickableSpans(block.secondary, block.primary);
      return `
        <div class="${cls}" ${mid} data-time="${block.startTime}">
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

    // [wiring: panel word interactions] block 内の単語 hover / click を subtitle popup へ接続する。
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

    // [wiring: panel block interactions] block click と word click を panel list DOM に接続する。
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

    // [render: panel list blocks - future] current time より後ろの cue から future block 群を組み立てる。
    function collectFuturePanelBlocks(currentTime) {
      const blocks = [];
      if (!state.primaryTrack || !state.primaryTrack.cues) return blocks;

      for (let i = 0; i < state.primaryTrack.cues.length; i++) {
        const c = state.primaryTrack.cues[i];
        if (c.startTime > currentTime + 0.1) {
          const sc = findCueAt(state.secondaryTrack, c.startTime + 0.05);
          blocks.push({
            startTime: c.startTime,
            endTime: c.endTime,
            primary: cleanCueText(c),
            secondary: cleanCueText(sc),
            state: "future",
          });
        }
      }

      return blocks;
    }

    // [render: panel list blocks - current] primary / secondary の現在 cue から current block を組み立てる。
    function buildCurrentPanelBlock(currentTime) {
      const curPrimaryCue = getCurrentCue(state.primaryTrack, currentTime);
      const curSecondaryCue = findCueAt(state.secondaryTrack, currentTime);
      const currentStateBlock = state.currentSubtitleBlock || null;

      if (!curPrimaryCue && !curSecondaryCue && !currentStateBlock) {
        return { block: null, curPrimaryCue: null };
      }

      const currentCue = curPrimaryCue || curSecondaryCue;
      let currentPrimaryText =
        currentStateBlock?.primaryText ||
        (curPrimaryCue ? cleanCueText(curPrimaryCue) : "");

      if (
        !currentPrimaryText &&
        state.primaryTrack &&
        curSecondaryCue &&
        state.lastPrimaryText
      ) {
        const elapsedSincePrimarySnapshot =
          Date.now() - state.lastPrimarySnapshotAt;
        if (
          state.lastPrimarySnapshotAt > 0 &&
          elapsedSincePrimarySnapshot <= PANEL_PRIMARY_GRACE_MS
        ) {
          currentPrimaryText = state.lastPrimaryText;
        }
      }

      const currentSecondaryText =
        currentStateBlock?.secondaryText || cleanCueText(curSecondaryCue);

      if (!currentCue) {
        return { block: null, curPrimaryCue: null };
      }

      if (DEBUG_PANEL_PROBE) {
        logContent("panel render current block probe", {
          currentTime,
          settingsPrimaryLang: state.contentSettings.primaryLang,
          primaryTrackLanguage: state.primaryTrack?.language,
          primaryTrackLabel: state.primaryTrack?.label,
          secondaryTrackLanguage: state.secondaryTrack?.language,
          secondaryTrackLabel: state.secondaryTrack?.label,
          curPrimaryCueText: cleanCueText(curPrimaryCue).slice(0, 40),
          curSecondaryCueText: cleanCueText(curSecondaryCue).slice(0, 40),
          statePrimaryText: (currentStateBlock?.primaryText || "").slice(0, 40),
          stateSecondaryText: (currentStateBlock?.secondaryText || "").slice(0, 40),
          resolvedPrimary: currentPrimaryText.slice(0, 40),
          currentBlockSecondary: currentSecondaryText.slice(0, 40),
        });
      }

      return {
        curPrimaryCue,
        block: {
          startTime: currentCue.startTime,
          endTime: currentCue.endTime,
          primary: currentPrimaryText,
          secondary: currentSecondaryText,
          state: "current",
        },
      };
    }

    // [render: panel snapshot] current block と primary snapshot の最終描画状態を保持する。
    function updatePanelRenderSnapshot(allBlocks, curPrimaryCue) {
      const renderedCurrentBlock = allBlocks.find((b) => b.state === "current");
      const stateCurrentBlock = state.currentSubtitleBlock || null;
      const currentSubtitleBlock =
        stateCurrentBlock ||
        (renderedCurrentBlock
          ? {
              primaryText: renderedCurrentBlock.primary || "",
              secondaryText: renderedCurrentBlock.secondary || "",
            }
          : null);

      state.lastPanelRenderSnapshot = {
        allBlocksCount: allBlocks.length,
        currentSubtitleBlock,
      };

      if (curPrimaryCue && currentSubtitleBlock?.primaryText) {
        state.lastPrimarySnapshotAt = Date.now();
      }
    }

    // [render: panel scroll] current block が見切れる場合だけ panel scroll position を補正する。
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

    // [render: panel visible blocks] subtitleBlocks の解決は resolver へ委譲する。
    function getPanelBlocksForRender(currentTime) {
      const result = resolvePanelBlocksForRender({
        sourceBlocks: state.subtitleBlocks,
        currentTime,
        currentSubtitleBlock: state.currentSubtitleBlock || null,
      });

      if (currentTime >= 59 && currentTime <= 68) {
        const debugBlocks = (result.blocks || [])
          .filter((block) => block.startTime >= 59 && block.startTime <= 68)
          .map((block) => ({
            key: block.key || null,
            startTime: block.startTime,
            endTime: block.endTime,
            state: block.state,
            stable: block.stable ?? null,
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
              primaryPreview: String(block.primary || "").slice(0, 60),
            })),
          }))
          .filter((group) => group.startTime >= 59 && group.startTime <= 68);

        logContent("panel debug 59-68", {
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
        currentBlocks: result.currentBlocks || [],
        usedCurrentFallback: Boolean(result.usedCurrentFallback),
      };
    }

    // [render: panel list apply] panel 描画を subtitleBlocks ベースへ寄せる。
    function renderPanel() {
      if (!state.panelShadowRoot) return;
      const list = state.panelShadowRoot.getElementById("subtitle-list");
      if (!list) return;

      const currentTime = state.video ? state.video.currentTime : 0;
      const {
        blocks: allBlocks,
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

      updatePanelRenderSnapshot(allBlocks, curPrimaryCue);

      // [render: panel list DOM apply]
      list.innerHTML = allBlocks
        .map((block) => buildPanelBlockHtml(block))
        .join("");

      // [wiring: panel list interactions]
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

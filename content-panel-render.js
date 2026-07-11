// Phase C: content.js から panel render 責務を切り出して window.ATVB.contentPanelRender で公開する。
(() => {
  window.ATVB = window.ATVB || {};

  if (window.ATVB.contentPanelRender?.createContentPanelRender) return;

  function createContentPanelRender(deps = {}) {
    function hasDeps() {
      return Boolean(
        deps.state &&
        deps.makeClickableSpans &&
        deps.formatTime &&
        deps.showPopup &&
        deps.findCueAt &&
        deps.cleanCueText &&
        deps.getCurrentCue &&
        deps.normalizeSubtitleText &&
        deps.renderCurrentSnapshot &&
        deps.renderPanel &&
        deps.getTarget
      );
    }

    function buildPanelBlockHtml(block) {
      const isCurrent = block.state === "current";
      const cls = "subtitle-block";
      const mid = isCurrent ? 'id="current-block"' : "";
      const mark = isCurrent
        ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>'
        : "";
      const pText = deps.makeClickableSpans(block.primary, block.primary);
      const sText = deps.makeClickableSpans(block.secondary, block.primary);
      return `
          <div class="${cls}" ${mid} data-time="${block.startTime}">
            <div class="subtitle-row">
              <div class="subtitle-mark">${mark}</div>
              <div class="subtitle-content">
                <div class="subtitle-time">${deps.formatTime(block.startTime)}</div>
                <div class="subtitle-primary">${pText}</div>
                ${sText ? `<div class="subtitle-secondary">${sText}</div>` : ""}
              </div>
            </div>
          </div>
        `;
    }

    function collectFuturePanelBlocks(currentTime) {
      const blocks = [];
      if (!deps.state.primaryTrack || !deps.state.primaryTrack.cues) return blocks;

      for (let i = 0; i < deps.state.primaryTrack.cues.length; i++) {
        const c = deps.state.primaryTrack.cues[i];
        if (c.startTime > currentTime + 0.1) {
          const sc = deps.findCueAt(deps.state.secondaryTrack, c.startTime + 0.05);
          blocks.push({
            startTime: c.startTime,
            endTime: c.endTime,
            primary: deps.cleanCueText(c),
            secondary: deps.cleanCueText(sc),
            state: "future",
          });
        }
      }

      return blocks;
    }

    function buildCurrentPanelBlock(currentTime) {
      const curPrimaryCue = deps.getCurrentCue(deps.state.primaryTrack, currentTime);
      const curSecondaryCue = deps.findCueAt(deps.state.secondaryTrack, currentTime);
      if (!curPrimaryCue && !curSecondaryCue) {
        return { block: null, curPrimaryCue: null };
      }

      const currentCue = curPrimaryCue || curSecondaryCue;
      let currentPrimaryText = curPrimaryCue ? deps.cleanCueText(curPrimaryCue) : "";

      if (
        !currentPrimaryText &&
        deps.state.primaryTrack &&
        curSecondaryCue &&
        deps.state.lastPrimaryText
      ) {
        const elapsedSincePrimarySnapshot =
          Date.now() - deps.state.lastPrimarySnapshotAt;
        if (
          deps.state.lastPrimarySnapshotAt > 0 &&
          elapsedSincePrimarySnapshot <= deps.PANEL_PRIMARY_GRACE_MS
        ) {
          currentPrimaryText = deps.state.lastPrimaryText;
        }
      }

      const currentSecondaryText = deps.cleanCueText(curSecondaryCue);
      if (deps.DEBUG_PANEL_PROBE) {
        deps.logContent("panel render current block probe", {
          currentTime,
          settingsPrimaryLang: deps.state.contentSettings.primaryLang,
          primaryTrackLanguage: deps.state.primaryTrack?.language,
          primaryTrackLabel: deps.state.primaryTrack?.label,
          secondaryTrackLanguage: deps.state.secondaryTrack?.language,
          secondaryTrackLabel: deps.state.secondaryTrack?.label,
          curPrimaryCueText: deps.cleanCueText(curPrimaryCue).slice(0, 40),
          curSecondaryCueText: currentSecondaryText.slice(0, 40),
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

    function updatePanelRenderSnapshot(allBlocks, curPrimaryCue) {
      const currentSubtitleBlock = allBlocks.find((b) => b.state === "current");
      deps.state.lastPanelRenderSnapshot = {
        allBlocksCount: allBlocks.length,
        currentSubtitleBlock: currentSubtitleBlock
          ? {
              primaryText: currentSubtitleBlock.primary || "",
              secondaryText: currentSubtitleBlock.secondary || "",
            }
          : null,
      };

      if (curPrimaryCue && currentSubtitleBlock?.primary) {
        deps.state.lastPrimarySnapshotAt = Date.now();
      }
    }

    function scrollCurrentPanelBlockIntoView() {
      const currentBlock = deps.state.panelShadowRoot?.getElementById("current-block");
      const panelScroll = deps.state.panelShadowRoot?.getElementById("panel-scroll");
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

    function applySecondarySubtitleFallback(reason = "unknown") {
      const panelHost = deps.getTarget().querySelector("#atv-panel-host");
      const secondaryEl = panelHost?.querySelector("[data-secondary-subtitle]");
      let secondaryText = deps.normalizeSubtitleText(secondaryEl?.textContent || "");

      deps.logSubtitlePanelState("before-secondary-fallback");

      if (!secondaryText && secondaryEl && deps.state.subtitleHistory.length > 0) {
        const latestHistory =
          deps.state.subtitleHistory[deps.state.subtitleHistory.length - 1];
        const fallbackText = deps.normalizeSubtitleText(
          latestHistory?.secondary || latestHistory?.primary || "",
        );
        if (fallbackText) {
          secondaryEl.textContent = fallbackText;
          secondaryText = fallbackText;
          deps.logContent("panel secondary text fallback applied", {
            reason,
            contentKey: deps.state.currentContentKey,
            fallbackSource: latestHistory?.secondary ? "secondary" : "primary",
            fallbackTextLength: fallbackText.length,
          });
        }
      }

      return {
        panelHost,
        secondaryText,
      };
    }

    function applyCurrentStateToPanel(reason = "unknown") {
      const ready = hasDeps();
      if (!ready) {
        return {
          delegated: false,
          reason,
          hasDeps: false,
          rendered: false,
        };
      }

      deps.renderCurrentSnapshot(reason);
      deps.renderPanel();

      return {
        delegated: true,
        reason,
        hasDeps: true,
        rendered: true,
      };
    }

    return {
      deps,
      version: "phase-c-factory",
      hasDeps,
      buildPanelBlockHtml,
      buildCurrentPanelBlock,
      collectFuturePanelBlocks,
      updatePanelRenderSnapshot,
      scrollCurrentPanelBlockIntoView,
      applySecondarySubtitleFallback,
      applyCurrentStateToPanel,
    };
  }

  window.ATVB.contentPanelRender = {
    createContentPanelRender,
  };
})();

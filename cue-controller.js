(() => {
  const root = (window.ATVB = window.ATVB || {});

  function createCueController({
    logContent,
    DEBUG_SECONDARY_SUBS,
    getSecondaryTrackDebugPayload,
    resolveSecondarySubtitleTrack,
    getCurrentCueText,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    getRequestedSecondaryLanguage,
    getPrimaryTrack,
    getSecondaryTrack,
    getCurrentCue,
    cleanCueText,
    getCurrentTime,
    getPrimaryTrackCues,
    getSecondaryTrackCues,
    getPreviousSubtitleBlocks,
    setSubtitleBlocks,
    getSubtitleBlockSequence,
    getCurrentSubtitleBlockFromSequence,
    setCurrentSubtitleBlock,
    DEBUG_PANEL_PROBE,
    renderSecondarySubtitle,
    updateOverlay,
    updateOverlayFromView,
    updateOverlayFromBlock,
    renderPanel,
  }) {
    let secondaryTrackCleanup = null;
    let secondaryTrackBound = null;

    function getBoundSecondaryTrack() {
      return secondaryTrackBound;
    }

    function unbindSecondarySubtitleTrack() {
      if (secondaryTrackCleanup) {
        secondaryTrackCleanup();
        secondaryTrackCleanup = null;
      }
      secondaryTrackBound = null;
    }

    function onCueChange(track) {
      if (track && DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary cuechange render",
          getSecondaryTrackDebugPayload(getRequestedSecondaryLanguage(), track),
        );
      }

      if (track) {
        renderSecondarySubtitle(getCurrentCueText(track), track);
      }

      onPrimaryCueChange();
    }

    function bindSecondarySubtitleTrack(track) {
      if (!track) return;

      unbindSecondarySubtitleTrack();

      try {
        if (track.mode === "disabled") {
          track.mode = "hidden";
        }
      } catch (_) {}

      if (DEBUG_SECONDARY_SUBS) {
        logContent("secondary track bind", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          trackMode: track?.mode || "",
          cuesLength: getTrackCuesLength(track),
          activeCuesLength: getTrackActiveCuesLength(track),
        });
      }

      const handler = () => onCueChange(track);
      track.addEventListener("cuechange", handler);

      secondaryTrackCleanup = () => {
        track.removeEventListener("cuechange", handler);
      };

      secondaryTrackBound = track;
      onCueChange(track);
    }

    function syncSecondarySubtitleTrack(
      video,
      requestedLang,
      renderSecondarySubtitleOverride,
      options = {},
    ) {
      if (!video) return;

      const suppressRender = options.suppressRender === true;

      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary sync",
          getSecondaryTrackDebugPayload(requestedLang, secondaryTrackBound),
        );
      }

      const track = resolveSecondarySubtitleTrack(video, requestedLang);

      if (!track) {
        unbindSecondarySubtitleTrack();
        if (!suppressRender) {
          (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
            "",
            null,
          );
        }
        return;
      }

      if (secondaryTrackBound !== track) {
        bindSecondarySubtitleTrack(track);
        return;
      }

      if (!suppressRender) {
        (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
          getCurrentCueText(track),
          track,
        );
      }
    }

    function onPrimaryCueChange() {
      logContent("cue-controller onPrimaryCueChange entered", {
        hasATVB: !!window.ATVB,
      });

      const currentTime = getCurrentTime();
      const primaryTrack = getPrimaryTrack();
      const secondaryTrack = getSecondaryTrack();
      const pCue = getCurrentCue(primaryTrack, currentTime);
      const pText = cleanCueText(pCue);
      const sCue = getCurrentCue(secondaryTrack, currentTime);
      const sText = cleanCueText(sCue);

      if (DEBUG_PANEL_PROBE) {
        logContent("cuechange track probe", {
          primaryTrackLanguage: primaryTrack?.language,
          secondaryTrackLanguage: secondaryTrack?.language,
          pText: pText.slice(0, 40),
          sText: sText.slice(0, 40),
        });
      }

      const blockApi = window.ATVB?.subtitleBlocks || {};
      const hasBuildSubtitleBlockSequence =
        typeof blockApi.buildSubtitleBlockSequence === "function";

      if (DEBUG_PANEL_PROBE) {
        logContent("subtitle blocks api snapshot", {
          hasATVB: !!window.ATVB,
          atvbKeys: Object.keys(window.ATVB || {}),
          hasSubtitleBlocks: !!window.ATVB?.subtitleBlocks,
          hasBuildSubtitleBlockSequence,
        });
      }

      let blockResult = null;

      if (hasBuildSubtitleBlockSequence) {
        blockResult = blockApi.buildSubtitleBlockSequence({
          primaryCues: getPrimaryTrackCues(),
          secondaryCues: getSecondaryTrackCues(),
          now: currentTime,
          previousBlocks: getPreviousSubtitleBlocks(),
          cleanCueText,
          rebuildReason: "onPrimaryCueChange",
        });

        setSubtitleBlocks(blockResult, "onPrimaryCueChange");
      } else {
        logContent("subtitle blocks api missing", {
          reason: "onPrimaryCueChange",
          hasATVB: !!window.ATVB,
          atvbKeys: Object.keys(window.ATVB || {}),
        });
      }

      const currentBlock =
        getCurrentSubtitleBlockFromSequence(blockResult) || {
          startTime: pCue?.startTime ?? null,
          endTime: pCue?.endTime ?? null,
          primaryText: pText || "",
          secondaryText: sText || "",
          hasPrimarySignal: Boolean(pText),
          hasSecondarySignal: Boolean(sText),
          sourceReason: "onPrimaryCueChange:fallback",
          updatedAt: Date.now(),
        };

      /* truth blocks から overlay view を解決して描画する。 */
      setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange");

      const overlaySequence = getSubtitleBlockSequence();
      const subtitleViewResolver = root.subtitleViewResolver || null;
      const overlayView =
        subtitleViewResolver &&
        typeof subtitleViewResolver.resolveUiSubtitleView === "function"
          ? subtitleViewResolver.resolveUiSubtitleView(
              overlaySequence?.blocks,
              overlaySequence?.currentIndex,
              overlaySequence?.meta,
            )
          : null;

      if (overlayView) {
        updateOverlayFromView(overlayView);
      } else {
        updateOverlayFromBlock(currentBlock);
      }

      if (secondaryTrack) {
        renderSecondarySubtitle(sText, secondaryTrack);
      }

      renderPanel();
    }

    return {
      getBoundSecondaryTrack,
      unbindSecondarySubtitleTrack,
      bindSecondarySubtitleTrack,
      syncSecondarySubtitleTrack,
      onCueChange,
      onPrimaryCueChange,
    };
  }

  root.cueController = {
    createCueController,
  };
})();

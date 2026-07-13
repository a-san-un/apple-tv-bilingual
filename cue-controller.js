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
    DEBUG_PANEL_PROBE,
    renderSecondarySubtitle,
    updateCueOverlay,
    appendCueHistory,
    renderCuePanel,
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

      updateCueOverlay();
      appendCueHistory();
      renderCuePanel();

      if (track) {
        renderSecondarySubtitle(getCurrentCueText(track), track);
      }
    }

    function bindSecondarySubtitleTrack(track) {
      if (!track) return;

      unbindSecondarySubtitleTrack();

      try {
        track.mode = "showing";
      } catch (_) {}

      if (DEBUG_SECONDARY_SUBS) {
        logContent("secondary track forced to showing", {
          trackLanguage: track?.language || "",
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
    ) {
      if (!video) return;

      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary sync",
          getSecondaryTrackDebugPayload(requestedLang, secondaryTrackBound),
        );
      }

      const track = resolveSecondarySubtitleTrack(video, requestedLang);

      if (!track) {
        unbindSecondarySubtitleTrack();
        (renderSecondarySubtitleOverride || renderSecondarySubtitle)("", null);
        return;
      }

      if (secondaryTrackBound !== track) {
        bindSecondarySubtitleTrack(track);
        return;
      }

      (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
        getCurrentCueText(track),
        track,
      );
    }

    function onPrimaryCueChange() {
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

      updateCueOverlay(pText, sText);
      appendCueHistory(pCue, pText, sText);
      renderCuePanel(sText);
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

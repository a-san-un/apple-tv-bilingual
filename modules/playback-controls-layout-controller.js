// modules/playback-controls-layout-controller.js
(function () {
  "use strict";

  function createLayoutController(deps) {
    const {
      playbackControlsLayoutApi,
      logContent,
      requestAnimationFrame:
        requestAnimationFrameFn = window.requestAnimationFrame.bind(window),
      cancelAnimationFrame:
        cancelAnimationFrameFn = window.cancelAnimationFrame.bind(window),
      setTimeout: setTimeoutFn = window.setTimeout.bind(window),
      clearTimeout: clearTimeoutFn = window.clearTimeout.bind(window),
    } = deps || {};

    const { adjustPlaybackControlsForPanel, clearPlaybackControlsTransforms } =
      playbackControlsLayoutApi || {};

    const layoutState = {
      panelOpen: false,
      playbackControlsRafId: 0,
      playbackControlsApplying: false,
      playbackControlsRetryTimers: [],
      controlSettlingTimers: [],
    };

    function clearPlaybackControlRetryTimers() {
      if (!layoutState.playbackControlsRetryTimers.length) return;
      layoutState.playbackControlsRetryTimers.forEach((timerId) => {
        clearTimeoutFn(timerId);
      });
      layoutState.playbackControlsRetryTimers = [];
    }

    function clearControlSettlingTimers() {
      if (!layoutState.controlSettlingTimers.length) return;
      layoutState.controlSettlingTimers.forEach((timerId) => {
        clearTimeoutFn(timerId);
      });
      layoutState.controlSettlingTimers = [];
    }

    function resolvePanelLayoutTargets() {
      const opaqueVideoContainer =
        document.querySelector(".video-container.svelte-1psbnd5.is-opaque") ||
        document.querySelector(".video-container.is-opaque") ||
        document.querySelector(".video-container");

      return {
        vc: document.querySelector(".video-player__video-container"),
        content: document.querySelector(".video-player__content"),
        htmlVideo: document.querySelector("video"),
        opaqueVideoContainer,
        backgroundVideo: document.querySelector(".background-video"),
      };
    }

    function applyPanelLayoutToTargets(targets, visible) {
      const { vc, content, htmlVideo, opaqueVideoContainer, backgroundVideo } =
        targets || {};

      if (visible) {
        if (vc) {
          vc.style.width = "70%";
          vc.style.maxWidth = "70%";
          vc.style.flexShrink = "0";
          vc.style.marginRight = "";
        }
        if (content) {
          content.style.width = "";
          content.style.maxWidth = "";
          content.style.flexShrink = "";
          content.style.marginRight = "";
        }
        if (htmlVideo) {
          htmlVideo.style.maxWidth = "100%";
        }
        if (opaqueVideoContainer) {
          opaqueVideoContainer.style.right = "30%";
        }
        if (backgroundVideo) {
          backgroundVideo.style.right = "30%";
        }
      } else {
        if (vc) {
          vc.style.width = "";
          vc.style.maxWidth = "";
          vc.style.flexShrink = "";
          vc.style.marginRight = "";
        }
        if (content) {
          content.style.width = "";
          content.style.maxWidth = "";
          content.style.flexShrink = "";
          content.style.marginRight = "";
        }
        if (htmlVideo) {
          htmlVideo.style.maxWidth = "";
        }
        if (opaqueVideoContainer) {
          opaqueVideoContainer.style.right = "";
        }
        if (backgroundVideo) {
          backgroundVideo.style.right = "";
        }
      }
    }

    function runAdjustPlaybackControls(runReason) {
      if (typeof adjustPlaybackControlsForPanel !== "function") return;
      if (layoutState.playbackControlsRafId) return;

      layoutState.playbackControlsRafId = requestAnimationFrameFn(() => {
        layoutState.playbackControlsRafId = 0;

        if (layoutState.playbackControlsApplying) return;

        layoutState.playbackControlsApplying = true;
        try {
          adjustPlaybackControlsForPanel(runReason);
        } finally {
          layoutState.playbackControlsApplying = false;
        }
      });
    }

    function scheduleAdjustPlaybackControls(
      reason = "unknown",
      retryDelays = [],
      options = {},
    ) {
      if (typeof adjustPlaybackControlsForPanel !== "function") return;

      const immediate = options.immediate !== false;

      clearPlaybackControlRetryTimers();

      if (immediate) {
        runAdjustPlaybackControls(reason);
      }

      retryDelays.forEach((delayMs) => {
        const timerId = setTimeoutFn(() => {
          runAdjustPlaybackControls(`${reason}-retry-${delayMs}`);
        }, delayMs);
        layoutState.playbackControlsRetryTimers.push(timerId);
      });
    }

    function scheduleControlSettlingBurst(
      reason = "unknown",
      delays = [180, 420, 800, 1300, 1900, 2700, 3800],
    ) {
      clearControlSettlingTimers();

      delays.forEach((delayMs) => {
        const timerId = setTimeoutFn(() => {
          if (!layoutState.panelOpen) return;

          scheduleAdjustPlaybackControls(`${reason}-settle-${delayMs}`, [], {
            immediate: true,
          });
        }, delayMs);
        layoutState.controlSettlingTimers.push(timerId);
      });
    }

    function initForPanelOpen(initialVisible) {
      layoutState.panelOpen = !!initialVisible;
    }

    function onPanelVisibilityChanged(isVisible, options = {}) {
      const {
        reason = "panelVisibilityChanged",
        retryDelays = isVisible ? [700, 1600] : [],
        immediate = !isVisible,
        settlingDelays = [180, 420, 900, 1500],
      } = options;

      layoutState.panelOpen = !!isVisible;

      scheduleAdjustPlaybackControls(reason, retryDelays, { immediate });

      if (layoutState.panelOpen) {
        scheduleControlSettlingBurst(reason, settlingDelays);
      } else {
        clearControlSettlingTimers();
      }

      if (typeof logContent === "function") {
        logContent("layoutController.panelVisibilityChanged", {
          panelOpen: layoutState.panelOpen,
          reason,
          retryDelays,
          immediate,
          settlingDelays,
        });
      }
    }

    function applyPanelLayout(isVisible, options = {}) {
      const {
        reason = "applyLayout",
        retryDelays = isVisible ? [1200] : [],
        immediate = !isVisible,
        settlingDelays = [180, 420, 900, 1500],
      } = options;

      applyPanelLayoutToTargets(resolvePanelLayoutTargets(), !!isVisible);

      onPanelVisibilityChanged(!!isVisible, {
        reason,
        retryDelays,
        immediate,
        settlingDelays,
      });
    }

    function requestPlaybackControlsAdjustment(reason = "unknown", options = {}) {
      const {
        delays = [],
        immediate = true,
        settle = false,
        settleDelays,
      } = options;

      scheduleAdjustPlaybackControls(reason, delays, { immediate });

      if (settle && layoutState.panelOpen) {
        scheduleControlSettlingBurst(reason, settleDelays);
      }
    }

    function teardownPlaybackControlsUi() {
      clearPlaybackControlRetryTimers();
      clearControlSettlingTimers();

      if (layoutState.playbackControlsRafId) {
        cancelAnimationFrameFn(layoutState.playbackControlsRafId);
        layoutState.playbackControlsRafId = 0;
      }

      layoutState.playbackControlsApplying = false;

      if (typeof clearPlaybackControlsTransforms === "function") {
        clearPlaybackControlsTransforms();
      }

      if (false && typeof logContent === "function") {
        logContent("layoutController.teardownPlaybackControlsUi", {
          panelOpen: layoutState.panelOpen,
        });
      }
    }

    return {
      initForPanelOpen,
      onPanelVisibilityChanged,
      applyPanelLayout,
      requestPlaybackControlsAdjustment,
      teardownPlaybackControlsUi,
    };
  }

  const root = (window.ATVB = window.ATVB || {});
  root.createLayoutController = createLayoutController;
})();

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
      panelVisible: false,
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
          if (!layoutState.panelVisible) return;

          scheduleAdjustPlaybackControls(`${reason}-settle-${delayMs}`, [], {
            immediate: true,
          });
        }, delayMs);
        layoutState.controlSettlingTimers.push(timerId);
      });
    }

    function initForPanelVisible(initialVisible) {
      layoutState.panelVisible = !!initialVisible;
    }

    function onPanelVisibilityChanged(isVisible, options = {}) {
      const {
        reason = "panelVisibilityChanged",
        retryDelays = isVisible ? [700, 1600] : [],
        immediate = !isVisible,
        settlingDelays = [180, 420, 900, 1500],
      } = options;

      layoutState.panelVisible = !!isVisible;

      scheduleAdjustPlaybackControls(reason, retryDelays, { immediate });

      if (layoutState.panelVisible) {
        scheduleControlSettlingBurst(reason, settlingDelays);
      } else {
        clearControlSettlingTimers();
      }

      if (typeof logContent === "function") {
        logContent("layoutController.panelVisibilityChanged", {
          panelVisible: layoutState.panelVisible,
          reason,
          retryDelays,
          immediate,
          settlingDelays,
        });
      }
    }

    function requestPlaybackControlsAdjustment(reason = "unknown", options = {}) {
      const {
        delays = [],
        immediate = true,
        settle = false,
        settleDelays,
      } = options;

      scheduleAdjustPlaybackControls(reason, delays, { immediate });

      if (settle && layoutState.panelVisible) {
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

      if (typeof logContent === "function") {
        logContent("layoutController.teardownPlaybackControlsUi", {
          panelVisible: layoutState.panelVisible,
        });
      }
    }

    return {
      initForPanelVisible,
      onPanelVisibilityChanged,
      requestPlaybackControlsAdjustment,
      teardownPlaybackControlsUi,
    };
  }

  const root = (window.ATVB = window.ATVB || {});
  root.createLayoutController = createLayoutController;
})();

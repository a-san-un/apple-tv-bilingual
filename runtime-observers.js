(() => {
  const root = (window.ATVB = window.ATVB || {});
  const PLAYBACK_LAYOUT_OBSERVER_SELECTOR =
    ".video-player__header, .video-player__controls, .video-player__progress, .video-player__footer, .unified-controls, amp-volume-control-unified, .video-player__video-container, #atv-panel-host";

  function createRuntimeObservers({
    state,
    logContent,
    getPlaybackContext,
    getPlaybackControlsLayoutTargets,
    scheduleAdjustPlaybackControls,
    scheduleControlSettlingBurst,
  }) {
    let playbackControlsMutationObserver = null;
    let playbackControlsResizeObserver = null;
    const playbackControlsResizeTargets = new Set();
    let playbackControlsResizeHandler = null;
    let playbackControlsOrientationHandler = null;
    let waitTimer = null;
    function getVideoAndDialog() {
      const ctx = getPlaybackContext();
      if (!ctx.isPlaybackReady) return null;

      const resolvedDialog =
        ctx.playbackDialog || ctx.playbackView?.closest("dialog") || null;

      return {
        video: ctx.video,
        dialog: resolvedDialog,
      };
    }

    function refreshPlaybackControlResizeObserverTargets() {
      const ro = playbackControlsResizeObserver;
      if (!ro) return;

      const { panel, footer, unified, volume, video } =
        getPlaybackControlsLayoutTargets();
      const targets = [panel, footer, unified, volume, video].filter(Boolean);

      for (const target of targets) {
        if (playbackControlsResizeTargets.has(target)) continue;
        ro.observe(target);
        playbackControlsResizeTargets.add(target);
      }

      for (const prev of [...playbackControlsResizeTargets]) {
        if (targets.includes(prev) && prev.isConnected) continue;
        ro.unobserve(prev);
        playbackControlsResizeTargets.delete(prev);
      }
    }
    function waitForVideo(cb) {
      const check = () => {
        const found = getVideoAndDialog();
        if (found) {
          state.dialogEl = found.dialog;
          logContent("waitForVideo resolved", {
            hasVideo: true,
            trackCount: found.video.textTracks.length,
            injectedIntoDialog: Boolean(found.dialog),
          });
          cb(found.video);
          return;
        }

        waitTimer = window.setTimeout(check, 500);
      };

      if (waitTimer) {
        clearTimeout(waitTimer);
      }

      check();
    }


    function stopPlaybackControlLayoutObservers() {
      if (playbackControlsMutationObserver) {
        playbackControlsMutationObserver.disconnect();
        playbackControlsMutationObserver = null;
      }

      if (playbackControlsResizeObserver) {
        playbackControlsResizeObserver.disconnect();
        playbackControlsResizeObserver = null;
      }

      playbackControlsResizeTargets.clear();

      if (playbackControlsResizeHandler) {
        window.removeEventListener("resize", playbackControlsResizeHandler);
        playbackControlsResizeHandler = null;
      }

      if (playbackControlsOrientationHandler) {
        window.removeEventListener(
          "orientationchange",
          playbackControlsOrientationHandler,
        );
        playbackControlsOrientationHandler = null;
      }
    }

    function startPlaybackControlLayoutObservers() {
      const schedulePlaybackLayoutRefresh = (
        reason = "unknown",
        options = {},
      ) => {
        if (!state.panelVisible) return;

        refreshPlaybackControlResizeObserverTargets();
        scheduleAdjustPlaybackControls(
          reason,
          options.retryDelays || [160, 420],
          {
            immediate: options.immediate !== false,
          },
        );

        if (options.settle !== false) {
          scheduleControlSettlingBurst(
            reason,
            options.settleDelays || [180, 520, 1100],
          );
        }
      };

      if (!playbackControlsResizeHandler) {
        playbackControlsResizeHandler = () => {
          schedulePlaybackLayoutRefresh("window_resize", {
            retryDelays: [120, 320, 700],
            settleDelays: [180, 520, 1100, 1800],
          });
        };
        window.addEventListener("resize", playbackControlsResizeHandler, {
          passive: true,
        });
      }

      if (!playbackControlsOrientationHandler) {
        playbackControlsOrientationHandler = () => {
          schedulePlaybackLayoutRefresh("orientation_change", {
            retryDelays: [120, 320, 700],
            settleDelays: [180, 520, 1100, 1800],
          });
        };
        window.addEventListener(
          "orientationchange",
          playbackControlsOrientationHandler,
        );
      }

      if (
        typeof ResizeObserver !== "undefined" &&
        !playbackControlsResizeObserver
      ) {
        playbackControlsResizeObserver = new ResizeObserver(() => {
          schedulePlaybackLayoutRefresh("playback_resize_observer", {
            retryDelays: [120, 320],
            settle: false,
          });
        });
      }

      if (!playbackControlsMutationObserver) {
        const mutationRoot = state.dialogEl || document.body;
        if (mutationRoot) {
          playbackControlsMutationObserver = new MutationObserver(
            (mutations) => {
              if (!state.panelVisible) return;

              const hasRelevantMutation = mutations.some((mutation) => {
                const target = mutation.target;
                if (!(target instanceof Element))
                  return mutation.type === "childList";

                return (
                  target.matches?.(PLAYBACK_LAYOUT_OBSERVER_SELECTOR) ||
                  target.closest?.(PLAYBACK_LAYOUT_OBSERVER_SELECTOR)
                );
              });

              if (!hasRelevantMutation) return;

              schedulePlaybackLayoutRefresh("playback_mutation_observer", {
                retryDelays: [120, 320, 700],
                settle: false,
              });
            },
          );

          playbackControlsMutationObserver.observe(mutationRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class", "hidden", "aria-hidden"],
          });
        }
      }

      refreshPlaybackControlResizeObserverTargets();
    }

    function stopAll() {
      // waitForVideo の再試行タイマーを解除
      if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
      // MutationObserver / ResizeObserver / イベントリスナーを解除
      stopPlaybackControlLayoutObservers();
    }

    return {
      waitForVideo,
      refreshPlaybackControlResizeObserverTargets,
      startPlaybackControlLayoutObservers,
      stopPlaybackControlLayoutObservers,
      stopAll,
    };
  }

  root.runtimeObservers = {
    createRuntimeObservers,
  };
})();

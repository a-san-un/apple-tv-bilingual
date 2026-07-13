(() => {
  const root = (window.ATVB = window.ATVB || {});
  const PLAYBACK_LAYOUT_OBSERVER_SELECTOR =
    ".video-player__header, .video-player__controls, .video-player__progress, .video-player__footer, .unified-controls, amp-volume-control-unified, .video-player__video-container, #atv-panel-host";

  function createRuntimeObservers({
    state,
    getPlaybackControlsLayoutTargets,
    scheduleAdjustPlaybackControls,
    scheduleControlSettlingBurst,
  }) {
    function refreshPlaybackControlResizeObserverTargets() {
      const ro = state.playbackControlsResizeObserver;
      if (!ro) return;

      const { panel, footer, unified, volume, video } =
        getPlaybackControlsLayoutTargets();
      const targets = [panel, footer, unified, volume, video].filter(Boolean);

      for (const target of targets) {
        if (state.playbackControlsResizeTargets.has(target)) continue;
        ro.observe(target);
        state.playbackControlsResizeTargets.add(target);
      }

      for (const prev of [...state.playbackControlsResizeTargets]) {
        if (targets.includes(prev) && prev.isConnected) continue;
        ro.unobserve(prev);
        state.playbackControlsResizeTargets.delete(prev);
      }
    }

    function stopPlaybackControlLayoutObservers() {
      if (state.playbackControlsMutationObserver) {
        state.playbackControlsMutationObserver.disconnect();
        state.playbackControlsMutationObserver = null;
      }

      if (state.playbackControlsResizeObserver) {
        state.playbackControlsResizeObserver.disconnect();
        state.playbackControlsResizeObserver = null;
      }

      state.playbackControlsResizeTargets.clear();

      if (state.playbackControlsResizeHandler) {
        window.removeEventListener("resize", state.playbackControlsResizeHandler);
        state.playbackControlsResizeHandler = null;
      }

      if (state.playbackControlsOrientationHandler) {
        window.removeEventListener(
          "orientationchange",
          state.playbackControlsOrientationHandler,
        );
        state.playbackControlsOrientationHandler = null;
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

      if (!state.playbackControlsResizeHandler) {
        state.playbackControlsResizeHandler = () => {
          schedulePlaybackLayoutRefresh("window_resize", {
            retryDelays: [120, 320, 700],
            settleDelays: [180, 520, 1100, 1800],
          });
        };
        window.addEventListener("resize", state.playbackControlsResizeHandler, {
          passive: true,
        });
      }

      if (!state.playbackControlsOrientationHandler) {
        state.playbackControlsOrientationHandler = () => {
          schedulePlaybackLayoutRefresh("orientation_change", {
            retryDelays: [120, 320, 700],
            settleDelays: [180, 520, 1100, 1800],
          });
        };
        window.addEventListener(
          "orientationchange",
          state.playbackControlsOrientationHandler,
        );
      }

      if (
        typeof ResizeObserver !== "undefined" &&
        !state.playbackControlsResizeObserver
      ) {
        state.playbackControlsResizeObserver = new ResizeObserver(() => {
          schedulePlaybackLayoutRefresh("playback_resize_observer", {
            retryDelays: [120, 320],
            settle: false,
          });
        });
      }

      if (!state.playbackControlsMutationObserver) {
        const mutationRoot = state.dialogEl || document.body;
        if (mutationRoot) {
          state.playbackControlsMutationObserver = new MutationObserver(
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

          state.playbackControlsMutationObserver.observe(mutationRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class", "hidden", "aria-hidden"],
          });
        }
      }

      refreshPlaybackControlResizeObserverTargets();
    }

    return {
      refreshPlaybackControlResizeObserverTargets,
      startPlaybackControlLayoutObservers,
      stopPlaybackControlLayoutObservers,
    };
  }

  root.runtimeObservers = {
    createRuntimeObservers,
  };
})();

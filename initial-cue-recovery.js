// =============================================================
// Apple TV+ Bilingual Subtitles - initial-cue-recovery.js
// version: 1.2.1
// Role:
// - attach / rebind / large-seek 直後の initial cue recovery を調停する
// - event-driven + delayed retry で recovery 完了条件を満たすまで待つ
// - recovery 完了条件は「primary を含む current snapshot が render 可能」で統一する
//
// Scope
// - large-seek 向け one-shot dispatch
// - attach / rebind 向け schedule / clear / listener binding / delayed retry
//
// Non-goals
// - missCount / termination 判定（periodic sync 側の責務）
// - history truth の更新本体
// - panel / overlay 独自 policy の決定
// =============================================================

(function () {
  "use strict";

  const root = window.ATVB || (window.ATVB = {});

  function createInitialCueRecovery(deps = {}) {
    const { state = null, cueController = null, services = {} } = deps;

    const {
      logContent = () => {},
      getTrackActiveCuesLength = () => 0,
      getCurrentCueText = () => "",
      requestSnapshotRefresh = () => {},
      getCurrentSubtitleView = () => null,
    } = services;

    function clearTimers() {
      if (!state?.initialCueRecoveryTimers?.length) return;
      state.initialCueRecoveryTimers.forEach((timerId) => clearTimeout(timerId));
      state.initialCueRecoveryTimers = [];
    }

    function clearCleanup() {
      if (!state?.initialCueRecoveryCleanup?.length) return;
      state.initialCueRecoveryCleanup.forEach((cleanup) => {
        try {
          cleanup();
        } catch (_) {}
      });
      state.initialCueRecoveryCleanup = [];
    }

    function clear() {
      clearTimers();
      clearCleanup();
    }

    function hasRecoverableInitialCue() {
      const video = state?.video || null;
      const primaryTrack = state?.primaryTrack || null;
      const secondaryTrack = state?.secondaryTrack || null;
      const boundSecondaryTrack =
        cueController?.getBoundSecondaryTrack?.() || null;
      const currentTime = video?.currentTime ?? 0;

      const primaryActiveCues = getTrackActiveCuesLength(primaryTrack);
      const secondaryActiveCues = getTrackActiveCuesLength(secondaryTrack);
      const boundSecondaryActiveCues =
        getTrackActiveCuesLength(boundSecondaryTrack);

      const primaryCueText = primaryTrack
        ? getCurrentCueText(primaryTrack, currentTime)
        : "";
      const secondaryCueText = secondaryTrack
        ? getCurrentCueText(secondaryTrack, currentTime)
        : "";
      const boundSecondaryCueText = boundSecondaryTrack
        ? getCurrentCueText(boundSecondaryTrack, currentTime)
        : "";

      const hasPrimarySignal =
        primaryActiveCues > 0 || Boolean(String(primaryCueText || "").trim());

      const hasSecondarySignal =
        secondaryActiveCues > 0 ||
        boundSecondaryActiveCues > 0 ||
        Boolean(String(secondaryCueText || "").trim()) ||
        Boolean(String(boundSecondaryCueText || "").trim());

      const snapshot = getCurrentSubtitleView?.() || null;
      const snapshotHasPrimary = Boolean(
        String(
          snapshot?.currentBlock?.primaryText ||
            snapshot?.current?.primaryText ||
            snapshot?.primaryText ||
            "",
        ).trim(),
      );

      return {
        ready: hasPrimarySignal || snapshotHasPrimary,
        hasPrimarySignal,
        hasSecondarySignal,
        snapshotHasPrimary,
        primaryActiveCues,
        secondaryActiveCues,
        boundSecondaryActiveCues,
      };
    }

    function tryRender(reason = "unknown") {
      const readiness = hasRecoverableInitialCue();
      if (!readiness.ready) {
        logContent("initial cue recovery skipped", {
          reason,
          ...readiness,
        });
        return false;
      }

      requestSnapshotRefresh(`initial_cue_recovery:${reason}`);

      logContent("initial cue recovery render", {
        reason,
        primaryActiveCues: readiness.primaryActiveCues,
        secondaryActiveCues: readiness.secondaryActiveCues,
        boundSecondaryActiveCues: readiness.boundSecondaryActiveCues,
        hasPrimarySignal: readiness.hasPrimarySignal,
        hasSecondarySignal: readiness.hasSecondarySignal,
        snapshotHasPrimary: readiness.snapshotHasPrimary,
      });

      return true;
    }

    function tryComplete(reason, completeRecovery) {
      if (!tryRender(reason)) return false;
      completeRecovery();
      return true;
    }

    function bindListeners(completeRecovery) {
      if (!state) return;

      const attachRecoveryListener = (target, eventName, label) => {
        if (!target || typeof target.addEventListener !== "function") return;

        const onRecoveryEvent = () => {
          tryComplete(`${eventName}:${label}`, completeRecovery);
        };

        target.addEventListener(eventName, onRecoveryEvent);
        state.initialCueRecoveryCleanup.push(() => {
          target.removeEventListener(eventName, onRecoveryEvent);
        });
      };

      const video = state.video || null;
      const primaryTrack = state.primaryTrack || null;
      const secondaryTrack = state.secondaryTrack || null;
      const boundSecondaryTrack =
        cueController?.getBoundSecondaryTrack?.() || null;

      attachRecoveryListener(primaryTrack, "cuechange", "primary");
      attachRecoveryListener(secondaryTrack, "cuechange", "secondary");

      if (boundSecondaryTrack && boundSecondaryTrack !== secondaryTrack) {
        attachRecoveryListener(
          boundSecondaryTrack,
          "cuechange",
          "secondaryBound",
        );
      }

      attachRecoveryListener(video, "timeupdate", "video");
    }

    function scheduleRetries(completeRecovery, isRecovered) {
      if (!state) return;

      const delays = [220, 650, 1300];

      delays.forEach((delayMs) => {
        const timerId = window.setTimeout(() => {
          if (isRecovered()) return;

          const video = state.video || null;
          const primaryTrack = state.primaryTrack || null;
          if (!video || !primaryTrack) return;

          tryComplete(`delay:${delayMs}`, completeRecovery);
        }, delayMs);

        state.initialCueRecoveryTimers.push(timerId);
      });
    }

    function schedule(reason = "attach") {
      clear();

      if (!state) return;

      let recovered = false;
      const completeRecovery = () => {
        if (recovered) return;
        recovered = true;
        clear();
      };
      const isRecovered = () => recovered;

      const readiness = hasRecoverableInitialCue();
      logContent("initial cue recovery scheduled", {
        reason,
        ...readiness,
      });

      bindListeners(completeRecovery);
      scheduleRetries(completeRecovery, isRecovered);
    }

    function dispatch(reason, options = {}) {
      const {
        video,
        requestedSecondaryLang,
        cueController: localCueController,
        forceRebind,
      } = options;

      const effectiveForceRebind = forceRebind ?? reason === "large-seek";
      const syncTarget = localCueController || cueController;

      if (!video || !syncTarget?.syncSecondarySubtitleTrack) {
        logContent("initial-cue-recovery dispatch skipped", {
          reason,
          hasVideo: Boolean(video),
          hasSyncFn:
            typeof syncTarget?.syncSecondarySubtitleTrack === "function",
        });
        return;
      }

      logContent("initial-cue-recovery dispatch", {
        reason,
        forceRebind: effectiveForceRebind,
        requestedSecondaryLang: requestedSecondaryLang || null,
      });

      syncTarget.syncSecondarySubtitleTrack(
        video,
        requestedSecondaryLang,
        undefined,
        {
          forceRebind: effectiveForceRebind,
        },
      );

      logContent("initial-cue-recovery dispatch done", { reason });
    }

    return {
      clear,
      schedule,
      tryRender,
      dispatch,
      hasRecoverableInitialCue,
    };
  }

  root.createInitialCueRecovery = createInitialCueRecovery;
})();
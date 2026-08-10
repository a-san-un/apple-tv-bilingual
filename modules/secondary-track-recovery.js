// =============================================================
// Apple TV+ Bilingual Subtitles - modules/secondary-track-recovery.js
// 役割:
// - cue-controller.js にある secondary track recovery 判定ロジックを
//   段階的に切り出す。
// - Step 7-D 時点では lane state と recovery evaluation をモジュール化する。
// - Step 7-F で cue-controller.js facade からこの module を呼ぶ。
// =============================================================

(() => {
  const root = (window.ATVB = window.ATVB || {});

  /**
   * @param {{
   *   state: object,
   *   logContent?: Function,
   *   getCurrentTime: Function,
   *   getTrackCuesLength: Function,
   *   getTrackActiveCuesLength: Function,
   *   getRequestedSecondaryLanguage?: Function,
   *   DEBUG_SECONDARY_SUBS?: boolean,
   *   SECONDARY_RECOVERY_MISSING_MS?: number,
   *   SECONDARY_RECOVERY_REBIND_MS?: number,
   * }} deps
   */
  function createSecondaryTrackRecovery(deps) {
    const {
      state,
      logContent,
      getCurrentTime,
      getTrackCuesLength,
      getTrackActiveCuesLength,
      getRequestedSecondaryLanguage,
      DEBUG_SECONDARY_SUBS,
      SECONDARY_RECOVERY_MISSING_MS = 1200,
      SECONDARY_RECOVERY_REBIND_MS = 2500,
    } = deps;

    function createLaneState(lane) {
      return {
        lane,
        lastHealthyAt: 0,
        firstMissingAt: 0,
        lastRecoveryAt: 0,
        lastObservationAt: 0,
        consecutiveMissingCount: 0,
        lastMissingReason: "",
      };
    }

    function resetLaneState(laneState) {
      if (!laneState) return;
      laneState.lastHealthyAt = 0;
      laneState.firstMissingAt = 0;
      laneState.lastRecoveryAt = 0;
      laneState.lastObservationAt = 0;
      laneState.consecutiveMissingCount = 0;
      laneState.lastMissingReason = "";
    }

    function ensureSecondaryRecoveryLane() {
      if (!state.secondaryRecoveryLane) {
        state.secondaryRecoveryLane = createLaneState("secondary");
      }
      return state.secondaryRecoveryLane;
    }

    function resetSecondaryRecoveryLane(reason = "manual-reset") {
      const laneState = ensureSecondaryRecoveryLane();
      resetLaneState(laneState);

      if (DEBUG_SECONDARY_SUBS) {
        logContent?.("secondary-track-recovery: reset lane", {
          reason,
          currentTime: getCurrentTime(),
        });
      }
    }

    function updateLaneState(laneState, { now, healthy, isMissing, missingReason = "" }) {
      if (!laneState) return;

      laneState.lastObservationAt = now;

      if (healthy) {
        laneState.lastHealthyAt = now;
        laneState.firstMissingAt = 0;
        laneState.consecutiveMissingCount = 0;
        laneState.lastMissingReason = "";
        return;
      }

      if (isMissing) {
        if (!laneState.firstMissingAt) {
          laneState.firstMissingAt = now;
        }
        laneState.consecutiveMissingCount += 1;
        laneState.lastMissingReason = missingReason || "";
      }
    }

    function getSecondaryTrackObservation(track, prefix = "track") {
      return {
        [`${prefix}Found`]: Boolean(track),
        [`${prefix}Language`]: track?.language || "",
        [`${prefix}Label`]: track?.label || "",
        [`${prefix}Kind`]: track?.kind || "",
        [`${prefix}Mode`]: track?.mode || "",
        [`${prefix}CuesLength`]: getTrackCuesLength(track),
        [`${prefix}ActiveCuesLength`]: getTrackActiveCuesLength(track),
      };
    }

    function _evaluateLaneHealth({
      mergedHealth,
      secondaryTrack,
      sequenceHealth,
      pText,
      sText,
    }) {
      const derived = mergedHealth?.derived || {};
      const runtime = mergedHealth?.runtime || {};
      const sequence = mergedHealth?.sequence || {};

      const primaryHealthy = Boolean(derived.primaryHealthy);
      const secondaryHealthy = Boolean(derived.secondaryHealthy);

      let missingReason = "";

      if (!secondaryTrack) {
        missingReason = "secondary-track-missing";
      } else if (!runtime.secondaryActiveCues && !sText && !sequence.hasCurrentSecondary) {
        missingReason = "secondary-empty";
      } else if (
        primaryHealthy &&
        !secondaryHealthy &&
        Boolean(sequence.currentPairMissingSecondary)
      ) {
        missingReason = "secondary-gap-on-current-pair";
      } else if (primaryHealthy && !secondaryHealthy && !sText) {
        missingReason = "secondary-text-missing";
      }

      return {
        primaryHealthy,
        secondaryHealthy,
        isMissing: Boolean(missingReason),
        missingReason,
        sequenceHealth: sequenceHealth || null,
        currentPrimaryTextLength: pText?.length || 0,
        currentSecondaryTextLength: sText?.length || 0,
      };
    }

    function _evaluateLaneRecovery({
      laneState,
      now,
      laneHealth,
      secondaryTrack,
      mergedHealth,
    }) {
      const missingDuration = laneState.firstMissingAt
        ? Math.max(0, now - laneState.firstMissingAt)
        : 0;

      const timeSinceLastRecovery = laneState.lastRecoveryAt
        ? Math.max(0, now - laneState.lastRecoveryAt)
        : Number.POSITIVE_INFINITY;

      const shouldRecover =
        Boolean(laneHealth.primaryHealthy) &&
        Boolean(laneHealth.isMissing) &&
        missingDuration >= SECONDARY_RECOVERY_MISSING_MS;

      const shouldForceRebind =
        shouldRecover &&
        timeSinceLastRecovery >= SECONDARY_RECOVERY_REBIND_MS &&
        Boolean(
          mergedHealth?.derived?.shouldForceSecondaryRebind ||
          laneState.consecutiveMissingCount >= 2,
        );

      return {
        shouldRecover,
        shouldForceRebind,
        missingDuration,
        timeSinceLastRecovery,
        requestedSecondaryLanguage:
          getRequestedSecondaryLanguage?.() ||
          state.requestedSecondaryLang ||
          state.contentSettings?.secondaryLang ||
          "",
        secondaryTrackObservation: getSecondaryTrackObservation(
          secondaryTrack,
          "secondaryTrack",
        ),
      };
    }

    function evaluateSecondaryRecovery({
      secondaryTrack,
      mergedHealth,
      sequenceHealth,
      pText = "",
      sText = "",
      reason = "unknown",
    }) {
      const now = Date.now();
      const laneState = ensureSecondaryRecoveryLane();

      const laneHealth = _evaluateLaneHealth({
        mergedHealth,
        secondaryTrack,
        sequenceHealth,
        pText,
        sText,
      });

      updateLaneState(laneState, {
        now,
        healthy: laneHealth.secondaryHealthy,
        isMissing: laneHealth.isMissing,
        missingReason: laneHealth.missingReason,
      });

      const recovery = _evaluateLaneRecovery({
        laneState,
        now,
        laneHealth,
        secondaryTrack,
        mergedHealth,
      });

      const payload = {
        reason,
        now,
        currentTime: getCurrentTime(),
        laneState: {
          lane: laneState.lane,
          lastHealthyAt: laneState.lastHealthyAt,
          firstMissingAt: laneState.firstMissingAt,
          lastRecoveryAt: laneState.lastRecoveryAt,
          lastObservationAt: laneState.lastObservationAt,
          consecutiveMissingCount: laneState.consecutiveMissingCount,
          lastMissingReason: laneState.lastMissingReason,
        },
        laneHealth,
        recovery,
      };

      if (recovery.shouldRecover) {
        laneState.lastRecoveryAt = now;
      }

      if (DEBUG_SECONDARY_SUBS) {
        logContent?.("secondary-track-recovery: evaluate", payload);
      }

      return payload;
    }

    return {
      createLaneState,
      resetLaneState,
      resetSecondaryRecoveryLane,
      updateLaneState,
      getSecondaryTrackObservation,
      _evaluateLaneHealth,
      _evaluateLaneRecovery,
      evaluateSecondaryRecovery,
    };
  }

  root.createSecondaryTrackRecovery = createSecondaryTrackRecovery;
})();

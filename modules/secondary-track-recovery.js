// =============================================================
// Apple TV+ Bilingual Subtitles - modules/secondary-track-recovery.js
// 役割:
// - cue-controller.js にある secondary recovery 判定ロジックを
//   既存 contract を維持したままモジュールへ委譲する。
// - laneStates / createLaneState / resetLaneState / updateLaneState /
//   evaluateSecondaryRecovery を公開する。
// =============================================================

(() => {
  const root = (window.ATVB = window.ATVB || {});

  /**
   * @param {{
   *   logContent?: Function,
   *   SECONDARY_RECOVERY_WINDOW_MS?: number,
   *   SECONDARY_FORCE_REBIND_MISS_COUNT?: number,
   *   SECONDARY_RECOVERY_MISS_LIMIT?: number,
   *   SECONDARY_TERMINATED_RETRY_MS?: number,
   *   SECONDARY_RECOVERY_DEBOUNCE_MS?: number,
   * }} deps
   */
  function createSecondaryTrackRecovery(deps = {}) {
    const {
      logContent,
      SECONDARY_RECOVERY_WINDOW_MS = 1000,
      SECONDARY_FORCE_REBIND_MISS_COUNT = 2,
      SECONDARY_RECOVERY_MISS_LIMIT = 8,
      SECONDARY_TERMINATED_RETRY_MS = 10_000,
      SECONDARY_RECOVERY_DEBOUNCE_MS = 200,
    } = deps;

    function createLaneState(lane) {
      return {
        lane,
        healthy: false,
        isMissing: false,
        missingSince: 0,
        missingDurationMs: 0,
        missCount: 0,
        terminated: false,
        lastDecision: "idle",
        lastDecisionAt: 0,
      };
    }

    const laneStates = {
      primary: createLaneState("primary"),
      secondary: createLaneState("secondary"),
    };

    function resetLaneState(laneState) {
      if (!laneState) return;
      laneState.isMissing = false;
      laneState.missingSince = 0;
      laneState.missingDurationMs = 0;
      laneState.missCount = 0;
      laneState.terminated = false;
      laneState.lastDecision = "idle";
      laneState.lastDecisionAt = 0;
    }

    function resetSecondaryRecoveryLane(reason = "manual-reset") {
      const before = {
        missCount: laneStates.secondary?.missCount ?? null,
        terminated: laneStates.secondary?.terminated ?? null,
        missingSince: laneStates.secondary?.missingSince ?? null,
        missingDurationMs: laneStates.secondary?.missingDurationMs ?? null,
        lastDecision: laneStates.secondary?.lastDecision ?? null,
      };

      resetLaneState(laneStates.secondary);

      logContent?.("secondary recovery lane reset", {
        reason,
        before,
        after: {
          missCount: laneStates.secondary?.missCount ?? null,
          terminated: laneStates.secondary?.terminated ?? null,
          missingSince: laneStates.secondary?.missingSince ?? null,
          missingDurationMs: laneStates.secondary?.missingDurationMs ?? null,
          lastDecision: laneStates.secondary?.lastDecision ?? null,
        },
      });

      return laneStates.secondary;
    }

    function updateLaneState(laneState, { now, healthy, isMissing }) {
      laneState.healthy = healthy === true;
      laneState.isMissing = isMissing === true;

      if (!laneState.isMissing) {
        laneState.missingSince = 0;
        laneState.missingDurationMs = 0;
        laneState.missCount = 0;
        laneState.terminated = false;
        laneState.lastDecision = "idle";
        return laneState;
      }

      if (!laneState.missingSince) {
        laneState.missingSince = now;
      }

      laneState.missingDurationMs = Math.max(0, now - laneState.missingSince);
      return laneState;
    }

    function evaluateLaneRecovery({
      laneName,
      laneState,
      now,
      shouldRecover,
      shouldForceRebind,
      recoverReason,
      forceRebindReason,
      observationOnly = false,
    }) {
      if (!laneState) {
        return {
          lane: laneName,
          laneState: null,
          action: "idle",
          reason: "lane_state_missing",
        };
      }

      if (!laneState.isMissing) {
        laneState.lastDecision = "idle";
        laneState.lastDecisionAt = now;
        const result = {
          lane: laneName,
          laneState,
          action: "idle",
          reason: "lane_not_missing",
        };

        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });

        return result;
      }

      if (!shouldRecover) {
        laneState.lastDecision = "idle";
        laneState.lastDecisionAt = now;
        const result = {
          lane: laneName,
          laneState,
          action: "idle",
          reason: observationOnly ? "lane_observation_only" : "lane_waiting_window",
        };

        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });

        return result;
      }

      const msSinceLastDecision =
        laneState.lastDecisionAt > 0
          ? now - laneState.lastDecisionAt
          : Infinity;

      if (msSinceLastDecision < SECONDARY_RECOVERY_DEBOUNCE_MS) {
        laneState.lastDecision = "idle";
        laneState.lastDecisionAt = now;
        const result = {
          lane: laneName,
          laneState,
          action: "idle",
          reason: "lane_recovery_debounce",
        };

        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });

        return result;
      }

      laneState.missCount += 1;

      if (laneState.missCount >= SECONDARY_RECOVERY_MISS_LIMIT) {
        laneState.terminated = true;
        laneState.lastDecision = "terminated";
        laneState.lastDecisionAt = now;

        const result = {
          lane: laneName,
          laneState,
          action: "terminated",
          reason: `${laneName}_recovery_miss_limit`,
        };

        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });

        return result;
      }

      laneState.lastDecision = shouldForceRebind ? "force-rebind" : "recover";
      laneState.lastDecisionAt = now;

      const result = {
        lane: laneName,
        laneState,
        action: observationOnly
          ? "idle"
          : (shouldForceRebind ? "force-rebind" : "recover"),
        reason: shouldForceRebind ? forceRebindReason : recoverReason,
      };

      logContent?.("laneRecoveryDecision", {
        laneName,
        action: result.action,
        reason: result.reason,
        missingDurationMs: laneState.missingDurationMs,
        missCount: laneState.missCount,
      });

      return result;
    }

    function evaluateSecondaryRecovery({
      now,
      runtime,
      currentCue,
      sequence: _sequence,
      derived,
    }) {
      const primaryLane = updateLaneState(laneStates.primary, {
        now,
        healthy: derived?.primaryHealthy === true,
        isMissing: false,
      });

      const secondaryRuntimeMissing =
        derived?.primaryHealthy === true &&
        currentCue?.secondaryTextLength === 0 &&
        runtime?.secondaryTrackFound === true &&
        runtime?.secondaryActiveCues === 0;

      const secondaryRecovered =
        runtime?.secondaryTrackFound === true &&
        (runtime?.secondaryActiveCues > 0 ||
          currentCue?.secondaryTextLength > 0);

      const secondaryLane = updateLaneState(laneStates.secondary, {
        now,
        healthy: secondaryRecovered,
        isMissing: secondaryRuntimeMissing,
      });

      if (secondaryRecovered) {
        resetLaneState(secondaryLane);
      }

      if (!secondaryLane.isMissing) {
        secondaryLane.lastDecision = "idle";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_not_missing",
        };
      }

      if (secondaryLane.terminated && secondaryRuntimeMissing) {
        const msSinceLastDecision =
          secondaryLane.lastDecisionAt > 0
            ? now - secondaryLane.lastDecisionAt
            : Infinity;

        if (msSinceLastDecision >= SECONDARY_TERMINATED_RETRY_MS) {
          resetLaneState(secondaryLane);
          secondaryLane.lastDecision = "idle";
          secondaryLane.lastDecisionAt = now;
          return {
            primaryLane,
            secondaryLane,
            action: "idle",
            reason: "secondary_terminated_retry_reset",
          };
        }
      }

      if (secondaryLane.terminated) {
        secondaryLane.lastDecision = "terminated";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_terminated",
        };
      }

      const shouldRecoverSecondary =
        secondaryLane.missingDurationMs >= SECONDARY_RECOVERY_WINDOW_MS &&
        (derived?.shouldRecoverSecondary === true || secondaryLane.isMissing);

      if (!shouldRecoverSecondary) {
        secondaryLane.lastDecision = "idle";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_missing_waiting_window",
        };
      }

      const msSinceLastMiss =
        secondaryLane.lastDecisionAt > 0
          ? now - secondaryLane.lastDecisionAt
          : Infinity;

      if (msSinceLastMiss < SECONDARY_RECOVERY_DEBOUNCE_MS) {
        secondaryLane.lastDecision = "idle";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_recovery_debounce",
        };
      }

      secondaryLane.missCount += 1;

      if (
        secondaryLane.missCount >= SECONDARY_RECOVERY_MISS_LIMIT &&
        derived?.shouldRecoverSecondary !== true
      ) {
        secondaryLane.terminated = true;
        secondaryLane.lastDecision = "terminated";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_miss_limit",
        };
      }

      const shouldForceSecondaryRebind =
        derived?.shouldForceSecondaryRebind === true ||
        secondaryLane.missCount >= SECONDARY_FORCE_REBIND_MISS_COUNT;

      secondaryLane.lastDecision = shouldForceSecondaryRebind
        ? "force-rebind"
        : "recover";
      secondaryLane.lastDecisionAt = now;

      return {
        primaryLane,
        secondaryLane,
        action: secondaryLane.lastDecision,
        reason: shouldForceSecondaryRebind
          ? "secondary_force_rebind_after_repeated_miss"
          : "secondary_current_missing_with_primary_present",
      };
    }

    return {
      laneStates,
      createLaneState,
      resetLaneState,
      resetSecondaryRecoveryLane,
      updateLaneState,
      evaluateLaneRecovery,
      evaluateSecondaryRecovery,
    };
  }

  root.secondaryTrackRecovery = root.secondaryTrackRecovery || {};
  root.secondaryTrackRecovery.createSecondaryTrackRecovery =
    createSecondaryTrackRecovery;
})();

// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-recovery-manager.js
// 役割:
// - subtitle health snapshot を受け取り、復旧アクションを決定する。
// - Step 2 では both-missing recovery と cooldown のみを担当する。
// - DOM / TextTrack を保持せず、軽量な内部状態だけを持つ。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * @param {{
   *   logContent?: Function,
   *   cooldownMs?: number,
   * }} deps
   */
  function createSubtitleRecoveryManager(deps = {}) {
    const {
      logContent,
      cooldownMs = 4000,
      secondaryTrackRecovery = null,
    } = deps;

    let lastBothMissingRecoveryAttemptAt = 0;

    function reset(reason = "manual-reset") {
      const before = {
        lastBothMissingRecoveryAttemptAt,
      };

      lastBothMissingRecoveryAttemptAt = 0;

      logContent?.("subtitle recovery manager reset", {
        reason,
        before,
        after: {
          lastBothMissingRecoveryAttemptAt,
        },
      });
    }

    function dispose() {
      reset("dispose");
      secondaryTrackRecovery?.resetSecondaryRecoveryLane?.(
        "subtitle_recovery_manager_dispose",
      );
      secondaryTrackRecovery?.destroy?.();
    }

    function evaluateBothMissingRecovery({
      now,
      extensionEnabled = true,
      trackCount = 0,
      snapshot = null,
    } = {}) {
      const hasPrimaryLiveSignal =
        snapshot?.hasPrimaryLiveSignal === true;
      const hasSecondarySignal =
        snapshot?.hasSecondarySignal === true;

      const shouldAttemptRecovery =
        extensionEnabled &&
        !hasPrimaryLiveSignal &&
        !hasSecondarySignal &&
        trackCount > 1;

      if (!shouldAttemptRecovery) {
        if (hasPrimaryLiveSignal || hasSecondarySignal || !extensionEnabled) {
          lastBothMissingRecoveryAttemptAt = 0;
        }

        return {
          health: "healthy",
          action: "noop",
          reason: "both_missing_not_applicable",
          cooldownActive: false,
          lastBothMissingRecoveryAttemptAt,
        };
      }

      if (
        lastBothMissingRecoveryAttemptAt > 0 &&
        now - lastBothMissingRecoveryAttemptAt < cooldownMs
      ) {
        return {
          health: "both_missing",
          action: "noop",
          reason: "both_missing_cooldown_active",
          cooldownActive: true,
          lastBothMissingRecoveryAttemptAt,
        };
      }

      lastBothMissingRecoveryAttemptAt = now;

      return {
        health: "both_missing",
        action: "reinitialize_pipeline",
        reason: "both_missing_detected",
        cooldownActive: false,
        lastBothMissingRecoveryAttemptAt,
      };
    }

    function evaluateSecondaryRecovery({
      now,
      runtime,
      currentCue,
      sequence,
      derived,
    } = {}) {
      if (!secondaryTrackRecovery?.evaluateSecondaryRecovery) {
        return {
          primaryLane: null,
          secondaryLane: null,
          action: "idle",
          reason: "secondary_recovery_module_unavailable",
        };
      }

      const safeDerived = {
        ...derived,
        shouldRecoverSecondary: derived?.shouldRecoverSecondary === true,
        shouldForceSecondaryRebind:
          derived?.shouldForceSecondaryRebind === true,
      };

      return secondaryTrackRecovery.evaluateSecondaryRecovery({
        now,
        runtime,
        currentCue,
        sequence,
        derived: safeDerived,
      });
    }

    function resetSecondaryRecovery(reason = "manual-reset") {
      return secondaryTrackRecovery?.resetSecondaryRecoveryLane?.(reason) ?? null;
    }

    function getLaneStates() {
      const laneStates = secondaryTrackRecovery?.laneStates;
      if (!laneStates) return null;

      return {
        primaryLane: laneStates.primaryLane
          ? {
              missCount: laneStates.primaryLane.missCount ?? 0,
              lastSeenAt: laneStates.primaryLane.lastSeenAt ?? 0,
              lastRecoveryAt: laneStates.primaryLane.lastRecoveryAt ?? 0,
              status: laneStates.primaryLane.status ?? "",
            }
          : null,
        secondaryLane: laneStates.secondaryLane
          ? {
              missCount: laneStates.secondaryLane.missCount ?? 0,
              lastSeenAt: laneStates.secondaryLane.lastSeenAt ?? 0,
              lastRecoveryAt: laneStates.secondaryLane.lastRecoveryAt ?? 0,
              status: laneStates.secondaryLane.status ?? "",
            }
          : null,
      };
    }

    function markRecoverySucceeded(reason = "recovery_succeeded") {
      lastBothMissingRecoveryAttemptAt = 0;

      logContent?.("subtitle recovery manager success", {
        reason,
        lastBothMissingRecoveryAttemptAt,
      });
    }

    return {
      evaluateBothMissingRecovery,
      evaluateSecondaryRecovery,
      markRecoverySucceeded,
      getLaneStates,
      resetSecondaryRecovery,
      reset,
      dispose,
    };
  }

  root.createSubtitleRecoveryManager = createSubtitleRecoveryManager;
})();

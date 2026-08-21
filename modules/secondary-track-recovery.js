// =============================================================
// Apple TV+ Bilingual Subtitles - modules/secondary-track-recovery.js
// 役割:
// - secondary lane の recovery 判定ロジックをモジュールへ分離する。
// - laneStates / createLaneState / resetLaneState / updateLaneState /
//   evaluateSecondaryRecovery を公開する。
// - runtime missing を観測し、recover / force-rebind / terminated の
//   判定を継続失敗ベースで行う。
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

    /**
     * lane ごとの recovery 観測状態を初期化して返す。
     * missing 開始時刻、継続時間、missCount、terminated 状態をまとめて持つ。
     */
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

    /**
     * 1 つの laneState を初期化する。
     * missing 継続情報、missCount、terminated、直前 decision をクリアする。
     */
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

    /**
     * secondary lane を手動リセットし、前後状態をログへ残す。
     * dispose や明示的な recovery lane 初期化で使う。
     */
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

    /**
     * lane の health / missing 状態を更新する。
     * missing 中は開始時刻と継続時間を伸ばし、非 missing へ戻ったら観測状態をクリアする。
     */
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

    /**
     * 汎用 lane recovery 判定。
     * 現状の secondary recovery 本体では未使用だが、
     * lane 単位の decision 形式を揃える補助として残している。
     */
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
        laneState.lastDecisionAt > 0 ? now - laneState.lastDecisionAt : Infinity;

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

      if (
        laneState.missCount >= SECONDARY_RECOVERY_MISS_LIMIT &&
        !shouldForceRebind
      ) {
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
        action: laneState.lastDecision,
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

    /**
     * secondary lane の runtime missing を観測し、
     * recover / force-rebind / terminated を決定する。
     *
     * controller 側の recovery 要求があっても、
     * secondary lane の継続 missing を満たした場合だけ昇格させる。
     */
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

      // primary が healthy で、secondary track は見つかっているが
      // active cue / current text が見えない状態を runtime missing とみなす。
      const secondaryRuntimeMissing =
        derived?.primaryHealthy === true &&
        currentCue?.secondaryTextLength === 0 &&
        runtime?.secondaryTrackFound === true &&
        runtime?.secondaryActiveCues === 0;

      // active cue または current text が戻ったら secondary recovered とみなす。
      const secondaryRecovered =
        runtime?.secondaryTrackFound === true &&
        (runtime?.secondaryActiveCues > 0 ||
          currentCue?.secondaryTextLength > 0);

      const secondaryLane = updateLaneState(laneStates.secondary, {
        now,
        healthy: secondaryRecovered,
        isMissing: secondaryRuntimeMissing,
      });

      // live signal が戻ったら lane state を初期化する。
      if (secondaryRecovered) {
        resetLaneState(secondaryLane);
      }

      // missing でなければ recovery は不要。
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

      // terminated 後の retry 待ち。
      // 一定時間を超えたら lane を初期化して再観測へ戻す。
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

      // terminated 中は recovery action を返さず待機する。
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

      // secondary lane が一定時間 missing を継続していることを
      // recovery / force-rebind の前提条件にする。
      const hasContinuedFailure =
        secondaryLane.missingDurationMs >= SECONDARY_RECOVERY_WINDOW_MS;

      const shouldRecoverSecondary =
        hasContinuedFailure && derived?.shouldRecoverSecondary === true;

      if (!shouldRecoverSecondary) {
        secondaryLane.lastDecision = "idle";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: hasContinuedFailure
            ? "secondary_missing_observation_only"
            : "secondary_missing_waiting_window",
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

      // force-rebind は継続失敗が十分に重なったときだけ許可する。
      const shouldForceSecondaryRebind =
        hasContinuedFailure &&
        derived?.shouldForceSecondaryRebind === true &&
        secondaryLane.missCount >= SECONDARY_FORCE_REBIND_MISS_COUNT;

      if (
        secondaryLane.missCount >= SECONDARY_RECOVERY_MISS_LIMIT &&
        !shouldForceSecondaryRebind
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
          : "secondary_recovery_continued_failure",
      };
    }

    /**
     * module 全体の lane state を初期化する。
     * dispose 時や作り直し前の後始末で使う。
     */
    function destroy() {
      resetLaneState(laneStates.primary);
      resetLaneState(laneStates.secondary);
    }

    return {
      laneStates,
      createLaneState,
      resetLaneState,
      resetSecondaryRecoveryLane,
      updateLaneState,
      evaluateLaneRecovery,
      evaluateSecondaryRecovery,
      destroy,
    };
  }

  root.createSecondaryTrackRecovery = createSecondaryTrackRecovery;
})();

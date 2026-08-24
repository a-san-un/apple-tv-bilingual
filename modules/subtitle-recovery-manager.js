// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-recovery-manager.js
// 役割:
// - subtitle health snapshot を受け取り、復旧アクションを決定する。
// - both-missing recovery の判定と cooldown を担当する。
// - secondary recovery 判定は lane-recovery-state.js へ委譲する。
// - DOM / TextTrack を保持せず、軽量な内部状態だけを持つ。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * subtitle health snapshot から復旧アクションを決定するインスタンスを生成する。
   * @param {{
   *   logContent?: Function,
   *   cooldownMs?: number,
   *   laneRecoveryState?: {
   *     evaluateSecondaryRecovery?: Function,
   *     resetSecondaryRecoveryLane?: Function,
   *     destroy?: Function,
   *     laneStates?: Object,
   *   } | null,
   * }} deps
   */
  function createSubtitleRecoveryManager(deps = {}) {
    const {
      logContent,
      cooldownMs = 4000,
      laneRecoveryState = null,
    } = deps;

    let lastBothMissingRecoveryAttemptAt = 0;

    // -------------------------------------------------------
    // リセット
    // -------------------------------------------------------

    /**
     * manager 内部状態を初期化する。
     * both-missing recovery の最後の試行時刻をクリアする。
     */
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

    // -------------------------------------------------------
    // 破棄
    // -------------------------------------------------------

    /**
     * manager の後始末を行う。
     * both-missing 状態をリセットし、lane-recovery-state.js 側の
     * lane state もあわせて破棄する。
     */
    function dispose() {
      reset("dispose");
      laneRecoveryState?.resetSecondaryRecoveryLane?.(
        "subtitle_recovery_manager_dispose",
      );
      laneRecoveryState?.destroy?.();
    }

    // -------------------------------------------------------
    // both-missing recovery 判定
    // -------------------------------------------------------

    /**
     * primary / secondary の両方に live signal が見えないときだけ
     * pipeline 再初期化を試みる。
     * cooldown 中は noop を返す。
     */
    function evaluateBothMissingRecovery({
      now,
      extensionEnabled = true,
      trackCount = 0,
      snapshot = null,
    } = {}) {
      const hasPrimaryLiveSignal = snapshot?.hasPrimaryLiveSignal === true;
      const hasSecondarySignal = snapshot?.hasSecondarySignal === true;

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

    // -------------------------------------------------------
    // secondary recovery 判定への委譲
    // -------------------------------------------------------

    /**
     * secondary recovery 判定は lane-recovery-state.js へ委譲する。
     * manager 側では derived の recovery フラグを boolean に正規化して渡すだけに留める。
     */
    function evaluateSecondaryRecovery({
      now,
      runtime,
      currentCue,
      sequence,
      derived,
    } = {}) {
      if (!laneRecoveryState?.evaluateSecondaryRecovery) {
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

      return laneRecoveryState.evaluateSecondaryRecovery({
        now,
        runtime,
        currentCue,
        sequence,
        derived: safeDerived,
      });
    }

    // -------------------------------------------------------
    // secondary lane リセット
    // -------------------------------------------------------

    /**
     * secondary lane の recovery 観測状態だけを明示的に初期化する。
     * track 切替や pipeline 再作成後の cleanup で使う。
     */
    function resetSecondaryRecovery(reason = "manual-reset") {
      return laneRecoveryState?.resetSecondaryRecoveryLane?.(reason) ?? null;
    }

    // -------------------------------------------------------
    // lane state snapshot 取得
    // -------------------------------------------------------

    /**
     * lane-recovery-state.js が保持している laneStates を
     * 外部参照しやすい軽量 snapshot に整形して返す。
     *
     * 現在の laneStates shape は
     * { primary, secondary } であり、
     * 各 lane は healthy / isMissing / missingSince / missingDurationMs /
     * missCount / terminated / lastDecision / lastDecisionAt を持つ。
     */
    function getLaneStates() {
      const laneStates = laneRecoveryState?.laneStates;
      if (!laneStates) return null;

      const toLaneSnapshot = (laneState) => {
        if (!laneState) return null;

        return {
          lane: laneState.lane ?? "",
          healthy: laneState.healthy === true,
          isMissing: laneState.isMissing === true,
          missingSince: laneState.missingSince ?? 0,
          missingDurationMs: laneState.missingDurationMs ?? 0,
          missCount: laneState.missCount ?? 0,
          terminated: laneState.terminated === true,
          lastDecision: laneState.lastDecision ?? "idle",
          lastDecisionAt: laneState.lastDecisionAt ?? 0,
        };
      };

      return {
        primary: toLaneSnapshot(laneStates.primary),
        secondary: toLaneSnapshot(laneStates.secondary),
      };
    }

    // -------------------------------------------------------
    // cooldown 解除
    // -------------------------------------------------------

    /**
     * recovery 成功時に both-missing cooldown 状態を解除する。
     * 次回の both-missing 判定を即時に再開できるようにする。
     */
    function markRecoverySucceeded(reason = "recovery_succeeded") {
      lastBothMissingRecoveryAttemptAt = 0;

      logContent?.("subtitle recovery manager success", {
        reason,
        lastBothMissingRecoveryAttemptAt,
      });
    }

    // —————————————————––
    // エクスポート
    // —————————————————––
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

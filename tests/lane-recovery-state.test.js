// =============================================================
// Apple TV+ Bilingual Subtitles - tests/lane-recovery-state.test.js
// 役割:
// - modules/lane-recovery-state.js の primary / secondary lane recovery
//   判定ロジックを検証する。
// - laneStates の初期化、missing 観測、recover / force-rebind / terminated
//   への遷移、terminated からの retry reset を確認する。
// =============================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// -------------------------------------------------------
// module ロード
// -------------------------------------------------------

/**
 * lane-recovery-state.js を動的 import し、
 * window.ATVB.createLaneRecoveryState を取得する。
 */
async function loadFactory() {
  global.window = global.window || {};
  global.window.ATVB = {};

  const moduleUrl = new URL(
    "../modules/lane-recovery-state.js",
    import.meta.url,
  );

  await import(`${moduleUrl.href}?t=${Date.now()}-${Math.random()}`);

  return global.window?.ATVB?.createLaneRecoveryState;
}

// -------------------------------------------------------
// テスト用入力ヘルパー
// -------------------------------------------------------

/**
 * secondary track が見つかっているが cue が来ない missing 状態の入力を作る。
 * 必要に応じて recovery / force-rebind フラグを上書きできる。
 */
function missingInput(
  now,
  {
    shouldRecoverSecondary = false,
    shouldForceSecondaryRebind = false,
    primaryHealthy = true,
  } = {},
) {
  return {
    now,
    runtime: {
      secondaryTrackFound: true,
      secondaryActiveCues: 0,
    },
    currentCue: {
      secondaryTextLength: 0,
    },
    sequence: [],
    derived: {
      primaryHealthy,
      shouldRecoverSecondary,
      shouldForceSecondaryRebind,
    },
  };
}

/**
 * secondary track の cue が戻った recovered 状態の入力を作る。
 */
function recoveredInput(now) {
  return {
    now,
    runtime: {
      secondaryTrackFound: true,
      secondaryActiveCues: 1,
    },
    currentCue: {
      secondaryTextLength: 8,
    },
    sequence: [],
    derived: {
      primaryHealthy: true,
      shouldRecoverSecondary: false,
      shouldForceSecondaryRebind: false,
    },
  };
}

describe("lane-recovery-state", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------
  // 公開 API の確認
  // -------------------------------------------------------

  test("exposes createLaneRecoveryState on window.ATVB", async () => {
    const createLaneRecoveryState = await loadFactory();

    expect(typeof createLaneRecoveryState).toBe("function");
  });

  test("initializes primary and secondary laneStates with the existing lane state shape", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    expect(recovery.laneStates).toEqual({
      primary: {
        lane: "primary",
        healthy: false,
        isMissing: false,
        missingSince: 0,
        missingDurationMs: 0,
        missCount: 0,
        terminated: false,
        lastDecision: "idle",
        lastDecisionAt: 0,
      },
      secondary: {
        lane: "secondary",
        healthy: false,
        isMissing: false,
        missingSince: 0,
        missingDurationMs: 0,
        missCount: 0,
        terminated: false,
        lastDecision: "idle",
        lastDecisionAt: 0,
      },
    });
  });

  test("createLaneState creates an independent lane state", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    const laneState = recovery.createLaneState("custom");

    expect(laneState).toEqual({
      lane: "custom",
      healthy: false,
      isMissing: false,
      missingSince: 0,
      missingDurationMs: 0,
      missCount: 0,
      terminated: false,
      lastDecision: "idle",
      lastDecisionAt: 0,
    });

    expect(laneState).not.toBe(recovery.laneStates.secondary);
  });

  // -------------------------------------------------------
  // updateLaneState の挙動確認
  // -------------------------------------------------------

  test("updateLaneState records a missing duration and resets recovery fields when healthy", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();
    const laneState = recovery.laneStates.secondary;

    recovery.updateLaneState(laneState, {
      now: 100,
      healthy: false,
      isMissing: true,
    });
    recovery.updateLaneState(laneState, {
      now: 700,
      healthy: false,
      isMissing: true,
    });

    expect(laneState).toMatchObject({
      healthy: false,
      isMissing: true,
      missingSince: 100,
      missingDurationMs: 600,
    });

    laneState.missCount = 3;
    laneState.terminated = true;
    laneState.lastDecision = "force-rebind";
    laneState.lastDecisionAt = 700;

    recovery.updateLaneState(laneState, {
      now: 800,
      healthy: true,
      isMissing: false,
    });

    expect(laneState).toMatchObject({
      healthy: true,
      isMissing: false,
      missingSince: 0,
      missingDurationMs: 0,
      missCount: 0,
      terminated: false,
      lastDecision: "idle",
      lastDecisionAt: 700,
    });
  });

  // -------------------------------------------------------
  // evaluateSecondaryRecovery の遷移確認
  // -------------------------------------------------------

  test("waits until the recovery window has elapsed before requesting recovery", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    const first = recovery.evaluateSecondaryRecovery(missingInput(100));
    const waiting = recovery.evaluateSecondaryRecovery(missingInput(1099));

    expect(first).toMatchObject({
      action: "idle",
      reason: "secondary_missing_waiting_window",
    });
    expect(waiting).toMatchObject({
      action: "idle",
      reason: "secondary_missing_waiting_window",
    });

    expect(recovery.laneStates.secondary).toMatchObject({
      isMissing: true,
      missingSince: 100,
      missingDurationMs: 999,
      missCount: 0,
      terminated: false,
    });
  });

  test("returns observation-only until shouldRecoverSecondary becomes true after the recovery window", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    const decision = recovery.evaluateSecondaryRecovery(missingInput(1100));

    expect(decision).toMatchObject({
      action: "idle",
      reason: "secondary_missing_observation_only",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      missCount: 0,
      terminated: false,
      lastDecision: "idle",
      lastDecisionAt: 1100,
    });
  });

  test("requests recovery after the recovery window when shouldRecoverSecondary is enabled", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    const decision = recovery.evaluateSecondaryRecovery(
      missingInput(1100, {
        shouldRecoverSecondary: true,
      }),
    );

    expect(decision).toMatchObject({
      action: "recover",
      reason: "secondary_recovery_continued_failure",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      missCount: 1,
      terminated: false,
      lastDecision: "recover",
      lastDecisionAt: 1100,
    });
  });

  test("uses force-rebind after the repeated-miss threshold when force-rebind is enabled", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(
      missingInput(1100, {
        shouldRecoverSecondary: true,
      }),
    );

    const decision = recovery.evaluateSecondaryRecovery(
      missingInput(1300, {
        shouldRecoverSecondary: true,
        shouldForceSecondaryRebind: true,
      }),
    );

    expect(decision).toMatchObject({
      action: "force-rebind",
      reason: "secondary_force_rebind_after_repeated_miss",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      missCount: 2,
      terminated: false,
      lastDecision: "force-rebind",
      lastDecisionAt: 1300,
    });
  });

  test("debounces a repeated recovery decision within 200 ms without incrementing missCount", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(
      missingInput(1100, {
        shouldRecoverSecondary: true,
      }),
    );

    const decision = recovery.evaluateSecondaryRecovery(
      missingInput(1200, {
        shouldRecoverSecondary: true,
      }),
    );

    expect(decision).toMatchObject({
      action: "idle",
      reason: "secondary_recovery_debounce",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      missCount: 1,
      lastDecision: "idle",
      lastDecisionAt: 1200,
    });
  });

  // -------------------------------------------------------
  // terminated / retry reset の確認
  // -------------------------------------------------------

  test("enters terminated after the recovery miss limit when force-rebind is not enabled", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState({
      SECONDARY_RECOVERY_MISS_LIMIT: 2,
      SECONDARY_RECOVERY_DEBOUNCE_MS: 0,
    });

    recovery.evaluateSecondaryRecovery(missingInput(100));
    const first = recovery.evaluateSecondaryRecovery(
      missingInput(1100, {
        shouldRecoverSecondary: true,
      }),
    );
    const terminated = recovery.evaluateSecondaryRecovery(
      missingInput(1300, {
        shouldRecoverSecondary: true,
      }),
    );

    expect(first).toMatchObject({
      action: "recover",
      reason: "secondary_recovery_continued_failure",
    });
    expect(terminated).toMatchObject({
      action: "terminated",
      reason: "secondary_recovery_miss_limit",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      missCount: 2,
      terminated: true,
      lastDecision: "terminated",
      lastDecisionAt: 1300,
    });
  });

  test("resets a terminated lane after the terminated retry window", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState({
      SECONDARY_RECOVERY_MISS_LIMIT: 1,
      SECONDARY_TERMINATED_RETRY_MS: 10_000,
    });

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(
      missingInput(1100, {
        shouldRecoverSecondary: true,
      }),
    );

    expect(recovery.laneStates.secondary.terminated).toBe(true);

    const retry = recovery.evaluateSecondaryRecovery(
      missingInput(11_100, {
        shouldRecoverSecondary: true,
      }),
    );

    expect(retry).toMatchObject({
      action: "idle",
      reason: "secondary_terminated_retry_reset",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      isMissing: false,
      missingSince: 0,
      missingDurationMs: 0,
      missCount: 0,
      terminated: false,
      lastDecision: "idle",
      lastDecisionAt: 11_100,
    });
  });

  // -------------------------------------------------------
  // 回復・手動リセットの確認
  // -------------------------------------------------------

  test("resets the secondary lane when subtitle cues recover", async () => {
    const createLaneRecoveryState = await loadFactory();
    const recovery = createLaneRecoveryState();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(
      missingInput(1100, {
        shouldRecoverSecondary: true,
      }),
    );

    const decision = recovery.evaluateSecondaryRecovery(recoveredInput(1200));

    expect(decision).toMatchObject({
      action: "idle",
      reason: "secondary_not_missing",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      healthy: true,
      isMissing: false,
      missingSince: 0,
      missingDurationMs: 0,
      missCount: 0,
      terminated: false,
      lastDecision: "idle",
      lastDecisionAt: 1200,
    });
  });

  test("resetSecondaryRecoveryLane resets state and emits the existing reset log payload", async () => {
    const createLaneRecoveryState = await loadFactory();
    const logContent = vi.fn();
    const recovery = createLaneRecoveryState({ logContent });

    const laneState = recovery.laneStates.secondary;
    Object.assign(laneState, {
      healthy: false,
      isMissing: true,
      missingSince: 100,
      missingDurationMs: 1200,
      missCount: 3,
      terminated: true,
      lastDecision: "terminated",
      lastDecisionAt: 1300,
    });

    const result = recovery.resetSecondaryRecoveryLane("content-switch");

    expect(result).toBe(laneState);
    expect(laneState).toMatchObject({
      isMissing: false,
      missingSince: 0,
      missingDurationMs: 0,
      missCount: 0,
      terminated: false,
      lastDecision: "idle",
      lastDecisionAt: 0,
    });

    expect(logContent).toHaveBeenCalledOnce();
    expect(logContent).toHaveBeenCalledWith("secondary recovery lane reset", {
      reason: "content-switch",
      before: {
        missCount: 3,
        terminated: true,
        missingSince: 100,
        missingDurationMs: 1200,
        lastDecision: "terminated",
      },
      after: {
        missCount: 0,
        terminated: false,
        missingSince: 0,
        missingDurationMs: 0,
        lastDecision: "idle",
      },
    });
  });
});

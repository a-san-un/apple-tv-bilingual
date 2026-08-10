import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

async function loadFactory() {
  global.window = global.window || {};
  global.window.ATVB = {};

  const moduleUrl = new URL(
    "../modules/secondary-track-recovery.js",
    import.meta.url,
  );

  await import(`${moduleUrl.href}?t=${Date.now()}-${Math.random()}`);

  return global.window?.ATVB?.secondaryTrackRecovery
    ?.createSecondaryTrackRecovery;
}

function missingInput(now) {
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
      primaryHealthy: true,
    },
  };
}

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
    },
  };
}

describe("secondary-track-recovery", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  test("exposes createSecondaryTrackRecovery on window.ATVB.secondaryTrackRecovery", async () => {
    const createSecondaryTrackRecovery = await loadFactory();

    expect(typeof createSecondaryTrackRecovery).toBe("function");
  });

  test("initializes primary and secondary laneStates with the existing lane state shape", async () => {
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();

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
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();

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

  test("updateLaneState records a missing duration and resets recovery fields when healthy", async () => {
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();
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

  test("waits until the recovery window has elapsed before requesting recovery", async () => {
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();

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

  test("requests recovery after the recovery window has elapsed", async () => {
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    const decision = recovery.evaluateSecondaryRecovery(missingInput(1100));

    expect(decision).toMatchObject({
      action: "recover",
      reason: "secondary_current_missing_with_primary_present",
    });
    expect(recovery.laneStates.secondary).toMatchObject({
      missCount: 1,
      terminated: false,
      lastDecision: "recover",
      lastDecisionAt: 1100,
    });
  });

  test("uses force-rebind after the repeated-miss threshold", async () => {
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(missingInput(1100));

    const decision = recovery.evaluateSecondaryRecovery(missingInput(1300));

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
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(missingInput(1100));

    const decision = recovery.evaluateSecondaryRecovery(missingInput(1200));

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

  test("enters terminated after the recovery miss limit", async () => {
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery({
      SECONDARY_RECOVERY_MISS_LIMIT: 2,
      SECONDARY_RECOVERY_DEBOUNCE_MS: 0,
    });

    recovery.evaluateSecondaryRecovery(missingInput(100));
    const first = recovery.evaluateSecondaryRecovery(missingInput(1100));
    const terminated = recovery.evaluateSecondaryRecovery(missingInput(1300));

    expect(first).toMatchObject({
      action: "recover",
      reason: "secondary_current_missing_with_primary_present",
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
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery({
      SECONDARY_RECOVERY_MISS_LIMIT: 1,
      SECONDARY_TERMINATED_RETRY_MS: 10_000,
    });

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(missingInput(1100));

    expect(recovery.laneStates.secondary.terminated).toBe(true);

    const retry = recovery.evaluateSecondaryRecovery(missingInput(11_100));

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

  test("resets the secondary lane when subtitle cues recover", async () => {
    const createSecondaryTrackRecovery = await loadFactory();
    const recovery = createSecondaryTrackRecovery();

    recovery.evaluateSecondaryRecovery(missingInput(100));
    recovery.evaluateSecondaryRecovery(missingInput(1100));

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
    const createSecondaryTrackRecovery = await loadFactory();
    const logContent = vi.fn();
    const recovery = createSecondaryTrackRecovery({ logContent });

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

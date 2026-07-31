import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

async function loadFactory() {
  global.window = global.window || {};
  global.window.ATVB = {};
  global.window.setInterval = global.window.setInterval || vi.fn();
  global.window.clearInterval = global.window.clearInterval || vi.fn();

  const controllerUrl = new URL(
    "../modules/subtitle-sync-controller.js",
    import.meta.url,
  );

  await import(`${controllerUrl.href}?t=${Date.now()}-${Math.random()}`);

  return global.window?.ATVB?.subtitleSyncController?.createSubtitleSyncController;
}

describe("subtitle-sync-controller (PR2)", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  test("exposes createSubtitleSyncController on window.ATVB", async () => {
    const createSubtitleSyncController = await loadFactory();

    expect(typeof createSubtitleSyncController).toBe("function");
  });

  test("getSecondaryTrackDebugPayload returns normalized debug payload", async () => {
    const createSubtitleSyncController = await loadFactory();

    const controller = createSubtitleSyncController({
      state: {},
      logContent: vi.fn(),
      cueController: {},
      renderSecondarySubtitle: vi.fn(),
      getRequestedSecondaryLanguage: () => "ja",
      resolverDeps: {
        getTrackCuesLength: (track) => track?.cues?.length ?? 0,
      },
      getTrackActiveCuesLength: (track) => track?.activeCues?.length ?? 0,
      ensureSyncIntervalOrchestrator: vi.fn(),
      onRecoveryNeeded: vi.fn(),
    });

    const track = {
      language: "en",
      cues: [{}, {}],
      activeCues: [{}],
    };

    expect(controller.getSecondaryTrackDebugPayload("ja", track)).toEqual({
      effectiveSecondaryLanguage: "ja",
      selectedTrackLanguage: "en",
      cuesLength: 2,
      activeCuesLength: 1,
    });
  });

  test("canReadCueFromTrack returns true only for hidden/showing tracks", async () => {
    const createSubtitleSyncController = await loadFactory();

    const controller = createSubtitleSyncController({
      state: {},
      logContent: vi.fn(),
      cueController: {},
      renderSecondarySubtitle: vi.fn(),
      getRequestedSecondaryLanguage: () => "ja",
      resolverDeps: {
        getTrackCuesLength: () => 0,
      },
      getTrackActiveCuesLength: () => 0,
      ensureSyncIntervalOrchestrator: vi.fn(),
      onRecoveryNeeded: vi.fn(),
    });

    expect(controller.canReadCueFromTrack(null)).toBe(false);
    expect(controller.canReadCueFromTrack({ mode: "disabled" })).toBe(false);
    expect(controller.canReadCueFromTrack({ mode: "hidden" })).toBe(true);
    expect(controller.canReadCueFromTrack({ mode: "showing" })).toBe(true);
  });

  test("syncSecondarySubtitleTrack returns null when video is missing", async () => {
    const createSubtitleSyncController = await loadFactory();

    const logContent = vi.fn();
    const cueController = {
      syncSecondarySubtitleTrack: vi.fn(),
      getBoundSecondaryTrack: vi.fn(() => null),
    };

    const controller = createSubtitleSyncController({
      state: {
        video: null,
        secondaryTrack: null,
      },
      logContent,
      cueController,
      renderSecondarySubtitle: vi.fn(),
      getRequestedSecondaryLanguage: () => "ja",
      resolverDeps: {
        getTrackCuesLength: () => 0,
      },
      getTrackActiveCuesLength: () => 0,
      ensureSyncIntervalOrchestrator: vi.fn(),
      onRecoveryNeeded: vi.fn(),
    });

    expect(
      controller.syncSecondarySubtitleTrack({ reason: "test-missing-video" }),
    ).toBeNull();

    expect(cueController.syncSecondarySubtitleTrack).not.toHaveBeenCalled();

    expect(logContent).toHaveBeenCalledWith(
      "secondary sync result: skipped before binding",
      expect.objectContaining({
        reason: "test-missing-video",
        hasVideo: false,
        requestedLang: "ja",
      }),
    );
  });

  test("ensureSecondaryTrackSyncInterval does not register duplicate intervals", async () => {
    const setIntervalSpy = vi.fn(() => 12345);
    const clearIntervalSpy = vi.fn();

    global.window = {
      ATVB: {},
      setInterval: setIntervalSpy,
      clearInterval: clearIntervalSpy,
    };

    const controllerUrl = new URL(
      "../modules/subtitle-sync-controller.js",
      import.meta.url,
    );
    await import(`${controllerUrl.href}?t=${Date.now()}-${Math.random()}`);

    const createSubtitleSyncController =
      global.window?.ATVB?.subtitleSyncController?.createSubtitleSyncController;

    const controller = createSubtitleSyncController({
      state: {
        restarting: false,
        video: null,
      },
      logContent: vi.fn(),
      cueController: {},
      renderSecondarySubtitle: vi.fn(),
      getRequestedSecondaryLanguage: () => "",
      resolverDeps: {
        getTrackCuesLength: () => 0,
      },
      getTrackActiveCuesLength: () => 0,
      ensureSyncIntervalOrchestrator: vi.fn(() => null),
      onRecoveryNeeded: vi.fn(),
    });

    controller.ensureSecondaryTrackSyncInterval();
    controller.ensureSecondaryTrackSyncInterval();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

    controller.clearSecondaryTrackSyncInterval();

    expect(clearIntervalSpy).toHaveBeenCalledWith(12345);
  });
});

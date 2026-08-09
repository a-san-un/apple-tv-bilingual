import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

async function loadFactory() {
  global.window = global.window || {};
  global.window.ATVB = {};

  const controllerUrl = new URL(
    "../modules/subtitle-sync-controller.js",
    import.meta.url,
  );

  await import(`${controllerUrl.href}?t=${Date.now()}-${Math.random()}`);

  return global.window?.ATVB?.subtitleSyncController
    ?.createSubtitleSyncController;
}

function createController({
  state = { secondaryTrack: null },
  logContent = vi.fn(),
  resolver = {},
  syncNativeSubtitleSelection = vi.fn(),
  bindSecondaryTrack = vi.fn(),
} = {}) {
  return {
    state,
    logContent,
    resolver,
    syncNativeSubtitleSelection,
    bindSecondaryTrack,
  };
}

describe("subtitle-sync-controller", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  test("exposes createSubtitleSyncController on window.ATVB.subtitleSyncController", async () => {
    const createSubtitleSyncController = await loadFactory();

    expect(typeof createSubtitleSyncController).toBe("function");
  });

  test("getTrackReadability returns an unreadable default payload when track is missing", async () => {
    const createSubtitleSyncController = await loadFactory();
    const { state, logContent, resolver, syncNativeSubtitleSelection, bindSecondaryTrack } =
      createController();

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
      },
    });

    expect(controller.getTrackReadability(null)).toEqual({
      cuesLength: 0,
      activeCuesLength: 0,
      currentCueTextLength: 0,
      hasCueOverlapAtCurrentTime: false,
      readable: false,
    });
  });

  test("getTrackReadability returns readable when the track has cues", async () => {
    const createSubtitleSyncController = await loadFactory();
    const { state, logContent, syncNativeSubtitleSelection, bindSecondaryTrack } =
      createController();

    const resolver = {
      getTrackCuesLength: vi.fn(() => 2),
      getTrackActiveCuesLength: vi.fn(() => 1),
      getCurrentCueTextLength: vi.fn(() => 5),
      hasCueOverlapAtTime: vi.fn(() => true),
    };

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
      },
    });

    const track = { language: "ja", label: "Japanese" };

    expect(controller.getTrackReadability(track, 12.5)).toEqual({
      cuesLength: 2,
      activeCuesLength: 1,
      currentCueTextLength: 5,
      hasCueOverlapAtCurrentTime: true,
      readable: true,
    });

    expect(resolver.getCurrentCueTextLength).toHaveBeenCalledWith(track, 12.5);
    expect(resolver.hasCueOverlapAtTime).toHaveBeenCalledWith(track, 12.5);
  });

  test("syncSecondarySubtitleTrack returns null when video or requested language is missing", async () => {
    const createSubtitleSyncController = await loadFactory();
    const { state, logContent, resolver, syncNativeSubtitleSelection, bindSecondaryTrack } =
      createController();

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
      },
    });

    await expect(
      controller.syncSecondarySubtitleTrack(null, "ja"),
    ).resolves.toBeNull();

    await expect(
      controller.syncSecondarySubtitleTrack({ currentTime: 0 }, ""),
    ).resolves.toBeNull();

    expect(resolver.resolveSecondarySubtitleTrack).toBeUndefined();
    expect(syncNativeSubtitleSelection).not.toHaveBeenCalled();
    expect(bindSecondaryTrack).not.toHaveBeenCalled();
  });

  test("syncSecondarySubtitleTrack directly binds a resolved secondary track", async () => {
    const createSubtitleSyncController = await loadFactory();
    const selectedTrack = {
      language: "ja",
      label: "Japanese",
      mode: "hidden",
    };
    const video = { currentTime: 24.5 };

    const resolver = {
      resolveSecondarySubtitleTrack: vi.fn(() => selectedTrack),
      getTrackCuesLength: vi.fn(() => 3),
      getTrackActiveCuesLength: vi.fn(() => 1),
      getCurrentCueTextLength: vi.fn(() => 9),
      hasCueOverlapAtTime: vi.fn(() => true),
    };

    const { state, logContent, syncNativeSubtitleSelection, bindSecondaryTrack } =
      createController({ resolver });

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
      },
    });

    await expect(
      controller.syncSecondarySubtitleTrack(video, "ja", {
        primaryLang: "en",
        source: "test",
      }),
    ).resolves.toBe(selectedTrack);

    expect(resolver.resolveSecondarySubtitleTrack).toHaveBeenCalledTimes(1);
    expect(resolver.resolveSecondarySubtitleTrack).toHaveBeenCalledWith(
      video,
      "ja",
    );

    expect(bindSecondaryTrack).toHaveBeenCalledWith(selectedTrack, {
      primaryLang: "en",
      source: "test",
      requestedLang: "ja",
      reason: "secondary-sync-direct-bind",
    });

    expect(state.secondaryTrack).toBe(selectedTrack);
    expect(syncNativeSubtitleSelection).not.toHaveBeenCalled();

    expect(logContent).toHaveBeenCalledWith(
      "subtitle sync direct selected track",
      expect.objectContaining({
        requestedLang: "ja",
        currentTime: 24.5,
        selectedLanguage: "ja",
        selectedLabel: "Japanese",
        selectedMode: "hidden",
        readability: {
          cuesLength: 3,
          activeCuesLength: 1,
          currentCueTextLength: 9,
          hasCueOverlapAtCurrentTime: true,
          readable: true,
        },
      }),
    );
  });

  test("syncSecondarySubtitleTrack falls back to native selection and binds the resolved fallback track", async () => {
    const createSubtitleSyncController = await loadFactory();
    const fallbackTrack = {
      language: "ja",
      label: "Japanese",
      mode: "hidden",
    };
    const video = { currentTime: 10 };

    const resolver = {
      resolveSecondarySubtitleTrack: vi
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(fallbackTrack),
    };

    const syncNativeSubtitleSelection = vi.fn().mockResolvedValue(undefined);
    const { state, logContent, bindSecondaryTrack } = createController({
      resolver,
      syncNativeSubtitleSelection,
    });

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
      },
    });

    await expect(
      controller.syncSecondarySubtitleTrack(video, "ja", {
        primaryLang: "en",
        source: "test",
      }),
    ).resolves.toBe(fallbackTrack);

    expect(syncNativeSubtitleSelection).toHaveBeenCalledWith({
      primaryLang: "en",
      secondaryLang: "ja",
      preferredSource: "ja",
    });

    expect(resolver.resolveSecondarySubtitleTrack).toHaveBeenCalledTimes(2);
    expect(resolver.resolveSecondarySubtitleTrack).toHaveBeenNthCalledWith(
      1,
      video,
      "ja",
    );
    expect(resolver.resolveSecondarySubtitleTrack).toHaveBeenNthCalledWith(
      2,
      video,
      "ja",
    );

    expect(bindSecondaryTrack).toHaveBeenCalledWith(fallbackTrack, {
      primaryLang: "en",
      source: "test",
      requestedLang: "ja",
      reason: "secondary-sync-native-fallback",
    });

    expect(state.secondaryTrack).toBe(fallbackTrack);

    expect(logContent).toHaveBeenCalledWith(
      "subtitle sync direct fallback to native",
      {
        requestedLang: "ja",
        currentTime: 10,
      },
    );
  });

  test("syncSecondarySubtitleTrack leaves secondaryTrack null when native fallback cannot resolve a track", async () => {
    const createSubtitleSyncController = await loadFactory();
    const video = { currentTime: 3 };

    const resolver = {
      resolveSecondarySubtitleTrack: vi.fn(() => null),
    };

    const syncNativeSubtitleSelection = vi.fn().mockResolvedValue(undefined);
    const { state, logContent, bindSecondaryTrack } = createController({
      state: { secondaryTrack: { language: "old" } },
      resolver,
      syncNativeSubtitleSelection,
    });

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
      },
    });

    await expect(
      controller.syncSecondarySubtitleTrack(video, "ja"),
    ).resolves.toBeNull();

    expect(syncNativeSubtitleSelection).toHaveBeenCalledWith({
      primaryLang: "",
      secondaryLang: "ja",
      preferredSource: "ja",
    });

    expect(bindSecondaryTrack).not.toHaveBeenCalled();
    expect(state.secondaryTrack).toBeNull();
  });
});

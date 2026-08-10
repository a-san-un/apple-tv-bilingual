// =============================================================
// tests/subtitle-sync-controller.test.js
//
// 概要:
// - modules/subtitle-sync-controller.js の公開 factory と主要 contract を固定する。
// - secondary subtitle の direct bind / native fallback / readability 判定に加えて、
//   sync interval orchestrator の lazy init contract を検証する。
// - Step 8-D では、content.js から module へ orchestrator 生成責務を段階移管するため、
//   factory 未提供時の null 戻り値と、提供時に 1 回だけ生成して再利用する挙動を固定する。
// =============================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// モジュールを毎回 fresh import して、window.ATVB への factory 公開を確認する。
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

// 各テストで使う依存をまとめて生成する。
// 必要な mock だけ上書きできるようにして、テスト本体を読みやすくする。
function createController({
  state = { secondaryTrack: null },
  logContent = vi.fn(),
  resolver = {},
  syncNativeSubtitleSelection = vi.fn(),
  bindSecondaryTrack = vi.fn(),
  createSyncIntervalOrchestrator = undefined,
} = {}) {
  return {
    state,
    logContent,
    resolver,
    syncNativeSubtitleSelection,
    bindSecondaryTrack,
    createSyncIntervalOrchestrator,
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

  // factory が window.ATVB.subtitleSyncController に公開されることを確認する。
  test("exposes createSubtitleSyncController on window.ATVB.subtitleSyncController", async () => {
    const createSubtitleSyncController = await loadFactory();

    expect(typeof createSubtitleSyncController).toBe("function");
  });

  // track 不在時は unreadable な既定 payload を返すことを確認する。
  test("getTrackReadability returns an unreadable default payload when track is missing", async () => {
    const createSubtitleSyncController = await loadFactory();
    const {
      state,
      logContent,
      resolver,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
      createSyncIntervalOrchestrator,
    } = createController();

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
        createSyncIntervalOrchestrator,
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

  // cue 情報がある track は readable=true になり、resolver helper に currentTime が渡ることを確認する。
  test("getTrackReadability returns readable when the track has cues", async () => {
    const createSubtitleSyncController = await loadFactory();
    const {
      state,
      logContent,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
      createSyncIntervalOrchestrator,
    } = createController();

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
        createSyncIntervalOrchestrator,
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

  // video または requestedLang が欠ける場合は何もせず null を返すことを確認する。
  test("syncSecondarySubtitleTrack returns null when video or requested language is missing", async () => {
    const createSubtitleSyncController = await loadFactory();
    const {
      state,
      logContent,
      resolver,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
      createSyncIntervalOrchestrator,
    } = createController();

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
        createSyncIntervalOrchestrator,
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

  // resolver が secondary track を直接解決できる場合は、native fallback を使わず direct bind することを確認する。
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

    const {
      state,
      logContent,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
      createSyncIntervalOrchestrator,
    } = createController({ resolver });

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent,
        resolver,
        syncNativeSubtitleSelection,
        bindSecondaryTrack,
        createSyncIntervalOrchestrator,
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

  // direct bind できない場合は native menu sync へフォールバックし、その後に解決できた track を bind することを確認する。
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
    const {
      state,
      logContent,
      bindSecondaryTrack,
      createSyncIntervalOrchestrator,
    } = createController({
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
        createSyncIntervalOrchestrator,
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

  // native fallback 後も track が見つからない場合は secondaryTrack を null に戻すことを確認する。
  test("syncSecondarySubtitleTrack leaves secondaryTrack null when native fallback cannot resolve a track", async () => {
    const createSubtitleSyncController = await loadFactory();
    const video = { currentTime: 3 };

    const resolver = {
      resolveSecondarySubtitleTrack: vi.fn(() => null),
    };

    const syncNativeSubtitleSelection = vi.fn().mockResolvedValue(undefined);
    const {
      state,
      logContent,
      bindSecondaryTrack,
      createSyncIntervalOrchestrator,
    } = createController({
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
        createSyncIntervalOrchestrator,
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

  // orchestrator factory 未提供時は null を返し、content.js 側で安全に null fallback できることを確認する。
  test("ensureSyncIntervalOrchestrator returns null when factory is unavailable", async () => {
    const createSubtitleSyncController = await loadFactory();

    const controller = createSubtitleSyncController({
      state: {},
      services: {},
    });

    expect(controller.ensureSyncIntervalOrchestrator({ foo: "bar" })).toBeNull();
  });

  // orchestrator は lazy init で 1 回だけ生成し、2 回目以降は同じ instance を返すことを確認する。
  test("ensureSyncIntervalOrchestrator lazily creates and reuses orchestrator instance", async () => {
    const createSubtitleSyncController = await loadFactory();
    const orchestrator = {
      start: vi.fn(),
      stop: vi.fn(),
      isPaused: vi.fn(() => false),
    };
    const createSyncIntervalOrchestrator = vi.fn(() => orchestrator);

    const controller = createSubtitleSyncController({
      state: {},
      services: {
        createSyncIntervalOrchestrator,
        logContent: vi.fn(),
      },
    });

    const first = controller.ensureSyncIntervalOrchestrator({ reason: "first" });
    const second = controller.ensureSyncIntervalOrchestrator({ reason: "second" });

    expect(first).toBe(orchestrator);
    expect(second).toBe(orchestrator);
    expect(createSyncIntervalOrchestrator).toHaveBeenCalledTimes(1);
    expect(createSyncIntervalOrchestrator).toHaveBeenCalledWith({
      reason: "first",
    });
  });

  // controller 生成時に注入した state が direct bind 後に更新されることを確認する。
  test("syncSecondarySubtitleTrack writes resolved track back to injected state", async () => {
    const createSubtitleSyncController = await loadFactory();
    const selectedTrack = {
      language: "ja",
      label: "Japanese",
      mode: "hidden",
    };
    const state = { secondaryTrack: null };
    const resolver = {
      resolveSecondarySubtitleTrack: vi.fn(() => selectedTrack),
      getTrackCuesLength: vi.fn(() => 1),
      getTrackActiveCuesLength: vi.fn(() => 0),
      getCurrentCueTextLength: vi.fn(() => 0),
      hasCueOverlapAtTime: vi.fn(() => false),
    };

    const controller = createSubtitleSyncController({
      state,
      services: {
        logContent: vi.fn(),
        resolver,
        bindSecondaryTrack: vi.fn(),
        syncNativeSubtitleSelection: vi.fn(),
      },
    });

    await expect(
      controller.syncSecondarySubtitleTrack({ currentTime: 1 }, "ja"),
    ).resolves.toBe(selectedTrack);

    expect(state.secondaryTrack).toBe(selectedTrack);
  });
});

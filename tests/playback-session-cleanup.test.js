import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ============================================================
// tests/playback-session-cleanup.test.js
//
// modules/playback-session-cleanup.js のユニットテスト。
// createPlaybackSessionCleanup が公開されること、
// playback session cleanup の既存 contract と
// Step 8-B で追加した navigation target missing cleanup の委譲を検証する。
// ============================================================

async function loadFactory() {
  global.window = global.window || {};
  global.window.ATVB = {};

  const moduleUrl = new URL(
    "../modules/playback-session-cleanup.js",
    import.meta.url,
  );

  await import(`${moduleUrl.href}?t=${Date.now()}-${Math.random()}`);

  return global.window?.ATVB?.createPlaybackSessionCleanup;
}

function createState(overrides = {}) {
  return {
    secondaryTrack: { language: "ja", label: "Japanese" },
    lastSecondarySyncContext: { currentTime: 12.3 },
    secondaryHideTimer: 101,
    playbackCloseClickHandler: null,
    primaryTrack: { language: "en" },
    currentSubtitleBlock: { text: "hello" },
    subtitleBlockMeta: { index: 1 },
    lastPanelRenderSnapshot: { panelVisible: true },
    subtitleHistory: [{ id: 1 }],
    panelPastBlocks: [{ id: "past" }],
    subtitleBlocks: [{ id: "current" }],
    subtitleCurrentIndex: 3,
    video: { id: "video-1" },
    dialogEl: { id: "dialog-1" },
    lastVideoSrcKey: "src-key",
    lastObservedVideoTime: 45,
    currentContentKey: "content-key",
    contentSettings: {
      primaryLang: "en",
      secondaryLang: "ja",
      showSidebar: true,
    },
    requestedContentSettings: {
      primaryLang: "en",
      secondaryLang: "ja",
      showSidebar: true,
    },
    requestedSecondaryLang: "ja",
    ...overrides,
  };
}

function createTeardownDeps(overrides = {}) {
  return {
    stopPlaybackControlLayoutObservers: vi.fn(),
    layoutController: {
      teardownPlaybackControlsUi: vi.fn(),
    },
    clearInitialCueRecovery: vi.fn(),
    renderSecondarySubtitle: vi.fn(),
    overlayController: {
      clearOverlayState: vi.fn(),
    },
    destroyOverlay: vi.fn(),
    destroyUiHosts: vi.fn(),
    destroyFeatureUiHosts: vi.fn(),
    applyLayout: vi.fn(),
    clearInternalSubtitleState: vi.fn(),
    cueController: {
      handoffPrimarySubtitleToNative: vi.fn(),
      unbindSecondarySubtitleTrack: vi.fn(),
    },
    runtimeObservers: {
      stopAll: vi.fn(),
    },
    ...overrides,
  };
}

describe("playback-session-cleanup", () => {
  let originalWindow;
  let originalDocument;
  let clearTimeoutSpy;
  let addEventListenerSpy;

  beforeEach(() => {
    originalWindow = global.window;
    originalDocument = global.document;

    clearTimeoutSpy = vi.fn();
    addEventListenerSpy = vi.fn();

    global.window = {
      ATVB: {},
    };

    global.document = {
      addEventListener: addEventListenerSpy,
    };

    global.clearTimeout = clearTimeoutSpy;
  });

  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    vi.restoreAllMocks();
  });

  test("window.ATVB.createPlaybackSessionCleanup が関数として公開される", async () => {
    const createPlaybackSessionCleanup = await loadFactory();

    expect(typeof createPlaybackSessionCleanup).toBe("function");
  });

  test("clearPlaybackSessionUiState は playback session 由来 state を cleanup し設定は保持する", async () => {
    const createPlaybackSessionCleanup = await loadFactory();
    const state = createState();
    const callOrder = [];
    const teardownDeps = createTeardownDeps({
      stopPlaybackControlLayoutObservers: vi.fn(() => {
        callOrder.push("stopPlaybackControlLayoutObservers");
      }),
      layoutController: {
        teardownPlaybackControlsUi: vi.fn(() => {
          callOrder.push("layoutController.teardownPlaybackControlsUi");
        }),
      },
      clearInitialCueRecovery: vi.fn(() => {
        callOrder.push("clearInitialCueRecovery");
      }),
      renderSecondarySubtitle: vi.fn(() => {
        callOrder.push("renderSecondarySubtitle");
      }),
      overlayController: {
        clearOverlayState: vi.fn(() => {
          callOrder.push("overlayController.clearOverlayState");
        }),
      },
      destroyOverlay: vi.fn(() => {
        callOrder.push("destroyOverlay");
      }),
      destroyUiHosts: vi.fn(() => {
        callOrder.push("destroyUiHosts");
      }),
      clearInternalSubtitleState: vi.fn(({ preserveSecondaryDom }) => {
        callOrder.push(`clearInternalSubtitleState:${preserveSecondaryDom}`);
      }),
      cueController: {
        handoffPrimarySubtitleToNative: vi.fn(() => {
          callOrder.push("handoffPrimarySubtitleToNative");
        }),
        unbindSecondarySubtitleTrack: vi.fn(({ restoreMode }) => {
          callOrder.push(`unbindSecondarySubtitleTrack:${restoreMode}`);
        }),
      },
      runtimeObservers: {
        stopAll: vi.fn(() => {
          callOrder.push("runtimeObservers.stopAll");
        }),
      },
    });
    const logContent = vi.fn();

    const cleanup = createPlaybackSessionCleanup({
      state,
      logContent,
      teardownDeps,
    });

    cleanup.clearPlaybackSessionUiState("reinitialize_before_attach_tracks");

    expect(clearTimeoutSpy).toHaveBeenCalledWith(101);
    expect(teardownDeps.renderSecondarySubtitle).toHaveBeenCalledWith("", null);

    expect(callOrder).toEqual([
      "stopPlaybackControlLayoutObservers",
      "layoutController.teardownPlaybackControlsUi",
      "clearInitialCueRecovery",
      "renderSecondarySubtitle",
      "overlayController.clearOverlayState",
      "destroyOverlay",
      "destroyUiHosts",
      "runtimeObservers.stopAll",
      "handoffPrimarySubtitleToNative",
      "unbindSecondarySubtitleTrack:false",
      "clearInternalSubtitleState:true",
      "clearInternalSubtitleState:false",
    ]);

    expect(state.primaryTrack).toBeNull();
    expect(state.secondaryTrack).toBeNull();
    expect(state.currentSubtitleBlock).toBeNull();
    expect(state.subtitleBlockMeta).toBeNull();
    expect(state.lastPanelRenderSnapshot).toBeNull();
    expect(state.lastSecondarySyncContext).toBeNull();
    expect(state.subtitleHistory).toEqual([]);
    expect(state.panelPastBlocks).toEqual([]);
    expect(state.subtitleBlocks).toEqual([]);
    expect(state.subtitleCurrentIndex).toBe(-1);

    expect(state.video).toBeNull();
    expect(state.dialogEl).toBeNull();
    expect(state.lastVideoSrcKey).toBe("");
    expect(state.lastObservedVideoTime).toBeNull();
    expect(state.currentContentKey).toBe("");

    expect(state.contentSettings).toEqual({
      primaryLang: "en",
      secondaryLang: "ja",
      showSidebar: true,
    });
    expect(state.requestedContentSettings).toEqual({
      primaryLang: "en",
      secondaryLang: "ja",
      showSidebar: true,
    });

    expect(logContent).toHaveBeenCalledWith(
      "reinitialize_before_attach_tracks",
      expect.objectContaining({
        previousVideoSrcKey: "src-key",
        currentContentKey: "content-key",
        preservedSettings: expect.objectContaining({
          primaryLang: "en",
          secondaryLang: "ja",
          showSidebar: true,
          requestedSecondaryLang: "ja",
        }),
      }),
    );
  });

  test("handleNavigationTargetMissing は host cleanup と layout reset を行い playback context を記録する", async () => {
    const createPlaybackSessionCleanup = await loadFactory();
    const state = createState();
    const callOrder = [];
    const teardownDeps = createTeardownDeps({
      destroyUiHosts: vi.fn(() => {
        callOrder.push("destroyUiHosts");
      }),
      applyLayout: vi.fn((visible) => {
        callOrder.push(`applyLayout:${visible}`);
      }),
    });
    const logContent = vi.fn(() => {
      callOrder.push("logContent");
    });

    const cleanup = createPlaybackSessionCleanup({
      state,
      logContent,
      teardownDeps,
    });

    cleanup.handleNavigationTargetMissing({
      reason: "mutation_observer",
      url: "https://tv.apple.com/example",
      playbackContext: {
        primaryTrackFound: false,
        secondaryTrackFound: false,
      },
    });

    expect(callOrder).toEqual([
      "destroyUiHosts",
      "applyLayout:false",
      "logContent",
    ]);

    expect(logContent).toHaveBeenCalledWith(
      "navigation changed: playback target not ready yet",
      {
        reason: "mutation_observer",
        url: "https://tv.apple.com/example",
        primaryTrackFound: false,
        secondaryTrackFound: false,
      },
    );
  });

  test("ensureCloseClickListener は click listener を 1 回だけ登録する", async () => {
    const createPlaybackSessionCleanup = await loadFactory();
    const state = createState();
    const teardownDeps = createTeardownDeps();

    const cleanup = createPlaybackSessionCleanup({
      state,
      logContent: vi.fn(),
      teardownDeps,
    });

    cleanup.ensureCloseClickListener();
    cleanup.ensureCloseClickListener();

    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
    expect(typeof state.playbackCloseClickHandler).toBe("function");
  });
});

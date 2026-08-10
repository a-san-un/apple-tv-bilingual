import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ============================================================
// tests/playback-startup-coordinator.test.js
//
// modules/playback-startup-coordinator.js のユニットテスト。
// createPlaybackStartupCoordinator が公開されること、
// requestedContentSettings を用いた auto start 判定、
// video attach / clear / boot / track readiness watch の既存 contract を
// 維持していることを検証する。
// ============================================================

// ----------------------------------------------------------
// factory 読み込み helper
// - IIFE module を import し、window.ATVB から factory を取得する
// ----------------------------------------------------------
async function loadFactory() {
  global.window = global.window || {};
  global.window.ATVB = {};

  const moduleUrl = new URL(
    "../modules/playback-startup-coordinator.js",
    import.meta.url,
  );

  await import(`${moduleUrl.href}?t=${Date.now()}-${Math.random()}`);

  return global.window?.ATVB?.createPlaybackStartupCoordinator;
}

// ----------------------------------------------------------
// textTracks mock helper
// - addtrack listener の登録/解除と emit を再現する
// - Array.from(video.textTracks) で読める iterator も持たせる
// ----------------------------------------------------------
function createTextTrackList(tracks = []) {
  const listeners = new Map();

  return {
    length: tracks.length,
    addEventListener: vi.fn((event, handler) => {
      listeners.set(event, handler);
    }),
    removeEventListener: vi.fn((event, handler) => {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    }),
    emit(event) {
      const handler = listeners.get(event);
      if (typeof handler === "function") {
        handler();
      }
    },
    [Symbol.iterator]: function* iterator() {
      yield* tracks;
    },
  };
}

// ----------------------------------------------------------
// video mock helper
// - textTracks を持つ最小限の video object を作る
// ----------------------------------------------------------
function createVideo(tracks = []) {
  return {
    textTracks: createTextTrackList(tracks),
  };
}

// ----------------------------------------------------------
// subtitle-like track helper
// - subtitles/captions と language を持つ track を生成する
// - startup coordinator の readiness 判定用
// ----------------------------------------------------------
function createSubtitleTrack({
  kind = "subtitles",
  label = "English",
  language = "en",
  mode = "hidden",
  cuesLength = 0,
} = {}) {
  return {
    kind,
    label,
    language,
    mode,
    cues: { length: cuesLength },
  };
}

// ----------------------------------------------------------
// service mock helper
// - startup coordinator に注入する依存を既定値付きで作る
// ----------------------------------------------------------
function createServices(overrides = {}) {
  return {
    logContent: vi.fn(),
    isLanguageSelectionReady: vi.fn(() => true),
    getVideoAndDialog: vi.fn(() => ({ video: null, dialog: null })),
    waitForVideo: vi.fn(),
    attachTracks: vi.fn(),
    startBilingual: vi.fn(),
    clearSubtitles: vi.fn(),
    ...overrides,
  };
}

describe("playback-startup-coordinator", () => {
  let originalWindow;
  let setIntervalSpy;
  let clearIntervalSpy;
  let setTimeoutSpy;
  let clearTimeoutSpy;
  let intervalCallbacks;
  let timeoutCallbacks;
  let nextTimerId;

  beforeEach(() => {
    originalWindow = global.window;

    intervalCallbacks = new Map();
    timeoutCallbacks = new Map();
    nextTimerId = 1;

    setIntervalSpy = vi.fn((callback) => {
      const id = nextTimerId++;
      intervalCallbacks.set(id, callback);
      return id;
    });

    clearIntervalSpy = vi.fn((id) => {
      intervalCallbacks.delete(id);
    });

    setTimeoutSpy = vi.fn((callback) => {
      const id = nextTimerId++;
      timeoutCallbacks.set(id, callback);
      return id;
    });

    clearTimeoutSpy = vi.fn((id) => {
      timeoutCallbacks.delete(id);
    });

    global.window = {
      setInterval: setIntervalSpy,
      clearInterval: clearIntervalSpy,
      setTimeout: setTimeoutSpy,
      clearTimeout: clearTimeoutSpy,
      ATVB: {},
    };
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // 公開 API の存在確認
  // ----------------------------------------------------------

  test("window.ATVB.createPlaybackStartupCoordinator が関数として公開される", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();

    expect(typeof createPlaybackStartupCoordinator).toBe("function");
  });

  // ----------------------------------------------------------
  // auto start 判定
  // - requestedContentSettings を isLanguageSelectionReady へ渡すこと
  // ----------------------------------------------------------

  test("canAutoStartFromSavedSettings は requestedContentSettings を使って auto start 可否を判定する", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const state = {
      requestedContentSettings: {
        primaryLang: "en",
        secondaryLang: "ja",
      },
    };
    const services = createServices({
      isLanguageSelectionReady: vi.fn(() => true),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    expect(coordinator.canAutoStartFromSavedSettings()).toBe(true);
    expect(services.isLanguageSelectionReady).toHaveBeenCalledWith(
      state.requestedContentSettings,
    );
  });

  // ----------------------------------------------------------
  // attachAndMaybeStart: video 切替時 cleanup
  // - 既存 video と異なる場合だけ clearSubtitles を呼ぶこと
  // ----------------------------------------------------------

  test("attachAndMaybeStart は別 video へ切り替わると clearSubtitles を呼ぶ", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const previousVideo = createVideo();
    const nextVideo = createVideo([createSubtitleTrack()]);
    const state = {
      video: previousVideo,
      dialogEl: { id: "old-dialog" },
      requestedContentSettings: {
        primaryLang: "en",
        secondaryLang: "ja",
      },
    };
    const services = createServices({
      getVideoAndDialog: vi.fn(() => ({
        video: nextVideo,
        dialog: { id: "new-dialog" },
      })),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    coordinator.attachAndMaybeStart(nextVideo, "video_changed");

    expect(services.clearSubtitles).toHaveBeenCalledWith({
      reason: "startup_coordinator:video_change:video_changed",
    });
    expect(services.attachTracks).toHaveBeenCalledWith(nextVideo);
    expect(state.video).toBe(nextVideo);
    expect(state.dialogEl).toEqual({ id: "new-dialog" });
  });

  // ----------------------------------------------------------
  // attachAndMaybeStart: 即時起動経路
  // - subtitle-like track が既にある場合は immediate で start すること
  // ----------------------------------------------------------

  test("attachAndMaybeStart は subtitle-like track が既にあれば即時に startBilingual を呼ぶ", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const video = createVideo([
      createSubtitleTrack({
        kind: "subtitles",
        label: "English CC",
        language: "en",
        cuesLength: 3,
      }),
    ]);
    const state = {
      video: null,
      dialogEl: null,
      requestedContentSettings: {
        primaryLang: "en",
        secondaryLang: "ja",
      },
    };
    const services = createServices({
      getVideoAndDialog: vi.fn(() => ({
        video,
        dialog: { id: "dialog-now" },
      })),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    coordinator.attachAndMaybeStart(video, "ready_now");

    expect(services.attachTracks).toHaveBeenCalledWith(video);
    expect(services.startBilingual).toHaveBeenCalledWith({
      reason: "startup_coordinator:ready_now:immediate",
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // attachAndMaybeStart: addtrack 待機経路
  // - 初回は track 不足で待機し、addtrack 後に start すること
  // - watcher が張られること自体を固定し、cleanup の内部実装には踏み込まない
  // ----------------------------------------------------------

  test("attachAndMaybeStart は addtrack で subtitle-like track が利用可能になると startBilingual を呼ぶ", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const tracks = [];
    const video = createVideo(tracks);
    const state = {
      video: null,
      dialogEl: null,
      requestedContentSettings: {
        primaryLang: "en",
        secondaryLang: "ja",
      },
    };
    const services = createServices({
      getVideoAndDialog: vi.fn(() => ({
        video,
        dialog: { id: "dialog-later" },
      })),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    coordinator.attachAndMaybeStart(video, "wait_addtrack");

    expect(services.startBilingual).not.toHaveBeenCalled();
    expect(video.textTracks.addEventListener).toHaveBeenCalledWith(
      "addtrack",
      expect.any(Function),
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    tracks.push(
      createSubtitleTrack({
        kind: "captions",
        label: "Japanese",
        language: "ja",
        cuesLength: 1,
      }),
    );
    video.textTracks.length = tracks.length;
    video.textTracks.emit("addtrack");

    expect(services.startBilingual).toHaveBeenCalledWith({
      reason: "startup_coordinator:wait_addtrack:textTracks_addtrack",
    });
  });

  // ----------------------------------------------------------
  // attachAndMaybeStart: auto start 無効経路
  // - language selection ready でない場合は start しないこと
  // ----------------------------------------------------------

  test("attachAndMaybeStart は requestedContentSettings が language-ready でなければ auto start しない", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const video = createVideo([createSubtitleTrack()]);
    const state = {
      video: null,
      dialogEl: null,
      requestedContentSettings: {
        primaryLang: "",
        secondaryLang: "",
      },
    };
    const services = createServices({
      isLanguageSelectionReady: vi.fn(() => false),
      getVideoAndDialog: vi.fn(() => ({
        video,
        dialog: null,
      })),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    coordinator.attachAndMaybeStart(video, "language_not_ready");

    expect(services.attachTracks).toHaveBeenCalledWith(video);
    expect(services.startBilingual).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // boot: 即時 video 検出経路
  // - getVideoAndDialog が最初から video を返す場合の起動
  // ----------------------------------------------------------

  test("boot は getVideoAndDialog が即時に video を返すとそのまま attach と start を行う", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const video = createVideo([createSubtitleTrack()]);
    const state = {
      video: null,
      dialogEl: null,
      requestedContentSettings: {
        primaryLang: "en",
        secondaryLang: "ja",
      },
    };
    const services = createServices({
      getVideoAndDialog: vi.fn(() => ({
        video,
        dialog: { id: "boot-dialog" },
      })),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    coordinator.boot();

    expect(services.waitForVideo).not.toHaveBeenCalled();
    expect(services.attachTracks).toHaveBeenCalledWith(video);
    expect(services.startBilingual).toHaveBeenCalledWith({
      reason: "startup_coordinator:boot_found_video:immediate",
    });
  });

  // ----------------------------------------------------------
  // boot: waitForVideo 経路
  // - 初回に video が無い場合、waitForVideo callback 経由で起動すること
  // ----------------------------------------------------------

  test("boot は初回に video が無い場合 waitForVideo callback 経由で attach と start を行う", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const video = createVideo([createSubtitleTrack()]);
    const state = {
      video: null,
      dialogEl: null,
      requestedContentSettings: {
        primaryLang: "en",
        secondaryLang: "ja",
      },
    };
    const services = createServices({
      getVideoAndDialog: vi.fn(() => ({
        video: null,
        dialog: null,
      })),
      waitForVideo: vi.fn((callback) => {
        callback(video);
      }),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    coordinator.boot();

    expect(services.waitForVideo).toHaveBeenCalledTimes(1);
    expect(services.attachTracks).toHaveBeenCalledWith(video);
    expect(services.startBilingual).toHaveBeenCalledWith({
      reason: "startup_coordinator:boot_waitForVideo:immediate",
    });
  });

  // ----------------------------------------------------------
  // cleanupStartupWatch
  // - watcher 未生成/未接続でも安全に呼べることを確認する
  // - cleanup の安全性を固定し、内部 timer 解放方法には踏み込まない
  // ----------------------------------------------------------

  test("cleanupStartupWatch は watcher 状態に依存せず安全に呼べる", async () => {
    const createPlaybackStartupCoordinator = await loadFactory();
    const video = createVideo([]);
    const state = {
      video: null,
      dialogEl: null,
      requestedContentSettings: {
        primaryLang: "en",
        secondaryLang: "ja",
      },
    };
    const services = createServices({
      getVideoAndDialog: vi.fn(() => ({
        video,
        dialog: null,
      })),
    });

    const coordinator = createPlaybackStartupCoordinator({
      state,
      services,
    });

    expect(() => {
      coordinator.attachAndMaybeStart(video, "cleanup_watchers");
      coordinator.cleanupStartupWatch();
    }).not.toThrow();

    expect(video.textTracks.addEventListener).toHaveBeenCalledWith(
      "addtrack",
      expect.any(Function),
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});

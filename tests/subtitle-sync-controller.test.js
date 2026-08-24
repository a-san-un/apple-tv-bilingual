// =============================================================
// tests/subtitle-sync-controller.test.js
//
// 概要:
// - modules/subtitle-sync-controller.js の公開 factory と主要 contract を固定する。
// - 本ファイルは Step 12-14 の退行防止テストを追加するにあたり、
//   旧 API (state 直渡し / syncSecondarySubtitleTrack) を前提にした
//   古いテストを、現行 API (services のみ / syncTrackDirectly 系) へ
//   全面的に書き直したものである。
//
// カバー範囲:
//   - factory 公開契約 (window.ATVB.subtitleSyncController)
//   - getTrackReadability の readable / unreadable payload
//   - Step 12: selectPrimarySubtitleTrack / selectSecondarySubtitleTrack の
//     共通 selection API・track identity・requested language 判定
//   - Step 13: pending sync task の作成・cancel・cancelAll の観測可能な契約
//     (createPendingSyncTask は非公開のため、syncXxxTrackDirectly 経由で検証する)
//   - Step 14: syncPrimaryTrackDirectly / syncSecondaryTrackDirectly の
//     native fallback success / failure / cancel と role 間の挙動一致
//   - ensureSyncIntervalOrchestrator の lazy init contract
//
// 注意:
//   - waitForReadableTrack は task.cancelled を setTimeout 経由で確認するため、
//     「wait 中に外部から cancel する」テストは実タイマー待ちだと
//     Promise が解決されず hang するリスクがある。
//     そのため Step 13 / Step 14 の cancel 系テストは、
//     readable 判定が即時に確定するシナリオ（wait ループに入らない経路）や、
//     bindTrack / syncNativeSelection の Promise を手動で制御する
//     deferred パターンを使い、実タイマーへ依存しない形で検証する。
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

// resolver mock のデフォルト値をまとめて生成する。
// 必要な helper だけ overrides で上書きできるようにして、
// テスト本体で「今回何を変えたか」が読みやすくなるようにする。
function createResolver(overrides = {}) {
  return {
    matchesRequestedLanguage: vi.fn(
      (track, requestedLang) => track?.language === requestedLang,
    ),
    isForcedLikeTrack: vi.fn(() => false),
    getTrackCuesLength: vi.fn(() => 0),
    getTrackActiveCuesLength: vi.fn(() => 0),
    getCurrentCueTextLength: vi.fn(() => 0),
    hasCueOverlapAtTime: vi.fn(() => false),
    resolveRequestedSubtitleTrack: vi.fn(() => null),
    resolveSecondarySubtitleTrack: vi.fn(() => null),
    ...overrides,
  };
}

// video.textTracks は Array.from() で配列化されるだけなので、
// テストでは素直な配列を渡せば十分再現できる。
function createVideo({ currentTime = 0, tracks = [] } = {}) {
  return { currentTime, textTracks: tracks };
}

// 外部から resolve/reject を制御できる Promise を作る。
// bindTrack / syncNativeSelection の「実行中」状態を明示的に作りたい
// pending sync task cancel / cancel-mid-fallback テストで使う。
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  // ---------------------------------------------------------
  // factory 公開契約
  // ---------------------------------------------------------
  describe("factory", () => {
    // factory が window.ATVB.subtitleSyncController に公開されることを確認する。
    test("exposes createSubtitleSyncController on window.ATVB.subtitleSyncController", async () => {
      const createSubtitleSyncController = await loadFactory();

      expect(typeof createSubtitleSyncController).toBe("function");
    });
  });

  // ---------------------------------------------------------
  // readability
  // ---------------------------------------------------------
  describe("readability", () => {
    // track 不在時は unreadable な既定 payload を返すことを確認する。
    test("getTrackReadability returns an unreadable default payload when track is missing", async () => {
      const createSubtitleSyncController = await loadFactory();
      const controller = createSubtitleSyncController({
        services: { logContent: vi.fn(), resolver: createResolver() },
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
      const resolver = createResolver({
        getTrackCuesLength: vi.fn(() => 2),
        getTrackActiveCuesLength: vi.fn(() => 1),
        getCurrentCueTextLength: vi.fn(() => 5),
        hasCueOverlapAtTime: vi.fn(() => true),
      });

      const controller = createSubtitleSyncController({
        services: { logContent: vi.fn(), resolver },
      });

      const track = { language: "ja", label: "Japanese" };

      expect(controller.getTrackReadability(track, 12.5)).toEqual({
        cuesLength: 2,
        activeCuesLength: 1,
        currentCueTextLength: 5,
        hasCueOverlapAtCurrentTime: true,
        readable: true,
      });

      expect(resolver.getCurrentCueTextLength).toHaveBeenCalledWith(
        track,
        12.5,
      );
      expect(resolver.hasCueOverlapAtTime).toHaveBeenCalledWith(track, 12.5);
    });
  });

  // ---------------------------------------------------------
  // Step 12: selection 共通化 / track identity / requested language 判定
  // ---------------------------------------------------------
  describe("selection (Step 12 regression)", () => {
    // primary / secondary が同じ selection コアを通り、同じ shape・同じ
    // identity 文字列を返すことを固定する。role 別に selection ロジックが
    // 分岐していないことの退行防止。
    test("selectPrimarySubtitleTrack and selectSecondarySubtitleTrack share the same identity/candidate contract", async () => {
      const createSubtitleSyncController = await loadFactory();

      const trackJa = {
        id: "t-ja",
        language: "ja",
        label: "Japanese",
        kind: "subtitles",
      };
      const video = createVideo({ currentTime: 10, tracks: [trackJa] });
      const resolver = createResolver();

      const controller = createSubtitleSyncController({
        services: {
          logContent: vi.fn(),
          resolver,
          roles: {
            primary: { resolveTrack: vi.fn(() => trackJa) },
            secondary: { resolveTrack: vi.fn(() => trackJa) },
          },
        },
      });

      const primarySelection = controller.selectPrimarySubtitleTrack(
        video,
        "ja",
      );
      const secondarySelection = controller.selectSecondarySubtitleTrack(
        video,
        "ja",
      );

      expect(primarySelection.role).toBe("primary");
      expect(secondarySelection.role).toBe("secondary");

      expect(primarySelection.track).toBe(trackJa);
      expect(secondarySelection.track).toBe(trackJa);

      // identity 文字列の形式が role に関わらず一致すること。
      expect(primarySelection.selectedTrackId).toBe("t-ja");
      expect(secondarySelection.selectedTrackId).toBe("t-ja");

      expect(primarySelection.candidates).toHaveLength(1);
      expect(secondarySelection.candidates).toHaveLength(1);
    });

    // previousBoundTrack がまだ候補に含まれる場合、sameTrackRef が true になり、
    // かつ preferredTrack への score ボーナス(+1)が効くことを確認する。
    test("selectSubtitleTrack marks sameTrackRef true and gives the previously bound track a score bonus", async () => {
      const createSubtitleSyncController = await loadFactory();

      const trackA = {
        id: "t-a",
        language: "ja",
        label: "Japanese A",
        kind: "subtitles",
      };
      const trackB = {
        id: "t-b",
        language: "ja",
        label: "Japanese B",
        kind: "subtitles",
      };
      const video = createVideo({
        currentTime: 5,
        tracks: [trackA, trackB],
      });

      const resolver = createResolver();

      const controller = createSubtitleSyncController({
        services: {
          logContent: vi.fn(),
          resolver,
          roles: {
            secondary: { resolveTrack: vi.fn(() => null) },
          },
        },
      });

      const selection = controller.selectSecondarySubtitleTrack(
        video,
        "ja",
        trackB,
      );

      expect(selection.sameTrackRef).toBe(true);
      expect(selection.track).toBe(trackB);

      const candidateA = selection.candidates.find((c) => c.track === trackA);
      const candidateB = selection.candidates.find((c) => c.track === trackB);

      expect(candidateB.score).toBe(candidateA.score + 1);
    });

    // previousBoundTrack が requestedLang と一致しなくなった場合に
    // requestedLanguageChanged が true になることを確認する
    // (言語切替直後に不要な bind 維持へ戻らないための判定)。
    test("selectSubtitleTrack marks requestedLanguageChanged when the previously bound track no longer matches the requested language", async () => {
      const createSubtitleSyncController = await loadFactory();

      const trackEn = {
        id: "t-en",
        language: "en",
        label: "English",
        kind: "subtitles",
      };
      const trackJa = {
        id: "t-ja",
        language: "ja",
        label: "Japanese",
        kind: "subtitles",
      };
      const video = createVideo({ currentTime: 1, tracks: [trackJa] });

      const resolver = createResolver();

      const controller = createSubtitleSyncController({
        services: {
          logContent: vi.fn(),
          resolver,
          roles: {
            secondary: { resolveTrack: vi.fn(() => null) },
          },
        },
      });

      const changed = controller.selectSecondarySubtitleTrack(
        video,
        "ja",
        trackEn,
      );
      expect(changed.requestedLanguageChanged).toBe(true);

      const unchanged = controller.selectSecondarySubtitleTrack(
        video,
        "ja",
        trackJa,
      );
      expect(unchanged.requestedLanguageChanged).toBe(false);
    });

    // video / requestedLang / resolveTrack のいずれかが欠けている場合、
    // role に関わらず track:null かつ candidates:[] の空 selection を
    // 返すことを確認する (primary/secondary/未知 role の3パターン)。
    test.each([["primary"], ["secondary"], ["unsupported-role"]])(
      "selectSubtitleTrack returns an empty selection for role=%s when video or requestedLang is missing",
      async (role) => {
        const createSubtitleSyncController = await loadFactory();

        const video = createVideo({ tracks: [] });
        const resolver = createResolver();

        const controller = createSubtitleSyncController({
          services: {
            logContent: vi.fn(),
            resolver,
            roles: {
              primary: { resolveTrack: vi.fn(() => null) },
              secondary: { resolveTrack: vi.fn(() => null) },
            },
          },
        });

        expect(
          controller.selectSubtitleTrack({
            role,
            video: null,
            requestedLang: "ja",
          }),
        ).toMatchObject({ track: null, candidates: [] });

        expect(
          controller.selectSubtitleTrack({
            role,
            video,
            requestedLang: "",
          }),
        ).toMatchObject({ track: null, candidates: [] });
      },
    );
  });

  // ---------------------------------------------------------
  // Step 13: pending sync task cancel
  // ---------------------------------------------------------
  describe("pending sync task cancel (Step 13 regression)", () => {
    // pending task が存在しない role に対する cancel は false を返し、
    // cancel ログも出さないことを確認する (安全な no-op であることの保証)。
    test("cancelPendingSyncTask is a no-op and returns false when no task is pending for the role", async () => {
      const createSubtitleSyncController = await loadFactory();
      const logContent = vi.fn();

      const controller = createSubtitleSyncController({
        services: { logContent, resolver: createResolver() },
      });

      const cancelled = controller.cancelPendingSyncTask("primary", "noop");

      expect(cancelled).toBe(false);
      expect(logContent).not.toHaveBeenCalledWith(
        "subtitleSyncController.cancelPendingSyncTask",
        expect.anything(),
      );
    });

    // syncSecondaryTrackDirectly が bindTrack 実行中(pending)の間に
    // cancelPendingSyncTask を呼んだ場合、cancel 自体は true で観測できるが、
    // すでに開始済みの bindTrack 呼び出しは中断されず完了することを確認する。
    // -> 「cancel は新規開始を止めるが、既に走っている bind は中断しない」契約の固定。
    test("cancelPendingSyncTask observes an in-flight task but does not abort an already-started bind", async () => {
      const createSubtitleSyncController = await loadFactory();

      const track = {
        id: "t-ja",
        language: "ja",
        label: "Japanese",
        kind: "subtitles",
        mode: "hidden",
      };
      const video = createVideo({ currentTime: 3, tracks: [track] });

      const resolver = createResolver({
        getTrackCuesLength: vi.fn(() => 1),
        hasCueOverlapAtTime: vi.fn(() => true),
      });

      const bindDeferred = createDeferred();
      const bindSecondaryTrack = vi.fn(() => bindDeferred.promise);

      const logContent = vi.fn();

      const controller = createSubtitleSyncController({
        services: {
          logContent,
          resolver,
          roles: {
            secondary: {
              resolveTrack: vi.fn(() => track),
              bindTrack: bindSecondaryTrack,
            },
          },
        },
      });

      const resultPromise = controller.syncSecondaryTrackDirectly(
        video,
        "ja",
      );

      // ここで bindSecondaryTrack はもう呼ばれているが、まだ resolve していない。
      expect(bindSecondaryTrack).toHaveBeenCalledTimes(1);

      const cancelled = controller.cancelPendingSyncTask(
        "secondary",
        "cancel-in-flight",
      );
      expect(cancelled).toBe(true);
      expect(logContent).toHaveBeenCalledWith(
        "subtitleSyncController.cancelPendingSyncTask",
        {
          role: "secondary",
          reason: "cancel-in-flight",
          cancelled: true,
        },
      );

      bindDeferred.resolve({ bound: true });

      await expect(resultPromise).resolves.toEqual({ bound: true });
    });

    // 同一 role で連続して syncXxxTrackDirectly を呼んだ場合、
    // 先行タスクが "replace-pending-task" 理由で自動 cancel されることを確認する。
    // これは content.js の再初期化経路 (resetSubtitleTrackBindings 相当) が
    // 依存している「新しい要求が来たら古い要求を必ず殺す」契約の固定。
    test("starting a new sync task for the same role automatically cancels the previous pending task", async () => {
      const createSubtitleSyncController = await loadFactory();

      const track = {
        id: "t-ja",
        language: "ja",
        label: "Japanese",
        kind: "subtitles",
        mode: "hidden",
      };
      const video = createVideo({ currentTime: 3, tracks: [track] });

      const resolver = createResolver({
        getTrackCuesLength: vi.fn(() => 1),
        hasCueOverlapAtTime: vi.fn(() => true),
      });

      const firstDeferred = createDeferred();
      const secondDeferred = createDeferred();
      const bindSecondaryTrack = vi
        .fn()
        .mockImplementationOnce(() => firstDeferred.promise)
        .mockImplementationOnce(() => secondDeferred.promise);

      const logContent = vi.fn();

      const controller = createSubtitleSyncController({
        services: {
          logContent,
          resolver,
          roles: {
            secondary: {
              resolveTrack: vi.fn(() => track),
              bindTrack: bindSecondaryTrack,
            },
          },
        },
      });

      const firstPromise = controller.syncSecondaryTrackDirectly(
        video,
        "ja",
      );
      const secondPromise = controller.syncSecondaryTrackDirectly(
        video,
        "ja",
      );

      expect(bindSecondaryTrack).toHaveBeenCalledTimes(2);
      expect(logContent).toHaveBeenCalledWith(
        "subtitleSyncController.cancelPendingSyncTask",
        {
          role: "secondary",
          reason: "replace-pending-task",
          cancelled: true,
        },
      );

      firstDeferred.resolve({ bound: "first" });
      secondDeferred.resolve({ bound: "second" });

      await expect(firstPromise).resolves.toEqual({ bound: "first" });
      await expect(secondPromise).resolves.toEqual({ bound: "second" });
    });
  });

  // ---------------------------------------------------------
  // Step 14: primary native fallback (success / failure / cancel)
  // ---------------------------------------------------------
  describe("direct bind / native fallback (Step 14 regression)", () => {
    // resolveTrack / textTracks からは候補が見つからない状態から開始し、
    // native fallback (syncNativeSelection) が textTracks へ trackJa を反映した
    // "後" の再 selection で readable な track が見つかり bind まで進む
    // success ケースを primary 経路で固定する。
    //
    // NOTE: video.textTracks は selectSubtitleTrack の候補フィルタで直接参照される
    // ため、fallback 前は空配列にしておき、syncNativeSelection の mock 内で
    // textTracks へ trackJa を push することで「ネイティブ側の字幕選択適用後に
    // textTracks が更新される」実挙動を模した状態遷移にする。
    test("syncPrimaryTrackDirectly binds via native fallback when the initial resolve returns nothing", async () => {
      const createSubtitleSyncController = await loadFactory();

      const trackJa = {
        id: "t-ja",
        language: "ja",
        label: "Japanese",
        kind: "subtitles",
        mode: "showing",
      };

      // 初回は textTracks が空 = 候補が見つからない状態からスタートする。
      const video = createVideo({ currentTime: 7, tracks: [] });

      const resolveTrack = vi.fn(() => null);

      const resolver = createResolver({
        // fallback 後の再 selection で readable と判定させる。
        getTrackCuesLength: vi.fn(() => 1),
        hasCueOverlapAtTime: vi.fn(() => true),
      });

      // native fallback 成功時に textTracks へ trackJa を反映する
      // (= ネイティブ字幕選択が適用され、track が観測可能になった状態を再現)。
      const syncNativeSelection = vi.fn(async () => {
        video.textTracks.push(trackJa);
        return true;
      });
      const bindTrack = vi.fn().mockResolvedValue({ bound: true });
      const logContent = vi.fn();

      const controller = createSubtitleSyncController({
        services: {
          logContent,
          resolver,
          roles: {
            primary: {
              resolveTrack,
              bindTrack,
              syncNativeSelection,
            },
          },
        },
      });

      const result = await controller.syncPrimaryTrackDirectly(video, "ja");

      expect(syncNativeSelection).toHaveBeenCalledWith(
        expect.objectContaining({ requestedLang: "ja" }),
      );
      expect(bindTrack).toHaveBeenCalledWith(
        trackJa,
        expect.objectContaining({ requestedLang: "ja" }),
      );
      expect(result).toEqual({ bound: true });

      expect(logContent).toHaveBeenCalledWith(
        "subtitleSyncController.syncTrackDirectly",
        expect.objectContaining({
          role: "primary",
          bound: true,
          readable: true,
        }),
      );
    });


    // native fallback 自体が不成立(false)の場合、bind へ進まず null を返す
    // failure ケースを固定する。secondary 専用の処理へ紛れ込んでいないことも
    // role: "primary" のログで確認する。
    test("syncPrimaryTrackDirectly returns null and skips bind when native fallback cannot resolve a track", async () => {
      const createSubtitleSyncController = await loadFactory();

      const video = createVideo({ currentTime: 2, tracks: [] });

      const resolveTrack = vi.fn(() => null);
      const resolver = createResolver();
      const syncNativeSelection = vi.fn().mockResolvedValue(false);
      const bindTrack = vi.fn();
      const logContent = vi.fn();

      const controller = createSubtitleSyncController({
        services: {
          logContent,
          resolver,
          roles: {
            primary: {
              resolveTrack,
              bindTrack,
              syncNativeSelection,
            },
          },
        },
      });

      const result = await controller.syncPrimaryTrackDirectly(
        video,
        "ja",
      );

      expect(result).toBeNull();
      expect(bindTrack).not.toHaveBeenCalled();
      expect(logContent).toHaveBeenCalledWith(
        "subtitleSyncController.syncTrackDirectly",
        expect.objectContaining({
          role: "primary",
          bound: false,
          reason: "track-missing",
        }),
      );
    });

    // native fallback の待機中に pending task が cancel された場合、
    // fallback 成立(true)であっても bind へ進まず null を返す cancel ケースを
    // 固定する。旧 fallback 結果が後から bind に横入りしないことの保証。
    test("syncPrimaryTrackDirectly returns null when the pending task is cancelled during native fallback", async () => {
      const createSubtitleSyncController = await loadFactory();

      const video = createVideo({ currentTime: 2, tracks: [] });

      const resolveTrack = vi.fn(() => null);
      const resolver = createResolver();
      const bindTrack = vi.fn();
      const logContent = vi.fn();

      let controllerRef;
      const syncNativeSelection = vi.fn(async () => {
        // fallback 実行中に外部から cancel が入ったケースを再現する。
        controllerRef.cancelPendingSyncTask(
          "primary",
          "cancelled-during-fallback",
        );
        return true;
      });

      const controller = createSubtitleSyncController({
        services: {
          logContent,
          resolver,
          roles: {
            primary: {
              resolveTrack,
              bindTrack,
              syncNativeSelection,
            },
          },
        },
      });
      controllerRef = controller;

      const result = await controller.syncPrimaryTrackDirectly(
        video,
        "ja",
      );

      expect(result).toBeNull();
      expect(bindTrack).not.toHaveBeenCalled();
    });

    // secondary 経路でも primary と同じ native fallback success フローを通ることを
    // 確認し、role によってロジック分岐が紛れ込んでいないことの parity を保証する。
    //
    // NOTE: primary 版と同様に、初回は textTracks を空にしておき、
    // syncNativeSelection の mock 内で textTracks へ trackJa を反映することで
    // fallback 経由の再 selection を実際に発火させる。
    test("syncSecondaryTrackDirectly follows the same native fallback success flow as primary", async () => {
      const createSubtitleSyncController = await loadFactory();

      const trackJa = {
        id: "t-ja",
        language: "ja",
        label: "Japanese",
        kind: "subtitles",
        mode: "hidden",
      };

      // 初回は textTracks が空 = 候補が見つからない状態からスタートする。
      const video = createVideo({ currentTime: 4, tracks: [] });

      const resolveTrack = vi.fn(() => null);

      const resolver = createResolver({
        getTrackCuesLength: vi.fn(() => 1),
        hasCueOverlapAtTime: vi.fn(() => true),
      });

      const syncNativeSelection = vi.fn(async () => {
        video.textTracks.push(trackJa);
        return true;
      });
      const bindTrack = vi.fn().mockResolvedValue({ bound: "secondary" });
      const logContent = vi.fn();

      const controller = createSubtitleSyncController({
        services: {
          logContent,
          resolver,
          roles: {
            secondary: {
              resolveTrack,
              bindTrack,
              syncNativeSelection,
            },
          },
        },
      });

      const result = await controller.syncSecondaryTrackDirectly(video, "ja");

      expect(result).toEqual({ bound: "secondary" });
      expect(logContent).toHaveBeenCalledWith(
        "subtitleSyncController.syncTrackDirectly",
        expect.objectContaining({
          role: "secondary",
          bound: true,
          readable: true,
        }),
      );
    });
  });

  // ---------------------------------------------------------
  // sync interval orchestrator
  // ---------------------------------------------------------
  describe("sync interval orchestrator", () => {
    // orchestrator factory 未提供時は null を返し、content.js 側で安全に null fallback できることを確認する。
    test("ensureSyncIntervalOrchestrator returns null when factory is unavailable", async () => {
      const createSubtitleSyncController = await loadFactory();

      const controller = createSubtitleSyncController({
        services: {},
      });

      expect(
        controller.ensureSyncIntervalOrchestrator({ foo: "bar" }),
      ).toBeNull();
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
        services: {
          createSyncIntervalOrchestrator,
          logContent: vi.fn(),
        },
      });

      const first = controller.ensureSyncIntervalOrchestrator({
        reason: "first",
      });
      const second = controller.ensureSyncIntervalOrchestrator({
        reason: "second",
      });

      expect(first).toBe(orchestrator);
      expect(second).toBe(orchestrator);
      expect(createSyncIntervalOrchestrator).toHaveBeenCalledTimes(1);
      expect(createSyncIntervalOrchestrator).toHaveBeenCalledWith({
        reason: "first",
      });
    });
  });
});

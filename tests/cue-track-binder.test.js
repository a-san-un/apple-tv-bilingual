import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ============================================================
// tests/cue-track-binder.test.js
//
// modules/cue-track-binder.js のユニットテスト。
// createCueTrackBinder が cueController の各メソッドへ
// 正しく委譲することを検証する。
// ============================================================

async function loadFactory() {
  global.window = global.window || {};
  global.window.ATVB = {};

  const moduleUrl = new URL(
    "../modules/cue-track-binder.js",
    import.meta.url,
  );

  await import(`${moduleUrl.href}?t=${Date.now()}-${Math.random()}`);

  return global.window?.ATVB?.cueTrackBinder?.createCueTrackBinder;
}

function makeCueController(overrides = {}) {
  return {
    bindPrimarySubtitleTrack: vi.fn(),
    unbindPrimarySubtitleTrack: vi.fn(),
    handoffPrimarySubtitleToNative: vi.fn(),
    restoreNativeSubtitles: vi.fn(),
    bindSecondarySubtitleTrack: vi.fn(),
    unbindSecondarySubtitleTrack: vi.fn(),
    getBoundPrimaryTrack: vi.fn(() => null),
    getBoundSecondaryTrack: vi.fn(() => null),
    ...overrides,
  };
}

describe("cue-track-binder", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // 公開 API の存在確認
  // ----------------------------------------------------------

  test("window.ATVB.cueTrackBinder.createCueTrackBinder が関数として公開される", async () => {
    const createCueTrackBinder = await loadFactory();
    expect(typeof createCueTrackBinder).toBe("function");
  });

  // ----------------------------------------------------------
  // 返却オブジェクトのシェイプ確認
  // ----------------------------------------------------------

  test("createCueTrackBinder が 8 つのメソッドを持つオブジェクトを返す", async () => {
    const createCueTrackBinder = await loadFactory();
    const binder = createCueTrackBinder({ cueController: makeCueController() });

    const expectedMethods = [
      "bindPrimary",
      "unbindPrimary",
      "handoffPrimaryToNative",
      "restoreNative",
      "bindSecondary",
      "unbindSecondary",
      "getBoundPrimary",
      "getBoundSecondary",
    ];

    for (const method of expectedMethods) {
      expect(typeof binder[method], `${method} は関数であること`).toBe("function");
    }
  });

  // ----------------------------------------------------------
  // 委譲テスト: bindPrimary
  // ----------------------------------------------------------

  test("bindPrimary は cueController.bindPrimarySubtitleTrack へ委譲する", async () => {
    const createCueTrackBinder = await loadFactory();
    const cueController = makeCueController();
    const binder = createCueTrackBinder({ cueController });

    const track = { language: "en" };
    const onCueChange = vi.fn();
    const options = { suppressRender: false };

    binder.bindPrimary(track, onCueChange, options);

    expect(cueController.bindPrimarySubtitleTrack).toHaveBeenCalledOnce();
    expect(cueController.bindPrimarySubtitleTrack).toHaveBeenCalledWith(
      track,
      onCueChange,
      options,
    );
  });

  // ----------------------------------------------------------
  // 委譲テスト: unbindPrimary
  // ----------------------------------------------------------

  test("unbindPrimary は cueController.unbindPrimarySubtitleTrack へ委譲する", async () => {
    const createCueTrackBinder = await loadFactory();
    const cueController = makeCueController();
    const binder = createCueTrackBinder({ cueController });

    const options = { keepMode: true };
    binder.unbindPrimary(options);

    expect(cueController.unbindPrimarySubtitleTrack).toHaveBeenCalledOnce();
    expect(cueController.unbindPrimarySubtitleTrack).toHaveBeenCalledWith(options);
  });

  // ----------------------------------------------------------
  // 委譲テスト: handoffPrimaryToNative
  // ----------------------------------------------------------

  test("handoffPrimaryToNative は cueController.handoffPrimarySubtitleToNative へ委譲する", async () => {
    const createCueTrackBinder = await loadFactory();
    const cueController = makeCueController();
    const binder = createCueTrackBinder({ cueController });

    binder.handoffPrimaryToNative();

    expect(cueController.handoffPrimarySubtitleToNative).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // 委譲テスト: restoreNative（実装済み・オプショナル）
  // ----------------------------------------------------------

  test("restoreNative は cueController.restoreNativeSubtitles へ委譲する", async () => {
    const createCueTrackBinder = await loadFactory();
    const cueController = makeCueController();
    const binder = createCueTrackBinder({ cueController });

    binder.restoreNative();

    expect(cueController.restoreNativeSubtitles).toHaveBeenCalledOnce();
  });

  test("restoreNative は cueController に restoreNativeSubtitles がなくてもエラーにならない", async () => {
    const createCueTrackBinder = await loadFactory();
    const { restoreNativeSubtitles: _omit, ...cueController } = makeCueController();
    const binder = createCueTrackBinder({ cueController });

    expect(() => binder.restoreNative()).not.toThrow();
  });

  // ----------------------------------------------------------
  // 委譲テスト: bindSecondary
  // ----------------------------------------------------------

  test("bindSecondary は cueController.bindSecondarySubtitleTrack へ委譲する", async () => {
    const createCueTrackBinder = await loadFactory();
    const cueController = makeCueController();
    const binder = createCueTrackBinder({ cueController });

    const track = { language: "ja" };
    const modeDecision = "showing";

    binder.bindSecondary(track, modeDecision);

    expect(cueController.bindSecondarySubtitleTrack).toHaveBeenCalledOnce();
    expect(cueController.bindSecondarySubtitleTrack).toHaveBeenCalledWith(
      track,
      modeDecision,
    );
  });

  // ----------------------------------------------------------
  // 委譲テスト: unbindSecondary
  // ----------------------------------------------------------

  test("unbindSecondary は cueController.unbindSecondarySubtitleTrack へ委譲する", async () => {
    const createCueTrackBinder = await loadFactory();
    const cueController = makeCueController();
    const binder = createCueTrackBinder({ cueController });

    const options = { clearCues: true };
    binder.unbindSecondary(options);

    expect(cueController.unbindSecondarySubtitleTrack).toHaveBeenCalledOnce();
    expect(cueController.unbindSecondarySubtitleTrack).toHaveBeenCalledWith(options);
  });

  // ----------------------------------------------------------
  // 委譲テスト: getBoundPrimary / getBoundSecondary
  // ----------------------------------------------------------

  test("getBoundPrimary は cueController.getBoundPrimaryTrack の返り値をそのまま返す", async () => {
    const createCueTrackBinder = await loadFactory();
    const fakeTrack = { language: "en", label: "English" };
    const cueController = makeCueController({
      getBoundPrimaryTrack: vi.fn(() => fakeTrack),
    });
    const binder = createCueTrackBinder({ cueController });

    const result = binder.getBoundPrimary();

    expect(cueController.getBoundPrimaryTrack).toHaveBeenCalledOnce();
    expect(result).toBe(fakeTrack);
  });

  test("getBoundSecondary は cueController.getBoundSecondaryTrack の返り値をそのまま返す", async () => {
    const createCueTrackBinder = await loadFactory();
    const fakeTrack = { language: "ja", label: "Japanese" };
    const cueController = makeCueController({
      getBoundSecondaryTrack: vi.fn(() => fakeTrack),
    });
    const binder = createCueTrackBinder({ cueController });

    const result = binder.getBoundSecondary();

    expect(cueController.getBoundSecondaryTrack).toHaveBeenCalledOnce();
    expect(result).toBe(fakeTrack);
  });

  // ----------------------------------------------------------
  // 独立性テスト: 複数インスタンスは互いに干渉しない
  // ----------------------------------------------------------

  test("複数の binder インスタンスはそれぞれ独立した cueController を持つ", async () => {
    const createCueTrackBinder = await loadFactory();
    const controllerA = makeCueController();
    const controllerB = makeCueController();

    const binderA = createCueTrackBinder({ cueController: controllerA });
    const _binderB = createCueTrackBinder({ cueController: controllerB });

    binderA.handoffPrimaryToNative();

    expect(controllerA.handoffPrimarySubtitleToNative).toHaveBeenCalledOnce();
    expect(controllerB.handoffPrimarySubtitleToNative).not.toHaveBeenCalled();
  });
});

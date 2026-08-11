// =============================================================
// tests/panel-visibility-state.test.js
// modules/panel-visibility-state.js の単体テスト (Step 2)
// =============================================================

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------- chrome.storage モックの共通セットアップ ----------

/**
 * chrome.storage.local のシンプルなインメモリ実装を返す。
 * get / set を vi.fn() でラップし、各テストで独立したストアを使う。
 */
function makeChromeMock(initialStore = {}) {
  const store = { ...initialStore };
  let errorMode = false;

  // runtime オブジェクトを先に作り、コールバック内から同じ参照を使う
  const runtime = { lastError: null };

  const chromeLocal = {
    get: vi.fn((key, cb) => {
      if (errorMode) {
        runtime.lastError = { message: "mock error" };
        cb({});
        runtime.lastError = null;
        return;
      }
      const result = Object.prototype.hasOwnProperty.call(store, key)
        ? { [key]: store[key] }
        : {};
      cb(result);
    }),
    set: vi.fn((obj, cb) => {
      if (errorMode) {
        runtime.lastError = { message: "mock error" };
        cb?.();
        runtime.lastError = null;
        return;
      }
      Object.assign(store, obj);
      cb?.();
    }),
    _store: store,
    _setError: (v) => { errorMode = v; },
  };

  return { storage: { local: chromeLocal }, runtime };
}

// ---------- テスト対象モジュールのロード ----------

function loadModule(chromeMock) {
  const code = readFileSync(
    resolve(__dirname, "../modules/panel-visibility-state.js"),
    "utf8"
  );
  // chrome グローバルをモックで差し替えて評価する
  const g = { chrome: chromeMock, globalThis: {} };
  g.globalThis = g;
  // module.exports 分岐を無効化するため module を undefined に
  const fn = new Function("globalThis", "chrome", "module",
    code + "; return globalThis.ATVB_PANEL_VISIBILITY;"
  );
  return fn(g, chromeMock, undefined);
}

// =============================================================
// load()
// =============================================================

describe("PanelVisibilityState.load: chrome.storage.local に値がある場合", () => {
  it("true が保存されているとき true を返す", async () => {
    const mock = makeChromeMock({ panelOpen: true });
    const sut = loadModule(mock);
    const result = await sut.load(false);
    expect(result).toBe(true);
  });

  it("false が保存されているとき false を返す", async () => {
    const mock = makeChromeMock({ panelOpen: false });
    const sut = loadModule(mock);
    const result = await sut.load(true);
    expect(result).toBe(false);
  });

  it("保存値が true のとき panelDefaultOpenSetting=false を上書きする", async () => {
    const mock = makeChromeMock({ panelOpen: true });
    const sut = loadModule(mock);
    expect(await sut.load(false)).toBe(true);
  });
});

describe("PanelVisibilityState.load: chrome.storage.local に値がない場合（初回起動）", () => {
  it("panelDefaultOpenSetting=true のとき true を返す", async () => {
    const mock = makeChromeMock({});  // panelOpen キーなし
    const sut = loadModule(mock);
    expect(await sut.load(true)).toBe(true);
  });

  it("panelDefaultOpenSetting=false のとき false を返す", async () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    expect(await sut.load(false)).toBe(false);
  });

  it("panelDefaultOpenSetting=undefined のとき true を返す (デフォルト ON)", async () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    expect(await sut.load(undefined)).toBe(true);
  });
});

describe("PanelVisibilityState.load: chrome.runtime.lastError が発生した場合", () => {
  it("エラー時は panelDefaultOpenSetting=true にフォールバックする", async () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    mock.storage.local._setError(true);
    expect(await sut.load(true)).toBe(true);
  });

  it("エラー時は panelDefaultOpenSetting=false にフォールバックする", async () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    mock.storage.local._setError(true);
    expect(await sut.load(false)).toBe(false);
  });
});

// =============================================================
// persist()
// =============================================================

describe("PanelVisibilityState.persist: chrome.storage.local への保存", () => {
  it("true を渡すと panelOpen=true が local に保存される", async () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    sut.persist(true);
    expect(mock.storage.local.set).toHaveBeenCalledWith(
      { panelOpen: true },
      expect.any(Function)
    );
  });

  it("false を渡すと panelOpen=false が local に保存される", async () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    sut.persist(false);
    expect(mock.storage.local.set).toHaveBeenCalledWith(
      { panelOpen: false },
      expect.any(Function)
    );
  });

  it("storage.sync（panelDefaultOpen）には一切書かない", () => {
    const mock = makeChromeMock({});
    mock.storage.sync = { set: vi.fn(), get: vi.fn() };
    const sut = loadModule(mock);
    sut.persist(true);
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
  });

  it("logFn が渡されたとき成功メッセージが呼ばれる", () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    const logFn = vi.fn();
    sut.persist(true, logFn);
    expect(logFn).toHaveBeenCalledWith(
      "panelOpen persisted",
      { panelOpen: true }
    );
  });

  it("chrome.runtime.lastError 発生時に logFn へエラー情報を渡す", () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    mock.storage.local._setError(true);
    const logFn = vi.fn();
    sut.persist(true, logFn);
    expect(logFn).toHaveBeenCalledWith(
      "panelOpen persist failed",
      expect.objectContaining({ panelOpen: true })
    );
  });

  it("logFn が省略されてもエラーが throw されない", () => {
    const mock = makeChromeMock({});
    const sut = loadModule(mock);
    expect(() => sut.persist(false)).not.toThrow();
  });
});

// =============================================================
// 責務分離の不変条件（panelDefaultOpen への書き込み禁止）
// =============================================================

describe("PanelVisibilityState: panelDefaultOpen と panelOpen の責務分離", () => {
  it("persist が storage.local のみに書き、storage.sync には書かない", () => {
    const mock = makeChromeMock({});
    mock.storage.sync = { set: vi.fn(), get: vi.fn() };
    const sut = loadModule(mock);
    sut.persist(true);
    sut.persist(false);
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
    expect(mock.storage.local.set).toHaveBeenCalledTimes(2);
  });

  it("load が storage.local のみを参照し、storage.sync は参照しない", async () => {
    const mock = makeChromeMock({ panelOpen: true });
    mock.storage.sync = { set: vi.fn(), get: vi.fn() };
    const sut = loadModule(mock);
    await sut.load(false);
    expect(mock.storage.sync.get).not.toHaveBeenCalled();
    expect(mock.storage.local.get).toHaveBeenCalledTimes(1);
  });
});
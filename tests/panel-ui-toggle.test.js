// =============================================================
// tests/panel-ui-toggle.test.js
// panel-ui.js の applyPanelVisibility / updateToggleButton の挙動テスト
//
// 現在仕様:
// - OFF 時もトグルボタンは表示される
// - applyPanelVisibility は panelHost の display を切り替えた後、
//   requestAnimationFrame 内で overlay 位置同期と toggle button 更新を行う
// - panelDefaultOpen は初期値専用であり、applyPanelVisibility では永続設定を書かない
// =============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { JSDOM } from "jsdom";

// ------------------------------------------------------------------
// jsdom 環境セットアップヘルパー
// ------------------------------------------------------------------

function makeEnv({ panelOpen = false } = {}) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://tv.apple.com/",
  });

  const { window } = dom;
  const { document } = window;

  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

  window.requestAnimationFrame = vi.fn((cb) => {
    cb();
    return 1;
  });

  window.cancelAnimationFrame = vi.fn();

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn((key, cb) => cb({})),
        set: vi.fn((obj, cb) => cb?.()),
      },
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
    runtime: {
      lastError: null,
      getURL: vi.fn((path) => path),
      sendMessage: vi.fn(),
    },
  };

  window.chrome = chromeMock;
  globalThis.chrome = chromeMock;

  window.ATVB_PANEL_VISIBILITY = {
    load: vi.fn(async (def) => def),
    persist: vi.fn(),
  };

  const stubs = {
    clearDebugLogs: vi.fn(),
    sendToBackground: vi.fn(),
    applyLayout: vi.fn(),
    logContent: vi.fn(),
    renderCurrentSnapshot: vi.fn(),
    renderPanel: vi.fn(),
    rebuildSubtitleBlocksForPanelOpen: vi.fn(),
    destroyOverlay: vi.fn(),
    overlayController: {
      syncOverlayPositionToPlayer: vi.fn(),
    },
    getTarget: vi.fn(() => document.body),
  };

  const code = readFileSync(resolve(__dirname, "../panel-ui.js"), "utf8");

  let panelUi;
  try {
    const fn = new Function(
      "window",
      "document",
      "chrome",
      "ATVB_PANEL_VISIBILITY",
      `
        ${code}
        const factory = window.ATVB?.panelUi?.createPanelUi;
        if (!factory) return null;
        return factory({
          state: {
            panelOpen: ${panelOpen ? "true" : "false"},
            contentSettings: { panelDefaultOpen: true },
            panelShadowRoot: null,
            toggleButtonResizeHandler: null,
          },
          getTarget: window.__testGetTarget,
          getLiveDebugLogFilter: () => "",
          getDebugLogText: () => "",
          clearDebugLogs: () => {},
          sendToBackground: () => {},
          applyLayout: () => {},
          logContent: () => {},
          renderCurrentSnapshot: () => {},
          renderPanel: () => {},
          rebuildSubtitleBlocksForPanelOpen: () => {},
          destroyOverlay: () => {},
          overlayController: window.__testOverlayController,
        });
      `,
    );

    window.__testGetTarget = stubs.getTarget;
    window.__testOverlayController = stubs.overlayController;

    panelUi = fn(window, document, chromeMock, window.ATVB_PANEL_VISIBILITY);
  } catch (_e) {
    panelUi = null;
  }

  return { window, document, panelUi, stubs };
}

function addPanelHost(document, { display = "" } = {}) {
  const host = document.createElement("div");
  host.id = "atv-panel-host";
  host.style.display = display;

  host.getBoundingClientRect = () => ({
    width: 300,
    height: 0,
    top: 0,
    left: 0,
    right: 300,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  });

  document.body.appendChild(host);
  return host;
}

function addOverlayHost(document, { display = "" } = {}) {
  const host = document.createElement("div");
  host.id = "atv-overlay-host";
  host.style.display = display;
  document.body.appendChild(host);
  return host;
}

function addToggleButton(document, { display = "", right = "0px" } = {}) {
  const btn = document.createElement("button");
  btn.id = "atv-toggle-btn";
  btn.style.display = display;
  btn.style.right = right;
  document.body.appendChild(btn);
  return btn;
}

async function flushRaf() {
  await Promise.resolve();
  await Promise.resolve();
}

// =============================================================
// applyPanelVisibility の表示制御
// =============================================================

describe("applyPanelVisibility: パネル本体の表示制御", () => {
  let env;

  beforeEach(() => {
    env = makeEnv({ panelOpen: false });
    addPanelHost(env.document, { display: "" });
    addOverlayHost(env.document, { display: "" });
    addToggleButton(env.document, { display: "", right: "300px" });
  });

  afterEach(() => {
    env.document.body.innerHTML = "";
  });

  it("applyPanelVisibility(false) 後に panel host が display:none になる", async () => {
    env.panelUi?.applyPanelVisibility?.(false);
    await flushRaf();

    const panelHost = env.document.body.querySelector("#atv-panel-host");
    expect(panelHost?.style.display).toBe("none");
  });

  it("applyPanelVisibility(true) 後に panel host が display:'' になる", async () => {
    const panelHost = env.document.body.querySelector("#atv-panel-host");
    panelHost.style.display = "none";

    env.panelUi?.applyPanelVisibility?.(true);
    await flushRaf();

    expect(panelHost?.style.display).toBe("");
  });
});

// =============================================================
// updateToggleButton の display / text / right 制御
// =============================================================

describe("applyPanelVisibility: トグルボタンは ON/OFF どちらでも表示される", () => {
  let env;

  beforeEach(() => {
    env = makeEnv({ panelOpen: false });
    addPanelHost(env.document, { display: "" });
    addToggleButton(env.document, { display: "", right: "0px" });
  });

  afterEach(() => {
    env.document.body.innerHTML = "";
  });

  it("OFF 後もトグルボタンは display:'' のまま表示される", async () => {
    env.panelUi?.applyPanelVisibility?.(false);
    await flushRaf();

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("");
  });

  it("ON 後もトグルボタンは display:'' のまま表示される", async () => {
    const btn = env.document.body.querySelector("#atv-toggle-btn");
    btn.style.display = "none";

    env.panelUi?.applyPanelVisibility?.(true);
    await flushRaf();

    expect(btn?.style.display).toBe("");
  });

  it("OFF → ON → OFF と切り替えても最終状態で表示される", async () => {
    env.panelUi?.applyPanelVisibility?.(false);
    env.panelUi?.applyPanelVisibility?.(true);
    env.panelUi?.applyPanelVisibility?.(false);
    await flushRaf();

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("");
  });

  it("ON → OFF → ON と切り替えても最終状態で表示される", async () => {
    env.panelUi?.applyPanelVisibility?.(true);
    env.panelUi?.applyPanelVisibility?.(false);
    env.panelUi?.applyPanelVisibility?.(true);
    await flushRaf();

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("");
  });
});

describe("applyPanelVisibility: テキスト・right 位置の制御", () => {
  let env;

  beforeEach(() => {
    env = makeEnv({ panelOpen: false });
    addPanelHost(env.document, { display: "" });
    addToggleButton(env.document, { display: "", right: "300px" });
  });

  afterEach(() => {
    env.document.body.innerHTML = "";
  });

  it("ON 時はボタンテキストが '‹' になる", async () => {
    env.panelUi?.applyPanelVisibility?.(true);
    await flushRaf();

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.textContent).toBe("‹");
  });

  it("OFF 時はボタンテキストが '›' になる", async () => {
    env.panelUi?.applyPanelVisibility?.(false);
    await flushRaf();

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.textContent).toBe("›");
  });

  it("ON 時は right が panel host 幅ぶんの '300px' になる", async () => {
    env.panelUi?.applyPanelVisibility?.(true);
    await flushRaf();

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.right).toBe("300px");
  });

  it("OFF 時は right が '0px' になる", async () => {
    env.panelUi?.applyPanelVisibility?.(false);
    await flushRaf();

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.right).toBe("0px");
  });
});

// =============================================================
// overlay controller 呼び出し
// =============================================================

describe("applyPanelVisibility: overlay 位置同期", () => {
  let env;

  beforeEach(() => {
    env = makeEnv({ panelOpen: false });
    addPanelHost(env.document, { display: "" });
    addToggleButton(env.document);
  });

  afterEach(() => {
    env.document.body.innerHTML = "";
  });

  it("OFF 時は panelOpen:false で overlay 位置同期を呼ぶ", async () => {
    env.panelUi?.applyPanelVisibility?.(false);
    await flushRaf();

    expect(
      env.stubs.overlayController.syncOverlayPositionToPlayer,
    ).toHaveBeenCalledWith({
      reason: "panel-visibility-change",
      panelOpen: false,
    });
  });

  it("ON 時は panelOpen:true で overlay 位置同期を呼ぶ", async () => {
    env.panelUi?.applyPanelVisibility?.(true);
    await flushRaf();

    expect(
      env.stubs.overlayController.syncOverlayPositionToPlayer,
    ).toHaveBeenCalledWith({
      reason: "panel-visibility-change",
      panelOpen: true,
    });
  });
});

// =============================================================
// panelDefaultOpen と panelOpen の責務分離
// =============================================================

describe("applyPanelVisibility: panelDefaultOpen と panelOpen を混同しない", () => {
  it("applyPanelVisibility は chrome.storage.sync（panelDefaultOpen）に書かない", async () => {
    const env = makeEnv();
    addPanelHost(env.document, { display: "" });
    addToggleButton(env.document);

    env.panelUi?.applyPanelVisibility?.(true);
    env.panelUi?.applyPanelVisibility?.(false);
    await flushRaf();

    expect(env.window.chrome.storage.sync.set).not.toHaveBeenCalled();

    env.document.body.innerHTML = "";
  });
});

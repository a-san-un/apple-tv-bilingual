// =============================================================
// tests/panel-ui-toggle.test.js
// Step 3: updateToggleButton / applyPanelVisibility の挙動テスト
// =============================================================
//
// テスト対象の変更点（Step 3-A / 3-B）:
//   - updateToggleButton(false) が btn.style.display = "none" を設定する
//   - updateToggleButton(true)  が btn.style.display = "" を設定する
//   - applyPanelVisibility が OFF 時に後書き上書きブロックを持たない
//     → updateToggleButton の呼び出し 1 回で display 制御が完結する
//
// panel-ui.js は IIFE 形式のため、内部関数を直接 import できない。
// DOM を jsdom で構築し、panel-ui.js をスクリプトとして評価することで
// createToggleButton / applyPanelVisibility を間接的に検証する。
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

  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

  window.ResizeObserver = window.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn((key, cb) => cb({})),
        set: vi.fn((obj, cb) => cb?.()),
      },
    },
    runtime: { lastError: null },
  };
  window.chrome = chromeMock;

  window.ATVB_PANEL_VISIBILITY = {
    load: vi.fn(async (def) => def),
    persist: vi.fn(),
  };

  const stubs = {
    clearDebugLogs:        vi.fn(),
    sendToBackground:      vi.fn(),
    applyLayout:           vi.fn(),
    logContent:            vi.fn(),
    renderCurrentSnapshot: vi.fn(),
    renderPanel:           vi.fn(),
    getSubtitleView:       vi.fn(() => null),
    rebuildSubtitleBlocksForPanelOpen: vi.fn(),
    getState:              vi.fn(() => ({ panelOpen })),
    setState:              vi.fn(),
    getTarget:             vi.fn(() => {
      let host = document.getElementById("atv-panel-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "atv-panel-host";
        document.body.appendChild(host);
      }
      return host.parentElement;
    }),
  };

  const code = readFileSync(
    resolve(__dirname, "../panel-ui.js"),
    "utf8"
  );

  let panelUi;
  try {
    const fn = new Function(
      "window", "document", "chrome",
      "ATVB_PANEL_VISIBILITY",
      `
        const module = { exports: {} };
        ${code}
        const factory = window.ATVB?.panelUi?.createPanelUi;
        if (!factory) return null;
        return factory({
          state: { panelOpen: false, contentSettings: { panelDefaultOpen: true } },
          getTarget: window.__testGetTarget,
          getLiveDebugLogFilter: () => "",
          getDebugLogText: () => "",
          clearDebugLogs: () => {},
          sendToBackground: () => {},
          applyLayout: () => {},
          logContent: () => {},
          renderCurrentSnapshot: () => {},
          renderPanel: () => {},
          getSubtitleView: () => null,
          rebuildSubtitleBlocksForPanelOpen: () => {},
        });
      `
    );

    // getTarget をグローバル経由で渡す（new Function のスコープ制限回避）
    window.__testGetTarget = stubs.getTarget;

    panelUi = fn(window, document, chromeMock, window.ATVB_PANEL_VISIBILITY);
  } catch (_e) {
    panelUi = null;
  }


  return { window, document, panelUi, stubs };
}

function addToggleButton(document, { display = "", right = "0px" } = {}) {
  const btn = document.createElement("button");
  btn.id = "atv-toggle-btn";
  btn.style.display = display;
  btn.style.right = right;
  document.body.appendChild(btn);
  return btn;
}

// =============================================================
// updateToggleButton の display 制御
// =============================================================

describe("updateToggleButton: OFF 時は display:none を設定する (Step 3-A)", () => {
  let env;

  beforeEach(() => {
    env = makeEnv({ panelOpen: false });
  });

  afterEach(() => {
    env.document.body.innerHTML = "";
  });

  it("applyPanelVisibility(false) 後にトグルボタンが display:none になる", () => {
    addToggleButton(env.document, { display: "" });
    env.panelUi?.applyPanelVisibility?.(false);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("none");
  });

  it("applyPanelVisibility(true) 後にトグルボタンが display:'' になる", () => {
    addToggleButton(env.document, { display: "none" });
    env.panelUi?.applyPanelVisibility?.(true);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("");
  });

  it("OFF → ON → OFF と切り替えたとき最終状態が display:none になる", () => {
    addToggleButton(env.document, { display: "" });

    env.panelUi?.applyPanelVisibility?.(false);
    env.panelUi?.applyPanelVisibility?.(true);
    env.panelUi?.applyPanelVisibility?.(false);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("none");
  });

  it("ON → OFF → ON と切り替えたとき最終状態が display:'' になる", () => {
    addToggleButton(env.document, { display: "" });

    env.panelUi?.applyPanelVisibility?.(true);
    env.panelUi?.applyPanelVisibility?.(false);
    env.panelUi?.applyPanelVisibility?.(true);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("");
  });
});

// =============================================================
// applyPanelVisibility の後書き上書きブロック削除の確認（Step 3-B）
// =============================================================

describe("applyPanelVisibility: updateToggleButton 呼び出しが 1 回で display 制御が完結する (Step 3-B)", () => {
  it("applyPanelVisibility(false) 呼び出し後に display:none が維持される", () => {
    const env = makeEnv({ panelOpen: false });
    addToggleButton(env.document, { display: "" });

    env.panelUi?.applyPanelVisibility?.(false);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.display).toBe("none");

    env.document.body.innerHTML = "";
  });
});

// =============================================================
// updateToggleButton の textContent / right 制御
// =============================================================

describe("updateToggleButton: テキスト・right 位置の制御", () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    env.document.body.innerHTML = "";
  });

  it("ON 時はボタンテキストが '‹' になる", () => {
    addToggleButton(env.document);
    env.panelUi?.applyPanelVisibility?.(true);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.textContent).toBe("‹");
  });

  it("OFF 時はボタンテキストが '›' になる", () => {
    addToggleButton(env.document);
    env.panelUi?.applyPanelVisibility?.(false);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.textContent).toBe("›");
  });

  it("OFF 時は right が '0px' になる", () => {
    addToggleButton(env.document, { right: "300px" });
    env.panelUi?.applyPanelVisibility?.(false);

    const btn = env.document.body.querySelector("#atv-toggle-btn");
    expect(btn?.style.right).toBe("0px");
  });
});

// =============================================================
// panelDefaultOpen と panelOpen の責務分離（不変条件）
// =============================================================

describe("applyPanelVisibility: panelDefaultOpen と panelOpen を混同しない", () => {
  it("applyPanelVisibility は chrome.storage.sync（panelDefaultOpen）に書かない", () => {
    const env = makeEnv();
    env.window.chrome.storage.sync = { set: vi.fn(), get: vi.fn() };
    addToggleButton(env.document);

    env.panelUi?.applyPanelVisibility?.(true);
    env.panelUi?.applyPanelVisibility?.(false);

    expect(env.window.chrome.storage.sync.set).not.toHaveBeenCalled();

    env.document.body.innerHTML = "";
  });
});

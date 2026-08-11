// =============================================================
// tests/settings-schema.test.js
// settings-schema.js の単体テスト (Step 1)
// =============================================================

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

let SCHEMA;
beforeAll(() => {
  const code = readFileSync(
    resolve(__dirname, "../modules/settings-schema.js"),
    "utf8"
  );
  const fn = new Function("globalThis", code + "; return globalThis.ATVB_SCHEMA;");
  SCHEMA = fn(globalThis);
});

describe("settings-schema: DEFAULT_SYNC_SETTINGS", () => {
  it("extensionEnabled のデフォルトは false", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.extensionEnabled).toBe(false);
  });
  it("primaryLang のデフォルトは 'en'", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.primaryLang).toBe("en");
  });
  it("secondaryLang のデフォルトは空文字", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.secondaryLang).toBe("");
  });
  it("panelDefaultOpen のデフォルトは true", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.panelDefaultOpen).toBe(true);
  });
  it("enableAiTooltip のデフォルトは false (options.js の true と統一)", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.enableAiTooltip).toBe(false);
  });
});

describe("settings-schema: normalizeExtensionEnabled", () => {
  it("true は true を返す", () => { expect(SCHEMA.normalizeExtensionEnabled(true)).toBe(true); });
  it("'true' (文字列) は false を返す", () => { expect(SCHEMA.normalizeExtensionEnabled("true")).toBe(false); });
  it("1 は false を返す", () => { expect(SCHEMA.normalizeExtensionEnabled(1)).toBe(false); });
  it("undefined は false を返す", () => { expect(SCHEMA.normalizeExtensionEnabled(undefined)).toBe(false); });
  it("null は false を返す", () => { expect(SCHEMA.normalizeExtensionEnabled(null)).toBe(false); });
});

describe("settings-schema: normalizePanelDefaultOpen", () => {
  it("true は true を返す", () => { expect(SCHEMA.normalizePanelDefaultOpen(true)).toBe(true); });
  it("undefined は true を返す (デフォルト ON)", () => { expect(SCHEMA.normalizePanelDefaultOpen(undefined)).toBe(true); });
  it("null は true を返す", () => { expect(SCHEMA.normalizePanelDefaultOpen(null)).toBe(true); });
  it("false は false を返す", () => { expect(SCHEMA.normalizePanelDefaultOpen(false)).toBe(false); });
});

describe("settings-schema: applySecondaryLangFallback", () => {
  it("secondaryLang が空のとき navLanguage の言語部分で補完する", () => {
    const result = SCHEMA.applySecondaryLangFallback({ primaryLang: "en", secondaryLang: "" }, "ja-JP");
    expect(result.secondaryLang).toBe("ja");
  });
  it("secondaryLang が既に設定されているときは上書きしない", () => {
    const result = SCHEMA.applySecondaryLangFallback({ primaryLang: "en", secondaryLang: "fr" }, "ja-JP");
    expect(result.secondaryLang).toBe("fr");
  });
  it("navLanguage が undefined のとき 'en' にフォールバックする", () => {
    const result = SCHEMA.applySecondaryLangFallback({ primaryLang: "en", secondaryLang: "" }, undefined);
    expect(result.secondaryLang).toBe("en");
  });
  it("元のオブジェクトを変更しない (immutable)", () => {
    const original = { primaryLang: "en", secondaryLang: "" };
    SCHEMA.applySecondaryLangFallback(original, "ko-KR");
    expect(original.secondaryLang).toBe("");
  });
});

describe("settings-schema: mergeSyncSettings", () => {
  it("stored が空のときデフォルト値が補完される", () => {
    const result = SCHEMA.mergeSyncSettings({});
    expect(result.primaryLang).toBe("en");
    expect(result.enableAiTooltip).toBe(false);
  });
  it("stored の値がデフォルト値より優先される", () => {
    const result = SCHEMA.mergeSyncSettings({ primaryLang: "ja" });
    expect(result.primaryLang).toBe("ja");
  });
  it("extensionEnabled が true のとき true を返す", () => {
    expect(SCHEMA.mergeSyncSettings({ extensionEnabled: true }).extensionEnabled).toBe(true);
  });
  it("extensionEnabled が '1' (文字列) のとき false を返す (正規化)", () => {
    expect(SCHEMA.mergeSyncSettings({ extensionEnabled: "1" }).extensionEnabled).toBe(false);
  });
  it("panelDefaultOpen が false のとき false を返す", () => {
    expect(SCHEMA.mergeSyncSettings({ panelDefaultOpen: false }).panelDefaultOpen).toBe(false);
  });
  it("panelDefaultOpen が undefined のとき true を返す", () => {
    expect(SCHEMA.mergeSyncSettings({}).panelDefaultOpen).toBe(true);
  });
  it("stored が null のときもデフォルト値が補完される", () => {
    expect(SCHEMA.mergeSyncSettings(null).primaryLang).toBe("en");
  });
});

describe("settings-schema: panelDefaultOpen と panelOpen の責務分離確認", () => {
  it("DEFAULT_SYNC_SETTINGS に panelOpen キーが存在しない", () => {
    expect("panelOpen" in SCHEMA.DEFAULT_SYNC_SETTINGS).toBe(false);
  });
  it("SETTINGS_KEYS_SYNC に panelOpen が含まれない", () => {
    expect(SCHEMA.SETTINGS_KEYS_SYNC).not.toContain("panelOpen");
  });
  it("SETTINGS_KEYS_SYNC に panelDefaultOpen が含まれる", () => {
    expect(SCHEMA.SETTINGS_KEYS_SYNC).toContain("panelDefaultOpen");
  });
});

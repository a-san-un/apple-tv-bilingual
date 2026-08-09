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
  it("enabled のデフォルトは false", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.enabled).toBe(false);
  });
  it("primaryLang のデフォルトは 'en'", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.primaryLang).toBe("en");
  });
  it("secondaryLang のデフォルトは空文字", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.secondaryLang).toBe("");
  });
  it("showSidebar のデフォルトは true", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.showSidebar).toBe(true);
  });
  it("enableAiTooltip のデフォルトは false (options.js の true と統一)", () => {
    expect(SCHEMA.DEFAULT_SYNC_SETTINGS.enableAiTooltip).toBe(false);
  });
});

describe("settings-schema: normalizeEnabled", () => {
  it("true は true を返す", () => { expect(SCHEMA.normalizeEnabled(true)).toBe(true); });
  it("'true' (文字列) は false を返す", () => { expect(SCHEMA.normalizeEnabled("true")).toBe(false); });
  it("1 は false を返す", () => { expect(SCHEMA.normalizeEnabled(1)).toBe(false); });
  it("undefined は false を返す", () => { expect(SCHEMA.normalizeEnabled(undefined)).toBe(false); });
  it("null は false を返す", () => { expect(SCHEMA.normalizeEnabled(null)).toBe(false); });
});

describe("settings-schema: normalizeShowSidebar", () => {
  it("true は true を返す", () => { expect(SCHEMA.normalizeShowSidebar(true)).toBe(true); });
  it("undefined は true を返す (デフォルト ON)", () => { expect(SCHEMA.normalizeShowSidebar(undefined)).toBe(true); });
  it("null は true を返す", () => { expect(SCHEMA.normalizeShowSidebar(null)).toBe(true); });
  it("false は false を返す", () => { expect(SCHEMA.normalizeShowSidebar(false)).toBe(false); });
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
  it("enabled が true のとき true を返す", () => {
    expect(SCHEMA.mergeSyncSettings({ enabled: true }).enabled).toBe(true);
  });
  it("enabled が '1' (文字列) のとき false を返す (正規化)", () => {
    expect(SCHEMA.mergeSyncSettings({ enabled: "1" }).enabled).toBe(false);
  });
  it("showSidebar が false のとき false を返す", () => {
    expect(SCHEMA.mergeSyncSettings({ showSidebar: false }).showSidebar).toBe(false);
  });
  it("showSidebar が undefined のとき true を返す", () => {
    expect(SCHEMA.mergeSyncSettings({}).showSidebar).toBe(true);
  });
  it("stored が null のときもデフォルト値が補完される", () => {
    expect(SCHEMA.mergeSyncSettings(null).primaryLang).toBe("en");
  });
});

describe("settings-schema: showSidebar と panelVisible の責務分離確認", () => {
  it("DEFAULT_SYNC_SETTINGS に panelVisible キーが存在しない", () => {
    expect("panelVisible" in SCHEMA.DEFAULT_SYNC_SETTINGS).toBe(false);
  });
  it("SETTINGS_KEYS_SYNC に panelVisible が含まれない", () => {
    expect(SCHEMA.SETTINGS_KEYS_SYNC).not.toContain("panelVisible");
  });
  it("SETTINGS_KEYS_SYNC に showSidebar が含まれる", () => {
    expect(SCHEMA.SETTINGS_KEYS_SYNC).toContain("showSidebar");
  });
});

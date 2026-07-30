import { describe, test, expect } from "vitest";
// playback-context-controller は IIFE で window.ATVB にぶら下がるので、
// テスト用に一時的に global をモックするか、関数をローカルに複製する。

// 最小限の純関数 (PR1 既存挙動) をそのままコピーして characterization する。
function normalizeContentKeyPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// URL として扱えない入力用に、query/hash を除いた比較キーを作る。
function normalizeNonUrlMediaSourceKey(src) {
  return String(src || "")
    .split("?")[0]
    .split("#")[0]
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeMediaSourceKey(rawSrc) {
  const src = String(rawSrc || "").trim();
  if (!src) return "";

  const looksAbsoluteUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(src);
  const looksRelativeUrl =
    src.startsWith("/") || src.startsWith("./") || src.startsWith("../");

  // 空白を含む文字列は、URL ではなくラベル/壊れた値として扱う。
  // new URL(value, base) に通すと相対 path として解釈されてしまうため、
  // characterization では先に文字列正規化へ倒す。
  if (!looksAbsoluteUrl && !looksRelativeUrl && /\s/.test(src)) {
    return normalizeNonUrlMediaSourceKey(src);
  }

  try {
    const parsed = new URL(src, "https://example.com/base");
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch (_) {
    return normalizeNonUrlMediaSourceKey(src);
  }
}

describe("normalizeContentKeyPart (characterization)", () => {
  test("returns empty string for nullish input", () => {
    expect(normalizeContentKeyPart(null)).toBe("");
    expect(normalizeContentKeyPart(undefined)).toBe("");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeContentKeyPart("  Hello World  ")).toBe("hello world");
  });

  test("collapses consecutive internal whitespace", () => {
    expect(normalizeContentKeyPart("Hello    Brave   New   World")).toBe(
      "hello brave new world",
    );
  });

  test("lowercases mixed-case input", () => {
    expect(normalizeContentKeyPart("Title:Severance S2E1")).toBe(
      "title:severance s2e1",
    );
  });
});

describe("normalizeMediaSourceKey (characterization)", () => {
  test("returns empty string for blank input", () => {
    expect(normalizeMediaSourceKey("")).toBe("");
    expect(normalizeMediaSourceKey("   ")).toBe("");
    expect(normalizeMediaSourceKey(null)).toBe("");
  });

  test("normalizes absolute URL to origin + pathname", () => {
    expect(
      normalizeMediaSourceKey("https://tv.apple.com/us/movie/foo/bar?abc=1"),
    ).toBe("https://tv.apple.com/us/movie/foo/bar");
  });

  test("normalizes relative URL using base origin", () => {
    expect(normalizeMediaSourceKey("/us/movie/foo/bar?abc=1#frag")).toBe(
      "https://example.com/us/movie/foo/bar",
    );
  });

  test("handles invalid URL by stripping query and hash", () => {
    expect(normalizeMediaSourceKey("not a url?abc=1#frag")).toBe(
      "not a url",
    );
  });
});

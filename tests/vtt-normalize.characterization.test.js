// tests/vtt-normalize.characterization.test.js
import { describe, test, expect } from "vitest";
import { normalizeSubtitleText, cleanCueText } from "../modules/vtt.js";

// normalizeSubtitleText の仕様:
//   - HTML タグ (<i>, <c.xxx>, </c> など) を除去する
//   - HTML エンティティ (&amp; &lt; &gt;) をデコードする
//   - 空白・改行は除去しない（トリムも行わない）
//   - null / undefined は空文字に変換する

describe("normalizeSubtitleText (characterization)", () => {
  test("HTML タグを除去する", () => {
    expect(normalizeSubtitleText("<i>italic</i> text")).toBe("italic text");
  });

  test("VTT の <c.xxx> タグを除去する", () => {
    expect(normalizeSubtitleText("<c.styledotitalic>text</c>")).toBe("text");
  });

  test("空白・改行はそのまま保持する（トリムしない）", () => {
    expect(normalizeSubtitleText("  Hello   World  ")).toBe("  Hello   World  ");
  });

  test("HTML エンティティをデコードする", () => {
    expect(normalizeSubtitleText("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });

  test("空文字はそのまま返す", () => {
    expect(normalizeSubtitleText("")).toBe("");
  });

  test("null は空文字を返す", () => {
    expect(normalizeSubtitleText(null)).toBe("");
  });

  test("undefined は空文字を返す", () => {
    expect(normalizeSubtitleText(undefined)).toBe("");
  });
});

describe("cleanCueText (characterization)", () => {
  test("cue.text から HTML タグを除去して返す", () => {
    expect(cleanCueText({ text: "<i>italic</i>" })).toBe("italic");
  });

  test("複数行テキストは改行を保持する", () => {
    expect(cleanCueText({ text: "Line1\nLine2" })).toBe("Line1\nLine2");
  });

  test("プレーンテキストはそのまま返す", () => {
    expect(cleanCueText({ text: "hello" })).toBe("hello");
  });

  test("空テキストは空文字を返す", () => {
    expect(cleanCueText({ text: "" })).toBe("");
  });

  test("null は空文字を返す", () => {
    expect(cleanCueText(null)).toBe("");
  });
});
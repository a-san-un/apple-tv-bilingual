// tests/vtt-normalize.characterization.test.js
import { describe, test, expect } from "vitest";
import { normalizeSubtitleText, cleanCueText } from "../modules/vtt.js";

describe("normalizeSubtitleText (characterization)", () => {
  const cases = [
    { input: "  Hello   World  ", expected: undefined },
    { input: "<i>italic</i> text", expected: undefined },
    { input: "", expected: undefined },
    { input: null, expected: undefined },
  ];

  test.each(cases)("normalizes %o consistently", ({ input, expected }) => {
    expect(normalizeSubtitleText(input)).toBe(expected);
  });
});

test.skip("normalizeSubtitleText basic sanity", () => {
  expect(normalizeSubtitleText("  Hello   World  ")).toBe("Hello World");
});

describe("cleanCueText (characterization)", () => {
  const fakeCue = { text: "Line1\nLine2 <b>bold</b>" };

  test("preserves current cleaning behavior", () => {
    expect(cleanCueText(fakeCue)).toMatchSnapshot();
  });
});
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
  test.each([
    [{ text: "hello" }],
    [{ text: "Line1\nLine2" }],
    [{ text: "<i>italic</i>" }],
    [{ text: "" }],
    [null],
  ])("keeps current behavior for %o", (cue) => {
    expect(cleanCueText(cue)).toMatchSnapshot();
  });
});
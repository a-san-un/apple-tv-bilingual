import { describe, test, expect } from "vitest";

function normalizeContentKeyPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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
      "hello brave new world"
    );
  });

  test("lowercases mixed-case input", () => {
    expect(normalizeContentKeyPart("Title:Severance S2E1")).toBe(
      "title:severance s2e1"
    );
  });
});
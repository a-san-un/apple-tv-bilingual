// tests/cue-text.characterization.test.js
import { describe, test, expect } from "vitest";
import {
  findCueAt,
  getCurrentCue,
  getCurrentCueText,
} from "../modules/cue-text.js";

describe("findCueAt (characterization)", () => {
  test("returns nearest active cue when activeCues exist", () => {
    const cue1 = { startTime: 0, endTime: 2, text: "A" };
    const cue2 = { startTime: 2, endTime: 4, text: "B" };
    const track = { activeCues: [cue1, cue2], cues: [cue1, cue2] };

    const result = findCueAt(track, 2.6);
    expect(result).toBe(cue2);
  });

  test("falls back to cues with loose overlap window", () => {
    const cue1 = { startTime: 10, endTime: 12, text: "A" };
    const cue2 = { startTime: 12.2, endTime: 14, text: "B" };
    const track = { activeCues: [], cues: [cue1, cue2] };

    const result = findCueAt(track, 12.1);
    expect(result).toBe(cue2);
  });

  test("returns null when no readable cues exist", () => {
    const track = { activeCues: null, cues: null };
    expect(findCueAt(track, 5)).toBeNull();
  });
});

describe("getCurrentCue (characterization)", () => {
  test("returns first active cue when activeCues exist", () => {
    const cue1 = { startTime: 0, endTime: 2, text: "A" };
    const cue2 = { startTime: 2, endTime: 4, text: "B" };
    const track = { activeCues: [cue1, cue2], cues: [cue1, cue2] };

    const result = getCurrentCue(track, 2.6);
    expect(result).toBe(cue1);
  });

  test("falls back to findCueAt when activeCues is empty", () => {
    const cue1 = { startTime: 10, endTime: 12, text: "A" };
    const cue2 = { startTime: 12.2, endTime: 14, text: "B" };
    const track = { activeCues: [], cues: [cue1, cue2] };

    const result = getCurrentCue(track, 12.1);
    expect(result).toBe(cue2);
  });

  test("returns null when track is missing", () => {
    expect(getCurrentCue(null, 5)).toBeNull();
  });
});

describe("getCurrentCueText (characterization)", () => {
  test("cleans text through injected cleaner", () => {
    const cue = { startTime: 0, endTime: 2, text: "<i>Hello</i>" };
    const track = { activeCues: [cue], cues: [cue] };

    const result = getCurrentCueText(track, 1, {
      cleanCueTextFn: (value) => value?.text?.replace(/<[^>]+>/g, "") ?? "",
    });

    expect(result).toBe("Hello");
  });
});
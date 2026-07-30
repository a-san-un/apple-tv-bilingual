import { describe, test, expect } from "vitest";

function createBuildContentScopedPayload(currentContentKey = "") {
  const state = { currentContentKey };

  return function buildContentScopedPayload(payload = null) {
    const contentKey = String(state.currentContentKey || "").trim();
    const scopedContentKey = contentKey || "content:unknown";

    if (payload == null) {
      return { contentKey: scopedContentKey };
    }

    if (Array.isArray(payload)) {
      return { value: payload, contentKey: scopedContentKey };
    }

    if (typeof payload === "object") {
      return {
        ...payload,
        contentKey:
          String(payload.contentKey || payload.nextContentKey || "").trim() ||
          scopedContentKey,
      };
    }

    return { value: payload, contentKey: scopedContentKey };
  };
}

describe("buildContentScopedPayload (characterization)", () => {
  test("returns fallback contentKey when payload is null and state key is empty", () => {
    const buildContentScopedPayload = createBuildContentScopedPayload("");
    expect(buildContentScopedPayload(null)).toEqual({
      contentKey: "content:unknown",
    });
  });

  test("uses trimmed state currentContentKey when payload is null", () => {
    const buildContentScopedPayload =
      createBuildContentScopedPayload("  media:episode-1  ");

    expect(buildContentScopedPayload(null)).toEqual({
      contentKey: "media:episode-1",
    });
  });

  test("wraps arrays in value and injects scoped contentKey", () => {
    const buildContentScopedPayload =
      createBuildContentScopedPayload("media:episode-1");

    expect(buildContentScopedPayload(["a", "b"])).toEqual({
      value: ["a", "b"],
      contentKey: "media:episode-1",
    });
  });

  test("preserves object payload fields and falls back to scoped contentKey", () => {
    const buildContentScopedPayload =
      createBuildContentScopedPayload("media:episode-1");

    expect(buildContentScopedPayload({ foo: "bar" })).toEqual({
      foo: "bar",
      contentKey: "media:episode-1",
    });
  });

  test("prefers explicit payload contentKey or nextContentKey over scoped contentKey", () => {
    const buildContentScopedPayload =
      createBuildContentScopedPayload("media:episode-1");

    expect(
      buildContentScopedPayload({
        foo: "bar",
        nextContentKey: "  title:override  ",
      })
    ).toEqual({
      foo: "bar",
      nextContentKey: "  title:override  ",
      contentKey: "title:override",
    });
  });
});
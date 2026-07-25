// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-track-resolver.js
// version: 2.6.3
// 役割: 字幕トラック選定（resolver）責務を担当する。
// Phase B: content.js から resolver 関連関数を切り出して window.ATVB.resolver で公開する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  function normalizeTrackLabel(label) {
    return String(label || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  const ISO_639_2_TO_1 = Object.freeze({
    deu: "de",
    jpn: "ja",
    zho: "zh",
    chi: "zh",
    kor: "ko",
    fra: "fr",
    fre: "fr",
    spa: "es",
  });

  function normalizeTrackLanguage(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

    if (!normalized) return "";

    const parts = normalized.split("-");
    const base = parts[0] || "";
    const mappedBase = ISO_639_2_TO_1[base] || base;

    if (parts.length === 1) return mappedBase;
    return `${mappedBase}-${parts.slice(1).join("-")}`;
  }

  function matchesRequestedLanguage(track, requestedLang) {
    const lang = normalizeTrackLanguage(track?.language);
    const requested = normalizeTrackLanguage(requestedLang);

    if (!lang || !requested) return false;

    // Chinese family handling:
    // zh should match zh, zh-Hans, zh-Hant, zh-CN, zh-TW, etc.
    if (requested === "zh") {
      return lang === "zh" || lang.startsWith("zh-");
    }

    return lang === requested || lang.startsWith(`${requested}-`);
  }

  function isForcedLikeTrack(track) {
    const label = normalizeTrackLabel(track?.label).toLowerCase();
    return /\(forced\)|forced/.test(label);
  }

  function getUniqueTracks(textTracks) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < (textTracks?.length || 0); i++) {
      const t = textTracks[i];
      if (t.kind !== "subtitles" && t.kind !== "captions") continue;
      if (isForcedLikeTrack(t)) continue;
      const key = `${t.language}::${normalizeTrackLabel(t.label)}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          index: i,
          lang: t.language,
          label: normalizeTrackLabel(t.label),
          track: t,
        });
      }
    }
    return result;
  }

  function getTrackCuesLength(track) {
    try {
      return track?.cues ? track.cues.length : 0;
    } catch {
      return 0;
    }
  }

  function getTrackActiveCuesLength(track) {
    try {
      return track?.activeCues ? track.activeCues.length : 0;
    } catch {
      return 0;
    }
  }

  function hasCueOverlapAtTime(track, now) {
    if (!Number.isFinite(now)) return false;

    try {
      const cues = track?.cues;
      if (!cues || cues.length === 0) return false;

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (!cue) continue;
        if (cue.startTime <= now && now <= cue.endTime) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  function scoreSubtitleTrack(track, index) {
    const cuesLength = getTrackCuesLength(track);
    const activeCuesLength = getTrackActiveCuesLength(track);

    let score = 0;

    if (track.kind === "subtitles") score += 20;
    if (track.mode !== "disabled") score += 10;

    // Most important: avoid empty duplicate tracks.
    if (cuesLength > 0) score += 1000;

    // Prefer tracks currently producing text.
    if (activeCuesLength > 0) score += 200;

    // Small tie-breaker: more cues is usually the real content track.
    score += Math.min(cuesLength, 100);

    // Very small tie-breaker: later indices often looked more "real" in this Apple TV+ case.
    score += index * 0.001;

    return score;
  }

  function pickBestSubtitleTrack(textTracks, requestedLang, currentTime = null) {
    const tracks = Array.from(textTracks || []);
    const candidates = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => {
        const isSubtitleKind =
          track.kind === "subtitles" || track.kind === "captions";
        if (!isSubtitleKind) return false;
        if (isForcedLikeTrack(track)) return false;
        return matchesRequestedLanguage(track, requestedLang);
      });

    if (candidates.length === 0) {
      return null;
    }

    const overlapCandidate = Number.isFinite(currentTime)
      ? candidates.find(({ track }) =>
          hasCueOverlapAtTime(track, currentTime),
        ) || null
      : null;

    if (overlapCandidate) {
      return overlapCandidate.track;
    }

    candidates.sort((a, b) => {
      return (
        scoreSubtitleTrack(b.track, b.index) -
        scoreSubtitleTrack(a.track, a.index)
      );
    });

    return candidates[0].track;
  }

  function getSecondarySubtitleTrackCandidates(video, requestedLang) {
    const tracks = Array.from(video?.textTracks || []);
    const currentTime = Number(video?.currentTime ?? NaN);

    return tracks.map((track, index) => ({
      index,
      language: track?.language || "",
      label: normalizeTrackLabel(track?.label),
      kind: track?.kind || "",
      mode: track?.mode || "",
      cuesLength: getTrackCuesLength(track),
      activeCuesLength: getTrackActiveCuesLength(track),
      matchesRequestedLanguage: matchesRequestedLanguage(track, requestedLang),
      forcedLike: isForcedLikeTrack(track),
      hasCueOverlapAtCurrentTime: hasCueOverlapAtTime(track, currentTime),
      score: scoreSubtitleTrack(track, index),
    }));
  }

  function resolveSecondarySubtitleTrack(video, requestedLang) {
    if (!video || !video.textTracks) return null;

    const currentTime = Number(video.currentTime ?? NaN);
    const selectedTrack = pickBestSubtitleTrack(
      video.textTracks,
      requestedLang,
      currentTime,
    );

    if (!selectedTrack) {
      return null;
    }

    // secondary 用 track は「読める状態」を優先する。
    // disabled だけは hidden に持ち上げるが、
    // hidden / showing はトラック側の自然な状態を尊重する。
    try {
      if (selectedTrack.mode === "disabled") {
        selectedTrack.mode = "hidden";
      }
    } catch (_) {}

    window.ATVB?.logger?.debug?.("secondary resolver selected track", {
      requestedLang,
      currentTime,
      language: selectedTrack?.language ?? "",
      label: normalizeTrackLabel(selectedTrack?.label),
      kind: selectedTrack?.kind ?? "",
      mode: selectedTrack?.mode ?? "",
      cuesLength: getTrackCuesLength(selectedTrack),
      activeCuesLength: getTrackActiveCuesLength(selectedTrack),
      hasCueOverlapAtCurrentTime: hasCueOverlapAtTime(
        selectedTrack,
        currentTime,
      ),
    });

    return selectedTrack;
  }

  window.ATVB.resolver = {
    normalizeTrackLabel,
    normalizeTrackLanguage,
    matchesRequestedLanguage,
    isForcedLikeTrack,
    getUniqueTracks,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    hasCueOverlapAtTime,
    scoreSubtitleTrack,
    pickBestSubtitleTrack,
    getSecondarySubtitleTrackCandidates,
    resolveSecondarySubtitleTrack,
  };
})();
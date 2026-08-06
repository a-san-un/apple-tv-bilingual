// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-track-resolver.js
// version: 2.6.3
//
// 役割:
// - 字幕トラック選定（resolver）責務を担当する。
// - requested language と textTracks の照合・候補化・最終選定を一箇所へ集約する。
// - content.js から resolver 関連関数を切り出して window.ATVB.resolver で公開する。
//
// このファイルのメンテナンス方針:
// - 言語一致ロジックは matchesRequestedLanguage() に寄せる。
// - track.language だけでなく track.label も補助情報として扱う。
// - Apple TV+ 側の language 表記ゆれ（ko / ko-KR / kor / Korean など）を
//   resolver 内で吸収し、呼び出し側に表記差異を漏らさない。
// - forced 判定・候補列挙・スコアリング・最終選定を関数単位で分離し、
//   問題発生時にログと比較条件を追いやすくする。
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

  // label 側の自然言語表記から BCP47 の短い言語コードへ寄せる。
  // resolver の比較では track.language を第一優先にしつつ、
  // language が弱いケースの補助判定としてのみ使う。
  const LABEL_LANGUAGE_ALIASES = Object.freeze([
    { pattern: /\bkorean\b|한국어/i, lang: "ko" },
    { pattern: /\bjapanese\b|日本語/i, lang: "ja" },
    { pattern: /\benglish\b|英語/i, lang: "en" },
    { pattern: /\bchinese\b|中文|汉语|漢語/i, lang: "zh" },
    { pattern: /\bfrench\b|français/i, lang: "fr" },
    { pattern: /\bspanish\b|español/i, lang: "es" },
    { pattern: /\bgerman\b|deutsch/i, lang: "de" },
  ]);

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

  // language 属性が弱い / 空のときに備えて label から言語を補助推定する。
  // ここで返す値は短い代表コード（ko, ja, en, zh ...）に揃える。
  function inferLanguageFromLabel(label) {
    const normalizedLabel = normalizeTrackLabel(label);
    if (!normalizedLabel) return "";

    for (const entry of LABEL_LANGUAGE_ALIASES) {
      if (entry.pattern.test(normalizedLabel)) {
        return entry.lang;
      }
    }

    return "";
  }

  // requested language と track の一致判定を一箇所に集約する。
  // 優先順位は以下:
  // 1) track.language の正規化値
  // 2) track.label からの補助推定値
  //
  // zh 系は zh-Hans / zh-Hant などの派生をまとめて扱う。
  // それ以外も ko と ko-KR のような region 付き派生を prefix 一致で許容する。
  function matchesRequestedLanguage(track, requestedLang) {
    const requested = normalizeTrackLanguage(requestedLang);
    const lang = normalizeTrackLanguage(track?.language);
    const inferredFromLabel = inferLanguageFromLabel(track?.label);

    if (!requested) return false;

    const candidates = [lang, inferredFromLabel].filter(Boolean);
    if (candidates.length === 0) return false;

    if (requested === "zh") {
      return candidates.some(
        (candidate) => candidate === "zh" || candidate.startsWith("zh-"),
      );
    }

    return candidates.some(
      (candidate) =>
        candidate === requested || candidate.startsWith(`${requested}-`),
    );
  }

  function isForcedLikeTrack(track) {
    const label = normalizeTrackLabel(track?.label).toLowerCase();
    return /\\(forced\\)|forced/.test(label);
  }

  // GET_LANGUAGES 用の候補一覧は、resolver 内で正規化済みの lang / label を返す。
  // UI 側が表記ゆれの生データに依存しないよう、ここでなるべく整える。
  function getUniqueTracks(textTracks) {
    const seen = new Set();
    const result = [];

    for (let i = 0; i < (textTracks?.length || 0); i++) {
      const t = textTracks[i];
      if (t.kind !== "subtitles" && t.kind !== "captions") continue;
      if (isForcedLikeTrack(t)) continue;

      const normalizedLanguage = normalizeTrackLanguage(t.language);
      const normalizedLabel = normalizeTrackLabel(t.label);
      const inferredLanguage = inferLanguageFromLabel(normalizedLabel);
      const displayLanguage = normalizedLanguage || inferredLanguage || "";
      const key = `${displayLanguage}::${normalizedLabel}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          index: i,
          lang: displayLanguage,
          label: normalizedLabel,
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

  function getCurrentCueTextLength(track, now) {
    if (!track || !Number.isFinite(now)) return 0;

    try {
      const cues = track?.cues;
      if (!cues || cues.length === 0) return 0;

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (!cue) continue;
        if (cue.startTime <= now && now <= cue.endTime) {
          return String(cue.text || "").trim().length;
        }
      }
    } catch {
      return 0;
    }

    return 0;
  }

  function scoreSubtitleTrack(track, index, currentTime = null) {
    const cuesLength = getTrackCuesLength(track);
    const activeCuesLength = getTrackActiveCuesLength(track);
    const hasCueOverlap =
      Number.isFinite(currentTime) && hasCueOverlapAtTime(track, currentTime);
    const currentCueTextLength =
      Number.isFinite(currentTime)
        ? getCurrentCueTextLength(track, currentTime)
        : 0;

    let score = 0;

    if (track.kind === "subtitles") score += 20;
    if (track.kind === "captions") score += 10;
    if (track.mode !== "disabled") score += 10;

    // 最優先: いま実際に読める track。
    if (activeCuesLength > 0) score += 5000;
    if (hasCueOverlap) score += 3000;
    if (currentCueTextLength > 0) score += 2000;

    // 次点: cues を持つ実体 track。
    if (cuesLength > 0) score += 1000;

    // tie-breaker: cues 数が多い方が本体 track であることが多い。
    score += Math.min(cuesLength, 200);

    // Apple TV+ の duplicate 対策として index は最後の微調整だけにする。
    score += index * 0.001;

    return score;
  }

  // requested language に一致する track だけを候補化し、
  // 「今読める候補」→「cues を持つ候補」→「全候補」の順で最良候補を返す。
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

    const readableNowCandidates = candidates.filter(({ track }) => {
      const activeCuesLength = getTrackActiveCuesLength(track);
      const hasCueOverlap =
        Number.isFinite(currentTime) && hasCueOverlapAtTime(track, currentTime);
      const currentCueTextLength =
        Number.isFinite(currentTime)
          ? getCurrentCueTextLength(track, currentTime)
          : 0;

      return (
        activeCuesLength > 0 ||
        hasCueOverlap ||
        currentCueTextLength > 0
      );
    });

    const cuesBackedCandidates = candidates.filter(
      ({ track }) => getTrackCuesLength(track) > 0,
    );

    const effectiveCandidates =
      readableNowCandidates.length > 0
        ? readableNowCandidates
        : cuesBackedCandidates.length > 0
          ? cuesBackedCandidates
          : candidates;

    effectiveCandidates.sort((a, b) => {
      return (
        scoreSubtitleTrack(b.track, b.index, currentTime) -
        scoreSubtitleTrack(a.track, a.index, currentTime)
      );
    });

    return effectiveCandidates[0]?.track || null;
  }

  function getSecondarySubtitleTrackCandidates(video, requestedLang) {
    const tracks = Array.from(video?.textTracks || []);
    const currentTime = Number(video?.currentTime ?? NaN);

    const candidates = tracks.map((track, index) => ({
      track,
      index,
      language: track?.language || "",
      normalizedLanguage: normalizeTrackLanguage(track?.language),
      inferredLanguageFromLabel: inferLanguageFromLabel(track?.label),
      label: normalizeTrackLabel(track?.label),
      kind: track?.kind || "",
      mode: track?.mode || "",
      cuesLength: getTrackCuesLength(track),
      activeCuesLength: getTrackActiveCuesLength(track),
      currentCueTextLength: getCurrentCueTextLength(track, currentTime),
      matchesRequestedLanguage: matchesRequestedLanguage(track, requestedLang),
      forcedLike: isForcedLikeTrack(track),
      hasCueOverlapAtCurrentTime: hasCueOverlapAtTime(track, currentTime),
      score: scoreSubtitleTrack(track, index, currentTime),
    }));

    const subtitleCandidates = candidates.filter(
      (candidate) =>
        (candidate.kind === "subtitles" || candidate.kind === "captions") &&
        !candidate.forcedLike,
    );

    const matchedCandidates = subtitleCandidates.filter(
      (candidate) => candidate.matchesRequestedLanguage,
    );

    return (matchedCandidates.length > 0
      ? matchedCandidates
      : subtitleCandidates
    ).sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
  }

  function resolveSecondarySubtitleTrack(video, requestedLang) {
    if (!video || !video.textTracks) return null;

    const currentTime = Number(video.currentTime ?? NaN);

    window.ATVB?.logger?.logContent(
      "subtitle",
      "secondary resolver candidates",
      {
        requestedLang,
        currentTime,
        candidates: getSecondarySubtitleTrackCandidates(video, requestedLang),
      },
    );

    const selectedTrack = pickBestSubtitleTrack(
      video.textTracks,
      requestedLang,
      currentTime,
    );

    if (!selectedTrack) {
      window.ATVB?.logger?.logContent(
        "subtitle",
        "secondary resolver selected track",
        {
          requestedLang,
          currentTime,
          selectedTrackExists: false,
        },
      );
      return null;
    }

    try {
      if (selectedTrack.mode === "disabled") {
        selectedTrack.mode = "showing";  // cuechange を確実に発火させる
      }
    } catch (_) {}

    const cuesLength = getTrackCuesLength(selectedTrack);
    const activeCuesLength = getTrackActiveCuesLength(selectedTrack);
    const hasCueOverlapAtCurrentTime = hasCueOverlapAtTime(
      selectedTrack,
      currentTime,
    );
    const currentCueTextLength = getCurrentCueTextLength(
      selectedTrack,
      currentTime,
    );
    const sameTrackUnreadableNow =
      cuesLength > 0 &&
      activeCuesLength === 0 &&
      !hasCueOverlapAtCurrentTime &&
      currentCueTextLength === 0;

    const trackHasNoCues = cuesLength === 0;
    const requestedTrackButEmpty =
      matchesRequestedLanguage(selectedTrack, requestedLang) && trackHasNoCues;

    window.ATVB?.logger?.logContent(
      "subtitle",
      "secondary resolver readability",
      {
        requestedLang,
        currentTime,
        language: selectedTrack?.language ?? "",
        normalizedLanguage: normalizeTrackLanguage(selectedTrack?.language),
        inferredLanguageFromLabel: inferLanguageFromLabel(selectedTrack?.label),
        label: normalizeTrackLabel(selectedTrack?.label),
        kind: selectedTrack?.kind ?? "",
        mode: selectedTrack?.mode ?? "",
        cuesLength,
        activeCuesLength,
        hasCueOverlapAtCurrentTime,
        currentCueTextLength,
        sameTrackUnreadableNow,
        trackHasNoCues,
        requestedTrackButEmpty,
      },
    );

    if (requestedTrackButEmpty) {
      window.ATVB?.logger?.logContent(
        "subtitle",
        "secondary resolver pending empty requested track",
        {
          requestedLang,
          normalizedRequestedLang: normalizeTrackLanguage(requestedLang),
          currentTime,
          language: selectedTrack?.language ?? "",
          normalizedLanguage: normalizeTrackLanguage(selectedTrack?.language),
          inferredLanguageFromLabel: inferLanguageFromLabel(selectedTrack?.label),
          label: normalizeTrackLabel(selectedTrack?.label),
          kind: selectedTrack?.kind ?? "",
          mode: selectedTrack?.mode ?? "",
          cuesLength,
          activeCuesLength,
          hasCueOverlapAtCurrentTime,
          currentCueTextLength,
          sameTrackUnreadableNow,
          trackHasNoCues,
        },
      );
    }

    window.ATVB?.logger?.logContent(
      "subtitle",
      "secondary resolver selected track",
      {
        requestedLang,
        normalizedRequestedLang: normalizeTrackLanguage(requestedLang),
        currentTime,
        language: selectedTrack?.language ?? "",
        normalizedLanguage: normalizeTrackLanguage(selectedTrack?.language),
        inferredLanguageFromLabel: inferLanguageFromLabel(selectedTrack?.label),
        label: normalizeTrackLabel(selectedTrack?.label),
        kind: selectedTrack?.kind ?? "",
        mode: selectedTrack?.mode ?? "",
        cuesLength,
        activeCuesLength,
        hasCueOverlapAtCurrentTime,
        currentCueTextLength,
        sameTrackUnreadableNow,
        selectedTrackExists: true,
      },
    );

    return selectedTrack;
  }

  function resolveRequestedSubtitleTrack(textTracks, requestedLang, currentTime = null) {
    return pickBestSubtitleTrack(textTracks, requestedLang, currentTime);
  }

  window.ATVB.resolver = {
    normalizeTrackLabel,
    normalizeTrackLanguage,
    inferLanguageFromLabel,
    matchesRequestedLanguage,
    isForcedLikeTrack,
    getUniqueTracks,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    hasCueOverlapAtTime,
    getCurrentCueTextLength,
    scoreSubtitleTrack,
    pickBestSubtitleTrack,
    getSecondarySubtitleTrackCandidates,
    resolveSecondarySubtitleTrack,
    resolveRequestedSubtitleTrack,
  };
})();

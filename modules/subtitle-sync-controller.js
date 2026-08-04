// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-sync-controller.js
//
// 役割:
// - secondary 字幕の同期処理をまとめる。
// - resolver が選んだ候補 track を 1 本ずつ showing に上げて cues を温める。
// - cue が載った候補を再評価し、secondary bind 用の track を確定する。
// - showing ベースで成立しない作品だけ、最後に native menu sync へフォールバックする。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  function createSubtitleSyncController({
    state,
    services = {},
  }) {
    const {
      logContent,
      resolver,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
      pollIntervalMs = 100,
      activationHoldMs = 500,
      activationTimeoutMs = 1500,
    } = services;

    // cue が実際に読める track かを判定するため、
    // 現在の読取可能性をまとめて返す。
    function getTrackReadability(track, currentTime = NaN) {
      if (!track) {
        return {
          cuesLength: 0,
          activeCuesLength: 0,
          currentCueTextLength: 0,
          hasCueOverlapAtCurrentTime: false,
          readable: false,
        };
      }

      const cuesLength = resolver?.getTrackCuesLength?.(track) ?? 0;
      const activeCuesLength = resolver?.getTrackActiveCuesLength?.(track) ?? 0;
      const currentCueTextLength = Number.isFinite(currentTime)
        ? resolver?.getCurrentCueTextLength?.(track, currentTime) ?? 0
        : 0;
      const hasCueOverlapAtCurrentTime = Number.isFinite(currentTime)
        ? Boolean(resolver?.hasCueOverlapAtTime?.(track, currentTime))
        : false;

      const readable = Boolean(
        cuesLength > 0 ||
          activeCuesLength > 0 ||
          currentCueTextLength > 0 ||
          hasCueOverlapAtCurrentTime,
      );

      return {
        cuesLength,
        activeCuesLength,
        currentCueTextLength,
        hasCueOverlapAtCurrentTime,
        readable,
      };
    }

    // ポーリングや mode 切り替えの間で短く待機するための
    // 小さな sleep ユーティリティ。
    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // 指定言語に一致する secondary 候補を、
    // resolver のスコア順で並べて返す。
    function getOrderedSecondaryCandidates(video, requestedLang) {
      const candidates = resolver?.getSecondarySubtitleTrackCandidates?.(
        video,
        requestedLang,
      );

      if (!Array.isArray(candidates) || candidates.length === 0) {
        return [];
      }

      return [...candidates]
        .filter((candidate) => candidate?.track && candidate?.matchesRequestedLanguage)
        .sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
    }

    // 1 本の候補 track を一時的に showing にして、
    // cue が載るかを一定時間だけ監視する。
    async function warmTrackWithShowing(track, context = {}) {
      if (!track) return null;

      const {
        requestedLang = "",
        reason = "secondary-sync",
        currentTime = NaN,
      } = context;

      const previousMode = track.mode;
      const startedAt = Date.now();

      try {
        track.mode = "showing";
      } catch (error) {
        logContent?.("subtitle sync showing warmup failed to switch mode", {
          reason,
          requestedLang,
          previousMode,
          error: String(error?.message || error),
        });
        return null;
      }

      logContent?.("subtitle sync showing warmup started", {
        reason,
        requestedLang,
        previousMode,
        currentMode: track.mode,
        activationTimeoutMs,
        language: track.language ?? "",
        label: track.label ?? "",
      });

      const deadline = startedAt + activationTimeoutMs;
      while (Date.now() < deadline) {
        const readability = getTrackReadability(track, currentTime);
        if (readability.readable) {
          logContent?.("subtitle sync showing warmup readable", {
            reason,
            requestedLang,
            elapsedMs: Date.now() - startedAt,
            language: track.language ?? "",
            label: track.label ?? "",
            ...readability,
          });

          return {
            track,
            previousMode,
            readability,
          };
        }

        await wait(pollIntervalMs);
      }

      logContent?.("subtitle sync showing warmup timeout", {
        reason,
        requestedLang,
        elapsedMs: Date.now() - startedAt,
        language: track.language ?? "",
        label: track.label ?? "",
      });

      try {
        track.mode = previousMode;
      } catch {}

      return null;
    }

    // secondary 候補を 1 本ずつ showing にして、
    // cue が載る track を探索する。
    async function warmSecondaryCandidatesWithShowing(video, requestedLang) {
      if (!video || !requestedLang) return null;

      const currentTime = Number(video.currentTime ?? NaN);
      const candidates = getOrderedSecondaryCandidates(video, requestedLang);

      if (candidates.length === 0) {
        logContent?.("subtitle sync showing warmup no candidates", {
          requestedLang,
          currentTime,
        });
        return null;
      }

      for (const candidate of candidates) {
        const warmed = await warmTrackWithShowing(candidate.track, {
          requestedLang,
          reason: "secondary-sync",
          currentTime,
        });

        if (warmed?.track) {
          return warmed;
        }
      }

      return null;
    }

    // showing で温めたあと resolver で再選定し、
    // secondary bind 用の track を最終確定する。
    async function syncSecondarySubtitleTrack(video, requestedLang, options = {}) {
      if (!video || !requestedLang) return null;

      const currentTime = Number(video.currentTime ?? NaN);
      const warmed = await warmSecondaryCandidatesWithShowing(video, requestedLang);

      if (warmed?.track) {
        await wait(activationHoldMs);

        const selectedTrack =
          resolver?.resolveSecondarySubtitleTrack?.(video, requestedLang) ||
          warmed.track;

        bindSecondaryTrack?.(selectedTrack, {
          ...options,
          requestedLang,
          reason: "secondary-sync-showing",
        });

        logContent?.("subtitle sync showing selected track", {
          requestedLang,
          currentTime,
          warmedLanguage: warmed.track?.language ?? "",
          warmedLabel: warmed.track?.label ?? "",
          selectedLanguage: selectedTrack?.language ?? "",
          selectedLabel: selectedTrack?.label ?? "",
          selectedMode: selectedTrack?.mode ?? "",
          readability: warmed.readability,
        });

        return selectedTrack;
      }

      logContent?.("subtitle sync showing fallback to native", {
        requestedLang,
        currentTime,
      });

      await syncNativeSubtitleSelection?.({
        primaryLang: options?.primaryLang ?? "",
        secondaryLang: requestedLang,
        preferredSource: requestedLang,
      });

      const fallbackTrack =
        resolver?.resolveSecondarySubtitleTrack?.(video, requestedLang) || null;

      if (fallbackTrack) {
        bindSecondaryTrack?.(fallbackTrack, {
          ...options,
          requestedLang,
          reason: "secondary-sync-native-fallback",
        });
      }

      return fallbackTrack;
    }

    return {
      getTrackReadability,
      getOrderedSecondaryCandidates,
      warmTrackWithShowing,
      warmSecondaryCandidatesWithShowing,
      syncSecondarySubtitleTrack,
    };
  }

  root.createSubtitleSyncController = createSubtitleSyncController;
})();

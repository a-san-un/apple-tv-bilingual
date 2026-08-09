// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-sync-controller.js
//
// 役割:
// - secondary 字幕の同期処理をまとめる。
// - resolver が選んだ secondary track を直接 bind する。
// - bind 前後の readability 情報を補助的に記録する。
// - direct bind で成立しない作品だけ、最後に native menu sync へフォールバックする。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  function createSubtitleSyncController({ state, services = {} }) {
    const {
      logContent,
      resolver,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
    } = services;

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

    async function syncSecondarySubtitleTrack(
      video,
      requestedLang,
      options = {},
    ) {
      if (!video || !requestedLang) return null;

      const currentTime = Number(video.currentTime ?? NaN);
      const selectedTrack =
        resolver?.resolveSecondarySubtitleTrack?.(video, requestedLang) || null;

      if (selectedTrack) {
        const readability = getTrackReadability(selectedTrack, currentTime);

        bindSecondaryTrack?.(selectedTrack, {
          ...options,
          requestedLang,
          reason: "secondary-sync-direct-bind",
        });

        state.secondaryTrack = selectedTrack || null;

        logContent?.("subtitle sync direct selected track", {
          requestedLang,
          currentTime,
          selectedLanguage: selectedTrack?.language ?? "",
          selectedLabel: selectedTrack?.label ?? "",
          selectedMode: selectedTrack?.mode ?? "",
          readability,
        });

        return selectedTrack;
      }

      logContent?.("subtitle sync direct fallback to native", {
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

      state.secondaryTrack = fallbackTrack || null;

      return fallbackTrack;
    }

    return {
      getTrackReadability,
      syncSecondarySubtitleTrack,
    };
  }

  root.subtitleSyncController = root.subtitleSyncController || {};
  root.subtitleSyncController.createSubtitleSyncController =
    createSubtitleSyncController;
})();

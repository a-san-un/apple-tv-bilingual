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
      createSyncIntervalOrchestrator,
    } = services;
    let syncIntervalOrchestrator = null;

    function ensureSyncIntervalOrchestrator(factoryArgs) {
      if (syncIntervalOrchestrator) return syncIntervalOrchestrator;
      if (typeof createSyncIntervalOrchestrator !== "function") return null;

      syncIntervalOrchestrator =
        createSyncIntervalOrchestrator(factoryArgs || {}) || null;

      logContent?.("subtitleSyncController.ensureSyncIntervalOrchestrator", {
        available: Boolean(syncIntervalOrchestrator),
      });

      return syncIntervalOrchestrator;
    }

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

    async function waitForReadableTrack(track, options = {}) {
      const {
        currentTime = NaN,
        maxWaitMs = 350,
        intervalMs = 50,
      } = options;

      if (!track) return null;

      const startedAt = Date.now();
      let lastReadability = getTrackReadability(track, currentTime);

      if (lastReadability.readable) {
        return { track, readability: lastReadability, waitedMs: 0 };
      }

      while (Date.now() - startedAt < maxWaitMs) {
        await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
        lastReadability = getTrackReadability(track, currentTime);
        if (lastReadability.readable) {
          return {
            track,
            readability: lastReadability,
            waitedMs: Date.now() - startedAt,
          };
        }
      }

      return {
        track,
        readability: lastReadability,
        waitedMs: Date.now() - startedAt,
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
        const warmupResult = await waitForReadableTrack(selectedTrack, {
          currentTime,
          maxWaitMs: 350,
          intervalMs: 50,
        });
        const readability =
          warmupResult?.readability ||
          getTrackReadability(selectedTrack, currentTime);

        bindSecondaryTrack?.(selectedTrack, {
          ...options,
          requestedLang,
          reason: readability.readable
            ? "secondary-sync-direct-bind:readable"
            : "secondary-sync-direct-bind:unreadable",
        });

        state.secondaryTrack = selectedTrack || null;

        if (false) {
          if (false) logContent?.("subtitle sync direct selected track", {
            requestedLang,
            currentTime,
            selectedLanguage: selectedTrack?.language ?? "",
            selectedLabel: selectedTrack?.label ?? "",
            selectedMode: selectedTrack?.mode ?? "",
            readability,
          });
        }

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
      ensureSyncIntervalOrchestrator,
    };
  }

  root.subtitleSyncController = root.subtitleSyncController || {};
  root.subtitleSyncController.createSubtitleSyncController =
    createSubtitleSyncController;
})();

// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-sync-controller.js
//
// 役割: secondary 字幕の selection / direct bind / native fallback を集約する (Step 1)
//
// 依存:
//   - resolver:
//       resolveSecondarySubtitleTrack
//       matchesRequestedLanguage
//       isForcedLikeTrack
//       getTrackCuesLength
//       getTrackActiveCuesLength
//       getCurrentCueTextLength
//       hasCueOverlapAtTime
//   - bindSecondaryTrack
//   - syncNativeSubtitleSelection
//   - createSyncIntervalOrchestrator
//
// 設計原則:
//   - selectSecondarySubtitleTrack() は「どの track を使うか」を返すだけにする。
//   - syncSecondaryTrackBinding() は direct bind と native fallback のみ担当する。
//   - readability は bind 可否の補助情報として保持するが、selection と分離する。
//   - Step 1 では cleanup / monitor 責務はまだ持ち込まない。
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

    // -------------------------------------------------------
    // Orchestrator
    // -------------------------------------------------------

    /** sync interval orchestrator を必要時に一度だけ生成して返す */
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

    // -------------------------------------------------------
    // Readability
    // -------------------------------------------------------

    /** track の cues / activeCues / 現在時刻 overlap から readability snapshot を返す */
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

    /** readability をもとに candidate の優先度を score 化する */
    function scoreCandidateTrack(
      track,
      currentTime = NaN,
      preferredTrack = null,
    ) {
      const readability = getTrackReadability(track, currentTime);

      let score = 0;
      if (readability.hasCueOverlapAtCurrentTime) score += 1000;
      if (readability.currentCueTextLength > 0) score += 500;
      if (readability.activeCuesLength > 0) score += 100;
      if (readability.cuesLength > 0) score += 10;
      if (preferredTrack && track === preferredTrack) score += 1;

      return {
        score,
        readability,
      };
    }

    // -------------------------------------------------------
    // Selection
    // -------------------------------------------------------

    /**
     * secondary track の selection result を返す。
     * Step 1/2: bind や cleanup は行わず、track identity を主軸にした
     * selection result と readability snapshot を返す。
     */
    function selectSecondarySubtitleTrack(
      video,
      requestedLang,
      previousBoundTrack = null,
    ) {
      const currentTime = Number(video?.currentTime ?? NaN);

      if (!video || !requestedLang) {
        return {
          track: null,
          resolvedTrack: null,
          sameTrackRef: false,
          selectedTrackId: "",
          previousTrackId: previousBoundTrack?.id || "",
          requestedLanguageChanged: false,
          currentTime,
          snapshot: getTrackReadability(null, currentTime),
        };
      }

      const resolvedTrack =
        resolver?.resolveSecondarySubtitleTrack?.(video, requestedLang) || null;

      const secondaryCandidates = Array.from(video?.textTracks || []).filter(
        (candidateTrack) => {
          if (!candidateTrack) return false;

          const kind = String(candidateTrack.kind || "").toLowerCase();
          if (kind !== "subtitles" && kind !== "captions") return false;
          if (resolver?.isForcedLikeTrack?.(candidateTrack)) return false;

          return Boolean(
            resolver?.matchesRequestedLanguage?.(candidateTrack, requestedLang),
          );
        },
      );

      let pickedTrack = null;
      let pickedScore = -1;
      let pickedSnapshot = null;

      for (const candidateTrack of secondaryCandidates) {
        const { score, readability } = scoreCandidateTrack(
          candidateTrack,
          currentTime,
          resolvedTrack || previousBoundTrack || null,
        );

        if (score > pickedScore) {
          pickedTrack = candidateTrack;
          pickedScore = score;
          pickedSnapshot = readability;
        }
      }

      const track = pickedTrack || resolvedTrack || null;
      const sameTrackRef = Boolean(track && previousBoundTrack === track);

      const normalizedRequestedLang = String(requestedLang || "")
        .trim()
        .toLowerCase();
      const previousRequestedSecondaryLang = String(
        previousBoundTrack?.language || "",
      )
        .trim()
        .toLowerCase();

      return {
        track,
        resolvedTrack,
        sameTrackRef,
        selectedTrackId: track?.id || "",
        previousTrackId: previousBoundTrack?.id || "",
        requestedLanguageChanged:
          normalizedRequestedLang !== previousRequestedSecondaryLang,
        currentTime,
        snapshot: pickedSnapshot || getTrackReadability(track, currentTime),
      };
    }

    // -------------------------------------------------------
    // Warmup
    // -------------------------------------------------------

    /**
     * direct bind 前に短時間だけ readable 化を待つ。
     * ここでは selection は変えず、同じ track の readability だけ再評価する。
     */
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

    // -------------------------------------------------------
    // Direct bind / fallback
    // -------------------------------------------------------

    /**
     * resolver が選んだ secondary track を direct bind する。
     * direct bind 不成立時のみ native subtitle selection へフォールバックする。
     */
    async function syncSecondaryTrackBinding(
      video,
      requestedLang,
      options = {},
    ) {
      if (!video || !requestedLang) return null;

      const currentTime = Number(video.currentTime ?? NaN);
      const selection = selectSecondarySubtitleTrack(video, requestedLang, null);
      const selectedTrack = selection.track || null;

      if (selectedTrack) {
        await waitForReadableTrack(selectedTrack, {
          currentTime,
          maxWaitMs: 350,
          intervalMs: 50,
        });

        bindSecondaryTrack?.(selectedTrack, {
          ...options,
          requestedLang,
          reason: "secondary-sync-direct-bind",
        });

        state.secondaryTrack = selectedTrack || null;


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
      selectSecondarySubtitleTrack,
      syncSecondaryTrackBinding,
      ensureSyncIntervalOrchestrator,
    };
  }

  root.subtitleSyncController = root.subtitleSyncController || {};
  root.subtitleSyncController.createSubtitleSyncController =
    createSubtitleSyncController;
})();

// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-sync-controller.js
//
// 役割: secondary 字幕の selection / readability / decision /
//       wait-and-bind 後の再評価 / direct bind / native fallback を集約する
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
//   - selectSecondarySubtitleTrack() は「どの track を使うか」を返す。
//   - buildSecondarySyncDecision() は selection / readability /
//     monitor / recovery を統合し、最終 action を返す。
//   - waitForReadableTrack() は readable 化待ちだけを担当する。
//   - resolveSecondaryWaitOutcome() は wait-and-bind 停滞時に
//     最新 state で selection / decision を再評価する。
//   - cue-controller.js は decision の action 実行中心に寄せる。
//   - bind / cleanup / mode restore の実行責務は持ち込まない。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * secondary sync 用の controller API 群を生成する。
   * selection / readability / decision / wait outcome / direct bind / fallback を束ね、
   * cue-controller.js から利用しやすい形で返す。
   */
  function createSubtitleSyncController({ services = {} }) {
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
     * bind や cleanup は行わず、track identity を主軸にした
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

      const allTracks = Array.from(video?.textTracks || []);
      const requestedCandidates = allTracks.filter((track) => {
        if (!track) return false;
        const language = String(track.language || "");
        const label = String(track.label || "");
        const kind = String(track.kind || "");

        return Boolean(
          resolver?.matchesRequestedLanguage?.(
            language,
            label,
            requestedLang,
            kind,
          ),
        );
      });

      const preferredTrack =
        requestedCandidates.find((track) => track === previousBoundTrack) || null;

      const rankedCandidates = requestedCandidates
        .map((track) => ({
          track,
          ...scoreCandidateTrack(track, currentTime, preferredTrack),
        }))
        .sort((a, b) => b.score - a.score);

      const selectedCandidate = rankedCandidates[0] || null;
      const selectedTrack =
        selectedCandidate?.track || resolvedTrack || previousBoundTrack || null;

      const sameTrackRef = Boolean(
        selectedTrack && previousBoundTrack === selectedTrack,
      );

      const selectedTrackId =
        selectedTrack?.id ||
        `${selectedTrack?.language || ""}:${selectedTrack?.label || ""}:${
          selectedTrack?.kind || ""
        }`;

      const previousTrackId =
        previousBoundTrack?.id ||
        `${previousBoundTrack?.language || ""}:${
          previousBoundTrack?.label || ""
        }:${previousBoundTrack?.kind || ""}`;

      const requestedLanguageChanged = Boolean(
        requestedLang &&
          previousBoundTrack &&
          !resolver?.matchesRequestedLanguage?.(
            previousBoundTrack.language || "",
            previousBoundTrack.label || "",
            requestedLang,
            previousBoundTrack.kind || "",
          ),
      );

      return {
        track: selectedTrack,
        resolvedTrack,
        sameTrackRef,
        selectedTrackId,
        previousTrackId,
        requestedLanguageChanged,
        currentTime,
        snapshot: getTrackReadability(selectedTrack, currentTime),
      };
    }

    // -------------------------------------------------------
    // Monitor / Recovery normalization
    // -------------------------------------------------------

    /** monitor 入力を decision 用に正規化する */
    function normalizeSecondaryMonitorState(monitorState, selectedTrack = null) {
      const active = Boolean(monitorState?.active);
      const hasCleanup = typeof monitorState?.cleanup === "function";
      const track = monitorState?.track || null;
      const sameTrack = Boolean(selectedTrack && track && selectedTrack === track);
      const sameMode = String(monitorState?.mode || "") === "hidden";
      const healthy = Boolean(active && hasCleanup && sameTrack && sameMode);
      const stale = Boolean(
        !active || !hasCleanup || (selectedTrack && track && !sameTrack),
      );

      return {
        active,
        hasCleanup,
        track,
        sameTrack,
        sameMode,
        healthy,
        stale,
      };
    }

    /** recovery 入力を decision 用に正規化する */
    function normalizeSecondaryRecoveryState(recoveryState) {
      const requested = Boolean(
        recoveryState?.requested ||
          recoveryState?.shouldRecover ||
          recoveryState?.action === "recover" ||
          recoveryState?.action === "force-rebind" ||
          recoveryState?.recover === true,
      );

      const forceRebind = Boolean(
        recoveryState?.forceRebind ||
          recoveryState?.action === "force-rebind",
      );

      return {
        requested,
        forceRebind,
        reason: String(recoveryState?.reason || recoveryState?.action || ""),
      };
    }

    /** readable 待ちが必要かを判定する */
    function shouldWaitForReadableTrack({
      track,
      snapshot,
      sameTrackRef,
      monitor,
      recovery,
      requestedLanguageChanged,
    }) {
      if (!track) return false;
      if (snapshot?.readable) return false;

      // 同一 track かつ monitor 健全で、recovery 要求もない場合は
      // unreadable 単独で即 rebind しない。
      if (
        sameTrackRef &&
        monitor?.healthy &&
        !recovery?.requested &&
        !requestedLanguageChanged
      ) {
        return false;
      }

      return true;
    }

    // -------------------------------------------------------
    // Decision
    // -------------------------------------------------------

    /**
     * secondary sync の最終 decision を返す。
     * selection / readability / monitor / recovery / 前回との差分を
     * 一箇所で統合し、controller が action 実行だけに専念できる形へ寄せる。
     */
    function buildSecondarySyncDecision({
      video,
      requestedLang,
      previousBoundTrack = null,
      monitorState = null,
      recoveryState = null,
      requestedMode = "hidden",
    } = {}) {
      const selection = selectSecondarySubtitleTrack(
        video,
        requestedLang,
        previousBoundTrack,
      );

      const track = selection.track || null;
      const snapshot = selection.snapshot || getTrackReadability(null);
      const monitor = normalizeSecondaryMonitorState(monitorState, track);
      const recovery = normalizeSecondaryRecoveryState(recoveryState);

      const trackFound = Boolean(track);
      const readable = Boolean(snapshot?.readable);
      const requestedLanguageChanged = Boolean(
        selection.requestedLanguageChanged,
      );
      const sameTrackRef = Boolean(selection.sameTrackRef);

      const shouldClear = !trackFound;
      const needsReadableWait = shouldWaitForReadableTrack({
        track,
        snapshot,
        sameTrackRef,
        monitor,
        recovery,
        requestedLanguageChanged,
      });

      const needsRebind = Boolean(
        trackFound &&
          !needsReadableWait &&
          (
            recovery.forceRebind ||
            requestedLanguageChanged ||
            !sameTrackRef ||
            monitor.stale
          ),
      );

      const canKeepCurrentBinding = Boolean(
        trackFound &&
          sameTrackRef &&
          monitor.healthy &&
          !recovery.requested &&
          !requestedLanguageChanged,
      );

      let actionType = "keep";
      let actionReason = "same-track-healthy";

      if (shouldClear) {
        actionType = "clear";
        actionReason = "track-missing";
      } else if (needsReadableWait) {
        actionType = "wait-and-bind";
        actionReason = "track-unreadable";
      } else if (recovery.forceRebind) {
        actionType = "bind";
        actionReason = "force-rebind";
      } else if (requestedLanguageChanged) {
        actionType = "bind";
        actionReason = "requested-language-changed";
      } else if (!sameTrackRef) {
        actionType = "bind";
        actionReason = "selected-track-changed";
      } else if (monitor.stale) {
        actionType = "bind";
        actionReason = "stale-monitor";
      } else if (canKeepCurrentBinding) {
        actionType = "keep";
        actionReason = "same-track-healthy";
      }

      const decision = {
        track,
        currentTime: selection.currentTime,
        snapshot,

        previous: {
          boundTrack: previousBoundTrack || null,
          boundTrackId: previousBoundTrack?.id || "",
          requestedLang: String(previousBoundTrack?.language || ""),
        },

        selection: {
          resolvedTrack: selection.resolvedTrack || null,
          selectedTrackId: selection.selectedTrackId || "",
          sameTrackRef,
          requestedLanguageChanged,
        },

        monitor,

        recovery,

        derived: {
          trackFound,
          readable,
          shouldClear,
          needsReadableWait,
          needsRebind,
          canKeepCurrentBinding,
        },

        action: {
          type: actionType,
          reason: actionReason,
          requestedMode,
        },
      };

      logContent?.("subtitleSyncController.buildSecondarySyncDecision", {
        requestedLang: String(requestedLang || ""),
        selectedTrackId: decision.selection.selectedTrackId,
        sameTrackRef: decision.selection.sameTrackRef,
        requestedLanguageChanged: decision.selection.requestedLanguageChanged,
        readable: decision.derived.readable,
        monitorHealthy: decision.monitor.healthy,
        monitorStale: decision.monitor.stale,
        recoveryRequested: decision.recovery.requested,
        forceRebind: decision.recovery.forceRebind,
        actionType: decision.action.type,
        actionReason: decision.action.reason,
      });

      return decision;
    }

    // -------------------------------------------------------
    // Wait
    // -------------------------------------------------------

    /**
     * 指定 track が readable になるまで一定時間待つ。
     * readable 判定そのものだけを担当し、最終 action 決定は buildSecondarySyncDecision()
     * または resolveSecondaryWaitOutcome() 側へ委ねる。
     */
    async function waitForReadableTrack(track, options = {}) {
      if (!track) return null;

      const timeoutMs = Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : 1200;
      const intervalMs = Number.isFinite(options.intervalMs)
        ? options.intervalMs
        : 100;
      const currentTime = Number(options.currentTime ?? NaN);
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const snapshot = getTrackReadability(track, currentTime);
        if (snapshot.readable) {
          logContent?.("subtitleSyncController.waitForReadableTrack", {
            readable: true,
            language: track?.language || "",
            label: track?.label || "",
            kind: track?.kind || "",
            timeoutMs,
            intervalMs,
          });
          return track;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      logContent?.("subtitleSyncController.waitForReadableTrack", {
        readable: false,
        language: track?.language || "",
        label: track?.label || "",
        kind: track?.kind || "",
        timeoutMs,
        intervalMs,
      });

      return null;
    }

    /**
     * wait-and-bind の結果を最新 state で再評価する。
     *
     * 目的:
     * - waitForReadableTrack() が失敗したあとも、古い unreadable track 前提で
     *   停滞し続けないようにする。
     * - 言語切替時と拡張 OFF→ON 復帰時の両方で、
     *   最新 track 状態から再 selection・decision 再評価へ進める。
     *
     * 注意:
     * - bind / cleanup / mode restore はここで実行しない。
     * - wait 失敗だけで即 force rebind にはしない。
     * - 最終 action は常に buildSecondarySyncDecision() の結果へ戻す。
     */
    async function resolveSecondaryWaitOutcome({
      video,
      requestedLang,
      previousBoundTrack = null,
      monitorState = null,
      recoveryState = null,
      requestedMode = "hidden",
      waitOptions = {},
    } = {}) {
      const initialDecision = buildSecondarySyncDecision({
        video,
        requestedLang,
        previousBoundTrack,
        monitorState,
        recoveryState,
        requestedMode,
      });

      if (initialDecision.action?.type !== "wait-and-bind") {
        return {
          waited: false,
          waitSucceeded: false,
          waitedTrack: null,
          initialDecision,
          decision: initialDecision,
        };
      }

      const initialTrack = initialDecision.track || null;

      const readableTrack = await waitForReadableTrack(initialTrack, {
        timeoutMs: Number.isFinite(waitOptions?.timeoutMs)
          ? waitOptions.timeoutMs
          : 1200,
        intervalMs: Number.isFinite(waitOptions?.intervalMs)
          ? waitOptions.intervalMs
          : 100,
        currentTime: Number(video?.currentTime ?? NaN),
      });

      const waitSucceeded = Boolean(readableTrack);

      // wait 成否にかかわらず、最新 track 状態で decision を再構築する。
      // これにより、native UI 変更や requested language 変更後に
      // 新しい候補 track が見えるようになったケースを拾える。
      const latestDecision = buildSecondarySyncDecision({
        video,
        requestedLang,
        previousBoundTrack,
        monitorState,
        recoveryState,
        requestedMode,
      });

      logContent?.("subtitleSyncController.resolveSecondaryWaitOutcome", {
        requestedLang: String(requestedLang || ""),
        waitSucceeded,
        waitedTrackLanguage: readableTrack?.language || "",
        waitedTrackLabel: readableTrack?.label || "",
        initialActionType: initialDecision.action?.type || "",
        initialActionReason: initialDecision.action?.reason || "",
        latestActionType: latestDecision.action?.type || "",
        latestActionReason: latestDecision.action?.reason || "",
        latestSelectedTrackId: latestDecision.selection?.selectedTrackId || "",
        latestReadable: Boolean(latestDecision.snapshot?.readable),
      });

      return {
        waited: true,
        waitSucceeded,
        waitedTrack: readableTrack || null,
        initialDecision,
        decision: latestDecision,
      };
    }

    // -------------------------------------------------------
    // Direct bind / fallback
    // -------------------------------------------------------

    /**
     * secondary track を resolver ベースで直接 bind する。
     * Step 7 の主経路は buildSecondarySyncDecision() + cue-controller.js orchestration
     * だが、一部の起動直後や fallback 経路では直接 bind が必要なため残している。
     */
    async function syncSecondaryTrackDirectly(video, requestedLang, options = {}) {
      if (!video || !requestedLang) return null;
      if (typeof bindSecondaryTrack !== "function") return null;

      const selection = selectSecondarySubtitleTrack(video, requestedLang, null);
      const selectedTrack = selection.track || null;

      if (!selectedTrack) {
        logContent?.("subtitleSyncController.syncSecondaryTrackDirectly", {
          requestedLang,
          bound: false,
          reason: "track-missing",
        });
        return null;
      }

      const readableTrack =
        selection.snapshot?.readable
          ? selectedTrack
          : await waitForReadableTrack(selectedTrack, {
              timeoutMs: options.timeoutMs,
              intervalMs: options.intervalMs,
              currentTime: selection.currentTime,
            });

      if (!readableTrack) {
        logContent?.("subtitleSyncController.syncSecondaryTrackDirectly", {
          requestedLang,
          bound: false,
          reason: "track-unreadable",
          selectedTrackId: selection.selectedTrackId || "",
        });
        return null;
      }

      const binding = await bindSecondaryTrack(readableTrack, {
        requestedMode: options.requestedMode || "hidden",
        reason: options.reason || "subtitle-sync-controller-direct-bind",
      });

      logContent?.("subtitleSyncController.syncSecondaryTrackDirectly", {
        requestedLang,
        bound: Boolean(binding),
        selectedTrackId: selection.selectedTrackId || "",
        readable: true,
      });

      return binding || null;
    }

    /**
     * native 字幕選択への fallback を実行する。
     * direct bind でも selection できない場合の最後の補助経路として使う。
     */
    async function syncNativeSubtitleSelectionFallback(
      video,
      requestedLang,
      options = {},
    ) {
      if (!video || !requestedLang) return false;
      if (typeof syncNativeSubtitleSelection !== "function") return false;

      const result = await syncNativeSubtitleSelection(video, requestedLang, {
        reason: options.reason || "subtitle-sync-controller-native-fallback",
      });

      logContent?.("subtitleSyncController.syncNativeSubtitleSelectionFallback", {
        requestedLang,
        applied: Boolean(result),
      });

      return Boolean(result);
    }

    return {
      ensureSyncIntervalOrchestrator,
      getTrackReadability,
      scoreCandidateTrack,
      selectSecondarySubtitleTrack,
      normalizeSecondaryMonitorState,
      normalizeSecondaryRecoveryState,
      shouldWaitForReadableTrack,
      buildSecondarySyncDecision,
      waitForReadableTrack,
      resolveSecondaryWaitOutcome,
      syncSecondaryTrackDirectly,
      syncNativeSubtitleSelectionFallback,
    };
  }

  root.subtitleSyncController = root.subtitleSyncController || {};
  root.subtitleSyncController.createSubtitleSyncController =
    createSubtitleSyncController;
})();

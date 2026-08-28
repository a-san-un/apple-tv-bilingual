// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-sync-controller.js
//
// 役割: primary / secondary 共通の subtitle sync orchestration を担当する。
//       selection / readability / decision / wait-and-bind 後の再評価 /
//       direct bind / native fallback / pending task cleanup を集約する。
//
// 依存:
//   - resolver:
//       resolveSecondarySubtitleTrack
//       resolveRequestedSubtitleTrack
//       matchesRequestedLanguage
//       isForcedLikeTrack
//       getTrackCuesLength
//       getTrackActiveCuesLength
//       getCurrentCueTextLength
//       hasCueOverlapAtTime
//   - roles.primary.bindTrack
//   - roles.secondary.bindTrack
//   - roles.primary.syncNativeSelection
//   - roles.secondary.syncNativeSelection
//   - createSyncIntervalOrchestrator
//
// 設計原則:
//   - selectSubtitleTrack() は「どの track を使うか」を返す。
//   - selectSecondarySubtitleTrack() / selectPrimarySubtitleTrack() は
//     role ごとの thin wrapper に留める。
//   - buildSecondarySyncDecision() は decision.track / decision.currentTime /
//     decision.snapshot / decision.action.type をトップレベルで返し、
//     cue-controller.js の switch (decision.action?.type) とそのまま噛み合う。
//   - resolveSecondaryWaitOutcome() は waitResult.decision / waited /
//     waitSucceeded を返し、既存の secondary orchestration 呼び出し形を壊さない。
//   - waitForReadableTrack() は readable 化待ちだけを担当する。
//   - syncTrackDirectly() は role 共通の wait + native fallback + bind を担当する。
//   - pending task cleanup は controller 内で一元管理し、
//     listener cleanup は cue-controller.js 側へ残す。
//   - cue-controller.js は decision の action 実行中心に寄せる。
//   - bind / listener cleanup / mode restore の実行責務は持ち込まない。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * subtitle sync 用の controller API 群を生成する。
   * selection / readability / decision / wait outcome /
   * direct bind / fallback / cleanup を束ねて返す。
   */
  function createSubtitleSyncController({ services = {} }) {
    const {
      logContent,
      logRecoveryProbe,
      resolver,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
      createSyncIntervalOrchestrator,
      roles = {},
    } = services;

    let syncIntervalOrchestrator = null;

    // role adapter の後方互換。
    const normalizedRoles = {
      primary: {
        resolveTrack:
          roles?.primary?.resolveTrack ||
          ((video, requestedLang) =>
            resolver?.resolveRequestedSubtitleTrack?.(
              video?.textTracks || [],
              requestedLang,
              Number(video?.currentTime ?? NaN),
            ) || null),
        bindTrack: roles?.primary?.bindTrack || null,
        syncNativeSelection:
          roles?.primary?.syncNativeSelection ||
          (typeof syncNativeSubtitleSelection === "function"
            ? async ({ requestedLang, reason = "" } = {}) =>
                await syncNativeSubtitleSelection({
                  primaryLang: requestedLang,
                  reason,
                })
            : null),
      },
      secondary: {
        resolveTrack:
          roles?.secondary?.resolveTrack ||
          ((video, requestedLang) =>
            resolver?.resolveSecondarySubtitleTrack?.(video, requestedLang) ||
            null),
        bindTrack:
          roles?.secondary?.bindTrack ||
          (typeof bindSecondaryTrack === "function"
            ? async (track, options = {}) =>
                await bindSecondaryTrack(track, options)
            : null),
        syncNativeSelection:
          roles?.secondary?.syncNativeSelection ||
          (typeof syncNativeSubtitleSelection === "function"
            ? async ({ requestedLang, reason = "" } = {}) =>
                await syncNativeSubtitleSelection({
                  secondaryLang: requestedLang,
                  reason,
                })
            : null),
      },
    };

    // role ごとの pending task を一元管理する。
    // 古い readable wait / native fallback が残留しないようにする。
    const pendingSyncTasks = {
      primary: null,
      secondary: null,
    };

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
    // 共通ヘルパー
    // -------------------------------------------------------

    /** role 文字列から role services を解決する */
    function getRoleServices(role) {
      return normalizedRoles?.[role] || null;
    }

    /** track identity を安定化して返す */
    function getTrackIdentity(track) {
      if (!track) return "";
      return (
        track?.id ||
        `${track?.language || ""}:${track?.label || ""}:${track?.kind || ""}`
      );
    }

    /** resolver の matchesRequestedLanguage 呼び出し揺れを吸収する */
    function trackMatchesRequestedLanguage(track, requestedLang) {
      if (!track || !requestedLang) return false;

      try {
        return Boolean(resolver?.matchesRequestedLanguage?.(track, requestedLang));
      } catch (_) {
        return Boolean(
          resolver?.matchesRequestedLanguage?.(
            track?.language || "",
            track?.label || "",
            requestedLang,
            track?.kind || "",
          ),
        );
      }
    }

    /** forced-like かどうかを安全に判定する */
    function isForcedLikeTrackSafe(track) {
      try {
        return Boolean(resolver?.isForcedLikeTrack?.(track));
      } catch (_) {
        return false;
      }
    }

    // -------------------------------------------------------
    // Pending task cleanup
    // -------------------------------------------------------

    /** role 単位の pending sync task を cancel する */
    function cancelPendingSyncTask(role, reason = "cancel") {
      const task = pendingSyncTasks?.[role] || null;
      if (!task) return false;

      task.cancelled = true;

      if (Number.isFinite(task.timeoutId)) {
        try {
          clearTimeout(task.timeoutId);
        } catch (_) {}
        task.timeoutId = null;
      }

      if (typeof task.cleanup === "function") {
        try {
          task.cleanup();
        } catch (_) {}
      }

      pendingSyncTasks[role] = null;

      logContent?.("subtitleSyncController.cancelPendingSyncTask", {
        role,
        reason,
        cancelled: true,
      });

      return true;
    }

    /** すべての pending sync task を cancel する */
    function cancelAllPendingSyncTasks(reason = "cancel-all") {
      cancelPendingSyncTask("primary", reason);
      cancelPendingSyncTask("secondary", reason);
    }

    /** role ごとの pending task を新規登録する */
    function createPendingSyncTask(role, meta = {}) {
      cancelPendingSyncTask(role, "replace-pending-task");

      const task = {
        role,
        cancelled: false,
        timeoutId: null,
        cleanup: null,
        meta,
      };

      pendingSyncTasks[role] = task;

      logContent?.("subtitleSyncController.createPendingSyncTask", {
        role,
        hasMeta: Boolean(meta && Object.keys(meta).length),
      });

      return task;
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

    /** readability が true になるまで待機する。cancel されたら即座に抜ける */
    async function waitForReadableTrack(track, options = {}) {
      if (!track) return null;

      const timeoutMs = Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : 1200;
      const intervalMs = Number.isFinite(options.intervalMs)
        ? options.intervalMs
        : 100;
      const currentTime = Number(options.currentTime ?? NaN);
      const task = options.task || { cancelled: false, timeoutId: null };
      const startedAt = Date.now();

      while (!task.cancelled && Date.now() - startedAt < timeoutMs) {
        const snapshot = getTrackReadability(track, currentTime);
        if (snapshot.readable) {
          logRecoveryProbe?.("subtitleSyncController.waitForReadableTrack", {
            readable: true,
            language: track?.language || "",
            label: track?.label || "",
            kind: track?.kind || "",
            timeoutMs,
            intervalMs,
          });
          return track;
        }

        await new Promise((resolve) => {
          task.timeoutId = setTimeout(() => {
            task.timeoutId = null;
            resolve();
          }, intervalMs);
        });
      }

      logRecoveryProbe?.("subtitleSyncController.waitForReadableTrack", {
        readable: false,
        cancelled: Boolean(task.cancelled),
        language: track?.language || "",
        label: track?.label || "",
        kind: track?.kind || "",
        timeoutMs,
        intervalMs,
      });

      return null;
    }

    /** readability snapshot を見て待機が必要かどうかを返す */
    function shouldWaitForReadableTrack(selection) {
      return Boolean(
        selection?.track &&
          selection?.snapshot &&
          !selection.snapshot.readable,
      );
    }

    // -------------------------------------------------------
    // Selection
    // -------------------------------------------------------

    /**
     * role 共通の selection result を返す。
     * bind や cleanup は行わず、track identity と readability を返す。
     */
    function selectSubtitleTrack({
      role = "",
      video,
      requestedLang,
      previousBoundTrack = null,
    }) {
      const currentTime = Number(video?.currentTime ?? NaN);
      const roleServices = getRoleServices(role);

      if (!video || !requestedLang || !roleServices?.resolveTrack) {
        return {
          role,
          track: null,
          resolvedTrack: null,
          sameTrackRef: false,
          selectedTrackId: "",
          previousTrackId: getTrackIdentity(previousBoundTrack),
          requestedLanguageChanged: false,
          currentTime,
          snapshot: getTrackReadability(null, currentTime),
          candidates: [],
        };
      }

      const resolvedTrack =
        roleServices.resolveTrack(video, requestedLang) || null;

      const allTracks = Array.from(video?.textTracks || []);
      const requestedCandidates = allTracks.filter((track) => {
        if (!track) return false;
        if (isForcedLikeTrackSafe(track)) return false;

        const kind = String(track?.kind || "");
        const isSubtitleKind = kind === "subtitles" || kind === "captions";
        if (!isSubtitleKind) return false;

        return trackMatchesRequestedLanguage(track, requestedLang);
      });

      const preferredTrack =
        requestedCandidates.find((track) => track === previousBoundTrack) || null;

      const rankedCandidates = requestedCandidates
        .map((track) => ({
          track,
          trackId: getTrackIdentity(track),
          ...scoreCandidateTrack(track, currentTime, preferredTrack),
        }))
        .sort((a, b) => b.score - a.score);

      const selectedCandidate = rankedCandidates[0] || null;
      const selectedTrack =
        selectedCandidate?.track || resolvedTrack || previousBoundTrack || null;

      const sameTrackRef = Boolean(
        selectedTrack && previousBoundTrack === selectedTrack,
      );

      const requestedLanguageChanged = Boolean(
        requestedLang &&
          previousBoundTrack &&
          !trackMatchesRequestedLanguage(previousBoundTrack, requestedLang),
      );

      return {
        role,
        track: selectedTrack,
        resolvedTrack,
        sameTrackRef,
        selectedTrackId: getTrackIdentity(selectedTrack),
        previousTrackId: getTrackIdentity(previousBoundTrack),
        requestedLanguageChanged,
        currentTime,
        snapshot: getTrackReadability(selectedTrack, currentTime),
        candidates: rankedCandidates,
      };
    }

    /** secondary track の selection result を返す thin wrapper */
    function selectSecondarySubtitleTrack(
      video,
      requestedLang,
      previousBoundTrack = null,
    ) {
      return selectSubtitleTrack({
        role: "secondary",
        video,
        requestedLang,
        previousBoundTrack,
      });
    }

    /** primary track の selection result を返す thin wrapper */
    function selectPrimarySubtitleTrack(
      video,
      requestedLang,
      previousBoundTrack = null,
    ) {
      return selectSubtitleTrack({
        role: "primary",
        video,
        requestedLang,
        previousBoundTrack,
      });
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
      };
    }

    // -------------------------------------------------------
    // Secondary decision
    // -------------------------------------------------------

    /**
     * selection/monitor/recovery の内部状態から、
     * cue-controller.js が期待する action.type を決定する。
     * ここで文字列 action を "clear/keep/bind/wait-and-bind" の
     * オブジェクト shape へ変換し、呼び出し側の switch と噛み合わせる。
     */
    function resolveSecondaryActionType({
      selectedTrack,
      snapshot,
      monitor,
      recovery,
      requestedMode = "hidden",
    }) {
      if (!selectedTrack) {
        return {
          type: "clear",
          reason: "track-missing",
          requestedMode,
        };
      }

      if (recovery.forceRebind) {
        return {
          type: "bind",
          reason: "recovery-force-rebind",
          requestedMode,
        };
      }

      if (recovery.requested) {
        return {
          type: "bind",
          reason: "recovery-requested",
          requestedMode,
        };
      }

      if (!snapshot.readable) {
        return {
          type: "wait-and-bind",
          reason: "track-unreadable",
          requestedMode,
        };
      }

      if (!monitor.healthy) {
        return {
          type: "bind",
          reason: "monitor-stale-or-inactive",
          requestedMode,
        };
      }

      return {
        type: "keep",
        reason: "already-healthy",
        requestedMode,
      };
    }

    /**
     * secondary の sync action を決定する。
     * cue-controller.js が参照する decision.track / decision.currentTime /
     * decision.snapshot / decision.action.type をトップレベルで返し、
     * 既存の secondary orchestration の呼び出し形を壊さないようにする。
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

      const selectedTrack = selection.track || null;
      const snapshot =
        selection.snapshot || getTrackReadability(null, selection.currentTime);
      const monitor = normalizeSecondaryMonitorState(monitorState, selectedTrack);
      const recovery = normalizeSecondaryRecoveryState(recoveryState);

      const action = resolveSecondaryActionType({
        selectedTrack,
        snapshot,
        monitor,
        recovery,
        requestedMode,
      });

      logRecoveryProbe?.("subtitleSyncController.buildSecondarySyncDecision", {
        actionType: action.type,
        actionReason: action.reason,
        hasSelectedTrack: Boolean(selectedTrack),
        readable: Boolean(snapshot?.readable),
        monitorHealthy: monitor.healthy,
        recoveryRequested: recovery.requested,
      });

      return {
        // cue-controller.js がトップレベルで参照する項目
        track: selectedTrack,
        currentTime: selection.currentTime,
        snapshot,
        action,

        // 内部詳細（デバッグ・ログ用に残す）
        selection,
        monitor,
        recovery,
      };
    }

    /**
     * wait-and-bind 後の secondary 状態を再評価する。
     * cue-controller.js が読む waitResult.decision / waitResult.waited /
     * waitResult.waitSucceeded を満たす shape で返す。
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
          decision: initialDecision,
          waited: false,
          waitSucceeded: false,
        };
      }

      const readableTrack = await waitForReadableTrack(initialDecision.track, {
        timeoutMs: waitOptions.timeoutMs,
        intervalMs: waitOptions.intervalMs,
        currentTime: initialDecision.currentTime,
        task: waitOptions.task,
      });

      // 待機後は最新の video.currentTime で decision を引き直す。
      // track が読める状態になっても、その間に選択自体が変わっている可能性があるため。
      const finalDecision = buildSecondarySyncDecision({
        video,
        requestedLang,
        previousBoundTrack,
        monitorState,
        recoveryState,
        requestedMode,
      });

      logRecoveryProbe?.("subtitleSyncController.resolveSecondaryWaitOutcome", {
        waited: true,
        waitSucceeded: Boolean(readableTrack),
        finalActionType: finalDecision.action?.type || "",
      });

      return {
        decision: finalDecision,
        waited: true,
        waitSucceeded: Boolean(readableTrack),
      };
    }

    // -------------------------------------------------------
    // Direct sync / Native fallback
    // -------------------------------------------------------

    /** role 共通の native 字幕選択 fallback を実行する */
    async function syncNativeSubtitleSelectionFallback(
      role,
      video,
      requestedLang,
      options = {},
    ) {
      if (!video || !requestedLang) return false;

      const roleServices = getRoleServices(role);
      if (typeof roleServices?.syncNativeSelection !== "function") return false;

      const result = await roleServices.syncNativeSelection({
        requestedLang,
        reason: options.reason || `subtitle-sync-controller-${role}-native-fallback`,
      });

      logRecoveryProbe?.("subtitleSyncController.syncNativeSubtitleSelectionFallback", {
        role,
        requestedLang,
        applied: Boolean(result),
      });

      return Boolean(result);
    }

    /** role 共通の direct bind を実行する */
    async function syncTrackDirectly(role, video, requestedLang, options = {}) {
      if (!video || !requestedLang) return null;

      const roleServices = getRoleServices(role);
      if (typeof roleServices?.bindTrack !== "function") return null;

      const task = createPendingSyncTask(role, {
        requestedLang,
        reason: options.reason || "",
      });

      try {
        const selection = selectSubtitleTrack({
          role,
          video,
          requestedLang,
          previousBoundTrack: options.previousBoundTrack || null,
        });

        const selectedTrack = selection.track || null;

        if (!selectedTrack) {
          logRecoveryProbe?.("subtitleSyncController.syncTrackDirectly", {
            role,
            requestedLang,
            bound: false,
            reason: "track-missing",
          });

          const nativeApplied = await syncNativeSubtitleSelectionFallback(
            role,
            video,
            requestedLang,
            {
              reason: `${role}-track-missing`,
            },
          );

          if (!nativeApplied || task.cancelled) return null;
        }

        let latestSelection = selectedTrack
          ? selection
          : selectSubtitleTrack({
              role,
              video,
              requestedLang,
              previousBoundTrack: options.previousBoundTrack || null,
            });

        let readableTrack =
          latestSelection.snapshot?.readable
            ? latestSelection.track
            : await waitForReadableTrack(latestSelection.track, {
                timeoutMs: options.timeoutMs,
                intervalMs: options.intervalMs,
                currentTime: latestSelection.currentTime,
                task,
              });

        // 読めない場合は native fallback を一度だけ試し、再 selection する。
        if (!readableTrack && !task.cancelled) {
          const nativeApplied = await syncNativeSubtitleSelectionFallback(
            role,
            video,
            requestedLang,
            {
              reason:
                options.reason || `subtitle-sync-controller-${role}-direct-bind`,
            },
          );

          if (nativeApplied && !task.cancelled) {
            latestSelection = selectSubtitleTrack({
              role,
              video,
              requestedLang,
              previousBoundTrack: latestSelection.track || null,
            });

            readableTrack =
              latestSelection.snapshot?.readable
                ? latestSelection.track
                : await waitForReadableTrack(latestSelection.track, {
                    timeoutMs: options.timeoutMs,
                    intervalMs: options.intervalMs,
                    currentTime: latestSelection.currentTime,
                    task,
                  });
          }
        }

        if (!readableTrack || task.cancelled) {
          logRecoveryProbe?.("subtitleSyncController.syncTrackDirectly", {
            role,
            requestedLang,
            bound: false,
            cancelled: Boolean(task.cancelled),
            reason: "track-unreadable",
            selectedTrackId: latestSelection?.selectedTrackId || "",
          });
          return null;
        }

        const binding = await roleServices.bindTrack(readableTrack, {
          requestedMode: options.requestedMode || "hidden",
          reason: options.reason || `subtitle-sync-controller-${role}-direct-bind`,
          requestedLang,
        });

        logRecoveryProbe?.("subtitleSyncController.syncTrackDirectly", {
          role,
          requestedLang,
          bound: Boolean(binding),
          selectedTrackId: getTrackIdentity(readableTrack),
          readable: true,
        });

        return binding || null;
      } finally {
        if (pendingSyncTasks?.[role] === task) {
          pendingSyncTasks[role] = null;
        }
      }
    }

    /** secondary track を direct bind する thin wrapper */
    async function syncSecondaryTrackDirectly(video, requestedLang, options = {}) {
      return await syncTrackDirectly("secondary", video, requestedLang, options);
    }

    /** primary track を direct bind する thin wrapper */
    async function syncPrimaryTrackDirectly(video, requestedLang, options = {}) {
      return await syncTrackDirectly("primary", video, requestedLang, options);
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------

    return {
      ensureSyncIntervalOrchestrator,
      getTrackIdentity,
      getTrackReadability,
      scoreCandidateTrack,
      selectSubtitleTrack,
      selectPrimarySubtitleTrack,
      selectSecondarySubtitleTrack,
      normalizeSecondaryMonitorState,
      normalizeSecondaryRecoveryState,
      shouldWaitForReadableTrack,
      buildSecondarySyncDecision,
      waitForReadableTrack,
      resolveSecondaryWaitOutcome,
      syncTrackDirectly,
      syncPrimaryTrackDirectly,
      syncSecondaryTrackDirectly,
      syncNativeSubtitleSelectionFallback,
      cancelPendingSyncTask,
      cancelAllPendingSyncTasks,
    };
  }

  root.subtitleSyncController = root.subtitleSyncController || {};
  root.subtitleSyncController.createSubtitleSyncController =
    createSubtitleSyncController;
})();

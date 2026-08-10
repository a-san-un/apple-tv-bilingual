// =============================================================
// Apple TV+ Bilingual Subtitles - cue-controller.js
// version: 2.6.3
// 役割: cue change を起点に current subtitle / subtitle blocks / overlay / panel 更新を統括する。
// Phase J: secondary missing の runtime 監視、recovery 判定、nearby rebuild の 1 回保護を担当する。
// =============================================================

(() => {
  // ATVB 名前空間を取得し、cue controller を公開する先を固定する。
  const root = (window.ATVB = window.ATVB || {});

  // cue-controller 全体の依存を受け取り、
  // cue change・subtitle blocks・overlay / panel 更新をまとめて扱う中核を作る。
  function createCueController({
    state,
    logContent,
    DEBUG_SECONDARY_SUBS,
    getSecondaryTrackDebugPayload,
    resolveSecondarySubtitleTrack,
    getCurrentCueText,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    getRequestedSecondaryLanguage,
    getPrimaryTrack: _getPrimaryTrack,
    getSecondaryTrack: _getSecondaryTrack,
    getCurrentCue,
    cleanCueText,
    getCurrentTime,
    getVideoElement,
    getPrimaryTrackCues,
    getSecondaryTrackCues,
    getPreviousSubtitleBlocks,
    buildSubtitleBlockSequence,
    setSubtitleBlocks,
    getSubtitleBlockSequence,
    getCurrentSubtitleBlockFromSequence: _getCurrentSubtitleBlockFromSequence,
    setCurrentSubtitleBlock,
    DEBUG_PANEL_PROBE: _DEBUG_PANEL_PROBE,
    renderSecondarySubtitle,
    renderCurrentSnapshot,
    updateOverlay: _updateOverlay,
    updateOverlayFromView: _updateOverlayFromView,
    updateOverlayFromBlock: _updateOverlayFromBlock,
    renderPanel,
    matchesRequestedLanguage,
    isForcedLikeTrack,
    textTrackDebug = null,
    cueSequenceBuilder = null,
    cueRenderCoordinator = null,
    secondaryTrackRecovery = null,
  }) {

    // 現在 bind されている primary listener の解除関数を保持する。
    let primaryTrackCleanup = null;

    // 現在 bind 済みの primary track を保持する。
    let primaryTrackBound = null;

    // primary track を拡張が変更する前の mode を保持する。
    let primaryTrackOriginalMode = null;

    // 現在 bind されている secondary listener の解除関数を保持する。
    let secondaryTrackCleanup = null;

    // 現在 bind 済みの secondary track を保持する。
    let secondaryTrackBound = null;

    // secondary track を拡張が変更する前の mode を保持する。
    let secondaryTrackOriginalMode = null;

    function getUsableTrackDebugPayload(track) {
      if (textTrackDebug?.getUsableTrackDebugPayload) {
        return textTrackDebug.getUsableTrackDebugPayload(track);
      }

      return {
        language: track?.language || "",
        label: track?.label || "",
        kind: track?.kind || "",
        mode: track?.mode || "",
        cuesLength: getTrackCuesLength(track),
        activeCuesLength: getTrackActiveCuesLength(track),
      };
    }

    function dumpTextTrackSnapshot(reason = "unknown", extra = {}) {
      if (textTrackDebug?.dumpTextTrackSnapshot) {
        return textTrackDebug.dumpTextTrackSnapshot(reason, extra, {
          primaryTrackBound,
          secondaryTrackBound,
        });
      }

      const video = getVideoElement?.();
      const tracks = Array.from(video?.textTracks || []);

      const payload = {
        reason,
        currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
        paused: Boolean(video?.paused),
        readyState: Number.isFinite(video?.readyState) ? video.readyState : null,
        textTrackCount: tracks.length,
        primaryBoundTrack: getUsableTrackDebugPayload(primaryTrackBound),
        secondaryBoundTrack: getUsableTrackDebugPayload(secondaryTrackBound),
        tracks: tracks.map((track, index) => ({
          index,
          language: track?.language || "",
          label: track?.label || "",
          kind: track?.kind || "",
          mode: track?.mode || "",
          cuesLength: getTrackCuesLength(track),
          activeCuesLength: getTrackActiveCuesLength(track),
          isPrimaryBound: track === primaryTrackBound,
          isSecondaryBound: track === secondaryTrackBound,
        })),
        ...extra,
      };

      logContent("text track snapshot", payload);

      return payload;
    }

    function ensureSubtitleTracksUsable(video, requestedLang, options = {}) {
      const finalMode = options.finalMode === "showing" ? "showing" : "hidden";
      const reason = options.reason || "unknown";
      const activationHoldMs = Math.max(0, Number(options.activationHoldMs) || 800);
      const cuePollIntervalMs = Math.max(50, Number(options.cuePollIntervalMs) || 100);
      const cuePollTimeoutMs = Math.max(
        activationHoldMs,
        Number(options.cuePollTimeoutMs) || 1500,
      );

      if (!video?.textTracks || !requestedLang) {
        const payload = {
          reason,
          requestedLang: requestedLang || "",
          finalMode,
          matchedTrackCount: 0,
          activatedTrackCount: 0,
          activated: false,
          activationHoldMs,
          cuePollIntervalMs,
          cuePollTimeoutMs,
          tracks: [],
        };
        logContent("subtitle track usability", payload);
        return payload;
      }

      const tracks = Array.from(video.textTracks || []);
      const targets = tracks.filter((track) => {
        if (!track) return false;
        const kind = String(track.kind || "").toLowerCase();
        if (kind !== "subtitles" && kind !== "captions") return false;
        if (isForcedLikeTrack?.(track)) return false;
        return matchesRequestedLanguage?.(track, requestedLang);
      });

      let activatedTrackCount = 0;
      for (const track of targets) {
        try {
          track.mode = "showing";
          activatedTrackCount += 1;
        } catch (_) {}
      }

      if (finalMode === "hidden" && activatedTrackCount > 0) {
        const startedAt = Date.now();
        const shouldFinalizeNow = () => Date.now() - startedAt >= activationHoldMs;

        const restoreHidden = (restoreReason) => {
          for (const track of targets) {
            try {
              track.mode = "hidden";
            } catch (_) {}
          }

          logContent("subtitle track usability restore", {
            reason,
            requestedLang: requestedLang || "",
            restoreReason,
            activationHoldMs,
            cuePollIntervalMs,
            cuePollTimeoutMs,
            elapsedMs: Date.now() - startedAt,
            tracks: targets.map((track) => getUsableTrackDebugPayload(track)),
          });
        };

        const pollUntilReady = () => {
          const elapsedMs = Date.now() - startedAt;
          const hasLoadedCues = targets.some((track) => {
            try {
              return (track?.cues?.length || 0) > 0;
            } catch (_) {
              return false;
            }
          });

          if (hasLoadedCues && shouldFinalizeNow()) {
            restoreHidden("cues-loaded");
            return;
          }

          if (elapsedMs >= cuePollTimeoutMs) {
            restoreHidden(hasLoadedCues ? "timeout-after-cues" : "timeout-no-cues");
            return;
          }

          setTimeout(pollUntilReady, cuePollIntervalMs);
        };

        setTimeout(pollUntilReady, cuePollIntervalMs);
      }

      const payload = {
        reason,
        requestedLang: requestedLang || "",
        finalMode,
        matchedTrackCount: targets.length,
        activatedTrackCount,
        activated: activatedTrackCount > 0,
        activationHoldMs,
        cuePollIntervalMs,
        cuePollTimeoutMs,
        tracks: targets.map((track) => getUsableTrackDebugPayload(track)),
      };

      logContent("subtitle track usability", payload);
      return payload;
    }

    // 最新の merged subtitle health を観測・外部参照用に保持する。
    let lastMergedSubtitleHealth = null;

    // nearby rebuild の current block 保護を 1 回だけ成立させる guard を保持する。
    let nearbyRebuildGuard = null;

    // nearby rebuild 直後に一時利用する hold view の格納先を初期化する。
    state.nearbyRebuildHoldView ??= null;

    // secondary missing が recovery 対象になるまで待つ継続時間を定義する。
    const SECONDARY_RECOVERY_WINDOW_MS = 1000;

    // repeated miss 後に force-rebind へ進める missCount の下限を定義する。
    const SECONDARY_FORCE_REBIND_MISS_COUNT = 2;

    // recovery 試行を打ち切って terminated に入る missCount 上限を定義する。
    const SECONDARY_RECOVERY_MISS_LIMIT = 8;

    // terminated 後に再試行を許可するまでの待機時間を定義する。
    const SECONDARY_TERMINATED_RETRY_MS = 10_000;

    // 同一 cuechange の重複発火を missCount++ から除外する最小間隔を定義する。
    const SECONDARY_RECOVERY_DEBOUNCE_MS = 200;

    // large seek 直後として nearby rebuild を許可する時間窓を定義する。
    const NEARBY_REBUILD_SEEK_WINDOW_MS = 4000;

    // lane ごとの欠落状態を保持する初期オブジェクトを作る。
    function createLaneState(lane) {
      return {
        lane,
        healthy: false,
        isMissing: false,
        missingSince: 0,
        missingDurationMs: 0,
        missCount: 0,
        terminated: false,
        lastDecision: "idle",
        lastDecisionAt: 0,
      };
    }

    // primary / secondary の lane state を 1 か所で管理する。
    const laneStates = {
      primary: createLaneState("primary"),
      secondary: createLaneState("secondary"),
    };

    // 欠落監視に使う lane state を初期状態へ戻す。
    function resetLaneState(laneState) {
      laneState.isMissing = false;
      laneState.missingSince = 0;
      laneState.missingDurationMs = 0;
      laneState.missCount = 0;
      laneState.terminated = false;
      laneState.lastDecision = "idle";
      laneState.lastDecisionAt = 0;
    }

    function resetSecondaryRecoveryLane(reason = "manual-reset") {
      if (secondaryTrackRecovery?.resetSecondaryRecoveryLane) {
        return secondaryTrackRecovery.resetSecondaryRecoveryLane(reason);
      }

      const before = {
        missCount: laneStates.secondary?.missCount ?? null,
        terminated: laneStates.secondary?.terminated ?? null,
        missingSince: laneStates.secondary?.missingSince ?? null,
        missingDurationMs: laneStates.secondary?.missingDurationMs ?? null,
        lastDecision: laneStates.secondary?.lastDecision ?? null,
      };

      resetLaneState(laneStates.secondary);

      logContent?.("secondary recovery lane reset", {
        reason,
        before,
        after: {
          missCount: laneStates.secondary?.missCount ?? null,
          terminated: laneStates.secondary?.terminated ?? null,
          missingSince: laneStates.secondary?.missingSince ?? null,
          missingDurationMs: laneStates.secondary?.missingDurationMs ?? null,
          lastDecision: laneStates.secondary?.lastDecision ?? null,
        },
      });

      return laneStates.secondary;
    }

    // 現在の観測結果で lane state を更新する。
    function updateLaneState(laneState, { now, healthy, isMissing }) {
      laneState.healthy = healthy === true;
      laneState.isMissing = isMissing === true;

      if (!laneState.isMissing) {
        laneState.missingSince = 0;
        laneState.missingDurationMs = 0;
        laneState.missCount = 0;
        laneState.terminated = false;
        laneState.lastDecision = "idle";
        return laneState;
      }

      if (!laneState.missingSince) {
        laneState.missingSince = now;
      }

      laneState.missingDurationMs = Math.max(0, now - laneState.missingSince);
      return laneState;
    }

    // secondary track の identity / readable 状態を Round 8 用に揃えて観測する。
    function getSecondaryTrackObservation(track, prefix = "track") {
      const currentTime = getCurrentTime();
      const currentCue = getCurrentCue(track, currentTime);
      const currentCueText = cleanCueText(currentCue);

      return {
        [`${prefix}Label`]: track?.label || "",
        [`${prefix}Language`]: track?.language || "",
        [`${prefix}Kind`]: track?.kind || "",
        [`${prefix}Mode`]: track?.mode || "",
        [`${prefix}CuesLength`]: getTrackCuesLength(track),
        [`${prefix}ActiveCuesLength`]: getTrackActiveCuesLength(track),
        [`${prefix}CurrentCueTextLength`]: currentCueText.length,
        [`${prefix}HasCueOverlapAtCurrentTime`]: Boolean(currentCue),
      };
    }

    // secondary lane の runtime missing が一定時間続き、
    // merged assists も recovery 対象と示したときだけ recover / force-rebind / terminated を判定する。
    // 主に large seek 後の secondary missing を対象とし、通常再生での短い gap はここでは扱わない。
    function _evaluateLaneHealth({
      laneName,
      now,
      healthy,
      isMissing,
    }) {
      const laneState = updateLaneState(laneStates[laneName], {
        now,
        healthy,
        isMissing,
      });

      if (healthy) {
        resetLaneState(laneState);
      }

      logContent?.("laneHealthUpdated", {
        laneName,
        healthy: laneState.healthy,
        isMissing: laneState.isMissing,
        missingDurationMs: laneState.missingDurationMs,
        missCount: laneState.missCount,
        terminated: laneState.terminated,
      });

      return laneState;
    }

    function _evaluateLaneRecovery({
      laneName,
      laneState,
      shouldRecover = false,
      shouldForceRebind = false,
      missingReason = "lane_not_missing",
      waitingReason = "lane_missing_waiting_window",
      terminatedReason = "lane_recovery_terminated",
      missLimitReason = "lane_recovery_miss_limit",
      recoverReason = "lane_current_missing",
      forceRebindReason = "lane_force_rebind_after_repeated_miss",
      observationOnly = false,
    }) {
      if (!laneState.isMissing) {
        laneState.lastDecision = "idle";
        const result = {
          lane: laneName,
          laneState,
          action: "idle",
          reason: missingReason,
        };
        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });
        return result;
      }

      if (laneState.terminated) {
        laneState.lastDecision = "terminated";
        const result = {
          lane: laneName,
          laneState,
          action: observationOnly ? "idle" : "terminated",
          reason: terminatedReason,
        };
        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });
        return result;
      }

      if (!shouldRecover) {
        laneState.lastDecision = "idle";
        const result = {
          lane: laneName,
          laneState,
          action: "idle",
          reason: waitingReason,
        };
        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });
        return result;
      }

      laneState.missCount += 1;

      if (laneState.missCount >= SECONDARY_RECOVERY_MISS_LIMIT) {
        laneState.terminated = true;
        laneState.lastDecision = "terminated";
        const result = {
          lane: laneName,
          laneState,
          action: observationOnly ? "idle" : "terminated",
          reason: missLimitReason,
        };
        logContent?.("laneRecoveryDecision", {
          laneName,
          action: result.action,
          reason: result.reason,
          missingDurationMs: laneState.missingDurationMs,
          missCount: laneState.missCount,
        });
        return result;
      }

      laneState.lastDecision = shouldForceRebind ? "force-rebind" : "recover";

      const result = {
        lane: laneName,
        laneState,
        action: observationOnly
          ? "idle"
          : (shouldForceRebind ? "force-rebind" : "recover"),
        reason: shouldForceRebind ? forceRebindReason : recoverReason,
      };

      logContent?.("laneRecoveryDecision", {
        laneName,
        action: result.action,
        reason: result.reason,
        missingDurationMs: laneState.missingDurationMs,
        missCount: laneState.missCount,
      });

      return result;
    }

    function evaluateSecondaryRecovery({
      now,
      runtime,
      currentCue,
      sequence: _sequence,
      derived,
    }) {
      if (secondaryTrackRecovery?.evaluateSecondaryRecovery) {
        return secondaryTrackRecovery.evaluateSecondaryRecovery({
          now,
          runtime,
          currentCue,
          sequence: _sequence,
          derived,
        });
      }

      const primaryLane = updateLaneState(laneStates.primary, {
        now,
        healthy: derived?.primaryHealthy === true,
        isMissing: false,
      });

      const secondaryRuntimeMissing =
        derived?.primaryHealthy === true &&
        currentCue?.secondaryTextLength === 0 &&
        runtime?.secondaryTrackFound === true &&
        runtime?.secondaryActiveCues === 0;

      const secondaryRecovered =
        runtime?.secondaryTrackFound === true &&
        (
          runtime?.secondaryActiveCues > 0 ||
          currentCue?.secondaryTextLength > 0
        );

      const secondaryLane = updateLaneState(laneStates.secondary, {
        now,
        healthy: secondaryRecovered,
        isMissing: secondaryRuntimeMissing,
      });

      if (secondaryRecovered) {
        resetLaneState(secondaryLane);
      }

      if (!secondaryLane.isMissing) {
        secondaryLane.lastDecision = "idle";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_not_missing",
        };
      }

      if (secondaryLane.terminated && secondaryRuntimeMissing) {
        const msSinceLastDecision =
          secondaryLane.lastDecisionAt > 0
            ? now - secondaryLane.lastDecisionAt
            : Infinity;
        if (msSinceLastDecision >= SECONDARY_TERMINATED_RETRY_MS) {
          resetLaneState(secondaryLane);
          secondaryLane.lastDecision = "idle";
          secondaryLane.lastDecisionAt = now;
          return {
            primaryLane,
            secondaryLane,
            action: "idle",
            reason: "secondary_terminated_retry_reset",
          };
        }
      }

      if (secondaryLane.terminated) {
        secondaryLane.lastDecision = "terminated";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_terminated",
        };
      }

      const shouldRecoverSecondary =
        secondaryLane.missingDurationMs >= SECONDARY_RECOVERY_WINDOW_MS &&
        (derived?.shouldRecoverSecondary === true || secondaryLane.isMissing);

      if (!shouldRecoverSecondary) {
        secondaryLane.lastDecision = "idle";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_missing_waiting_window",
        };
      }

      const msSinceLastMiss =
        secondaryLane.lastDecisionAt > 0
          ? now - secondaryLane.lastDecisionAt
          : Infinity;

      if (msSinceLastMiss < SECONDARY_RECOVERY_DEBOUNCE_MS) {
        secondaryLane.lastDecision = "idle";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_recovery_debounce",
        };
      }

      secondaryLane.missCount += 1;

      if (
        secondaryLane.missCount >= SECONDARY_RECOVERY_MISS_LIMIT &&
        derived?.shouldRecoverSecondary !== true
      ) {
        secondaryLane.terminated = true;
        secondaryLane.lastDecision = "terminated";
        secondaryLane.lastDecisionAt = now;
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_miss_limit",
        };
      }

      const shouldForceSecondaryRebind =
        derived?.shouldForceSecondaryRebind === true ||
        secondaryLane.missCount >= SECONDARY_FORCE_REBIND_MISS_COUNT;

      secondaryLane.lastDecision = shouldForceSecondaryRebind
        ? "force-rebind"
        : "recover";
      secondaryLane.lastDecisionAt = now;

      return {
        primaryLane,
        secondaryLane,
        action: secondaryLane.lastDecision,
        reason: shouldForceSecondaryRebind
          ? "secondary_force_rebind_after_repeated_miss"
          : "secondary_current_missing_with_primary_present",
      };
    }

    // 現在 bind 済みの primary track を返す。
    function getBoundPrimaryTrack() {
      return primaryTrackBound;
    }

    // 現在 bind 済みの secondary track を返す。
    function getBoundSecondaryTrack() {
      return secondaryTrackBound;
    }

    // primary track の listener を解除し、必要に応じて拡張が変更する前の mode に戻す。
    function unbindPrimarySubtitleTrack(options = {}) {
      const restoreMode = options.restoreMode === true;
      const track = primaryTrackBound;

      if (primaryTrackCleanup) {
        primaryTrackCleanup();
        primaryTrackCleanup = null;
      }

      if (restoreMode && track && primaryTrackOriginalMode != null) {
        try {
          track.mode = primaryTrackOriginalMode;
        } catch (_) {}
      }

      primaryTrackBound = null;
      primaryTrackOriginalMode = null;

      const suppress = document.getElementById("atvb-cue-suppress");
      if (suppress) suppress.remove();
    }

    // OFF 時に primary 字幕を Apple TV+ ネイティブ表示へ引き継ぐ。
    // listener と拡張側 CSS 抑制だけを解除し、対象 track は showing にする。
    function handoffPrimarySubtitleToNative() {
      const track = primaryTrackBound;

      dumpTextTrackSnapshot("handoffPrimarySubtitleToNative before", {
        targetTrack: getUsableTrackDebugPayload(track),
        originalMode: primaryTrackOriginalMode,
        hasPrimaryTrackCleanup: Boolean(primaryTrackCleanup),
      });

      if (primaryTrackCleanup) {
        primaryTrackCleanup();
        primaryTrackCleanup = null;
      }

      const suppress = document.getElementById("atvb-cue-suppress");
      if (suppress) suppress.remove();

      try {
        if (track) track.mode = "showing";
      } catch (_) {}

      dumpTextTrackSnapshot("handoffPrimarySubtitleToNative after-showing", {
        targetTrack: getUsableTrackDebugPayload(track),
        originalMode: primaryTrackOriginalMode,
      });

      primaryTrackBound = null;
      primaryTrackOriginalMode = null;

      dumpTextTrackSnapshot("handoffPrimarySubtitleToNative after-clear", {
        targetTrack: getUsableTrackDebugPayload(track),
      });

      return track || null;
    }

    // ネイティブ字幕の CSS 抑制を解除し、primary track の元 mode を復元する。
    function restoreNativeSubtitles() {
      const track = primaryTrackBound;

      if (track && primaryTrackOriginalMode != null) {
        try {
          track.mode = primaryTrackOriginalMode;
        } catch (_) {}
      }

      const suppress = document.getElementById("atvb-cue-suppress");
      if (suppress) suppress.remove();
    }

    // secondary track の listener を解除し、必要に応じて拡張が変更する前の mode に戻す。
    function unbindSecondarySubtitleTrack(options = {}) {
      const restoreMode = options.restoreMode === true;
      const track = secondaryTrackBound;

      if (secondaryTrackCleanup) {
        secondaryTrackCleanup();
        secondaryTrackCleanup = null;
      }

      if (restoreMode && track && secondaryTrackOriginalMode != null) {
        try {
          track.mode = secondaryTrackOriginalMode;
        } catch (_) {}
      }

      secondaryTrackBound = null;
      secondaryTrackOriginalMode = null;
    }

    // ネイティブ字幕を抑制するスタイルを head に追加する。
    function suppressNativeSubtitles() {
      if (document.getElementById("atvb-cue-suppress")) return;
      const style = document.createElement("style");
      style.id = "atvb-cue-suppress";
      style.textContent = "video::cue { visibility: hidden !important; }";
      document.head.appendChild(style);
    }

    // primary track を usable 化し、cuechange だけでなく playback 側イベントでも再評価できるようにする。
    // 初回 resume 時に cuechange が来ないケースでも、timeupdate / seeked / playing で onCueChange を補助発火させる。
    function bindPrimarySubtitleTrack(track, onCueChange, options = {}) {
      unbindPrimarySubtitleTrack();
      if (!track) return false;

      primaryTrackOriginalMode = track.mode;

      ensureSubtitleTracksUsable(options.video, options.requestedLang, {
        finalMode: "showing",
        reason: options.reason || "primary-bind",
      });

      try {
        track.mode = "showing";
      } catch (_) {}

      suppressNativeSubtitles();
      
      const video = options.video || null;

      try {
        track.addEventListener("cuechange", onCueChange);

        const onPlaybackSignal = () => {
          try {
            onCueChange();
          } catch (_) {}
        };

        if (video && typeof video.addEventListener === "function") {
          video.addEventListener("timeupdate", onPlaybackSignal);
          video.addEventListener("seeked", onPlaybackSignal);
          video.addEventListener("playing", onPlaybackSignal);
        }

        primaryTrackCleanup = () => {
          try {
            track.removeEventListener("cuechange", onCueChange);
          } catch (_) {}

          if (video && typeof video.removeEventListener === "function") {
            try {
              video.removeEventListener("timeupdate", onPlaybackSignal);
            } catch (_) {}
            try {
              video.removeEventListener("seeked", onPlaybackSignal);
            } catch (_) {}
            try {
              video.removeEventListener("playing", onPlaybackSignal);
            } catch (_) {}
          }
        };

        primaryTrackBound = track;

        requestAnimationFrame(() => {
          try {
            onCueChange();
          } catch (_) {}
        });

        return true;
      } catch (_) {
        primaryTrackCleanup = null;
        primaryTrackBound = null;
        return false;
      }
    }

    // secondary bind 時の mode を、実行文脈と readable snapshot から決定する。
    // Round 10:
    // - 既定は hidden
    // - same track / unreadable snapshot 成立時だけ showing へ readability-promote する
    // - DEBUG 時は showing を強制できる
    function resolveSecondaryTrackModePolicy({
      track,
      reason,
      debugForceShowing = false,
      allowShowing = true,
      unreadableSnapshot = null,
    }) {
      if (!track) {
        return {
          requestedMode: "hidden",
          policy: "no-track",
          rationale: "track_missing",
          reason: reason || "unknown",
        };
      }

      if (debugForceShowing) {
        return {
          requestedMode: "showing",
          policy: "debug-force-showing",
          rationale: "debug_override",
          reason: reason || "unknown",
        };
      }

      const unreadable =
        unreadableSnapshot &&
        unreadableSnapshot.cuesLength > 0 &&
        unreadableSnapshot.activeCuesLength === 0 &&
        !unreadableSnapshot.hasCueOverlapAtCurrentTime &&
        unreadableSnapshot.currentCueTextLength === 0;

      if (allowShowing && unreadable) {
        return {
          requestedMode: "showing",
          policy: "readability-promote",
          rationale: "same_track_unreadable_in_hidden_mode",
          reason: reason || "unknown",
        };
      }

      return {
        requestedMode: "hidden",
        policy: "default-hidden",
        rationale: "no_readability_issue_detected",
        reason: reason || "unknown",
      };
    }

    // secondary cue change を受けて secondary 表示と primary 側更新を進める。
    function onCueChange(track) {
      if (track && DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary cuechange render",
          getSecondaryTrackDebugPayload(getRequestedSecondaryLanguage(), track),
        );
      }

      if (track) {
        const currentTime = getCurrentTime();
        const cueText = getCurrentCueText(track, currentTime);
        const overlapCue = getCurrentCue(track, currentTime);

        if (DEBUG_SECONDARY_SUBS) {
          logContent("secondary-sync render-entry", {
            reason: "onCueChange",
            currentTime,
            trackLanguage: track?.language || "",
            trackKind: track?.kind || "",
            trackMode: track?.mode || "",
            cueTextLength: cueText?.length ?? 0,
            overlapCueExists: Boolean(overlapCue),
            overlapCueStartTime: overlapCue?.startTime ?? null,
            overlapCueEndTime: overlapCue?.endTime ?? null,
            willRenderEmpty: !cueText,
          });
        }

        renderSecondarySubtitle(cueText, track);
      }

      onPrimaryCueChange();
    }

    // secondary track を bind して cuechange 監視を始める。
    // mode の決定は呼び出し側で行い、ここでは mode 適用 + listener attach / cleanup のみを担う。
    function bindSecondarySubtitleTrack(track, modeDecision) {
      if (!track) return;

      const previousBoundTrack = secondaryTrackBound;
      unbindSecondarySubtitleTrack();

      const previousMode = track?.mode || "";
      secondaryTrackOriginalMode = previousMode;
      const requestedMode = modeDecision?.requestedMode || "hidden";

      const getReadableSnapshot = () => {
        const currentTime = getCurrentTime();
        const cuesLength = getTrackCuesLength(track);
        const activeCuesLength = getTrackActiveCuesLength(track);
        const overlapCue = getCurrentCue(track, currentTime);
        const currentCueText = getCurrentCueText(track, currentTime);

        return {
          currentTime,
          cuesLength,
          activeCuesLength,
          hasCueOverlapAtCurrentTime: Boolean(overlapCue),
          currentCueTextLength: currentCueText?.length ?? 0,
          readableNow:
            activeCuesLength > 0 ||
            Boolean(overlapCue) ||
            (currentCueText?.length ?? 0) > 0,
        };
      };

      const applyTrackMode = (nextMode, reason = "direct-apply") => {
        try {
          track.mode = nextMode;
        } catch (error) {
          logContent("secondary-sync mode-apply failed", {
            trackLanguage: track?.language || "",
            trackKind: track?.kind || "",
            requestedMode: nextMode,
            previousMode: track?.mode || previousMode,
            policy: modeDecision?.policy || "",
            rationale: modeDecision?.rationale || "",
            decisionReason: modeDecision?.reason || "",
            applyReason: reason,
            message: String(error?.message || error || ""),
          });
        }

        logContent("secondary-sync mode-applied", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          requestedMode: nextMode,
          appliedMode: track?.mode || "",
          policy: modeDecision?.policy || "",
          rationale: modeDecision?.rationale || "",
          decisionReason: modeDecision?.reason || "",
          applyReason: reason,
          cuesLength: getTrackCuesLength(track),
          activeCuesLength: getTrackActiveCuesLength(track),
          sameAsPreviousBound: previousBoundTrack === track,
          currentTime: getCurrentTime(),
        });
      };

      const maybePromoteTrackReadability = () => {
        if (requestedMode !== "hidden") return;

        const initialSnapshot = getReadableSnapshot();
        const shouldPromote =
          initialSnapshot.cuesLength > 0 && !initialSnapshot.readableNow;

        logContent("secondary-sync post-bind readability-check", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          requestedMode,
          policy: modeDecision?.policy || "",
          rationale: modeDecision?.rationale || "",
          decisionReason: modeDecision?.reason || "",
          ...initialSnapshot,
          shouldPromote,
          promotionSkipped: true,
          skipReason: "secondary-track-hidden-lock",
        });

        return;
      };

      applyTrackMode(requestedMode, "bind-initial");

      if (DEBUG_SECONDARY_SUBS) {
        logContent("secondary track bind", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          trackMode: track?.mode || "",
          policy: modeDecision?.policy || "",
          rationale: modeDecision?.rationale || "",
          decisionReason: modeDecision?.reason || "",
          cuesLength: getTrackCuesLength(track),
          activeCuesLength: getTrackActiveCuesLength(track),
          sameAsPreviousBound: previousBoundTrack === track,
          currentTime: getCurrentTime(),
        });
      }

      const handler = () => {
        if (DEBUG_SECONDARY_SUBS) {
          logContent("secondary-sync cuechange-fired", {
            reason: "secondaryTrackEvent",
            currentTime: getCurrentTime(),
            ...getSecondaryTrackObservation(track, "track"),
          });

          logContent("secondary cuechange raw", {
            currentTime: getCurrentTime(),
            trackLanguage: track?.language || "",
            trackKind: track?.kind || "",
            trackMode: track?.mode || "",
            activeCuesLength: (() => {
              try {
                return track?.activeCues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            cuesLength: (() => {
              try {
                return track?.cues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            currentCueTextLength: getCurrentCueText(track)?.length ?? 0,
          });
        }

        const currentTime = getCurrentTime();
        const overlapCue = getCurrentCue(track, currentTime);
        const overlapCueText = cleanCueText(overlapCue);
        const currentCueText = getCurrentCueText(track, currentTime);

        if (DEBUG_SECONDARY_SUBS) {
          logContent("secondary-sync cue-readable-snapshot", {
            reason: "secondaryTrackEvent",
            currentTime,
            trackLanguage: track?.language || "",
            trackKind: track?.kind || "",
            trackMode: track?.mode || "",
            activeCuesLength: (() => {
              try {
                return track?.activeCues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            cuesLength: (() => {
              try {
                return track?.cues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            overlapCueExists: Boolean(overlapCue),
            overlapCueTextLength: overlapCueText.length,
            currentCueTextLength: currentCueText?.length ?? 0,
          });
        }

        onCueChange(track);
      };

      try {
        track.addEventListener("cuechange", handler);
      } catch (_) {}

      secondaryTrackBound = track;
      secondaryTrackCleanup = () => {
        try {
          track.removeEventListener("cuechange", handler);
        } catch (_) {}
      };

      maybePromoteTrackReadability();

      // hidden track でも現在 cue は読み出せる。
      // bind 後に一度だけ描画して、次の cuechange を待つ間の空表示を防ぐ。
      onCueChange(track);
    }

    // secondary track の再解決と再同期を行い、必要なら nearby rebuild まで進める。
    function syncSecondarySubtitleTrack(
      video,
      requestedLang,
      renderSecondarySubtitleOverride,
      options = {},
    ) {
      if (!video) return;

      const suppressRender = options.suppressRender === true;
      const forceRebind = options.forceRebind === true;
      const previousBoundTrack = secondaryTrackBound;

      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary sync",
          getSecondaryTrackDebugPayload(requestedLang, secondaryTrackBound),
        );
      }

      if (forceRebind) {
        unbindSecondarySubtitleTrack();
      }

      ensureSubtitleTracksUsable(video, requestedLang, {
        finalMode: "hidden",
        reason: "secondary-sync",
      });

      const track = resolveSecondarySubtitleTrack(video, requestedLang);
      const sameTrackRef = Boolean(track && previousBoundTrack === track);
      const currentTime = getCurrentTime();

      // selection と bind のズレを診断するための差分観測。
      // rebind 条件には影響させず、ログのみに使う。
      const selectedTrackLanguage = track?.language || "";
      const boundTrackLanguageBeforeSync = previousBoundTrack?.language || "";
      const selectedTrackId = track?.id || "";
      const boundTrackIdBeforeSync = previousBoundTrack?.id || "";

      logContent("secondary-sync track-diff", {
        requestedLang: requestedLang || "",
        selectedTrackLanguage,
        boundTrackLanguageBeforeSync,
        selectedTrackId,
        boundTrackIdBeforeSync,
        sameTrackRef,
        sameLanguageButDifferentTrackRef:
          Boolean(selectedTrackLanguage) &&
          Boolean(boundTrackLanguageBeforeSync) &&
          selectedTrackLanguage === boundTrackLanguageBeforeSync &&
          !sameTrackRef,
        differentLanguage:
          Boolean(selectedTrackLanguage) &&
          Boolean(boundTrackLanguageBeforeSync) &&
          selectedTrackLanguage !== boundTrackLanguageBeforeSync,
      });
      const resolvedTrackActiveCuesLength = (() => {
        try {
          return track?.activeCues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })();
      const resolvedTrackCuesLength = (() => {
        try {
          return track?.cues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })();
      const resolvedTrackCurrentCue = getCurrentCue(track, currentTime);
      const resolvedTrackCurrentCueText = cleanCueText(resolvedTrackCurrentCue);

      logContent("secondary-sync resolver-selected", {
        reason: "syncSecondarySubtitleTrack",
        requestedLang: requestedLang || "",
        forceRebind,
        suppressRender,
        currentTime,
        boundTrackExistsBefore: Boolean(previousBoundTrack),
        sameTrackRef,
        previousBoundTrackLanguage: previousBoundTrack?.language || "",
        previousBoundTrackMode: previousBoundTrack?.mode || "",
        selectedTrackExists: Boolean(track),
        ...getSecondaryTrackObservation(track, "selectedTrack"),
      });

      logContent("secondary sync raw", {
        requestedLang: requestedLang || "",
        suppressRender,
        forceRebind,
        boundTrackExistsBefore: Boolean(previousBoundTrack),
        resolvedTrackExists: Boolean(track),
        sameTrackRef,
        boundTrackLanguageBefore: previousBoundTrack?.language || "",
        boundTrackModeBefore: previousBoundTrack?.mode || "",
        resolvedTrackLanguage: track?.language || "",
        resolvedTrackKind: track?.kind || "",
        resolvedTrackMode: track?.mode || "",
        resolvedTrackCuesLength,
        resolvedTrackActiveCuesLength,
        resolvedTrackCurrentCueTextLength: resolvedTrackCurrentCueText.length,
        resolvedTrackHasCueOverlapAtCurrentTime: Boolean(resolvedTrackCurrentCue),
        currentTime,
      });

      if (!track) {
        unbindSecondarySubtitleTrack();
        if (!suppressRender) {
          (renderSecondarySubtitleOverride || renderSecondarySubtitle)("", null);
        }
        return;
      }

      const normalizedRequestedLang = String(requestedLang || "")
        .trim()
        .toLowerCase();
      const previousRequestedSecondaryLang = String(
        previousBoundTrack?.language || "",
      )
        .trim()
        .toLowerCase();
      const requestedLanguageChanged =
        normalizedRequestedLang !== previousRequestedSecondaryLang;

      const unreadableSnapshot = {
        cuesLength: resolvedTrackCuesLength,
        activeCuesLength: resolvedTrackActiveCuesLength,
        hasCueOverlapAtCurrentTime: Boolean(resolvedTrackCurrentCue),
        currentCueTextLength: resolvedTrackCurrentCueText.length,
      };

      const shouldRebindBecauseUnreadable =
        sameTrackRef &&
        unreadableSnapshot.cuesLength > 0 &&
        unreadableSnapshot.activeCuesLength === 0 &&
        !unreadableSnapshot.hasCueOverlapAtCurrentTime &&
        unreadableSnapshot.currentCueTextLength === 0;

      if (shouldRebindBecauseUnreadable) {
        logContent("secondary-sync rebind-required", {
          reason: "sameTrackButUnreadableAtCurrentTime",
          requestedLang: requestedLang || "",
          normalizedRequestedLang,
          previousRequestedSecondaryLang,
          requestedLanguageChanged,
          currentTime,
          sameTrackRef,
          forceRebind,
          resolvedTrackLanguage: track?.language || "",
          resolvedTrackMode: track?.mode || "",
          resolvedTrackCuesLength,
          resolvedTrackActiveCuesLength,
          resolvedTrackCurrentCueTextLength: resolvedTrackCurrentCueText.length,
          resolvedTrackHasCueOverlapAtCurrentTime: Boolean(resolvedTrackCurrentCue),
        });
      }

      const shouldPrimeUnreadableSelectedTrack =
        requestedLanguageChanged &&
        !sameTrackRef &&
        Boolean(track) &&
        resolvedTrackCuesLength > 0 &&
        resolvedTrackActiveCuesLength === 0 &&
        !resolvedTrackCurrentCue &&
        resolvedTrackCurrentCueText.length === 0;

      const modeDecision = resolveSecondaryTrackModePolicy({
        track,
        reason: shouldPrimeUnreadableSelectedTrack
          ? "primeUnreadableSelectedTrack"
          : forceRebind
            ? "forceRebind"
            : shouldRebindBecauseUnreadable
              ? "sameTrackUnreadable"
              : "syncSecondarySubtitleTrack",
        debugForceShowing: DEBUG_SECONDARY_SUBS,
        allowShowing: false,
        unreadableSnapshot,
      });

      if (
        modeDecision.policy === "readability-promote" ||
        modeDecision.policy === "debug-force-showing"
      ) {
        logContent("secondary-sync mode-policy force-showing", {
          requestedLang: requestedLang || "",
          normalizedRequestedLang,
          previousRequestedSecondaryLang,
          requestedLanguageChanged,
          currentTime,
          sameTrackRef,
          forceRebind,
          shouldPrimeUnreadableSelectedTrack,
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          trackModeBefore: track?.mode || "",
          requestedMode: modeDecision.requestedMode,
          policy: modeDecision.policy,
          rationale: modeDecision.rationale,
          decisionReason: modeDecision.reason,
          unreadableSnapshot,
          selectedTrackSnapshot: {
            cuesLength: resolvedTrackCuesLength,
            activeCuesLength: resolvedTrackActiveCuesLength,
            currentCueTextLength: resolvedTrackCurrentCueText.length,
            hasCueOverlapAtCurrentTime: Boolean(resolvedTrackCurrentCue),
          },
        });
      }

      const selectedTrackUnreadable =
        Boolean(track) &&
        resolvedTrackCuesLength === 0 &&
        resolvedTrackActiveCuesLength === 0 &&
        resolvedTrackCurrentCueText.length === 0;

      if (
        !requestedLanguageChanged &&
        !sameTrackRef &&
        selectedTrackUnreadable &&
        previousBoundTrack
      ) {
        logContent("secondary-sync keep-previous-track", {
          requestedLang: requestedLang || "",
          normalizedRequestedLang,
          previousRequestedSecondaryLang,
          requestedLanguageChanged,
          previousBoundTrackLanguage: previousBoundTrack?.language || "",
          selectedTrackLanguage: track?.language || "",
          selectedTrackMode: track?.mode || "",
          selectedTrackCuesLength: resolvedTrackCuesLength,
          selectedTrackActiveCuesLength: resolvedTrackActiveCuesLength,
          selectedTrackCurrentCueTextLength: resolvedTrackCurrentCueText.length,
        });

        if (!suppressRender) {
          (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
            getCurrentCueText(previousBoundTrack),
            previousBoundTrack,
          );
        }

        rebuildCurrentSceneSubtitleBlocks();
        return;
      }

      if (
        secondaryTrackBound !== track ||
        forceRebind ||
        shouldRebindBecauseUnreadable
      ) {
        bindSecondarySubtitleTrack(track, modeDecision);
        rebuildCurrentSceneSubtitleBlocks();
        return;
      }

      if (!suppressRender) {
        (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
          getCurrentCueText(track),
          track,
        );
      }

      rebuildCurrentSceneSubtitleBlocks();
    }

    // runtime / current cue / sequence を 1 つにまとめ、
    // controller が recovery 判定に使う merged subtitle health を組み立てる。
    // truth source は SubtitleBlockSequence 側の sequenceHealth で、runtime は補助観測として扱う。
    function buildMergedSubtitleHealth({
      primaryTrack,
      secondaryTrack,
      pCue,
      pText,
      sCue,
      sText,
      sequenceHealth,
    }) {
      if (cueRenderCoordinator?.buildMergedSubtitleHealth) {
        return cueRenderCoordinator.buildMergedSubtitleHealth({
          primaryTrack,
          secondaryTrack,
          pCue,
          pText,
          sCue,
          sText,
          sequenceHealth,
        });
      }

      const runtime = {
        primaryTrackFound: Boolean(primaryTrack),
        secondaryTrackFound: Boolean(secondaryTrack),
        primaryActiveCues: getTrackActiveCuesLength(primaryTrack),
        secondaryActiveCues: getTrackActiveCuesLength(secondaryTrack),
      };

      const currentCue = {
        hasPrimaryCue: Boolean(pCue),
        hasSecondaryCue: Boolean(sCue),
        hasFreshCurrentPrimary: Boolean(pCue) && Boolean(pText),
        primaryTextLength: pText.length,
        secondaryTextLength: sText.length,
        hasPrimaryText: Boolean(pText),
        hasSecondaryText: Boolean(sText),
      };

      const sequence = {
        hasCurrentBlock: Boolean(sequenceHealth?.hasCurrentBlock),
        hasCurrentPrimary: Boolean(sequenceHealth?.hasCurrentPrimary),
        hasCurrentSecondary: Boolean(sequenceHealth?.hasCurrentSecondary),
        currentPairAligned: Boolean(sequenceHealth?.currentPairAligned),
        currentPairMissingSecondary: Boolean(
          sequenceHealth?.currentPairMissingSecondary,
        ),
        previousPairMissingSecondary: Boolean(
          sequenceHealth?.previousPairMissingSecondary,
        ),
        consecutiveCurrentMissingSecondary: Boolean(
          sequenceHealth?.consecutiveCurrentMissingSecondary,
        ),
      };

      const primaryHealthy =
        runtime.primaryTrackFound &&
        (runtime.primaryActiveCues > 0 ||
          currentCue.hasPrimaryText ||
          sequence.hasCurrentPrimary);

      const secondaryHealthy =
        runtime.secondaryTrackFound &&
        (runtime.secondaryActiveCues > 0 ||
          currentCue.hasSecondaryText ||
          sequence.hasCurrentSecondary);

      const sequenceSuggestsSecondaryGap = sequence.currentPairMissingSecondary;

      const shouldRecoverSecondary =
        primaryHealthy && !secondaryHealthy && sequenceSuggestsSecondaryGap;

      const shouldForceSecondaryRebind =
        shouldRecoverSecondary && sequence.consecutiveCurrentMissingSecondary;

      return {
        runtime,
        currentCue,
        sequence,
        derived: {
          primaryHealthy,
          secondaryHealthy,
          shouldRecoverSecondary,
          shouldForceSecondaryRebind,
        },
      };
    }

    // nearby rebuild の 1 回保護状態と hold view をまとめて解除する。
    // eslint-disable-next-line no-unused-vars 
    function clearNearbyRebuildGuard() {
      nearbyRebuildGuard = null;
      state.nearbyRebuildHoldView = null;
    }

    // 次の primary cue change で消費する予定だった guard だけを取り下げる。
    // eslint-disable-next-line no-unused-vars 
    function consumeNearbyRebuildGuard() {
      nearbyRebuildGuard = null;
    }

    // 現在が large seek 直後の nearby rebuild 許可 window 内かを判定する。
    function isWithinNearbyRebuildSeekWindow() {
      const lastLargeSeekAt = Number(state.lastLargeSeekAt ?? 0);
      if (!lastLargeSeekAt) return false;
      return Date.now() - lastLargeSeekAt <= NEARBY_REBUILD_SEEK_WINDOW_MS;
    }

    // nearby rebuild 直後の current block を次の 1 回だけ保護する。
    // eslint-disable-next-line no-unused-vars 
    function armNearbyRebuildGuard(currentBlock) {
      nearbyRebuildGuard = {
        consumeOnNextPrimaryCueChange: true,
        issuedAt: Date.now(),
        blockStartTime: currentBlock?.startTime ?? null,
        blockEndTime: currentBlock?.endTime ?? null,
        sourceReason: currentBlock?.sourceReason ?? "nearbyRebuild",
      };
    }

    // 次の primary cue change で nearby rebuild の current / hold view を優先するか判定する。
    // eslint-disable-next-line no-unused-vars 
    function shouldPreserveNearbyRebuildCurrentBlock() {
      const guardActive = Boolean(
        nearbyRebuildGuard?.consumeOnNextPrimaryCueChange,
      );
      if (!guardActive) return false;

      const hasNearbySource = Boolean(
        state.nearbyRebuildHoldView?.currentBlock?.sourceReason ===
          "nearbyRebuildHold" ||
          state.currentSubtitleBlock?.sourceReason === "nearbyRebuild",
      );
      if (!hasNearbySource) return false;

      return isWithinNearbyRebuildSeekWindow();
    }

    // 現在時刻近傍の cue だけで subtitle blocks を組み直し、current view / current block を更新する。
    function rebuildCurrentSceneSubtitleBlocks() {
      const primaryTrack = getBoundPrimaryTrack();
      const secondaryTrack = getBoundSecondaryTrack();

      if (cueSequenceBuilder?.rebuildSequence) {
        const result = cueSequenceBuilder.rebuildSequence({
          primaryTrack,
          secondaryTrack,
          rebuildReason: "rebuildCurrentSceneSubtitleBlocks",
        });

        return {
          ...result,
          primaryTrack,
          secondaryTrack,
        };
      }

      const currentTime = getCurrentTime();

      const primaryCue = getCurrentCue(primaryTrack, currentTime);
      const secondaryCue = getCurrentCue(secondaryTrack, currentTime);

      const primaryText = cleanCueText(primaryCue);
      const secondaryText = cleanCueText(secondaryCue);

      const primaryCues = getPrimaryTrackCues();
      const secondaryCues = getSecondaryTrackCues();

      const previousSequence = getPreviousSubtitleBlocks();
      const previousBlocks = Array.isArray(previousSequence?.blocks)
        ? previousSequence.blocks
        : Array.isArray(previousSequence)
          ? previousSequence
          : [];

      const sequence = buildSubtitleBlockSequence({
        primaryCues,
        secondaryCues,
        now: currentTime,
        previousBlocks,
        cleanCueText,
        rebuildReason: "rebuildCurrentSceneSubtitleBlocks",
      });

      const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
      setSubtitleBlocks(sequence);

      const currentIndex = Number.isInteger(sequence?.currentIndex)
        ? sequence.currentIndex
        : -1;

      const currentBlock =
        currentIndex >= 0 && currentIndex < blocks.length
          ? blocks[currentIndex] || null
          : null;

      setCurrentSubtitleBlock(currentBlock, sequence?.meta || null);

      const sequenceHealth = sequence?.meta?.sequenceHealth || null;

      if (DEBUG_SECONDARY_SUBS) {
        logContent("subtitle-blocks rebuild", {
          reason: "rebuildCurrentSceneSubtitleBlocks",
          currentTime,
          primaryTrackFound: Boolean(primaryTrack),
          secondaryTrackFound: Boolean(secondaryTrack),
          primaryTextLength: primaryText.length,
          secondaryTextLength: secondaryText.length,
          hasPrimaryCue: Boolean(primaryCue),
          hasSecondaryCue: Boolean(secondaryCue),
          hasCurrentBlock: Boolean(currentBlock),
          hasCurrentPrimary: Boolean(currentBlock?.primaryText),
          hasCurrentSecondary: Boolean(currentBlock?.secondaryText),
          currentPairAligned: Boolean(sequenceHealth?.currentPairAligned),
          currentPairMissingSecondary: Boolean(
            sequenceHealth?.currentPairMissingSecondary,
          ),
          previousPairMissingSecondary: Boolean(
            sequenceHealth?.previousPairMissingSecondary,
          ),
          consecutiveCurrentMissingSecondary: Boolean(
            sequenceHealth?.consecutiveCurrentMissingSecondary,
          ),
          totalBlockCount: blocks.length,
          currentIndex,
          sequenceMeta: sequence?.meta || null,
        });
      }

      return {
        sequence,
        currentBlock,
        sequenceHealth,
        primaryCue,
        secondaryCue,
        primaryText,
        secondaryText,
        primaryTrack,
        secondaryTrack,
      };
    }

    // primary cue change を基準に full rebuild を行い、必要なら 1 回だけ nearby current / hold view を優先する。
    function onPrimaryCueChange() {
      // ★ enabled チェック
      if (state?.contentSettings?.enabled === false) return;
      const currentTime = getCurrentTime();

      const primaryTrack = getBoundPrimaryTrack();
      const secondaryTrack = getBoundSecondaryTrack();

      const primaryCue = getCurrentCue(primaryTrack, currentTime);
      const secondaryCue = getCurrentCue(secondaryTrack, currentTime);

      const primaryText = cleanCueText(primaryCue);
      const secondaryText = cleanCueText(secondaryCue);

      const sequenceApi =
        (typeof getSubtitleBlockSequence === "function" && getSubtitleBlockSequence()) ||
        null;

      const rebuildResult = rebuildCurrentSceneSubtitleBlocks();

      renderCurrentSnapshot?.();
      renderPanel?.();

      if (DEBUG_SECONDARY_SUBS) {
        logContent("primary cuechange rebuild result", {
          reason: "onPrimaryCueChange",
          currentTime,
          rebuildResult: rebuildResult
            ? {
                hasSequence: Boolean(rebuildResult.sequence),
                blockCount:
                  Array.isArray(rebuildResult.sequence?.blocks)
                    ? rebuildResult.sequence.blocks.length
                    : null,
                currentIndex: Number.isInteger(rebuildResult.sequence?.currentIndex)
                  ? rebuildResult.sequence.currentIndex
                  : null,
                currentBlock: rebuildResult.currentBlock
                  ? {
                      key: rebuildResult.currentBlock.key || "",
                      startTime: Number(rebuildResult.currentBlock.startTime ?? 0),
                      endTime: Number(rebuildResult.currentBlock.endTime ?? 0),
                      state: rebuildResult.currentBlock.state || "",
                      primaryText: String(rebuildResult.currentBlock.primaryText || ""),
                      secondaryText: String(rebuildResult.currentBlock.secondaryText || ""),
                    }
                  : null,
                sequenceMeta: rebuildResult.sequence?.meta || null,
              }
            : null,
        });
      }

      const sequenceHealth =
        rebuildResult?.sequenceHealth ||
        sequenceApi?.getHealth?.() ||
        null;

      const mergedHealth = buildMergedSubtitleHealth({
        primaryTrack,
        secondaryTrack,
        pCue: primaryCue,
        pText: primaryText,
        sCue: secondaryCue,
        sText: secondaryText,
        sequenceHealth,
      });

      if (DEBUG_SECONDARY_SUBS) {
        logContent("primary cuechange merged-health", {
          reason: "onPrimaryCueChange",
          currentTime,
          runtime: mergedHealth?.runtime || null,
          currentCue: mergedHealth?.currentCue || null,
          sequence: mergedHealth?.sequence || null,
          derived: mergedHealth?.derived || null,
          hasCurrentBlock: Boolean(rebuildResult?.currentBlock),
          currentPrimaryTextLength:
            rebuildResult?.currentBlock?.primaryText?.length ?? 0,
          currentSecondaryTextLength:
            rebuildResult?.currentBlock?.secondaryText?.length ?? 0,
          sequenceApiFound: Boolean(sequenceApi),
        });
      }

      const recoveryDecision = evaluateSecondaryRecovery({
        now: Date.now(),
        runtime: mergedHealth?.runtime || null,
        currentCue: mergedHealth?.currentCue || null,
        sequence: mergedHealth?.sequence || null,
        derived: mergedHealth?.derived || null,
      });

      if (DEBUG_SECONDARY_SUBS) {
        logContent("secondary recovery evaluation", {
          reason: "onPrimaryCueChange",
          currentTime,
          action: recoveryDecision?.action || "idle",
          reasonCode: recoveryDecision?.reason || "",
          primaryLane: recoveryDecision?.primaryLane || null,
          secondaryLane: recoveryDecision?.secondaryLane || null,
        });
      }

      if (recoveryDecision?.action === "recover") {
        syncSecondarySubtitleTrack(
          getVideoElement(),
          getRequestedSecondaryLanguage(),
          null,
          {
            suppressRender: false,
            forceRebind: false,
          },
        );
        return;
      }

      if (recoveryDecision?.action === "force-rebind") {
        syncSecondarySubtitleTrack(
          getVideoElement(),
          getRequestedSecondaryLanguage(),
          null,
          {
            suppressRender: false,
            forceRebind: true,
          },
        );
        return;
      }
    }

    return {
      ensureSubtitleTracksUsable,
      getBoundPrimaryTrack,
      unbindPrimarySubtitleTrack,
      handoffPrimarySubtitleToNative,
      restoreNativeSubtitles,
      bindPrimarySubtitleTrack,
      getBoundSecondaryTrack,
      unbindSecondarySubtitleTrack,
      bindSecondarySubtitleTrack,
      syncSecondarySubtitleTrack,
      onCueChange,
      onPrimaryCueChange,
      getMergedSubtitleHealth: () => lastMergedSubtitleHealth,
      getLaneStates: () =>
        secondaryTrackRecovery?.laneStates || laneStates,
      resetSecondaryRecoveryLane,
      evaluateSecondaryRecovery,
    };
  }

  // cue controller factory を ATVB 名前空間へ公開する。
  root.cueController = {
    createCueController,
  };
})();
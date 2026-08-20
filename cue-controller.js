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
    DEBUG_MEMORY_PROBE,
    getSecondaryTrackDebugPayload,
    selectSecondarySubtitleTrack,
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
    subtitleRecoveryManager = null,
    createTrackListenerBinding = null,
  }) {

    let primaryTrackCleanup = null;
    let primaryTrackCleanupMeta = null;
    let primaryTrackBound = null;
    let primaryTrackOriginalMode = null;

    let secondaryTrackBound = null;
    let secondaryTrackOriginalMode = null;


    // ensureSubtitleTracksUsable() で一時的に mode を変更した track 一覧。
    // bound 済み primary / secondary 以外も含めて、拡張OFF時に元 mode を復元するために使う。
    const temporarilyActivatedTrackModes = new Map();

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

    function logMemoryProbe(message, payload = null) {
      if (!DEBUG_MEMORY_PROBE) return;
      logContent(message, payload);
    }

    let listenerBindingSeq = 0;

    function getActiveSessionId() {
      return Number.isFinite(state?.activeBilingualSessionId)
        ? state.activeBilingualSessionId
        : null;
    }

    function createListenerBindingMeta(lane, track, extra = {}) {
      listenerBindingSeq += 1;

      return {
        bindingId: `${lane}-${listenerBindingSeq}`,
        sessionId: getActiveSessionId(),
        lane,
        trackLanguage: track?.language || "",
        trackKind: track?.kind || "",
        trackLabel: track?.label || "",
        ...extra,
      };
    }

    function buildExistingBindingMeta(meta, extra = {}) {
      return {
        bindingId: meta?.bindingId || "",
        sessionId: meta?.sessionId ?? getActiveSessionId(),
        lane: meta?.lane || "",
        trackLanguage: meta?.trackLanguage || "",
        trackKind: meta?.trackKind || "",
        trackLabel: meta?.trackLabel || "",
        ...extra,
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
        showingTrackCount: tracks.filter((track) => track?.mode === "showing").length,
        hiddenTrackCount: tracks.filter((track) => track?.mode === "hidden").length,
        disabledTrackCount: tracks.filter((track) => track?.mode === "disabled").length,
        primaryBoundTrack: getUsableTrackDebugPayload(primaryTrackBound),
        secondaryBoundTrack: getUsableTrackDebugPayload(secondaryTrackBound),
        ...extra,
      };

      logContent("text track snapshot", payload);

      return payload;
    }

    function rememberOriginalTrackMode(track) {
      if (!track || temporarilyActivatedTrackModes.has(track)) return;
      try {
        temporarilyActivatedTrackModes.set(track, track.mode);
      } catch (_) {}
    }

    function restoreTemporarilyActivatedTrackModes() {
      for (const [track, originalMode] of temporarilyActivatedTrackModes.entries()) {
        try {
          track.mode = originalMode;
        } catch (_) {}
      }
      temporarilyActivatedTrackModes.clear();
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

      const targetTrack = options.targetTrack || null;
      if (!video?.textTracks || (!requestedLang && !targetTrack)) {
                const payload = {
          reason,
          requestedLang: requestedLang || "",
          finalMode: "hidden",
          matchedTrackCount: 0,
          activatedTrackCount: 0,
          activated: false,
          activationHoldMs,
          cuePollIntervalMs,
          cuePollTimeoutMs,
          currentTime: Number.isFinite(video?.currentTime)
            ? video.currentTime
            : null,
          readyState: video?.readyState ?? null,
          paused:
            typeof video?.paused === "boolean" ? video.paused : null,
          videoSrc: video?.currentSrc || video?.src || "",
          tracks: [],
        };
        if (DEBUG_SECONDARY_SUBS) {
          logContent("subtitle track usability", payload);
        }
        return payload;

      }

      const tracks = Array.from(video.textTracks || []);
      const targets = targetTrack
        ? tracks.filter((track) => track === targetTrack)
        : tracks.filter((track) => {
            if (!track) return false;
            const kind = String(track.kind || "").toLowerCase();
            if (kind !== "subtitles" && kind !== "captions") return false;
            if (isForcedLikeTrack?.(track)) return false;
            return matchesRequestedLanguage?.(track, requestedLang);
          });

      let activatedTrackCount = 0;
      for (const track of targets) {
        try {
          rememberOriginalTrackMode(track);
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
              const originalMode = temporarilyActivatedTrackModes.has(track)
                ? temporarilyActivatedTrackModes.get(track)
                : "hidden";
              track.mode = originalMode;
              temporarilyActivatedTrackModes.delete(track);
            } catch (_) {}
          }

          if (DEBUG_SECONDARY_SUBS) {
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
          }
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
        currentTime: Number.isFinite(video?.currentTime)
          ? video.currentTime
          : null,
        readyState: video?.readyState ?? null,
        paused:
          typeof video?.paused === "boolean" ? video.paused : null,
        videoSrc: video?.currentSrc || video?.src || "",
        tracks: targets.map((track) => getUsableTrackDebugPayload(track)),
      };

      if (DEBUG_SECONDARY_SUBS) {
        logContent("subtitle track usability", payload);
      }
      return payload;

    }

    // 最新の merged subtitle health を観測・外部参照用に保持する。
    let lastMergedSubtitleHealth = null;

    // nearby rebuild の current block 保護を 1 回だけ成立させる guard を保持する。
    let nearbyRebuildGuard = null;

    // nearby rebuild 直後に一時利用する hold view の格納先を初期化する。
    state.nearbyRebuildHoldView ??= null;

    // large seek 直後として nearby rebuild を許可する時間窓を定義する。
    const NEARBY_REBUILD_SEEK_WINDOW_MS = 4000;

    function resetSecondaryRecoveryLane(reason = "manual-reset") {
      return subtitleRecoveryManager?.resetSecondaryRecovery?.(reason) ?? null;
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


    function evaluateSecondaryRecovery({
      now,
      runtime,
      currentCue,
      sequence,
      derived,
    }) {
      if (subtitleRecoveryManager?.evaluateSecondaryRecovery) {
        return subtitleRecoveryManager.evaluateSecondaryRecovery({
          now,
          runtime,
          currentCue,
          sequence,
          derived,
        });
      }

      return {
        primaryLane: null,
        secondaryLane: null,
        action: "idle",
        reason: "subtitle_recovery_manager_unavailable",
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
      const cleanupMeta = primaryTrackCleanupMeta;

      if (primaryTrackCleanup) {
        logMemoryProbe(
          "track-listener-cleaned",
          buildExistingBindingMeta(cleanupMeta, {
            hadCleanup: true,
          }),
        );

        primaryTrackCleanup();
        primaryTrackCleanup = null;
        primaryTrackCleanupMeta = null;
      }

      logMemoryProbe(
        "primary-track-unbound",
        buildExistingBindingMeta(cleanupMeta, {
          hadTrack: Boolean(track),
          restoreMode,
          originalMode: primaryTrackOriginalMode,
        }),
      );

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

    // OFF 時に primary 字幕の制御を手放す。
    // ネイティブ UI のチェック状態を拡張側が書き換えないよう、
    // track.mode を強制 showing にはせず、拡張が触る前の値へ戻すだけにする。
    function handoffPrimarySubtitleToNative() {
      const track = primaryTrackBound;
      const originalMode = primaryTrackOriginalMode;

      if (primaryTrackCleanup) {
        primaryTrackCleanup();
        primaryTrackCleanup = null;
      }

      const suppress = document.getElementById("atvb-cue-suppress");
      if (suppress) suppress.remove();

      // ★ ここが今回の修正点:
      // 以前は track.mode = "showing" を強制していたが、
      // これが Apple 側メニューの「オン」表示だけを書き換え、
      // 実際の描画が伴わないズレを生んでいたため削除する。
      // 代わりに、拡張が bind する前の mode へ戻すだけにする。
      if (track && originalMode != null) {
        try {
          track.mode = originalMode;
        } catch (_) {}
      }

      restoreTemporarilyActivatedTrackModes();

      primaryTrackBound = null;
      primaryTrackOriginalMode = null;

      return track || null;
    }

    // ネイティブ字幕の CSS 抑制を解除し、
    // 拡張が変更した primary / secondary track の mode を元に戻して制御を手放す。
    function restoreNativeSubtitles() {
      const primaryTrack = primaryTrackBound;
      const secondaryTrack = secondaryTrackBound;
      const primaryOriginalMode = primaryTrackOriginalMode;
      const secondaryOriginalMode = secondaryTrackOriginalMode;

      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      const secondaryMonitorState =
        binder?.getSecondaryMonitorState?.() || null;

      dumpTextTrackSnapshot("restoreNativeSubtitles before", {
        primaryTrack: getUsableTrackDebugPayload(primaryTrack),
        secondaryTrack: getUsableTrackDebugPayload(secondaryTrack),
        primaryOriginalMode,
        secondaryOriginalMode,
        hasPrimaryTrackCleanup: Boolean(primaryTrackCleanup),
        hasSecondaryTrackCleanup: Boolean(secondaryMonitorState?.active),
      });

      if (primaryTrackCleanup) {
        primaryTrackCleanup();
        primaryTrackCleanup = null;
      }

      // Step 4: secondary の解除も binder の停止 API のみを使う。
      // binder / secondaryMonitorState は関数冒頭で取得済みのものを再利用する。
      if (secondaryMonitorState?.active) {
        try {
          binder.stopSecondaryMonitor();
        } catch (_) {}
      }

      if (primaryTrack && primaryOriginalMode != null) {
        try {
          primaryTrack.mode = primaryOriginalMode;
        } catch (_) {}
      }

      if (secondaryTrack && secondaryOriginalMode != null) {
        try {
          secondaryTrack.mode = secondaryOriginalMode;
        } catch (_) {}
      }

      restoreTemporarilyActivatedTrackModes();

      const suppress = document.getElementById("atvb-cue-suppress");
      if (suppress) suppress.remove();

      primaryTrackBound = null;
      primaryTrackOriginalMode = null;
      secondaryTrackBound = null;
      secondaryTrackOriginalMode = null;

      dumpTextTrackSnapshot("restoreNativeSubtitles after", {
        primaryTrack: getUsableTrackDebugPayload(primaryTrack),
        secondaryTrack: getUsableTrackDebugPayload(secondaryTrack),
      });
    }

    // secondary track の listener を解除し、必要に応じて拡張が変更する前の mode に戻す。
    // Step 4: 解除の実体は binder.stopSecondaryMonitor() のみを使う。
    function unbindSecondarySubtitleTrack(options = {}) {
      const restoreMode = options.restoreMode !== false;
      const track = secondaryTrackBound;
      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      const monitorState = binder?.getSecondaryMonitorState?.() || null;

      if (monitorState?.active) {
        logMemoryProbe(
          "track-listener-cleaned",
          buildExistingBindingMeta(monitorState.meta, {
            hadCleanup: true,
          }),
        );

        try {
          binder?.stopSecondaryMonitor?.();
        } catch (_) {}
      }

      logMemoryProbe(
        "secondary-track-unbound",
        buildExistingBindingMeta(monitorState?.meta, {
          hadTrack: Boolean(track),
          restoreMode,
          originalMode: secondaryTrackOriginalMode,
        }),
      );

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
        targetTrack: track,
      });

      try {
        track.mode = "showing";
      } catch (_) {}

      suppressNativeSubtitles();

      const video = options.video || null;
      const binding = createTrackListenerBinding?.({
        track,
        onCueChange,
        video,
        passTrackToHandler: false,
        usePlaybackSignals: true,
      });

      if (!binding) {
        primaryTrackCleanup = null;
        primaryTrackBound = null;
        return false;
      }

      const bindingMeta = createListenerBindingMeta("primary", track, {
        usePlaybackSignals: true,
      });

      logMemoryProbe(
        "track-listener-created",
        buildExistingBindingMeta(bindingMeta, {
          reason: options.reason || "",
          requestedLang: options.requestedLang || "",
          videoSrc: video?.currentSrc || video?.src || "",
        }),
      );

      primaryTrackBound = track;
      primaryTrackCleanupMeta = bindingMeta;
      primaryTrackCleanup = () => {
        try {
          binding.cleanup();
        } catch (_) {}
      };

      logMemoryProbe(
        "primary-track-bound",
        buildExistingBindingMeta(bindingMeta, {
          reason: options.reason || "",
          requestedLang: options.requestedLang || "",
          videoSrc: video?.currentSrc || video?.src || "",
        }),
      );

      requestAnimationFrame(() => {
        try {
          binding.notifyInitial();
        } catch (_) {}
      });

      return true;
    }

    // secondary cue change を受けて secondary 表示と primary 側更新を進める。
    function onCueChange(track) {
      if (track && false && DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary cuechange render",
          getSecondaryTrackDebugPayload(getRequestedSecondaryLanguage(), track),
        );
      }

      if (track) {
        const currentTime = getCurrentTime();
        const cueText = getCurrentCueText(track, currentTime);
        const overlapCue = getCurrentCue(track, currentTime);

        if (false && DEBUG_SECONDARY_SUBS) {
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
    // mode の決定は呼び出し側で行い、listener の開始・差し替え・停止は
    // cue-track-binder.js 側の secondary monitor API へ委譲する。
    function bindSecondarySubtitleTrack(track, modeDecision) {
      if (!track) return;

      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      const monitorState = binder?.getSecondaryMonitorState?.() || null;

      const previousBoundTrack = secondaryTrackBound;
      const requestedMode = modeDecision?.requestedMode || "hidden";
      const currentTrackMode = track?.mode || "";
      const sameTrackRef = previousBoundTrack === track;
      const sameMode =
        String(currentTrackMode || "").toLowerCase() ===
        String(requestedMode || "").toLowerCase();

      // Step 4:
      // skip 判定は controller 側の cleanup 保持ではなく、
      // binder が実際に監視中かどうか（monitor state）で行う。
      if (sameTrackRef && sameMode && monitorState?.active) {
        return;
      }


      unbindSecondarySubtitleTrack();

      const previousMode = track?.mode || "";

      // F-5:
      // secondary は拡張の補助字幕レーンとして bind するため、
      // restore 時に native 側へ showing を残さないよう、
      // bind 前が showing でも復元先は hidden として扱う。
      // primary の native 字幕状態は primaryTrackOriginalMode 側で復元する。
      secondaryTrackOriginalMode =
        previousMode === "showing" ? "hidden" : previousMode;

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
      };

      const maybePromoteTrackReadability = () => {};

      applyTrackMode(requestedMode, "bind-initial");

      if (false && DEBUG_SECONDARY_SUBS) {
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

      const handleSecondaryCueChange = () => {
        if (false && DEBUG_SECONDARY_SUBS) {
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

        if (false && DEBUG_SECONDARY_SUBS) {
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

      // Step 4:
      // binder は既に宣言済み（guard 判定で取得したものを再利用する）。
      const monitorResult = binder?.replaceSecondaryMonitor?.(
        track,
        handleSecondaryCueChange,
        { video: null },
      );

      if (!monitorResult || monitorResult.reason === "binding-failed") {
        secondaryTrackBound = null;
        return;
      }

      const bindingMeta = createListenerBindingMeta("secondary", track, {
        usePlaybackSignals: false,
      });

      logMemoryProbe(
        "track-listener-created",
        buildExistingBindingMeta(bindingMeta, {
          reason: modeDecision?.reason || "",
          requestedLang: getRequestedSecondaryLanguage?.() || "",
          currentTime: getCurrentTime(),
        }),
      );

      // Step 4:
      // cleanup の実体は controller 側で持たない。
      // 「本当に監視中か」は binder.getSecondaryMonitorState() が唯一の正とする。
      secondaryTrackBound = track;

      logMemoryProbe(
        "secondary-track-bound",
        buildExistingBindingMeta(bindingMeta, {
          reason: modeDecision?.reason || "",
          requestedLang: getRequestedSecondaryLanguage?.() || "",
          currentTime: getCurrentTime(),
        }),
      );

      maybePromoteTrackReadability();
    }

    // secondary track の再解決と再同期を行い、必要なら nearby rebuild まで進める。
    function syncSecondaryTrackOrchestration(
      video,
      requestedLang,
      renderSecondarySubtitleOverride,
      options = {},
    ) {
      if (!video) return;

      const suppressRender = options.suppressRender === true;
      const forceRebind = options.forceRebind === true;
      const previousBoundTrack = secondaryTrackBound;

      if (false && DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary sync",
          getSecondaryTrackDebugPayload(requestedLang, secondaryTrackBound),
        );
      }

      ensureSubtitleTracksUsable(video, requestedLang, {
        finalMode: "hidden",
        reason: "secondary-sync",
      });

      const selection = selectSecondarySubtitleTrack(
        video,
        requestedLang,
        previousBoundTrack,
      );

      const currentTime = selection.currentTime;
      const track = selection.track;
      const sameTrackRef = selection.sameTrackRef;
      const requestedLanguageChanged = Boolean(
        selection.requestedLanguageChanged,
      );
      const unreadableSnapshot = {
        cuesLength: selection.snapshot?.cuesLength ?? 0,
        activeCuesLength: selection.snapshot?.activeCuesLength ?? 0,
        hasCueOverlapAtCurrentTime: Boolean(
          selection.snapshot?.hasCueOverlapAtCurrentTime,
        ),
        currentCueTextLength: selection.snapshot?.currentCueTextLength ?? 0,
      };

      if (!track) {
        unbindSecondarySubtitleTrack();
        if (!suppressRender) {
          (renderSecondarySubtitleOverride || renderSecondarySubtitle)("", null);
        }
        return;
      }

      if (!sameTrackRef || forceRebind) {
        bindSecondarySubtitleTrack(track, {
          requestedMode: "hidden",
          policy: "secondary-sync",
          rationale: forceRebind
            ? "force-rebind"
            : "selected-track-changed",
          unreadableSnapshot,
        });
      }

      const currentCue = getCurrentCue(track, currentTime);
      const currentCueText = cleanCueText(currentCue);

      if (!suppressRender) {
        (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
          currentCueText,
          currentCue,
        );
      }

      const rebuildResult = rebuildCurrentSceneSubtitleBlocks();
      if (rebuildResult?.currentBlock) {
        setCurrentSubtitleBlock(rebuildResult.currentBlock);
      }

      if (DEBUG_MEMORY_PROBE) {
        logContent("secondary-sync memory-probe", {
          requestedLang: requestedLang || "",
          sameTrackRef,
          forceRebind,
          requestedLanguageChanged,
          hasCurrentBlock: Boolean(rebuildResult?.currentBlock),
        });
      }
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

      const primaryCueWindowBeforeSeconds = 180;
      const primaryCueWindowAfterSeconds = 30;
      const secondaryCueWindowBeforeSeconds = 300;
      const secondaryCueWindowAfterSeconds = 60;

      function toCueArray(cuesLike) {
        return Array.from(cuesLike || []);
      }

      function filterCuesByTimeWindow(
        cuesLike,
        now,
        beforeSeconds,
        afterSeconds,
      ) {
        return toCueArray(cuesLike).filter((cue) => {
          const startTime = Number(cue?.startTime ?? Number.NaN);
          const endTime = Number(cue?.endTime ?? Number.NaN);
          if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
            return false;
          }
          return (
            endTime >= now - beforeSeconds &&
            startTime <= now + afterSeconds
          );
        });
      }

      const primaryCues = filterCuesByTimeWindow(
        getPrimaryTrackCues(),
        currentTime,
        primaryCueWindowBeforeSeconds,
        primaryCueWindowAfterSeconds,
      );
      const secondaryCues = filterCuesByTimeWindow(
        getSecondaryTrackCues(),
        currentTime,
        secondaryCueWindowBeforeSeconds,
        secondaryCueWindowAfterSeconds,
      );

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
      setSubtitleBlocks(sequence, {
        sourceTag: "cue-controller",
        reason: "cue_controller_rebuild",
      });

      const currentIndex = Number.isInteger(sequence?.currentIndex)
        ? sequence.currentIndex
        : -1;

      const currentBlock =
        currentIndex >= 0 && currentIndex < blocks.length
          ? blocks[currentIndex] || null
          : null;

      setCurrentSubtitleBlock(currentBlock, sequence?.meta || null);

      const sequenceHealth = sequence?.meta?.sequenceHealth || null;

      if (false && DEBUG_SECONDARY_SUBS) {
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
      // ★ extensionEnabled チェック
      if (state?.contentSettings?.extensionEnabled === false) return;
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

      if (false && DEBUG_SECONDARY_SUBS) {
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

      if (false && DEBUG_SECONDARY_SUBS) {
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

      if (false && DEBUG_SECONDARY_SUBS) {
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
        syncSecondaryTrackOrchestration(
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
        syncSecondaryTrackOrchestration(
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

    // インスタンスが不要になったとき内部リソースを解放する。
    // unbind → 内部依存モジュールの destroy の順で呼ぶ。
    function destroy() {
      unbindPrimarySubtitleTrack();
      unbindSecondarySubtitleTrack({ restoreMode: true });
      restoreTemporarilyActivatedTrackModes();
      cueRenderCoordinator?.destroy?.();
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
      syncSecondaryTrackOrchestration,
      onCueChange,
      onPrimaryCueChange,
      getMergedSubtitleHealth: () => lastMergedSubtitleHealth,
      getLaneStates: () => subtitleRecoveryManager?.getLaneStates?.() || null,
      resetSecondaryRecoveryLane,
      evaluateSecondaryRecovery,
      destroy,                          // ← 追加
    };
  }

  // cue controller factory を ATVB 名前空間へ公開する。
  root.cueController = {
    createCueController,
  };
})();
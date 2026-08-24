// =============================================================
// Apple TV+ Bilingual Subtitles - cue-controller.js
// version: 2.6.4
// 役割:
// - cue change を起点に secondary sync / scene rebuild / overlay / panel 更新を統括する。
// - subtitle block sequence の構築詳細は cue-sequence-builder.js 正本へ委譲する。
// - merged subtitle health を組み立て、secondary recovery 判定へ渡す。
// - listener / track bind の実体は binder 側に委譲し、controller は orchestration に留まる。
// Phase J:
// - secondary missing の runtime 監視、recovery 判定、nearby rebuild の 1 回保護を担当する。
// - current subtitle / panel / recovery の接続点を保ちつつ、sequence build の二重実装を持たない。
// =============================================================

(() => {
  // ATVB 名前空間を取得し、cue controller を公開する先を固定する。
  const root = (window.ATVB = window.ATVB || {});

  /**
   * cue-controller 全体の依存を受け取り、
   * cue change を起点に current subtitle / overlay / panel / recovery 更新を統括する。
   *
   * Step 16-B 以降は sequence build 詳細を cue-sequence-builder.js 正本へ戻すため、
   * controller 側では cue 配列抽出・previousBlocks 引き継ぎ・
   * subtitle block sequence 構築・currentBlock 決定の詳細を持たない。
   *
   * ここで受け取る依存は、
   * - track / cue の現在状態を観測するためのもの
   * - secondary sync / recovery を判断するためのもの
   * - builder / renderer / panel へ結果を流すためのもの
   * に限定する。
   */
  function createCueController({
    state,
    logContent,
    DEBUG_SECONDARY_SUBS,
    DEBUG_MEMORY_PROBE,
    getSecondaryTrackDebugPayload,
    buildSecondarySyncDecision,
    resolveSecondaryWaitOutcome,
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
    // Step 16-B 以降は builder 正本へ移行済み。
    // ここでは current subtitle / hold view の互換参照が残るため一時的に受け取る。
    getSubtitleBlockSequence,
    getCurrentSubtitleBlockFromSequence: _getCurrentSubtitleBlockFromSequence,
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
    // secondary の所有状態は binder 側が正本なので、
    // まず binder の monitor state を見に行き、
    // binder 未初期化時のみローカル変数へフォールバックする。
    function getBoundSecondaryTrack() {
      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      const monitorState = binder?.getSecondaryMonitorState?.() || null;
      return monitorState?.track || secondaryTrackBound || null;
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
    //
    // secondary 側の停止・mode 復元は binder.stopSecondaryMonitor() に一本化する。
    // fallbackTrack / fallbackOriginalMode は、binder の monitor state が
    // 既に空でも controller 側の値で復元できるようにするための橋渡し。
    function restoreNativeSubtitles() {
      const primaryTrack = primaryTrackBound;
      const primaryOriginalMode = primaryTrackOriginalMode;

      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      const secondaryMonitorState =
        binder?.getSecondaryMonitorState?.() || null;
      const secondaryTrack =
        secondaryMonitorState?.track || secondaryTrackBound || null;
      const secondaryOriginalMode =
        secondaryMonitorState?.originalMode ?? secondaryTrackOriginalMode;

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

      if (secondaryMonitorState?.active) {
        try {
          binder.stopSecondaryMonitor({
            restoreMode: true,
            fallbackTrack: secondaryTrack,
            fallbackOriginalMode: secondaryOriginalMode,
          });
        } catch (_) {}
      }

      // primary の mode 復元は controller 側にまだ責務があるため、
      // ここで直接行う。secondary は binder 側で復元済み。
      if (primaryTrack && primaryOriginalMode != null) {
        try {
          primaryTrack.mode = primaryOriginalMode;
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

    // secondary track の listener を解除する。
    // mode の復元・同一track判定・listener cleanup の実体は
    // すべて binder.stopSecondaryMonitor() 側が持つため、
    // ここでは「呼ぶ前のログ」「呼び出し」「呼んだ後のログ」に絞る。
    //
    // fallbackTrack / fallbackOriginalMode は、binder 側の monitor state が
    // 既に空でも、controller 側に残っている track / originalMode を
    // 使って復元できるようにするための橋渡し。
    // reason / toggleOpId は binder 側の構造化ログへそのまま渡し、
    // OFF→ON トグルや restart cleanup と unbind ログを相関できるようにする。
    function unbindSecondarySubtitleTrack(options = {}) {
      const restoreMode = options.restoreMode !== false;
      const reason =
        typeof options.reason === "string" && options.reason
          ? options.reason
          : "unbindSecondarySubtitleTrack";
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;

      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      const monitorState = binder?.getSecondaryMonitorState?.() || null;
      const track = monitorState?.track || secondaryTrackBound || null;
      const hadActiveMonitor = Boolean(monitorState?.active);
      const hadTrack = Boolean(track);

      if (hadActiveMonitor) {
        logMemoryProbe(
          "track-listener-cleaned",
          buildExistingBindingMeta(monitorState.meta, {
            hadCleanup: true,
            reason,
            toggleOpId,
          }),
        );
      }

      try {
        binder?.stopSecondaryMonitor?.({
          restoreMode,
          fallbackTrack: track,
          fallbackOriginalMode: secondaryTrackOriginalMode,
          reason,
          toggleOpId,
        });
      } catch (_) {}

      if (hadActiveMonitor || hadTrack) {
        logMemoryProbe(
          "secondary-track-unbound",
          buildExistingBindingMeta(monitorState?.meta, {
            hadTrack,
            hadCleanup: hadActiveMonitor,
            restoreMode,
            reason,
            toggleOpId,
            originalMode:
              monitorState?.originalMode ?? secondaryTrackOriginalMode ?? null,
          }),
        );
      } else {
        logMemoryProbe(
          "secondary-track-unbind-skipped",
          buildExistingBindingMeta(monitorState?.meta, {
            hadTrack: false,
            hadCleanup: false,
            restoreMode,
            reason,
            toggleOpId,
            originalMode:
              monitorState?.originalMode ?? secondaryTrackOriginalMode ?? null,
          }),
        );
      }

      // ローカル state は destroy() / restoreNativeSubtitles() など
      // 他の関数からの参照用に、念のためクリアだけしておく。
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

        renderSecondarySubtitle(cueText, track);
      }

      onPrimaryCueChange();
    }

    // secondary track を bind する。
    // mode の適用・同一track判定・listener attach の実体は
    // binder.startSecondaryMonitor() 側が持つため、
    // ここでは「requestedMode / originalMode / bindingMeta を組み立てて渡す」
    // 「bind 結果を見てログとローカル state を更新する」に絞る。
    function bindSecondarySubtitleTrack(track, modeDecision) {
      if (!track) return false;

      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      if (!binder?.startSecondaryMonitor) return false;

      const requestedMode = modeDecision?.requestedMode || "hidden";
      const previousMode = track?.mode || "";

      // 拡張が触る前の mode を保持する。showing のまま保持すると
      // 復元時に再度 showing へ戻してしまうため、hidden 側へ寄せる。
      secondaryTrackOriginalMode =
        previousMode === "showing" ? "hidden" : previousMode;

      // debug ログや cleanup ログで再利用する共通メタ情報。
      const bindingMeta = createListenerBindingMeta("secondary", track, {
        requestedMode,
        policy: modeDecision?.policy || "",
        rationale: modeDecision?.rationale || "",
        reason: modeDecision?.reason || "",
        unreadableSnapshot: modeDecision?.unreadableSnapshot || null,
      });

      // secondary の cuechange は track 本体を受け取って
      // 既存の onCueChange(track) にそのまま流す。
      const result = binder.startSecondaryMonitor(
        track,
        (boundTrack) => {
          onCueChange(boundTrack || track);
        },
        {
          requestedMode,
          originalMode: secondaryTrackOriginalMode,
          bindingMeta,
          onModeApplyError: (error, nextMode, applyReason) => {
            logContent("secondary-sync mode-apply failed", {
              trackLanguage: track?.language || "",
              trackKind: track?.kind || "",
              requestedMode: nextMode,
              previousMode: track?.mode || previousMode,
              policy: modeDecision?.policy || "",
              rationale: modeDecision?.rationale || "",
              decisionReason: modeDecision?.reason || "",
              applyReason,
              message: String(error?.message || error || ""),
            });
          },
        },
      );

      // listener の attach に失敗した場合は bind 失敗として呼び出し元へ返す。
      if (!result || result.reason === "binding-failed") {
        return false;
      }

      // binder 側の状態が正本だが、他の関数からの参照用に
      // ローカル state も合わせて更新しておく。
      secondaryTrackBound = result.track || track;

      // 同一track・同一mode で skip された場合は
      // 新規 bind とはみなさずログを出さない。
      if (DEBUG_SECONDARY_SUBS && !result.skipped) {
        logContent("secondary-track-bound", {
          ...buildExistingBindingMeta(bindingMeta, {
            trackMode: track?.mode || "",
            policy: modeDecision?.policy || "",
            rationale: modeDecision?.rationale || "",
            reason: modeDecision?.reason || "",
            requestedLang: getRequestedSecondaryLanguage?.() || "",
            currentTime: getCurrentTime(),
          }),
        });
      }

      return true;
    }

    // secondary track の再解決と再同期を行い、必要なら nearby rebuild まで進める。
    async function syncSecondaryTrackOrchestration(
      video,
      requestedLang,
      renderSecondarySubtitleOverride,
      options = {},
    ) {
      if (!video) return;

      const suppressRender = options.suppressRender === true;
      const forceRebind = options.forceRebind === true;
      const previousBoundTrack = secondaryTrackBound;

      ensureSubtitleTracksUsable(video, requestedLang, {
        finalMode: "hidden",
        reason: "secondary-sync",
      });

      const binder = window.ATVB?.cueTrackBinder?.instance || null;
      const monitorState = binder?.getSecondaryMonitorState?.() || null;
      const recoveryState = {
        requested: forceRebind,
        forceRebind,
        reason: forceRebind ? "force-rebind" : "",
      };

      let decision = buildSecondarySyncDecision({
        video,
        requestedLang,
        previousBoundTrack,
        monitorState,
        recoveryState,
        requestedMode: "hidden",
      });

      let activeTrack = decision.track || null;
      let currentTime = decision.currentTime;
      let activeSnapshot = decision.snapshot || null;
      let waitResult = null;

      async function applySecondaryDecision(currentDecision, applyOptions = {}) {
        const activeAction = currentDecision?.action?.type || "";

        switch (activeAction) {
          case "clear": {
            unbindSecondarySubtitleTrack();

            if (!suppressRender) {
              (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
                "",
                null,
              );
            }

            if (DEBUG_MEMORY_PROBE) {
              logContent("secondary-sync memory-probe", {
                requestedLang: requestedLang || "",
                actionType: currentDecision.action?.type || "",
                actionReason: currentDecision.action?.reason || "",
                phase: applyOptions.phase || "clear",
                hasCurrentBlock: false,
              });
            }

            return {
              terminated: true,
              rebuildResult: null,
            };
          }

          case "keep": {
            return {
              terminated: false,
              rebuildResult: null,
            };
          }

          case "bind": {
            activeTrack = currentDecision.track || activeTrack;
            currentTime = currentDecision.currentTime ?? currentTime;
            activeSnapshot = currentDecision.snapshot || activeSnapshot;

            bindSecondarySubtitleTrack(activeTrack, {
              requestedMode: currentDecision.action?.requestedMode || "hidden",
              policy: "secondary-sync",
              rationale:
                currentDecision.action?.reason || "selected-track-changed",
              unreadableSnapshot: {
                cuesLength: activeSnapshot?.cuesLength ?? 0,
                activeCuesLength: activeSnapshot?.activeCuesLength ?? 0,
                hasCueOverlapAtCurrentTime: Boolean(
                  activeSnapshot?.hasCueOverlapAtCurrentTime,
                ),
                currentCueTextLength:
                  activeSnapshot?.currentCueTextLength ?? 0,
              },
            });

            return {
              terminated: false,
              rebuildResult: null,
            };
          }

          default: {
            return {
              terminated: false,
              rebuildResult: null,
            };
          }
        }
      }

      if (decision.action?.type === "wait-and-bind") {
        waitResult = await resolveSecondaryWaitOutcome({
          video,
          requestedLang,
          previousBoundTrack,
          monitorState,
          recoveryState,
          requestedMode: decision.action?.requestedMode || "hidden",
          waitOptions: {
            timeoutMs: 350,
            intervalMs: 50,
          },
        });

        decision = waitResult?.decision || decision;
        activeTrack = decision.track || activeTrack;
        currentTime = decision.currentTime ?? currentTime;
        activeSnapshot = decision.snapshot || activeSnapshot;
      }

      const applyResult = await applySecondaryDecision(decision, {
        phase:
          waitResult?.waited === true
            ? "post-wait-decision"
            : "initial-decision",
      });

      if (applyResult?.terminated) {
        return;
      }

      const currentCue = getCurrentCue(activeTrack, currentTime);
      const currentCueText = cleanCueText(currentCue);

      if (!suppressRender) {
        (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
          currentCueText,
          currentCue,
        );
      }

      // sequence / currentBlock の正本更新は
      // rebuildCurrentSceneSubtitleBlocks() → cue-sequence-builder 側に寄せる。
      // controller では戻り値を観測用に受けるだけにして、
      // currentBlock の二重セットを行わない。
      const rebuildResult = rebuildCurrentSceneSubtitleBlocks();

      if (DEBUG_MEMORY_PROBE) {
        logContent("secondary-sync memory-probe", {
          requestedLang: requestedLang || "",
          actionType: decision.action?.type || "",
          actionReason: decision.action?.reason || "",
          sameTrackRef: decision.selection?.sameTrackRef === true,
          requestedLanguageChanged:
            decision.selection?.requestedLanguageChanged === true,
          monitorHealthy: decision.monitor?.healthy === true,
          monitorStale: decision.monitor?.stale === true,
          recoveryRequested: decision.recovery?.requested === true,
          forceRebind: decision.recovery?.forceRebind === true,
          waitAttempted: waitResult?.waited === true,
          waitSucceeded: waitResult?.waitSucceeded === true,
          hasCurrentBlock: Boolean(rebuildResult?.currentBlock),
        });
      }
    }

    /**
     * runtime / current cue / sequence の観測値を 1 つにまとめ、
     * recovery 判定で参照する merged subtitle health を返す。
     *
     * この関数は cue-controller.js に残る「health 集約の接続点」であり、
     * recovery manager が参照しやすい runtime / currentCue / sequence / derived を
     * 1 つの shape に正規化する。
     *
     * 実装の正本は将来的に cueRenderCoordinator 側へ集約する想定で、
     * ここでは fallback として最低限の health 導出だけを持つ。
     *
     * current / previous current block 由来の secondary 欠落は
     * health 情報として保持するが、
     * 一時的な gap をここで recover / force-rebind の直接条件には昇格しない。
     */
    function buildMergedSubtitleHealth({
      primaryTrack,
      secondaryTrack,
      pCue,
      pText,
      sCue,
      sText,
      sequenceHealth,
    }) {
      // cueRenderCoordinator 側に統合実装がある場合はそちらを優先する。
      // controller 側は fallback 実装だけを持ち、health 導出の二重実装を増やさない。
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

      // runtime の観測値。
      // track の存在と active cue 数だけを保持する。
      const runtime = {
        primaryTrackFound: Boolean(primaryTrack),
        secondaryTrackFound: Boolean(secondaryTrack),
        primaryActiveCues: getTrackActiveCuesLength(primaryTrack),
        secondaryActiveCues: getTrackActiveCuesLength(secondaryTrack),
      };

      // 現在時刻の cue / text の観測値。
      // 実際に primary / secondary の live signal が見えているかを保持する。
      const currentCue = {
        hasPrimaryCue: Boolean(pCue),
        hasSecondaryCue: Boolean(sCue),
        hasFreshCurrentPrimary: Boolean(pCue) && Boolean(pText),
        primaryTextLength: pText.length,
        secondaryTextLength: sText.length,
        hasPrimaryText: Boolean(pText),
        hasSecondaryText: Boolean(sText),
      };

      // sequence の観測値。
      // subtitle-blocks.js / cue-sequence-builder.js が返した
      // current / previous current block 由来の欠落情報をそのまま保持する。
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

      // primary の health。
      // track があり、active cue / current text / current block の
      // どれかが見えていれば healthy とみなす。
      const primaryHealthy =
        runtime.primaryTrackFound &&
        (runtime.primaryActiveCues > 0 ||
          currentCue.hasPrimaryText ||
          sequence.hasCurrentPrimary);

      // secondary の health。
      // primary と同様に、track があり何らかの live signal があれば healthy とみなす。
      const secondaryHealthy =
        runtime.secondaryTrackFound &&
        (runtime.secondaryActiveCues > 0 ||
          currentCue.hasSecondaryText ||
          sequence.hasCurrentSecondary);

      // sequence 由来の gap 観測。
      // seek・言語切替・nearby rebuild 直後などの一時的な欠落でも立ちうるため、
      // ここでは health 情報としてだけ保持する。
      const sequenceSuggestsSecondaryGap = sequence.currentPairMissingSecondary;
      const sequenceSuggestsConsecutiveSecondaryGap =
        sequence.consecutiveCurrentMissingSecondary;

      // recovery action は後段の recovery module 側で決める。
      // ここでは一時的な gap を直接 recover / force-rebind に昇格しない。
      const shouldRecoverSecondary = false;
      const shouldForceSecondaryRebind = false;

      return {
        runtime,
        currentCue,
        sequence,
        derived: {
          primaryHealthy,
          secondaryHealthy,
          sequenceSuggestsSecondaryGap,
          sequenceSuggestsConsecutiveSecondaryGap,
          shouldRecoverSecondary,
          shouldForceSecondaryRebind,
        },
      };
    }

    // nearby rebuild の 1 回保護状態と hold view をまとめて解除する。
    // 将来の guard cleanup 経路で再利用するため保持している。
    // eslint-disable-next-line no-unused-vars
    function clearNearbyRebuildGuard() {
      nearbyRebuildGuard = null;
      state.nearbyRebuildHoldView = null;
    }

    // 次の primary cue change で消費する予定だった guard だけを取り下げる。
    // 将来の guard 制御整理までは controller 内 helper として残しておく。
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

    /**
     * 現在バインド中の primary / secondary track を入力に、
     * cue sequence builder 正本から scene rebuild 結果を取得する。
     *
     * この関数の役割は「rebuild を開始する orchestration」に限定し、
     * cue 抽出・時間窓フィルタ・previousBlocks 引き継ぎ・
     * currentBlock 決定の詳細は builder 側へ戻す。
     *
     * 戻り値は controller / recovery 側の既存 call site が使いやすいよう、
     * builder の result に primaryTrack / secondaryTrack と
     * 互換アクセス用の sequenceHealth / currentBlock を添えて返す。
     *
     * builder 未注入時も call site 側の shape を壊さないため、
     * null / empty string を含む互換返り値を返す。
     */
    function rebuildCurrentSceneSubtitleBlocks() {
      const primaryTrack = getBoundPrimaryTrack();
      const secondaryTrack = getBoundSecondaryTrack();

      // Step 16-B では cue-sequence-builder.js を
      // sequence / scene / snapshot の正本として使う。
      // controller 側に fallback 実装を残すと、
      // sequence build 詳細が再び二重化するため持たない。
      if (!cueSequenceBuilder?.rebuildSequence) {
        if (DEBUG_SECONDARY_SUBS) {
          logContent("cue sequence builder missing", {
            reason: "rebuildCurrentSceneSubtitleBlocks",
            primaryTrackFound: Boolean(primaryTrack),
            secondaryTrackFound: Boolean(secondaryTrack),
          });
        }

        return {
          sequence: null,
          scene: null,
          snapshot: null,
          currentBlock: null,
          sequenceHealth: null,
          primaryCue: null,
          secondaryCue: null,
          primaryText: "",
          secondaryText: "",
          primaryTrack,
          secondaryTrack,
        };
      }

      const result = cueSequenceBuilder.rebuildSequence({
        primaryTrack,
        secondaryTrack,
        rebuildReason: "rebuildCurrentSceneSubtitleBlocks",
      });

      const scene = result?.scene || null;
      const snapshot = result?.snapshot || null;
      const currentBlock = scene?.currentBlock || result?.currentBlock || null;
      const sequenceHealth =
        scene?.sequenceHealth || snapshot?.sequenceHealth || null;

      // 恒久的に無効化されていた debug ログブロックは削除済み。
      // builder 正本の結果整形のみを返す。
      return {
        ...result,
        currentBlock,
        sequenceHealth,
        primaryTrack,
        secondaryTrack,
      };
    }

    // primary cue change を基準に full rebuild orchestration を行い、
    // 必要な場合だけ 1 回限り nearby current / hold view を適用する接続点。
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
      // sequence の正本は rebuildCurrentSceneSubtitleBlocks() -> cueSequenceBuilder 側。
      // ここでの sequenceApi 参照は nearby hold view / 互換処理のためだけに残している。
      const sequenceApi =
        (typeof getSubtitleBlockSequence === "function" && getSubtitleBlockSequence()) ||
        null;

      const rebuildResult = rebuildCurrentSceneSubtitleBlocks();

      renderCurrentSnapshot?.();
      renderPanel?.();

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

      const recoveryDecision = evaluateSecondaryRecovery({
        now: Date.now(),
        runtime: mergedHealth?.runtime || null,
        currentCue: mergedHealth?.currentCue || null,
        sequence: mergedHealth?.sequence || null,
        derived: mergedHealth?.derived || null,
      });

      // primary は見えているのに secondary track が見つからない場合は、
      // recovery module の判定結果に加えて secondary-only の再探索を許可する。
      // Apple TV+ 側で track 差し替えが遅れて見えるケースの保険。
      const shouldRecoverMissingSecondary =
        mergedHealth?.runtime?.primaryTrackFound === true &&
        mergedHealth?.runtime?.secondaryTrackFound !== true;

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

      if (shouldRecoverMissingSecondary) {
        syncSecondaryTrackOrchestration(
          getVideoElement(),
          getRequestedSecondaryLanguage(),
          null,
          {
            suppressRender: false,
            forceRebind: false,
          },
        );
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
      syncSecondaryTrackOrchestration,
      onCueChange,
      onPrimaryCueChange,
      getMergedSubtitleHealth: () => lastMergedSubtitleHealth,
      getLaneStates: () => subtitleRecoveryManager?.getLaneStates?.() || null,
      resetSecondaryRecoveryLane,
      evaluateSecondaryRecovery,
    };
  }

  // cue controller factory を ATVB 名前空間へ公開する。
  root.cueController = {
    createCueController,
  };
})();
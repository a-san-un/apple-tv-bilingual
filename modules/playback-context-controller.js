// =============================================================
// Apple TV+ Bilingual Subtitles - playbackContext.js
// version: 2.6.3
// 役割: playback page context / content key / subtitle history context を扱う。
// =============================================================

(() => {
  const root = (window.ATVB = window.ATVB || {});

  function createPlaybackContextController({
    state,
    logContentSubtitle,
    subtitleHistoryMaxPerContent,
  }) {
    // playback ページ上の video / dialog / playback view をまとめて取得する。
    function getPlaybackContext() {
      const video = document.querySelector("video");
      const playbackDialog = document.querySelector("dialog.playback-view");
      const playbackView = document.querySelector(
        '[data-testid="playback-view"]',
      );
      const textTrackCount = video?.textTracks?.length ?? 0;
      const isPlaybackReady = Boolean(video && textTrackCount > 0);

      return {
        video,
        playbackDialog,
        playbackView,
        textTrackCount,
        isPlaybackReady,
      };
    }

    // 再生準備が整っているときだけ、video と dialog を返す。
    function getVideoAndDialog() {
      const ctx = getPlaybackContext();
      if (!ctx.isPlaybackReady) return null;

      const resolvedDialog =
        ctx.playbackDialog || ctx.playbackView?.closest("dialog") || null;

      return {
        video: ctx.video,
        dialog: resolvedDialog,
      };
    }

    function isPlaybackPageReady() {
      return getPlaybackContext().isPlaybackReady;
    }

    // debug log 用に playback context の状態を軽量 payload へ整える。
    function getPlaybackContextLogPayload() {
      const ctx = getPlaybackContext();
      return {
        hasVideo: Boolean(ctx.video),
        hasPlaybackDialog: Boolean(ctx.playbackDialog),
        hasPlaybackView: Boolean(ctx.playbackView),
        textTrackCount: ctx.textTrackCount,
        isPlaybackReady: ctx.isPlaybackReady,
      };
    }

    // content key 用の文字列を、比較しやすい形へ正規化する。
    function normalizeContentKeyPart(value) {
      return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    }

    // currentSrc / src 由来の URL から、比較用の安定キーを作る。
    function normalizeMediaSourceKey(rawSrc) {
      const src = String(rawSrc || "").trim();
      if (!src) return "";

      try {
        const parsed = new URL(src, location.href);
        return `${parsed.origin}${parsed.pathname}`.toLowerCase();
      } catch (_) {
        return src.split("?")[0].split("#")[0].toLowerCase();
      }
    }

    // document.title から Apple TV+ 接尾辞を除いた title key を作る。
    function getPlaybackTitleKey() {
      const rawTitle = String(document.title || "");
      const cleanedTitle = rawTitle
        .replace(/\s*[|｜-]\s*apple tv\+\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();

      return normalizeContentKeyPart(cleanedTitle);
    }

    // media source を最優先にしつつ、title / aria 系属性から content key を解決する。
    function resolvePlaybackContentKey(ctx = getPlaybackContext()) {
      const mediaSourceKey = normalizeMediaSourceKey(
        ctx.video?.currentSrc || ctx.video?.getAttribute("src") || "",
      );
      if (mediaSourceKey) {
        return `media:${mediaSourceKey}`;
      }

      const titleKey = getPlaybackTitleKey();
      const attrCandidates = [
        ctx.playbackView?.getAttribute("data-automation-id"),
        ctx.playbackView?.getAttribute("data-testid"),
        ctx.playbackView?.getAttribute("aria-label"),
        ctx.playbackDialog?.getAttribute("aria-label"),
      ];

      const stableIdKey = attrCandidates
        .map((value) => normalizeContentKeyPart(value))
        .find(Boolean);

      const keyParts = [];
      if (titleKey) keyParts.push(`title:${titleKey}`);
      if (stableIdKey) keyParts.push(`id:${stableIdKey}`);
      if (!keyParts.length) return "content:unknown";

      return keyParts.join("|");
    }

    function getCurrentVideoSrcKey(video = state.video) {
      return normalizeMediaSourceKey(
        video?.currentSrc || video?.getAttribute("src") || "",
      );
    }

    // contentKey ごとの subtitle history bucket を参照する。
    function getHistoryBucketForContentKey(contentKey) {
      if (!contentKey) return null;
      return state.subtitleHistoryStore.get(contentKey) || null;
    }

    function loadHistoryForContentKey(contentKey) {
      const bucket = getHistoryBucketForContentKey(contentKey);
      const items = Array.isArray(bucket?.items) ? bucket.items : [];
      state.subtitleHistory = items.slice(-subtitleHistoryMaxPerContent);
    }

    function saveHistoryForContentKey(
      contentKey,
      history = state.subtitleHistory,
    ) {
      if (!contentKey) return;
      const items = Array.isArray(history)
        ? history.slice(-subtitleHistoryMaxPerContent)
        : [];

      state.subtitleHistoryStore.set(contentKey, {
        items,
        updatedAt: Date.now(),
      });
    }

    // 再生コンテンツ切り替え時に、history と lastPrimaryText の文脈を切り替える。
    function switchHistoryContext(nextContentKey, reason = "unknown") {
      const resolvedContentKey = nextContentKey || "content:unknown";
      const previousContentKey = state.currentContentKey;
      if (previousContentKey === resolvedContentKey) return false;

      if (previousContentKey) {
        saveHistoryForContentKey(previousContentKey);
      }

      state.currentContentKey = resolvedContentKey;
      loadHistoryForContentKey(resolvedContentKey);
      state.lastPrimaryText = "";

      logContentSubtitle("history context switched", {
        reason,
        previousContentKey,
        nextContentKey: resolvedContentKey,
        historySize: state.subtitleHistory.length,
      });

      return true;
    }

    function syncHistoryContextWithPlayback(reason = "unknown") {
      return switchHistoryContext(resolvePlaybackContentKey(), reason);
    }

    return {
      getPlaybackContext,
      getVideoAndDialog,
      isPlaybackPageReady,
      getPlaybackContextLogPayload,
      normalizeContentKeyPart,
      normalizeMediaSourceKey,
      getPlaybackTitleKey,
      resolvePlaybackContentKey,
      getCurrentVideoSrcKey,
      getHistoryBucketForContentKey,
      loadHistoryForContentKey,
      saveHistoryForContentKey,
      switchHistoryContext,
      syncHistoryContextWithPlayback,
    };
  }

  root.createPlaybackContextController = createPlaybackContextController;
})();

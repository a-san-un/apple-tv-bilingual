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

    // URL として扱えない入力用に、query/hash を除いた比較キーを作る。
    function normalizeNonUrlMediaSourceKey(src) {
      return String(src || "")
        .split("?")[0]
        .split("#")[0]
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    }

    // currentSrc / src 由来の URL から、比較用の安定キーを作る。
    function normalizeMediaSourceKey(rawSrc) {
      const src = String(rawSrc || "").trim();
      if (!src) return "";

      const looksAbsoluteUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(src);
      const looksRelativeUrl =
        src.startsWith("/") || src.startsWith("./") || src.startsWith("../");

      // 空白を含む文字列は、URL ではなくラベル/壊れた値として扱う。
      // new URL(value, location.href) に通すと相対 path として解釈されてしまい、
      // characterization test の期待値とズレるため、先に文字列正規化へ倒す。
      if (!looksAbsoluteUrl && !looksRelativeUrl && /\s/.test(src)) {
        return normalizeNonUrlMediaSourceKey(src);
      }

      try {
        const parsed = new URL(src, location.href);
        return `${parsed.origin}${parsed.pathname}`.toLowerCase();
      } catch (_) {
        return normalizeNonUrlMediaSourceKey(src);
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
    function switchHistoryContext(nextContentKey) {
      const previousContentKey = state.currentContentKey || "";
      if (
        previousContentKey &&
        previousContentKey !== nextContentKey &&
        state.subtitleHistory.length
      ) {
        saveHistoryForContentKey(previousContentKey, state.subtitleHistory);
      }

      state.currentContentKey = nextContentKey || "";
      loadHistoryForContentKey(state.currentContentKey);
      state.lastPrimaryText = "";
    }

    // video / title / aria 情報から現在の content key を更新する。
    function refreshPlaybackContentContext(ctx = getPlaybackContext()) {
      const nextContentKey = resolvePlaybackContentKey(ctx);
      if (nextContentKey === state.currentContentKey) return nextContentKey;

      switchHistoryContext(nextContentKey);
      return nextContentKey;
    }

    // content 切り替え直後に積み直した字幕を bucket へ保存する。
    function persistCurrentHistoryContext() {
      if (!state.currentContentKey) return;
      saveHistoryForContentKey(state.currentContentKey, state.subtitleHistory);
    }

    // primary subtitle を現在 content bucket へ追記する。
    function appendSubtitleHistory(text) {
      if (!text) return;

      state.subtitleHistory.push(text);
      if (state.subtitleHistory.length > subtitleHistoryMaxPerContent) {
        state.subtitleHistory = state.subtitleHistory.slice(
          -subtitleHistoryMaxPerContent,
        );
      }

      persistCurrentHistoryContext();
      logContentSubtitle(text);
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
      refreshPlaybackContentContext,
      persistCurrentHistoryContext,
      appendSubtitleHistory,
    };
  }

  root.createPlaybackContextController = createPlaybackContextController;
})();

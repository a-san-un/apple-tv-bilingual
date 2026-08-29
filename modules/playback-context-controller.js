// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-context-controller.js
// 役割:
// - 再生対象（video / playback dialog / playback view）を検出する。
// - content key（作品識別キー）の正規化・解決を行う。
// - videoSrcKey（currentSrc / src 由来の比較キー）の正規化を行う。
// - history 切替・overlay/secondary DOM のクリアなどの副作用は持たない。
//   それらは content.js 側の switchHistoryContext() が historyStore /
//   overlayController / secondarySubtitleDom を跨いで担当する。
//
// 呼び出し元:
// - content.js は getPlaybackContext / getVideoAndDialog / isPlaybackPageReady /
//   getPlaybackContextLogPayload / normalizeMediaSourceKey / getPlaybackTitleKey /
//   resolvePlaybackContentKey / getCurrentVideoSrcKey を薄いラッパー経由で中継する。
// - modules/playback-startup-coordinator.js は同じ関数群を services 経由で受け取り、
//   SPA 遷移判定・startup readiness 判定に使う。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * 再生対象識別・content key 解決を担当するインスタンスを生成する。
   * @param {{
   *   getVideoElement?: () => (HTMLVideoElement|null),
   * }} deps
   * @returns {{
   *   getPlaybackContext: Function,
   *   getVideoAndDialog: Function,
   *   isPlaybackPageReady: Function,
   *   getPlaybackContextLogPayload: Function,
   *   normalizeContentKeyPart: Function,
   *   normalizeMediaSourceKey: Function,
   *   getPlaybackTitleKey: Function,
   *   resolvePlaybackContentKey: Function,
   *   getCurrentVideoSrcKey: Function,
   * }}
   */
  function createPlaybackContextController({ getVideoElement } = {}) {
    // -------------------------------------------------------
    // 再生対象検出
    // -------------------------------------------------------

    /**
     * 再生画面上の video / dialog / playback view をまとめて取得する。
     * 再生準備が整っているかどうかは、URL ではなく DOM 条件
     * （video の存在 + textTrack 件数）を基準に判定する。
     * @returns {{
     *   video: (HTMLVideoElement|null),
     *   playbackDialog: (Element|null),
     *   playbackView: (Element|null),
     *   textTrackCount: number,
     *   isPlaybackReady: boolean,
     * }}
     */
    function getPlaybackContext() {
      const video = document.querySelector("video");
      const playbackDialog = document.querySelector("dialog.playback-view");
      const playbackView = document.querySelector(
        '[data-testid="playback-view"]',
      );
      const textTrackCount = video?.textTracks?.length ?? 0;
      const isPlaybackReady = Boolean(video) && textTrackCount > 0;

      return {
        video,
        playbackDialog,
        playbackView,
        textTrackCount,
        isPlaybackReady,
      };
    }

    /**
     * 再生準備が整っているときだけ、video と（解決済みの）dialog を返す。
     * playbackDialog が取得できない場合は playbackView から closest("dialog") を辿る。
     * @returns {({ video: HTMLVideoElement, dialog: (Element|null) }|null)}
     */
    function getVideoAndDialog() {
      const ctx = getPlaybackContext();
      if (!ctx.isPlaybackReady) return null;

      const resolvedDialog =
        ctx.playbackDialog || ctx.playbackView?.closest("dialog") || null;
      return { video: ctx.video, dialog: resolvedDialog };
    }

    /**
     * 現在の再生画面が readiness 条件を満たしているかだけを返す。
     * @returns {boolean}
     */
    function isPlaybackPageReady() {
      return getPlaybackContext().isPlaybackReady;
    }

    /**
     * playback readiness の観測結果を、logging や上位判断へ渡すための
     * 軽量 payload に整形する。生の DOM 参照は含めない。
     * @returns {{
     *   hasVideo: boolean,
     *   hasPlaybackDialog: boolean,
     *   hasPlaybackView: boolean,
     *   textTrackCount: number,
     *   isPlaybackReady: boolean,
     * }}
     */
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

    // -------------------------------------------------------
    // content key resolver helpers
    // 現在の再生対象から安定した content key を組み立てるための下位 helper 群。
    // -------------------------------------------------------

    /**
     * content key の構成要素として使える形へ文字列を正規化する。
     * 前後空白の除去、連続空白の圧縮、小文字化を行う。
     * @param {*} value
     * @returns {string}
     */
    function normalizeContentKeyPart(value) {
      return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    }

    /**
     * currentSrc / src 由来の URL から、比較用の安定キーを作る。
     * URL として解釈できない場合は query/hash を除いた文字列へフォールバックする。
     * @param {string} rawSrc
     * @returns {string}
     */
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

    /**
     * document.title から Apple TV+ の接尾辞を除いた title key を作る。
     * @returns {string}
     */
    function getPlaybackTitleKey() {
      const rawTitle = String(document.title || "");
      const cleanedTitle = rawTitle
        .replace(/\s*[|｜-]\s*apple tv\+\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      return normalizeContentKeyPart(cleanedTitle);
    }

    /**
     * media source を最優先にしつつ、title / aria 系属性から content key を解決する。
     * 優先順位: currentSrc（エピソード識別） > title > 安定 id 系属性。
     * どれも取れない場合は "content:unknown" を返す。
     * @param {ReturnType<typeof getPlaybackContext>} [ctx]
     * @returns {string}
     */
    function resolvePlaybackContentKey(ctx = getPlaybackContext()) {
      const mediaSourceKey = normalizeMediaSourceKey(
        ctx.video?.currentSrc || ctx.video?.getAttribute("src") || "",
      );
      // エピソード識別は currentSrc を最優先にする。
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

    // -------------------------------------------------------
    // videoSrcKey resolver
    // -------------------------------------------------------

    /**
     * video.currentSrc / src から videoSrcKey を正規化して返す。
     * 引数省略時は DI された getVideoElement() の戻り値を使う。
     * @param {HTMLVideoElement} [video]
     * @returns {string}
     */
    function getCurrentVideoSrcKey(video = getVideoElement?.() ?? null) {
      return normalizeMediaSourceKey(
        video?.currentSrc || video?.getAttribute("src") || "",
      );
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------

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
    };
  }

  root.playbackContextController = {
    createPlaybackContextController,
  };
})();

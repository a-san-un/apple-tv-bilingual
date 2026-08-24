// =============================================================
// Apple TV+ Bilingual Subtitles - modules/cue-sequence-builder.js
// 役割:
// - primary / secondary cue 群から subtitle block sequence を再構築する。
// - previousBlocks の引き継ぎ可否を rebuildReason に応じて決定する。
// - sequence / currentBlock / sequenceHealth の正本を 1 箇所で確定する。
// - panel / logger / controller が再導出せずに使える scene / snapshot を返す。
// - DOM / TextTrack listener を保持せず、sequence 派生 state だけを扱う。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * subtitle block sequence 構築を担う factory を生成する。
   * cue-controller.js 側で重複していた scene rebuild 詳細を
   * builder 正本へ戻すためのモジュールである。
   *
   * @param {{
   *   buildSubtitleBlockSequence: Function,
   *   getPrimaryTrackCues: Function,
   *   getSecondaryTrackCues: Function,
   *   getPreviousSubtitleBlocks: Function,
   *   cleanCueText: Function,
   *   setSubtitleBlocks: Function,
   *   setCurrentSubtitleBlock: Function,
   *   getCurrentCue: Function,
   *   getCurrentTime: Function,
   *   logContent?: Function,
   *   DEBUG_SECONDARY_SUBS?: boolean,
   * }} deps
   */
  function createCueSequenceBuilder(deps = {}) {
    const {
      buildSubtitleBlockSequence,
      getPrimaryTrackCues,
      getSecondaryTrackCues,
      getPreviousSubtitleBlocks,
      cleanCueText,
      setSubtitleBlocks,
      setCurrentSubtitleBlock,
      getCurrentCue,
      getCurrentTime,
      logContent,
      DEBUG_SECONDARY_SUBS,
    } = deps;

    // -------------------------------------------------------
    // cue 配列化 / 時間窓フィルタ
    // -------------------------------------------------------

    /**
     * TextTrackCueList 互換の値を素直な配列へ正規化する。
     * null / undefined は空配列として扱う。
     */
    function toCueArray(cuesLike) {
      return Array.from(cuesLike || []);
    }

    /**
     * 現在時刻の前後窓に収まる cue だけを抽出する。
     * start / end のどちらかが不正な cue は除外する。
     */
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

    // -------------------------------------------------------
    // previousBlocks 判定
    // -------------------------------------------------------

    /**
     * 現在の rebuildReason で previousBlocks を捨てるべきか判定する。
     * large seek や content 切替では古い scene 参照を引き継がない。
     */
    function shouldDropPreviousBlocksByReason(rebuildReason) {
      return (
        rebuildReason === "nearbyRebuild" ||
        rebuildReason === "sync_interval_large_seek_resync" ||
        rebuildReason === "content_key_changed"
      );
    }

    /**
     * previousSequence から previousBlocks 配列だけを安全に取り出す。
     * sequence オブジェクトでも配列単体でも受け取れるようにする。
     */
    function extractPreviousBlocks(previousSequence) {
      if (Array.isArray(previousSequence?.blocks)) {
        return previousSequence.blocks;
      }

      if (Array.isArray(previousSequence)) {
        return previousSequence;
      }

      return [];
    }

    // -------------------------------------------------------
    // scene / snapshot 生成
    // -------------------------------------------------------

    /**
     * sequence から panel が直接使える scene view を構成する。
     * current / past / meta / health を builder 正本としてまとめる。
     */
    function buildSceneView({
      sequence,
      currentTime,
      rebuildReason,
      previousBlocks,
    }) {
      const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
      const currentIndex = Number.isInteger(sequence?.currentIndex)
        ? sequence.currentIndex
        : -1;

      const currentBlock =
        currentIndex >= 0 && currentIndex < blocks.length
          ? blocks[currentIndex] || null
          : null;

      const pastBlocks =
        currentIndex > 0 ? blocks.slice(0, currentIndex) : [];

      const sequenceMeta = sequence?.meta || null;
      const sequenceHealth = sequenceMeta?.sequenceHealth || null;

      return {
        currentTime,
        rebuildReason,
        previousBlocks,
        blocks,
        currentIndex,
        currentBlock,
        pastBlocks,
        hasCurrentBlock: Boolean(currentBlock),
        totalBlockCount: blocks.length,
        sequenceMeta,
        sequenceHealth,
      };
    }

    /**
     * ログ / 観測 / 後続描画調整に使いやすい軽量 snapshot を構成する。
     * sequence の正本構造を壊さず、主要な bool / text / count をフラットに返す。
     */
    function buildSnapshot({
      scene,
      primaryText,
      secondaryText,
      primaryCue,
      secondaryCue,
    }) {
      const sequenceHealth = scene?.sequenceHealth || null;

      return {
        currentTime: scene?.currentTime ?? null,
        rebuildReason: scene?.rebuildReason || "",
        currentIndex: Number.isInteger(scene?.currentIndex)
          ? scene.currentIndex
          : -1,
        totalBlockCount: Number.isFinite(scene?.totalBlockCount)
          ? scene.totalBlockCount
          : 0,
        hasCurrentBlock: scene?.hasCurrentBlock === true,
        primaryText,
        secondaryText,
        primaryTextLength: primaryText.length,
        secondaryTextLength: secondaryText.length,
        hasPrimaryCue: Boolean(primaryCue),
        hasSecondaryCue: Boolean(secondaryCue),
        sequenceHealth,
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
    }

    // -------------------------------------------------------
    // sequence rebuild
    // -------------------------------------------------------

    /**
     * 現在時刻を基準に subtitle block sequence を再構築し、
     * current / past / snapshot を含む適用済み結果を返す。
     *
     * 返り値は以下の 3 層を持つ。
     * - sequence: subtitle-blocks.js が返す正本 sequence
     * - scene: panel が直接消費できる current / past / blocks 情報
     * - snapshot: logger / health 観測向けの軽量要約
     *
     * 既存呼び出し側の互換のため、currentBlock / sequenceHealth /
     * primaryText / secondaryText などのトップレベルキーも当面維持する。
     *
     * @param {{
     *   primaryTrack: TextTrack | null,
     *   secondaryTrack: TextTrack | null,
     *   rebuildReason?: string,
     * }} options
     * @returns {{
     *   sequence: object,
     *   scene: {
     *     currentTime: number | null,
     *     rebuildReason: string,
     *     previousBlocks: Array,
     *     blocks: Array,
     *     currentIndex: number,
     *     currentBlock: object | null,
     *     pastBlocks: Array,
     *     hasCurrentBlock: boolean,
     *     totalBlockCount: number,
     *     sequenceMeta: object | null,
     *     sequenceHealth: object | null,
     *   },
     *   snapshot: {
     *     currentTime: number | null,
     *     rebuildReason: string,
     *     currentIndex: number,
     *     totalBlockCount: number,
     *     hasCurrentBlock: boolean,
     *     primaryText: string,
     *     secondaryText: string,
     *     primaryTextLength: number,
     *     secondaryTextLength: number,
     *     hasPrimaryCue: boolean,
     *     hasSecondaryCue: boolean,
     *     sequenceHealth: object | null,
     *     hasCurrentPrimary: boolean,
     *     hasCurrentSecondary: boolean,
     *     currentPairAligned: boolean,
     *     currentPairMissingSecondary: boolean,
     *     previousPairMissingSecondary: boolean,
     *     consecutiveCurrentMissingSecondary: boolean,
     *   },
     *   tracks: {
     *     primary: TextTrack | null,
     *     secondary: TextTrack | null,
     *   },
     *   cues: {
     *     primaryCue: VTTCue | null,
     *     secondaryCue: VTTCue | null,
     *   },
     *   currentBlock: object | null,
     *   currentIndex: number,
     *   blocks: Array,
     *   pastBlocks: Array,
     *   sequenceMeta: object | null,
     *   sequenceHealth: object | null,
     *   primaryCue: VTTCue | null,
     *   secondaryCue: VTTCue | null,
     *   primaryText: string,
     *   secondaryText: string,
     *   primaryTrack: TextTrack | null,
     *   secondaryTrack: TextTrack | null,
     *   currentTime: number | null,
     *   rebuildReason: string,
     * }} result
     */
    function rebuildSequence({
      primaryTrack,
      secondaryTrack,
      rebuildReason = "rebuildSequence",
    }) {
      const currentTime = getCurrentTime();

      const primaryCue = getCurrentCue(primaryTrack, currentTime);
      const secondaryCue = getCurrentCue(secondaryTrack, currentTime);

      const primaryText = cleanCueText(primaryCue);
      const secondaryText = cleanCueText(secondaryCue);

      const primaryCueWindowBeforeSeconds = 180;
      const primaryCueWindowAfterSeconds = 30;
      const secondaryCueWindowBeforeSeconds = 300;
      const secondaryCueWindowAfterSeconds = 60;
      const secondaryCueWindowFallbackBeforeSeconds = 900;
      const secondaryCueWindowFallbackAfterSeconds = 180;
      const secondaryCueFallbackMaxCount = 150;

      const rawPrimaryCues = getPrimaryTrackCues();
      const rawSecondaryCues = getSecondaryTrackCues();

      const primaryCues = filterCuesByTimeWindow(
        rawPrimaryCues,
        currentTime,
        primaryCueWindowBeforeSeconds,
        primaryCueWindowAfterSeconds,
      );

      const secondaryCuesInPrimaryWindow = filterCuesByTimeWindow(
        rawSecondaryCues,
        currentTime,
        secondaryCueWindowBeforeSeconds,
        secondaryCueWindowAfterSeconds,
      );

      const secondaryHasAnyCues = toCueArray(rawSecondaryCues).length > 0;

      const shouldUseSecondaryFallbackWindow =
        secondaryHasAnyCues &&
        secondaryCuesInPrimaryWindow.length === 0 &&
        !secondaryCue;

      const secondaryCues = shouldUseSecondaryFallbackWindow
        ? filterCuesByTimeWindow(
            rawSecondaryCues,
            currentTime,
            secondaryCueWindowFallbackBeforeSeconds,
            secondaryCueWindowFallbackAfterSeconds,
          ).slice(-secondaryCueFallbackMaxCount)
        : secondaryCuesInPrimaryWindow;

      const previousSequence = getPreviousSubtitleBlocks();
      const shouldDropPreviousBlocks =
        shouldDropPreviousBlocksByReason(rebuildReason);
      const previousBlocks = shouldDropPreviousBlocks
        ? []
        : extractPreviousBlocks(previousSequence);

      const sequence = buildSubtitleBlockSequence({
        primaryCues,
        secondaryCues,
        now: currentTime,
        previousBlocks,
        cleanCueText,
        rebuildReason,
      });

      const scene = buildSceneView({
        sequence,
        currentTime,
        rebuildReason,
        previousBlocks,
      });

      const snapshot = buildSnapshot({
        scene,
        primaryText,
        secondaryText,
        primaryCue,
        secondaryCue,
      });

      // sequence / currentBlock の適用は builder 正本で行う。
      // controller 側で再導出・再適用しなくても済む状態をここで作る。
      setSubtitleBlocks(sequence, {
        sourceTag: "cue-sequence-builder",
        reason: rebuildReason,
      });

      setCurrentSubtitleBlock(scene.currentBlock, scene.sequenceMeta);

      if (DEBUG_SECONDARY_SUBS) {
        logContent?.("cue-sequence-builder: rebuild", {
          reason: rebuildReason,
          currentTime,
          primaryTrackFound: Boolean(primaryTrack),
          secondaryTrackFound: Boolean(secondaryTrack),
          primaryTextLength: primaryText.length,
          secondaryTextLength: secondaryText.length,
          hasPrimaryCue: Boolean(primaryCue),
          hasSecondaryCue: Boolean(secondaryCue),
          hasCurrentBlock: scene.hasCurrentBlock,
          hasCurrentPrimary: Boolean(scene.currentBlock?.primaryText),
          hasCurrentSecondary: Boolean(scene.currentBlock?.secondaryText),
          currentPairAligned: snapshot.currentPairAligned,
          currentPairMissingSecondary: snapshot.currentPairMissingSecondary,
          previousPairMissingSecondary: snapshot.previousPairMissingSecondary,
          consecutiveCurrentMissingSecondary:
            snapshot.consecutiveCurrentMissingSecondary,
          totalBlockCount: scene.totalBlockCount,
          currentIndex: scene.currentIndex,
          sequenceMeta: scene.sequenceMeta,
        });
      }

      return {
        sequence,
        scene,
        snapshot,
        tracks: {
          primary: primaryTrack || null,
          secondary: secondaryTrack || null,
        },
        cues: {
          primaryCue: primaryCue || null,
          secondaryCue: secondaryCue || null,
        },

        // ---------------------------------------------------
        // 後方互換キー
        // ---------------------------------------------------
        currentBlock: scene.currentBlock,
        currentIndex: scene.currentIndex,
        blocks: scene.blocks,
        pastBlocks: scene.pastBlocks,
        sequenceMeta: scene.sequenceMeta,
        sequenceHealth: scene.sequenceHealth,
        primaryCue: primaryCue || null,
        secondaryCue: secondaryCue || null,
        primaryText,
        secondaryText,
        primaryTrack: primaryTrack || null,
        secondaryTrack: secondaryTrack || null,
        currentTime,
        rebuildReason,
      };
    }

    // —————————————————––
    // エクスポート
    // —————————————————––
    return {
      rebuildSequence,
    };
  }

  root.createCueSequenceBuilder = createCueSequenceBuilder;
})();

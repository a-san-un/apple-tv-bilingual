// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-blocks.js
// version: 1.4.0
//
// 役割:
// - primary / secondary cues から panel / overlay 共通の
//   subtitle block sequence を構築する
// - sequence の正本は primary 基準とし、primary が空の間は
//   secondary だけでは current block を成立させない
// - block 境界のすき間（cue 終了直後の一瞬）で current が
//   見つからなくなる問題を避けるため、直前に終わった block を
//   短時間だけ current として保持する grace-period フォールバックを持つ
//
// 設計方針:
// - 外部公開 API は buildSubtitleBlockSequence のみに限定する
// - group 化・secondary 対応付け・current 判定・health 診断などの
//   補助関数は module 内部に留める
// =============================================================

(() => {
  try {
    const root = (window.ATVB = window.ATVB || {});

    // -------------------------------------------------------
    // 基本ユーティリティ (basic utilities)
    // -------------------------------------------------------

    /**
     * cues / cueList / array-like を安全に配列へ正規化する。
     * 読み取り失敗時は空配列へフォールバックする。
     *
     * @param {*} cuesLike - Array / TextTrackCueList / array-like な入力。
     * @returns {Array<*>} 正規化後の配列。
     */
    function toArray(cuesLike) {
      if (!cuesLike) return [];
      try {
        return Array.from(cuesLike);
      } catch (_) {
        return [];
      }
    }

    /**
     * cue text を比較・結合しやすい形へ正規化する。
     * null / undefined は空文字として扱う。
     *
     * @param {*} text - 正規化前の文字列入力。
     * @returns {string} trim 済み文字列。
     */
    function normalizeText(text) {
      return String(text || "").trim();
    }

    /**
     * block の同一性比較に使う key を組み立てる。
     * start / end / primaryText を固定精度で連結する。
     *
     * @param {Object} block - subtitle block。
     * @returns {string} block 識別用 key。
     */
    function buildSubtitleBlockKey(block) {
      return [
        Number(block?.startTime ?? 0).toFixed(3),
        Number(block?.endTime ?? 0).toFixed(3),
        normalizeText(block?.primaryText),
      ].join("::");
    }

    /**
     * block が past / current / future のどれかを返す。
     * 再生時刻 now を block time range と比較して判定する。
     *
     * @param {Object} block - subtitle block。
     * @param {number} now - 現在の再生時刻（秒）。
     * @returns {"past"|"current"|"future"} block state。
     */
    function classifyBlockState(block, now) {
      if (block.endTime < now) return "past";
      if (block.startTime > now) return "future";
      return "current";
    }

    // -------------------------------------------------------
    // cue group 化 (cue grouping)
    // -------------------------------------------------------

    /**
     * 近い timing を持つ連続 cue 群を 1 表示単位の group へ集約する。
     * primary / secondary のどちらにも使える共通 group 化ロジックとする。
     *
     * @param {ArrayLike<Object>|Array<Object>} cues - cue 群。
     * @param {Function|null} cleanCueText - cue から text を抽出・整形する関数。
     * @param {number} [mergeTolerance=0.12] - start/end の merge 許容秒数。
     * @returns {Array<Object>} group 配列。
     */
    function groupCues(cues, cleanCueText, mergeTolerance = 0.12) {
      const cueList = toArray(cues);
      const groups = [];

      for (const cue of cueList) {
        const text = normalizeText(
          cleanCueText ? cleanCueText(cue) : cue?.text,
        );
        if (!text) continue;

        const startTime = Number(cue?.startTime ?? 0);
        const endTime = Number(cue?.endTime ?? 0);
        const lastGroup = groups[groups.length - 1] || null;

        const canMerge =
          lastGroup &&
          Math.abs(lastGroup.startTime - startTime) <= mergeTolerance &&
          Math.abs(lastGroup.endTime - endTime) <= mergeTolerance;

        if (canMerge) {
          lastGroup.endTime = Math.max(lastGroup.endTime, endTime);
          lastGroup.segments.push(text);
          lastGroup.cues.push(cue);
          continue;
        }

        groups.push({
          startTime,
          endTime,
          segments: [text],
          cues: [cue],
        });
      }

      return groups.map((group) => ({
        startTime: group.startTime,
        endTime: group.endTime,
        segments: group.segments.slice(),
        text: group.segments.join(" "),
        cues: group.cues.slice(),
      }));
    }



    /**
     * block の最小共通 shape を primary / secondary group から組み立てる。
     * sequence の正本は primary 基準とし、primary が空の block は作らない。
     *
     * @param {Object|null} primaryGroup - primary 側 group。
     * @param {Object|null} secondaryGroup - secondary 側 group。
     * @returns {Object|null} subtitle block。primary が空なら null。
     */
    function buildSubtitleBlockFromGroups(primaryGroup, secondaryGroup) {
      const primaryText = normalizeText(
        primaryGroup?.text ?? primaryGroup?.primaryText,
      );
      const secondaryText = normalizeText(
        secondaryGroup?.text ?? secondaryGroup?.secondaryText,
      );

      if (!primaryText) {
        return null;
      }

      const primarySegments = Array.isArray(primaryGroup?.segments)
        ? primaryGroup.segments.slice()
        : Array.isArray(primaryGroup?.primarySegments)
          ? primaryGroup.primarySegments.slice()
          : [primaryText];

      return {
        startTime: Number(
          primaryGroup?.startTime ?? secondaryGroup?.startTime ?? 0,
        ),
        endTime: Number(
          primaryGroup?.endTime ?? secondaryGroup?.endTime ?? 0,
        ),
        primarySegments,
        primaryText,
        secondaryText,
        cues: Array.isArray(primaryGroup?.cues)
          ? primaryGroup.cues.slice()
          : [],
        hasPrimarySignal: true,
        hasSecondarySignal: Boolean(secondaryText),
      };
    }

    // -------------------------------------------------------
    // secondary 対応付け (secondary matching)
    // -------------------------------------------------------

    /**
     * primary block に最も近い secondary cue text を探索する。
     * timing overlap を優先しつつ、近傍 cue も matchWindow 内なら候補に含める。
     *
     * @param {Object} block - primary 基準の subtitle block。
     * @param {ArrayLike<Object>|Array<Object>} secondaryCues - secondary cue 群。
     * @param {Function|null} cleanCueText - cue text 整形関数。
     * @param {number} matchWindow - 許容マッチ秒数。
     * @returns {string} 対応づいた secondary text。見つからなければ空文字。
     */
    function matchSecondaryText(
      block,
      secondaryCues,
      cleanCueText,
      matchWindow,
    ) {
      let bestCue = null;
      let bestScore = Number.POSITIVE_INFINITY;

      const blockStart = Number(block?.startTime ?? 0);
      const blockEnd = Number(block?.endTime ?? 0);

      for (const cue of secondaryCues) {
        const text = normalizeText(
          cleanCueText ? cleanCueText(cue) : cue?.text,
        );
        if (!text) continue;

        const cueStart = Number(cue?.startTime ?? 0);
        const cueEnd = Number(cue?.endTime ?? 0);

        const overlaps =
          cueStart <= blockEnd + 0.35 && blockStart <= cueEnd + 0.35;

        const startDelta = Math.abs(cueStart - blockStart);
        const endDelta = Math.abs(cueEnd - blockEnd);
        const score = Math.min(startDelta, endDelta);

        if (!overlaps && startDelta > matchWindow) continue;

        if (score < bestScore) {
          bestScore = score;
          bestCue = cue;
        }
      }

      if (!bestCue) return "";
      return normalizeText(
        cleanCueText ? cleanCueText(bestCue) : bestCue?.text,
      );
    }

    // -------------------------------------------------------
    // sequence 状態解析 (sequence state analysis)
    // -------------------------------------------------------

    /**
     * sequence の current block と secondary の有無から health を診断する。
     * recovery 判定で参照しやすい最小限のフラグをまとめて返す。
     *
     * @param {Array<Object>} blocks - subtitle block 配列。
     * @param {number} currentIndex - 現在 index。
     * @param {Array<Object>} [previousBlocks=[]] - 直前の block 配列。
     * @returns {Object} sequence health 情報。
     */
    function analyzeSequenceHealth(blocks, currentIndex, previousBlocks = []) {
      const list = Array.isArray(blocks) ? blocks : [];
      const currentBlock =
        currentIndex >= 0 && currentIndex < list.length
          ? list[currentIndex]
          : null;
      const previousList = Array.isArray(previousBlocks) ? previousBlocks : [];
      const previousCurrentBlock =
        previousList.find((block) => block?.state === "current") || null;

      const hasCurrentBlock = Boolean(currentBlock);
      const hasCurrentPrimary = Boolean(normalizeText(currentBlock?.primaryText));
      const hasCurrentSecondary = Boolean(normalizeText(currentBlock?.secondaryText));
      const currentPairAligned =
        hasCurrentBlock && (!hasCurrentPrimary || hasCurrentSecondary);

      const previousCurrentPrimary = Boolean(
        normalizeText(previousCurrentBlock?.primaryText),
      );
      const previousCurrentSecondary = Boolean(
        normalizeText(previousCurrentBlock?.secondaryText),
      );
      const previousPairMissingSecondary =
        previousCurrentPrimary && !previousCurrentSecondary;

      const currentPairMissingSecondary =
        hasCurrentPrimary && !hasCurrentSecondary;

      const consecutiveCurrentMissingSecondary =
        currentPairMissingSecondary && previousPairMissingSecondary;

      return {
        hasCurrentBlock,
        hasCurrentPrimary,
        hasCurrentSecondary,
        currentPairAligned,
        currentPairMissingSecondary,
        previousPairMissingSecondary,
        consecutiveCurrentMissingSecondary,
        shouldRecoverSecondary:
          hasCurrentBlock &&
          hasCurrentPrimary &&
          consecutiveCurrentMissingSecondary,
      };
    }

    /**
     * block 配列から current index を1つ選ぶ。
     * 通常は classifyBlockState で "current" になった block をそのまま使うが、
     * block 境界のすき間（cue 終了直後の一瞬など）に now が落ちた場合、
     * 直前に終わった block を gapHoldSeconds の間だけ current として保持する。
     * これにより cue 切り替わりの瞬間に current が -1 になり
     * 字幕表示が一瞬途切れる／更新が止まって見える問題を避ける。
     *
     * @param {Array<Object>} blocks - subtitle block 配列。
     * @param {number} now - 現在の再生時刻（秒）。
     * @param {{ gapHoldSeconds?: number }} [options={}] - 判定オプション。
     * @returns {number} currentIndex。見つからなければ -1。
     */
    function resolveCurrentIndex(blocks, now, { gapHoldSeconds = 0.1 } = {}) {
      const list = Array.isArray(blocks) ? blocks : [];
      if (!list.length) return -1;

      const currentCandidates = [];
      list.forEach((block, index) => {
        if (block.state === "current") {
          currentCandidates.push(index);
        }
      });

      if (currentCandidates.length === 1) {
        return currentCandidates[0];
      }

      if (currentCandidates.length > 1) {
        let bestIndex = currentCandidates[0];
        let bestDelta = Number.POSITIVE_INFINITY;

        for (const index of currentCandidates) {
          const block = list[index];
          const center = (block.startTime + block.endTime) / 2;
          const delta = Math.abs(center - now);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIndex = index;
          }
        }

        return bestIndex;
      }

      // grace-period フォールバック:
      // state ベースで "past" のみを対象に絞り、直前に終わった block を保持する。
      let closestPastIndex = -1;
      let closestPastGap = Number.POSITIVE_INFINITY;

      list.forEach((block, index) => {
        if (block.state !== "past") return;
        const gap = now - block.endTime;
        if (gap <= gapHoldSeconds && gap < closestPastGap) {
          closestPastGap = gap;
          closestPastIndex = index;
        }
      });

      return closestPastIndex;
    }

    // -------------------------------------------------------
    // 公開エントリーポイント (public entry point)
    // -------------------------------------------------------

    /**
     * subtitle block sequence 全体を構築する。
     * primary cue 群をまず block 単位へ集約し、その後 secondary pairing と state 判定を行う。
     * sequence の正本は primary 基準とし、primary が空の間は空 sequence を返す。
     *
     * @param {Object} params
     * @param {ArrayLike<Object>|Array<Object>} params.primaryCues - primary cue 群。
     * @param {ArrayLike<Object>|Array<Object>} params.secondaryCues - secondary cue 群。
     * @param {number} params.now - 現在の再生時刻（秒）。
     * @param {Array<Object>} [params.previousBlocks=[]] - 直前の block 配列。
     * @param {Function} params.cleanCueText - cue text 整形関数。
     * @param {number} [params.matchWindow=2.0] - secondary 対応付け許容秒数。
     * @param {string} [params.rebuildReason="cuechange"] - sequence 再構築理由（meta 用）。
     * @param {number} [params.primaryMergeTolerance=0.12] - group merge 許容秒数。
     * @param {number} [params.gapHoldSeconds=0.4] - current gap 保持秒数。
     * @returns {{
     *   blocks: Array<Object>,
     *   currentIndex: number,
     *   meta: Object,
     * }}
     */
    function buildSubtitleBlockSequence({
      primaryCues,
      secondaryCues,
      now,
      previousBlocks = [],
      cleanCueText,
      matchWindow = 2.0,
      rebuildReason = "cuechange",
      primaryMergeTolerance = 0.12,
      gapHoldSeconds = 0.4,
    }) {
      const secondaryList = toArray(secondaryCues);
      const groupedPrimaryList = groupCues(
        primaryCues,
        cleanCueText,
        primaryMergeTolerance,
      );
      const groupedSecondaryList = groupCues(
        secondaryCues,
        cleanCueText,
        primaryMergeTolerance,
      );

      const previousMap = new Map(
        (Array.isArray(previousBlocks) ? previousBlocks : []).map((block) => [
          block.key,
          block,
        ]),
      );

      let blocks = groupedPrimaryList
        .map((group) => {
          const block = buildSubtitleBlockFromGroups(group, null);
          if (!block) return null;

          const secondaryText = matchSecondaryText(
            block,
            secondaryList,
            cleanCueText,
            matchWindow,
          );

          block.secondaryText = secondaryText;
          block.hasSecondarySignal = Boolean(secondaryText);
          block.state = classifyBlockState(block, now);
          block.stable = false;
          block.key = buildSubtitleBlockKey(block);

          const prev = previousMap.get(block.key);
          if (block.state === "past") {
            block.stable = true;
          } else if (
            block.state === "current" &&
            prev &&
            prev.secondaryText === block.secondaryText &&
            prev.stable === true
          ) {
            block.stable = true;
          }

          return block;
        })
        .filter(Boolean);

      const currentIndex = resolveCurrentIndex(blocks, now, {
        gapHoldSeconds,
      });

      if (
        currentIndex >= 0 &&
        blocks[currentIndex] &&
        blocks[currentIndex].state !== "current"
      ) {
        blocks[currentIndex].state = "current";
        blocks[currentIndex].heldByGapFallback = true;
      }

      const sequenceHealth = analyzeSequenceHealth(
        blocks,
        currentIndex,
        previousBlocks,
      );

      return {
        blocks,
        currentIndex,
        meta: {
          now,
          rebuildReason,
          blockCount: blocks.length,
          groupedPrimaryCount: groupedPrimaryList.length,
          groupedSecondaryCount: groupedSecondaryList.length,
          primaryMergeTolerance,
          gapHoldSeconds,
          sequenceHealth,
        },
      };
    }

    // -------------------------------------------------------
    // エクスポート (public API)
    // -------------------------------------------------------

    root.subtitleBlocks = {
      buildSubtitleBlockSequence,
    };
  } catch (error) {
    console.error("[ATVB] subtitle-blocks: failed", error); // eslint-disable-line no-console
  }
})();

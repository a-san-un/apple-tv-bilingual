// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-blocks.js
// version: 1.1.0
// 役割: primary / secondary cues から panel / overlay 共通の
// subtitle block sequence を構築する。
// 同時間帯に並ぶ複数 primary cue は 1 block へ集約し、
// overlay と panel が同じ表示単位を共有できるようにする。
// =============================================================

(() => {
  try {
    const root = (window.ATVB = window.ATVB || {});

    // cues / cueList / array-like を安全に配列へ正規化する。
    // 読み取り失敗時は空配列へフォールバックする。
    function toArray(cuesLike) {
      if (!cuesLike) return [];
      try {
        return Array.from(cuesLike);
      } catch (_) {
        return [];
      }
    }

    // cue text を比較・結合しやすい形へ正規化する。
    // null / undefined は空文字として扱う。
    function normalizeText(text) {
      return String(text || "").trim();
    }

    // block の同一性比較に使う key を組み立てる。
    // start / end / primaryText を固定精度で連結する。
    function buildSubtitleBlockKey(block) {
      return [
        Number(block?.startTime ?? 0).toFixed(3),
        Number(block?.endTime ?? 0).toFixed(3),
        normalizeText(block?.primaryText),
      ].join("::");
    }

    // block が past / current / future のどれかを返す。
    // 再生時刻 now を block time range と比較して判定する。
    function classifyBlockState(block, now) {
      if (block.endTime < now) return "past";
      if (block.startTime > now) return "future";
      return "current";
    }

    // 近い timing を持つ連続 primary cue 群を 1 block 用グループへ集約する。
    // roll-up 的に同時間帯へ並ぶ短い cue 群を panel / overlay 共通の 1 表示単位にする。
    function groupPrimaryCues(primaryCues, cleanCueText, mergeTolerance = 0.12) {
      const primaryList = toArray(primaryCues);
      const groups = [];

      for (const cue of primaryList) {
        const primaryText = normalizeText(
          cleanCueText ? cleanCueText(cue) : cue?.text,
        );
        if (!primaryText) continue;

        const startTime = Number(cue?.startTime ?? 0);
        const endTime = Number(cue?.endTime ?? 0);
        const lastGroup = groups[groups.length - 1] || null;

        const canMerge =
          lastGroup &&
          Math.abs(lastGroup.startTime - startTime) <= mergeTolerance &&
          Math.abs(lastGroup.endTime - endTime) <= mergeTolerance;

        if (canMerge) {
          lastGroup.endTime = Math.max(lastGroup.endTime, endTime);
          lastGroup.primarySegments.push(primaryText);
          lastGroup.cues.push(cue);
          continue;
        }

        groups.push({
          startTime,
          endTime,
          primarySegments: [primaryText],
          cues: [cue],
        });
      }

      return groups.map((group) => ({
        startTime: group.startTime,
        endTime: group.endTime,
        primarySegments: group.primarySegments.slice(),
        primaryText: group.primarySegments.join(" "),
        cues: group.cues.slice(),
      }));
    }

    // primary block に最も近い secondary cue text を探索する。
    // timing overlap を優先しつつ、近傍 cue も matchWindow 内なら候補に含める。
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

    // sequence の current block と secondary の有無から health を診断する。
    // recovery 判定で参照しやすい最小限のフラグをまとめて返す。
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

    // subtitle block sequence 全体を構築する。
    // primary cue 群をまず block 単位へ集約し、その後 secondary pairing と state 判定を行う。
    function buildSubtitleBlockSequence({
      primaryCues,
      secondaryCues,
      now,
      previousBlocks = [],
      cleanCueText,
      matchWindow = 2.0,
      rebuildReason = "cuechange",
      primaryMergeTolerance = 0.12,
    }) {
      const secondaryList = toArray(secondaryCues);
      const groupedPrimaryList = groupPrimaryCues(
        primaryCues,
        cleanCueText,
        primaryMergeTolerance,
      );

      const previousMap = new Map(
        (Array.isArray(previousBlocks) ? previousBlocks : []).map((block) => [
          block.key,
          block,
        ]),
      );

      const blocks = groupedPrimaryList
        .map((group) => {
          const primaryText = normalizeText(group?.primaryText);
          if (!primaryText) return null;

          const block = {
            startTime: Number(group?.startTime ?? 0),
            endTime: Number(group?.endTime ?? 0),
            primaryText,
            primarySegments: Array.isArray(group?.primarySegments)
              ? group.primarySegments.slice()
              : [primaryText],
            secondaryText: "",
            hasPrimarySignal: Boolean(primaryText),
            hasSecondarySignal: false,
            state: "future",
            stable: false,
          };

          block.key = buildSubtitleBlockKey(block);
          block.secondaryText = matchSecondaryText(
            block,
            secondaryList,
            cleanCueText,
            matchWindow,
          );
          block.hasSecondarySignal = Boolean(block.secondaryText);
          block.state = classifyBlockState(block, now);

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
          } else {
            block.stable = false;
          }

          return block;
        })
        .filter(Boolean);

      const currentIndex = blocks.findIndex(
        (block) => block.state === "current",
      );
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
          primaryMergeTolerance,
          sequenceHealth,
        },
      };
    }

    root.subtitleBlocks = {
      buildSubtitleBlockKey,
      groupPrimaryCues,
      buildSubtitleBlockSequence,
      analyzeSequenceHealth,
    };
  } catch (error) {
    console.error("[ATVB] subtitle-blocks: failed", error);
  }
})();

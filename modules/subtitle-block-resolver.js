// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-block-resolver.js
// version: 2.6.4
//
// 役割:
// - panel 表示用 subtitle block の正規化を行う
// - start/end が同じ block を same-window group として束ねる
// - truth としての current/past/future を strict に解決する
// - panel UX 用に、window 単位 current 強調フラグを派生計算する
//
// 設計方針:
// - truth の state/currentBlocks は strict な時刻判定のまま維持する
// - panel は派生ビューとして扱い、短い gap では直前 window を
//   current 風に見せられるようにする
// - same-window 2行/3行 group では、isSequentialCurrent は 1行だけ、
//   isPanelEmphasized は window 単位で複数行 true を許容する
// =============================================================
(function () {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  const PANEL_CURRENT_WINDOW_GAP_TOLERANCE = 0.18;

  // -------------------------------------------------------
  // 正規化 (normalize)
  // -------------------------------------------------------

  /**
   * sourceBlocks を panel 用 block 配列へ正規化し、strict な state を付与する。
   * current block が無い場合のみ、必要なら currentSubtitleBlock 由来 fallback を追加する。
   *
   * @param {Array<Object>} sourceBlocks - 正規化前の subtitle block 配列。
   * @param {number} currentTime - 現在の再生時刻（秒）。
   * @param {Object|null} currentSubtitleBlock - fallback 生成に使う現在 block（存在すれば）。
   * @returns {{ normalizedBlocks: Array<Object>, usedCurrentFallback: boolean }}
   *   normalizedBlocks: startTime 昇順にソートされた正規化済み block 配列。
   *   usedCurrentFallback: fallback block を追加したかどうか。
   */
  function normalizePanelBlocks(
    sourceBlocks,
    currentTime,
    currentSubtitleBlock,
  ) {
    const baseBlocks = Array.isArray(sourceBlocks) ? sourceBlocks : [];
    const normalizedBlocks = baseBlocks
      .filter((block) => block && Number.isFinite(block.startTime))
      .map((block) => {
        const startTime = Number(block.startTime);
        const endTime = Number.isFinite(block.endTime)
          ? Number(block.endTime)
          : startTime;
        let state = "future";

        if (endTime <= currentTime) {
          state = "past";
        } else if (startTime <= currentTime && endTime > currentTime) {
          state = "current";
        }

        return {
          ...block,
          startTime,
          endTime,
          primary: block.primary ?? block.primaryText ?? "",
          secondary: block.secondary ?? block.secondaryText ?? "",
          state,
        };
      });

    const hasCurrentBlock = normalizedBlocks.some(
      (block) => block.state === "current",
    );

    const fallbackStartTime =
      currentSubtitleBlock?.startTime != null
        ? Number(currentSubtitleBlock.startTime)
        : null;
    const fallbackEndTime =
      currentSubtitleBlock?.endTime != null
        ? Number(currentSubtitleBlock.endTime)
        : null;

    const hasNormalBlockInSameWindow =
      fallbackStartTime != null &&
      fallbackEndTime != null &&
      normalizedBlocks.some(
        (block) =>
          block.key !== "current-fallback" &&
          block.startTime === fallbackStartTime &&
          block.endTime === fallbackEndTime,
      );

    let usedCurrentFallback = false;
    if (
      !hasCurrentBlock &&
      fallbackStartTime != null &&
      fallbackEndTime != null &&
      !hasNormalBlockInSameWindow
    ) {
      usedCurrentFallback = true;
      normalizedBlocks.push({
        startTime: fallbackStartTime,
        endTime: fallbackEndTime,
        primary:
          currentSubtitleBlock.primaryText ||
          currentSubtitleBlock.primary ||
          "",
        secondary:
          currentSubtitleBlock.secondaryText ||
          currentSubtitleBlock.secondary ||
          "",
        state: "current",
        stable: false,
        key: "current-fallback",
      });
    }

    normalizedBlocks.sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime - b.startTime;
      if (a.endTime !== b.endTime) return a.endTime - b.endTime;
      return 0;
    });

    return {
      normalizedBlocks,
      usedCurrentFallback,
    };
  }

  // -------------------------------------------------------
  // グルーピング (same-window grouping)
  // -------------------------------------------------------

  /**
   * start/end が同じ block を同一 window とみなし、group map を作る。
   *
   * @param {Array<Object>} blocks - グルーピング対象の block 配列。
   * @returns {Map<string, Array<{ block: Object, index: number }>>}
   *   キーは `${startTime}::${endTime}`、値はその window に属する block と元 index の配列。
   */
  function groupBlocksByTimeWindow(blocks) {
    const groups = new Map();
    (Array.isArray(blocks) ? blocks : []).forEach((block, index) => {
      const key = `${block.startTime}::${block.endTime}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ block, index });
    });
    return groups;
  }

  // -------------------------------------------------------
  // same-window 内の current 解決
  // -------------------------------------------------------

  /**
   * current window 内で same-window group が複数行ある場合、
   * progress に応じて 1 行だけ strict current にし、前後行を past/future へ振り分ける。
   * 各 group の block.state を破壊的に更新する。
   *
   * @param {Map<string, Array<{ block: Object, index: number }>>} groups
   *   groupBlocksByTimeWindow の戻り値。
   * @param {number} currentTime - 現在の再生時刻（秒）。
   * @param {Function|null} [debugLog] - デバッグ用ログ関数（省略可）。
   * @returns {void}
   */
  function applySequentialCurrentWithinGroup(
    groups,
    currentTime,
    debugLog = null,
  ) {
    groups.forEach((entries) => {
      if (entries.length <= 1) return;

      const { startTime, endTime } = entries[0].block;
      if (!(startTime <= currentTime && endTime > currentTime)) return;

      const duration = Math.max(0.001, endTime - startTime);
      const progress = Math.min(
        0.999999,
        Math.max(0, (currentTime - startTime) / duration),
      );
      const currentIndex =
        entries.length === 2
          ? progress < 0.3
            ? 0
            : 1
          : Math.min(entries.length - 1, Math.floor(progress * entries.length));

      entries.forEach(({ block }, index) => {
        if (index < currentIndex) {
          block.state = "past";
        } else if (index === currentIndex) {
          block.state = "current";
        } else {
          block.state = "future";
        }
      });

      if (
        typeof debugLog === "function" &&
        currentTime >= 32 &&
        currentTime <= 40
      ) {
        debugLog("same-window sequential current", {
          currentTime,
          startTime,
          endTime,
          duration,
          progress,
          entryCount: entries.length,
          selectedIndex: currentIndex,
          items: entries.map(({ block }, index) => ({
            index,
            key: block.key || null,
            primaryPreview: String(block.primary || "").slice(0, 40),
            state: block.state,
          })),
        });
      }
    });
  }

  // -------------------------------------------------------
  // 複数 current window の一本化
  // -------------------------------------------------------

  /**
   * 複数 window が同時に current になった場合、現在時刻に最も近い 1 window を winner に決める。
   * winner 以外の current block は past/future に振り分けて破壊的に更新する。
   *
   * @param {Array<Object>} blocks - state 済みの block 配列（破壊的に更新される）。
   * @param {number} currentTime - 現在の再生時刻（秒）。
   * @returns {Array<Object>} 一本化後に state === "current" の block 配列。
   */
  function resolveSingleCurrentBlock(blocks, currentTime) {
    const currentBlocks = (Array.isArray(blocks) ? blocks : []).filter(
      (block) => block.state === "current",
    );

    if (currentBlocks.length <= 1) {
      return currentBlocks;
    }

    const groupedByWindow = new Map();
    currentBlocks.forEach((block) => {
      const key = `${block.startTime}::${block.endTime}`;
      if (!groupedByWindow.has(key)) groupedByWindow.set(key, []);
      groupedByWindow.get(key).push(block);
    });

    if (groupedByWindow.size <= 1) {
      return currentBlocks;
    }

    const currentWinner = currentBlocks.slice().sort((a, b) => {
      const aDistance = Math.abs(currentTime - a.startTime);
      const bDistance = Math.abs(currentTime - b.startTime);
      if (aDistance !== bDistance) return aDistance - bDistance;
      if (a.startTime !== b.startTime) return a.startTime - b.startTime;
      if (a.endTime !== b.endTime) return a.endTime - b.endTime;
      return 0;
    })[0];

    blocks.forEach((block) => {
      if (block.state !== "current") return;
      if (
        block.startTime === currentWinner.startTime &&
        block.endTime === currentWinner.endTime
      ) {
        return;
      }

      block.state =
        block.startTime < currentWinner.startTime ? "past" : "future";
    });

    return blocks.filter((block) => block.state === "current");
  }

  // -------------------------------------------------------
  // panel 用 current window の派生解決
  // -------------------------------------------------------

  /**
   * panel 用 current window を決める。
   * strict current window が無い場合でも、短い gap なら直前 window を current 扱いで延命する。
   *
   * @param {Map<string, Array<{ block: Object, index: number }>>} sameWindowGroups
   *   groupBlocksByTimeWindow の戻り値。
   * @param {number} currentTime - 現在の再生時刻（秒）。
   * @returns {{
   *   currentWindowKey: string|null,
   *   usedGapFallback: boolean,
   *   gapFromPreviousWindow: number|null,
   * }}
   */
  function findPanelCurrentWindowKey(sameWindowGroups, currentTime) {
    let strictCurrentWindowKey = null;
    let nearestPastWindowKey = null;
    let nearestPastDistance = Infinity;

    sameWindowGroups.forEach((entries, groupKey) => {
      if (!entries.length) return;

      const { startTime, endTime } = entries[0].block;

      if (startTime <= currentTime && endTime > currentTime) {
        strictCurrentWindowKey = groupKey;
        return;
      }

      if (endTime <= currentTime) {
        const distance = currentTime - endTime;
        if (distance < nearestPastDistance) {
          nearestPastDistance = distance;
          nearestPastWindowKey = groupKey;
        }
      }
    });

    if (strictCurrentWindowKey) {
      return {
        currentWindowKey: strictCurrentWindowKey,
        usedGapFallback: false,
        gapFromPreviousWindow: 0,
      };
    }

    if (
      nearestPastWindowKey &&
      nearestPastDistance <= PANEL_CURRENT_WINDOW_GAP_TOLERANCE
    ) {
      return {
        currentWindowKey: nearestPastWindowKey,
        usedGapFallback: true,
        gapFromPreviousWindow: nearestPastDistance,
      };
    }

    return {
      currentWindowKey: null,
      usedGapFallback: false,
      gapFromPreviousWindow: null,
    };
  }

  /**
   * truth の state から panel 表示用派生フラグを計算する。
   * same-window 複数行では window 単位で isPanelEmphasized=true を付与する。
   * 各 block を破壊的に更新する（isWindowCurrent / isSequentialCurrent / isPanelEmphasized）。
   *
   * @param {Array<Object>} blocks - state 済みの block 配列（破壊的に更新される）。
   * @param {Map<string, Array<{ block: Object, index: number }>>} sameWindowGroups
   *   groupBlocksByTimeWindow の戻り値。
   * @param {number} currentTime - 現在の再生時刻（秒）。
   * @param {Function|null} [debugLog] - デバッグ用ログ関数（省略可）。
   * @returns {void}
   */
  function applyPanelCurrentFlags(
    blocks,
    sameWindowGroups,
    currentTime,
    debugLog = null,
  ) {
    const { currentWindowKey, usedGapFallback, gapFromPreviousWindow } =
      findPanelCurrentWindowKey(sameWindowGroups, currentTime);

    (Array.isArray(blocks) ? blocks : []).forEach((block) => {
      const windowKey = `${block.startTime}::${block.endTime}`;
      const groupEntries = sameWindowGroups.get(windowKey) || [];
      const isWindowCurrent = windowKey === currentWindowKey;
      const hasMultipleBlocksInWindow = groupEntries.length > 1;

      block.isWindowCurrent = isWindowCurrent;
      block.isSequentialCurrent = block.state === "current";
      block.isPanelEmphasized = hasMultipleBlocksInWindow
        ? isWindowCurrent
        : isWindowCurrent || block.isSequentialCurrent;
    });

    if (
      usedGapFallback &&
      typeof debugLog === "function" &&
      currentTime >= 32 &&
      currentTime <= 40
    ) {
      debugLog("panel current window gap fallback", {
        currentTime,
        currentWindowKey,
        gapFromPreviousWindow,
        tolerance: PANEL_CURRENT_WINDOW_GAP_TOLERANCE,
      });
    }
  }

  // -------------------------------------------------------
  // 表示行の整形 (display line helpers)
  // -------------------------------------------------------

  /**
   * 文字列配列から、trim 後に空文字/重複する行を除いた配列を、出現順を保ったまま返す。
   *
   * @param {Array<string>} lines - 重複除去前の行配列。
   * @returns {Array<string>} 重複除去後の行配列（出現順維持）。
   */
  function dedupeLinesInOrder(lines) {
    const seen = new Set();
    return (Array.isArray(lines) ? lines : []).filter((line) => {
      const value = typeof line === "string" ? line.trim() : "";
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  /**
   * same-window group を、panel 表示用の 1 block（displayBlock）にまとめる。
   * 同一 window 内の primary/secondary 行を重複除去して結合し、
   * group 内に current 行があればそれを代表 block として採用する。
   *
   * @param {Array<Object>} blocks - 正規化・state 解決済みの block 配列。
   * @param {Map<string, Array<{ block: Object, index: number }>>} sameWindowGroups
   *   groupBlocksByTimeWindow の戻り値。
   * @returns {Array<Object>} panel 描画用に集約された displayBlock 配列。
   */
  function buildDisplayBlocksFromGroups(blocks, sameWindowGroups) {
    const sourceBlocks = Array.isArray(blocks) ? blocks : [];
    const groups =
      sameWindowGroups instanceof Map ? sameWindowGroups : new Map();
    const consumed = new Set();
    const displayBlocks = [];

    sourceBlocks.forEach((block) => {
      const groupKey = `${block.startTime}::${block.endTime}`;
      if (consumed.has(groupKey)) return;

      const entries = groups.get(groupKey) || [{ block }];
      consumed.add(groupKey);

      const groupBlocks = entries.map(({ block }) => block).filter(Boolean);
      const primaryLines = dedupeLinesInOrder(groupBlocks.map((b) => b.primary));
      const secondaryLines = dedupeLinesInOrder(
        groupBlocks.map((b) => b.secondary),
      );
      const representative =
        groupBlocks.find((b) => b.state === "current") || groupBlocks[0] || block;

      displayBlocks.push({
        ...representative,
        primary: primaryLines.join("\n"),
        secondary: secondaryLines.join("\n"),
        mainLines: primaryLines,
        subLines: secondaryLines,
        state: representative?.state || block.state,
        isWindowCurrent: groupBlocks.some((b) => b.isWindowCurrent === true),
        isSequentialCurrent:
          representative?.isSequentialCurrent ??
          representative?.state === "current",
        isPanelEmphasized: groupBlocks.some(
          (b) => b.isPanelEmphasized === true,
        ),
      });
    });

    return displayBlocks;
  }

  // -------------------------------------------------------
  // 公開エントリーポイント (public entry point)
  // -------------------------------------------------------

  /**
   * panel 描画用の truth/派生情報をまとめて解決し、renderer が使う shape へ整える。
   * normalizePanelBlocks → groupBlocksByTimeWindow → applySequentialCurrentWithinGroup →
   * resolveSingleCurrentBlock → applyPanelCurrentFlags → buildDisplayBlocksFromGroups
   * の順にパイプライン処理する、このモジュールの唯一の公開エントリーポイント。
   *
   * @param {Object} [params]
   * @param {Array<Object>} [params.sourceBlocks=[]] - 正規化前の subtitle block 配列。
   * @param {number} [params.currentTime=0] - 現在の再生時刻（秒）。
   * @param {Object|null} [params.currentSubtitleBlock=null] - fallback 生成に使う現在 block。
   * @param {Function|null} [params.debugLog=null] - デバッグ用ログ関数（省略可）。
   * @returns {{
   *   blocks: Array<Object>,
   *   displayBlocks: Array<Object>,
   *   currentBlocks: Array<Object>,
   *   usedCurrentFallback: boolean,
   *   sameWindowGroups: Map<string, Array<{ block: Object, index: number }>>,
   * }}
   */
  function resolvePanelBlocksForRender({
    sourceBlocks = [],
    currentTime = 0,
    currentSubtitleBlock = null,
    debugLog = null,
  } = {}) {
    const { normalizedBlocks, usedCurrentFallback } = normalizePanelBlocks(
      sourceBlocks,
      currentTime,
      currentSubtitleBlock,
    );
    const sameWindowGroups = groupBlocksByTimeWindow(normalizedBlocks);

    applySequentialCurrentWithinGroup(sameWindowGroups, currentTime, debugLog);
    const currentBlocks = resolveSingleCurrentBlock(
      normalizedBlocks,
      currentTime,
    );

    applyPanelCurrentFlags(
      normalizedBlocks,
      sameWindowGroups,
      currentTime,
      debugLog,
    );

    const displayBlocks = buildDisplayBlocksFromGroups(
      normalizedBlocks,
      sameWindowGroups,
    );

    return {
      blocks: normalizedBlocks,
      displayBlocks,
      currentBlocks,
      usedCurrentFallback,
      sameWindowGroups,
    };
  }

  // -------------------------------------------------------
  // エクスポート (namespace形式: window.ATVB.subtitleBlockResolver.*)
  // -------------------------------------------------------

  root.subtitleBlockResolver = {
    resolvePanelBlocksForRender,
  };
})();

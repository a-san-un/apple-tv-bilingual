(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /*
   * overlay 用 same-window group を解決し、
   * groupKey / startTime / endTime / mainLines / subLines /
   * isStable / shouldKeepVisible / isEmpty を持つ OverlayView を返す。
   */

  function buildOverlayGroupKey(startTime, endTime) {
    return `${startTime}::${endTime}`;
  }

  /* same-window key を作る。 */
  function buildGroupKeyFromBlock(block) {
    return buildOverlayGroupKey(block?.startTime ?? null, block?.endTime ?? null);
  }

  /* overlay 行テキストを空白トリムして正規化する。 */
  function normalizeLineText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  /* group 内の指定フィールドを取得順で lines に変換し、重複を除く。 */
  function collectGroupLines(group, fieldName) {
    const lines = (Array.isArray(group) ? group : [])
      .map((block) => normalizeLineText(block?.[fieldName]))
      .filter(Boolean);

    const seen = new Set();
    return lines.filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  }

  /* current block と同じ same-window group を抽出する。 */
  function findOverlayGroup(blocks, currentIndex) {
    const list = Array.isArray(blocks) ? blocks : [];
    if (!list.length || currentIndex < 0 || currentIndex >= list.length) {
      return [];
    }

    const currentBlock = list[currentIndex];
    if (!currentBlock) return [];

    const currentGroupKey = buildGroupKeyFromBlock(currentBlock);

    return list.filter((block) => buildGroupKeyFromBlock(block) === currentGroupKey);
  }

  /* truth sequence から overlay 用 view を解決する。 */
  function resolveOverlayView(blocks, currentIndex, _meta = null) {
    const list = Array.isArray(blocks) ? blocks : [];
    const group = findOverlayGroup(list, currentIndex);
    const currentBlock =
      currentIndex >= 0 && currentIndex < list.length ? list[currentIndex] : null;
    const startTime = currentBlock?.startTime ?? null;
    const endTime = currentBlock?.endTime ?? null;
    const mainLines = collectGroupLines(group, "primaryText");
    const subLines = collectGroupLines(group, "secondaryText");
    const isStable = group.length > 0 && group.every((block) => block?.stable === true);
    const hasAnyLines = mainLines.length > 0 || subLines.length > 0;
    const isEmpty = !hasAnyLines;
    const shouldKeepVisible = hasAnyLines || !isStable;

    return {
      groupKey: buildOverlayGroupKey(startTime, endTime),
      currentBlock,
      startTime,
      endTime,
      mainLines,
      subLines,
      isStable,
      shouldKeepVisible,
      isEmpty,
    };
  }

  root.overlayBlockResolver = {
    resolveOverlayView,
  };
})();

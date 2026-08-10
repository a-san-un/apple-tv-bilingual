/**
 * subtitle-history-store.js
 *
 * contentKey 単位の字幕履歴を管理する専用ストア。
 * content.js の Map / 配列直接操作をここに集約する。
 *
 * Issue #32 Step 6
 */

/**
 * @param {number} maxPerContent  - 1作品あたりの最大履歴件数
 * @returns {{
 *   getHistory: (key: string) => object[],
 *   setHistory: (key: string, items: object[]) => void,
 *   switchContext: (nextKey: string, options?: {
 *     reason?: string,
 *     onBeforeSwitch?: (prevKey: string, nextKey: string) => void
 *   }) => boolean,
 *   append: (entry: object) => void,
 *   getCurrentKey: () => string,
 *   getActiveHistory: () => object[],
 *   reset: () => void,
 * }}
 */
function createSubtitleHistoryStore(maxPerContent) {
  const _store = new Map();
  let _currentKey = '';
  let _activeHistory = [];

  function _clamp(items) {
    if (!Array.isArray(items)) return [];
    return items.slice(-maxPerContent);
  }

  function getHistory(key) {
    if (!key) return [];
    const bucket = _store.get(key);
    return Array.isArray(bucket?.items) ? bucket.items.slice() : [];
  }

  function setHistory(key, items) {
    if (!key) return;
    _store.set(key, {
      items: _clamp(items),
      updatedAt: Date.now(),
    });
  }

  function getActiveHistory() {
    return _activeHistory.slice();
  }

  function getCurrentKey() {
    return _currentKey;
  }

  /**
   * contentKey を切り替える。
   *
   * @param {string} nextKey
   * @param {{
   *   reason?: string,
   *   onBeforeSwitch?: (prevKey: string, nextKey: string) => void
   * }} [options]
   * @returns {boolean} 切り替えが発生したかどうか
   */
  function switchContext(nextKey, options = {}) {
    const resolvedNext = nextKey || 'content:unknown';
    const prevKey = _currentKey;

    if (prevKey === resolvedNext) return false;

    // 切り替え前フック（overlay clear 等の副作用を呼び出し元で渡す）
    if (typeof options.onBeforeSwitch === 'function') {
      options.onBeforeSwitch(prevKey, resolvedNext);
    }

    // 現在の履歴を保存
    if (prevKey) {
      setHistory(prevKey, _activeHistory);
    }

    // 次のキーの履歴を読み込む
    _currentKey = resolvedNext;
    _activeHistory = getHistory(resolvedNext);

    return true;
  }

  /**
   * 現在の contentKey にエントリを追記する。
   * @param {object} entry
   */
  function append(entry) {
    if (!entry) return;
    _activeHistory = _clamp(_activeHistory.concat(entry));
    if (_currentKey) {
      setHistory(_currentKey, _activeHistory);
    }
  }

  /** ストア全体をリセットする（タブクローズや拡張OFF時） */
  function reset() {
    _store.clear();
    _currentKey = '';
    _activeHistory = [];
  }

  return {
    getHistory,
    setHistory,
    getActiveHistory,
    getCurrentKey,
    switchContext,
    append,
    reset,
  };
}

// グローバル公開（content_scripts 間で共有）
window.createSubtitleHistoryStore = createSubtitleHistoryStore;

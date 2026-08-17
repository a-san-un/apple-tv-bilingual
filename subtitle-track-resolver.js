// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-track-resolver.js
// version: 2.6.3
//
// 役割:
// - 字幕トラック選定（resolver）責務を担当する。
// - requested language と textTracks の照合・候補化・最終選定を一箇所へ集約する。
// - Apple TV+ ネイティブ字幕メニューの候補探索と選択同期を担当する。
// - content.js から resolver 関連関数を切り出して window.ATVB.resolver で公開する。
//
// このファイルのメンテナンス方針:
// - 言語一致ロジックは matchesRequestedLanguage() に寄せる。
// - track.language だけでなく track.label も補助情報として扱う。
// - Apple TV+ 側の language 表記ゆれは language-definitions.js の正本定義へ寄せる。
// - ネイティブメニュー候補文字列の正本は modules/language-definitions.js とする。
// - forced 判定・候補列挙・スコアリング・最終選定を関数単位で分離し、
//   問題発生時にログと比較条件を追いやすくする。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  // track.label 比較時に空白数の違いで判定がぶれないよう整形する。
  function normalizeTrackLabel(label) {
    return String(label || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  // language-definitions 未読込時でも最低限のコード比較を壊さないよう、
  // 区切り文字だけ揃える軽い正規化を行う。
  function normalizeTrackLanguage(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
  }

  // requested language / track.language / label 由来の値を、
  // language-definitions.js の正本 code へ寄せる。
  function canonicalizeLanguage(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const fromDefinitions =
      window.ATVB?.languageDefinitions?.canonicalizeLanguageCode?.(raw) || "";

    if (fromDefinitions) return fromDefinitions;

    return normalizeTrackLanguage(raw);
  }

  // track.label しか手掛かりがない場合でも、
  // 共通定義の alias 正本を使って補助的に言語推定できるようにする。
  function inferLanguageFromLabel(label) {
    const normalizedLabel = normalizeTrackLabel(label);
    if (!normalizedLabel) return "";

    return canonicalizeLanguage(normalizedLabel);
  }

  // requested language と track 側候補を比較する。
  // requested 側が地域・script 付き code のときは完全一致を優先し、
  // ベース言語だけの指定なら同系統の候補を受け入れる。
  function matchesRequestedLanguage(track, requestedLang) {
    const requested = canonicalizeLanguage(requestedLang);
    if (!requested) return false;

    const lang = canonicalizeLanguage(track?.language);
    const inferredFromLabel = inferLanguageFromLabel(track?.label);
    const candidates = [lang, inferredFromLabel].filter(Boolean);

    if (candidates.length === 0) return false;

    const requestedHasRegionOrScript = requested.includes("-");
    const requestedBase = requested.split("-")[0] || requested;

    return candidates.some((candidate) => {
      if (!candidate) return false;

      if (candidate === requested) {
        return true;
      }

      if (requestedHasRegionOrScript) {
        return false;
      }

      const candidateBase = candidate.split("-")[0] || candidate;
      return candidateBase === requestedBase;
    });
  }

  // forced 字幕らしい track は通常候補から外す。
  function isForcedLikeTrack(track) {
    const label = normalizeTrackLabel(track?.label).toLowerCase();
    return /\\(forced\\)|forced/.test(label);
  }

  // textTracks から字幕系だけを拾い、表示上の重複を避けるため一意化する。
  function getUniqueTracks(textTracks) {
    const seen = new Set();
    const result = [];

    for (let i = 0; i < (textTracks?.length || 0); i++) {
      const t = textTracks[i];
      if (t.kind !== "subtitles" && t.kind !== "captions") continue;
      if (isForcedLikeTrack(t)) continue;

      // まず track.language を正本 code に寄せ、
      // 空なら label 由来の補助推定を使って表示用言語を決める。
      const normalizedLanguage = canonicalizeLanguage(t.language);
      const normalizedLabel = normalizeTrackLabel(t.label);
      const inferredLanguage = inferLanguageFromLabel(normalizedLabel);
      const displayLanguage = normalizedLanguage || inferredLanguage || "";
      const key = `${displayLanguage}::${normalizedLabel}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          index: i,
          lang: displayLanguage,
          label: normalizedLabel,
          track: t,
        });
      }
    }

    return result;
  }

  // cues 参照失敗で resolver 全体が落ちないよう安全に長さを読む。
  function getTrackCuesLength(track) {
    try {
      return track?.cues ? track.cues.length : 0;
    } catch {
      return 0;
    }
  }

  // activeCues 参照失敗で resolver 全体が落ちないよう安全に長さを読む。
  function getTrackActiveCuesLength(track) {
    try {
      return track?.activeCues ? track.activeCues.length : 0;
    } catch {
      return 0;
    }
  }

  // 現在時刻に cue が重なっているかを調べ、今読める字幕かの判定材料にする。
  function hasCueOverlapAtTime(track, now) {
    if (!Number.isFinite(now)) return false;

    try {
      const cues = track?.cues;
      if (!cues || cues.length === 0) return false;

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (!cue) continue;
        if (cue.startTime <= now && now <= cue.endTime) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  // 現在時刻に対応する cue text の有無を見て、
  // 「選べたが今は空」の track を後段ログで切り分けやすくする。
  function getCurrentCueTextLength(track, now) {
    if (!track || !Number.isFinite(now)) return 0;

    try {
      const cues = track?.cues;
      if (!cues || cues.length === 0) return 0;

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (!cue) continue;
        if (cue.startTime <= now && now <= cue.endTime) {
          return String(cue.text || "").trim().length;
        }
      }
    } catch {
      return 0;
    }

    return 0;
  }

  // track の種類・現在読めるか・cue 蓄積量をもとにスコア化する。
  // active / overlap / 現在テキストの順に「今使える」情報を強く優遇する。
  function scoreSubtitleTrack(track, index, currentTime = null) {
    const cuesLength = getTrackCuesLength(track);
    const activeCuesLength = getTrackActiveCuesLength(track);
    const hasCueOverlap =
      Number.isFinite(currentTime) && hasCueOverlapAtTime(track, currentTime);
    const currentCueTextLength =
      Number.isFinite(currentTime)
        ? getCurrentCueTextLength(track, currentTime)
        : 0;

    let score = 0;

    if (track.kind === "subtitles") score += 20;
    if (track.kind === "captions") score += 10;
    if (track.mode !== "disabled") score += 10;

    if (activeCuesLength > 0) score += 5000;
    if (hasCueOverlap) score += 3000;
    if (currentCueTextLength > 0) score += 2000;

    if (cuesLength > 0) score += 1000;
    score += Math.min(cuesLength, 200);
    score += index * 0.001;

    return score;
  }

  // requested language に合う track 候補から、現在読める可能性が最も高いものを選ぶ。
  // 今読める候補 > cues を持つ候補 > それ以外、の順で母集団を絞る。
  function pickBestSubtitleTrack(textTracks, requestedLang, currentTime = null) {
    const tracks = Array.from(textTracks || []);
    const candidates = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => {
        const isSubtitleKind =
          track.kind === "subtitles" || track.kind === "captions";
        if (!isSubtitleKind) return false;
        if (isForcedLikeTrack(track)) return false;
        return matchesRequestedLanguage(track, requestedLang);
      });

    if (candidates.length === 0) {
      return null;
    }

    const readableNowCandidates = candidates.filter(({ track }) => {
      const activeCuesLength = getTrackActiveCuesLength(track);
      const hasCueOverlap =
        Number.isFinite(currentTime) && hasCueOverlapAtTime(track, currentTime);
      const currentCueTextLength =
        Number.isFinite(currentTime)
          ? getCurrentCueTextLength(track, currentTime)
          : 0;

      return activeCuesLength > 0 || hasCueOverlap || currentCueTextLength > 0;
    });

    const cuesBackedCandidates = candidates.filter(
      ({ track }) => getTrackCuesLength(track) > 0,
    );

    const effectiveCandidates =
      readableNowCandidates.length > 0
        ? readableNowCandidates
        : cuesBackedCandidates.length > 0
          ? cuesBackedCandidates
          : candidates;

    effectiveCandidates.sort((a, b) => {
      return (
        scoreSubtitleTrack(b.track, b.index, currentTime) -
        scoreSubtitleTrack(a.track, a.index, currentTime)
      );
    });

    return effectiveCandidates[0]?.track || null;
  }

  // secondary resolver のデバッグ用に、候補一覧とスコアを JSON 化して返す。
  function getSecondarySubtitleTrackCandidates(video, requestedLang) {
    const tracks = Array.from(video?.textTracks || []);
    const currentTime = Number(video?.currentTime ?? NaN);

    const candidates = tracks.map((track, index) => ({
      track,
      index,
      language: track?.language || "",
      canonicalLanguage: canonicalizeLanguage(track?.language),
      inferredLanguageFromLabel: inferLanguageFromLabel(track?.label),
      label: normalizeTrackLabel(track?.label),
      kind: track?.kind || "",
      mode: track?.mode || "",
      cuesLength: getTrackCuesLength(track),
      activeCuesLength: getTrackActiveCuesLength(track),
      currentCueTextLength: getCurrentCueTextLength(track, currentTime),
      matchesRequestedLanguage: matchesRequestedLanguage(track, requestedLang),
      forcedLike: isForcedLikeTrack(track),
      hasCueOverlapAtCurrentTime: hasCueOverlapAtTime(track, currentTime),
      score: scoreSubtitleTrack(track, index, currentTime),
    }));

    const subtitleCandidates = candidates.filter(
      (candidate) =>
        (candidate.kind === "subtitles" || candidate.kind === "captions") &&
        !candidate.forcedLike,
    );

    const matchedCandidates = subtitleCandidates.filter(
      (candidate) => candidate.matchesRequestedLanguage,
    );

    return (matchedCandidates.length > 0
      ? matchedCandidates
      : subtitleCandidates
    ).sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
  }

  // メニュー open / close 後の DOM 反映待ち用。
  function waitForMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // クリック候補や menu root は、見えている要素だけを対象にする。
  function isVisibleElement(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  // 共通定義から native menu 上で試す候補ラベルを取得する。
  // code 正本は canonicalize 済み値に寄せ、未定義時だけ最低限の fallback を返す。
  function getNativeMenuLanguageLabels(lang) {
    const canonicalLang = canonicalizeLanguage(lang);
    if (!canonicalLang) return [];

    const fromDefinitions =
      window.ATVB?.languageDefinitions?.getNativeMenuLabels?.(canonicalLang);

    if (Array.isArray(fromDefinitions) && fromDefinitions.length > 0) {
      return fromDefinitions
        .map((value) => normalizeTrackLabel(value))
        .filter(Boolean);
    }

    return [canonicalLang];
  }

  // Apple TV+ の再生 UI から字幕 / 音声メニューを開けるボタンを探す。
  function findSubtitleMenuButton() {
    const selectors = [
      'button[aria-label*="Subtitle" i]',
      'button[aria-label*="Subtitles" i]',
      'button[aria-label*="Captions" i]',
      'button[aria-label*="Audio" i]',
      'button[aria-label*="字幕" i]',
      'button[aria-label*="音声" i]',
      '[role="button"][aria-label*="Subtitle" i]',
      '[role="button"][aria-label*="Subtitles" i]',
      '[role="button"][aria-label*="Captions" i]',
      '[role="button"][aria-label*="字幕" i]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (isVisibleElement(el)) return el;
    }

    return null;
  }

  // menu / dialog / popover などの候補から、現在見えているルートを拾う。
  function findVisibleMenuRoot() {
    const candidates = Array.from(
      document.querySelectorAll(
        '[role="menu"], [role="dialog"], [data-testid], .menu, .popover',
      ),
    );

    return candidates.find((el) => isVisibleElement(el)) || null;
  }

  // option text 比較前に同じ整形を通し、表記差を抑える。
  function normalizeNativeMenuOptionText(value) {
    return normalizeTrackLabel(value).toLowerCase();
  }

  // CC / Closed Captions 系 option は通常字幕とは分けて扱う。
  function isClosedCaptionOptionText(value) {
    const text = normalizeNativeMenuOptionText(value);

    return (
      /\bcc\b/.test(text) ||
      /\bclosed captions?\b/.test(text) ||
      /字幕[（(]cc[）)]/.test(text)
    );
  }

  // menu 内の select 候補から、実際に字幕切替に使えそうなものを選ぶ。
  function findNativeSubtitleSelect(menuRoot) {
    if (!menuRoot) return null;

    const selects = Array.from(
      menuRoot.querySelectorAll("select.contextual-menu-item__select, select"),
    );

    return (
      selects.find((select) => {
        const optionTexts = Array.from(select.options || [])
          .map((option) => normalizeTrackLabel(option.textContent))
          .filter(Boolean);

        return optionTexts.length > 1;
      }) || null
    );
  }

  // 共通定義由来の候補ラベル群を使って option を探す。
  // 完全一致を優先し、必要なら前方一致も許容する。
  function findNativeSubtitleOption(select, lang) {
    if (!select) return null;

    const labels = getNativeMenuLanguageLabels(lang).map((value) =>
      normalizeNativeMenuOptionText(value),
    );

    if (labels.length === 0) return null;

    const matched = Array.from(select.options || []).filter((option) => {
      const text = normalizeNativeMenuOptionText(option.textContent);

      return labels.some((label) => {
        return text === label || text.startsWith(`${label} `);
      });
    });

    return (
      matched.find(
        (option) =>
          !option.disabled &&
          !isClosedCaptionOptionText(option.textContent),
      ) ||
      matched.find((option) => !option.disabled) ||
      null
    );
  }

  // Apple TV+ ネイティブメニューを開き、secondary language に合う option を選択する。
  // 見つからない場合は labelsTried / availableOptions を返して原因切り分けできるようにする。
  async function syncNativeSubtitleSelectionViaMenu({
    primaryLang = "",
    secondaryLang = "",
    preferredSource = "",
  } = {}) {
    const targetLang = secondaryLang || preferredSource || primaryLang || "";
    const normalizedTargetLang = canonicalizeLanguage(targetLang);

    if (!normalizedTargetLang) {
      return { ok: false, skipped: "empty_target_lang" };
    }

    const trigger = findSubtitleMenuButton();
    if (!trigger) {
      return {
        ok: false,
        skipped: "menu_button_not_found",
        targetLang: normalizedTargetLang,
      };
    }

    const wasExpanded =
      String(trigger.getAttribute("aria-expanded") || "").toLowerCase() ===
      "true";

    trigger.click();
    await waitForMs(300);

    const menuRoot = findVisibleMenuRoot();
    if (!menuRoot) {
      return {
        ok: false,
        skipped: "menu_not_opened",
        targetLang: normalizedTargetLang,
      };
    }

    const select = findNativeSubtitleSelect(menuRoot);
    if (!select) {
      return {
        ok: false,
        skipped: "subtitle_select_not_found",
        targetLang: normalizedTargetLang,
      };
    }

    const option = findNativeSubtitleOption(select, normalizedTargetLang);
    if (!option) {
      return {
        ok: false,
        skipped: "subtitle_option_not_found",
        targetLang: normalizedTargetLang,
        labelsTried: getNativeMenuLanguageLabels(normalizedTargetLang),
        availableOptions: Array.from(select.options || []).map((candidate) => ({
          value: candidate.value,
          text: normalizeTrackLabel(candidate.textContent),
          disabled: candidate.disabled,
          selected: candidate.selected,
        })),
      };
    }

    select.value = option.value;
    option.selected = true;

    select.dispatchEvent(
      new Event("input", {
        bubbles: true,
        composed: true,
      }),
    );

    select.dispatchEvent(
      new Event("change", {
        bubbles: true,
        composed: true,
      }),
    );

    await waitForMs(300);

    if (!wasExpanded && isVisibleElement(menuRoot)) {
      try {
        trigger.click();
        await waitForMs(150);
      } catch (_) {}
    }

    return {
      ok: true,
      targetLang: normalizedTargetLang,
      selectedLabel: normalizeTrackLabel(option.textContent),
      selectedValue: option.value,
      selectedIsCC: isClosedCaptionOptionText(option.textContent),
    };
  }

  // 実際の secondary track 選定入口。
  // DEBUG 時は候補一覧と最終選定結果をまとめて出し、選定失敗の切り分けをしやすくする。
  function resolveSecondarySubtitleTrack(video, requestedLang) {
    if (!video || !video.textTracks) return null;

    const currentTime = Number(video.currentTime ?? NaN);

    if (window.DEBUG_SECONDARY_SUBS) {
      window.ATVB?.logger?.logContent(
        "subtitle",
        "secondary resolver candidates",
        {
          requestedLang,
          currentTime,
          candidates: getSecondarySubtitleTrackCandidates(video, requestedLang),
        },
      );
    }

    const selectedTrack = pickBestSubtitleTrack(
      video.textTracks,
      requestedLang,
      currentTime,
    );

    if (!selectedTrack) {
      window.ATVB?.logger?.logContent(
        "subtitle",
        "secondary resolver selected track",
        {
          requestedLang,
          currentTime,
          selectedTrackExists: false,
        },
      );
      return null;
    }

    try {
      if (selectedTrack.mode === "disabled") {
        selectedTrack.mode = "showing";
      }
    } catch (_) {}

    const cuesLength = getTrackCuesLength(selectedTrack);
    const activeCuesLength = getTrackActiveCuesLength(selectedTrack);
    const hasCueOverlapAtCurrentTime = hasCueOverlapAtTime(
      selectedTrack,
      currentTime,
    );
    const currentCueTextLength = getCurrentCueTextLength(
      selectedTrack,
      currentTime,
    );
    const sameTrackUnreadableNow =
      cuesLength > 0 &&
      activeCuesLength === 0 &&
      !hasCueOverlapAtCurrentTime &&
      currentCueTextLength === 0;

    const trackHasNoCues = cuesLength === 0;
    const requestedTrackButEmpty =
      matchesRequestedLanguage(selectedTrack, requestedLang) && trackHasNoCues;

    if (window.DEBUG_SECONDARY_SUBS) {
      window.ATVB?.logger?.logContent(
        "subtitle",
        "secondary resolver readability",
        {
          requestedLang,
          currentTime,
          language: selectedTrack?.language ?? "",
          canonicalLanguage: canonicalizeLanguage(selectedTrack?.language),
          inferredLanguageFromLabel: inferLanguageFromLabel(selectedTrack?.label),
          label: normalizeTrackLabel(selectedTrack?.label),
          kind: selectedTrack?.kind ?? "",
          mode: selectedTrack?.mode ?? "",
          cuesLength,
          activeCuesLength,
          hasCueOverlapAtCurrentTime,
          currentCueTextLength,
          sameTrackUnreadableNow,
          trackHasNoCues,
          requestedTrackButEmpty,
        },
      );
    }

    if (requestedTrackButEmpty) {
      window.ATVB?.logger?.logContent(
        "subtitle",
        "secondary resolver pending empty requested track",
        {
          requestedLang,
          canonicalRequestedLang: canonicalizeLanguage(requestedLang),
          currentTime,
          language: selectedTrack?.language ?? "",
          canonicalLanguage: canonicalizeLanguage(selectedTrack?.language),
          inferredLanguageFromLabel: inferLanguageFromLabel(selectedTrack?.label),
          label: normalizeTrackLabel(selectedTrack?.label),
          kind: selectedTrack?.kind ?? "",
          mode: selectedTrack?.mode ?? "",
          cuesLength,
          activeCuesLength,
          hasCueOverlapAtCurrentTime,
          currentCueTextLength,
          sameTrackUnreadableNow,
          trackHasNoCues,
        },
      );
    }

    window.ATVB?.logger?.logContent(
      "subtitle",
      "secondary resolver selected track",
      {
        requestedLang,
        canonicalRequestedLang: canonicalizeLanguage(requestedLang),
        currentTime,
        language: selectedTrack?.language ?? "",
        canonicalLanguage: canonicalizeLanguage(selectedTrack?.language),
        inferredLanguageFromLabel: inferLanguageFromLabel(selectedTrack?.label),
        label: normalizeTrackLabel(selectedTrack?.label),
        kind: selectedTrack?.kind ?? "",
        mode: selectedTrack?.mode ?? "",
        cuesLength,
        activeCuesLength,
        hasCueOverlapAtCurrentTime,
        currentCueTextLength,
        sameTrackUnreadableNow,
        selectedTrackExists: true,
      },
    );

    return selectedTrack;
  }

  // primary / その他の requested subtitle でも同じ選定ロジックを再利用する。
  function resolveRequestedSubtitleTrack(
    textTracks,
    requestedLang,
    currentTime = null,
  ) {
    return pickBestSubtitleTrack(textTracks, requestedLang, currentTime);
  }

  window.ATVB.resolver = {
    normalizeTrackLabel,
    normalizeTrackLanguage,
    canonicalizeLanguage,
    inferLanguageFromLabel,
    matchesRequestedLanguage,
    isForcedLikeTrack,
    getUniqueTracks,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    hasCueOverlapAtTime,
    getCurrentCueTextLength,
    scoreSubtitleTrack,
    pickBestSubtitleTrack,
    getSecondarySubtitleTrackCandidates,
    resolveSecondarySubtitleTrack,
    resolveRequestedSubtitleTrack,
    syncNativeSubtitleSelectionViaMenu,
  };
})();

// =============================================================
// language-definitions.js - 言語定義の正本
// version: 2.6.3
// -------------------------------------------------------------
// 役割:
// - 拡張内で使う言語コード・表示ラベル・Apple TV+ ネイティブ字幕メニュー用ラベルを
//   一箇所に集約する。
// - popup / options / content(resolver) で共通の言語定義を参照できるようにする。
// - 表示上の言語名ではなく、拡張内の正本コード（例: ja, fr-FR, zh-Hant）を
//   基準に扱う。
// - Apple TV+ 側の textTrack.language や menu 表記ゆれを alias として吸収し、
//   呼び出し側に揺れを漏らさない。
// - 未リリース前提のため、旧設定との互換吸収は行わず、この定義を唯一の正本とする。
//
// このファイルのメンテナンス方針:
// - 新しい言語を追加するときは LANGUAGE_DEFINITIONS に1件追加する。
// - code は拡張内の正本値として扱い、popup / options / settings 保存値もこれに揃える。
// - label は拡張UI上の表示文字列として扱う。今回方針では code と同じ値を表示する。
// - nativeMenuLabels は Apple TV+ の字幕メニューから該当 option / menu item を
//   探すための候補文字列として使う。
// - aliases は textTrack.language, track.label, 将来の補助判定などで使う入力揺れ吸収用。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  // 比較用に大小文字・前後空白・区切り文字ゆれを吸収する。
  function normalizeLanguageKey(value) {
    return String(value || "")
      .trim()
      .replace(/_/g, "-")
      .toLowerCase();
  }

  // 比較用 alias 配列を正規化して重複除去する。
  function buildAliasList(...values) {
    const seen = new Set();
    const result = [];

    values
      .flat()
      .map((value) => normalizeLanguageKey(value))
      .filter(Boolean)
      .forEach((value) => {
        if (seen.has(value)) return;
        seen.add(value);
        result.push(value);
      });

    return Object.freeze(result);
  }

  // Apple TV+ ネイティブメニュー候補も重複なく保持する。
  function buildNativeMenuLabels(...values) {
    const seen = new Set();
    const result = [];

    values
      .flat()
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .forEach((value) => {
        const key = normalizeLanguageKey(value);
        if (seen.has(key)) return;
        seen.add(key);
        result.push(value);
      });

    return Object.freeze(result);
  }

  // 定義1件を正規化して、比較しやすい形に揃える。
  function createLanguageDefinition({
    code,
    label,
    nativeMenuLabels = [],
    aliases = [],
  }) {
    return Object.freeze({
      code: String(code || "").trim(),
      label: String(label || code || "").trim(),
      nativeMenuLabels: buildNativeMenuLabels(nativeMenuLabels),
      aliases: buildAliasList(code, label, aliases, nativeMenuLabels),
    });
  }

  // 拡張内で使う言語定義の正本。
  // code: 保存値 / UI表示 / resolver比較の基準
  // label: popup / options 上の表示文字列
  // nativeMenuLabels: Apple TV+ のネイティブ字幕メニューで探す候補
  // aliases: textTrack.language や入力揺れの吸収用
  const LANGUAGE_DEFINITIONS = Object.freeze([
    createLanguageDefinition({
      code: "en",
      label: "en",
      nativeMenuLabels: ["English", "英語"],
      aliases: [
        "eng",
        "english",
        "en-us",
        "en-gb",
        "en-au",
        "en-ca",
      ],
    }),
    createLanguageDefinition({
      code: "ja",
      label: "ja",
      nativeMenuLabels: ["日本語", "Japanese"],
      aliases: [
        "jpn",
        "japanese",
        "ja-jp",
        "日本語",
      ],
    }),
    createLanguageDefinition({
      code: "ko",
      label: "ko",
      nativeMenuLabels: ["韓国語", "Korean", "한국어"],
      aliases: [
        "kor",
        "korean",
        "ko-kr",
        "한국어",
        "韓国語",
      ],
    }),
    createLanguageDefinition({
      code: "fr-FR",
      label: "fr-FR",
      nativeMenuLabels: [
        "フランス語 (フランス)",
        "French (France)",
        "Français (France)",
      ],
      aliases: [
        "fra-fr",
        "fre-fr",
        "france-french",
        "french-france",
        "français-france",
        "français (france)",
        "fr-fr",
        "フランス語 (フランス)",
      ],
    }),
    createLanguageDefinition({
      code: "fr-CA",
      label: "fr-CA",
      nativeMenuLabels: [
        "フランス語 (カナダ)",
        "French (Canada)",
        "Français (Canada)",
      ],
      aliases: [
        "fra-ca",
        "fre-ca",
        "canada-french",
        "french-canada",
        "français-canada",
        "français (canada)",
        "fr-ca",
        "フランス語 (カナダ)",
      ],
    }),
    createLanguageDefinition({
      code: "de",
      label: "de",
      nativeMenuLabels: ["ドイツ語", "German", "Deutsch"],
      aliases: [
        "deu",
        "german",
        "deutsch",
        "de-de",
        "ドイツ語",
      ],
    }),
    createLanguageDefinition({
      code: "es-ES",
      label: "es-ES",
      nativeMenuLabels: [
        "スペイン語 (スペイン)",
        "Spanish (Spain)",
        "Español (España)",
      ],
      aliases: [
        "spa-es",
        "spanish-spain",
        "español-españa",
        "español (españa)",
        "es-es",
        "スペイン語 (スペイン)",
      ],
    }),
    createLanguageDefinition({
      code: "es-419",
      label: "es-419",
      nativeMenuLabels: [
        "スペイン語 (ラテンアメリカ)",
        "Spanish (Latin America)",
        "Español (Latinoamérica)",
      ],
      aliases: [
        "spa-419",
        "es-latam",
        "es-la",
        "spanish-latin-america",
        "español-latinoamérica",
        "español (latinoamérica)",
        "latin-american-spanish",
        "es-419",
        "スペイン語 (ラテンアメリカ)",
      ],
    }),
    createLanguageDefinition({
      code: "pt-PT",
      label: "pt-PT",
      nativeMenuLabels: [
        "ポルトガル語",
        "Portuguese",
        "Portuguese (Portugal)",
        "Português (Portugal)",
      ],
      aliases: [
        "por-pt",
        "pt-pt",
        "pt",
        "portuguese",
        "portuguese-portugal",
        "português",
        "português-portugal",
        "ポルトガル語",
      ],
    }),
    createLanguageDefinition({
      code: "pt-BR",
      label: "pt-BR",
      nativeMenuLabels: [
        "ポルトガル語 (ブラジル)",
        "Portuguese (Brazil)",
        "Português (Brasil)",
      ],
      aliases: [
        "por-br",
        "pt-br",
        "portuguese-brazil",
        "português-brasil",
        "ポルトガル語 (ブラジル)",
      ],
    }),
    createLanguageDefinition({
      code: "zh-Hans",
      label: "zh-Hans",
      nativeMenuLabels: [
        "中国語 (簡体字)",
        "Chinese (Simplified)",
        "简体中文",
      ],
      aliases: [
        "zh",
        "zho",
        "chi",
        "zh-hans",
        "zh-cn",
        "zh-sg",
        "zho-hans",
        "chi-hans",
        "chinese",
        "chinese-simplified",
        "simplified-chinese",
        "中国語 (簡体字)",
        "简体中文",
      ],
    }),
    createLanguageDefinition({
      code: "zh-Hant",
      label: "zh-Hant",
      nativeMenuLabels: [
        "中国語 (繁体字)",
        "Chinese (Traditional)",
        "繁體中文",
      ],
      aliases: [
        "zh-hant",
        "zh-tw",
        "zh-hk",
        "zho-hant",
        "chi-hant",
        "chinese-traditional",
        "traditional-chinese",
        "中國語 (繁體字)",
        "中国語 (繁体字)",
        "繁體中文",
      ],
    }),
    createLanguageDefinition({
      code: "yue-Hant",
      label: "yue-Hant",
      nativeMenuLabels: [
        "広東語 (繁体字)",
        "Cantonese (Traditional)",
        "粵語",
      ],
      aliases: [
        "yue",
        "yue-hant",
        "cantonese",
        "cantonese-traditional",
        "粵語",
        "広東語",
        "広東語 (繁体字)",
      ],
    }),
  ]);

  // code -> 定義オブジェクトを即参照できるようにする。
  const LANGUAGE_DEFINITION_MAP = Object.freeze(
    Object.fromEntries(
      LANGUAGE_DEFINITIONS.map((definition) => [definition.code, definition]),
    ),
  );

  // 完全一致で正本 code を引く。
  function getLanguageDefinitionByCode(code) {
    if (!code) return null;
    return LANGUAGE_DEFINITION_MAP[String(code).trim()] || null;
  }

  // code / alias / nativeMenuLabels / label を含めて、入力値から定義を引く。
  function findLanguageDefinition(input) {
    const normalizedInput = normalizeLanguageKey(input);
    if (!normalizedInput) return null;

    for (const definition of LANGUAGE_DEFINITIONS) {
      if (normalizeLanguageKey(definition.code) === normalizedInput) {
        return definition;
      }

      if (
        Array.isArray(definition.aliases) &&
        definition.aliases.includes(normalizedInput)
      ) {
        return definition;
      }

      if (
        Array.isArray(definition.nativeMenuLabels) &&
        definition.nativeMenuLabels.some(
          (label) => normalizeLanguageKey(label) === normalizedInput,
        )
      ) {
        return definition;
      }

      if (normalizeLanguageKey(definition.label) === normalizedInput) {
        return definition;
      }
    }

    return null;
  }

  // 入力値を拡張内の正本 code へ正規化する。
  // 一致定義がなければ空文字を返す。
  function canonicalizeLanguageCode(input) {
    const definition = findLanguageDefinition(input);
    return definition?.code || "";
  }

  // popup / options 用の一覧データを返す。
  // 表示も code に統一したい方針なので label をそのまま使う。
  function getSupportedLanguages() {
    return LANGUAGE_DEFINITIONS.map((definition) => ({
      code: definition.code,
      label: definition.label,
    }));
  }

  // Apple TV+ ネイティブ字幕メニューで探す候補文字列を返す。
  function getNativeMenuLabels(input) {
    const definition = findLanguageDefinition(input);
    if (!definition) return [];
    return Array.isArray(definition.nativeMenuLabels)
      ? [...definition.nativeMenuLabels]
      : [];
  }

  // 呼び出し側から使う公開 API。
  window.ATVB.languageDefinitions = Object.freeze({
    LANGUAGE_DEFINITIONS,
    LANGUAGE_DEFINITION_MAP,
    normalizeLanguageKey,
    getLanguageDefinitionByCode,
    findLanguageDefinition,
    canonicalizeLanguageCode,
    getSupportedLanguages,
    getNativeMenuLabels,
  });
})();

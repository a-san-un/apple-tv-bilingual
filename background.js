// =============================================================
// background.js - Service Worker (v2.5)
// =============================================================
// Routes all external API calls (CORS-blocked from tv.apple.com):
//   FETCH_DICT    — Free Dictionary API + Jisho + EJDict (parallel)
//   FETCH_TATOEBA — Tatoeba API (English sentences + Japanese translations)
//   FETCH_TRANSLATE — Google Translate
// =============================================================

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ATV-Bilingual] background.js v2.5 installed/updated');
});

// -------------------------------------------------------
// EJDict — local bundled dictionary (loaded once)
// -------------------------------------------------------
let _ejdict = null;

async function loadEJDict() {
  if (_ejdict) return _ejdict;
  const url  = self.registration.scope + 'dict/ejdict.txt';
  const text = await fetch(url).then(r => r.text());
  _ejdict = new Map();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const word = line.slice(0, tab).trim().toLowerCase();
    const def  = line.slice(tab + 1).trim();
    if (word && def) _ejdict.set(word, def);
  }
  return _ejdict;
}

async function ejdictLookup(word) {
  const dict = await loadEJDict();
  return dict.get(word.toLowerCase().trim()) ?? null;
}

// -------------------------------------------------------
// Part-of-speech label (English → Japanese)
// -------------------------------------------------------
const POS_JA = {
  'noun':         '名詞',
  'verb':         '動詞',
  'adjective':    '形容詞',
  'adverb':       '副詞',
  'preposition':  '前置詞',
  'conjunction':  '接続詞',
  'pronoun':      '代名詞',
  'interjection': '間投詞',
  'exclamation':  '感嘆詞',
  'article':      '冠詞',
  'abbreviation': '略語',
  'numeral':      '数詞',
  'suffix':       '接尾辞',
  'prefix':       '接頭辞',
};

function posJa(pos) {
  return POS_JA[pos.toLowerCase()] ?? pos;
}

// -------------------------------------------------------
// Jisho — reading, JLPT, isCommon
// -------------------------------------------------------
async function fetchJisho(word) {
  const r = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`);
  const data = await r.json();
  const entry = data.data?.[0];
  if (!entry) return {};
  const jlptRaw = entry.jlpt?.[0] ?? '';
  return {
    reading:  entry.japanese?.[0]?.reading ?? '',
    jlpt:     jlptRaw ? jlptRaw.replace('jlpt-', '').toUpperCase() : '',
    isCommon: entry.is_common ?? false,
  };
}

// -------------------------------------------------------
// Free Dictionary API — POS, definitions, examples per POS
// -------------------------------------------------------
async function fetchFreeDictionary(word) {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!r.ok) return null;
  const data = await r.json();
  const entry = data[0];
  if (!entry) return null;

  // phonetic (prefer entry with audio)
  const phonetics = entry.phonetics ?? [];
  const phonetic  = (phonetics.find(p => p.text && p.audio) ?? phonetics.find(p => p.text))?.text
                 ?? entry.phonetic ?? '';

  // meanings: [{pos, posJa, examples:[{text}]}]
  const meanings = (entry.meanings ?? []).map(m => {
    const examples = [];
    for (const def of m.definitions ?? []) {
      if (def.example) {
        const ex = def.example.trim();
        if (ex) examples.push({ text: ex.charAt(0).toUpperCase() + ex.slice(1) });
      }
      if (examples.length >= 5) break;
    }
    return {
      pos:    m.partOfSpeech,
      posJa:  posJa(m.partOfSpeech),
      examples,
    };
  }).filter(m => m.examples.length > 0);

  return { phonetic, meanings };
}

// -------------------------------------------------------
// Google Translate — batch translate array of strings
// -------------------------------------------------------
async function batchTranslate(texts) {
  if (!texts.length) return [];
  const joined  = texts.join('\n');
  const url     = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=${encodeURIComponent(joined)}`;
  const r       = await fetch(url);
  const data    = await r.json();
  const full    = data[0].map(x => x[0]).join('');
  const parts   = full.split('\n');
  while (parts.length < texts.length) parts.push('');
  return parts.slice(0, texts.length);
}

// -------------------------------------------------------
// Message handler
// -------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ---------- FETCH_DICT ----------
  if (msg.type === 'FETCH_DICT') {
    (async () => {
      try {
        const word = msg.word;

        // Parallel: Free Dictionary + Jisho + EJDict
        const [freeDictResult, jishoResult, ejdictRaw] = await Promise.all([
          fetchFreeDictionary(word).catch(() => null),
          fetchJisho(word).catch(() => ({})),
          ejdictLookup(word).catch(() => null),
        ]);

        if (!freeDictResult && !ejdictRaw) {
          sendResponse({ ok: false, error: 'not_found' });
          return;
        }

        // Collect all example texts for batch translation
        const allExamples = [];
        if (freeDictResult) {
          for (const m of freeDictResult.meanings) {
            for (const ex of m.examples) allExamples.push(ex.text);
          }
        }

        // Batch translate examples
        const translations = allExamples.length
          ? await batchTranslate(allExamples).catch(() => allExamples.map(() => ''))
          : [];

        // Attach translations back to examples
        let idx = 0;
        if (freeDictResult) {
          for (const m of freeDictResult.meanings) {
            for (const ex of m.examples) {
              ex.ja = translations[idx++] ?? '';
            }
          }
        }

        sendResponse({
          ok:       true,
          word,
          phonetic: freeDictResult?.phonetic ?? '',
          meanings: freeDictResult?.meanings ?? [],
          ejdict:   ejdictRaw ?? '',
          reading:  jishoResult.reading  ?? '',
          jlpt:     jishoResult.jlpt     ?? '',
          isCommon: jishoResult.isCommon ?? false,
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // ---------- FETCH_TATOEBA ----------
  if (msg.type === 'FETCH_TATOEBA') {
    (async () => {
      try {
        const url  = `https://api.tatoeba.org/unstable/sentences?q=${encodeURIComponent(msg.word)}&lang=eng&trans:lang=jpn`;
        const r    = await fetch(url);
        const data = await r.json();
        const results = (data.data ?? []).slice(0, 5).map(s => ({
          text:        s.text ?? '',
          translation: s.translations?.[0]?.[0]?.text ?? '',
        })).filter(x => x.text);
        sendResponse({ ok: true, results });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // ---------- FETCH_TRANSLATE ----------
  if (msg.type === 'FETCH_TRANSLATE') {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(msg.text)}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const translated = data[0].map(x => x[0]).join('');
        sendResponse({ ok: true, translated });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

});

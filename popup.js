
// =====================================================
// Apple TV+ Bilingual Subtitles - popup.js
// =====================================================

const DEFAULT_LANGS = [
  { lang: 'en',      label: 'English' },
  { lang: 'ja',      label: '日本語' },
  { lang: 'zh-Hans', label: '中文（简体）' },
  { lang: 'zh-Hant', label: '中文（繁體）' },
  { lang: 'ko',      label: '한국어' },
  { lang: 'fr-FR',   label: 'Français' },
  { lang: 'de',      label: 'Deutsch' },
  { lang: 'es-ES',   label: 'Español' },
  { lang: 'it',      label: 'Italiano' },
  { lang: 'pt-BR',   label: 'Português (Brasil)' },
  { lang: 'ru',      label: 'Русский' },
];

const primarySel   = document.getElementById('primaryLang');
const secondarySel = document.getElementById('secondaryLang');
const applyBtn     = document.getElementById('apply');
const apiKeyInput  = document.getElementById('apiKey');
const statusEl     = document.getElementById('status');

// Build select options
function buildOptions(langs, selectedLang) {
  return langs.map(l =>
    `<option value="${l.lang}" ${l.lang === selectedLang ? 'selected' : ''}>${l.label}</option>`
  ).join('');
}

// Try to get live language list from content script
function loadLanguages(primaryLang, secondaryLang) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return useFallback(primaryLang, secondaryLang);

    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_LANGUAGES' }, (langs) => {
      if (chrome.runtime.lastError || !langs || langs.length === 0) {
        useFallback(primaryLang, secondaryLang);
        return;
      }
      primarySel.innerHTML   = buildOptions(langs, primaryLang);
      secondarySel.innerHTML = buildOptions(langs, secondaryLang);
    });
  });
}

function useFallback(primaryLang, secondaryLang) {
  primarySel.innerHTML   = buildOptions(DEFAULT_LANGS, primaryLang);
  secondarySel.innerHTML = buildOptions(DEFAULT_LANGS, secondaryLang);
  statusEl.textContent   = '※ TV+の動画ページで開いてください';
}

// Load saved settings
chrome.storage.local.get(['primaryLang', 'secondaryLang', 'apiKey'], (result) => {
  const primary   = result.primaryLang   || 'en';
  const secondary = result.secondaryLang || 'ja';
  apiKeyInput.value = result.apiKey || '';
  loadLanguages(primary, secondary);
});

// Apply button
applyBtn.addEventListener('click', () => {
  const primaryLang   = primarySel.value;
  const secondaryLang = secondarySel.value;
  const apiKey        = apiKeyInput.value.trim();

  if (primaryLang === secondaryLang) {
    statusEl.textContent = '⚠ 同じ言語は選べません';
    statusEl.className = 'err';
    return;
  }

  chrome.storage.local.set({ primaryLang, secondaryLang, apiKey }, () => {
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SETTINGS_CHANGED',
          primaryLang,
          secondaryLang,
          apiKey
        });
      }
    });
    statusEl.textContent = '✓ 適用しました';
    statusEl.className = 'ok';
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 2000);
  });
});

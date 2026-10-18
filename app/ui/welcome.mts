import * as S from '../shared/settings.mts';
import type { Consent, StoredSettings, UiLanguage } from '../shared/types.mts';
import { t, applyI18n, initLang } from './i18n.mts';
import { byId, selectById } from './page-dom.mts';

const state = byId('state');
const lang = selectById('uiLanguage');

async function show(): Promise<void> {
  applyI18n(document);
  const { consent, settings } = await chrome.storage.local.get(['consent', 'settings']);
  const answered = S.answered(consent);
  state.hidden = !answered;
  state.textContent = answered ? t(S.granted(consent) ? 'welcome.state.granted' : 'welcome.state.declined') : '';
  lang.value = S.withDefaults(settings).uiLanguage;
}

async function answer(fn: (stored: unknown, now: number) => { settings: StoredSettings; consent: Consent }) {
  const { settings } = await chrome.storage.local.get('settings');
  const r = fn(settings, Date.now());
  await chrome.storage.local.set({ settings: r.settings, consent: r.consent });
  await show();
}

byId('agree').addEventListener('click', () => {
  answer(S.grant).catch(() => {});
});
byId('decline').addEventListener('click', () => {
  answer(S.decline).catch(() => {});
});
lang.addEventListener('change', () => {
  chrome.storage.local
    .get('settings')
    .then(({ settings }) =>
      chrome.storage.local.set({ settings: S.patchSettings(settings, { uiLanguage: lang.value as UiLanguage }) }),
    )
    .catch(() => {});
});
initLang(() => {
  show().catch(() => {});
})
  .then(show)
  .catch(() => {});

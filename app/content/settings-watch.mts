import { resolveLang, setLang } from '../ui/i18n.mts';
import type { EffectiveSettings } from '../shared/settings.mts';

type Chrome = typeof chrome;

export const isTrue = (x: unknown) => x === true;

export function applyUiLanguage(chrome: Pick<Chrome, 'i18n'>, settings: EffectiveSettings): void {
  let ui = 'en';

  try {
    ui = chrome.i18n.getUILanguage();
  } catch {
    /* keep en */
  }

  setLang(resolveLang(settings.uiLanguage, ui));
}

export function watchSettings(chrome: Pick<Chrome, 'storage'>, apply: (stored: unknown) => void): void {
  try {
    chrome.storage.local
      .get('settings')
      .then((r) => {
        apply(r.settings);
      })
      .catch(() => {});
  } catch {
    /* extension reloaded */
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'settings' in changes) apply(changes.settings.newValue);
    });
  } catch {
    /* extension reloaded */
  }
}

import * as S from '../shared/settings.mts';
import { OWN, THIRD_PARTY, REFERENCES, mitText, ownNotice, type ThirdParty } from '../shared/third-party.mts';
import type { UiLanguage } from '../shared/types.mts';
import { t, applyI18n, initLang } from './i18n.mts';
import { byId, selectById } from './page-dom.mts';

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text?: string | null,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;

  return e;
}

function card(doc: Document, item: ThirdParty, use: string): HTMLElement {
  const box = el(doc, 'section', null, 'lic');
  box.dataset.id = item.id;
  const head = el(doc, 'div', null, 'lic-head');
  head.append(el(doc, 'span', item.name, 'lic-name'));
  if (item.version) head.append(el(doc, 'span', item.version, 'muted'));
  head.append(el(doc, 'span', item.license, 'lic-tag'));
  box.append(head);
  if (use) box.append(el(doc, 'p', use, 'muted'));

  if (item.url) {
    const p = el(doc, 'p');
    const a = el(doc, 'a', item.url);
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    p.append(a);
    box.append(p);
  }

  const d = el(doc, 'details');
  d.append(el(doc, 'summary', t('lic.showText')), el(doc, 'pre', mitText(item.copyright), 'license-text'));
  box.append(d);

  return box;
}

function ownCard(doc: Document): HTMLElement {
  const box = el(doc, 'section', null, 'lic');
  box.dataset.id = 'own';
  const head = el(doc, 'div', null, 'lic-head');
  head.append(el(doc, 'span', OWN.name, 'lic-name'), el(doc, 'span', OWN.license, 'lic-tag'));
  box.append(head, el(doc, 'pre', ownNotice(), 'license-text'));
  const d = el(doc, 'details');
  const text = el(doc, 'pre', null, 'license-text');
  const link = el(doc, 'a', OWN.file);
  link.href = OWN.file;
  link.target = '_blank';
  const p = el(doc, 'p');
  p.append(link);
  d.append(el(doc, 'summary', t('lic.showText')), p, text);
  d.addEventListener('toggle', () => {
    if (!d.open || text.textContent || typeof fetch !== 'function') return;
    fetch(OWN.file)
      .then((r) => r.text())
      .then((s) => {
        text.textContent = s;
      })
      .catch(() => {
        text.remove();
      });
  });
  box.append(d);

  return box;
}

const idOf = (d: Element) => d.closest<HTMLElement>('.lic')?.dataset.id;

function render(doc: Document): void {
  applyI18n(doc);
  const open = new Set([...doc.querySelectorAll('.lic details[open]')].map(idOf));
  byId('own', doc).replaceChildren(ownCard(doc));

  for (const group of ['bundled', 'informed']) {
    byId(group, doc).replaceChildren(
      ...THIRD_PARTY.filter((x) => x.group === group).map((x) => card(doc, x, t(`lic.use.${x.id}`))),
    );
  }

  byId('refs', doc).replaceChildren(...REFERENCES.map((r) => el(doc, 'li', t(`lic.ref.${r}`))));
  for (const d of doc.querySelectorAll<HTMLDetailsElement>('.lic details')) if (open.has(idOf(d))) d.open = true;
}

async function init(): Promise<void> {
  const doc = document;
  await initLang(() => {
    render(doc);
  });
  const lang = selectById('uiLanguage', doc);
  lang.value = S.withDefaults((await chrome.storage.local.get('settings')).settings).uiLanguage;
  lang.addEventListener('change', () => {
    chrome.storage.local
      .get('settings')
      .then(({ settings }) =>
        chrome.storage.local.set({ settings: S.patchSettings(settings, { uiLanguage: lang.value as UiLanguage }) }),
      )
      .catch(() => {});
  });
  render(doc);
}

// The Node tests import render() without an extension around it.
if (typeof chrome !== 'undefined' && (chrome as Partial<typeof chrome>).storage) init().catch(() => {});

export { render };

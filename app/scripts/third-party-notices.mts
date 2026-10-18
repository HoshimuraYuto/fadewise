import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWN, THIRD_PARTY, REFERENCES, mitText } from '../shared/third-party.mts';
import { DICT } from '../ui/i18n.mts';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NOTICES = path.join(APP, 'public', 'THIRD_PARTY_NOTICES.md');

const en = DICT.en;
const HEADER = [
  '# Third-party notices',
  '',
  `Generated from \`shared/third-party.mts\` by \`scripts/third-party-notices.mts\`; the extension shows the same list on its Licenses page (licenses.html).`,
  '',
  `${OWN.name} itself: ${OWN.license}, ${OWN.copyright} (full text in ${OWN.file}). The software below keeps its own licence.`,
  '',
];

function entry(x: (typeof THIRD_PARTY)[number]): string[] {
  return [
    `### ${x.name}${x.version ? ' ' + x.version : ''}`,
    '',
    x.url ?? '',
    '',
    en[`lic.use.${x.id}`] + (x.note ? ' ' + x.note : ''),
    '',
    '```',
    mitText(x.copyright),
    '```',
    '',
  ];
}

function section(title: string, group: string): string[] {
  return [`## ${title}`, '', ...THIRD_PARTY.filter((x) => x.group === group).flatMap(entry)];
}

export function noticesMarkdown(): string {
  const references = REFERENCES.map((r) => `- ${en[`lic.ref.${r}`]}`);

  return [
    ...HEADER,
    ...section(en['lic.h2Bundled'], 'bundled'),
    ...section(en['lic.h2Informed'], 'informed'),
    `## ${en['lic.h2Refs']}`,
    '',
    ...references,
    '',
  ].join('\n');
}

function check(md: string): void {
  const same = fs.existsSync(NOTICES) && fs.readFileSync(NOTICES, 'utf8') === md;
  console.log(same ? 'up to date' : 'differs: run node scripts/third-party-notices.mts');
  process.exit(same ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const md = noticesMarkdown();
  if (process.argv.includes('--check')) check(md);
  fs.writeFileSync(NOTICES, md);
  console.log('wrote', path.relative(APP, NOTICES));
}

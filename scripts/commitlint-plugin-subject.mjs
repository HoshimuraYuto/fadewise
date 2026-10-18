// base forms only: "-ed" / "-s" forms after "and" are usually nouns or adjectives
export const VERBS = new Set(
  `
  add adjust align allow apply ask avoid block bring build bump cache call cancel cap catch change check clean
  clear close collect compare copy count cover create cut declare default delete describe detect disable document
  drop enable end ensure explain export extract fill filter fix flag format gate give guard handle hide hold
  ignore import improve include inline install keep label let limit list load log lower make mark measure merge
  migrate move name note open pass pick pin plan play prefer prepare prevent print pull put raise read rebuild
  record reduce refactor remove rename render reorder replace report require reset resolve restore retry return
  reuse reword rewrite route run save scope seek select send set share show simplify skip sort split start stop
  store strip support switch take tell test tidy track translate trim try turn unify update upgrade use validate
  verify wait warn wire wrap write
`
    .trim()
    .split(/\s+/),
);

// also nouns ("seek bar", "logs and report"): a verb only when an object marker follows
export const NOUN_TOO = new Set(
  `
  block build bump cache call cap catch change check close copy count cover cut default drop end export fill
  filter flag format gate guard hold import label limit list load log mark measure name note open pass pick pin
  plan play print record reorder report return route run save scope seek set share show skip sort start stop
  store support switch test track trim try turn update upgrade use wait wrap
`
    .trim()
    .split(/\s+/),
);

const OBJECT_MARKERS = new Set(
  'the a an it its them their this that these those every each all both no any some which what how where'.split(' '),
);

export function joinedAction(subject) {
  const words = subject.toLowerCase().match(/[a-z][a-z'-]*|,/g) ?? [];

  for (let i = 0; i < words.length; i++) {
    if (words[i] !== 'and') continue;

    let j = i + 1;

    if (words[j] === 'then' || words[j] === 'also') j++;

    const verb = words[j];

    if (!VERBS.has(verb)) continue;

    if (NOUN_TOO.has(verb) && !OBJECT_MARKERS.has(words[j + 1])) continue;

    return `and ${words.slice(i + 1, j + 1).join(' ')}`;
  }

  return null;
}

export default {
  rules: {
    'subject-one-action': (parsed, when = 'always') => {
      const hit = parsed.subject ? joinedAction(parsed.subject) : null;
      const ok = hit === null;

      return [when === 'never' ? !ok : ok, `subject joins two actions with "${hit}"; make it two commits`];
    },
  },
};

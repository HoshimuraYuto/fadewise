const REFERENCE = /\b(?:verification|spikes?)(?:\s*\/\s*|\s+|-)\d+|§\s*\d+|\bdecisions(?:\.md)?\s*#?\s*\d+/i;

const DIRECTIVE =
  /^\s*(?:eslint|oxlint|global\b|globals\b|exported\b|@ts-|prettier-ignore|c8\b|istanbul\b|#region|#endregion|\/\s*<reference)/;

const LICENSE = /\b(?:license|licence|copyright|spdx-license-identifier)\b|^!/i;

const skipped = (c) => DIRECTIVE.test(c.value) || LICENSE.test(c.value);

const noRecordReference = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow verification, spike and decisions section numbers in comments' },
    messages: {
      reference:
        'Comments do not point at verification runs, spikes or decisions sections ("{{ text }}"); say the reason itself.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const c of context.sourceCode.getAllComments()) {
          if (DIRECTIVE.test(c.value)) continue;

          const m = REFERENCE.exec(c.value);

          if (m) context.report({ loc: c.loc, messageId: 'reference', data: { text: m[0] } });
        }
      },
    };
  },
};

function commentGroups(source) {
  const groups = [];

  for (const c of source.getAllComments()) {
    if (skipped(c)) continue;

    const before = source.getTokenBefore(c, { includeComments: true });
    const ownLine = !before || before.loc.end.line < c.loc.start.line;
    const last = groups.at(-1);
    const joins =
      c.type === 'Line' && ownLine && last?.type === 'Line' && last.ownLine && last.end.line + 1 === c.loc.start.line;

    if (joins) last.end = c.loc.end;
    else groups.push({ type: c.type, ownLine, start: c.loc.start, end: c.loc.end });
  }

  return groups;
}

const oneLine = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Allow comments of one line only; a longer explanation belongs in a document' },
    messages: {
      long: 'A comment is one line; move a longer explanation into docs/ (this one spans {{ lines }} lines).',
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const g of commentGroups(context.sourceCode)) {
          const lines = g.end.line - g.start.line + 1;

          if (lines > 1) context.report({ loc: { start: g.start, end: g.end }, messageId: 'long', data: { lines } });
        }
      },
    };
  },
};

export default {
  meta: { name: 'local-comments' },
  rules: { 'no-record-reference': noRecordReference, 'one-line': oneLine },
};

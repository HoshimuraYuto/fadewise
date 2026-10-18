import { describe, it } from 'node:test';
import { RuleTester } from 'oxlint/plugins-dev';
import plugin from './oxlint-plugin-comments.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { sourceType: 'module' } });
const { 'no-record-reference': noRecordReference, 'one-line': oneLine } = plugin.rules;

tester.run('no-record-reference', noRecordReference, {
  valid: [
    '// the queue is read at most once a second',
    '// 5 s blocks of song position (verification builds only)',
    '/* eslint-disable no-console -- verification/12 output */',
    '// oxlint-disable-next-line no-console -- verification/12 output',
    'const s = "see verification/12"; // a string, not a comment',
  ],
  invalid: [
    { code: '// measured in verification/46', errors: [{ messageId: 'reference' }] },
    { code: '// as in verification 46', errors: [{ messageId: 'reference' }] },
    { code: '// spikes/09 showed this', errors: [{ messageId: 'reference' }] },
    { code: '// see spike 13', errors: [{ messageId: 'reference' }] },
    { code: '// decisions §38', errors: [{ messageId: 'reference' }] },
    { code: '/* §41: gain hold */', errors: [{ messageId: 'reference' }] },
    { code: 'f(); // (verification-51)', errors: [{ messageId: 'reference' }] },
  ],
});

tester.run('one-line', oneLine, {
  valid: [
    '// one line\nconst a = 1;',
    '// first\nconst a = 1;\n// second\nconst b = 2;',
    'const a = 1; // trailing\nconst b = 2; // trailing too',
    '// a comment\n\n// another comment after a blank line',
    '/* one-line block */',
    '/*\n * Copyright (c) 2020 Someone\n * MIT License\n */',
    '/*! keep this banner\n * as it is */',
    '// eslint-disable-next-line no-console\n// a reason\nconsole.log(1);',
  ],
  invalid: [
    { code: '// first line\n// second line\nconst a = 1;', errors: [{ messageId: 'long', data: { lines: 2 } }] },
    {
      code: 'function f() {\n  // a\n  // b\n  // c\n  return 1;\n}',
      errors: [{ messageId: 'long', data: { lines: 3 } }],
    },
    { code: '/*\n * two\n * lines\n */', errors: [{ messageId: 'long', data: { lines: 4 } }] },
    { code: '/** jsdoc\n * spread out */\nfunction f() {}', errors: [{ messageId: 'long', data: { lines: 2 } }] },
  ],
});

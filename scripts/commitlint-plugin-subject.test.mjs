import test from 'node:test';
import assert from 'node:assert';
import plugin, { joinedAction } from './commitlint-plugin-subject.mjs';

const rule = plugin.rules['subject-one-action'];

test('passes one action with parallel objects', () => {
  for (const s of [
    'set up prettier, lefthook and commitlint',
    'add blank lines around blocks, functions and returns',
    'measure the blend loudness before and after the gain hold and sum cap',
    'keep the gain and the fade stage at unity during ads',
    'record the gain hold and the blend sum cap',
    'cap the sum while both tracks sound',
    'format the README, privacy policy and store listing',
    'add the experimental overlap setting to the popup and seek bar',
    'add tempo and key verification scripts, logs and report',
    'record the trademark and name check',
    'record the decision to ship auto-advance and reorder, both off by default',
  ])
    assert.strictEqual(joinedAction(s), null, s);
});

test('stops "and" before a second action', () => {
  for (const [s, hit] of [
    ['add the meter and fix the fade', 'and fix'],
    ['rename the module and update its imports', 'and update'],
    ['split player-main, and move the tests', 'and move'],
    ['fix the drift and then record it', 'and then record'],
    ['Add X And Remove Y', 'and remove'],
    ['press next and read repeat mode in the miniplayer layout', 'and read'],
    ['publish the privacy policy and record the pre-publication scan', 'and record'],
    ['mark finished items and list the remaining user steps', 'and list'],
  ])
    assert.strictEqual(joinedAction(s), hit, s);
});

test('the rule result follows commitlint (valid, message)', () => {
  assert.deepStrictEqual(rule({ subject: 'add a and b' })[0], true);
  assert.deepStrictEqual(rule({ subject: 'add a and drop the b' })[0], false);
  assert.match(rule({ subject: 'add a and drop the b' })[1], /and drop/);
  assert.deepStrictEqual(rule({ subject: 'add a and remove b' })[0], false);
  assert.deepStrictEqual(rule({ subject: null })[0], true);
});

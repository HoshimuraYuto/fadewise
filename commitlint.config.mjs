import subject from './scripts/commitlint-plugin-subject.mjs';

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [subject],
  rules: { 'subject-one-action': [2, 'always'] },
};

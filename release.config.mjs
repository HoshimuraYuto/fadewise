export default {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    [
      '@semantic-release/exec',
      {
        // WXT takes the manifest version from app/package.json
        prepareCmd:
          'pnpm --filter fadewise exec npm version ${nextRelease.version} --no-git-tag-version --allow-same-version && pnpm zip',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['app/package.json', 'CHANGELOG.md'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [{ path: 'app/.output/fadewise-*-chrome.zip', label: 'Chrome extension (zip)' }],
      },
    ],
  ],
};

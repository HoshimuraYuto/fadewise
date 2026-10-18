export interface ThirdParty {
  id: string;
  // 'informed': numbers or selectors taken over, no code copied
  group: 'bundled' | 'informed';
  name: string;
  version?: string | null;
  npm?: string;
  vendor?: string;
  url?: string;
  license?: string;
  copyright: string;
  note?: string;
}
export interface OwnLicense {
  name: string;
  license: string;
  copyright: string;
  file: string;
  url: string;
}
export const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export const mitText = (copyright: string): string => `MIT License\n\n${copyright}\n\n${MIT_BODY}`;

export const OWN: OwnLicense = {
  name: 'Fadewise',
  license: 'GPL-3.0-or-later',
  copyright: 'Copyright (C) 2026 HoshimuraYuto',
  file: 'LICENSE.txt',
  url: 'https://www.gnu.org/licenses/gpl-3.0.html',
};

export const ownNotice =
  (): string => `Fadewise: fades, volume leveling, gap closing and key/BPM queue ordering for YouTube Music.
${OWN.copyright}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.`;

export const THIRD_PARTY: ThirdParty[] = [
  {
    id: 'open-props',
    group: 'bundled',
    name: 'Open Props',
    version: '1.7.23',
    npm: 'open-props',
    url: 'https://github.com/argyleink/open-props',
    license: 'MIT',
    copyright: 'Copyright (c) 2021 Adam Argyle',
  },
  {
    id: 'tanstack-table',
    group: 'bundled',
    name: 'TanStack Table (@tanstack/table-core)',
    version: '9.3.1',
    npm: '@tanstack/table-core',
    url: 'https://github.com/TanStack/table',
    license: 'MIT',
    copyright: 'Copyright (c) 2016 Tanner Linsley',
  },
  {
    id: 'tanstack-store',
    group: 'bundled',
    name: '@tanstack/store',
    version: '0.11.2',
    npm: '@tanstack/store',
    url: 'https://github.com/TanStack/store',
    license: 'MIT',
    copyright: 'Copyright (c) 2021 Tanner Linsley',
  },
  {
    id: 'toastify',
    group: 'bundled',
    name: 'Toastify JS',
    version: '1.12.0',
    npm: 'toastify-js',
    url: 'https://github.com/apvarun/toastify-js',
    license: 'MIT',
    copyright: 'Copyright (c) 2018 apvarun',
  },
  {
    id: 'music-tempo',
    group: 'bundled',
    name: 'music-tempo',
    version: '1.0.3',
    vendor: 'music-tempo',
    url: 'https://github.com/killercrush/music-tempo',
    license: 'MIT',
    copyright: 'Copyright (c) 2017 killercrush',
    note: "Vendored in shared/vendor/music-tempo/ from the npm package's src/ (OnsetDetection, TempoInduction, BeatTracking, Agent); the only changes are line endings and the .mjs import path. Its own FFT / spectral-flux front end is not used: the extension computes the spectral flux in worklets/meter-worklet.mts.",
  },
  {
    id: 'libebur128',
    group: 'bundled',
    name: 'libebur128',
    version: null,
    url: 'https://github.com/jiixyj/libebur128',
    license: 'MIT',
    copyright: 'Copyright (c) 2011 Jan Kokemüller',
  },
  {
    id: 'wxt',
    group: 'bundled',
    name: 'WXT',
    version: '0.21.4',
    npm: 'wxt',
    url: 'https://github.com/wxt-dev/wxt',
    license: 'MIT',
    copyright: 'Copyright (c) 2023 Aaron',
    note: 'The build places small parts of its runtime in the bundles: defineBackground / defineContentScript, the content-script context and location watcher (wxt:locationchange) and the logger.',
  },
  {
    id: 'wxt-browser',
    group: 'bundled',
    name: '@wxt-dev/browser',
    version: '0.3.5',
    npm: '@wxt-dev/browser',
    url: 'https://github.com/wxt-dev/wxt',
    license: 'MIT',
    copyright: 'Copyright (c) 2023 Aaron',
  },
  {
    id: 'match-patterns',
    group: 'bundled',
    name: '@webext-core/match-patterns',
    version: '2.0.0',
    npm: '@webext-core/match-patterns',
    url: 'https://github.com/aklinker1/webext-core',
    license: 'MIT',
    copyright: 'Copyright (c) 2022 Aaron',
  },
  {
    id: 'vite',
    group: 'bundled',
    name: 'Vite',
    version: '8.3.4',
    npm: 'vite',
    url: 'https://github.com/vitejs/vite',
    license: 'MIT',
    copyright: 'Copyright (c) 2019-present, VoidZero Inc. and Vite contributors',
  },
  {
    id: 'rolldown',
    group: 'bundled',
    name: 'Rolldown',
    version: '1.2.14',
    npm: 'rolldown',
    url: 'https://github.com/rolldown/rolldown',
    license: 'MIT',
    copyright: 'Copyright (c) 2024-present VoidZero Inc. & Contributors',
    note: 'The bundler (used by Vite 8) emits its CommonJS interop helpers into the page chunks.',
  },
  {
    id: 'autocue',
    group: 'informed',
    name: 'Moonbase59/autocue',
    version: null,
    url: 'https://github.com/Moonbase59/autocue',
    license: 'MIT',
    copyright: 'Copyright (c) 2024 Matthias C. Hormann',
    note: "The relative levels used to classify a track's ending (-42 LU silence, -8 LU overlay level below the integrated loudness) and the 5 s blank length follow autocue's cue_file (used in shared/analysis/ending.mts). No code was copied.",
  },
  {
    id: 'ytmusic-autocontinue',
    group: 'informed',
    name: 'FelipheMP/ytmusic-autocontinue',
    version: null,
    url: 'https://github.com/FelipheMP/ytmusic-autocontinue',
    license: 'MIT',
    copyright: 'Copyright (c) 2026 Feliphe Mickael Pereira',
  },
  {
    id: 'youtube-nonstop',
    group: 'informed',
    name: 'lawfx/YoutubeNonStop',
    version: null,
    url: 'https://github.com/lawfx/YoutubeNonStop',
    license: 'MIT',
    copyright: 'Copyright (c) 2018 Nikos Ioannou',
    note: 'The selectors in content/auto-continue.mts were cross-checked against this project and FelipheMP/ytmusic-autocontinue. No code was copied.',
  },
];

export const REFERENCES: string[] = ['temperley', 'camelot'];

---
title: Fadewise Privacy Policy / プライバシーポリシー
permalink: /privacy/
---

[English](#en) · [日本語](#ja)

<h1 id="en">Fadewise Privacy Policy</h1>

Last updated: 2026-10-18

## 1. Summary

Fadewise ("the extension") is a Chrome extension that computes numbers from the audio playing on YouTube Music™ (music.youtube.com) and uses them to adjust the volume, the fades, the joins between tracks and the order of the queue.

- The extension **does not send any data to any server**. No one, including the developer, receives your data.
- The extension **never stores or transmits audio**. It stores only numbers computed from the audio.
- No account or sign-in is required. The extension contains no ads, analytics or tracking.

## 2. What the extension handles and where it is stored

On installation the extension opens a page that shows what will be stored; per-track analysis results are saved only after you press "Agree and start analyzing". If you do not agree, no track data is stored and volume leveling uses YouTube's loudness value only.

The following is stored in the browser's extension storage on your device (`chrome.storage.local`). Chrome Sync storage (`chrome.storage.sync`) is not used.

| Data                     | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Track identifier         | YouTube video ID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The page being played                          |
| Title and artist         | For display of analyzed tracks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The player information of the page             |
| Audio measurements       | Loudness (LUFS), peak, per-second loudness, loudness series of the start and the end of the track, positions of the first and last sound, duration, BPM, beat phase, musical key and their confidence, the numbers used to compute key and BPM of the first and last 30 seconds, candidate join points of the track (the second to enter or leave at, their kind, confidence, the level around them and the number of times the track was played to the end; about 100 bytes per track), YouTube's loudness value for the track | Computed in the browser from the playing audio |
| Record metadata          | Number of analyses, time of last update                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The extension                                  |
| Applied record           | What the extension actually applied on the last 5 plays of the track (volume change and its basis, fade result, kind and position of the gap handling, length of the overlap) and when                                                                                                                                                                                                                                                                                                                                          | The extension                                  |
| "Leave this track alone" | IDs of the tracks you chose, and when (up to 5,000)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Your choices                                   |
| Ordering log             | Time, kind of queue (radio, playlist, album and so on), result and number of tracks moved for the last 20 reorderings. No track IDs or titles. Ordering is off by default; this is recorded only if you turn it on                                                                                                                                                                                                                                                                                                              | The extension                                  |
| Settings                 | On/off state and choice of each feature, the settings before the last "Off", display language                                                                                                                                                                                                                                                                                                                                                                                                                                   | Your choices                                   |
| Consent record           | Whether you agreed, when, and the disclosure version                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Your choice                                    |
| Auto-continue log        | Count and times (up to 50) the "Continue watching?" prompt was answered automatically. Auto-continue is off by default; this is recorded only if you turn it on                                                                                                                                                                                                                                                                                                                                                                 | The extension                                  |

Temporary status for the popup (current video ID, state, applied gain, how the last track led into this one, the timing of the last 5 track switches as numbers) and a temporary copy of the playing track's stored values are kept in `chrome.storage.session` and are cleared when the browser closes. Pressing "Copy the switch record" in the popup copies the switch timing (numbers only; no titles, track IDs or audio) to the clipboard. It is copied only when you press the button, and the extension never sends it anywhere.

If you import a JSON file on the "Saved analysis" page, only the measured numbers of each track and the "Leave this track alone" list are taken from it and stored as above (titles, artists, applied records, settings and logs are not imported). Import works only after you agree and while "Analyze and save tracks" is on.

**The combination of video IDs, titles and timestamps may amount to a history of tracks you listened to on YouTube Music.** It never leaves your device, but anyone who can use the same Chrome profile can see it on the extension's "Saved analysis" page.

Audio samples and intermediate values computed from the audio (such as spectral change) are not stored; they are discarded after the computation.

### Overlap tracks (experimental, off by default)

If you turn this on, the extension temporarily raises the player's playback speed during the last few tens of seconds of tracks heard before, holds up to 10 seconds of the audio played ahead in memory, and plays it at the original speed over the next track. While the tracks overlap, the silence at the start of the next track (up to 2.5 seconds) is also played faster. With "How to blend" set to Auto (the default), the extension filters the sound of the two tracks in the browser to move the bass from the previous track to the next one; for pairs with close tempos and a steady beat, it slightly shifts the point where the next track's silence stops being played faster, so that the beats line up. This audio is constantly overwritten in memory and is never written to a file, to the extension's storage or to the network; it is neither stored nor transmitted. When the track changes or the overlap is canceled (for example by pausing or seeking), the playback speed is set back and the audio is discarded. The playback speed is never changed while an ad plays.

### What the extension does not access

The extension does not access your Google account, other websites you visit, cookies or anything you type. It runs only on music.youtube.com.

## 3. How the data is used

Only to:

- decide, the next time a track plays, how much to adjust its volume and whether and how long to fade its ending;
- if you turn these on, decide where to close the gap (where the player's "Next" is pressed), how much silence to skip at the start of the next track, how long and how to overlap (where the bass swaps, whether beats are lined up), where to enter and leave a track, and how to order the tracks in the queue (how well keys and tempos follow each other);
- show the status, the analysis results and what the extension did in its popup, on its "Saved analysis" page and on the YouTube Music page (seek bar marks, BPM and key in the queue, the ordering notice).

It is not used for advertising, profiling, sale, creditworthiness or any other purpose.

## 4. Sharing

The extension does not transmit data, so it is not shared with the developer or any third party. Only when you press "Export JSON" is a file containing the stored data downloaded to your device; what happens to that file is up to you.

## 5. Retention and deletion

- Data stays on your device until you delete it or uninstall the extension.
- "Delete all" on the "Saved analysis" page deletes all stored track data (including applied records), the "Leave this track alone" list and the ordering log. Settings, the consent record and the auto-continue log remain.
- Uninstalling the extension makes Chrome delete all of its storage.
- Turning off "Analyze and save tracks" in the popup stops saving new analysis results (values already stored are still used until deleted).
- Volume leveling, fades, closing gaps, overlapping tracks, ordering and auto-continue (the last four off by default) can each be switched in the popup.

## 6. Security

Data is kept in Chrome's extension storage, which other websites cannot read. Nothing is sent over the network.

## 7. Chrome Web Store User Data Policy

The use of information received by this extension will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## 8. Changes

If this policy changes, this page and its date will be updated. Changes to how data is handled will also be announced in the extension's update notes.

## 9. Contact

GitHub Issues of this repository: <{{ site.github.repository_url }}/issues>

YouTube and YouTube Music are trademarks of Google LLC. Fadewise is not made or endorsed by, or affiliated with, Google LLC or YouTube.

---

<h1 id="ja" lang="ja">Fadewise プライバシーポリシー</h1>

最終更新日: 2026-10-18

## 1. 概要

Fadewise（以下「本拡張」）は、YouTube Music™（music.youtube.com）で再生中の音から数値を計算し、その数値で音量・フェード・曲間のつなぎ・キューの曲順を調整する Chrome 拡張機能です。

- 本拡張は、**どのサーバーにもデータを送信しません**。開発者を含む第三者がデータを受け取ることはありません。
- 本拡張は、**音声そのものを保存・送信しません**。保存するのは音から計算した数値だけです。
- アカウント登録・ログインは不要です。広告・アクセス解析（アナリティクス）・トラッキングは含みません。

## 2. 扱う情報と保存場所

本拡張は、インストール時に開くページで保存する内容を示し、利用者が「同意して解析を始める」を押した後にだけ、曲ごとの解析結果を保存します。同意しない場合、曲の情報は保存せず、音量そろえは YouTube が示す音量値だけで行います。

次の情報を、お使いのブラウザー内の拡張機能用ストレージ（`chrome.storage.local`。端末内）に保存します。Chrome の同期機能（`chrome.storage.sync`）は使いません。

| 情報                 | 内容                                                                                                                                                                                                                                                                                                                                                                      | 取得元                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 曲の識別子           | YouTube の動画 ID（videoId）                                                                                                                                                                                                                                                                                                                                              | 再生中のページ                         |
| 曲名・アーティスト名 | 解析した曲の表示用                                                                                                                                                                                                                                                                                                                                                        | 再生中のページのプレーヤー情報         |
| 音の数値             | ラウドネス（LUFS）、ピーク、1 秒ごとの音量、曲の始まりと終わりの音量の列、最初と最後の音の位置、曲の長さ、BPM・拍の位置・キーとその信頼度、始まりの 30 秒・終わりの 30 秒それぞれのキーと BPM の計算に使う数値、曲のつなぐ位置の候補（入る位置・切る位置の秒、種類、信頼度、その前後の音量、最後まで通して聴いた回数。1 曲あたり約 100 バイト）、YouTube が示す曲の音量値 | 再生中の音を本拡張がブラウザー内で計算 |
| 記録の情報           | 解析した回数、最後に更新した日時                                                                                                                                                                                                                                                                                                                                          | 本拡張                                 |
| 補正の記録           | その曲の直近 5 回の再生で本拡張が実際にかけた補正（音量の補正量とその根拠、フェードの結果、曲間の処理の種類と位置、曲を重ねた長さ）と日時                                                                                                                                                                                                                                 | 本拡張                                 |
| 「この曲は触らない」 | 利用者が対象にした曲の ID と、設定した日時（最大 5000 件）                                                                                                                                                                                                                                                                                                                | 利用者の操作                           |
| 並べ替えの記録       | 並べ替えを行った日時、キューの種類（ラジオ・プレイリスト・アルバムなど）、結果、動かした曲数など（直近 20 回）。曲の ID・曲名は含みません。並べ替えは初期設定でオフで、利用者がオンにした場合だけ記録されます                                                                                                                                                             | 本拡張                                 |
| 設定                 | 各機能のオン／オフと選択、一括切り替えでオフにする直前の設定、表示言語                                                                                                                                                                                                                                                                                                    | 利用者の操作                           |
| 同意の記録           | 同意したか・しなかったか、その日時、開示の版                                                                                                                                                                                                                                                                                                                              | 利用者の操作                           |
| 自動応答の記録       | 「視聴を続けますか？」に自動で応答した回数と日時（最大 50 件）。自動応答は初期設定でオフで、利用者がオンにした場合だけ記録されます                                                                                                                                                                                                                                        | 本拡張                                 |

このほか、ポップアップの表示のための一時的な情報（現在の曲の ID、状態、補正量、前の曲からのつなぎの処理、直近 5 回の曲の切り替えの時刻の数値など）と、再生中の曲の保存値の一時的な写しを `chrome.storage.session` に置きます。これはブラウザーを閉じると消えます。ポップアップの「切り替えの記録をコピー」を押すと、切り替えの時刻の数値（曲名・曲の ID・音声は含みません）がクリップボードにコピーされます。コピーは利用者が押したときだけで、本拡張がその内容を送信することはありません。

利用者が「保存した解析結果」画面で JSON ファイルを読み込んだ場合は、そのファイルから曲ごとの測った数値と「この曲は触らない」の一覧だけを取り込み、上の表と同じ場所に保存します（曲名・アーティスト名・補正の記録・設定・記録は取り込みません）。読み込みは同意後、「曲を解析して保存する」がオンのときだけ行います。

**曲 ID・曲名・日時の組み合わせは、YouTube Music でどの曲を聴いたかの履歴に当たり得ます。** この情報は端末の外に出ませんが、同じ Chrome プロフィールを使える人は、本拡張の「保存した解析結果」画面で見ることができます。

音声のサンプルと、音から計算した途中の値（スペクトルの変化量など）は保存しません。計算に使った後に破棄します。

### 曲を重ねてつなぐ（実験的、初期設定はオフ）

この機能をオンにした場合、本拡張は聴いたことのある曲の終わりの数十秒だけプレーヤーの再生速度を一時的に上げ、先に再生した最大 10 秒分の音声をメモリ上に一時的に持ち、元の速さで次の曲に重ねて流します。重ねる間は、次の曲の頭の無音（最大 2.5 秒）も速く流します。つなぎ方が「おまかせ」（初期設定）のときは、重ねる 2 曲の音にブラウザー内でフィルターをかけ、低音を前の曲から次の曲へ入れ替えます。テンポが近く拍が安定した組では、次の曲の頭の無音を速く流すのをやめる位置を少しずらし、拍をそろえます。この音声はメモリ上で常に上書きされ、ファイル・拡張機能のストレージ・ネットワークのどこにも書き出さず、保存も送信もしません。曲が切り替わるか、一時停止・シークなどの操作で取り消されると、再生速度を元に戻し、その音声を破棄します。広告の再生中は再生速度を変えません。

### アクセスしないもの

Google アカウントの情報、閲覧した他のサイト、Cookie、入力内容には一切アクセスしません。本拡張が動作するのは music.youtube.com のページだけです。

## 3. 情報の使い方

保存した情報は、次の目的にだけ使います。

- 次にその曲を再生するときに、音量をそろえる量と、フェードをかけるかどうか・長さを決める。
- 利用者がオンにした場合に、曲間を詰める位置（プレーヤーの「次へ」を押す位置）、次の曲の頭の無音を飛ばす範囲、曲を重ねる長さと重ね方（低音を入れ替える位置、拍をそろえるか）、曲に入る位置・曲を切る位置、キューの曲の並べ替え（キーと BPM のつながり）を決める。
- 本拡張のポップアップ、「保存した解析結果」画面、YouTube Music のページ上の表示（シークバーの印、キューの BPM とキー、並べ替えの通知）に、状態・解析結果・本拡張が行ったことを表示する。

広告、プロファイリング、販売、信用評価、その他の目的には使いません。

## 4. 第三者への提供

本拡張は情報を外部に送信しないため、開発者・第三者に提供されることはありません。
利用者が「JSONで書き出す」ボタンを押した場合に限り、保存した情報を含むファイルが利用者の端末にダウンロードされます。そのファイルの扱いは利用者に委ねられます。

## 5. 保存期間と削除

- 情報は、利用者が削除するか本拡張をアンインストールするまで、端末内に残ります。
- 「保存した解析結果」画面の「すべて削除」で、保存した曲の情報（補正の記録を含む）、「この曲は触らない」の一覧、並べ替えの記録を削除できます。設定・同意の記録・自動応答の記録は残ります。
- 本拡張をアンインストールすると、Chrome が本拡張のストレージをすべて削除します。
- ポップアップの「曲を解析して保存する」をオフにすると、新しい解析結果を保存しません（保存済みの値は、削除するまで使います）。
- ポップアップの各スイッチで、音量そろえ・フェード・曲間を詰める・曲を重ねてつなぐ・並べ替え・自動応答（最後の 4 つは初期設定でオフ）を切り替えられます。

## 6. 安全管理

情報は Chrome の拡張機能用ストレージに保存され、他のウェブサイトからは読めません。ネットワークを通じた送信は行いません。

## 7. Chrome Web Store ユーザーデータポリシーへの準拠

The use of information received by this extension will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.
（本拡張による情報の利用は、Limited Use の要件を含む Chrome Web Store ユーザーデータポリシーに従います。）

## 8. 変更

本ポリシーを変更する場合は、このページを更新し、最終更新日を改めます。データの扱いを変える場合は、本拡張の更新内容でもお知らせします。

## 9. お問い合わせ

このリポジトリの GitHub Issues: <{{ site.github.repository_url }}/issues>

YouTube および YouTube Music は Google LLC の商標です。Fadewise は Google LLC および YouTube が作成・承認したものではなく、両者と関係はありません。

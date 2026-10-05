# Chrome ウェブストア 掲載情報（提出用の下書き）

デベロッパーダッシュボードの各欄にそのまま貼り付けられる形でまとめている。
拡張機能名と概要は `_locales/{ja,en}/messages.json` が実体で、`manifest.json` は `__MSG_appName__` /
`__MSG_appDescription__` で参照している。文言を変更する場合は `_locales` 側を直すこと
（ビルド時に 132 文字を超えていないか検査している）。

## 基本情報

| 項目 | 内容 |
|------|------|
| 拡張機能名 | note to Markdown |
| 概要（132文字以内） | 【非公式】note.com の記事を Markdown に変換します。画像は URL 参照・ローカル保存・Base64 埋込から選べます。 |
| カテゴリ | 仕事効率化 |
| 言語 | 日本語（既定） / 英語 |
| 公開範囲 | 公開 |

### 英語ロケール（`_locales/en/messages.json`）

| 項目 | 内容 |
|------|------|
| Extension name | note to Markdown |
| Short description | [Unofficial] Convert note.com articles to Markdown. Images can be linked, saved locally, or embedded as Base64. |

## 詳細な説明

```
note.com の記事を Markdown 形式に変換する拡張機能です。Obsidian などのMarkdownエディタへの取り込みを想定しています。

■ できること
・開いている note 記事、または記事URLの指定から Markdown を生成
・変換結果をクリップボードへコピー、または指定フォルダへ .md として保存
・保存先フォルダを最大5つプリセット登録
・note ページ上の記事リンクを選んで変換（単体 / 複数まとめて）
・タグを frontmatter に付与。よく使う組み合わせはタグセットとして登録可能
・指定ワードを [[単語]] 形式に変換する Obsidian 向けリンク化
・UI の日本語 / 英語切り替え（既定はブラウザの表示言語に追従）
・タグと Obsidian 設定を JSON ファイルでエクスポート / インポート
・保存済みの .md のスキ数・ページビュー数・インプレッション数を、note の最新値へ一括更新
・同じ画面をサイドパネルに常設。タブを移動しても閉じません

■ 変換に対応している要素
見出し / 段落・改行 / 太字 / リンク / 画像・キャプション / 引用 / コードブロック・インラインコード / 箇条書き・番号付きリスト / 水平線 / 表
frontmatter にはタイトル・URL・note ID・著者・公開日・スキ数・タグ・変換日時を出力します。

■ 画像の扱い（オプション画面で選択）
・note URL参照（既定）: note の画像URLをそのまま埋め込みます
・画像ダウンロード: 指定フォルダに保存し、相対パスで参照します
・Base64埋込: 画像をMarkdown内に直接埋め込みます

■ ご利用にあたって
・ダウンロード機能を使うには、オプション画面で保存先フォルダの設定が必要です
・File System Access API と Side Panel API を使用するため、デスクトップ版 Chrome / Edge（Chrome 116以降）でのみ動作します
・データの収集・外部送信は一切ありません。設定はすべて端末内に保存されます

■ ご注意
本拡張機能は note株式会社とは関係のない非公式ツールです。
変換したコンテンツの利用は、note の利用規約および著作権法の範囲内で行ってください。
```

## 「ログイン状態の利用」についての説明

「プライバシーへの取り組み」タブで、ログインセッションの利用について問われた場合に使う文面。

```
「数値を更新」機能で、利用者自身の記事のページビュー数・インプレッション数を取得する場合にのみ、
利用者が note.com にログインしている状態を利用します。

これらの数値は note のダッシュボードにのみ存在し、公開 API では取得できません。そのため、
利用者が開いている note.com のページ上で、note 自身のダッシュボードと同じ手順で一時トークン
（有効期限30分）を note から発行してもらい、それを用いて note のサブドメインへ問い合わせます。

・送信先は note.com およびそのサブドメイン（graphql.note.com）のみです。開発者のサーバーや
  第三者へ送信することはありません。開発者が運営するサーバーは存在しません。
・取得するのは利用者自身の記事のページビュー数・インプレッション数と、その集計日時だけです。
  売上金額は問い合わせに含めていないため、受け取ってもいません。
・パスワードの読み取りは行いません。ログイン状態の確認は note 自身が行い、本拡張機能は
  その結果として発行されたトークンを使うだけです。トークンは保存しません。
・利用者がこの機能を実行しない限り、この通信は一切発生しません。
・記事の変換と画像の取得は、従来どおり認証情報を伴わない形（credentials: "omit"）で行います。
```

英語版:

```
The extension uses the user's logged-in note.com session only for the "Refresh stats" feature,
to read page view and impression counts for the user's own articles.

These numbers exist only in note's dashboard and are not available from any public API. The
extension therefore asks note to issue a short-lived token (valid for 30 minutes) from within a
note.com page the user already has open — the same sequence note's own dashboard performs — and
uses that token to query note's own subdomain.

- Requests go only to note.com and its subdomain (graphql.note.com). Nothing is sent to the
  developer or any third party; the developer operates no server.
- Only the user's own page view and impression counts, plus the aggregation timestamp, are
  requested. Sales figures are not included in the query and are never received.
- The extension never reads passwords. note itself verifies the session; the extension only uses
  the token note issues as a result. The token is not stored.
- No such request happens unless the user runs this feature.
- Article conversion and image fetching continue to use no credentials (credentials: "omit").
```

## 更新内容（1.2.0）

ストアの「更新内容」欄にそのまま貼る。

```
1.2.0
・「スキ数を更新」を「数値を更新」に変更し、ページビュー数とインプレッション数も
　まとめて更新するように（自分の記事のみ・ログイン済みの note.com のタブが必要です）
・表（table）を Markdown の表として出力するように
・有料記事は無料公開部分だけを変換し、続きが有料であることを本文と画面に明記
・引用の入れ子を「> >」で出力するように
・画像ダウンロード時の拡張子を、URL ではなく画像の中身から判定するように
・段落の直後に画像や引用が続くと空行が余分に並んでいた不具合を修正
・記事末尾の埋め込みやリンクが消えることがある不具合を修正
・リンクを持たない埋め込み（質問箱など）が本文から消えていた不具合を修正
```

## 更新内容（1.1.0）

過去の版。参照用に残す。

```
1.1.0
・UI の英語表示に対応（自動 / 日本語 / English を設定画面で切り替え）
・タグ候補・タグセット・Obsidian 設定を JSON でエクスポート / インポート
・保存済みの .md のスキ数・ページビュー数・インプレッション数を note の最新値へ一括更新
・popup と同じ画面をサイドパネルに常設できるように（タブを移動しても閉じません）
・保存先プリセットを 3 → 5 に拡張
・マガジンページで複数選択したときに記事名が「タイトル不明」になる不具合を修正
・popup の並びを「変換元 → 変換後 → タグ」に変更
・対応バージョンを Chrome / Edge 116 以降に変更（Side Panel API のため）
```

## 単一用途の説明

```
note.com の記事を Markdown 形式に変換し、クリップボードへコピーまたはローカルフォルダへ保存する。
```

## 権限の justification

各権限欄にそのまま記入する。

| 権限 | 記入する説明 |
|------|-------------|
| `activeTab` | （下の「activeTab の説明」を参照。欄が短い場合は「ユーザーが拡張機能アイコンをクリックしたときに限り、アクティブなタブのURLとタイトルを読み取り、note 記事ページかの判定・対象タイトルの表示・変換要求の送信に使用します。」） |
| `clipboardWrite` | 変換した Markdown をユーザーのクリップボードへコピーするために使用します。 |
| `storage` | 変換設定（変換元・変換後の選択、タグ候補、タグセット、保存先プリセット名、画像取込方式、Obsidian連携の設定、表示言語）を端末内に保存するために使用します。外部への送信は行いません。 |
| `sidePanel` | 変換画面をブラウザのサイドパネルに表示するために使用します。popup と同じ画面をページ操作中も開いたままにするための UI 用途で、データへのアクセスは伴いません。 |
| `https://note.com/*` のホスト権限 | 変換対象として指定された note 記事のHTMLを取得し、本文を Markdown に変換するために使用します。また「数値を更新」を実行した場合に、公開 API（`/api/v3/notes/`）から記事のスキ数を取得し（認証情報を送らず `credentials: "omit"`）、あわせて利用者自身の記事のページビュー数・インプレッション数を取得します。後者は note のダッシュボードにしかない数値のため、note.com 上で note 自身のダッシュボードと同じ手順で一時トークンを発行してもらい、それを用いて `graphql.note.com` へ問い合わせます。送信先は note.com とそのサブドメインのみで、取得するのは利用者自身の記事の閲覧数と集計日時だけです。売上金額は要求していません。 |
| `https://assets.st-note.com/*` のホスト権限 | 画像取込方式で「画像ダウンロード」または「Base64埋込」が選択されている場合に、記事内の画像を取得するために使用します。note の画像配信ドメインです。 |

リモートコードの使用: **なし**（すべてのコードは拡張機能パッケージに同梱、外部スクリプトの読み込みなし）

### sidePanel の説明

「プライバシーへの取り組み」タブの justification 欄にそのまま貼る。

```
sidePanel 権限は、拡張機能自身の変換画面（ポップアップと同じ画面）をブラウザのサイドパネルに表示するためだけに使用します。

ポップアップはページをクリックすると閉じてしまうため、note.com の記事を読みながら変換したり、複数の記事タブを行き来しながら操作したりする際に、毎回アイコンをクリックし直す必要がありました。サイドパネルに表示することで、同じ画面を開いたまま作業できるようにしています。

この権限は画面の表示位置に関するものであり、データへのアクセスは一切伴いません。サイドパネルからウェブページの内容を読み取ることはなく、新たなホスト権限も要求しません。サイドパネルはユーザーがポップアップ内のボタンを押したときにのみ開き、自動で開くことはありません。収集・送信するデータはありません。
```

英語で求められた場合:

```
The sidePanel permission is used solely to display the extension's own conversion UI (the same screen as the popup) in the browser's side panel.

The popup closes as soon as the user clicks the page, so converting while reading a note.com article, or working across several article tabs, required reopening the extension every time. Showing the same screen in the side panel lets it stay open while the user works.

This permission only affects where the UI is displayed and involves no data access. The side panel does not read web page content and does not request any additional host permissions. It opens only when the user presses a button inside the popup, never automatically. No data is collected or transmitted.
```

実装上の対応箇所: `lib/convertPanel.js` の `openSidePanelBtn` のクリックで `chrome.sidePanel.open()` を呼ぶ経路のみ。
`setPanelBehavior` は使っておらず、アイコンクリックでは従来どおりポップアップが開く。

### activeTab の説明

justification 欄にそのまま貼る。

```
ユーザーが拡張機能のアイコンをクリックして popup を開いたときに限り、アクティブなタブの
URL とタイトルを読み取ります。用途は次の3点です。

1. 開いているページが note.com の記事ページ（/n/...）かどうかを判定し、記事ページでない
   場合に適切な案内を表示するため
2. 変換対象として「現在のタブ」が選ばれたときに、その記事タイトルを popup に表示して
   ユーザーが対象を確認できるようにするため
3. 変換の実行時に、そのタブのコンテンツスクリプトへ変換要求を送信するため

アクセスはユーザーが拡張機能を操作した時点のタブに限定され、バックグラウンドでの監視や
閲覧履歴の取得は行いません。取得した情報は端末内の変換処理にのみ使用し、外部への送信は
一切ありません。
```

英語で求められた場合:

```
activeTab is used only when the user clicks the extension icon to open the popup. At that
moment the extension reads the active tab's URL and title in order to:

1. determine whether the current page is a note.com article page (/n/...) and show an
   appropriate message if it is not,
2. display the article title in the popup so the user can confirm the conversion target, and
3. send the conversion request to the content script running in that tab.

Access is limited to the tab the user has explicitly acted on. The extension does not monitor
tabs in the background, does not read browsing history, and does not transmit any data
externally. All processing happens locally on the user's device.
```

実装上の対応箇所（説明と実装が食い違わないよう、変更時はここも確認する）:

| 用途 | 実装 |
|------|------|
| 記事ページ判定 | `lib/convertPanel.js` の `resolveConvertTarget`（`tab.url` を `isNoteArticleUrl` で検査） |
| 対象タイトルの表示 | `lib/convertPanel.js` の `updateCurrentTabArticleTitle`（content script へ問い合わせ、失敗時は `tab.title` にフォールバック） |
| 変換要求の送信 | `lib/convertPanel.js` の `convertCurrentTab` / `startLinkPickMode` / `startMultiPickMode` |

いずれも popup またはサイドパネルの操作が起点であり、バックグラウンドでタブを監視する経路は存在しない。
サイドパネルは開いたまま別のタブへ移れるため `tabs.onActivated` / `tabs.onUpdated` を購読するが、
用途は上記 2 の「対象タイトルの表示」を取り直すことだけで、note.com 以外のタブでは URL を読めない
（`activeTab` はタブを跨いで引き継がれず、ホスト権限は note.com に限られる）。

## データ使用の申告

すべて「収集しない」を選択する。

| 項目 | 回答 |
|------|------|
| 個人を特定できる情報 | 収集しない |
| 健康情報 | 収集しない |
| 財務情報・支払い情報 | 収集しない |
| 認証情報 | 収集しない（「数値を更新」では note が発行する一時トークンを note 自身への問い合わせに使うだけで、保存も外部送信もしない。パスワードは読み取らない） |
| 個人的な通信 | 収集しない |
| 位置情報 | 収集しない |
| ウェブ閲覧履歴 | 収集しない |
| ユーザーのアクティビティ | 収集しない |
| ウェブサイトのコンテンツ | 収集しない（変換処理は端末内で完結し、記事内容を送信しない） |

「数値を更新」で note.com へ問い合わせる通信は、利用者自身の記事の閲覧数を note から**受け取る**ものであり、利用者のデータを開発者や第三者へ**送る**ものではない。開発者が運営するサーバーは存在しない。詳細は上の「「ログイン状態の利用」についての説明」を参照。

証明事項（3項目すべてにチェック）:
- 承認された用途に該当しないデータの第三者への販売・譲渡を行っていない
- 単一用途と無関係な目的でのデータ利用・転送を行っていない
- 信用調査・融資目的でのデータ利用・転送を行っていない

プライバシーポリシーURL: リポジトリの `PRIVACY.md` を公開URL（GitHub Pages など）で提供する

## 掲載画像

ストアの要件はいずれも **JPEG または 24 ビット PNG（アルファなし）**。
生成スクリプトは出力後に PNG の IHDR を読み直し、サイズと色タイプが要件どおりか検査する
（アルファ付きで書き出されるとアップロードが弾かれるため）。

| 用途 | サイズ | 生成コマンド | ファイル |
|------|--------|-------------|----------|
| スクリーンショット | 1280x800（最大5枚） | `npm run make:screenshots` | `01`〜`05` |
| プロモーションタイル（小） | 440x280 | `npm run make:store-images` | `promo-tile-small.png` |
| マーキープロモーションタイル | 1400x560 | `npm run make:store-images` | `promo-tile-marquee.png` |

### スクリーンショット

`dist/` の実UIに chrome API のスタブでサンプルデータを流し込んで撮影しているため、
UI を変更したら再生成すること（事前に `npm run build:dist` が必要）。
レイアウトは 640x400 のまま描画倍率だけ 2 倍にして撮っており、構図を変えずに解像度を上げている。

| ファイル | 内容 | 添える説明文の案 |
|----------|------|-----------------|
| `01-popup.png` | popup 本体（タグセット適用済み） | 開いている記事をワンクリックで Markdown に |
| `02-options-presets.png` | 保存先プリセット設定 | 保存先フォルダを5つまで登録 |
| `03-options-image.png` | 画像取込方式 | 画像は URL 参照・ローカル保存・Base64 から選択 |
| `04-options-tagsets.png` | タグセットプリセット | よく使うタグの組み合わせを登録して一括適用 |
| `05-options-obsidian.png` | Obsidian 連携 | 指定ワードを [[単語]] に変換して Obsidian へ |

ページ内の複数選択パネル（note.com 上に表示されるUI）は実際に拡張機能を読み込んだ状態でしか
撮影できないため、必要であれば手動QAの際に取得する。

### プロモーションタイル

`icons/icon128.png` から採取した配色（紺 `#1e2340` / ピンク `#f0bccb` / 水色 `#c3e2ec`）を使い、
アイコンとキャッチコピーだけを置いたブランド訴求型。タイルはロケール別に登録できないため表記は英語。

| 項目 | 内容 |
|------|------|
| 表示名 | note to Markdown |
| キャッチコピー | Turn note articles into Markdown. |

文言を変えるときは `scripts/make-store-images.mjs` の `NAME` / `TAGLINE` を編集して再生成する。

## 提出前チェック

- [ ] `npm run build:dist` が成功する（lint / test も同時に実行される）
- [ ] ビルドが出力した `ex-note2md-{version}.zip` を提出物とする（手で zip 化しない）
- [ ] `docs/manual-qa.md` の手動チェックを実施
- [ ] スクリーンショット（`npm run make:screenshots` で 1280x800 を5枚生成）
- [ ] プロモーションタイル（`npm run make:store-images` で 440x280 と 1400x560 を生成）
- [ ] プライバシーポリシーを公開URLで参照できる状態にする
- [ ] `manifest.json` と `package.json` のバージョンを更新（ビルドで不一致を検出）

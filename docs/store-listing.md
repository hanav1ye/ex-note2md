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
・保存先フォルダを最大3つプリセット登録
・note ページ上の記事リンクを選んで変換（単体 / 複数まとめて）
・タグを frontmatter に付与。よく使う組み合わせはタグセットとして登録可能
・指定ワードを [[単語]] 形式に変換する Obsidian 向けリンク化
・UI の日本語 / 英語切り替え（既定はブラウザの表示言語に追従）
・タグと Obsidian 設定を JSON ファイルでエクスポート / インポート

■ 変換に対応している要素
見出し / 段落・改行 / 太字 / リンク / 画像・キャプション / 引用 / コードブロック・インラインコード / 箇条書き・番号付きリスト / 水平線
frontmatter にはタイトル・URL・note ID・著者・公開日・スキ数・タグ・変換日時を出力します。

■ 画像の扱い（オプション画面で選択）
・note URL参照（既定）: note の画像URLをそのまま埋め込みます
・画像ダウンロード: 指定フォルダに保存し、相対パスで参照します
・Base64埋込: 画像をMarkdown内に直接埋め込みます

■ ご利用にあたって
・ダウンロード機能を使うには、オプション画面で保存先フォルダの設定が必要です
・File System Access API を使用するため、デスクトップ版 Chrome / Edge（Chrome 109以降）でのみ動作します
・データの収集・外部送信は一切ありません。設定はすべて端末内に保存されます

■ ご注意
本拡張機能は note株式会社とは関係のない非公式ツールです。
変換したコンテンツの利用は、note の利用規約および著作権法の範囲内で行ってください。
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
| `https://note.com/*` のホスト権限 | 変換対象として指定された note 記事のHTMLを取得し、本文を Markdown に変換するために使用します。 |
| `https://assets.st-note.com/*` のホスト権限 | 画像取込方式で「画像ダウンロード」または「Base64埋込」が選択されている場合に、記事内の画像を取得するために使用します。note の画像配信ドメインです。 |

リモートコードの使用: **なし**（すべてのコードは拡張機能パッケージに同梱、外部スクリプトの読み込みなし）

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
| 記事ページ判定 | `popup/popup.js` の `resolveConvertTarget`（`tab.url` を `isNoteArticleUrl` で検査） |
| 対象タイトルの表示 | `popup/popup.js` の `updateCurrentTabArticleTitle`（content script へ問い合わせ、失敗時は `tab.title` にフォールバック） |
| 変換要求の送信 | `popup/popup.js` の `convertCurrentTab` / `startLinkPickMode` / `startMultiPickMode` |

いずれも popup の操作が起点であり、バックグラウンドでタブを監視する経路は存在しない。

## データ使用の申告

すべて「収集しない」を選択する。

| 項目 | 回答 |
|------|------|
| 個人を特定できる情報 | 収集しない |
| 健康情報 | 収集しない |
| 財務情報・支払い情報 | 収集しない |
| 認証情報 | 収集しない |
| 個人的な通信 | 収集しない |
| 位置情報 | 収集しない |
| ウェブ閲覧履歴 | 収集しない |
| ユーザーのアクティビティ | 収集しない |
| ウェブサイトのコンテンツ | 収集しない（変換処理は端末内で完結し、記事内容を送信しない） |

証明事項（3項目すべてにチェック）:
- 承認された用途に該当しないデータの第三者への販売・譲渡を行っていない
- 単一用途と無関係な目的でのデータ利用・転送を行っていない
- 信用調査・融資目的でのデータ利用・転送を行っていない

プライバシーポリシーURL: リポジトリの `PRIVACY.md` を公開URL（GitHub Pages など）で提供する

## スクリーンショット

`npm run make:screenshots` で `docs/screenshots/` に 640x400 で生成する（ストアの上限は5枚）。
`dist/` の実UIに chrome API のスタブでサンプルデータを流し込んで撮影しているため、
UI を変更したら再生成すること。

| ファイル | 内容 | 添える説明文の案 |
|----------|------|-----------------|
| `01-popup.png` | popup 本体（タグセット適用済み） | 開いている記事をワンクリックで Markdown に |
| `02-options-presets.png` | 保存先プリセット設定 | 保存先フォルダを3つまで登録 |
| `03-options-image.png` | 画像取込方式 | 画像は URL 参照・ローカル保存・Base64 から選択 |
| `04-options-tagsets.png` | タグセットプリセット | よく使うタグの組み合わせを登録して一括適用 |
| `05-options-obsidian.png` | Obsidian 連携 | 指定ワードを [[単語]] に変換して Obsidian へ |

ページ内の複数選択パネル（note.com 上に表示されるUI）は実際に拡張機能を読み込んだ状態でしか
撮影できないため、必要であれば手動QAの際に取得する。

## 提出前チェック

- [ ] `npm run build:dist` が成功する（lint / test も同時に実行される）
- [ ] `dist/` を zip 化して提出物とする（リポジトリのルートではない）
- [ ] `docs/manual-qa.md` の手動チェックを実施
- [ ] スクリーンショット（`npm run make:screenshots` で 640x400 を5枚生成）
- [ ] プライバシーポリシーを公開URLで参照できる状態にする
- [ ] `manifest.json` と `package.json` のバージョンを更新（ビルドで不一致を検出）

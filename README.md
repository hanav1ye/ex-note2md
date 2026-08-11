# ex-note2md

`ex-note2md` は、note.com の記事を Markdown に変換する Chrome / Edge 向け拡張機能です。  
画像は **note URL 参照**（既定）、**ローカル保存**（`img1.png` 形式）、**Base64 埋込** から選べます。

> **本拡張機能は note株式会社とは関係のない非公式ツールです。**  
> 変換したコンテンツの利用は、note の利用規約および著作権法の範囲内で行ってください。  
> 保存先フォルダの指定に File System Access API を使うため、**デスクトップ版 Chrome / Edge（Chrome 109 以降）専用**です。  
> 変換・設定データは端末内（`chrome.storage.local` / IndexedDB）にのみ保存され、外部へ送信されることはありません。

## できること

- note 記事ページ、または記事 URL から Markdown 生成
- 変換結果を **コピー** または **ローカルフォルダへ `.md` 保存**
- 保存先プリセットを最大 3 つ管理
- 同一 note ID のファイルがある場合は **上書き保存**
- note ページ上の記事リンクを **単体選択** / **複数選択**
- 複数選択パネルで **一覧を全選択**
- 一覧一括選択時に `プロフィール` / `仕事依頼` を除外
- タグ候補から最大 5 つ選択して frontmatter へ反映
- よく使うタグの組み合わせを **タグセットプリセット** として登録し、popup から一括選択
- Obsidian 向けリンク化（指定ワードを `[[単語]]` 化）
- UI の **日本語 / 英語** 切り替え（既定はブラウザの表示言語に追従）
- タグ・Obsidian 設定の **JSON エクスポート / インポート**

## Markdown 変換の対応範囲

| 対応 | 内容 |
|------|------|
| 見出し | `h1`〜`h6` |
| 段落・改行 | 段落区切り、`<br>` はハード改行 |
| 太字 | `**text**` |
| リンク | `[label](url)` |
| 画像 | `![alt](url)`、`{note ID}/img1.png` 参照、Base64 埋込（オプションの「画像取込方式」で選択） |
| キャプション | `figcaption` を画像直下のイタリックで出力 |
| 引用 | `blockquote` を `>` 付きで出力 |
| コード | フェンス付きコードブロック、インラインコード |
| 水平線 | `---` |
| 除去 | note 付属の目次 UI、記事末尾ハッシュタグ行、コードコピーボタンなど |

## インストール（開発用）

1. Chrome/Edge で `chrome://extensions`（Edge は `edge://extensions`）を開く
2. **デベロッパーモード**を有効化
3. **パッケージ化されていない拡張機能を読み込む** → このリポジトリのルートを選択

## 使い方

### 基本フロー

1. 拡張アイコンから popup を開く
2. 変換元（現在のタブ / URL 指定）を選ぶ
3. 必要に応じてタグを選ぶ（タグセットを選ぶと組み合わせを一括適用）
4. 変換後（コピー / ダウンロード）を選ぶ
5. `変換` を実行

画像取込方式（note URL参照 / 画像ダウンロード / Base64埋込）は **オプション画面** で設定します。

### ダウンロード（重要）

ダウンロード機能は **保存先プリセットのフォルダ設定が必須** です。

1. popup 右上の歯車からオプションを開く
2. `保存先プリセット設定` で `プリセット1〜3` のいずれかにフォルダを設定
3. popup で設定済みプリセットを選び、`ダウンロード` を実行

未設定の場合はエラーになります。  
ブラウザ再起動などでフォルダへのアクセス権限が失効した場合は、オプション画面の該当プリセットに **「アクセスを再許可」** ボタンが表示されます。フォルダを選び直さなくても、このボタンから許可し直せます。  
Downloads 直下への保存は想定せず、必要ならサブフォルダ（例: `Downloads\note-markdown`）を指定してください。

### 画像取込方式

オプション画面の **画像取込方式** で設定します。

| 方式 | 説明 |
|------|------|
| note URL参照 | 既定。note の画像 URL をそのまま Markdown に埋め込む |
| 画像ダウンロード | 画像保存先フォルダ（Markdown 保存先とは別・必須）配下に `{note ID}/img1.png` … を保存し、Markdown から `{note ID}/img1.png` 形式で参照する |
| Base64埋込 | 画像を data URI として Markdown 内に埋め込む |

### 記事リンクの選択

note.com ページ上で:

- **選択する**: 記事リンクを 1 本クリックして即実行（クリックで popup は閉じますが、処理はページ側で完結し結果はトーストで表示されます）
- **複数選択**: 複数リンクを選んで一括実行
- **一覧を全選択**: 一覧コンテナ配下の記事リンクをまとめて選択

選択モード中は **Esc** でいつでも抜けられます。  
一括実行中は「実行」ボタンが **中止** に変わり、押すと現在の記事の処理完了後に停止します。中止した場合は未処理の記事だけが選択に残るため、そのまま再実行できます。

#### 選択モードの切り替え仕様

単体選択と複数選択は**排他**で、同時に有効になることはありません。切り替えは必ず「現在のモードを完全に終了 → 次のモードを開始」の順で行われ、終了時には以下がすべて元に戻ります。

- クリック / マウス移動 / キー入力のイベントリスナー
- ホバー枠線とマウスカーソル（モードに入る前の状態へ復元）
- 複数選択の選択リスト・進捗・ページ上のパネル

一括処理の実行中はモードを切り替えられません（popup 側にエラーが表示されます）。パネルの「中止」または Esc で停止してから切り替えてください。

### タグセットプリセット

オプション画面の `タグセットプリセット` で、タグ候補の組み合わせに名前を付けて保存できます（1 セット最大 5 タグ / 最大 10 セット）。

- セット名を入力し、タグ候補をチェックして `セットを追加`
- 登録済みセットは `編集` / `削除` が可能
- タグ候補を削除すると、そのタグは各セットからも自動で除外されます

popup のタグ欄に表示される `タグセット` を選ぶと、その組み合わせがチェック状態へ一括反映されます。  
`選択なし` を選ぶと全解除、チェックを手動で変更するとセット選択は解除されます（同じ組み合わせなら再び選択状態になります）。

### Obsidianで活用する

オプション画面の `Obsidianで活用する` で:

- `Obsidianリンク化する` を ON/OFF
- リンク化対象ワードを登録/削除

ON 時、本文中の一致ワードを `[[単語]]` に変換します。  
既存リンク・画像リンク・コードブロック・インラインコード・既存 `[[...]]` は保護されます。

### 表示言語

オプション画面の `表示言語` で **自動 / 日本語 / English** を選べます。既定は `自動` で、`chrome.i18n.getUILanguage()` が `ja` で始まるときは日本語、それ以外は英語になります。

設定は popup・オプション画面・note ページ上のトーストとパネル・Service Worker のエラー文言すべてに適用されます。オプション画面での切り替えはその場で反映され、既に開いている note タブにも次に選択モードへ入ったタイミングで反映されます。

Markdown の出力内容（frontmatter のキー名など）は表示言語の影響を受けません。

保存先プリセットの表示名を空にすると、その言語の既定名（`プリセット1` / `Preset 1`）が使われます。

### 設定のインポート / エクスポート

オプション画面の `設定のインポート / エクスポート` で、以下を JSON ファイルとしてやり取りできます。

| 対象 | 備考 |
|------|------|
| タグ候補 | |
| タグセットプリセット | ID は取り込み側で振り直す |
| Obsidian リンク化ワード | |
| Obsidian リンク化 ON/OFF | |

- **エクスポート**: `note2md-settings-YYYYMMDD.json` をダウンロードします
- **インポート**: 既存の設定へ **追加（マージ）** します。同じタグ・同じ名前のタグセット・同じワードはスキップされ、既存の登録が消えることはありません
- タグセットが参照するタグは、タグ候補にも自動で追加されます
- リンク化 ON/OFF は「ファイル側が ON なら ON にする」だけで、ON を OFF へ戻すことはありません
- タグセットが上限（10 件）を超える分は取り込まれず、その旨を表示します

保存先フォルダはブラウザの権限に紐づくため対象外です。取り込んだ端末で選び直してください。

## 保存データ

### `chrome.storage.local`

| キー | 内容 |
|------|------|
| `sourceMode` | 変換元（`tab` / `url`） |
| `outputMode` | 変換後（`copy` / `download`） |
| `articleUrl` | 入力した記事 URL |
| `tags` | popup で選択中のタグ |
| `downloadPreset` | 選択中プリセット ID（`preset1`〜`preset3`） |
| `imageImportMode` | 画像取込方式（`url` / `download` / `base64`） |
| `imageFolderConfig` | 画像保存先フォルダ設定（`folderLabel`, `hasFolder`） |
| `presetConfigs` | プリセット名・フォルダ設定状態 |
| `presetTagCandidates` | タグ候補一覧 |
| `presetTagSets` | タグセットプリセット一覧（`{id, name, tags}`） |
| `selectedTagSetId` | popup で選択中のタグセットID |
| `presetObsidianLinkWords` | Obsidian リンク化ワード一覧 |
| `obsidianLinkify` | Obsidianリンク化 ON/OFF |
| `uiLanguage` | 表示言語設定（`auto` / `ja` / `en`） |

### IndexedDB（`noteToMarkdownPresets`）

File System Access API で選択した保存先フォルダのハンドルを保持します（`directoryHandles`）。  
キーは Markdown 用の `preset1`〜`preset3` と、画像用の `imageFolder` です。

## 権限

| 権限 | 用途 |
|------|------|
| `activeTab` | 開いている note 記事タブの DOM 変換 |
| `clipboardWrite` | Markdown のクリップボードコピー |
| `storage` | 設定保存（`chrome.storage.local`） |
| `https://note.com/*` | 記事ページの読み取り、URL 指定時の HTML 取得 |
| `https://assets.st-note.com/*` | 画像ダウンロード・Base64 変換時の画像取得 |

## 構成

| パス | 役割 |
|------|------|
| `lib/noteToMarkdown.js` | note DOM → Markdown 変換 |
| `lib/i18n.js` | UI 文言カタログ（日本語 / 英語）と表示言語の解決 |
| `content/content.js` | 記事ページでの変換 API、リンク選択・一括処理 |
| `background.js` | 保存処理・ファイル存在チェック |
| `popup/` | 変換 UI |
| `options/` | 表示言語 / 保存先プリセット / タグ候補 / タグセットプリセット / Obsidian 設定 / 設定の入出力 |
| `_locales/` | manifest の拡張機能名・説明のローカライズ |
| `manifest.json` | Manifest V3 定義 |
| `scripts/build-dist.mjs` | 配布用 `dist/` の生成（検証 + minify） |
| `scripts/update-fixtures.mjs` | テスト用フィクスチャの取得（手動実行） |
| `scripts/update-golden.mjs` | 期待Markdownの再生成（手動実行） |
| `tests/` | 自動テスト |
| `docs/` | ストア掲載文・手動QAチェックリスト |

## 開発コマンド

```bash
npm install
```

| コマンド | 内容 |
|----------|------|
| `npm run lint` | ESLint による静的検査 |
| `npm test` | node:test + jsdom によるテスト（変換・UI・background） |
| `npm run test:dist` | 同じテストを **minify 済みの `dist/`** に対して実行 |
| `npm run verify` | lint とテストをまとめて実行 |
| `npm run build:dist` | 配布用 `dist/` を生成（lint / test / バージョン整合を検証し、生成後は `dist` に対しても再テスト） |
| `npm run update:fixtures` | ゴールデンテスト用の記事フィクスチャを note.com から再取得 |
| `npm run update:golden` | 期待Markdownを再生成（変換仕様を意図的に変えたときのみ） |
| `npm run make:screenshots` | ストア掲載用スクリーンショット（640x400）を `docs/screenshots/` へ生成 |

テストの構成:

| ファイル | 内容 |
|----------|------|
| `tests/conversion-golden.test.mjs` | 実記事フィクスチャに対する変換結果の回帰 |
| `tests/conversion-parity.test.mjs` | タブ変換とURL変換の出力一致 |
| `tests/conversion-unit.test.mjs` | frontmatter・記法・Obsidianリンク化などの個別仕様 |
| `tests/i18n.test.mjs` | 表示言語の解決・フォールバック・DOM への適用 |
| `tests/background.test.mjs` | 保存処理、URL/ファイル名の検証、メッセージ検証 |
| `tests/content-ui.test.mjs` | 選択モード、一括処理の中止、Shadow DOM 隔離 |
| `tests/options-ui.test.mjs` | タグ候補・タグセット・フォルダ権限の再許可・設定の入出力・表示言語 |
| `tests/popup-ui.test.mjs` | タグ選択・タグセット適用・保存先プリセット表示・表示言語 |

実ブラウザでしか確認できない項目は [docs/manual-qa.md](docs/manual-qa.md) にまとめています。

## ストア公開について

- 掲載文・権限の説明・データ申告の下書き: [docs/store-listing.md](docs/store-listing.md)
- プライバシーポリシー: [PRIVACY.md](PRIVACY.md)
- 提出物は **`dist/` を zip 化したもの**（リポジトリのルートではありません）

## ベース実装

作者自身の `note2zenn-hanaviye` の DOM 変換ロジックをベースに、ブラウザ拡張向けへ移植しています。

## ライセンス

[MIT License](LICENSE)

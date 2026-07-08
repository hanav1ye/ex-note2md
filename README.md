# ex-note2md

`ex-note2md` は、note.com の記事を Markdown に変換する Chrome / Edge 向け拡張機能です。  
画像は **note URL 参照**（既定）、**ローカル保存**（`img1.png` 形式）、**Base64 埋込** から選べます。

## できること

- note 記事ページ、または記事 URL から Markdown 生成
- 変換結果を **コピー** または **ローカルフォルダへ `.md` 保存**
- 保存先プリセットを最大 3 つ管理
- 同一 note ID のファイルがある場合は **上書き保存**
- note ページ上の記事リンクを **単体選択** / **複数選択**
- 複数選択パネルで **一覧を全選択**
- 一覧一括選択時に `プロフィール` / `仕事依頼` を除外
- タグ候補から最大 5 つ選択して frontmatter へ反映
- Obsidian 向けリンク化（指定ワードを `[[単語]]` 化）

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
3. 必要に応じてタグを選ぶ
4. 変換後（コピー / ダウンロード）を選ぶ
5. `変換` を実行

画像取込方式（note URL参照 / 画像ダウンロード / Base64埋込）は **オプション画面** で設定します。

### ダウンロード（重要）

ダウンロード機能は **保存先プリセットのフォルダ設定が必須** です。

1. popup 右上の歯車からオプションを開く
2. `保存先プリセット設定` で `プリセット1〜3` のいずれかにフォルダを設定
3. popup で設定済みプリセットを選び、`ダウンロード` を実行

未設定の場合はエラーになります。  
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

- **選択する**: 記事リンクを 1 本クリックして即実行
- **複数選択**: 複数リンクを選んで一括実行
- **一覧を全選択**: 一覧コンテナ配下の記事リンクをまとめて選択

### Obsidianで活用する

オプション画面の `Obsidianで活用する` で:

- `Obsidianリンク化する` を ON/OFF
- リンク化対象ワードを登録/削除

ON 時、本文中の一致ワードを `[[単語]]` に変換します。  
既存リンク・画像リンク・コードブロック・インラインコード・既存 `[[...]]` は保護されます。

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
| `presetObsidianLinkWords` | Obsidian リンク化ワード一覧 |
| `obsidianLinkify` | Obsidianリンク化 ON/OFF |

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
| `content/content.js` | 記事ページでの変換 API、リンク選択・一括処理 |
| `background.js` | 保存処理・ファイル存在チェック |
| `popup/` | 変換 UI |
| `options/` | 保存先プリセット / タグ候補 / Obsidian 設定 |
| `manifest.json` | Manifest V3 定義 |

## ベース実装

[note2zenn-hanaviye](https://github.com/) の DOM 変換ロジックをベースに、ブラウザ向けに移植しています。

/**
 * UI 文言のローカライズ（日本語 / 英語）。
 * popup / options / content script / background から NtmI18n として利用する。
 *
 * chrome.i18n は必ずブラウザの UI 言語に従い、ユーザーが拡張機能だけ英語に
 * 切り替えることができない。そのためカタログは自前で持ち、表示言語を
 * chrome.storage.local の uiLanguage（auto / ja / en）で上書きできるようにする。
 * chrome.i18n は「自動」のときの判定にのみ使う。
 */
(function (global) {
  const LANGUAGE_SETTINGS = ["auto", "ja", "en"];
  const LOCALES = ["ja", "en"];
  const FALLBACK_LOCALE = "ja";
  const STORAGE_KEY = "uiLanguage";

  const MESSAGES = {
    ja: {
      /* ------------------------------ 共通 ------------------------------ */
      "common.add": "追加",
      "common.remove": "削除",
      "common.cancel": "キャンセル",
      "common.folderUnset": "未設定（フォルダ未選択）",
      "common.folderUnknown": "フォルダ名不明",
      "common.unknownError": "不明なエラー",
      "preset.defaultName": "プリセット{index}",
      "preset.folderSelected": "選択済み",
      "preset.optionSuffixConfigured": " ({label})",
      "preset.optionSuffixUnset": " (未設定)",

      /* ---------------------------- エラー共通 ---------------------------- */
      "error.presetFolderRequired":
        "ダウンロードには保存先プリセットのフォルダ設定が必要です。設定（歯車）から「保存先プリセット設定」でフォルダを選択してください。",
      "error.imageFolderRequired":
        "画像ダウンロードには画像保存先フォルダの設定が必要です。オプション画面の「画像取込方式」でフォルダを選択してください。",
      "error.noActiveTab": "アクティブなタブを取得できません。",
      "error.notNoteArticlePage": "note.com の記事ページ（/n/...）で開いてください。",
      "error.invalidArticleUrl": "note.com の記事 URL（/n/...）を入力してください。",
      "error.urlRequired": "記事 URL を入力してください。",
      "error.reloadAndRetry": "ページを再読み込みしてから、もう一度お試しください。",
      "error.titleUnavailable": "タイトルを取得できませんでした。",
      "error.convertFailed": "変換に失敗しました。",
      "error.copyFailed": "クリップボードへのコピーに失敗しました。",
      "error.downloadFailed": "ダウンロードに失敗しました。",
      "error.saveImagesFailed": "画像の保存に失敗しました。",
      "error.fetchTimeout": "記事の取得がタイムアウトしました。",
      "error.fetchFromUrlFailed": "URL から記事を取得できませんでした。",
      "error.fetchArticleFailed": "記事の取得に失敗しました。",
      "error.fetchFailedHttp": "記事の取得に失敗しました（HTTP {status}）。",
      "error.noArticleSelected": "記事URLが選択されていません。",
      "error.processFailed": "処理に失敗しました。",
      "error.allFailed": "すべての処理に失敗しました。",

      /* ------------------------------ popup ----------------------------- */
      "popup.subtitle": "note 記事を Markdown に変換します",
      "popup.settings": "設定",
      "popup.likeCount": "ダウンロード済みの記事のスキ数を更新",
      "popup.openSidePanel": "サイドバーで開く",
      "popup.error.openSidePanelFailed": "サイドバーを開けませんでした。ブラウザのバージョンをご確認ください。",
      "popup.source.title": "変換元",
      "popup.source.tab": "現在のタブ",
      "popup.source.url": "URL を指定",
      "popup.source.targetLabel": "処理対象",
      "popup.source.articleUrlLabel": "記事 URL",
      "popup.pick.single": "選択する",
      "popup.pick.multi": "複数選択",
      "popup.tags.title": "タグ（候補から複数選択）",
      "popup.tags.setLabel": "タグセット",
      "popup.tags.none": "選択なし",
      "popup.tags.emptyHint": "候補タグが未設定です。オプション画面で登録してください。",
      "popup.tags.setApplied": "タグセット「{name}」を適用しました。",
      "popup.tags.maxSelected": "タグは最大{max}つまで選択できます。",
      "popup.output.title": "変換後",
      "popup.output.ariaLabel": "変換後の操作",
      "popup.output.copy": "コピー",
      "popup.output.download": "ダウンロード",
      "popup.output.presetLabel": "保存先プリセット",
      "popup.output.presetHint":
        "ダウンロードには保存先フォルダの設定が必要です。右上の設定から「保存先プリセット設定」でフォルダを選択してください。",
      "popup.convert": "変換",
      "popup.status.converting": "変換中…",
      "popup.status.loadingTitle": "取得中…",
      "popup.status.pickStarted": "ページ上で記事リンクをクリックしてください。選択後に自動実行します。",
      "popup.status.multiPickStarted":
        "記事リンクを複数クリックしてください。ページ上パネルの実行ボタンで一括ダウンロードします。",
      "popup.status.multiDownloadOnly":
        "一括はダウンロードのみ対応です。変換後をダウンロードにしてください。",
      "popup.status.pickedUrl": "記事URLを取得しました。ページ上で処理を実行しています。",
      "popup.status.pickedUrlFailed": "記事URLの取得に失敗しました。",
      "popup.error.openNoteForSinglePick": "note.com ページを開いてから「選択する」を押してください。",
      "popup.error.openNoteForMultiPick": "note.com ページを開いてから「複数選択」を押してください。",
      "popup.error.startSinglePickFailed": "リンク選択モードを開始できませんでした。",
      "popup.error.startMultiPickFailed": "複数選択モードを開始できませんでした。",
      "popup.splash.overwrittenTitle": "上書き保存しました",
      "popup.splash.overwrittenMessage": "更新しました: {filename}",
      "popup.splash.downloadedTitle": "ダウンロード完了",
      "popup.splash.downloadedMessage": "保存しました: {filename}",
      "popup.splash.copiedTitle": "コピー完了",
      "popup.splash.copiedMessage": "コピーしました: {title}",

      /* -------------------------- content script ------------------------- */
      "content.untitled": "（タイトル不明）",
      "content.panel.count": "選択中: {count}件",
      "content.panel.progress": "{current}/{total} 件変換中...",
      "content.panel.run": "実行",
      "content.panel.cancel": "中止",
      "content.panel.cancelling": "中止中...",
      "content.panel.selectVisible": "一覧を全選択",
      "content.panel.clear": "解除",
      "content.panel.exit": "終了",
      "content.panel.escHint": "Esc で終了",
      "content.toast.noListArticles": "一覧内に選択可能な記事リンクが見つかりません。",
      "content.toast.listAlreadySelected": "一覧の記事はすでに選択済みです。",
      "content.toast.addedFromList": "一覧から {count}件 追加しました。",
      "content.toast.selectionCleared": "選択を解除しました。",
      "content.toast.singlePickExited": "選択モードを終了しました。",
      "content.toast.multiPickExited": "複数選択モードを終了しました。",
      "content.toast.cancelRequested": "中止します。現在の記事の処理完了後に停止します。",
      "content.toast.processing": "記事を処理しています…",
      "content.toast.processFailed": "処理失敗: {message}",
      "content.toast.added": "追加しました: {count}件",
      "content.toast.removed": "解除しました: {count}件",
      "content.toast.singlePickStart": "記事リンクをクリックしてください（Esc で終了）。",
      "content.toast.singlePickStartFromMulti":
        "複数選択モードを終了しました。記事リンクをクリックしてください（Esc で終了）。",
      "content.toast.multiPickStart": "複数選択モード開始。記事リンクをクリックしてください（Esc で終了）。",
      "content.toast.overwritten": "上書き保存: {filename}",
      "content.toast.downloaded": "ダウンロード完了: {title}",
      "content.toast.copied": "コピー完了: {title}",
      "content.toast.savedProgress": "保存完了 ({current}/{total}): {title}",
      "content.toast.overwrittenProgress": "上書き保存 ({current}/{total}): {title}",
      "content.result.overwritten": "上書き保存しました: {filename}",
      "content.result.saved": "保存しました: {title}",
      "content.result.copied": "コピーしました: {title}",
      "content.summary.done": "一括完了",
      "content.summary.cancelled": "中止しました",
      "content.summary.counts": "{state}: 新規保存 {saved}件 / 上書き {overwritten}件 / 失敗 {failed}件",
      "content.summary.remaining": " / 未処理 {count}件",
      "content.error.multiRunning":
        "一括処理を実行中です。ページ上のパネルで中止してから操作してください。",
      "content.log.convertFailed": "変換失敗",

      /* --------------------------- background ---------------------------- */
      "background.imageFolderMissing":
        "画像保存先フォルダが見つかりません。オプション画面からフォルダを再選択してください。",
      "background.imageFolderPermissionLost":
        "画像保存先フォルダへのアクセス権限が失効しています。オプション画面の「アクセスを再許可」ボタンから許可し直してください。",
      "background.presetFolderUnset":
        "「{name}」に保存先フォルダが設定されていません。{detail}",
      "background.presetFolderMissing":
        "「{name}」の保存先フォルダが見つかりません。設定画面からフォルダを再選択してください。",
      "background.presetFolderPermissionLost":
        "「{name}」の保存先フォルダへのアクセス権限が失効しています。設定画面の「アクセスを再許可」ボタンから許可し直してください。",
      "background.imageUrlNotAllowed": "許可されていない画像URLです。",
      "background.imageFetchFailedHttp": "画像の取得に失敗しました（HTTP {status}）。",
      "background.imageSaveFailedDetail": "画像の保存に失敗しました。\n{details}",
      "background.imageSavePartialFailure": "一部の画像保存に失敗:",

      /* ---------------------------- オプション ---------------------------- */
      "options.documentTitle": "note to Markdown — 設定",
      "options.pageTitle": "設定",
      "options.pageIntro":
        "popup から変換する際の保存先・タグ・画像・Obsidian 向けオプションを管理します。",

      "options.language.title": "表示言語",
      "options.language.hint":
        "popup・オプション画面・ページ上の通知で使う言語を選びます。「自動」はブラウザの表示言語に従います。",
      "options.language.label": "言語",
      "options.language.auto": "自動（ブラウザの言語に従う）",
      "options.language.ja": "日本語",
      "options.language.en": "English",
      "options.language.saved": "表示言語を「{label}」に設定しました。",

      "options.preset.title": "保存先プリセット設定",
      "options.preset.hint":
        "ダウンロードを使うには、いずれかのプリセットで保存先フォルダを選択してください（必須）。Downloads フォルダ直下への保存はできません。サブフォルダ（例: Downloads\\note-markdown）を指定してください。",
      "options.preset.nameLabel": "表示名",
      "options.preset.namePlaceholder1": "例: 仕事メモ",
      "options.preset.namePlaceholder2": "例: Obsidian Inbox",
      "options.preset.namePlaceholder3": "例: 公開記事",
      "options.preset.namePlaceholder": "例: 保存先の名前",
      "options.preset.pick": "フォルダを選択",
      "options.preset.clear": "解除",
      "options.preset.grant": "アクセスを再許可",
      "options.preset.folderUnsetForDownload": "未設定（ダウンロード不可 — フォルダを選択してください）",
      "options.preset.folderConfigured": "設定済み: {name}",
      "options.preset.folderNeedsPermission": "設定済み: {name}（アクセス許可の再取得が必要）",
      "options.preset.folderNotFound": "{name}（フォルダ情報が見つかりません。選択し直してください）",
      "options.preset.nameSaved": "プリセット名を保存しました。",
      "options.preset.folderSaved": "保存先フォルダを設定しました。",
      "options.preset.folderCleared": "保存先フォルダを解除しました。",
      "options.folder.writeDenied": "フォルダの書き込み権限が許可されませんでした。",
      "options.folder.pickFailed": "フォルダ設定に失敗しました。",
      "options.folder.clearFailed": "解除に失敗しました。",
      "options.folder.handleMissing": "フォルダ情報が見つかりません。フォルダを選択し直してください。",
      "options.folder.grantSucceeded": "フォルダへのアクセスを再許可しました。",
      "options.folder.grantDenied": "アクセスが許可されませんでした。もう一度お試しください。",
      "options.folder.grantFailed": "アクセスの再許可に失敗しました。フォルダを選択し直してください。",

      "options.image.title": "画像取込方式",
      "options.image.hint":
        "変換時の画像の扱いを選びます。画像ダウンロードを選ぶ場合は、Markdown 保存先とは別の画像保存先フォルダを設定してください（必須）。",
      "options.image.modeUrl": "note URL参照",
      "options.image.modeDownload": "画像ダウンロード（note ID フォルダ内に img1.png 形式で保存）",
      "options.image.modeBase64": "Base64埋込",
      "options.image.modeUrlShort": "note URL参照",
      "options.image.modeDownloadShort": "画像ダウンロード",
      "options.image.modeBase64Short": "Base64埋込",
      "options.image.folderHint":
        "指定フォルダ配下に note ID のフォルダを作成し、その中へ画像を保存します。Markdown からは {noteId}/img1.png 形式で参照します。",
      "options.image.modeSaved": "画像取込方式を「{label}」に設定しました。",
      "options.image.folderSaved": "画像保存先フォルダを設定しました。",
      "options.image.folderCleared": "画像保存先フォルダを解除しました。",

      "options.tag.title": "タグ候補",
      "options.tag.hint":
        "事前に使うタグを1つずつ登録しておくと、popup ではチェックで複数選択できます。",
      "options.tag.placeholder": "例: 学習メモ",
      "options.tag.bulkAdd": "改行で一括追加",
      "options.tag.empty": "タグ候補はまだありません。",
      "options.tag.nameRequired": "タグ名を入力してください。",
      "options.tag.duplicate": "同じタグは既に登録されています。",
      "options.tag.added": "タグ「{tag}」を追加しました。",
      "options.tag.removed": "タグ「{tag}」を削除しました。",
      "options.tag.removedWithSets": "タグ「{tag}」を削除しました（タグセットからも除外しました）。",
      "options.tag.bulkRequired": "追加するタグを入力してください。",
      "options.tag.bulkAdded": "タグを一括登録しました（追加 {added} / 重複スキップ {skipped}）。",

      "options.tagSet.title": "タグセットプリセット",
      "options.tagSet.hint":
        "よく使うタグの組み合わせを登録しておくと、popup で一括選択できます（1セット最大 {maxTags} タグ / 最大 {maxSets} セット）。",
      "options.tagSet.nameLabel": "セット名",
      "options.tagSet.namePlaceholder": "例: 技術ノート",
      "options.tagSet.selectHint": "タグ候補から選択（最大 {max} つ）",
      "options.tagSet.tagsEmpty": "先に「タグ候補」でタグを登録してください。",
      "options.tagSet.save": "セットを追加",
      "options.tagSet.update": "セットを更新",
      "options.tagSet.cancelEdit": "編集をやめる",
      "options.tagSet.empty": "タグセットはまだありません。",
      "options.tagSet.edit": "編集",
      "options.tagSet.maxTags": "1セットに登録できるタグは最大{max}つです。",
      "options.tagSet.maxSets": "タグセットは最大{max}件までです。",
      "options.tagSet.nameRequired": "セット名を入力してください。",
      "options.tagSet.tagRequired": "タグを1つ以上選択してください。",
      "options.tagSet.duplicateName": "同じ名前のセットが既に登録されています。",
      "options.tagSet.added": "セット「{name}」を追加しました。",
      "options.tagSet.updated": "セット「{name}」を更新しました。",
      "options.tagSet.removed": "セット「{name}」を削除しました。",
      "options.tagSet.editing": "セット「{name}」を編集中です。",
      "options.tagSet.editCancelled": "編集を中止しました。",

      "options.obsidian.title": "Obsidianで活用する",
      "options.obsidian.toggle": "Obsidianリンク化する",
      "options.obsidian.hint": "ON にすると、下記ワードが本文中で [[単語]] に変換されます。",
      "options.obsidian.placeholder": "例: Obsidian",
      "options.obsidian.empty": "リンク化ワードはまだありません。",
      "options.obsidian.wordRequired": "ワードを入力してください。",
      "options.obsidian.duplicate": "同じワードは既に登録されています。",
      "options.obsidian.added": "ワード「{word}」を追加しました。",
      "options.obsidian.removed": "ワード「{word}」を削除しました。",
      "options.obsidian.enabled": "Obsidianリンク化を有効にしました。",
      "options.obsidian.disabled": "Obsidianリンク化を無効にしました。",
      "options.obsidian.bulkRequired": "追加するワードを入力してください。",
      "options.obsidian.bulkAdded": "ワードを一括登録しました（追加 {added} / 重複スキップ {skipped}）。",

      "options.bulk.title": "改行で一括追加",
      "options.bulk.hint": "1行に1件入力してください。既に登録済みの値は自動でスキップされます。",
      "options.bulk.submit": "登録する",
      "options.bulk.tagTitle": "タグ候補を改行で一括追加",
      "options.bulk.tagHint": "1行に1タグを入力してください。既に登録済みのタグは自動でスキップします。",
      "options.bulk.tagPlaceholder": "例:\n学習メモ\n技術検証",
      "options.bulk.obsidianTitle": "Obsidianリンクワードを改行で一括追加",
      "options.bulk.obsidianHint": "1行に1ワードを入力してください。既に登録済みのワードは自動でスキップします。",
      "options.bulk.obsidianPlaceholder": "例:\nObsidian\nnote",

      "options.likeCount.title": "スキ数を更新",
      "options.likeCount.hint":
        "保存先プリセットのフォルダ配下にある変換済み .md を走査し、frontmatter の like_count を note の最新値へ更新します。サブフォルダも対象です。",
      "options.likeCount.presetLabel": "対象フォルダ",
      "options.likeCount.noPreset":
        "フォルダを設定したプリセットがありません。先に「保存先プリセット設定」でフォルダを選んでください。",
      "options.likeCount.run": "スキ数を更新",
      "options.likeCount.cancel": "中止",
      "options.likeCount.scanning": "対象を確認しています…",
      "options.likeCount.confirmTitle": "スキ数を更新します",
      "options.likeCount.confirmBody":
        "「{folder}」配下で .md を {total}件 見つけました。うち {targets}件 を更新対象として note へ問い合わせます。",
      "options.likeCount.confirmSkipped": "{count}件は note_id を特定できないため対象外です。",
      "options.likeCount.confirmWarning": "ファイルを書き換えます。取り消しはできません。",
      "options.likeCount.confirmRun": "更新する",
      "options.likeCount.noTargets": "更新できる .md が見つかりませんでした。",
      "options.likeCount.progress": "{current}/{total} 件を処理中…",
      "options.likeCount.cancelling": "中止しています…",
      "options.likeCount.done":
        "完了: 更新 {updated}件 / 変更なし {unchanged}件 / 対象外 {skipped}件 / 失敗 {failed}件",
      "options.likeCount.cancelled":
        "中止しました: 更新 {updated}件 / 変更なし {unchanged}件 / 未処理 {remaining}件",
      "options.likeCount.permissionRequired":
        "フォルダへのアクセス権限がありません。「保存先プリセット設定」の「アクセスを再許可」から許可し直してください。",
      "options.likeCount.failed": "スキ数の更新に失敗しました。",

      "options.transfer.title": "設定のインポート / エクスポート",
      "options.transfer.hint":
        "タグ候補・タグセットプリセット・Obsidian リンク化設定を JSON ファイルで持ち出し／取り込みできます。保存先フォルダはブラウザの権限に紐づくため対象外です（取り込み後に選び直してください）。",
      "options.transfer.export": "エクスポート",
      "options.transfer.import": "インポート",
      "options.transfer.importHint":
        "インポートは既存の設定へ追加（マージ）します。同じタグ・同じ名前のセット・同じワードはスキップされ、既存の登録が消えることはありません。",
      "options.transfer.exported": "設定をエクスポートしました（{filename}）。",
      "options.transfer.exportFailed": "エクスポートに失敗しました。",
      "options.transfer.readFailed": "ファイルを読み込めませんでした。",
      "options.transfer.invalidFormat":
        "この拡張機能のエクスポートファイルではありません。JSON の内容を確認してください。",
      "options.transfer.unsupportedVersion": "対応していないファイル形式のバージョンです（version {version}）。",
      "options.transfer.nothingToImport": "取り込める設定が含まれていません。",
      "options.transfer.imported":
        "インポートしました（タグ +{tags} / タグセット +{tagSets} / Obsidianワード +{words}、重複スキップ {skipped}）。",
      "options.transfer.tagSetsDropped": " ※タグセットは最大{max}件のため {dropped}件を取り込めませんでした。",
      "options.transfer.linkifyEnabled": " Obsidianリンク化を有効にしました。",
    },

    en: {
      /* ------------------------------ Common ----------------------------- */
      "common.add": "Add",
      "common.remove": "Remove",
      "common.cancel": "Cancel",
      "common.folderUnset": "Not set (no folder selected)",
      "common.folderUnknown": "Unknown folder",
      "common.unknownError": "Unknown error",
      "preset.defaultName": "Preset {index}",
      "preset.folderSelected": "selected",
      "preset.optionSuffixConfigured": " ({label})",
      "preset.optionSuffixUnset": " (not set)",

      /* ------------------------------ Errors ----------------------------- */
      "error.presetFolderRequired":
        "Downloading requires a destination folder on a save preset. Open the settings (gear icon) and choose a folder under “Save destination presets”.",
      "error.imageFolderRequired":
        "Downloading images requires an image destination folder. Choose one under “Image handling” on the options page.",
      "error.noActiveTab": "Could not read the active tab.",
      "error.notNoteArticlePage": "Open a note.com article page (/n/...) first.",
      "error.invalidArticleUrl": "Enter a note.com article URL (/n/...).",
      "error.urlRequired": "Enter the article URL.",
      "error.reloadAndRetry": "Reload the page and try again.",
      "error.titleUnavailable": "Could not read the article title.",
      "error.convertFailed": "Conversion failed.",
      "error.copyFailed": "Could not copy to the clipboard.",
      "error.downloadFailed": "Download failed.",
      "error.saveImagesFailed": "Could not save the images.",
      "error.fetchTimeout": "Timed out while fetching the article.",
      "error.fetchFromUrlFailed": "Could not fetch the article from that URL.",
      "error.fetchArticleFailed": "Could not fetch the article.",
      "error.fetchFailedHttp": "Could not fetch the article (HTTP {status}).",
      "error.noArticleSelected": "No article URL is selected.",
      "error.processFailed": "Processing failed.",
      "error.allFailed": "Every article failed to process.",

      /* ------------------------------ Popup ------------------------------ */
      "popup.subtitle": "Convert note articles to Markdown",
      "popup.settings": "Settings",
      "popup.likeCount": "Refresh like counts for downloaded articles",
      "popup.openSidePanel": "Open in side panel",
      "popup.error.openSidePanelFailed": "Could not open the side panel. Check your browser version.",
      "popup.source.title": "Source",
      "popup.source.tab": "Current tab",
      "popup.source.url": "Enter a URL",
      "popup.source.targetLabel": "Target",
      "popup.source.articleUrlLabel": "Article URL",
      "popup.pick.single": "Pick a link",
      "popup.pick.multi": "Pick several",
      "popup.tags.title": "Tags (choose from your candidates)",
      "popup.tags.setLabel": "Tag set",
      "popup.tags.none": "None",
      "popup.tags.emptyHint": "No tag candidates yet. Add them on the options page.",
      "popup.tags.setApplied": "Applied the tag set “{name}”.",
      "popup.tags.maxSelected": "You can select up to {max} tags.",
      "popup.output.title": "Output",
      "popup.output.ariaLabel": "What to do after converting",
      "popup.output.copy": "Copy",
      "popup.output.download": "Download",
      "popup.output.presetLabel": "Save preset",
      "popup.output.presetHint":
        "Downloading requires a destination folder. Open the settings at the top right and choose a folder under “Save destination presets”.",
      "popup.convert": "Convert",
      "popup.status.converting": "Converting…",
      "popup.status.loadingTitle": "Loading…",
      "popup.status.pickStarted": "Click an article link on the page. It runs automatically once picked.",
      "popup.status.multiPickStarted":
        "Click several article links. Use the Run button on the in-page panel to download them all.",
      "popup.status.multiDownloadOnly": "Batch mode supports downloading only. Set the output to Download.",
      "popup.status.pickedUrl": "Got the article URL. Processing it on the page.",
      "popup.status.pickedUrlFailed": "Could not read the article URL.",
      "popup.error.openNoteForSinglePick": "Open a note.com page before using “Pick a link”.",
      "popup.error.openNoteForMultiPick": "Open a note.com page before using “Pick several”.",
      "popup.error.startSinglePickFailed": "Could not start link picking mode.",
      "popup.error.startMultiPickFailed": "Could not start multi-select mode.",
      "popup.splash.overwrittenTitle": "Overwritten",
      "popup.splash.overwrittenMessage": "Updated: {filename}",
      "popup.splash.downloadedTitle": "Download complete",
      "popup.splash.downloadedMessage": "Saved: {filename}",
      "popup.splash.copiedTitle": "Copied",
      "popup.splash.copiedMessage": "Copied: {title}",

      /* -------------------------- Content script ------------------------- */
      "content.untitled": "(untitled)",
      "content.panel.count": "Selected: {count}",
      "content.panel.progress": "Converting {current}/{total}…",
      "content.panel.run": "Run",
      "content.panel.cancel": "Stop",
      "content.panel.cancelling": "Stopping…",
      "content.panel.selectVisible": "Select all in list",
      "content.panel.clear": "Clear",
      "content.panel.exit": "Exit",
      "content.panel.escHint": "Esc to exit",
      "content.toast.noListArticles": "No selectable article links were found in the list.",
      "content.toast.listAlreadySelected": "Every article in the list is already selected.",
      "content.toast.addedFromList": "Added {count} article(s) from the list.",
      "content.toast.selectionCleared": "Cleared the selection.",
      "content.toast.singlePickExited": "Left link picking mode.",
      "content.toast.multiPickExited": "Left multi-select mode.",
      "content.toast.cancelRequested": "Stopping after the current article finishes.",
      "content.toast.processing": "Processing the article…",
      "content.toast.processFailed": "Failed: {message}",
      "content.toast.added": "Added: {count} selected",
      "content.toast.removed": "Removed: {count} selected",
      "content.toast.singlePickStart": "Click an article link (Esc to exit).",
      "content.toast.singlePickStartFromMulti":
        "Left multi-select mode. Click an article link (Esc to exit).",
      "content.toast.multiPickStart": "Multi-select mode started. Click article links (Esc to exit).",
      "content.toast.overwritten": "Overwritten: {filename}",
      "content.toast.downloaded": "Downloaded: {title}",
      "content.toast.copied": "Copied: {title}",
      "content.toast.savedProgress": "Saved ({current}/{total}): {title}",
      "content.toast.overwrittenProgress": "Overwritten ({current}/{total}): {title}",
      "content.result.overwritten": "Overwritten: {filename}",
      "content.result.saved": "Saved: {title}",
      "content.result.copied": "Copied: {title}",
      "content.summary.done": "Batch complete",
      "content.summary.cancelled": "Stopped",
      "content.summary.counts": "{state}: {saved} saved / {overwritten} overwritten / {failed} failed",
      "content.summary.remaining": " / {count} left",
      "content.error.multiRunning":
        "A batch run is in progress. Stop it from the in-page panel before switching modes.",
      "content.log.convertFailed": "Conversion failed",

      /* ---------------------------- Background --------------------------- */
      "background.imageFolderMissing":
        "The image destination folder is missing. Pick it again on the options page.",
      "background.imageFolderPermissionLost":
        "Access to the image destination folder has expired. Use the “Re-grant access” button on the options page.",
      "background.presetFolderUnset": "“{name}” has no destination folder. {detail}",
      "background.presetFolderMissing":
        "The destination folder for “{name}” is missing. Pick it again on the options page.",
      "background.presetFolderPermissionLost":
        "Access to the destination folder for “{name}” has expired. Use the “Re-grant access” button on the options page.",
      "background.imageUrlNotAllowed": "That image URL is not allowed.",
      "background.imageFetchFailedHttp": "Could not fetch the image (HTTP {status}).",
      "background.imageSaveFailedDetail": "Could not save the images.\n{details}",
      "background.imageSavePartialFailure": "Some images could not be saved:",

      /* ------------------------------ Options ---------------------------- */
      "options.documentTitle": "note to Markdown — Settings",
      "options.pageTitle": "Settings",
      "options.pageIntro":
        "Manage the destinations, tags, image handling, and Obsidian options used when converting from the popup.",

      "options.language.title": "Display language",
      "options.language.hint":
        "Choose the language used in the popup, this options page, and in-page notifications. “Automatic” follows your browser language.",
      "options.language.label": "Language",
      "options.language.auto": "Automatic (follow browser language)",
      "options.language.ja": "日本語",
      "options.language.en": "English",
      "options.language.saved": "Display language set to “{label}”.",

      "options.preset.title": "Save destination presets",
      "options.preset.hint":
        "To use downloading, choose a destination folder on at least one preset (required). Saving directly into the Downloads folder is not allowed — pick a subfolder (for example Downloads\\note-markdown).",
      "options.preset.nameLabel": "Display name",
      "options.preset.namePlaceholder1": "e.g. Work notes",
      "options.preset.namePlaceholder2": "e.g. Obsidian Inbox",
      "options.preset.namePlaceholder3": "e.g. Published posts",
      "options.preset.namePlaceholder": "e.g. Destination name",
      "options.preset.pick": "Choose folder",
      "options.preset.clear": "Clear",
      "options.preset.grant": "Re-grant access",
      "options.preset.folderUnsetForDownload": "Not set (downloads unavailable — choose a folder)",
      "options.preset.folderConfigured": "Set: {name}",
      "options.preset.folderNeedsPermission": "Set: {name} (access needs to be granted again)",
      "options.preset.folderNotFound": "{name} (folder information is missing — choose it again)",
      "options.preset.nameSaved": "Saved the preset name.",
      "options.preset.folderSaved": "Saved the destination folder.",
      "options.preset.folderCleared": "Cleared the destination folder.",
      "options.folder.writeDenied": "Write access to the folder was not granted.",
      "options.folder.pickFailed": "Could not set the folder.",
      "options.folder.clearFailed": "Could not clear the folder.",
      "options.folder.handleMissing": "Folder information is missing. Choose the folder again.",
      "options.folder.grantSucceeded": "Access to the folder was granted again.",
      "options.folder.grantDenied": "Access was not granted. Please try again.",
      "options.folder.grantFailed": "Could not re-grant access. Choose the folder again.",

      "options.image.title": "Image handling",
      "options.image.hint":
        "Choose how images are handled during conversion. For “Download images”, set an image folder separate from the Markdown destination (required).",
      "options.image.modeUrl": "Reference note URLs",
      "options.image.modeDownload": "Download images (saved as img1.png inside a note ID folder)",
      "options.image.modeBase64": "Embed as Base64",
      "options.image.modeUrlShort": "Reference note URLs",
      "options.image.modeDownloadShort": "Download images",
      "options.image.modeBase64Short": "Embed as Base64",
      "options.image.folderHint":
        "A folder named after the note ID is created under the chosen folder, and images are saved there. Markdown references them as {noteId}/img1.png.",
      "options.image.modeSaved": "Image handling set to “{label}”.",
      "options.image.folderSaved": "Saved the image destination folder.",
      "options.image.folderCleared": "Cleared the image destination folder.",

      "options.tag.title": "Tag candidates",
      "options.tag.hint":
        "Register the tags you use ahead of time, then tick the ones you want in the popup.",
      "options.tag.placeholder": "e.g. study-notes",
      "options.tag.bulkAdd": "Bulk add (one per line)",
      "options.tag.empty": "No tag candidates yet.",
      "options.tag.nameRequired": "Enter a tag name.",
      "options.tag.duplicate": "That tag is already registered.",
      "options.tag.added": "Added the tag “{tag}”.",
      "options.tag.removed": "Removed the tag “{tag}”.",
      "options.tag.removedWithSets": "Removed the tag “{tag}” (also dropped from tag sets).",
      "options.tag.bulkRequired": "Enter the tags to add.",
      "options.tag.bulkAdded": "Bulk added tags ({added} added / {skipped} duplicates skipped).",

      "options.tagSet.title": "Tag set presets",
      "options.tagSet.hint":
        "Save the tag combinations you use often and apply them in one step from the popup (up to {maxTags} tags per set, {maxSets} sets).",
      "options.tagSet.nameLabel": "Set name",
      "options.tagSet.namePlaceholder": "e.g. Tech notes",
      "options.tagSet.selectHint": "Choose from your tag candidates (up to {max})",
      "options.tagSet.tagsEmpty": "Register tags under “Tag candidates” first.",
      "options.tagSet.save": "Add set",
      "options.tagSet.update": "Update set",
      "options.tagSet.cancelEdit": "Cancel editing",
      "options.tagSet.empty": "No tag sets yet.",
      "options.tagSet.edit": "Edit",
      "options.tagSet.maxTags": "A set can hold at most {max} tags.",
      "options.tagSet.maxSets": "You can register at most {max} tag sets.",
      "options.tagSet.nameRequired": "Enter a set name.",
      "options.tagSet.tagRequired": "Select at least one tag.",
      "options.tagSet.duplicateName": "A set with that name already exists.",
      "options.tagSet.added": "Added the set “{name}”.",
      "options.tagSet.updated": "Updated the set “{name}”.",
      "options.tagSet.removed": "Removed the set “{name}”.",
      "options.tagSet.editing": "Editing the set “{name}”.",
      "options.tagSet.editCancelled": "Stopped editing.",

      "options.obsidian.title": "Use with Obsidian",
      "options.obsidian.toggle": "Create Obsidian links",
      "options.obsidian.hint": "When on, the words below are converted to [[word]] in the body.",
      "options.obsidian.placeholder": "e.g. Obsidian",
      "options.obsidian.empty": "No link words yet.",
      "options.obsidian.wordRequired": "Enter a word.",
      "options.obsidian.duplicate": "That word is already registered.",
      "options.obsidian.added": "Added the word “{word}”.",
      "options.obsidian.removed": "Removed the word “{word}”.",
      "options.obsidian.enabled": "Obsidian linking is on.",
      "options.obsidian.disabled": "Obsidian linking is off.",
      "options.obsidian.bulkRequired": "Enter the words to add.",
      "options.obsidian.bulkAdded": "Bulk added words ({added} added / {skipped} duplicates skipped).",

      "options.bulk.title": "Bulk add (one per line)",
      "options.bulk.hint": "Enter one entry per line. Values that already exist are skipped.",
      "options.bulk.submit": "Register",
      "options.bulk.tagTitle": "Bulk add tag candidates",
      "options.bulk.tagHint": "Enter one tag per line. Tags that already exist are skipped.",
      "options.bulk.tagPlaceholder": "e.g.\nstudy-notes\nexperiments",
      "options.bulk.obsidianTitle": "Bulk add Obsidian link words",
      "options.bulk.obsidianHint": "Enter one word per line. Words that already exist are skipped.",
      "options.bulk.obsidianPlaceholder": "e.g.\nObsidian\nnote",

      "options.likeCount.title": "Refresh like counts",
      "options.likeCount.hint":
        "Scans the converted .md files under a save preset's folder and updates like_count in the frontmatter to the current value on note. Subfolders are included.",
      "options.likeCount.presetLabel": "Target folder",
      "options.likeCount.noPreset":
        "No preset has a folder yet. Choose one under “Save destination presets” first.",
      "options.likeCount.run": "Refresh like counts",
      "options.likeCount.cancel": "Stop",
      "options.likeCount.scanning": "Checking what would be updated…",
      "options.likeCount.confirmTitle": "Refresh like counts",
      "options.likeCount.confirmBody":
        "Found {total} .md file(s) under “{folder}”. {targets} of them will be looked up on note.",
      "options.likeCount.confirmSkipped": "{count} file(s) have no resolvable note_id and will be left alone.",
      "options.likeCount.confirmWarning": "This rewrites the files. It cannot be undone.",
      "options.likeCount.confirmRun": "Refresh",
      "options.likeCount.noTargets": "No .md files that could be updated were found.",
      "options.likeCount.progress": "Processing {current}/{total}…",
      "options.likeCount.cancelling": "Stopping…",
      "options.likeCount.done":
        "Done: {updated} updated / {unchanged} unchanged / {skipped} skipped / {failed} failed",
      "options.likeCount.cancelled":
        "Stopped: {updated} updated / {unchanged} unchanged / {remaining} not processed",
      "options.likeCount.permissionRequired":
        "No access to that folder. Use “Re-grant access” under “Save destination presets”.",
      "options.likeCount.failed": "Could not refresh the like counts.",

      "options.transfer.title": "Import / export settings",
      "options.transfer.hint":
        "Move your tag candidates, tag set presets, and Obsidian link settings in and out as a JSON file. Destination folders are tied to browser permissions and are not included — choose them again after importing.",
      "options.transfer.export": "Export",
      "options.transfer.import": "Import",
      "options.transfer.importHint":
        "Importing merges into your existing settings. Identical tags, sets with the same name, and identical words are skipped, and nothing already registered is removed.",
      "options.transfer.exported": "Exported the settings ({filename}).",
      "options.transfer.exportFailed": "Export failed.",
      "options.transfer.readFailed": "Could not read the file.",
      "options.transfer.invalidFormat":
        "This is not an export file from this extension. Check the JSON contents.",
      "options.transfer.unsupportedVersion": "Unsupported file format version (version {version}).",
      "options.transfer.nothingToImport": "The file contains no settings to import.",
      "options.transfer.imported":
        "Imported (+{tags} tags / +{tagSets} tag sets / +{words} Obsidian words, {skipped} duplicates skipped).",
      "options.transfer.tagSetsDropped":
        " Note: {dropped} tag set(s) were not imported because the limit is {max}.",
      "options.transfer.linkifyEnabled": " Obsidian linking was turned on.",
    },
  };

  let currentSetting = "auto";
  let currentLocale = FALLBACK_LOCALE;
  let initPromise = null;

  /**
   * 保存値を言語設定として正規化する。
   * @param {unknown} value - 保存値。
   * @returns {"auto"|"ja"|"en"} 正規化後の設定。
   */
  const normalizeSetting = (value) =>
    LANGUAGE_SETTINGS.includes(value) ? value : "auto";

  /**
   * ブラウザの UI 言語から表示ロケールを判定する。
   * @returns {"ja"|"en"} 判定したロケール。
   */
  const detectLocale = () => {
    let uiLanguage = "";
    try {
      uiLanguage = chrome?.i18n?.getUILanguage?.() ?? "";
    } catch {
      uiLanguage = "";
    }
    if (!uiLanguage && typeof navigator !== "undefined") {
      uiLanguage = navigator.language ?? "";
    }
    return String(uiLanguage).toLowerCase().startsWith("ja") ? "ja" : "en";
  };

  /**
   * 言語設定から実際に使うロケールを解決する。
   * @param {"auto"|"ja"|"en"} setting - 言語設定。
   * @returns {"ja"|"en"} 表示ロケール。
   */
  const resolveLocale = (setting) =>
    LOCALES.includes(setting) ? setting : detectLocale();

  currentLocale = resolveLocale(currentSetting);

  /**
   * {name} 形式のプレースホルダを置換する。
   * @param {string} template - 文言テンプレート。
   * @param {Record<string, unknown>} params - 置換値。
   * @returns {string} 置換後の文言。
   */
  const interpolate = (template, params) => {
    if (!params) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, key) =>
      key in params ? String(params[key]) : match
    );
  };

  /**
   * 現在のロケールで文言を取得する。
   * 未定義キーは日本語カタログ、それも無ければキー自身へフォールバックする。
   * @param {string} key - メッセージキー。
   * @param {Record<string, unknown>} [params] - プレースホルダ置換値。
   * @returns {string} 文言。
   */
  const t = (key, params) => {
    const template =
      MESSAGES[currentLocale]?.[key] ?? MESSAGES[FALLBACK_LOCALE]?.[key] ?? key;
    return interpolate(template, params);
  };

  /**
   * chrome.storage.local から言語設定を読み直し、現在のロケールへ反映する。
   * @returns {Promise<"ja"|"en">} 反映後のロケール。
   */
  const reload = async () => {
    let stored = {};
    try {
      stored = (await chrome?.storage?.local?.get?.([STORAGE_KEY])) ?? {};
    } catch {
      stored = {};
    }
    currentSetting = normalizeSetting(stored[STORAGE_KEY]);
    currentLocale = resolveLocale(currentSetting);
    return currentLocale;
  };

  /**
   * 言語設定の読み込みを一度だけ行う。
   * どこから呼んでも同じ Promise を返すため、待ち合わせに使える。
   * @returns {Promise<"ja"|"en">} 表示ロケール。
   */
  const init = () => {
    if (!initPromise) {
      initPromise = reload();
    }
    return initPromise;
  };

  /**
   * 言語設定を保存し、現在のロケールへ反映する。
   * @param {"auto"|"ja"|"en"} value - 保存する設定。
   * @returns {Promise<"ja"|"en">} 反映後のロケール。
   */
  const setLanguage = async (value) => {
    const setting = normalizeSetting(value);
    await chrome.storage.local.set({ [STORAGE_KEY]: setting });
    currentSetting = setting;
    currentLocale = resolveLocale(setting);
    initPromise = Promise.resolve(currentLocale);
    return currentLocale;
  };

  const DOM_ATTRIBUTE_BINDINGS = [
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-title", "title"],
    ["data-i18n-aria-label", "aria-label"],
  ];

  /**
   * data-i18n 属性を持つ要素へ現在のロケールの文言を流し込む。
   * 動的に生成した要素にも使えるよう、任意のルートを受け取る。
   * @param {ParentNode & {ownerDocument?: Document}} [root=document] - 適用対象。
   */
  const applyDom = (root) => {
    const target = root ?? (typeof document !== "undefined" ? document : null);
    if (!target?.querySelectorAll) {
      return;
    }

    const doc = target.ownerDocument ?? target;
    if (doc?.documentElement) {
      doc.documentElement.lang = currentLocale;
    }

    target.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.getAttribute("data-i18n"));
    });

    DOM_ATTRIBUTE_BINDINGS.forEach(([dataAttribute, attribute]) => {
      target.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
        element.setAttribute(attribute, t(element.getAttribute(dataAttribute)));
      });
    });
  };

  global.NtmI18n = {
    LANGUAGE_SETTINGS,
    LOCALES,
    STORAGE_KEY,
    applyDom,
    getLocale: () => currentLocale,
    getSetting: () => currentSetting,
    init,
    normalizeSetting,
    reload,
    setLanguage,
    t,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

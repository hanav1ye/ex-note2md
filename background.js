// Service Worker: プリセット保存先フォルダへの .md 書き込みと重複チェック
const PRESET_IDS = ["preset1", "preset2", "preset3"];
const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "プリセット1", folderLabel: "", hasFolder: false },
  preset2: { name: "プリセット2", folderLabel: "", hasFolder: false },
  preset3: { name: "プリセット3", folderLabel: "", hasFolder: false },
};
const DB_NAME = "noteToMarkdownPresets";
const DB_STORE = "directoryHandles";
const IMAGE_FOLDER_HANDLE_KEY = "imageFolder";

const PRESET_FOLDER_REQUIRED_ERROR =
  "ダウンロードには保存先プリセットのフォルダ設定が必要です。設定（歯車）から「保存先プリセット設定」でフォルダを選択してください。";
const IMAGE_FOLDER_REQUIRED_ERROR =
  "画像ダウンロードには画像保存先フォルダの設定が必要です。オプション画面の「画像取込方式」でフォルダを選択してください。";

const DEFAULT_IMAGE_FOLDER_CONFIG = { folderLabel: "", hasFolder: false };

/**
 * UI表示用のプリセット名を返す。
 * @param {string} presetId - 対象プリセットID。
 * @param {{name?: string}|undefined} config - 保存済みプリセット設定。
 * @returns {string} 表示名。
 */
const presetDisplayName = (presetId, config) =>
  config?.name?.trim() || `プリセット${PRESET_IDS.indexOf(presetId) + 1}`;

/**
 * note記事URLからファイル名のベースになる noteId を抽出する。
 * 抽出失敗時は安全な既定名を返す。
 * @param {string} url - note記事URL。
 * @returns {string} 拡張子なしファイル名。
 */
const filenameFromNoteUrl = (url) => {
  try {
    const parsed = new URL(url);
    const noteIdMatch = parsed.pathname.match(/\/n\/([^/]+)/);
    const noteId = noteIdMatch?.[1];
    if (!noteId) {
      return "note-article";
    }
    return noteId.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "note-article";
  } catch {
    return "note-article";
  }
};

/**
 * 単一プリセット設定を安全な形へ正規化する。
 * @param {any} config - 任意入力のプリセット設定。
 * @param {string} fallbackName - 設定が空のときに使う表示名。
 * @returns {{name: string, folderLabel: string, hasFolder: boolean}} 正規化後設定。
 */
const sanitizePresetConfig = (config, fallbackName) => ({
  name: String(config?.name ?? fallbackName).trim() || fallbackName,
  folderLabel: String(config?.folderLabel ?? "").trim(),
  hasFolder: Boolean(config?.hasFolder),
});

/**
 * 保存済みプリセット設定全体を正規化する。
 * @param {any} configs - chrome.storage.local から取得した値。
 * @returns {{preset1: object, preset2: object, preset3: object}} 正規化後設定。
 */
const sanitizePresetConfigs = (configs) => ({
  preset1: sanitizePresetConfig(configs?.preset1, "プリセット1"),
  preset2: sanitizePresetConfig(configs?.preset2, "プリセット2"),
  preset3: sanitizePresetConfig(configs?.preset3, "プリセット3"),
});

/**
 * 画像保存先フォルダ設定を正規化する。
 * @param {any} config - 任意入力の設定。
 * @returns {{folderLabel: string, hasFolder: boolean}} 正規化後設定。
 */
const sanitizeImageFolderConfig = (config) => ({
  folderLabel: String(config?.folderLabel ?? "").trim(),
  hasFolder: Boolean(config?.hasFolder),
});

/**
 * ディレクトリハンドル保存用 IndexedDB を開く。
 * @returns {Promise<IDBDatabase>} DBインスタンス。
 */
const openPresetDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * プリセットに紐づくディレクトリハンドルを取得する。
 * @param {string} presetId - 取得対象のプリセットID。
 * @returns {Promise<FileSystemDirectoryHandle|null>} ハンドル。未保存なら null。
 */
const getPresetHandle = async (presetId) => {
  const db = await openPresetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(presetId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
};

/**
 * 画像保存先ルートフォルダを解決し、書き込み可能か検証する。
 * @returns {Promise<FileSystemDirectoryHandle>} 書き込み可能なディレクトリハンドル。
 * @throws {Error} フォルダ未設定/ハンドル消失/権限不足時。
 */
const getImageFolderHandle = async () => {
  const stored = await chrome.storage.local.get(["imageFolderConfig"]);
  const imageFolderConfig = sanitizeImageFolderConfig(
    stored.imageFolderConfig ?? DEFAULT_IMAGE_FOLDER_CONFIG
  );

  if (!imageFolderConfig.hasFolder) {
    throw new Error(IMAGE_FOLDER_REQUIRED_ERROR);
  }

  const handle = await getPresetHandle(IMAGE_FOLDER_HANDLE_KEY);
  if (!handle) {
    throw new Error("画像保存先フォルダが見つかりません。オプション画面からフォルダを再選択してください。");
  }

  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error("画像保存先フォルダへのアクセス権限がありません。オプション画面からフォルダを再選択してください。");
  }

  return handle;
};

/**
 * ダウンロード先として使うプリセットフォルダを解決し、書き込み可能か検証する。
 * @param {string} downloadPreset - popupから渡されたプリセットID。
 * @returns {Promise<FileSystemDirectoryHandle>} 書き込み可能なディレクトリハンドル。
 * @throws {Error} フォルダ未設定/ハンドル消失/権限不足時。
 */
const getPresetDirectoryHandle = async (downloadPreset) => {
  const selectedPreset = PRESET_IDS.includes(downloadPreset) ? downloadPreset : "preset1";
  const stored = await chrome.storage.local.get(["presetConfigs"]);
  const presetConfigs = sanitizePresetConfigs(stored.presetConfigs ?? DEFAULT_PRESET_CONFIGS);
  const selectedConfig = presetConfigs[selectedPreset] ?? DEFAULT_PRESET_CONFIGS[selectedPreset];

  if (!selectedConfig.hasFolder) {
    throw new Error(
      `「${presetDisplayName(selectedPreset, selectedConfig)}」に保存先フォルダが設定されていません。${PRESET_FOLDER_REQUIRED_ERROR}`
    );
  }

  const handle = await getPresetHandle(selectedPreset);
  if (!handle) {
    throw new Error(
      `「${presetDisplayName(selectedPreset, selectedConfig)}」の保存先フォルダが見つかりません。設定画面からフォルダを再選択してください。`
    );
  }

  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error(
      `「${presetDisplayName(selectedPreset, selectedConfig)}」の保存先フォルダへのアクセス権限がありません。設定画面からフォルダを再選択してください。`
    );
  }

  return handle;
};

/**
 * 指定ファイルがディレクトリ内に存在するか判定する。
 * @param {FileSystemDirectoryHandle} directoryHandle - 保存先フォルダハンドル。
 * @param {string} filename - 判定対象ファイル名。
 * @returns {Promise<boolean>} 存在時 true。
 */
const noteFileExists = async (directoryHandle, filename) => {
  try {
    await directoryHandle.getFileHandle(filename);
    return true;
  } catch (error) {
    if (error && error.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
};

/**
 * Markdown をプリセットフォルダへ保存する。
 * 同名ファイルが存在する場合は上書きする。
 * @param {{markdown: string, articleUrl: string, downloadPreset: string}} params - 保存パラメータ。
 * @returns {Promise<{overwritten: boolean, filename: string}>} 上書き有無と保存ファイル名。
 */
const downloadMarkdownByPreset = async ({ markdown, articleUrl, downloadPreset }) => {
  const handle = await getPresetDirectoryHandle(downloadPreset);
  const filename = `${filenameFromNoteUrl(articleUrl)}.md`;
  const overwritten = await noteFileExists(handle, filename);

  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(markdown);
  await writable.close();
  return { overwritten, filename };
};

/**
 * 画像URLからバイナリを取得する。
 * @param {string} url - 画像URL。
 * @returns {Promise<Uint8Array>} 画像バイナリ。
 */
const fetchImageBytes = async (url) => {
  const response = await fetch(String(url), { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`画像の取得に失敗しました（HTTP ${response.status}）。`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

/**
 * 画像ファイル群を note ID フォルダ配下へ保存する。
 * @param {{images: {filename: string, url: string}[], noteId: string}} params - 保存パラメータ。
 * @returns {Promise<{savedCount: number, filenames: string[]}>} 保存結果。
 */
const saveImagesForArticle = async ({ images, noteId }) => {
  const rootHandle = await getImageFolderHandle();
  const noteFolderName = String(noteId ?? "").trim() || "note-article";
  const noteFolderHandle = await rootHandle.getDirectoryHandle(noteFolderName, { create: true });
  const filenames = [];
  const failures = [];

  for (const image of images ?? []) {
    const filename = String(image?.filename ?? "").trim();
    const url = String(image?.url ?? "").trim();
    if (!filename || !url) {
      continue;
    }

    try {
      const bytes = await fetchImageBytes(url);
      const fileHandle = await noteFolderHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(bytes);
      await writable.close();
      filenames.push(`${noteFolderName}/${filename}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "不明なエラー";
      failures.push(`${filename}: ${reason}`);
    }
  }

  if (filenames.length === 0 && failures.length > 0) {
    throw new Error(`画像の保存に失敗しました。\n${failures.join("\n")}`);
  }

  if (failures.length > 0) {
    console.warn("[note→Markdown] 一部の画像保存に失敗:", failures);
  }

  return { savedCount: filenames.length, filenames };
};

/**
 * popup/content からのメッセージを受け取り、保存処理を実行して結果を返す。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "downloadMarkdownByPreset") {
    void (async () => {
      try {
        const result = await downloadMarkdownByPreset({
          markdown: message.markdown ?? "",
          articleUrl: message.articleUrl ?? "",
          downloadPreset: message.downloadPreset ?? "preset1",
        });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "ダウンロードに失敗しました。";
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  if (message?.type === "saveImagesForArticle") {
    void (async () => {
      try {
        const result = await saveImagesForArticle({
          images: message.images ?? [],
          noteId: message.noteId ?? filenameFromNoteUrl(message.articleUrl ?? ""),
        });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "画像の保存に失敗しました。";
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  return false;
});

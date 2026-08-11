// Service Worker: プリセット保存先フォルダへの .md 書き込みと重複チェック
importScripts("lib/i18n.js");

const t = (key, params) => NtmI18n.t(key, params);

const PRESET_IDS = ["preset1", "preset2", "preset3"];
const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "", folderLabel: "", hasFolder: false },
  preset2: { name: "", folderLabel: "", hasFolder: false },
  preset3: { name: "", folderLabel: "", hasFolder: false },
};
// 1.0.0 までは既定の表示名を日本語のまま保存していた。表示だけロケールに追従させる。
const LEGACY_DEFAULT_PRESET_NAMES = ["プリセット1", "プリセット2", "プリセット3"];
const DB_NAME = "noteToMarkdownPresets";
const DB_STORE = "directoryHandles";
const IMAGE_FOLDER_HANDLE_KEY = "imageFolder";

const DEFAULT_IMAGE_FOLDER_CONFIG = { folderLabel: "", hasFolder: false };

// 画像取得を manifest の host_permissions と同じ範囲に限定する。
const ALLOWED_IMAGE_HOSTS = new Set(["assets.st-note.com", "note.com"]);

/**
 * UI表示用のプリセット名を返す。
 * 未設定または旧既定名のままなら、現在の表示言語の既定名にする。
 * @param {string} presetId - 対象プリセットID。
 * @param {{name?: string}|undefined} config - 保存済みプリセット設定。
 * @returns {string} 表示名。
 */
const presetDisplayName = (presetId, config) => {
  const index = PRESET_IDS.indexOf(presetId) + 1;
  const name = String(config?.name ?? "").trim();
  if (!name || name === LEGACY_DEFAULT_PRESET_NAMES[index - 1]) {
    return t("preset.defaultName", { index });
  }
  return name;
};

/**
 * ファイル名／フォルダ名として安全な文字列へ正規化する。
 * @param {string} value - 元文字列。
 * @returns {string} 正規化後の名前。空になる場合は "note-article"。
 */
const sanitizeFileBaseName = (value) =>
  String(value ?? "")
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "note-article";

/**
 * note記事URLからファイル名のベースになる noteId を抽出する。
 * 抽出失敗時は安全な既定名を返す。
 * @param {string} url - note記事URL。
 * @returns {string} 拡張子なしファイル名。
 */
const filenameFromNoteUrl = (url) => {
  try {
    const parsed = new URL(url);
    const noteId = parsed.pathname.match(/\/n\/([^/]+)/)?.[1];
    return noteId ? sanitizeFileBaseName(noteId) : "note-article";
  } catch {
    return "note-article";
  }
};

/**
 * 画像ファイル名を保存可能な形へ正規化する。
 * パス区切りを含む値は受け付けない。
 * @param {string} filename - 受信したファイル名。
 * @returns {string} 正規化後ファイル名。不正な場合は空文字。
 */
const sanitizeImageFilename = (filename) => {
  const raw = String(filename ?? "").trim();
  if (!raw || raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
    return "";
  }
  const match = raw.match(/^([\p{Letter}\p{Number}_-]+)\.([a-zA-Z0-9]{1,5})$/u);
  return match ? `${match[1]}.${match[2].toLowerCase()}` : "";
};

/**
 * 画像取得URLが許可ホストの https URL か検証する。
 * @param {string} url - 取得対象URL。
 * @returns {boolean} 許可される場合 true。
 */
const isAllowedImageUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

/**
 * 単一プリセット設定を安全な形へ正規化する。
 * @param {any} config - 任意入力のプリセット設定。
 * @param {string} fallbackName - 設定が空のときに使う表示名。
 * @returns {{name: string, folderLabel: string, hasFolder: boolean}} 正規化後設定。
 */
const sanitizePresetConfig = (config) => ({
  name: String(config?.name ?? "").trim(),
  folderLabel: String(config?.folderLabel ?? "").trim(),
  hasFolder: Boolean(config?.hasFolder),
});

/**
 * 保存済みプリセット設定全体を正規化する。
 * @param {any} configs - chrome.storage.local から取得した値。
 * @returns {{preset1: object, preset2: object, preset3: object}} 正規化後設定。
 */
const sanitizePresetConfigs = (configs) => ({
  preset1: sanitizePresetConfig(configs?.preset1),
  preset2: sanitizePresetConfig(configs?.preset2),
  preset3: sanitizePresetConfig(configs?.preset3),
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
    throw new Error(t("error.imageFolderRequired"));
  }

  const handle = await getPresetHandle(IMAGE_FOLDER_HANDLE_KEY);
  if (!handle) {
    throw new Error(t("background.imageFolderMissing"));
  }

  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error(t("background.imageFolderPermissionLost"));
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

  const displayName = presetDisplayName(selectedPreset, selectedConfig);

  if (!selectedConfig.hasFolder) {
    throw new Error(
      t("background.presetFolderUnset", {
        name: displayName,
        detail: t("error.presetFolderRequired"),
      })
    );
  }

  const handle = await getPresetHandle(selectedPreset);
  if (!handle) {
    throw new Error(t("background.presetFolderMissing", { name: displayName }));
  }

  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error(t("background.presetFolderPermissionLost", { name: displayName }));
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
  if (!isAllowedImageUrl(url)) {
    throw new Error(t("background.imageUrlNotAllowed"));
  }
  const response = await fetch(String(url), { credentials: "omit" });
  if (!response.ok) {
    throw new Error(t("background.imageFetchFailedHttp", { status: response.status }));
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
  const noteFolderName = sanitizeFileBaseName(noteId);
  const noteFolderHandle = await rootHandle.getDirectoryHandle(noteFolderName, { create: true });
  const filenames = [];
  const failures = [];

  for (const image of images ?? []) {
    const filename = sanitizeImageFilename(image?.filename);
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
      const reason = error instanceof Error ? error.message : t("common.unknownError");
      failures.push(`${filename}: ${reason}`);
    }
  }

  if (filenames.length === 0 && failures.length > 0) {
    throw new Error(t("background.imageSaveFailedDetail", { details: failures.join("\n") }));
  }

  if (failures.length > 0) {
    console.warn(`[note→Markdown] ${t("background.imageSavePartialFailure")}`, failures);
  }

  return { savedCount: filenames.length, filenames };
};

/**
 * popup/content からのメッセージを受け取り、保存処理を実行して結果を返す。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 自拡張のページ / content script 以外からのメッセージは処理しない。
  if (sender?.id !== chrome.runtime.id) {
    return false;
  }

  if (message?.type === "downloadMarkdownByPreset") {
    void (async () => {
      // Service Worker は起動しっぱなしになるため、都度読み直して表示言語の変更に追従する。
      await NtmI18n.reload();
      try {
        const result = await downloadMarkdownByPreset({
          markdown: message.markdown ?? "",
          articleUrl: message.articleUrl ?? "",
          downloadPreset: message.downloadPreset ?? "preset1",
        });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t("error.downloadFailed");
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  if (message?.type === "saveImagesForArticle") {
    void (async () => {
      await NtmI18n.reload();
      try {
        const result = await saveImagesForArticle({
          images: message.images ?? [],
          noteId: message.noteId ?? filenameFromNoteUrl(message.articleUrl ?? ""),
        });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t("error.saveImagesFailed");
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  return false;
});

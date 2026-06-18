// Service Worker: プリセット保存先フォルダへの .md 書き込みと重複チェック
const PRESET_IDS = ["preset1", "preset2", "preset3"];
const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "プリセット1", folderLabel: "", hasFolder: false },
  preset2: { name: "プリセット2", folderLabel: "", hasFolder: false },
  preset3: { name: "プリセット3", folderLabel: "", hasFolder: false },
};
const DB_NAME = "noteToMarkdownPresets";
const DB_STORE = "directoryHandles";

const PRESET_FOLDER_REQUIRED_ERROR =
  "ダウンロードには保存先プリセットのフォルダ設定が必要です。設定（歯車）から「保存先プリセット設定」でフォルダを選択してください。";

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

  return false;
});

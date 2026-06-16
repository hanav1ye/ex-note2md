// Service Worker: プリセット保存先フォルダへの .md 書き込みと重複チェック
const PRESET_IDS = ["preset1", "preset2", "preset3"];
const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "プリセット1", folderLabel: "", hasFolder: false },
  preset2: { name: "プリセット2", folderLabel: "", hasFolder: false },
  preset3: { name: "プリセット3", folderLabel: "", hasFolder: false },
};
const DB_NAME = "noteToMarkdownPresets";
const DB_STORE = "directoryHandles";

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

const sanitizePresetConfig = (config, fallbackName) => ({
  name: String(config?.name ?? fallbackName).trim() || fallbackName,
  folderLabel: String(config?.folderLabel ?? "").trim(),
  hasFolder: Boolean(config?.hasFolder),
});

const sanitizePresetConfigs = (configs) => ({
  preset1: sanitizePresetConfig(configs?.preset1, "プリセット1"),
  preset2: sanitizePresetConfig(configs?.preset2, "プリセット2"),
  preset3: sanitizePresetConfig(configs?.preset3, "プリセット3"),
});

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

const getPresetHandle = async (presetId) => {
  const db = await openPresetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(presetId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
};

const getPresetDirectoryHandle = async (downloadPreset) => {
  const stored = await chrome.storage.local.get(["presetConfigs"]);
  const presetConfigs = sanitizePresetConfigs(stored.presetConfigs ?? DEFAULT_PRESET_CONFIGS);

  const selectedPreset = PRESET_IDS.includes(downloadPreset) ? downloadPreset : "preset1";
  const selectedConfig = presetConfigs[selectedPreset] ?? DEFAULT_PRESET_CONFIGS[selectedPreset];
  if (!selectedConfig.hasFolder) {
    throw new Error("保存先フォルダが未設定です。オプションでフォルダを設定してください。");
  }

  const handle = await getPresetHandle(selectedPreset);
  if (!handle) {
    throw new Error("保存先フォルダが見つかりません。オプションから再設定してください。");
  }

  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error("保存先フォルダの権限がありません。オプションから再設定してください。");
  }

  return handle;
};

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

const checkNoteFileExists = async ({ articleUrl, downloadPreset }) => {
  const handle = await getPresetDirectoryHandle(downloadPreset);
  const filename = `${filenameFromNoteUrl(articleUrl)}.md`;
  const exists = await noteFileExists(handle, filename);
  return { exists, filename };
};

const downloadMarkdownByPreset = async ({ markdown, articleUrl, downloadPreset }) => {
  const handle = await getPresetDirectoryHandle(downloadPreset);
  const filename = `${filenameFromNoteUrl(articleUrl)}.md`;

  if (await noteFileExists(handle, filename)) {
    return { skipped: true, filename };
  }

  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(markdown);
  await writable.close();
  return { skipped: false, filename };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "checkNoteFileExists") {
    void (async () => {
      try {
        const result = await checkNoteFileExists({
          articleUrl: message.articleUrl ?? "",
          downloadPreset: message.downloadPreset ?? "preset1",
        });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "ファイル確認に失敗しました。";
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

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

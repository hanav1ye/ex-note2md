// オプション画面: 保存先プリセット（最大3つ）とタグ候補の管理
const PRESET_IDS = ["preset1", "preset2", "preset3"];
const STORAGE_KEYS = ["presetConfigs", "presetTagCandidates", "presetObsidianLinkWords", "obsidianLinkify"];
const DB_NAME = "noteToMarkdownPresets";
const DB_STORE = "directoryHandles";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const newTagInputEl = $("newTagInput");
const addTagBtn = $("addTagBtn");
const tagCandidateListEl = $("tagCandidateList");
const tagCandidateEmptyHintEl = $("tagCandidateEmptyHint");
const newObsidianWordInputEl = $("newObsidianWordInput");
const addObsidianWordBtn = $("addObsidianWordBtn");
const obsidianWordListEl = $("obsidianWordList");
const obsidianWordEmptyHintEl = $("obsidianWordEmptyHint");
const obsidianLinkifyEl = $("obsidianLinkify");

const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "プリセット1", folderLabel: "", hasFolder: false },
  preset2: { name: "プリセット2", folderLabel: "", hasFolder: false },
  preset3: { name: "プリセット3", folderLabel: "", hasFolder: false },
};

let presetConfigs = { ...DEFAULT_PRESET_CONFIGS };
let presetTagCandidates = [];
let presetObsidianLinkWords = [];
let obsidianLinkifyEnabled = false;

const setStatus = (message) => {
  statusEl.textContent = message;
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

const normalizeTagValue = (value) => String(value).replace(/^#/, "").trim();

const sanitizeTagCandidates = (candidates) => {
  const normalized = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const value = normalizeTagValue(candidate);
    if (value && !normalized.includes(value)) {
      normalized.push(value);
    }
  });
  return normalized;
};

const normalizeObsidianWordValue = (value) => String(value).trim();

const sanitizeObsidianLinkWords = (words) => {
  const normalized = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const value = normalizeObsidianWordValue(word);
    if (value && !normalized.includes(value)) {
      normalized.push(value);
    }
  });
  return normalized;
};

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

const saveHandle = async (presetId, handle) => {
  const db = await openPresetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(handle, presetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
};

const deleteHandle = async (presetId) => {
  const db = await openPresetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(presetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
};

const render = () => {
  PRESET_IDS.forEach((id, index) => {
    const config = presetConfigs[id];
    const title = document.querySelector(`[data-preset-id="${id}"] h3`);
    const nameInput = $(`${id}Name`);
    const folderLabel = $(`${id}Folder`);
    if (title) {
      title.textContent = config.name || `プリセット${index + 1}`;
    }
    if (nameInput && nameInput.value !== config.name) {
      nameInput.value = config.name;
    }
    if (folderLabel) {
      folderLabel.textContent = config.hasFolder
        ? `設定済み: ${config.folderLabel || "フォルダ名不明"}`
        : "未設定（ダウンロード不可 — フォルダを選択してください）";
    }
  });

  if (tagCandidateListEl) {
    tagCandidateListEl.innerHTML = "";
    presetTagCandidates.forEach((tag) => {
      const item = document.createElement("div");
      item.className = "tag-item";

      const text = document.createElement("span");
      text.textContent = tag;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "削除";
      removeBtn.addEventListener("click", async () => {
        presetTagCandidates = presetTagCandidates.filter((value) => value !== tag);
        await persistConfigs();
        render();
        setStatus(`タグ「${tag}」を削除しました。`);
      });

      item.append(text, removeBtn);
      tagCandidateListEl.appendChild(item);
    });
  }

  if (tagCandidateEmptyHintEl) {
    tagCandidateEmptyHintEl.style.display = presetTagCandidates.length > 0 ? "none" : "block";
  }

  if (obsidianWordListEl) {
    obsidianWordListEl.innerHTML = "";
    presetObsidianLinkWords.forEach((word) => {
      const item = document.createElement("div");
      item.className = "tag-item";

      const text = document.createElement("span");
      text.textContent = word;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "削除";
      removeBtn.addEventListener("click", async () => {
        presetObsidianLinkWords = presetObsidianLinkWords.filter((value) => value !== word);
        await persistConfigs();
        render();
        setStatus(`ワード「${word}」を削除しました。`);
      });

      item.append(text, removeBtn);
      obsidianWordListEl.appendChild(item);
    });
  }

  if (obsidianWordEmptyHintEl) {
    obsidianWordEmptyHintEl.style.display = presetObsidianLinkWords.length > 0 ? "none" : "block";
  }
};

const persistConfigs = async () => {
  await chrome.storage.local.set({
    presetConfigs,
    presetTagCandidates,
    presetObsidianLinkWords,
    obsidianLinkify: obsidianLinkifyEnabled,
  });
};

const loadConfigs = async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  presetConfigs = sanitizePresetConfigs(stored.presetConfigs ?? DEFAULT_PRESET_CONFIGS);
  presetTagCandidates = sanitizeTagCandidates(stored.presetTagCandidates ?? []);
  presetObsidianLinkWords = sanitizeObsidianLinkWords(stored.presetObsidianLinkWords ?? []);
  obsidianLinkifyEnabled = Boolean(stored.obsidianLinkify);
  if (obsidianLinkifyEl) {
    obsidianLinkifyEl.checked = obsidianLinkifyEnabled;
  }
  render();
};

const bindEvents = () => {
  PRESET_IDS.forEach((id, index) => {
    const nameInput = $(`${id}Name`);
    const pickBtn = $(`${id}Pick`);
    const clearBtn = $(`${id}Clear`);

    nameInput?.addEventListener("change", async () => {
      presetConfigs[id].name = nameInput.value.trim() || `プリセット${index + 1}`;
      await persistConfigs();
      render();
      setStatus("プリセット名を保存しました。");
    });

    pickBtn?.addEventListener("click", async () => {
      try {
        const handle = await window.showDirectoryPicker();
        const permission = await handle.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") {
          setStatus("フォルダの書き込み権限が許可されませんでした。");
          return;
        }
        await saveHandle(id, handle);
        presetConfigs[id].folderLabel = handle.name || "";
        presetConfigs[id].hasFolder = true;
        await persistConfigs();
        render();
        setStatus("保存先フォルダを設定しました。");
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus("フォルダ設定に失敗しました。");
        }
      }
    });

    clearBtn?.addEventListener("click", async () => {
      try {
        await deleteHandle(id);
        presetConfigs[id].folderLabel = "";
        presetConfigs[id].hasFolder = false;
        await persistConfigs();
        render();
        setStatus("保存先フォルダを解除しました。");
      } catch {
        setStatus("解除に失敗しました。");
      }
    });
  });

  addTagBtn?.addEventListener("click", async () => {
    const value = normalizeTagValue(newTagInputEl?.value ?? "");
    if (!value) {
      setStatus("タグ名を入力してください。");
      return;
    }
    if (presetTagCandidates.includes(value)) {
      setStatus("同じタグは既に登録されています。");
      return;
    }
    presetTagCandidates = [...presetTagCandidates, value];
    await persistConfigs();
    if (newTagInputEl) {
      newTagInputEl.value = "";
    }
    render();
    setStatus(`タグ「${value}」を追加しました。`);
  });

  newTagInputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTagBtn?.click();
    }
  });

  addObsidianWordBtn?.addEventListener("click", async () => {
    const value = normalizeObsidianWordValue(newObsidianWordInputEl?.value ?? "");
    if (!value) {
      setStatus("ワードを入力してください。");
      return;
    }
    if (presetObsidianLinkWords.includes(value)) {
      setStatus("同じワードは既に登録されています。");
      return;
    }
    presetObsidianLinkWords = [...presetObsidianLinkWords, value];
    await persistConfigs();
    if (newObsidianWordInputEl) {
      newObsidianWordInputEl.value = "";
    }
    render();
    setStatus(`ワード「${value}」を追加しました。`);
  });

  newObsidianWordInputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addObsidianWordBtn?.click();
    }
  });

  obsidianLinkifyEl?.addEventListener("change", async () => {
    obsidianLinkifyEnabled = Boolean(obsidianLinkifyEl.checked);
    await persistConfigs();
    setStatus(obsidianLinkifyEnabled ? "Obsidianリンク化を有効にしました。" : "Obsidianリンク化を無効にしました。");
  });
};

void loadConfigs().then(() => {
  bindEvents();
});

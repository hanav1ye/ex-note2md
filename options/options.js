// オプション画面: 保存先プリセット（最大3つ）とタグ候補の管理
const PRESET_IDS = ["preset1", "preset2", "preset3"];
const STORAGE_KEYS = ["presetConfigs", "presetTagCandidates", "presetObsidianLinkWords", "obsidianLinkify"];
const DB_NAME = "noteToMarkdownPresets";
const DB_STORE = "directoryHandles";

const $ = (id) => document.getElementById(id);
const tagStatusEl = $("tagStatus");
const obsidianStatusEl = $("obsidianStatus");
const newTagInputEl = $("newTagInput");
const addTagBtn = $("addTagBtn");
const openTagBulkModalBtn = $("openTagBulkModalBtn");
const tagCandidateListEl = $("tagCandidateList");
const tagCandidateEmptyHintEl = $("tagCandidateEmptyHint");
const newObsidianWordInputEl = $("newObsidianWordInput");
const addObsidianWordBtn = $("addObsidianWordBtn");
const openObsidianBulkModalBtn = $("openObsidianBulkModalBtn");
const obsidianWordListEl = $("obsidianWordList");
const obsidianWordEmptyHintEl = $("obsidianWordEmptyHint");
const obsidianLinkifyEl = $("obsidianLinkify");
const bulkAddModalEl = $("bulkAddModal");
const bulkAddFormEl = $("bulkAddForm");
const bulkAddModalTitleEl = $("bulkAddModalTitle");
const bulkAddModalHintEl = $("bulkAddModalHint");
const bulkAddTextareaEl = $("bulkAddTextarea");
const bulkAddCancelBtn = $("bulkAddCancelBtn");

const BULK_TARGETS = {
  tag: "tag",
  obsidian: "obsidian",
};

const STATUS_TARGETS = {
  tag: "tag",
  obsidian: "obsidian",
};

const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "プリセット1", folderLabel: "", hasFolder: false },
  preset2: { name: "プリセット2", folderLabel: "", hasFolder: false },
  preset3: { name: "プリセット3", folderLabel: "", hasFolder: false },
};

let presetConfigs = { ...DEFAULT_PRESET_CONFIGS };
let presetTagCandidates = [];
let presetObsidianLinkWords = [];
let obsidianLinkifyEnabled = false;
let currentBulkTarget = BULK_TARGETS.tag;

/**
 * ステータス出力先（タグ/Obsidian）に対応する要素を返す。
 * @param {"tag"|"obsidian"} target - ステータスターゲット。
 * @returns {HTMLElement|null} 対応要素。
 */
const statusElementByTarget = (target) =>
  target === STATUS_TARGETS.obsidian ? obsidianStatusEl : tagStatusEl;

/**
 * 指定ターゲットのステータス表示を消去する。
 * @param {"tag"|"obsidian"} target - 消去対象。
 */
const clearStatus = (target) => {
  const el = statusElementByTarget(target);
  if (!el) {
    return;
  }
  el.textContent = "";
  el.classList.remove("is-visible");
};

/**
 * 指定ターゲットへステータスを表示し、反対側はクリアする。
 * @param {"tag"|"obsidian"} target - 表示先ターゲット。
 * @param {string} message - 表示文言。
 */
const setStatus = (target, message) => {
  const currentEl = statusElementByTarget(target);
  const otherTarget = target === STATUS_TARGETS.tag ? STATUS_TARGETS.obsidian : STATUS_TARGETS.tag;
  const otherEl = statusElementByTarget(otherTarget);
  if (!currentEl) {
    return;
  }

  if (otherEl) {
    otherEl.textContent = "";
    otherEl.classList.remove("is-visible");
  }

  const text = String(message ?? "").trim();
  currentEl.textContent = text;
  currentEl.classList.toggle("is-visible", Boolean(text));
};

/**
 * 単一プリセット設定を正規化する。
 * @param {any} config - 生設定。
 * @param {string} fallbackName - 表示名の既定値。
 * @returns {{name: string, folderLabel: string, hasFolder: boolean}} 正規化済み設定。
 */
const sanitizePresetConfig = (config, fallbackName) => ({
  name: String(config?.name ?? fallbackName).trim() || fallbackName,
  folderLabel: String(config?.folderLabel ?? "").trim(),
  hasFolder: Boolean(config?.hasFolder),
});

/**
 * プリセット設定全体を正規化する。
 * @param {any} configs - 生設定。
 * @returns {{preset1: object, preset2: object, preset3: object}} 正規化済み設定群。
 */
const sanitizePresetConfigs = (configs) => ({
  preset1: sanitizePresetConfig(configs?.preset1, "プリセット1"),
  preset2: sanitizePresetConfig(configs?.preset2, "プリセット2"),
  preset3: sanitizePresetConfig(configs?.preset3, "プリセット3"),
});

/**
 * タグ入力を正規化する（先頭#除去）。
 * @param {string} value - 入力値。
 * @returns {string} 正規化済みタグ。
 */
const normalizeTagValue = (value) => String(value).replace(/^#/, "").trim();

/**
 * タグ候補配列を正規化し、空文字・重複を除去する。
 * @param {unknown[]} candidates - 保存値。
 * @returns {string[]} 正規化済みタグ一覧。
 */
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

/**
 * Obsidianリンクワード入力を正規化する。
 * @param {string} value - 入力値。
 * @returns {string} 正規化済みワード。
 */
const normalizeObsidianWordValue = (value) => String(value).trim();

/**
 * Obsidianリンクワード配列を正規化し、空文字・重複を除去する。
 * @param {unknown[]} words - 保存値。
 * @returns {string[]} 正規化済みワード一覧。
 */
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

/**
 * テキストエリア入力を改行で分割し、1件ずつ正規化する。
 * @param {string} text - 一括入力テキスト。
 * @param {(value: string) => string} normalizer - 正規化関数。
 * @returns {string[]} 空行除去済み値一覧。
 */
const parseBulkLines = (text, normalizer) => {
  const lines = String(text ?? "").split(/\r?\n/);
  return lines
    .map((line) => normalizer(line))
    .filter((value) => Boolean(value));
};

/**
 * 既存配列へ重複なしで値を追加する。
 * @param {string[]} existingValues - 既存値。
 * @param {string[]} incomingValues - 追加候補値。
 * @returns {{unique: string[], addedCount: number, skippedCount: number}} 集計結果。
 */
const addUniqueValues = (existingValues, incomingValues) => {
  const unique = [...existingValues];
  const known = new Set(existingValues);
  let addedCount = 0;
  let skippedCount = 0;

  incomingValues.forEach((value) => {
    if (known.has(value)) {
      skippedCount += 1;
      return;
    }
    known.add(value);
    unique.push(value);
    addedCount += 1;
  });

  return { unique, addedCount, skippedCount };
};

/**
 * 一括登録モーダルのタイトル/ヒント/プレースホルダをターゲット別に更新する。
 * @param {"tag"|"obsidian"} target - 一括登録対象。
 */
const setBulkModalContent = (target) => {
  const isTag = target === BULK_TARGETS.tag;
  if (bulkAddModalTitleEl) {
    bulkAddModalTitleEl.textContent = isTag ? "タグ候補を改行で一括追加" : "Obsidianリンクワードを改行で一括追加";
  }
  if (bulkAddModalHintEl) {
    bulkAddModalHintEl.textContent = isTag
      ? "1行に1タグを入力してください。既に登録済みのタグは自動でスキップします。"
      : "1行に1ワードを入力してください。既に登録済みのワードは自動でスキップします。";
  }
  if (bulkAddTextareaEl) {
    bulkAddTextareaEl.placeholder = isTag ? "例:\n学習メモ\n技術検証" : "例:\nObsidian\nnote";
  }
};

/**
 * 指定ターゲット用で一括登録モーダルを開く。
 * @param {"tag"|"obsidian"} target - 一括登録対象。
 */
const openBulkModal = (target) => {
  if (!bulkAddModalEl || !bulkAddTextareaEl) {
    return;
  }
  currentBulkTarget = target;
  setBulkModalContent(target);
  bulkAddTextareaEl.value = "";
  bulkAddModalEl.showModal();
  bulkAddTextareaEl.focus();
};

/** 一括登録モーダルを閉じる。 */
const closeBulkModal = () => {
  bulkAddModalEl?.close();
};

/** 改行一括入力の登録処理を実行する。 */
const applyBulkAdd = async () => {
  const text = bulkAddTextareaEl?.value ?? "";
  const isTag = currentBulkTarget === BULK_TARGETS.tag;
  const normalizedValues = parseBulkLines(text, isTag ? normalizeTagValue : normalizeObsidianWordValue);
  if (normalizedValues.length === 0) {
    setStatus(
      isTag ? STATUS_TARGETS.tag : STATUS_TARGETS.obsidian,
      isTag ? "追加するタグを入力してください。" : "追加するワードを入力してください。"
    );
    return;
  }

  if (isTag) {
    const { unique, addedCount, skippedCount } = addUniqueValues(presetTagCandidates, normalizedValues);
    presetTagCandidates = unique;
    await persistConfigs();
    render();
    setStatus(STATUS_TARGETS.tag, `タグを一括登録しました（追加 ${addedCount} / 重複スキップ ${skippedCount}）。`);
  } else {
    const { unique, addedCount, skippedCount } = addUniqueValues(
      presetObsidianLinkWords,
      normalizedValues
    );
    presetObsidianLinkWords = unique;
    await persistConfigs();
    render();
    setStatus(
      STATUS_TARGETS.obsidian,
      `ワードを一括登録しました（追加 ${addedCount} / 重複スキップ ${skippedCount}）。`
    );
  }
  closeBulkModal();
};

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
 * 指定プリセットIDでディレクトリハンドルを保存する。
 * @param {string} presetId - 対象プリセットID。
 * @param {FileSystemDirectoryHandle} handle - 保存するハンドル。
 */
const saveHandle = async (presetId, handle) => {
  const db = await openPresetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(handle, presetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
};

/**
 * 指定プリセットIDのハンドルを削除する。
 * @param {string} presetId - 削除対象プリセットID。
 */
const deleteHandle = async (presetId) => {
  const db = await openPresetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(presetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
};

/** 現在stateをオプション画面UIへ反映する。 */
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
        setStatus(STATUS_TARGETS.tag, `タグ「${tag}」を削除しました。`);
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
        setStatus(STATUS_TARGETS.obsidian, `ワード「${word}」を削除しました。`);
      });

      item.append(text, removeBtn);
      obsidianWordListEl.appendChild(item);
    });
  }

  if (obsidianWordEmptyHintEl) {
    obsidianWordEmptyHintEl.style.display = presetObsidianLinkWords.length > 0 ? "none" : "block";
  }
};

/** 現在stateを chrome.storage.local へ保存する。 */
const persistConfigs = async () => {
  await chrome.storage.local.set({
    presetConfigs,
    presetTagCandidates,
    presetObsidianLinkWords,
    obsidianLinkify: obsidianLinkifyEnabled,
  });
};

/** 保存済み設定を読み込み、stateとUIを初期化する。 */
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

/** 各UI操作のイベントハンドラをバインドする。 */
const bindEvents = () => {
  PRESET_IDS.forEach((id, index) => {
    const nameInput = $(`${id}Name`);
    const pickBtn = $(`${id}Pick`);
    const clearBtn = $(`${id}Clear`);

    nameInput?.addEventListener("change", async () => {
      presetConfigs[id].name = nameInput.value.trim() || `プリセット${index + 1}`;
      await persistConfigs();
      render();
      setStatus(STATUS_TARGETS.tag, "プリセット名を保存しました。");
    });

    pickBtn?.addEventListener("click", async () => {
      try {
        const handle = await window.showDirectoryPicker();
        const permission = await handle.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") {
          setStatus(STATUS_TARGETS.tag, "フォルダの書き込み権限が許可されませんでした。");
          return;
        }
        await saveHandle(id, handle);
        presetConfigs[id].folderLabel = handle.name || "";
        presetConfigs[id].hasFolder = true;
        await persistConfigs();
        render();
        setStatus(STATUS_TARGETS.tag, "保存先フォルダを設定しました。");
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(STATUS_TARGETS.tag, "フォルダ設定に失敗しました。");
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
        setStatus(STATUS_TARGETS.tag, "保存先フォルダを解除しました。");
      } catch {
        setStatus(STATUS_TARGETS.tag, "解除に失敗しました。");
      }
    });
  });

  addTagBtn?.addEventListener("click", async () => {
    const value = normalizeTagValue(newTagInputEl?.value ?? "");
    if (!value) {
      setStatus(STATUS_TARGETS.tag, "タグ名を入力してください。");
      return;
    }
    if (presetTagCandidates.includes(value)) {
      setStatus(STATUS_TARGETS.tag, "同じタグは既に登録されています。");
      return;
    }
    presetTagCandidates = [...presetTagCandidates, value];
    await persistConfigs();
    if (newTagInputEl) {
      newTagInputEl.value = "";
    }
    render();
    setStatus(STATUS_TARGETS.tag, `タグ「${value}」を追加しました。`);
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
      setStatus(STATUS_TARGETS.obsidian, "ワードを入力してください。");
      return;
    }
    if (presetObsidianLinkWords.includes(value)) {
      setStatus(STATUS_TARGETS.obsidian, "同じワードは既に登録されています。");
      return;
    }
    presetObsidianLinkWords = [...presetObsidianLinkWords, value];
    await persistConfigs();
    if (newObsidianWordInputEl) {
      newObsidianWordInputEl.value = "";
    }
    render();
    setStatus(STATUS_TARGETS.obsidian, `ワード「${value}」を追加しました。`);
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
    setStatus(
      STATUS_TARGETS.obsidian,
      obsidianLinkifyEnabled ? "Obsidianリンク化を有効にしました。" : "Obsidianリンク化を無効にしました。"
    );
  });

  openTagBulkModalBtn?.addEventListener("click", () => {
    openBulkModal(BULK_TARGETS.tag);
  });

  openObsidianBulkModalBtn?.addEventListener("click", () => {
    openBulkModal(BULK_TARGETS.obsidian);
  });

  bulkAddFormEl?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await applyBulkAdd();
  });

  bulkAddCancelBtn?.addEventListener("click", () => {
    closeBulkModal();
  });
};

void loadConfigs().then(() => {
  clearStatus(STATUS_TARGETS.tag);
  clearStatus(STATUS_TARGETS.obsidian);
  bindEvents();
});

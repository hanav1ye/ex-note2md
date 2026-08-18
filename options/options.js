// オプション画面: 表示言語・保存先プリセット（最大3つ）・タグ候補・設定の入出力の管理
const t = (key, params) => NtmI18n.t(key, params);

const PRESET_IDS = ["preset1", "preset2", "preset3"];
// 1.0.0 までは既定の表示名を日本語のまま保存していた。表示だけロケールに追従させる。
const LEGACY_DEFAULT_PRESET_NAMES = ["プリセット1", "プリセット2", "プリセット3"];
const IMAGE_IMPORT_MODES = ["url", "download", "base64"];
const STORAGE_KEYS = [
  "presetConfigs",
  "presetTagCandidates",
  "presetTagSets",
  "presetObsidianLinkWords",
  "obsidianLinkify",
  "imageImportMode",
  "imageFolderConfig",
];
const MAX_TAGS_PER_SET = 5;
const MAX_TAG_SETS = 10;
const IMAGE_FOLDER_HANDLE_KEY = "imageFolder";
/** popup から「スキ数を更新」が押されたことを受け取るための一時キー。 */
const PENDING_LIKE_COUNT_RUN_KEY = "pendingLikeCountRun";
const DB_NAME = "noteToMarkdownPresets";
const DB_STORE = "directoryHandles";

/** エクスポートファイルの識別子。取り込み時に他アプリの JSON を弾くために使う。 */
const TRANSFER_FILE_TYPE = "ex-note2md-settings";
const TRANSFER_FILE_VERSION = 1;

const $ = (id) => document.getElementById(id);
const languageSelectEl = $("languageSelect");
const languageStatusEl = $("languageStatus");
const tagStatusEl = $("tagStatus");
const obsidianStatusEl = $("obsidianStatus");
const newTagInputEl = $("newTagInput");
const addTagBtn = $("addTagBtn");
const openTagBulkModalBtn = $("openTagBulkModalBtn");
const tagCandidateListEl = $("tagCandidateList");
const tagCandidateEmptyHintEl = $("tagCandidateEmptyHint");
const tagSetStatusEl = $("tagSetStatus");
const tagSetSectionHintEl = $("tagSetSectionHint");
const tagSetSelectHintEl = $("tagSetSelectHint");
const tagSetNameInputEl = $("tagSetNameInput");
const tagSetTagSelectorEl = $("tagSetTagSelector");
const tagSetTagEmptyHintEl = $("tagSetTagEmptyHint");
const saveTagSetBtn = $("saveTagSetBtn");
const cancelTagSetEditBtn = $("cancelTagSetEditBtn");
const tagSetListEl = $("tagSetList");
const tagSetEmptyHintEl = $("tagSetEmptyHint");
const newObsidianWordInputEl = $("newObsidianWordInput");
const addObsidianWordBtn = $("addObsidianWordBtn");
const openObsidianBulkModalBtn = $("openObsidianBulkModalBtn");
const obsidianWordListEl = $("obsidianWordList");
const obsidianWordEmptyHintEl = $("obsidianWordEmptyHint");
const obsidianLinkifyEl = $("obsidianLinkify");
const imageImportModeInputs = document.querySelectorAll('input[name="imageImportMode"]');
const imageFolderFieldEl = $("imageFolderField");
const imageFolderLabelEl = $("imageFolderLabel");
const imageFolderPickBtn = $("imageFolderPick");
const imageFolderClearBtn = $("imageFolderClear");
const imageFolderGrantBtn = $("imageFolderGrant");
const imageImportStatusEl = $("imageImportStatus");
const bulkAddModalEl = $("bulkAddModal");
const bulkAddFormEl = $("bulkAddForm");
const bulkAddModalTitleEl = $("bulkAddModalTitle");
const bulkAddModalHintEl = $("bulkAddModalHint");
const bulkAddTextareaEl = $("bulkAddTextarea");
const bulkAddCancelBtn = $("bulkAddCancelBtn");
const likeCountSectionEl = document.querySelector('[aria-labelledby="likeCountSectionTitle"]');
const likeCountPresetEl = $("likeCountPreset");
const likeCountPresetHintEl = $("likeCountPresetHint");
const likeCountRunBtn = $("likeCountRunBtn");
const likeCountCancelBtn = $("likeCountCancelBtn");
const likeCountStatusEl = $("likeCountStatus");
const likeCountConfirmModalEl = $("likeCountConfirmModal");
const likeCountConfirmFormEl = $("likeCountConfirmForm");
const likeCountConfirmBodyEl = $("likeCountConfirmBody");
const likeCountConfirmSkippedEl = $("likeCountConfirmSkipped");
const likeCountConfirmCancelBtn = $("likeCountConfirmCancelBtn");
const exportSettingsBtn = $("exportSettingsBtn");
const importSettingsBtn = $("importSettingsBtn");
const importSettingsInputEl = $("importSettingsInput");
const transferStatusEl = $("transferStatus");

const BULK_TARGETS = {
  tag: "tag",
  obsidian: "obsidian",
};

const STATUS_TARGETS = {
  language: "language",
  tag: "tag",
  tagSet: "tagSet",
  obsidian: "obsidian",
  image: "image",
  likeCount: "likeCount",
  transfer: "transfer",
};

const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "", folderLabel: "", hasFolder: false },
  preset2: { name: "", folderLabel: "", hasFolder: false },
  preset3: { name: "", folderLabel: "", hasFolder: false },
};
const DEFAULT_IMAGE_FOLDER_CONFIG = { folderLabel: "", hasFolder: false };

let presetConfigs = { ...DEFAULT_PRESET_CONFIGS };
let presetTagCandidates = [];
let presetTagSets = [];
let editingTagSetId = "";
let presetObsidianLinkWords = [];
let obsidianLinkifyEnabled = false;
let imageImportMode = "url";
let imageFolderConfig = { ...DEFAULT_IMAGE_FOLDER_CONFIG };
let currentBulkTarget = BULK_TARGETS.tag;
/** @type {Record<string, "granted"|"prompt"|"missing">} 保存済みフォルダの権限状態 */
let permissionStates = {};

/**
 * ステータス出力先に対応する要素を返す。
 * @param {string} target - ステータスターゲット。
 * @returns {HTMLElement|null} 対応要素。
 */
const statusElementByTarget = (target) => {
  if (target === STATUS_TARGETS.language) {
    return languageStatusEl;
  }
  if (target === STATUS_TARGETS.obsidian) {
    return obsidianStatusEl;
  }
  if (target === STATUS_TARGETS.tagSet) {
    return tagSetStatusEl;
  }
  if (target === STATUS_TARGETS.image) {
    return imageImportStatusEl;
  }
  if (target === STATUS_TARGETS.likeCount) {
    return likeCountStatusEl;
  }
  if (target === STATUS_TARGETS.transfer) {
    return transferStatusEl;
  }
  return tagStatusEl;
};

/**
 * 指定ターゲットのステータス表示を消去する。
 * @param {string} target - 消去対象。
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
 * 指定ターゲットへステータスを表示し、他はクリアする。
 * @param {string} target - 表示先ターゲット。
 * @param {string} message - 表示文言。
 */
const setStatus = (target, message) => {
  const currentEl = statusElementByTarget(target);
  if (!currentEl) {
    return;
  }

  Object.values(STATUS_TARGETS).forEach((statusTarget) => {
    if (statusTarget === target) {
      return;
    }
    const el = statusElementByTarget(statusTarget);
    if (el) {
      el.textContent = "";
      el.classList.remove("is-visible");
    }
  });

  const text = String(message ?? "").trim();
  currentEl.textContent = text;
  currentEl.classList.toggle("is-visible", Boolean(text));
};

/**
 * 単一プリセット設定を正規化する。
 * @param {any} config - 生設定。
 * @returns {{name: string, folderLabel: string, hasFolder: boolean}} 正規化済み設定。
 */
const sanitizePresetConfig = (config) => ({
  name: String(config?.name ?? "").trim(),
  folderLabel: String(config?.folderLabel ?? "").trim(),
  hasFolder: Boolean(config?.hasFolder),
});

/**
 * プリセット設定全体を正規化する。
 * @param {any} configs - 生設定。
 * @returns {{preset1: object, preset2: object, preset3: object}} 正規化済み設定群。
 */
const sanitizePresetConfigs = (configs) => ({
  preset1: sanitizePresetConfig(configs?.preset1),
  preset2: sanitizePresetConfig(configs?.preset2),
  preset3: sanitizePresetConfig(configs?.preset3),
});

/**
 * UI表示用のプリセット名を返す。
 * 未設定または旧既定名のままなら、現在の表示言語の既定名にする。
 * @param {string} presetId - 対象プリセットID。
 * @param {{name?: string}|undefined} config - プリセット設定。
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
 * 画像取込方式を正規化する。
 * @param {unknown} mode - 入力値。
 * @returns {"url"|"download"|"base64"} 正規化後の方式。
 */
const normalizeImageImportMode = (mode) =>
  IMAGE_IMPORT_MODES.includes(mode) ? mode : "url";

/**
 * 画像保存先フォルダ設定を正規化する。
 * @param {any} config - 生設定。
 * @returns {{folderLabel: string, hasFolder: boolean}} 正規化済み設定。
 */
const sanitizeImageFolderConfig = (config) => ({
  folderLabel: String(config?.folderLabel ?? "").trim(),
  hasFolder: Boolean(config?.hasFolder),
});

/** 画像取込方式ラジオの現在値を取得する。 */
const getSelectedImageImportMode = () => {
  const value = document.querySelector('input[name="imageImportMode"]:checked')?.value ?? imageImportMode;
  return normalizeImageImportMode(value);
};

/**
 * 指定ラジオ群に対して選択値をセットする。
 * @param {NodeListOf<HTMLInputElement>} inputs - 対象ラジオ群。
 * @param {string} value - 選択させる値。
 */
const setSelectedRadio = (inputs, value) => {
  inputs.forEach((input) => {
    input.checked = input.value === value;
  });
};

/** 画像保存先フォルダ欄の表示状態を更新する。 */
const updateImageFolderVisibility = () => {
  imageFolderFieldEl?.classList.toggle("hidden", getSelectedImageImportMode() !== "download");
};

/**
 * 保存済みフォルダの表示文言を権限状態に応じて組み立てる。
 * @param {{hasFolder: boolean, folderLabel: string}} config - フォルダ設定。
 * @param {string} handleKey - ハンドルのキー。
 * @param {string} unsetLabel - 未設定時の文言。
 * @returns {{text: string, needsPermission: boolean}} 表示内容。
 */
const buildFolderLabel = (config, handleKey, unsetLabel) => {
  if (!config.hasFolder) {
    return { text: unsetLabel, needsPermission: false };
  }
  const name = config.folderLabel || t("common.folderUnknown");
  const state = permissionStates[handleKey];
  if (state === "prompt") {
    return { text: t("options.preset.folderNeedsPermission", { name }), needsPermission: true };
  }
  if (state === "missing") {
    return { text: t("options.preset.folderNotFound", { name }), needsPermission: true };
  }
  return { text: t("options.preset.folderConfigured", { name }), needsPermission: false };
};

/**
 * フォルダ表示と「アクセスを再許可」ボタンの状態を反映する。
 * @param {HTMLElement|null} labelEl - 表示先ラベル。
 * @param {HTMLElement|null} grantBtn - 再許可ボタン。
 * @param {{text: string, needsPermission: boolean}} label - 表示内容。
 */
const applyFolderLabel = (labelEl, grantBtn, label) => {
  if (labelEl) {
    labelEl.textContent = label.text;
    labelEl.classList.toggle("needs-permission", label.needsPermission);
  }
  grantBtn?.classList.toggle("hidden", !label.needsPermission);
};

/** 画像保存先フォルダ表示を更新する。 */
const renderImageFolderField = () => {
  applyFolderLabel(
    imageFolderLabelEl,
    imageFolderGrantBtn,
    buildFolderLabel(imageFolderConfig, IMAGE_FOLDER_HANDLE_KEY, t("common.folderUnset"))
  );
  updateImageFolderVisibility();
};

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
 * タグセットのIDを生成する。
 * @returns {string} 一意なタグセットID。
 */
const createTagSetId = () => `tagset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * タグセット配列を正規化する（不正値・重複タグ・上限超過を除去）。
 * @param {unknown[]} sets - 保存値。
 * @param {number} [limit=MAX_TAG_SETS] - 残す最大件数。
 * @returns {{id: string, name: string, tags: string[]}[]} 正規化済みタグセット一覧。
 */
const sanitizeTagSets = (sets, limit = MAX_TAG_SETS) => {
  const normalized = [];
  (Array.isArray(sets) ? sets : []).forEach((set) => {
    const tags = sanitizeTagCandidates(set?.tags).slice(0, MAX_TAGS_PER_SET);
    const name = String(set?.name ?? "").trim();
    if (!name || tags.length === 0) {
      return;
    }
    normalized.push({
      id: String(set?.id ?? "").trim() || createTagSetId(),
      name,
      tags,
    });
  });
  return normalized.slice(0, limit);
};

/**
 * タグセット編集フォームで現在チェックされているタグを取得する。
 * @returns {string[]} 選択中タグ。
 */
const getTagSetFormTags = () => {
  const tags = [];
  tagSetTagSelectorEl?.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
    const value = normalizeTagValue(input.value);
    if (value && !tags.includes(value)) {
      tags.push(value);
    }
  });
  return tags;
};

/**
 * タグセット編集フォームを初期状態（新規追加）へ戻す。
 */
const resetTagSetForm = () => {
  editingTagSetId = "";
  if (tagSetNameInputEl) {
    tagSetNameInputEl.value = "";
  }
  renderTagSetForm([]);
};

/**
 * タグセット編集フォームのタグ候補チェックボックスを描画する。
 * @param {string[]} [selectedTags=[]] - 初期選択タグ。
 */
function renderTagSetForm(selectedTags = []) {
  if (saveTagSetBtn) {
    saveTagSetBtn.textContent = editingTagSetId
      ? t("options.tagSet.update")
      : t("options.tagSet.save");
  }
  cancelTagSetEditBtn?.classList.toggle("hidden", !editingTagSetId);

  if (!tagSetTagSelectorEl) {
    return;
  }

  tagSetTagSelectorEl.innerHTML = "";
  presetTagCandidates.forEach((tag) => {
    const label = document.createElement("label");
    label.className = "tag-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag;
    input.checked = selectedTags.includes(tag);
    input.addEventListener("change", () => {
      if (input.checked && getTagSetFormTags().length > MAX_TAGS_PER_SET) {
        input.checked = false;
        setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.maxTags", { max: MAX_TAGS_PER_SET }));
      }
    });

    const text = document.createElement("span");
    text.textContent = tag;

    label.append(input, text);
    tagSetTagSelectorEl.appendChild(label);
  });

  if (tagSetTagEmptyHintEl) {
    tagSetTagEmptyHintEl.style.display = presetTagCandidates.length > 0 ? "none" : "block";
  }
}

/**
 * 指定タグセットを編集フォームへ読み込む。
 * @param {{id: string, name: string, tags: string[]}} tagSet - 編集対象。
 */
const startTagSetEdit = (tagSet) => {
  editingTagSetId = tagSet.id;
  if (tagSetNameInputEl) {
    tagSetNameInputEl.value = tagSet.name;
  }
  renderTagSetForm(tagSet.tags);
  tagSetNameInputEl?.focus();
};

/** タグセットの追加/更新を実行する。 */
const saveTagSet = async () => {
  const name = String(tagSetNameInputEl?.value ?? "").trim();
  const tags = getTagSetFormTags();

  if (presetTagCandidates.length === 0) {
    setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.tagsEmpty"));
    return;
  }
  if (!name) {
    setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.nameRequired"));
    return;
  }
  if (tags.length === 0) {
    setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.tagRequired"));
    return;
  }
  if (presetTagSets.some((set) => set.name === name && set.id !== editingTagSetId)) {
    setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.duplicateName"));
    return;
  }
  if (!editingTagSetId && presetTagSets.length >= MAX_TAG_SETS) {
    setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.maxSets", { max: MAX_TAG_SETS }));
    return;
  }

  if (editingTagSetId) {
    presetTagSets = presetTagSets.map((set) =>
      set.id === editingTagSetId ? { ...set, name, tags } : set
    );
  } else {
    presetTagSets = [...presetTagSets, { id: createTagSetId(), name, tags }];
  }

  const wasEditing = Boolean(editingTagSetId);
  await persistConfigs();
  resetTagSetForm();
  render();
  setStatus(
    STATUS_TARGETS.tagSet,
    wasEditing ? t("options.tagSet.updated", { name }) : t("options.tagSet.added", { name })
  );
};

/**
 * 削除されたタグ候補をタグセットから取り除く。
 * タグが無くなったセットは削除する。
 * @param {string} removedTag - 削除されたタグ。
 * @returns {boolean} タグセットに変更があれば true。
 */
const removeTagFromTagSets = (removedTag) => {
  const nextSets = presetTagSets
    .map((set) => ({ ...set, tags: set.tags.filter((tag) => tag !== removedTag) }))
    .filter((set) => set.tags.length > 0);
  const changed =
    nextSets.length !== presetTagSets.length ||
    nextSets.some((set, index) => set.tags.length !== presetTagSets[index].tags.length);
  presetTagSets = nextSets;
  if (changed && !presetTagSets.some((set) => set.id === editingTagSetId)) {
    editingTagSetId = "";
  }
  return changed;
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
    bulkAddModalTitleEl.textContent = isTag
      ? t("options.bulk.tagTitle")
      : t("options.bulk.obsidianTitle");
  }
  if (bulkAddModalHintEl) {
    bulkAddModalHintEl.textContent = isTag
      ? t("options.bulk.tagHint")
      : t("options.bulk.obsidianHint");
  }
  if (bulkAddTextareaEl) {
    bulkAddTextareaEl.placeholder = isTag
      ? t("options.bulk.tagPlaceholder")
      : t("options.bulk.obsidianPlaceholder");
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
      isTag ? t("options.tag.bulkRequired") : t("options.obsidian.bulkRequired")
    );
    return;
  }

  if (isTag) {
    const { unique, addedCount, skippedCount } = addUniqueValues(presetTagCandidates, normalizedValues);
    presetTagCandidates = unique;
    await persistConfigs();
    render();
    setStatus(
      STATUS_TARGETS.tag,
      t("options.tag.bulkAdded", { added: addedCount, skipped: skippedCount })
    );
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
      t("options.obsidian.bulkAdded", { added: addedCount, skipped: skippedCount })
    );
  }
  closeBulkModal();
};

/* ------------------------- 設定のインポート / エクスポート ------------------------- */

/**
 * エクスポートする設定内容を組み立てる。
 * 保存先フォルダのハンドルは端末とブラウザ権限に紐づくため含めない。
 * @returns {object} エクスポート用オブジェクト。
 */
const buildTransferPayload = () => ({
  type: TRANSFER_FILE_TYPE,
  version: TRANSFER_FILE_VERSION,
  exportedAt: new Date().toISOString(),
  tagCandidates: [...presetTagCandidates],
  // ID は端末ごとに振り直すため出力しない。
  tagSets: presetTagSets.map((set) => ({ name: set.name, tags: [...set.tags] })),
  obsidianLinkWords: [...presetObsidianLinkWords],
  obsidianLinkify: obsidianLinkifyEnabled,
});

/**
 * エクスポートファイル名を組み立てる。
 * @param {Date} [now=new Date()] - 基準日時。
 * @returns {string} ファイル名。
 */
const buildTransferFilename = (now = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `note2md-settings-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
};

/**
 * 読み込んだ JSON をインポート可能な形へ検証・正規化する。
 * @param {string} text - ファイル内容。
 * @returns {{tagCandidates: string[], tagSets: object[], obsidianLinkWords: string[], obsidianLinkify: boolean}} 正規化済み内容。
 * @throws {Error} 形式が不正な場合。
 */
const parseTransferPayload = (text) => {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch {
    throw new Error(t("options.transfer.invalidFormat"));
  }

  if (!data || typeof data !== "object" || data.type !== TRANSFER_FILE_TYPE) {
    throw new Error(t("options.transfer.invalidFormat"));
  }

  const version = Number(data.version);
  if (!Number.isInteger(version) || version < 1 || version > TRANSFER_FILE_VERSION) {
    throw new Error(t("options.transfer.unsupportedVersion", { version: String(data.version) }));
  }

  return {
    tagCandidates: sanitizeTagCandidates(data.tagCandidates),
    // 上限超過の件数を数えたいので、ここでは切り詰めない。
    tagSets: sanitizeTagSets(data.tagSets, Infinity),
    obsidianLinkWords: sanitizeObsidianLinkWords(data.obsidianLinkWords),
    obsidianLinkify: Boolean(data.obsidianLinkify),
  };
};

/**
 * インポート内容を現在の設定へマージする（既存は削除しない）。
 * @param {{tagCandidates: string[], tagSets: object[], obsidianLinkWords: string[], obsidianLinkify: boolean}} payload - 取り込み内容。
 * @returns {object} マージ結果と件数。
 */
const mergeTransferPayload = (payload) => {
  // タグ候補に無いタグはタグセットから落ちるため、セットが使うタグも候補へ取り込む。
  const incomingTags = [...payload.tagCandidates];
  payload.tagSets.forEach((set) => {
    set.tags.forEach((tag) => {
      if (!incomingTags.includes(tag)) {
        incomingTags.push(tag);
      }
    });
  });

  const tagResult = addUniqueValues(presetTagCandidates, incomingTags);
  const wordResult = addUniqueValues(presetObsidianLinkWords, payload.obsidianLinkWords);

  const knownNames = new Set(presetTagSets.map((set) => set.name));
  const tagSets = [...presetTagSets];
  let addedTagSets = 0;
  let skippedTagSets = 0;
  let droppedTagSets = 0;

  payload.tagSets.forEach((set) => {
    if (knownNames.has(set.name)) {
      skippedTagSets += 1;
      return;
    }
    if (tagSets.length >= MAX_TAG_SETS) {
      droppedTagSets += 1;
      return;
    }
    knownNames.add(set.name);
    tagSets.push({ id: createTagSetId(), name: set.name, tags: [...set.tags] });
    addedTagSets += 1;
  });

  return {
    tagCandidates: tagResult.unique,
    tagSets,
    obsidianLinkWords: wordResult.unique,
    // マージなので ON を OFF に戻すことはしない。
    obsidianLinkify: obsidianLinkifyEnabled || payload.obsidianLinkify,
    linkifyTurnedOn: !obsidianLinkifyEnabled && payload.obsidianLinkify,
    addedTags: tagResult.addedCount,
    addedTagSets,
    addedWords: wordResult.addedCount,
    skipped: tagResult.skippedCount + skippedTagSets + wordResult.skippedCount,
    droppedTagSets,
  };
};

/** 現在の設定を JSON ファイルとして書き出す。 */
const exportSettings = () => {
  try {
    const filename = buildTransferFilename();
    const blob = new Blob([`${JSON.stringify(buildTransferPayload(), null, 2)}\n`], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // ダウンロード開始前に無効化しないよう、URL の解放は次のタスクへ回す。
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setStatus(STATUS_TARGETS.transfer, t("options.transfer.exported", { filename }));
  } catch {
    setStatus(STATUS_TARGETS.transfer, t("options.transfer.exportFailed"));
  }
};

/**
 * 選択されたファイルを取り込み、既存設定へマージして保存する。
 * @param {File} file - 選択されたファイル。
 */
const importSettings = async (file) => {
  let text = "";
  try {
    text = await file.text();
  } catch {
    setStatus(STATUS_TARGETS.transfer, t("options.transfer.readFailed"));
    return;
  }

  let payload;
  try {
    payload = parseTransferPayload(text);
  } catch (error) {
    setStatus(
      STATUS_TARGETS.transfer,
      error instanceof Error ? error.message : t("options.transfer.invalidFormat")
    );
    return;
  }

  const isEmpty =
    payload.tagCandidates.length === 0 &&
    payload.tagSets.length === 0 &&
    payload.obsidianLinkWords.length === 0 &&
    !payload.obsidianLinkify;
  if (isEmpty) {
    setStatus(STATUS_TARGETS.transfer, t("options.transfer.nothingToImport"));
    return;
  }

  const merged = mergeTransferPayload(payload);
  presetTagCandidates = merged.tagCandidates;
  presetTagSets = merged.tagSets;
  presetObsidianLinkWords = merged.obsidianLinkWords;
  obsidianLinkifyEnabled = merged.obsidianLinkify;
  if (obsidianLinkifyEl) {
    obsidianLinkifyEl.checked = obsidianLinkifyEnabled;
  }

  await persistConfigs();
  render();

  const message =
    t("options.transfer.imported", {
      tags: merged.addedTags,
      tagSets: merged.addedTagSets,
      words: merged.addedWords,
      skipped: merged.skipped,
    }) +
    (merged.droppedTagSets > 0
      ? t("options.transfer.tagSetsDropped", {
          dropped: merged.droppedTagSets,
          max: MAX_TAG_SETS,
        })
      : "") +
    (merged.linkifyTurnedOn ? t("options.transfer.linkifyEnabled") : "");
  setStatus(STATUS_TARGETS.transfer, message);
};

/* --------------------------- ディレクトリハンドル --------------------------- */

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
 * 指定プリセットIDのディレクトリハンドルを取得する。
 * @param {string} presetId - 対象プリセットID。
 * @returns {Promise<FileSystemDirectoryHandle|null>} ハンドル。未保存なら null。
 */
const getHandle = async (presetId) => {
  const db = await openPresetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get(presetId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
};

/**
 * 保存済みハンドルの書き込み権限状態を返す。
 * @param {string} handleKey - ハンドルのキー。
 * @returns {Promise<"granted"|"prompt"|"missing">} 権限状態。
 */
const readPermissionState = async (handleKey) => {
  try {
    const handle = await getHandle(handleKey);
    if (!handle) {
      return "missing";
    }
    const permission = await handle.queryPermission({ mode: "readwrite" });
    return permission === "granted" ? "granted" : "prompt";
  } catch {
    return "missing";
  }
};

/**
 * フォルダ設定済みの各ハンドルについて権限状態を取り直す。
 */
const refreshPermissionStates = async () => {
  const targets = [
    ...PRESET_IDS.filter((id) => presetConfigs[id]?.hasFolder),
    ...(imageFolderConfig.hasFolder ? [IMAGE_FOLDER_HANDLE_KEY] : []),
  ];
  const states = {};
  await Promise.all(
    targets.map(async (key) => {
      states[key] = await readPermissionState(key);
    })
  );
  permissionStates = states;
};

/**
 * 保存済みフォルダへのアクセス権限を再要求する（ボタン操作から呼ぶこと）。
 * @param {string} handleKey - ハンドルのキー。
 * @param {string} statusTarget - メッセージ表示先。
 */
const requestFolderPermission = async (handleKey, statusTarget) => {
  try {
    const handle = await getHandle(handleKey);
    if (!handle) {
      permissionStates[handleKey] = "missing";
      render();
      setStatus(statusTarget, t("options.folder.handleMissing"));
      return;
    }
    const permission = await handle.requestPermission({ mode: "readwrite" });
    permissionStates[handleKey] = permission === "granted" ? "granted" : "prompt";
    render();
    setStatus(
      statusTarget,
      permission === "granted"
        ? t("options.folder.grantSucceeded")
        : t("options.folder.grantDenied")
    );
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus(statusTarget, t("options.folder.grantFailed"));
    }
  }
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

/* ------------------------------ スキ数の更新 ------------------------------ */

let likeCountRunning = false;
let likeCountCancelRequested = false;

/**
 * 指定ミリ秒待つ。
 * @param {number} ms - 待機時間。
 * @returns {Promise<void>} 待機の完了。
 */
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** フォルダを設定済みのプリセットID一覧を返す。 */
const getFolderReadyPresetIds = () => PRESET_IDS.filter((id) => presetConfigs[id]?.hasFolder);

/** 実行中かどうかに応じてボタンと選択欄の状態を切り替える。 */
const setLikeCountRunning = (running) => {
  likeCountRunning = running;
  const hasTarget = getFolderReadyPresetIds().length > 0;
  if (likeCountRunBtn) {
    likeCountRunBtn.disabled = running || !hasTarget;
  }
  if (likeCountPresetEl) {
    likeCountPresetEl.disabled = running || !hasTarget;
  }
  likeCountCancelBtn?.classList.toggle("hidden", !running);
  if (likeCountCancelBtn) {
    likeCountCancelBtn.disabled = false;
  }
};

/** スキ数更新の対象プリセット選択欄を描画する。 */
const renderLikeCountField = () => {
  if (!likeCountPresetEl) {
    return;
  }

  const readyIds = getFolderReadyPresetIds();
  const previous = likeCountPresetEl.value;
  likeCountPresetEl.innerHTML = "";

  readyIds.forEach((id) => {
    const config = presetConfigs[id];
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${presetDisplayName(id, config)}${t("preset.optionSuffixConfigured", {
      label: config.folderLabel || t("preset.folderSelected"),
    })}`;
    likeCountPresetEl.appendChild(option);
  });

  likeCountPresetEl.value = readyIds.includes(previous) ? previous : readyIds[0] ?? "";
  likeCountPresetHintEl?.classList.toggle("hidden", readyIds.length > 0);
  setLikeCountRunning(likeCountRunning);
};

/**
 * 実行前の確認ダイアログを出す。
 * @param {{folder: string, total: number, targets: number, skipped: number}} summary - 走査結果。
 * @returns {Promise<boolean>} 実行するなら true。
 */
const confirmLikeCountUpdate = (summary) =>
  new Promise((resolveConfirm) => {
    if (!likeCountConfirmModalEl || !likeCountConfirmFormEl) {
      resolveConfirm(false);
      return;
    }

    if (likeCountConfirmBodyEl) {
      likeCountConfirmBodyEl.textContent = t("options.likeCount.confirmBody", summary);
    }
    if (likeCountConfirmSkippedEl) {
      likeCountConfirmSkippedEl.textContent =
        summary.skipped > 0 ? t("options.likeCount.confirmSkipped", { count: summary.skipped }) : "";
      likeCountConfirmSkippedEl.classList.toggle("hidden", summary.skipped === 0);
    }

    const finish = (accepted) => {
      likeCountConfirmFormEl.removeEventListener("submit", onSubmit);
      likeCountConfirmCancelBtn?.removeEventListener("click", onCancel);
      likeCountConfirmModalEl.removeEventListener("close", onCancel);
      likeCountConfirmModalEl.close();
      resolveConfirm(accepted);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      finish(true);
    };
    const onCancel = () => finish(false);

    likeCountConfirmFormEl.addEventListener("submit", onSubmit);
    likeCountConfirmCancelBtn?.addEventListener("click", onCancel);
    // Esc で閉じられた場合も「実行しない」として扱う。
    likeCountConfirmModalEl.addEventListener("close", onCancel);
    likeCountConfirmModalEl.showModal();
  });

/**
 * 対象ファイルを1件ずつ処理してスキ数を書き戻す。
 * @param {object[]} targets - planUpdates が返した更新対象。
 * @param {number} skippedCount - note_id を解決できなかった件数。
 */
const applyLikeCountUpdates = async (targets, skippedCount) => {
  // 同じ記事が複数ファイルにある場合に API を二度叩かないようにする。
  const likeCountCache = new Map();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (let index = 0; index < targets.length; index += 1) {
    if (likeCountCancelRequested) {
      break;
    }
    const target = targets[index];
    setStatus(
      STATUS_TARGETS.likeCount,
      t("options.likeCount.progress", { current: index + 1, total: targets.length })
    );

    try {
      let likeCount = likeCountCache.get(target.noteId);
      if (likeCount === undefined) {
        likeCount = await NtmLikeCount.fetchLikeCount(target.noteId);
        likeCountCache.set(target.noteId, likeCount);
        // note の API を連続で叩かないよう間隔を空ける。
        await sleep(NtmLikeCount.DEFAULT_DELAY_MS);
      }

      // 値が同じなら書き込まない。Obsidian の同期が無駄に走るのを避ける。
      if (target.currentLikeCount === likeCount) {
        unchanged += 1;
        continue;
      }

      const writable = await target.handle.createWritable();
      await writable.write(NtmLikeCount.applyLikeCountToContent(target.content, likeCount));
      await writable.close();
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  if (likeCountCancelRequested) {
    setStatus(
      STATUS_TARGETS.likeCount,
      t("options.likeCount.cancelled", {
        updated,
        unchanged,
        remaining: targets.length - updated - unchanged - failed,
      })
    );
    return;
  }

  setStatus(
    STATUS_TARGETS.likeCount,
    t("options.likeCount.done", { updated, unchanged, skipped: skippedCount, failed })
  );
};

/**
 * スキ数更新の一連の流れ（権限確認 → 走査 → 確認 → 実行）を行う。
 * @param {{canRequestPermission?: boolean}} [options={}] - 権限ダイアログを出してよいか。
 *   popup からの自動起動はユーザー操作の文脈が無いため false で呼ぶ。
 */
const runLikeCountUpdate = async ({ canRequestPermission = true } = {}) => {
  const presetId = likeCountPresetEl?.value ?? "";
  if (!presetId || likeCountRunning) {
    return;
  }

  likeCountCancelRequested = false;
  setLikeCountRunning(true);

  try {
    // requestPermission はユーザー操作の直後でないと通らないため、走査より先に済ませる。
    const handle = await getHandle(presetId);
    if (!handle) {
      setStatus(STATUS_TARGETS.likeCount, t("options.likeCount.permissionRequired"));
      return;
    }
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && canRequestPermission) {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") {
      permissionStates[presetId] = "prompt";
      render();
      setStatus(STATUS_TARGETS.likeCount, t("options.likeCount.permissionRequired"));
      return;
    }

    setStatus(STATUS_TARGETS.likeCount, t("options.likeCount.scanning"));
    const files = await NtmLikeCount.collectMarkdownFiles(handle);
    const { targets, skipped } = await NtmLikeCount.planUpdates(files);

    if (targets.length === 0) {
      setStatus(STATUS_TARGETS.likeCount, t("options.likeCount.noTargets"));
      return;
    }

    const accepted = await confirmLikeCountUpdate({
      folder: presetConfigs[presetId]?.folderLabel || presetDisplayName(presetId, presetConfigs[presetId]),
      total: files.length,
      targets: targets.length,
      skipped: skipped.length,
    });
    if (!accepted) {
      clearStatus(STATUS_TARGETS.likeCount);
      return;
    }

    await applyLikeCountUpdates(targets, skipped.length);
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus(STATUS_TARGETS.likeCount, t("options.likeCount.failed"));
    }
  } finally {
    likeCountCancelRequested = false;
    setLikeCountRunning(false);
  }
};

/**
 * popup の「スキ数を更新」から開かれた場合に、その場で処理を始める。
 * popup 内では権限ダイアログを開けず、閉じると処理も消えるため、
 * 実行の意思だけを storage 経由で受け取ってこちらで実行する。
 */
const consumePendingLikeCountRun = async () => {
  let stored = {};
  try {
    stored = await chrome.storage.local.get([PENDING_LIKE_COUNT_RUN_KEY]);
  } catch {
    return;
  }
  if (!stored[PENDING_LIKE_COUNT_RUN_KEY]) {
    return;
  }

  // 再読み込みで再実行されないよう、先に消しておく。
  try {
    await chrome.storage.local.remove(PENDING_LIKE_COUNT_RUN_KEY);
  } catch {
    // 消せなくても実行自体は続ける
  }

  try {
    likeCountSectionEl?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  } catch {
    // スクロールできなくても実行には影響しない
  }
  await runLikeCountUpdate({ canRequestPermission: false });
};

/* -------------------------------- 描画処理 -------------------------------- */

/**
 * data-i18n では表せない、上限値などを差し込む文言を反映する。
 */
const renderParameterizedText = () => {
  if (tagSetSectionHintEl) {
    tagSetSectionHintEl.textContent = t("options.tagSet.hint", {
      maxTags: MAX_TAGS_PER_SET,
      maxSets: MAX_TAG_SETS,
    });
  }
  if (tagSetSelectHintEl) {
    tagSetSelectHintEl.textContent = t("options.tagSet.selectHint", { max: MAX_TAGS_PER_SET });
  }
};

/** 現在stateをオプション画面UIへ反映する。 */
const render = () => {
  renderParameterizedText();

  if (languageSelectEl) {
    languageSelectEl.value = NtmI18n.getSetting();
  }

  PRESET_IDS.forEach((id) => {
    const config = presetConfigs[id];
    const title = document.querySelector(`[data-preset-id="${id}"] h3`);
    const nameInput = $(`${id}Name`);
    const folderLabel = $(`${id}Folder`);
    if (title) {
      title.textContent = presetDisplayName(id, config);
    }
    if (nameInput && nameInput.value !== config.name) {
      nameInput.value = config.name;
    }
    applyFolderLabel(
      folderLabel,
      $(`${id}Grant`),
      buildFolderLabel(config, id, t("options.preset.folderUnsetForDownload"))
    );
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
      removeBtn.textContent = t("common.remove");
      removeBtn.addEventListener("click", async () => {
        presetTagCandidates = presetTagCandidates.filter((value) => value !== tag);
        const tagSetsChanged = removeTagFromTagSets(tag);
        await persistConfigs();
        render();
        setStatus(
          STATUS_TARGETS.tag,
          tagSetsChanged
            ? t("options.tag.removedWithSets", { tag })
            : t("options.tag.removed", { tag })
        );
      });

      item.append(text, removeBtn);
      tagCandidateListEl.appendChild(item);
    });
  }

  if (tagCandidateEmptyHintEl) {
    tagCandidateEmptyHintEl.style.display = presetTagCandidates.length > 0 ? "none" : "block";
  }

  if (tagSetListEl) {
    tagSetListEl.innerHTML = "";
    presetTagSets.forEach((tagSet) => {
      const card = document.createElement("article");
      card.className = "tag-set-card";

      const body = document.createElement("div");
      body.className = "tag-set-card-body";

      const name = document.createElement("div");
      name.className = "tag-set-name";
      name.textContent = tagSet.name;

      const tags = document.createElement("div");
      tags.className = "tag-set-tags";
      tags.textContent = tagSet.tags.map((tag) => `#${tag}`).join(" ");

      body.append(name, tags);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost";
      editBtn.textContent = t("options.tagSet.edit");
      editBtn.addEventListener("click", () => {
        startTagSetEdit(tagSet);
        setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.editing", { name: tagSet.name }));
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost";
      removeBtn.textContent = t("common.remove");
      removeBtn.addEventListener("click", async () => {
        presetTagSets = presetTagSets.filter((set) => set.id !== tagSet.id);
        if (editingTagSetId === tagSet.id) {
          resetTagSetForm();
        }
        await persistConfigs();
        render();
        setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.removed", { name: tagSet.name }));
      });

      card.append(body, editBtn, removeBtn);
      tagSetListEl.appendChild(card);
    });
  }

  if (tagSetEmptyHintEl) {
    tagSetEmptyHintEl.style.display = presetTagSets.length > 0 ? "none" : "block";
  }

  renderTagSetForm(
    editingTagSetId
      ? presetTagSets.find((set) => set.id === editingTagSetId)?.tags ?? []
      : getTagSetFormTags()
  );

  if (obsidianWordListEl) {
    obsidianWordListEl.innerHTML = "";
    presetObsidianLinkWords.forEach((word) => {
      const item = document.createElement("div");
      item.className = "tag-item";

      const text = document.createElement("span");
      text.textContent = word;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = t("common.remove");
      removeBtn.addEventListener("click", async () => {
        presetObsidianLinkWords = presetObsidianLinkWords.filter((value) => value !== word);
        await persistConfigs();
        render();
        setStatus(STATUS_TARGETS.obsidian, t("options.obsidian.removed", { word }));
      });

      item.append(text, removeBtn);
      obsidianWordListEl.appendChild(item);
    });
  }

  if (obsidianWordEmptyHintEl) {
    obsidianWordEmptyHintEl.style.display = presetObsidianLinkWords.length > 0 ? "none" : "block";
  }

  setSelectedRadio(imageImportModeInputs, imageImportMode);
  renderImageFolderField();
  renderLikeCountField();
};

/** 現在stateを chrome.storage.local へ保存する。 */
const persistConfigs = async () => {
  await chrome.storage.local.set({
    presetConfigs,
    presetTagCandidates,
    presetTagSets,
    presetObsidianLinkWords,
    obsidianLinkify: obsidianLinkifyEnabled,
    imageImportMode,
    imageFolderConfig,
  });
};

/** 保存済み設定を読み込み、stateとUIを初期化する。 */
const loadConfigs = async () => {
  await NtmI18n.init();
  NtmI18n.applyDom(document);

  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  presetConfigs = sanitizePresetConfigs(stored.presetConfigs ?? DEFAULT_PRESET_CONFIGS);
  // 旧バージョンが保存した既定名は「未設定」とみなし、表示言語に追従させる。
  PRESET_IDS.forEach((id, index) => {
    if (presetConfigs[id].name === LEGACY_DEFAULT_PRESET_NAMES[index]) {
      presetConfigs[id].name = "";
    }
  });
  presetTagCandidates = sanitizeTagCandidates(stored.presetTagCandidates ?? []);
  presetTagSets = sanitizeTagSets(stored.presetTagSets ?? []).map((set) => ({
    ...set,
    tags: set.tags.filter((tag) => presetTagCandidates.includes(tag)),
  })).filter((set) => set.tags.length > 0);
  presetObsidianLinkWords = sanitizeObsidianLinkWords(stored.presetObsidianLinkWords ?? []);
  obsidianLinkifyEnabled = Boolean(stored.obsidianLinkify);
  imageImportMode = normalizeImageImportMode(stored.imageImportMode);
  imageFolderConfig = sanitizeImageFolderConfig(stored.imageFolderConfig ?? DEFAULT_IMAGE_FOLDER_CONFIG);
  if (obsidianLinkifyEl) {
    obsidianLinkifyEl.checked = obsidianLinkifyEnabled;
  }
  render();
  // 権限状態の取得は非同期なので、取得でき次第もう一度描画する。
  await refreshPermissionStates();
  render();
};

/** 各UI操作のイベントハンドラをバインドする。 */
const bindEvents = () => {
  languageSelectEl?.addEventListener("change", async () => {
    await NtmI18n.setLanguage(languageSelectEl.value);
    // 静的な文言とJSが組み立てる文言の両方を、その場で新しい言語に差し替える。
    NtmI18n.applyDom(document);
    render();
    setStatus(
      STATUS_TARGETS.language,
      t("options.language.saved", {
        label: t(`options.language.${NtmI18n.getSetting()}`),
      })
    );
  });

  PRESET_IDS.forEach((id) => {
    const nameInput = $(`${id}Name`);
    const pickBtn = $(`${id}Pick`);
    const clearBtn = $(`${id}Clear`);

    nameInput?.addEventListener("change", async () => {
      presetConfigs[id].name = nameInput.value.trim();
      await persistConfigs();
      render();
      setStatus(STATUS_TARGETS.tag, t("options.preset.nameSaved"));
    });

    $(`${id}Grant`)?.addEventListener("click", async () => {
      await requestFolderPermission(id, STATUS_TARGETS.tag);
    });

    pickBtn?.addEventListener("click", async () => {
      try {
        const handle = await window.showDirectoryPicker();
        const permission = await handle.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") {
          setStatus(STATUS_TARGETS.tag, t("options.folder.writeDenied"));
          return;
        }
        await saveHandle(id, handle);
        presetConfigs[id].folderLabel = handle.name || "";
        presetConfigs[id].hasFolder = true;
        permissionStates[id] = "granted";
        await persistConfigs();
        render();
        setStatus(STATUS_TARGETS.tag, t("options.preset.folderSaved"));
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(STATUS_TARGETS.tag, t("options.folder.pickFailed"));
        }
      }
    });

    clearBtn?.addEventListener("click", async () => {
      try {
        await deleteHandle(id);
        presetConfigs[id].folderLabel = "";
        presetConfigs[id].hasFolder = false;
        delete permissionStates[id];
        await persistConfigs();
        render();
        setStatus(STATUS_TARGETS.tag, t("options.preset.folderCleared"));
      } catch {
        setStatus(STATUS_TARGETS.tag, t("options.folder.clearFailed"));
      }
    });
  });

  addTagBtn?.addEventListener("click", async () => {
    const value = normalizeTagValue(newTagInputEl?.value ?? "");
    if (!value) {
      setStatus(STATUS_TARGETS.tag, t("options.tag.nameRequired"));
      return;
    }
    if (presetTagCandidates.includes(value)) {
      setStatus(STATUS_TARGETS.tag, t("options.tag.duplicate"));
      return;
    }
    presetTagCandidates = [...presetTagCandidates, value];
    await persistConfigs();
    if (newTagInputEl) {
      newTagInputEl.value = "";
    }
    render();
    setStatus(STATUS_TARGETS.tag, t("options.tag.added", { tag: value }));
  });

  newTagInputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTagBtn?.click();
    }
  });

  saveTagSetBtn?.addEventListener("click", async () => {
    await saveTagSet();
  });

  tagSetNameInputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveTagSetBtn?.click();
    }
  });

  cancelTagSetEditBtn?.addEventListener("click", () => {
    resetTagSetForm();
    setStatus(STATUS_TARGETS.tagSet, t("options.tagSet.editCancelled"));
  });

  addObsidianWordBtn?.addEventListener("click", async () => {
    const value = normalizeObsidianWordValue(newObsidianWordInputEl?.value ?? "");
    if (!value) {
      setStatus(STATUS_TARGETS.obsidian, t("options.obsidian.wordRequired"));
      return;
    }
    if (presetObsidianLinkWords.includes(value)) {
      setStatus(STATUS_TARGETS.obsidian, t("options.obsidian.duplicate"));
      return;
    }
    presetObsidianLinkWords = [...presetObsidianLinkWords, value];
    await persistConfigs();
    if (newObsidianWordInputEl) {
      newObsidianWordInputEl.value = "";
    }
    render();
    setStatus(STATUS_TARGETS.obsidian, t("options.obsidian.added", { word: value }));
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
      obsidianLinkifyEnabled ? t("options.obsidian.enabled") : t("options.obsidian.disabled")
    );
  });

  imageImportModeInputs.forEach((input) => {
    input.addEventListener("change", async () => {
      imageImportMode = getSelectedImageImportMode();
      renderImageFolderField();
      await persistConfigs();
      const labelKeys = {
        url: "options.image.modeUrlShort",
        download: "options.image.modeDownloadShort",
        base64: "options.image.modeBase64Short",
      };
      setStatus(
        STATUS_TARGETS.image,
        t("options.image.modeSaved", { label: t(labelKeys[imageImportMode]) })
      );
    });
  });

  imageFolderPickBtn?.addEventListener("click", async () => {
    try {
      const handle = await window.showDirectoryPicker();
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        setStatus(STATUS_TARGETS.image, t("options.folder.writeDenied"));
        return;
      }
      await saveHandle(IMAGE_FOLDER_HANDLE_KEY, handle);
      imageFolderConfig = {
        folderLabel: handle.name || "",
        hasFolder: true,
      };
      permissionStates[IMAGE_FOLDER_HANDLE_KEY] = "granted";
      await persistConfigs();
      renderImageFolderField();
      setStatus(STATUS_TARGETS.image, t("options.image.folderSaved"));
    } catch (error) {
      if (error?.name !== "AbortError") {
        setStatus(STATUS_TARGETS.image, t("options.folder.pickFailed"));
      }
    }
  });

  imageFolderGrantBtn?.addEventListener("click", async () => {
    await requestFolderPermission(IMAGE_FOLDER_HANDLE_KEY, STATUS_TARGETS.image);
  });

  imageFolderClearBtn?.addEventListener("click", async () => {
    try {
      await deleteHandle(IMAGE_FOLDER_HANDLE_KEY);
      imageFolderConfig = { ...DEFAULT_IMAGE_FOLDER_CONFIG };
      delete permissionStates[IMAGE_FOLDER_HANDLE_KEY];
      await persistConfigs();
      renderImageFolderField();
      setStatus(STATUS_TARGETS.image, t("options.image.folderCleared"));
    } catch {
      setStatus(STATUS_TARGETS.image, t("options.folder.clearFailed"));
    }
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

  likeCountRunBtn?.addEventListener("click", async () => {
    await runLikeCountUpdate();
  });

  likeCountCancelBtn?.addEventListener("click", () => {
    if (!likeCountRunning) {
      return;
    }
    likeCountCancelRequested = true;
    if (likeCountCancelBtn) {
      likeCountCancelBtn.disabled = true;
    }
    setStatus(STATUS_TARGETS.likeCount, t("options.likeCount.cancelling"));
  });

  exportSettingsBtn?.addEventListener("click", () => {
    exportSettings();
  });

  importSettingsBtn?.addEventListener("click", () => {
    importSettingsInputEl?.click();
  });

  importSettingsInputEl?.addEventListener("change", async () => {
    const file = importSettingsInputEl.files?.[0];
    // 同じファイルを選び直しても change が発火するよう、毎回入力値を空へ戻す。
    importSettingsInputEl.value = "";
    if (!file) {
      return;
    }
    await importSettings(file);
  });
};

void loadConfigs().then(async () => {
  Object.values(STATUS_TARGETS).forEach((target) => clearStatus(target));
  bindEvents();
  await consumePendingLikeCountRun();
});

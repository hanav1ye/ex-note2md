// 拡張機能ポップアップ: 変換元・出力先の選択と変換実行
const t = (key, params) => NtmI18n.t(key, params);

/** 保存先プリセットの数。options.js の PRESET_COUNT と揃えること。 */
const PRESET_COUNT = 5;
const FOLDER_PRESET_IDS = Array.from({ length: PRESET_COUNT }, (_, index) => `preset${index + 1}`);
// 1.0.0 までは既定の表示名を日本語のまま保存していた。表示だけロケールに追従させる。
const LEGACY_DEFAULT_PRESET_NAMES = ["プリセット1", "プリセット2", "プリセット3"];
const IMAGE_IMPORT_MODES = ["url", "download", "base64"];
const DEFAULT_IMAGE_FOLDER_CONFIG = { folderLabel: "", hasFolder: false };
const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const convertBtn = $("convertBtn");
const settingsBtn = $("settingsBtn");
const likeCountBtn = $("likeCountBtn");
const urlFieldEl = $("urlField");
const tabFieldEl = $("tabField");
const tabArticleTitleEl = $("tabArticleTitle");
const articleUrlEl = $("articleUrl");
const pickUrlBtn = $("pickUrlBtn");
const pickMultiBtn = $("pickMultiBtn");
const downloadLocationFieldEl = $("downloadLocationField");
const downloadPresetEl = $("downloadPreset");
const downloadPresetHintEl = $("downloadPresetHint");
const tagSetFieldEl = $("tagSetField");
const tagSetSelectEl = $("tagSetSelect");
const tagSelectorEl = $("tagSelector");
const tagSelectorHintEl = $("tagSelectorHint");
const splashEl = $("splash");
const splashMarkEl = $("splashMark");
const splashTitleEl = $("splashTitle");
const splashMessageEl = $("splashMessage");
const sourceModeInputs = document.querySelectorAll('input[name="sourceMode"]');
const outputModeInputs = document.querySelectorAll('input[name="outputMode"]');

const MAX_TAGS = 5;
const STORAGE_KEY_NAMES = [
  "sourceMode",
  "outputMode",
  "articleUrl",
  "tags",
  "downloadPreset",
  "imageImportMode",
  "imageFolderConfig",
  "presetConfigs",
  "presetTagCandidates",
  "presetTagSets",
  "selectedTagSetId",
];
/**
 * 未設定状態のプリセット設定を作る。
 * @returns {Record<string, {name: string, folderLabel: string, hasFolder: boolean}>} 既定設定。
 */
const createDefaultPresetConfigs = () =>
  Object.fromEntries(
    FOLDER_PRESET_IDS.map((id) => [id, { name: "", folderLabel: "", hasFolder: false }])
  );

let presetConfigs = createDefaultPresetConfigs();
let presetTagCandidates = [];
let presetTagSets = [];
let splashTimer = null;

/**
 * ステータス行にメッセージを表示する。
 * @param {string} message - 表示文言。
 * @param {""|"ok"|"error"} [kind=""] - 表示種別。
 */
const setStatus = (message, kind = "") => {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
};

/**
 * 現在アクティブなタブを取得する。
 * @returns {Promise<chrome.tabs.Tab>} アクティブタブ。
 */
const getActiveNoteTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error(t("error.noActiveTab"));
  }
  return tab;
};

/**
 * ページ上の単一リンク選択モードを開始する。
 * content scriptへ現在の設定を渡す。
 */
const startLinkPickMode = async () => {
  try {
    const imageSettings = await getStoredImageSettings();
    assertImageFolderReady(imageSettings);
    const tab = await getActiveNoteTab();
    if (!tab.url.startsWith("https://note.com/")) {
      throw new Error(t("popup.error.openNoteForSinglePick"));
    }

    const obsidianSettings = await getStoredObsidianSettings();
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "startLinkPickMode",
      outputMode: getSelectedOutputMode(),
      downloadPreset: downloadPresetEl.value,
      tags: getUserTags(),
      obsidianLinkify: obsidianSettings.obsidianLinkify,
    });
    if (!response?.ok) {
      throw new Error(response?.error ?? t("popup.error.startSinglePickFailed"));
    }
    setStatus(t("popup.status.pickStarted"), "ok");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t("popup.error.startSinglePickFailed");
    setStatus(message, "error");
  }
};

/** ページ上の複数リンク選択モードを開始する。 */
const startMultiPickMode = async () => {
  try {
    const tab = await getActiveNoteTab();
    if (!tab.url.startsWith("https://note.com/")) {
      throw new Error(t("popup.error.openNoteForMultiPick"));
    }
    const obsidianSettings = await getStoredObsidianSettings();
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "startMultiLinkPickMode",
      downloadPreset: downloadPresetEl.value,
      tags: getUserTags(),
      obsidianLinkify: obsidianSettings.obsidianLinkify,
    });
    if (!response?.ok) {
      throw new Error(response?.error ?? t("popup.error.startMultiPickFailed"));
    }
    setStatus(t("popup.status.multiPickStarted"), "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : t("popup.error.startMultiPickFailed");
    setStatus(message, "error");
  }
};

/**
 * ポップアップ内の完了通知（スプラッシュ）を表示する。
 * @param {string} title - タイトル。
 * @param {string} message - 詳細文。
 * @param {"ok"|"skip"} [variant="ok"] - 表示バリエーション。
 */
const showSplash = (title, message, variant = "ok") => {
  if (!splashEl || !splashMarkEl || !splashTitleEl || !splashMessageEl) {
    return;
  }
  splashEl.classList.toggle("skip", variant === "skip");
  splashMarkEl.textContent = variant === "skip" ? "!" : "✓";
  splashTitleEl.textContent = title;
  splashMessageEl.textContent = message;
  splashEl.classList.remove("hidden");
  requestAnimationFrame(() => splashEl.classList.add("show"));

  if (splashTimer) {
    clearTimeout(splashTimer);
  }
  splashTimer = setTimeout(() => {
    splashEl.classList.remove("show");
    setTimeout(() => {
      splashEl.classList.add("hidden");
    }, 180);
  }, 2600);
};

const isNoteArticleUrl = (url) => NoteToMarkdown.isNoteArticleUrl(url);

/**
 * 変換元ラジオの現在値を取得する。
 * @returns {"tab"|"url"} 選択中の変換元。
 */
const getSelectedSourceMode = () =>
  document.querySelector('input[name="sourceMode"]:checked')?.value ?? "tab";

/**
 * 変換後ラジオの現在値を取得する。
 * @returns {"copy"|"download"} 選択中の出力先。
 */
const getSelectedOutputMode = () =>
  document.querySelector('input[name="outputMode"]:checked')?.value ?? "copy";

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

/** URL入力欄の表示/非表示を切り替える。 */
const updateUrlFieldVisibility = () => {
  urlFieldEl.classList.toggle("hidden", getSelectedSourceMode() !== "url");
};

/** 現在のタブ欄の表示/非表示を切り替える。 */
const updateTabFieldVisibility = () => {
  tabFieldEl.classList.toggle("hidden", getSelectedSourceMode() !== "tab");
};

/**
 * ブラウザタブの title 属性から記事タイトルを推定する。
 * @param {string} tabTitle - タブタイトル。
 * @returns {string} 推定タイトル。
 */
const sanitizeTabTitle = (tabTitle) => tabTitle.replace(/\s*[｜|]\s*[^｜|]+$/, "").trim();

/**
 * 現在のタブの記事タイトルを表示欄へ反映する。
 */
const updateCurrentTabArticleTitle = async () => {
  if (!tabArticleTitleEl || getSelectedSourceMode() !== "tab") {
    return;
  }

  tabArticleTitleEl.textContent = t("popup.status.loadingTitle");
  tabArticleTitleEl.classList.remove("error");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error(t("error.noActiveTab"));
    }
    if (!isNoteArticleUrl(tab.url)) {
      throw new Error(t("error.notNoteArticlePage"));
    }

    let title = "";
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "getArticleTitle" });
      if (response?.ok && response.title) {
        title = response.title;
      } else {
        throw new Error(response?.error ?? t("error.titleUnavailable"));
      }
    } catch {
      const fallbackTitle = sanitizeTabTitle(tab.title ?? "");
      if (!fallbackTitle) {
        throw new Error(t("error.reloadAndRetry"));
      }
      title = fallbackTitle;
    }

    tabArticleTitleEl.textContent = title;
  } catch (error) {
    const message = error instanceof Error ? error.message : t("error.titleUnavailable");
    tabArticleTitleEl.textContent = message;
    tabArticleTitleEl.classList.add("error");
  }
};

/** ダウンロード先選択欄の表示/非表示を切り替える。 */
const updateDownloadLocationVisibility = () => {
  const isDownload = getSelectedOutputMode() === "download";
  downloadLocationFieldEl.classList.toggle("hidden", !isDownload);
  if (isDownload) {
    updateDownloadPresetHint();
  }
};

/**
 * オプション画面で設定された画像取込方式を storage から取得する。
 * @returns {Promise<{imageImportMode: "url"|"download"|"base64", imageFolderConfig: {folderLabel: string, hasFolder: boolean}}>}
 */
const getStoredImageSettings = async () => {
  if (!chrome.storage?.local) {
    return { imageImportMode: "url", imageFolderConfig: { ...DEFAULT_IMAGE_FOLDER_CONFIG } };
  }
  const stored = await chrome.storage.local.get(["imageImportMode", "imageFolderConfig"]);
  const imageImportMode = IMAGE_IMPORT_MODES.includes(stored.imageImportMode)
    ? stored.imageImportMode
    : "url";
  const imageFolderConfig = {
    folderLabel: String(stored.imageFolderConfig?.folderLabel ?? "").trim(),
    hasFolder: Boolean(stored.imageFolderConfig?.hasFolder),
  };
  return { imageImportMode, imageFolderConfig };
};

const noteFolderNameFromUrl = (articleUrl) => NoteToMarkdown.noteFolderNameFromUrl(articleUrl);

/**
 * タグ入力値を正規化する（先頭#を除去）。
 * @param {string} tag - 生タグ文字列。
 * @returns {string} 正規化済みタグ。
 */
const normalizeTag = (tag) => String(tag).replace(/^#/, "").trim();

/**
 * タグ候補配列を正規化し、空・重複を除去する。
 * @param {unknown[]} candidates - 保存済み候補配列。
 * @returns {string[]} 正規化済み候補。
 */
const sanitizeTagCandidates = (candidates) => {
  const normalized = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const value = normalizeTag(candidate);
    if (value && !normalized.includes(value)) {
      normalized.push(value);
    }
  });
  return normalized;
};

/**
 * タグセット配列を正規化する（存在しないタグ候補は除外）。
 * @param {unknown[]} sets - 保存済みタグセット。
 * @returns {{id: string, name: string, tags: string[]}[]} 正規化済みタグセット一覧。
 */
const sanitizeTagSets = (sets) => {
  const normalized = [];
  (Array.isArray(sets) ? sets : []).forEach((set) => {
    const id = String(set?.id ?? "").trim();
    const name = String(set?.name ?? "").trim();
    const tags = sanitizeTagCandidates(set?.tags)
      .filter((tag) => presetTagCandidates.includes(tag))
      .slice(0, MAX_TAGS);
    if (!id || !name || tags.length === 0) {
      return;
    }
    normalized.push({ id, name, tags });
  });
  return normalized;
};

/**
 * タグセット選択欄を再描画する。
 * @param {string} [selectedTagSetId=""] - 選択済みタグセットID。
 */
const renderTagSetSelect = (selectedTagSetId = "") => {
  if (!tagSetSelectEl || !tagSetFieldEl) {
    return;
  }

  tagSetFieldEl.classList.toggle("hidden", presetTagSets.length === 0);
  tagSetSelectEl.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = t("popup.tags.none");
  tagSetSelectEl.appendChild(emptyOption);

  presetTagSets.forEach((tagSet) => {
    const option = document.createElement("option");
    option.value = tagSet.id;
    option.textContent = `${tagSet.name}（${tagSet.tags.map((tag) => `#${tag}`).join(" ")}）`;
    tagSetSelectEl.appendChild(option);
  });

  tagSetSelectEl.value = presetTagSets.some((set) => set.id === selectedTagSetId)
    ? selectedTagSetId
    : "";
};

/**
 * 選択中タグセットのタグをタグ候補チェックボックスへ反映する。
 * @param {string} tagSetId - 適用するタグセットID。
 */
const applyTagSet = (tagSetId) => {
  const tagSet = presetTagSets.find((set) => set.id === tagSetId);
  if (!tagSet) {
    return;
  }
  tagSelectorEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = tagSet.tags.includes(normalizeTag(input.value));
  });
  setStatus(t("popup.tags.setApplied", { name: tagSet.name }), "ok");
};

/**
 * タグ候補チェックボックス群を再描画する。
 * @param {string[]} [selectedTags=[]] - 初期選択タグ。
 */
const renderTagSelector = (selectedTags = []) => {
  const selected = sanitizeTagCandidates(selectedTags).slice(0, MAX_TAGS);
  tagSelectorEl.innerHTML = "";

  if (presetTagCandidates.length === 0) {
    tagSelectorHintEl.classList.remove("hidden");
    return;
  }

  tagSelectorHintEl.classList.add("hidden");
  presetTagCandidates.forEach((tag) => {
    const label = document.createElement("label");
    label.className = "tag-chip";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag;
    input.checked = selected.includes(tag);
    input.addEventListener("change", () => {
      const checkedCount = tagSelectorEl.querySelectorAll(
        'input[type="checkbox"]:checked'
      ).length;
      if (input.checked && checkedCount > MAX_TAGS) {
        input.checked = false;
        setStatus(t("popup.tags.maxSelected", { max: MAX_TAGS }), "error");
        return;
      }
      syncTagSetSelection();
      void savePreferences();
    });

    const text = document.createElement("span");
    text.textContent = tag;

    label.append(input, text);
    tagSelectorEl.append(label);
  });
};

/**
 * 現在チェックされているユーザータグを取得する。
 * @returns {string[]} 選択タグ（最大 MAX_TAGS）。
 */
const getUserTags = () => {
  const tags = [];
  tagSelectorEl.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
    const value = normalizeTag(input.value);
    if (value && !tags.includes(value) && tags.length < MAX_TAGS) {
      tags.push(value);
    }
  });
  return tags;
};

/**
 * 選択中タグと一致するタグセットを選択欄へ反映する（一致しなければ「選択なし」）。
 */
const syncTagSetSelection = () => {
  if (!tagSetSelectEl) {
    return;
  }
  const currentTags = getUserTags();
  const matchesCurrentTags = (set) =>
    set.tags.length === currentTags.length && set.tags.every((tag) => currentTags.includes(tag));
  const current = presetTagSets.find((set) => set.id === tagSetSelectEl.value);
  if (current && matchesCurrentTags(current)) {
    return;
  }
  tagSetSelectEl.value = presetTagSets.find(matchesCurrentTags)?.id ?? "";
};

/**
 * Obsidian連携設定（トグル/単語リスト）を storage から取得する。
 * @returns {Promise<{obsidianLinkify: boolean, obsidianLinkWords: string[]}>} 変換オプション。
 */
const getStoredObsidianSettings = async () => {
  if (!chrome.storage?.local) {
    return { obsidianLinkify: false, obsidianLinkWords: [] };
  }
  const stored = await chrome.storage.local.get(["obsidianLinkify", "presetObsidianLinkWords"]);
  return {
    obsidianLinkify: Boolean(stored.obsidianLinkify),
    obsidianLinkWords: Array.isArray(stored.presetObsidianLinkWords)
      ? stored.presetObsidianLinkWords.map((word) => String(word).trim()).filter(Boolean)
      : [],
  };
};

/**
 * 変換時に content script / ライブラリへ渡すオプションを組み立てる。
 * @returns {Promise<{tags: string[], obsidianLinkify: boolean, obsidianLinkWords: string[]}>}
 */
const getConversionOptions = async () => {
  const obsidianSettings = await getStoredObsidianSettings();
  return {
    tags: getUserTags(),
    ...obsidianSettings,
  };
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
 * @returns {Record<string, object>} 正規化済み設定群。
 */
const sanitizePresetConfigs = (configs) =>
  Object.fromEntries(FOLDER_PRESET_IDS.map((id) => [id, sanitizePresetConfig(configs?.[id])]));

/**
 * UI表示用のプリセット名を返す。
 * 未設定または旧既定名のままなら、現在の表示言語の既定名にする。
 * @param {string} presetId - 対象プリセットID。
 * @param {{name?: string}|undefined} config - プリセット設定。
 * @returns {string} 表示名。
 */
const presetDisplayName = (presetId, config) => {
  const index = FOLDER_PRESET_IDS.indexOf(presetId) + 1;
  const name = String(config?.name ?? "").trim();
  if (!name || name === LEGACY_DEFAULT_PRESET_NAMES[index - 1]) {
    return t("preset.defaultName", { index });
  }
  return name;
};

/**
 * 全フォルダプリセットが未設定か判定する。
 * @param {Record<string, {hasFolder?: boolean}>} [configs=presetConfigs] - 判定対象設定。
 * @returns {boolean} 全未設定なら true。
 */
const areAllFolderPresetsUnset = (configs = presetConfigs) =>
  FOLDER_PRESET_IDS.every((id) => !configs[id]?.hasFolder);

/**
 * 実際に使える（フォルダ設定済みの）プリセットID一覧を返す。
 * @param {Record<string, {hasFolder?: boolean}>} [configs=presetConfigs] - 判定対象設定。
 * @returns {string[]} 利用可能プリセットID。
 */
const getConfiguredPresetIds = (configs = presetConfigs) =>
  FOLDER_PRESET_IDS.filter((id) => configs[id]?.hasFolder);

/**
 * ダウンロード前に選択プリセットが利用可能か検証する。
 * @returns {string} 利用可能なプリセットID。
 * @throws {Error} 未設定時。
 */
const assertDownloadPresetReady = () => {
  const presetId = getSelectedDownloadPreset();
  const config = presetConfigs[presetId];
  if (config?.hasFolder) {
    return presetId;
  }
  throw new Error(t("error.presetFolderRequired"));
};

/**
 * 画像ダウンロード前に画像保存先フォルダが設定済みか検証する。
 * @param {{imageImportMode?: string, imageFolderConfig?: {hasFolder?: boolean}}} imageSettings - 画像設定。
 * @throws {Error} 未設定時。
 */
const assertImageFolderReady = (imageSettings) => {
  if (imageSettings.imageImportMode !== "download") {
    return;
  }
  if (imageSettings.imageFolderConfig?.hasFolder) {
    return;
  }
  throw new Error(t("error.imageFolderRequired"));
};

/** 「プリセット未設定」ヒントの表示状態を更新する。 */
const updateDownloadPresetHint = () => {
  if (!downloadPresetHintEl) {
    return;
  }
  const showHint = areAllFolderPresetsUnset();
  downloadPresetHintEl.classList.toggle("hidden", !showHint);
};

/**
 * ダウンロード先セレクトの選択肢を FOLDER_PRESET_IDS から作り直す。
 * @param {string} [preferredId=downloadPresetEl.value] - 復元したい選択値。
 *   選択肢が無い状態で value を代入しても効かないため、呼び出し側から渡せるようにしている。
 */
const renderPresetOptions = (preferredId = downloadPresetEl.value) => {
  const configuredIds = getConfiguredPresetIds();

  downloadPresetEl.innerHTML = "";
  FOLDER_PRESET_IDS.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    downloadPresetEl.appendChild(option);

    const config = presetConfigs[id];
    const suffix = config?.hasFolder
      ? t("preset.optionSuffixConfigured", {
          label: config.folderLabel || t("preset.folderSelected"),
        })
      : t("preset.optionSuffixUnset");
    option.textContent = `${presetDisplayName(id, config)}${suffix}`;
    option.disabled = !config?.hasFolder;
  });

  // 作り直しで選択が失われるため、可能なら元の選択へ戻す。
  downloadPresetEl.value = FOLDER_PRESET_IDS.includes(preferredId)
    ? preferredId
    : FOLDER_PRESET_IDS[0];
  if (configuredIds.length > 0 && !presetConfigs[downloadPresetEl.value]?.hasFolder) {
    downloadPresetEl.value = configuredIds[0];
  }

  updateDownloadPresetHint();
};

/** popup内の設定値を chrome.storage.local に保存する。 */
const savePreferences = async () => {
  if (!chrome.storage?.local) {
    return;
  }
  try {
    await chrome.storage.local.set({
      sourceMode: getSelectedSourceMode(),
      outputMode: getSelectedOutputMode(),
      articleUrl: articleUrlEl.value.trim(),
      tags: getUserTags(),
      selectedTagSetId: tagSetSelectEl?.value ?? "",
      downloadPreset: FOLDER_PRESET_IDS.includes(downloadPresetEl.value)
        ? downloadPresetEl.value
        : "preset1",
      presetConfigs,
    });
  } catch {
    // 設定保存失敗時も変換は継続
  }
};

/** popup起動時に保存済み設定を読み込み、UIへ反映する。 */
const loadPreferences = async () => {
  // 静的な文言を先に差し替えてから、保存値に依存する描画を行う。
  await NtmI18n.init();
  NtmI18n.applyDom(document);

  let savedDownloadPreset = "";

  if (!chrome.storage?.local) {
    updateUrlFieldVisibility();
    updateTabFieldVisibility();
    updateDownloadLocationVisibility();
    renderPresetOptions();
    if (getSelectedSourceMode() === "tab") {
      void updateCurrentTabArticleTitle();
    }
    return;
  }
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY_NAMES);
    if (stored.sourceMode) {
      setSelectedRadio(sourceModeInputs, stored.sourceMode);
    }
    if (stored.outputMode) {
      setSelectedRadio(outputModeInputs, stored.outputMode);
    }
    if (typeof stored.articleUrl === "string") {
      articleUrlEl.value = stored.articleUrl;
    }
    if (FOLDER_PRESET_IDS.includes(stored.downloadPreset)) {
      savedDownloadPreset = stored.downloadPreset;
    }
    presetConfigs = sanitizePresetConfigs(stored.presetConfigs);
    presetTagCandidates = sanitizeTagCandidates(stored.presetTagCandidates ?? []);
    presetTagSets = sanitizeTagSets(stored.presetTagSets ?? []);
    renderTagSelector(Array.isArray(stored.tags) ? stored.tags : []);
    renderTagSetSelect(typeof stored.selectedTagSetId === "string" ? stored.selectedTagSetId : "");
    syncTagSetSelection();
  } catch {
    presetConfigs = createDefaultPresetConfigs();
    presetTagCandidates = [];
    presetTagSets = [];
    renderTagSelector([]);
    renderTagSetSelect("");
  }
  updateUrlFieldVisibility();
  updateTabFieldVisibility();
  updateDownloadLocationVisibility();
  renderPresetOptions(savedDownloadPreset);
  if (getSelectedSourceMode() === "tab") {
    void updateCurrentTabArticleTitle();
  }
};

/**
 * Markdown文字列をクリップボードへコピーする。
 * Clipboard API失敗時は execCommand にフォールバックする。
 * @param {string} text - コピー対象文字列。
 * @returns {Promise<boolean>} コピー成功時 true。
 */
const copyMarkdown = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const tempTextarea = document.createElement("textarea");
    tempTextarea.value = text;
    tempTextarea.setAttribute("readonly", "");
    tempTextarea.style.position = "fixed";
    tempTextarea.style.left = "-9999px";
    tempTextarea.style.top = "0";
    document.body.appendChild(tempTextarea);
    tempTextarea.focus();
    tempTextarea.select();
    const copied = document.execCommand("copy");
    tempTextarea.remove();
    return copied;
  }
};

/**
 * ダウンロード時に使うプリセットIDを安全に取得する。
 * @returns {string} 利用するプリセットID。
 */
const getSelectedDownloadPreset = () =>
  FOLDER_PRESET_IDS.includes(downloadPresetEl.value) ? downloadPresetEl.value : "preset1";

/**
 * 画像ファイルを note ID フォルダ配下へ保存する。
 * @param {{filename: string, url: string}[]} images - 保存対象画像。
 * @param {string} articleUrl - 元記事URL。
 * @returns {Promise<void>}
 */
const saveImages = async (images, articleUrl) => {
  if (!images.length) {
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "saveImagesForArticle",
    images,
    noteId: noteFolderNameFromUrl(articleUrl),
    articleUrl,
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? t("error.saveImagesFailed"));
  }
};

/**
 * 画像取込方式に応じて Markdown 内の画像を処理する。
 * @param {string} markdown - 変換済みMarkdown。
 * @param {string} articleUrl - 元記事URL。
 * @returns {Promise<string>} 処理後Markdown。
 */
const finalizeMarkdownImages = async (markdown, articleUrl) => {
  const imageSettings = await getStoredImageSettings();
  if (imageSettings.imageImportMode === "url") {
    return markdown;
  }

  const noteFolderName = noteFolderNameFromUrl(articleUrl);
  const processed = await NoteToMarkdown.processMarkdownImages(markdown, {
    imageImportMode: imageSettings.imageImportMode,
    imagePathPrefix: imageSettings.imageImportMode === "download" ? `${noteFolderName}/` : "",
  });

  if (imageSettings.imageImportMode === "download") {
    await saveImages(processed.images, articleUrl);
  }

  return processed.markdown;
};

/**
 * backgroundへ保存要求を送り、結果を受け取る。
 * @param {string} text - 保存するMarkdown本文。
 * @param {string} articleUrl - 元記事URL。
 * @returns {Promise<{ok: boolean, overwritten?: boolean, filename?: string, error?: string}>}
 */
const downloadMarkdown = async (text, articleUrl) => {
  const response = await chrome.runtime.sendMessage({
    type: "downloadMarkdownByPreset",
    markdown: text,
    articleUrl,
    downloadPreset: getSelectedDownloadPreset(),
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? t("error.downloadFailed"));
  }
  return response;
};

/**
 * 出力方法（コピー/ダウンロード）に応じて処理を分岐する。
 * @param {string} title - 記事タイトル。
 * @param {string} markdown - 変換済みMarkdown。
 * @param {string} articleUrl - 元記事URL。
 */
const applyOutputAction = async (title, markdown, articleUrl) => {
  if (getSelectedOutputMode() === "download") {
    const result = await downloadMarkdown(markdown, articleUrl);
    setStatus("");
    if (result.overwritten) {
      showSplash(
        t("popup.splash.overwrittenTitle"),
        t("popup.splash.overwrittenMessage", { filename: result.filename })
      );
      return;
    }
    showSplash(
      t("popup.splash.downloadedTitle"),
      t("popup.splash.downloadedMessage", { filename: result.filename || title })
    );
    return;
  }

  const copied = await copyMarkdown(markdown);
  if (!copied) {
    throw new Error(t("error.copyFailed"));
  }
  setStatus("");
  showSplash(t("popup.splash.copiedTitle"), t("popup.splash.copiedMessage", { title }));
};

/**
 * 現在のタブ上で content script に変換実行を依頼する。
 * @param {chrome.tabs.Tab} tab - 変換対象タブ。
 * @returns {Promise<{title: string, markdown: string, articleUrl: string}>} 変換結果。
 */
const convertCurrentTab = async (tab) => {
  let response;
  try {
    const conversionOptions = await getConversionOptions();
    response = await chrome.tabs.sendMessage(tab.id, {
      type: "convert",
      ...conversionOptions,
    });
  } catch {
    throw new Error(t("error.reloadAndRetry"));
  }

  if (!response?.ok) {
    throw new Error(response?.error ?? t("error.convertFailed"));
  }

  return { title: response.title, markdown: response.markdown, articleUrl: tab.url };
};

/**
 * 指定URLの記事HTMLを取得して Markdown へ変換する。
 * @param {string} url - 変換対象記事URL。
 * @returns {Promise<{title: string, markdown: string, articleUrl: string}>} 変換結果。
 */
const convertFromUrl = async (url) => {
  let response;
  try {
    response = await NoteToMarkdown.fetchWithTimeout(url, { credentials: "omit" });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(t("error.fetchTimeout"));
    }
    throw new Error(t("error.fetchFromUrlFailed"));
  }

  if (!response.ok) {
    throw new Error(t("error.fetchFailedHttp", { status: response.status }));
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const conversionOptions = await getConversionOptions();
  const result = NoteToMarkdown.convertNotePageToMarkdown(doc, url, conversionOptions);
  return { title: result.title, markdown: result.markdown, articleUrl: url };
};

/**
 * 実行時点の変換対象を解決する（URL入力 or アクティブタブ）。
 * @param {"tab"|"url"} sourceMode - 変換元モード。
 * @returns {Promise<{articleUrl: string, tab: chrome.tabs.Tab|null}>} 記事URLと対象タブ。
 */
const resolveConvertTarget = async (sourceMode) => {
  if (sourceMode === "url") {
    const url = articleUrlEl.value.trim();
    if (!url) {
      throw new Error(t("error.urlRequired"));
    }
    if (!isNoteArticleUrl(url)) {
      throw new Error(t("error.invalidArticleUrl"));
    }
    return { articleUrl: url, tab: null };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error(t("error.noActiveTab"));
  }
  if (!isNoteArticleUrl(tab.url)) {
    throw new Error(t("error.notNoteArticlePage"));
  }
  return { articleUrl: tab.url, tab };
};

/** popupのメイン変換処理。 */
const convert = async () => {
  setStatus(t("popup.status.converting"));
  convertBtn.disabled = true;

  try {
    const sourceMode = getSelectedSourceMode();
    const { articleUrl, tab } = await resolveConvertTarget(sourceMode);

    const imageSettings = await getStoredImageSettings();
    if (getSelectedOutputMode() === "download") {
      assertDownloadPresetReady();
    }
    assertImageFolderReady(imageSettings);

    const result = tab ? await convertCurrentTab(tab) : await convertFromUrl(articleUrl);

    result.markdown = await finalizeMarkdownImages(result.markdown, result.articleUrl);
    await applyOutputAction(result.title, result.markdown, result.articleUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("error.convertFailed");
    setStatus(message, "error");
  } finally {
    convertBtn.disabled = false;
  }
};

sourceModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    updateUrlFieldVisibility();
    updateTabFieldVisibility();
    if (getSelectedSourceMode() === "tab") {
      void updateCurrentTabArticleTitle();
    }
    void savePreferences();
  });
  input.addEventListener("click", () => {
    if (input.value === "tab" && input.checked) {
      void updateCurrentTabArticleTitle();
    }
  });
});

outputModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    updateDownloadLocationVisibility();
    void savePreferences();
  });
});

articleUrlEl.addEventListener("change", () => {
  void savePreferences();
});

tagSetSelectEl?.addEventListener("change", () => {
  if (tagSetSelectEl.value) {
    applyTagSet(tagSetSelectEl.value);
  } else {
    tagSelectorEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
    setStatus("");
  }
  void savePreferences();
});

downloadPresetEl.addEventListener("change", () => {
  void savePreferences();
});

settingsBtn.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

/*
 * スキ数の更新はオプション画面で実行する。
 * popup はフォーカスを失うと閉じて実行コンテキストごと消えるため、
 * 数分かかる処理やフォルダ権限の再取得を popup 内で完結させられない。
 * ここでは実行したい意思だけを storage に置き、オプション画面側で受け取る。
 */
likeCountBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      await chrome.storage.local.set({ pendingLikeCountRun: true });
    } catch {
      // 受け渡しに失敗してもオプション画面は開く
    }
    void chrome.runtime.openOptionsPage();
    window.close();
  })();
});

pickUrlBtn.addEventListener("click", () => {
  void startLinkPickMode();
});

pickMultiBtn.addEventListener("click", () => {
  if (getSelectedOutputMode() !== "download") {
    setStatus(t("popup.status.multiDownloadOnly"), "error");
    return;
  }
  void (async () => {
    try {
      assertDownloadPresetReady();
      const imageSettings = await getStoredImageSettings();
      assertImageFolderReady(imageSettings);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("error.presetFolderRequired");
      setStatus(message, "error");
      return;
    }
    void startMultiPickMode();
  })();
});

convertBtn.addEventListener("click", () => {
  void convert();
});

/**
 * content script が選択した記事URLを受け取り、URL欄へ反映する。
 * 変換の実行は content script 側で完結するため、ここでは表示更新のみ行う
 * （ページクリックで popup が閉じた場合はそもそも届かない）。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id || message?.type !== "pickedArticleUrl") {
    return false;
  }
  if (typeof message.url === "string" && isNoteArticleUrl(message.url)) {
    setSelectedRadio(sourceModeInputs, "url");
    updateUrlFieldVisibility();
    updateTabFieldVisibility();
    articleUrlEl.value = message.url;
    setStatus(t("popup.status.pickedUrl"), "ok");
    void savePreferences();
    sendResponse({ ok: true });
    return false;
  }
  setStatus(t("popup.status.pickedUrlFailed"), "error");
  sendResponse({ ok: false });
  return false;
});

void loadPreferences();

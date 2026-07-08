// 拡張機能ポップアップ: 変換元・出力先の選択と変換実行
const FOLDER_PRESET_IDS = ["preset1", "preset2", "preset3"];
const DOWNLOAD_PRESET_IDS = [...FOLDER_PRESET_IDS];
const PRESET_FOLDER_REQUIRED_ERROR =
  "ダウンロードには保存先プリセットのフォルダ設定が必要です。設定（歯車）から「保存先プリセット設定」でフォルダを選択してください。";
const IMAGE_FOLDER_REQUIRED_ERROR =
  "画像ダウンロードには画像保存先フォルダの設定が必要です。オプション画面の「画像取込方式」でフォルダを選択してください。";
const IMAGE_IMPORT_MODES = ["url", "download", "base64"];
const DEFAULT_IMAGE_FOLDER_CONFIG = { folderLabel: "", hasFolder: false };
const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const convertBtn = $("convertBtn");
const settingsBtn = $("settingsBtn");
const urlFieldEl = $("urlField");
const tabFieldEl = $("tabField");
const tabArticleTitleEl = $("tabArticleTitle");
const articleUrlEl = $("articleUrl");
const pickUrlBtn = $("pickUrlBtn");
const pickMultiBtn = $("pickMultiBtn");
const downloadLocationFieldEl = $("downloadLocationField");
const downloadPresetEl = $("downloadPreset");
const downloadPresetHintEl = $("downloadPresetHint");
const tagSelectorEl = $("tagSelector");
const tagSelectorHintEl = $("tagSelectorHint");
const splashEl = $("splash");
const splashMarkEl = $("splashMark");
const splashTitleEl = $("splashTitle");
const splashMessageEl = $("splashMessage");
const sourceModeInputs = document.querySelectorAll('input[name="sourceMode"]');
const outputModeInputs = document.querySelectorAll('input[name="outputMode"]');

const MAX_TAGS = 5;
const PRESET_IDS = [...FOLDER_PRESET_IDS];
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
];
const DEFAULT_PRESET_CONFIGS = {
  preset1: { name: "プリセット1", folderLabel: "", hasFolder: false },
  preset2: { name: "プリセット2", folderLabel: "", hasFolder: false },
  preset3: { name: "プリセット3", folderLabel: "", hasFolder: false },
};

let presetConfigs = { ...DEFAULT_PRESET_CONFIGS };
let presetTagCandidates = [];
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
    throw new Error("アクティブなタブを取得できません。");
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
      throw new Error("note.com ページを開いてから「選択する」を押してください。");
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
      throw new Error(response?.error ?? "リンク選択モードを開始できませんでした。");
    }
    setStatus("ページ上で記事リンクをクリックしてください。選択後に自動実行します。", "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : "リンク選択モードを開始できませんでした。";
    setStatus(message, "error");
  }
};

/** ページ上の複数リンク選択モードを開始する。 */
const startMultiPickMode = async () => {
  try {
    const tab = await getActiveNoteTab();
    if (!tab.url.startsWith("https://note.com/")) {
      throw new Error("note.com ページを開いてから「複数選択」を押してください。");
    }
    const obsidianSettings = await getStoredObsidianSettings();
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "startMultiLinkPickMode",
      downloadPreset: downloadPresetEl.value,
      tags: getUserTags(),
      obsidianLinkify: obsidianSettings.obsidianLinkify,
    });
    if (!response?.ok) {
      throw new Error(response?.error ?? "複数選択モードを開始できませんでした。");
    }
    setStatus("記事リンクを複数クリックしてください。ページ上パネルの実行ボタンで一括ダウンロードします。", "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : "複数選択モードを開始できませんでした。";
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

  tabArticleTitleEl.textContent = "取得中…";
  tabArticleTitleEl.classList.remove("error");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error("アクティブなタブを取得できません。");
    }
    if (!isNoteArticleUrl(tab.url)) {
      throw new Error("note.com の記事ページ（/n/...）で開いてください。");
    }

    let title = "";
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "getArticleTitle" });
      if (response?.ok && response.title) {
        title = response.title;
      } else {
        throw new Error(response?.error ?? "タイトルを取得できませんでした。");
      }
    } catch {
      const fallbackTitle = sanitizeTabTitle(tab.title ?? "");
      if (!fallbackTitle) {
        throw new Error("ページを再読み込みしてから、もう一度お試しください。");
      }
      title = fallbackTitle;
    }

    tabArticleTitleEl.textContent = title;
  } catch (error) {
    const message = error instanceof Error ? error.message : "タイトルを取得できませんでした。";
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

/**
 * note記事URLから note ID フォルダ名を返す。
 * @param {string} articleUrl - 記事URL。
 * @returns {string} フォルダ名。
 */
const noteFolderNameFromUrl = (articleUrl) => {
  const noteId = NoteToMarkdown.extractNoteIdFromUrl(articleUrl);
  if (!noteId) {
    return "note-article";
  }
  return noteId.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "note-article";
};

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
        setStatus(`タグは最大${MAX_TAGS}つまで選択できます。`, "error");
        return;
      }
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
 * @param {string} fallbackName - 表示名既定値。
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
  throw new Error(PRESET_FOLDER_REQUIRED_ERROR);
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
  throw new Error(IMAGE_FOLDER_REQUIRED_ERROR);
};

/** 「プリセット未設定」ヒントの表示状態を更新する。 */
const updateDownloadPresetHint = () => {
  if (!downloadPresetHintEl) {
    return;
  }
  const showHint = areAllFolderPresetsUnset();
  downloadPresetHintEl.classList.toggle("hidden", !showHint);
};

/** ダウンロード先セレクトの表示名/disable状態を更新する。 */
const renderPresetOptions = () => {
  const configuredIds = getConfiguredPresetIds();

  FOLDER_PRESET_IDS.forEach((id, index) => {
    const option = downloadPresetEl.querySelector(`option[value="${id}"]`);
    if (!option) {
      return;
    }
    const config = presetConfigs[id];
    const name = config?.name?.trim() || `プリセット${index + 1}`;
    const suffix = config?.hasFolder ? ` (${config.folderLabel || "選択済み"})` : " (未設定)";
    option.textContent = `${name}${suffix}`;
    option.disabled = !config?.hasFolder;
  });

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
      downloadPreset: DOWNLOAD_PRESET_IDS.includes(downloadPresetEl.value)
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
    if (Array.isArray(stored.tags)) {
      renderTagSelector(stored.tags);
    }
    if (
      typeof stored.downloadPreset === "string" &&
      DOWNLOAD_PRESET_IDS.includes(stored.downloadPreset)
    ) {
      downloadPresetEl.value = stored.downloadPreset;
    }
    presetConfigs = sanitizePresetConfigs(stored.presetConfigs ?? DEFAULT_PRESET_CONFIGS);
    presetTagCandidates = sanitizeTagCandidates(stored.presetTagCandidates ?? []);
    if (!Array.isArray(stored.tags)) {
      renderTagSelector([]);
    } else {
      renderTagSelector(stored.tags);
    }
  } catch {
    presetConfigs = { ...DEFAULT_PRESET_CONFIGS };
    presetTagCandidates = [];
    renderTagSelector([]);
  }
  updateUrlFieldVisibility();
  updateTabFieldVisibility();
  updateDownloadLocationVisibility();
  renderPresetOptions();
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
  DOWNLOAD_PRESET_IDS.includes(downloadPresetEl.value) ? downloadPresetEl.value : "preset1";

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
    throw new Error(response?.error ?? "画像の保存に失敗しました。");
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
    throw new Error(response?.error ?? "ダウンロードに失敗しました。");
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
      showSplash("上書き保存しました", `更新しました: ${result.filename}`);
      return;
    }
    showSplash("ダウンロード完了", `保存しました: ${result.filename || title}`);
    return;
  }

  const copied = await copyMarkdown(markdown);
  if (!copied) {
    throw new Error("クリップボードへのコピーに失敗しました。");
  }
  setStatus("");
  showSplash("コピー完了", `コピーしました: ${title}`);
};

/**
 * 現在のタブ上で content script に変換実行を依頼する。
 * @returns {Promise<{title: string, markdown: string, articleUrl: string}>} 変換結果。
 */
const convertCurrentTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("アクティブなタブを取得できません。");
  }

  let response;
  try {
    const conversionOptions = await getConversionOptions();
    response = await chrome.tabs.sendMessage(tab.id, {
      type: "convert",
      ...conversionOptions,
    });
  } catch {
    throw new Error("ページを再読み込みしてから、もう一度お試しください。");
  }

  if (!response?.ok) {
    throw new Error(response?.error ?? "変換に失敗しました。");
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
      throw new Error("記事の取得がタイムアウトしました。");
    }
    throw new Error("URL から記事を取得できませんでした。");
  }

  if (!response.ok) {
    throw new Error(`記事の取得に失敗しました（HTTP ${response.status}）。`);
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const conversionOptions = await getConversionOptions();
  const result = NoteToMarkdown.convertNotePageToMarkdown(doc, url, conversionOptions);
  return { title: result.title, markdown: result.markdown, articleUrl: url };
};

/**
 * 実行時点の変換対象URLを解決する（URL入力 or アクティブタブ）。
 * @param {"tab"|"url"} sourceMode - 変換元モード。
 * @returns {Promise<string>} 記事URL。
 */
const resolveArticleUrlForConvert = async (sourceMode) => {
  if (sourceMode === "url") {
    const url = articleUrlEl.value.trim();
    if (!url) {
      throw new Error("記事 URL を入力してください。");
    }
    if (!isNoteArticleUrl(url)) {
      throw new Error("note.com の記事 URL（/n/...）を入力してください。");
    }
    return url;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("アクティブなタブを取得できません。");
  }
  if (!isNoteArticleUrl(tab.url)) {
    throw new Error("note.com の記事ページ（/n/...）で開いてください。");
  }
  return tab.url;
};

/** popupのメイン変換処理。 */
const convert = async () => {
  setStatus("変換中…");
  convertBtn.disabled = true;

  try {
    const sourceMode = getSelectedSourceMode();
    const articleUrl = await resolveArticleUrlForConvert(sourceMode);

    const imageSettings = await getStoredImageSettings();
    if (getSelectedOutputMode() === "download") {
      assertDownloadPresetReady();
    }
    assertImageFolderReady(imageSettings);

    let result;
    if (sourceMode === "url") {
      result = await convertFromUrl(articleUrl);
    } else {
      result = await convertCurrentTab();
    }

    result.markdown = await finalizeMarkdownImages(result.markdown, result.articleUrl);
    await applyOutputAction(result.title, result.markdown, result.articleUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "変換に失敗しました。";
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

downloadPresetEl.addEventListener("change", () => {
  void savePreferences();
});

settingsBtn.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

pickUrlBtn.addEventListener("click", () => {
  void startLinkPickMode();
});

pickMultiBtn.addEventListener("click", () => {
  if (getSelectedOutputMode() !== "download") {
    setStatus("一括はダウンロードのみ対応です。変換後をダウンロードにしてください。", "error");
    return;
  }
  void (async () => {
    try {
      assertDownloadPresetReady();
      const imageSettings = await getStoredImageSettings();
      assertImageFolderReady(imageSettings);
    } catch (error) {
      const message = error instanceof Error ? error.message : PRESET_FOLDER_REQUIRED_ERROR;
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
 * content script から返る選択URL通知を受け取り、即時実行フローへつなぐ。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "pickedArticleUrl") {
    return false;
  }
  if (typeof message.url === "string" && isNoteArticleUrl(message.url)) {
    setSelectedRadio(sourceModeInputs, "url");
    updateUrlFieldVisibility();
    updateTabFieldVisibility();
    articleUrlEl.value = message.url;
    setStatus("記事URLを取得しました。処理を実行中…", "ok");
    void savePreferences();
    void (async () => {
      try {
        const tab = await getActiveNoteTab();
        const setResponse = await chrome.tabs.sendMessage(tab.id, {
          type: "setPickedArticleUrl",
          url: message.url,
        });
        if (!setResponse?.ok) {
          throw new Error(setResponse?.error ?? "選択URLの保存に失敗しました。");
        }

        const runResponse = await chrome.tabs.sendMessage(tab.id, {
          type: "runPickedArticleAction",
        });
        if (!runResponse?.ok) {
          throw new Error(runResponse?.error ?? "処理に失敗しました。");
        }

        setStatus("");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "処理に失敗しました。";
        setStatus(errorMessage, "error");
      }
    })();
    sendResponse({ ok: true });
    return false;
  }
  setStatus("記事URLの取得に失敗しました。", "error");
  sendResponse({ ok: false });
  return false;
});

void loadPreferences();

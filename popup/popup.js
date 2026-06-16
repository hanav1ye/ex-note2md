// 拡張機能ポップアップ: 変換元・出力先の選択と変換実行
const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const convertBtn = $("convertBtn");
const openOptionsBtn = $("openOptionsBtn");
const urlFieldEl = $("urlField");
const articleUrlEl = $("articleUrl");
const pickUrlBtn = $("pickUrlBtn");
const pickMultiBtn = $("pickMultiBtn");
const downloadLocationFieldEl = $("downloadLocationField");
const downloadPresetEl = $("downloadPreset");
const tagSelectorEl = $("tagSelector");
const tagSelectorHintEl = $("tagSelectorHint");
const splashEl = $("splash");
const splashMarkEl = $("splashMark");
const splashTitleEl = $("splashTitle");
const splashMessageEl = $("splashMessage");
const sourceModeInputs = document.querySelectorAll('input[name="sourceMode"]');
const outputModeInputs = document.querySelectorAll('input[name="outputMode"]');

const MAX_TAGS = 5;
const PRESET_IDS = ["preset1", "preset2", "preset3"];
const STORAGE_KEY_NAMES = [
  "sourceMode",
  "outputMode",
  "articleUrl",
  "tags",
  "downloadPreset",
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

const setStatus = (message, kind = "") => {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
};

const getActiveNoteTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("アクティブなタブを取得できません。");
  }
  return tab;
};

const startLinkPickMode = async () => {
  try {
    const tab = await getActiveNoteTab();
    if (!tab.url.startsWith("https://note.com/")) {
      throw new Error("note.com ページを開いてから「選択する」を押してください。");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "startLinkPickMode",
      outputMode: getSelectedOutputMode(),
      downloadPreset: downloadPresetEl.value,
      tags: getUserTags(),
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

const startMultiPickMode = async () => {
  try {
    const tab = await getActiveNoteTab();
    if (!tab.url.startsWith("https://note.com/")) {
      throw new Error("note.com ページを開いてから「複数選択」を押してください。");
    }
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "startMultiLinkPickMode",
      downloadPreset: downloadPresetEl.value,
      tags: getUserTags(),
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

const getSelectedSourceMode = () =>
  document.querySelector('input[name="sourceMode"]:checked')?.value ?? "tab";

const getSelectedOutputMode = () =>
  document.querySelector('input[name="outputMode"]:checked')?.value ?? "copy";

const setSelectedRadio = (inputs, value) => {
  inputs.forEach((input) => {
    input.checked = input.value === value;
  });
};

const updateUrlFieldVisibility = () => {
  urlFieldEl.classList.toggle("hidden", getSelectedSourceMode() !== "url");
};

const updateDownloadLocationVisibility = () => {
  downloadLocationFieldEl.classList.toggle("hidden", getSelectedOutputMode() !== "download");
};

const normalizeTag = (tag) => String(tag).replace(/^#/, "").trim();

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

const renderPresetOptions = () => {
  PRESET_IDS.forEach((id, index) => {
    const option = downloadPresetEl.querySelector(`option[value="${id}"]`);
    if (!option) {
      return;
    }
    const config = presetConfigs[id];
    const name = config?.name?.trim() || `プリセット${index + 1}`;
    const suffix = config?.hasFolder ? ` (${config.folderLabel || "選択済み"})` : " (未設定)";
    option.textContent = `${name}${suffix}`;
  });
};

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
      downloadPreset: PRESET_IDS.includes(downloadPresetEl.value) ? downloadPresetEl.value : "preset1",
      presetConfigs,
    });
  } catch {
    // 設定保存失敗時も変換は継続
  }
};

const loadPreferences = async () => {
  if (!chrome.storage?.local) {
    updateUrlFieldVisibility();
    updateDownloadLocationVisibility();
    renderPresetOptions();
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
    if (typeof stored.downloadPreset === "string" && PRESET_IDS.includes(stored.downloadPreset)) {
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
  updateDownloadLocationVisibility();
  renderPresetOptions();
};

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

const getSelectedDownloadPreset = () =>
  PRESET_IDS.includes(downloadPresetEl.value) ? downloadPresetEl.value : "preset1";

const checkNoteFileExists = async (articleUrl) => {
  const response = await chrome.runtime.sendMessage({
    type: "checkNoteFileExists",
    articleUrl,
    downloadPreset: getSelectedDownloadPreset(),
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? "ファイル確認に失敗しました。");
  }
  return response;
};

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

const applyOutputAction = async (title, markdown, articleUrl) => {
  if (getSelectedOutputMode() === "download") {
    const result = await downloadMarkdown(markdown, articleUrl);
    setStatus("");
    if (result.skipped) {
      showSplash("スキップしました", `既に保存済みです: ${result.filename}`, "skip");
      return;
    }
    showSplash("ダウンロード完了", `保存しました: ${title}`);
    return;
  }

  const copied = await copyMarkdown(markdown);
  if (!copied) {
    throw new Error("クリップボードへのコピーに失敗しました。");
  }
  setStatus("");
  showSplash("コピー完了", `コピーしました: ${title}`);
};

const convertCurrentTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("アクティブなタブを取得できません。");
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, {
      type: "convert",
      tags: getUserTags(),
    });
  } catch {
    throw new Error("ページを再読み込みしてから、もう一度お試しください。");
  }

  if (!response?.ok) {
    throw new Error(response?.error ?? "変換に失敗しました。");
  }

  return { title: response.title, markdown: response.markdown, articleUrl: tab.url };
};

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
  const result = NoteToMarkdown.convertNotePageToMarkdown(doc, url, {
    tags: getUserTags(),
  });
  return { title: result.title, markdown: result.markdown, articleUrl: url };
};

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

const convert = async () => {
  setStatus("変換中…");
  convertBtn.disabled = true;

  try {
    const sourceMode = getSelectedSourceMode();
    const articleUrl = await resolveArticleUrlForConvert(sourceMode);

    if (getSelectedOutputMode() === "download") {
      const existsResult = await checkNoteFileExists(articleUrl);
      if (existsResult.exists) {
        setStatus("");
        showSplash("スキップしました", `既に保存済みです: ${existsResult.filename}`, "skip");
        return;
      }
    }

    let result;
    if (sourceMode === "url") {
      result = await convertFromUrl(articleUrl);
    } else {
      result = await convertCurrentTab();
    }

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
    void savePreferences();
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

openOptionsBtn.addEventListener("click", () => {
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
  void startMultiPickMode();
});

convertBtn.addEventListener("click", () => {
  void convert();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "pickedArticleUrl") {
    return false;
  }
  if (typeof message.url === "string" && isNoteArticleUrl(message.url)) {
    setSelectedRadio(sourceModeInputs, "url");
    updateUrlFieldVisibility();
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

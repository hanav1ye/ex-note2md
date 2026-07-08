// note.com 上で動作: 記事変換・リンク選択・複数一括ダウンロード
let pickModeActive = false;
let hoverTarget = null;
let previousCursor = "";
let pickedArticleUrl = "";
let pickContext = {
  outputMode: "copy",
  downloadPreset: "preset1",
  tags: [],
  obsidianLinkify: false,
};
let multiPickModeActive = false;
let multiPickedArticles = [];
let multiPanelEl = null;
let multiRunning = false;
let multiProgressCurrent = 0;
let multiProgressTotal = 0;
let pageToastTimer = null;
const PAGE_TOAST_ID = "ntm-page-toast";

/**
 * URLがnote記事形式か判定する。
 * @param {string} url - 判定対象URL。
 * @returns {boolean} 記事URLであれば true。
 */
const isNoteArticleUrl = (url) => NoteToMarkdown.isNoteArticleUrl(url, location.origin);

/** ホバー枠線を消去する。 */
const clearHover = () => {
  if (!hoverTarget) {
    return;
  }
  hoverTarget.style.outline = "";
  hoverTarget = null;
};

/**
 * ページ上部にトーストを表示する。
 * @param {string} message - 表示文言。
 * @param {"ok"|"skip"|"error"} [kind="ok"] - 表示種別。
 */
const showPageToast = (message, kind = "ok") => {
  let toast = document.getElementById(PAGE_TOAST_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = PAGE_TOAST_ID;
    document.documentElement.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.top = "16px";
  toast.style.zIndex = "2147483647";
  toast.style.maxWidth = "min(420px, 85vw)";
  toast.style.padding = "10px 12px";
  toast.style.borderRadius = "10px";
  if (kind === "skip") {
    toast.style.border = "1px solid #e8d080";
    toast.style.background = "linear-gradient(135deg, #fffbea, #fffdf5)";
    toast.style.color = "#7a5c14";
  } else if (kind === "error") {
    toast.style.border = "1px solid #e3a7b1";
    toast.style.background = "linear-gradient(135deg, #fff0f3, #fff9fa)";
    toast.style.color = "#8e3c4d";
  } else {
    toast.style.border = "1px solid #9dd8c2";
    toast.style.background = "linear-gradient(135deg, #ecfaf4, #f8fffc)";
    toast.style.color = "#1f5a47";
  }
  toast.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  toast.style.fontSize = "13px";
  toast.style.fontWeight = "600";
  toast.style.boxShadow = "0 8px 20px rgba(60, 84, 92, 0.2)";
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";
  toast.style.transition = "opacity 0.2s ease, transform 0.2s ease";

  if (pageToastTimer) {
    clearTimeout(pageToastTimer);
  }
  pageToastTimer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(-8px)";
    setTimeout(() => toast.remove(), 220);
  }, 2600);
};

/**
 * ホバー対象リンクを切り替える。
 * @param {HTMLAnchorElement|null} anchor - 新しいホバー対象。
 */
const setHover = (anchor) => {
  if (hoverTarget === anchor) {
    return;
  }
  clearHover();
  hoverTarget = anchor;
  if (hoverTarget) {
    hoverTarget.style.outline = "2px solid #d996ae";
  }
};

/**
 * マウスイベントから note記事リンク要素を解決する。
 * @param {MouseEvent} event - 対象イベント。
 * @returns {HTMLAnchorElement|null} 記事リンクアンカー。
 */
const resolveAnchorFromEvent = (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const anchor = target.closest("a[href]");
  if (!anchor) {
    return null;
  }
  const href = anchor.getAttribute("href") ?? "";
  if (!isNoteArticleUrl(href)) {
    return null;
  }
  return anchor;
};

/**
 * リンク要素から表示用タイトルを抽出する。
 * @param {HTMLAnchorElement} anchor - 対象リンク。
 * @returns {string} タイトル文字列。
 */
const getAnchorTitle = (anchor) =>
  (anchor.getAttribute("aria-label") ?? anchor.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim() || "（タイトル不明）";

/**
 * 一覧自動選択から除外するタイトルか判定する。
 * @param {string} title - 記事タイトル。
 * @returns {boolean} 除外対象なら true。
 */
const isExcludedListTitle = (title) => title === "プロフィール" || title === "仕事依頼";

/**
 * note一覧の描画ルート要素を探索する。
 * @returns {Element|null} 一覧ルート要素。
 */
const getArticleListRoot = () =>
  Array.from(document.querySelectorAll("div")).find(
    (el) =>
      el.classList.contains("mx-auto") &&
      el.classList.contains("w-full") &&
      el.classList.contains("max-w-[var(--size-content)]")
  ) ?? null;

/**
 * 一覧ルート配下から描画済みの記事リンク候補を収集する。
 * @returns {{anchor: HTMLAnchorElement, url: string, title: string, top: number, left: number}[]} 候補一覧。
 */
const getRenderedArticleCandidates = () => {
  const listRoot = getArticleListRoot();
  if (!listRoot) {
    return [];
  }

  const articleAnchors = Array.from(listRoot.querySelectorAll("a[href]")).filter((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (!isNoteArticleUrl(href)) {
      return false;
    }
    const title = getAnchorTitle(anchor);
    if (isExcludedListTitle(title)) {
      return false;
    }
    const rect = anchor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  return articleAnchors
    .map((anchor) => ({
      anchor,
      url: new URL(anchor.getAttribute("href"), location.origin).toString(),
      title: getAnchorTitle(anchor),
      top: anchor.getBoundingClientRect().top,
      left: anchor.getBoundingClientRect().left,
    }))
    .sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));
};

/** 一覧内の候補記事を選択リストへ一括追加する。 */
const addVisibleArticlesToSelection = () => {
  const candidates = getRenderedArticleCandidates();
  if (candidates.length === 0) {
    showPageToast("一覧内に選択可能な記事リンクが見つかりません。", "error");
    return;
  }

  let addedCount = 0;
  candidates.forEach((candidate) => {
    if (!multiPickedArticles.some((item) => item.url === candidate.url)) {
      multiPickedArticles.push({ url: candidate.url, title: candidate.title });
      addedCount += 1;
    }
  });

  if (addedCount === 0) {
    showPageToast("一覧の記事はすでに選択済みです。", "skip");
    return;
  }

  renderMultiPanel();
  showPageToast(`一覧から ${addedCount}件 追加しました。`, "ok");
};

/** 複数選択パネルをDOMから削除する。 */
const removeMultiPanel = () => {
  multiPanelEl?.remove();
  multiPanelEl = null;
};

/** 複数選択パネルを現在stateで描画/更新する。 */
const renderMultiPanel = () => {
  if (!multiPickModeActive) {
    removeMultiPanel();
    return;
  }

  if (!multiPanelEl) {
    multiPanelEl = document.createElement("div");
    multiPanelEl.id = "ntm-multi-pick-panel";
    multiPanelEl.style.position = "fixed";
    multiPanelEl.style.right = "16px";
    multiPanelEl.style.bottom = "16px";
    multiPanelEl.style.zIndex = "2147483647";
    multiPanelEl.style.display = "flex";
    multiPanelEl.style.gap = "8px";
    multiPanelEl.style.alignItems = "center";
    multiPanelEl.style.padding = "10px 12px";
    multiPanelEl.style.borderRadius = "10px";
    multiPanelEl.style.background = "linear-gradient(135deg, #fff5f8, #ffffff)";
    multiPanelEl.style.border = "1px solid #efc7d7";
    multiPanelEl.style.boxShadow = "0 8px 22px rgba(103, 73, 85, 0.2)";
    multiPanelEl.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";

    const count = document.createElement("span");
    count.id = "ntm-multi-count";
    count.style.fontSize = "12px";
    count.style.fontWeight = "700";
    count.style.color = "#744257";
    multiPanelEl.appendChild(count);

    const progress = document.createElement("span");
    progress.id = "ntm-multi-progress";
    progress.style.fontSize = "11px";
    progress.style.fontWeight = "600";
    progress.style.color = "#8c4f68";
    multiPanelEl.appendChild(progress);

    const list = document.createElement("div");
    list.id = "ntm-multi-list";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "3px";
    list.style.maxHeight = "140px";
    list.style.overflow = "auto";
    list.style.minWidth = "220px";
    list.style.fontSize = "11px";
    list.style.color = "#744257";
    multiPanelEl.appendChild(list);

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.textContent = "実行";
    runBtn.style.border = "none";
    runBtn.style.padding = "6px 10px";
    runBtn.style.borderRadius = "8px";
    runBtn.style.fontSize = "12px";
    runBtn.style.fontWeight = "700";
    runBtn.style.color = "#ffffff";
    runBtn.style.background = "linear-gradient(135deg, #7eb8d4, #d996ae)";
    runBtn.style.cursor = "pointer";
    runBtn.addEventListener("click", () => {
      void executeMultiPickNow();
    });
    runBtn.id = "ntm-multi-run";
    multiPanelEl.appendChild(runBtn);

    const selectVisibleBtn = document.createElement("button");
    selectVisibleBtn.type = "button";
    selectVisibleBtn.textContent = "一覧を全選択";
    selectVisibleBtn.style.border = "1px solid #e2cad4";
    selectVisibleBtn.style.padding = "6px 10px";
    selectVisibleBtn.style.borderRadius = "8px";
    selectVisibleBtn.style.fontSize = "12px";
    selectVisibleBtn.style.fontWeight = "600";
    selectVisibleBtn.style.background = "#fff";
    selectVisibleBtn.style.color = "#744257";
    selectVisibleBtn.style.cursor = "pointer";
    selectVisibleBtn.addEventListener("click", () => {
      addVisibleArticlesToSelection();
    });
    selectVisibleBtn.id = "ntm-multi-select-visible";
    multiPanelEl.appendChild(selectVisibleBtn);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "解除";
    clearBtn.style.border = "1px solid #e2cad4";
    clearBtn.style.padding = "6px 10px";
    clearBtn.style.borderRadius = "8px";
    clearBtn.style.fontSize = "12px";
    clearBtn.style.fontWeight = "600";
    clearBtn.style.background = "#fff";
    clearBtn.style.color = "#744257";
    clearBtn.style.cursor = "pointer";
    clearBtn.addEventListener("click", () => {
      multiPickedArticles = [];
      renderMultiPanel();
      showPageToast("選択を解除しました。", "ok");
    });
    multiPanelEl.appendChild(clearBtn);

    const exitBtn = document.createElement("button");
    exitBtn.type = "button";
    exitBtn.textContent = "終了";
    exitBtn.style.border = "1px solid #e2cad4";
    exitBtn.style.padding = "6px 10px";
    exitBtn.style.borderRadius = "8px";
    exitBtn.style.fontSize = "12px";
    exitBtn.style.fontWeight = "600";
    exitBtn.style.background = "#fff";
    exitBtn.style.color = "#744257";
    exitBtn.style.cursor = "pointer";
    exitBtn.addEventListener("click", () => {
      endMultiPickMode();
      showPageToast("複数選択モードを終了しました。", "ok");
    });
    multiPanelEl.appendChild(exitBtn);

    document.documentElement.appendChild(multiPanelEl);
  }

  const countEl = multiPanelEl.querySelector("#ntm-multi-count");
  if (countEl) {
    countEl.textContent = `選択中: ${multiPickedArticles.length}件`;
  }

  const progressEl = multiPanelEl.querySelector("#ntm-multi-progress");
  if (progressEl) {
    progressEl.textContent =
      multiRunning && multiProgressTotal > 0
        ? `${multiProgressCurrent}/${multiProgressTotal} 件変換中...`
        : "";
  }

  const runBtn = multiPanelEl.querySelector("#ntm-multi-run");
  if (runBtn) {
    runBtn.disabled = multiRunning || multiPickedArticles.length === 0;
    runBtn.textContent = multiRunning ? "実行中..." : "実行";
  }

  const selectVisibleBtn = multiPanelEl.querySelector("#ntm-multi-select-visible");
  if (selectVisibleBtn) {
    selectVisibleBtn.disabled = multiRunning;
  }

  const listEl = multiPanelEl.querySelector("#ntm-multi-list");
  if (listEl) {
    listEl.innerHTML = "";
    multiPickedArticles.forEach((article, index) => {
      const item = document.createElement("div");
      item.textContent = `${index + 1}. ${article.title}`;
      listEl.appendChild(item);
    });
  }
};

/** 単一選択モードを終了し、イベント/表示を後片付けする。 */
const endPickMode = () => {
  if (!pickModeActive) {
    return;
  }
  pickModeActive = false;
  clearHover();
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handlePickClick, true);
  document.body.style.cursor = previousCursor;
};

/** 複数選択モードを終了し、イベント/表示を後片付けする。 */
const endMultiPickMode = () => {
  if (!multiPickModeActive) {
    return;
  }
  multiPickModeActive = false;
  clearHover();
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handleMultiPickClick, true);
  document.body.style.cursor = previousCursor;
  removeMultiPanel();
};

/**
 * リンク選択モード中のマウス移動ハンドラ。
 * @param {MouseEvent} event - マウスイベント。
 */
const handlePickMouseMove = (event) => {
  if (!pickModeActive) {
    return;
  }
  const anchor = resolveAnchorFromEvent(event);
  setHover(anchor);
};

/**
 * 単一選択モード中のクリックハンドラ。
 * @param {MouseEvent} event - クリックイベント。
 */
const handlePickClick = (event) => {
  if (!pickModeActive) {
    return;
  }
  const anchor = resolveAnchorFromEvent(event);
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (!anchor) {
    return;
  }

  const url = new URL(anchor.getAttribute("href"), location.origin).toString();
  pickedArticleUrl = url;
  endPickMode();
  void chrome.runtime.sendMessage({
    type: "pickedArticleUrl",
    url,
  });
};

/**
 * 複数選択モード中のクリックハンドラ。
 * @param {MouseEvent} event - クリックイベント。
 */
const handleMultiPickClick = (event) => {
  if (!multiPickModeActive) {
    return;
  }
  const rawTarget = event.target;
  if (rawTarget instanceof Element && rawTarget.closest("#ntm-multi-pick-panel")) {
    // パネル内ボタンのクリックは通常どおり動かす
    return;
  }

  const anchor = resolveAnchorFromEvent(event);
  if (!anchor) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const url = new URL(anchor.getAttribute("href"), location.origin).toString();
  const index = multiPickedArticles.findIndex((item) => item.url === url);
  if (index === -1) {
    multiPickedArticles.push({
      url,
      title: getAnchorTitle(anchor),
    });
    showPageToast(`追加しました: ${multiPickedArticles.length}件`, "ok");
  } else {
    multiPickedArticles = multiPickedArticles.filter((item) => item.url !== url);
    showPageToast(`解除しました: ${multiPickedArticles.length}件`, "ok");
  }
  renderMultiPanel();
};

/** 単一リンク選択モードを開始する。 */
const startPickMode = () => {
  if (pickModeActive) {
    return;
  }
  pickModeActive = true;
  previousCursor = document.body.style.cursor;
  document.body.style.cursor = "crosshair";
  document.addEventListener("mousemove", handlePickMouseMove, true);
  document.addEventListener("click", handlePickClick, true);
};

/** 複数リンク選択モードを開始する。 */
const startMultiPickMode = () => {
  if (multiPickModeActive) {
    return;
  }
  endPickMode();
  multiPickModeActive = true;
  multiPickedArticles = [];
  previousCursor = document.body.style.cursor;
  document.body.style.cursor = "crosshair";
  document.addEventListener("mousemove", handlePickMouseMove, true);
  document.addEventListener("click", handleMultiPickClick, true);
  renderMultiPanel();
  showPageToast("複数選択モード開始。記事リンクをクリックしてください。", "ok");
};

/**
 * タグ値を正規化する（先頭#除去）。
 * @param {string} tag - 入力タグ。
 * @returns {string} 正規化タグ。
 */
const normalizeTag = (tag) => String(tag).replace(/^#/, "").trim();

/**
 * ユーザータグ配列を正規化し、重複・上限を調整する。
 * @param {unknown[]} tags - 入力タグ配列。
 * @param {number} [maxTags=5] - 最大件数。
 * @returns {string[]} 正規化タグ配列。
 */
const normalizeUserTags = (tags, maxTags = 5) => {
  const normalized = [];
  (Array.isArray(tags) ? tags : []).forEach((tag) => {
    const value = normalizeTag(tag);
    if (value && !normalized.includes(value) && normalized.length < maxTags) {
      normalized.push(value);
    }
  });
  return normalized;
};

const IMAGE_IMPORT_MODES = ["url", "download", "base64"];

/**
 * 画像取込方式を正規化する。
 * @param {unknown} mode - 入力値。
 * @returns {"url"|"download"|"base64"} 正規化後の方式。
 */
const normalizeImageImportMode = (mode) =>
  IMAGE_IMPORT_MODES.includes(mode) ? mode : "url";

/**
 * オプション画面で設定された画像取込方式を storage から取得する。
 * @returns {Promise<{imageImportMode: "url"|"download"|"base64", imageFolderConfig: {folderLabel: string, hasFolder: boolean}}>}
 */
const getStoredImageImportSettings = async () => {
  const stored = await chrome.storage.local.get(["imageImportMode", "imageFolderConfig"]);
  return {
    imageImportMode: normalizeImageImportMode(stored.imageImportMode),
    imageFolderConfig: {
      folderLabel: String(stored.imageFolderConfig?.folderLabel ?? "").trim(),
      hasFolder: Boolean(stored.imageFolderConfig?.hasFolder),
    },
  };
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
  const imageSettings = await getStoredImageImportSettings();

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
 * Markdown文字列をクリップボードへコピーする。
 * @param {string} text - コピー対象文字列。
 * @returns {Promise<boolean>} 成功時 true。
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
 * 変換時に使うオプションを構築する。
 * @returns {Promise<{tags: string[], obsidianLinkify: boolean, obsidianLinkWords: string[]}>} 変換オプション。
 */
const getConversionOptions = async () => {
  const stored = await chrome.storage.local.get(["presetObsidianLinkWords"]);
  return {
    tags: normalizeUserTags(pickContext.tags),
    obsidianLinkify: Boolean(pickContext.obsidianLinkify),
    obsidianLinkWords: Array.isArray(stored.presetObsidianLinkWords)
      ? stored.presetObsidianLinkWords.map((word) => String(word).trim()).filter(Boolean)
      : [],
  };
};

/**
 * 単一記事の取得・変換・出力（コピー/ダウンロード）を実行する。
 * @param {string} url - 対象記事URL。
 * @param {{suppressToast?: boolean}} [options={}] - 表示制御オプション。
 * @returns {Promise<{mode: string, title: string, message: string, overwritten?: boolean}>} 実行結果。
 */
const convertPickedArticle = async (url, options = {}) => {
  if (!url) {
    throw new Error("記事URLが選択されていません。");
  }

  let response;
  try {
    response = await NoteToMarkdown.fetchWithTimeout(url, { credentials: "omit" });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("記事の取得がタイムアウトしました。");
    }
    throw new Error("記事の取得に失敗しました。");
  }
  if (!response.ok) {
    throw new Error(`記事の取得に失敗しました（HTTP ${response.status}）。`);
  }
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const conversionOptions = await getConversionOptions();
  const result = NoteToMarkdown.convertNotePageToMarkdown(doc, url, conversionOptions);
  result.markdown = await finalizeMarkdownImages(result.markdown, url);

  if (pickContext.outputMode === "download") {
    const downloadResponse = await chrome.runtime.sendMessage({
      type: "downloadMarkdownByPreset",
      markdown: result.markdown,
      articleUrl: url,
      downloadPreset: pickContext.downloadPreset,
    });
    if (!downloadResponse?.ok) {
      throw new Error(downloadResponse?.error ?? "ダウンロードに失敗しました。");
    }
    if (downloadResponse.overwritten) {
      if (!options.suppressToast) {
        showPageToast(`上書き保存: ${downloadResponse.filename}`, "ok");
      }
      return {
        mode: "download",
        overwritten: true,
        title: downloadResponse.filename,
        message: `上書き保存しました: ${downloadResponse.filename}`,
      };
    }
    if (!options.suppressToast) {
      showPageToast(`ダウンロード完了: ${result.title}`, "ok");
    }
    return {
      mode: "download",
      overwritten: false,
      title: result.title,
      message: `保存しました: ${result.title}`,
    };
  }

  const copied = await copyMarkdown(result.markdown);
  if (!copied) {
    throw new Error("クリップボードへのコピーに失敗しました。");
  }
  if (!options.suppressToast) {
    showPageToast(`コピー完了: ${result.title}`, "ok");
  }
  return {
    mode: "copy",
    title: result.title,
    message: `コピーしました: ${result.title}`,
  };
};

/**
 * 複数選択記事を順次処理して集計結果を返す。
 * @returns {Promise<{ok: true, mode: string, successCount: number, overwrittenCount: number, failedCount: number, title: string}>}
 */
const runMultiPickedArticleAction = async () => {
  if (!Array.isArray(multiPickedArticles) || multiPickedArticles.length === 0) {
    throw new Error("記事URLが選択されていません。");
  }

  let successCount = 0;
  let overwrittenCount = 0;
  let failedCount = 0;
  let lastTitle = "";
  multiRunning = true;
  multiProgressCurrent = 0;
  multiProgressTotal = multiPickedArticles.length;
  renderMultiPanel();

  for (let i = 0; i < multiPickedArticles.length; i += 1) {
    const currentArticle = multiPickedArticles[i];
    const currentUrl = currentArticle.url;
    multiProgressCurrent = i + 1;
    renderMultiPanel();
    try {
      const result = await convertPickedArticle(currentUrl, { suppressToast: true });
      lastTitle = result.title;
      if (result.overwritten) {
        overwrittenCount += 1;
        showPageToast(
          `上書き保存 (${i + 1}/${multiPickedArticles.length}): ${result.title}`,
          "ok"
        );
      } else {
        successCount += 1;
        showPageToast(`保存完了 (${i + 1}/${multiPickedArticles.length}): ${result.title}`, "ok");
      }
      if (i < multiPickedArticles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    } catch (error) {
      failedCount += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[note→Markdown] 変換失敗: ${currentUrl}`, reason);
    }
  }

  if (successCount === 0 && overwrittenCount === 0) {
    throw new Error("すべての処理に失敗しました。");
  }

  const mode = "download";
  const summary = `一括完了: 新規保存 ${successCount}件 / 上書き ${overwrittenCount}件 / 失敗 ${failedCount}件`;
  const summaryKind = failedCount > 0 ? "error" : "ok";
  showPageToast(summary, summaryKind);
  multiRunning = false;
  renderMultiPanel();

  return {
    ok: true,
    mode,
    successCount,
    overwrittenCount,
    failedCount,
    title: lastTitle,
  };
};

/** 複数選択パネルの「実行」押下時に多重実行を抑制して起動する。 */
const executeMultiPickNow = async () => {
  if (multiRunning) {
    return;
  }
  try {
    await runMultiPickedArticleAction();
    endMultiPickMode();
  } catch (error) {
    multiRunning = false;
    renderMultiPanel();
    const errorMessage = error instanceof Error ? error.message : "処理に失敗しました。";
    showPageToast(`処理失敗: ${errorMessage}`, "error");
  }
};

/** popup/background からのメッセージを受け取り、モード制御や変換処理を実行する。 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "startLinkPickMode") {
    pickContext = {
      outputMode: message.outputMode === "download" ? "download" : "copy",
      downloadPreset: String(message.downloadPreset ?? "preset1"),
      tags: normalizeUserTags(message.tags),
      obsidianLinkify: Boolean(message.obsidianLinkify),
    };
    startPickMode();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "startMultiLinkPickMode") {
    pickContext = {
      outputMode: "download",
      downloadPreset: String(message.downloadPreset ?? "preset1"),
      tags: normalizeUserTags(message.tags),
      obsidianLinkify: Boolean(message.obsidianLinkify),
    };
    startMultiPickMode();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "runPickedArticleAction") {
    void (async () => {
      try {
        const result = await convertPickedArticle(pickedArticleUrl);
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "処理に失敗しました。";
        showPageToast(`処理失敗: ${errorMessage}`, "error");
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  if (message?.type === "runMultiPickedArticleAction") {
    void (async () => {
      try {
        const result = await runMultiPickedArticleAction();
        sendResponse(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "処理に失敗しました。";
        showPageToast(`処理失敗: ${errorMessage}`, "error");
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }

  if (message?.type === "setPickedArticleUrl") {
    const url = String(message.url ?? "");
    if (!isNoteArticleUrl(url)) {
      sendResponse({ ok: false, error: "有効な記事URLではありません。" });
      return false;
    }
    pickedArticleUrl = url;
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "getArticleTitle") {
    if (!isNoteArticleUrl(location.href)) {
      sendResponse({ ok: false, error: "note.com の記事ページ（/n/...）で開いてください。" });
      return false;
    }
    try {
      const title = NoteToMarkdown.extractTitleFromDocument(document);
      sendResponse({ ok: true, title });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "タイトルを取得できませんでした。";
      sendResponse({ ok: false, error: errorMessage });
    }
    return false;
  }

  if (message?.type !== "convert") {
    return false;
  }

  void (async () => {
    try {
      const stored = await chrome.storage.local.get(["presetObsidianLinkWords"]);
      const result = NoteToMarkdown.convertNotePageToMarkdown(document, location.href, {
        tags: message.tags,
        obsidianLinkify: Boolean(message.obsidianLinkify),
        obsidianLinkWords: Array.isArray(stored.presetObsidianLinkWords)
          ? stored.presetObsidianLinkWords.map((word) => String(word).trim()).filter(Boolean)
          : [],
      });
      sendResponse({ ok: true, title: result.title, markdown: result.markdown });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "変換に失敗しました。";
      sendResponse({ ok: false, error: errorMessage });
    }
  })();

  return true;
});

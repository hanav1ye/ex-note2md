let pickModeActive = false;
let hoverTarget = null;
let previousCursor = "";
let pickedArticleUrl = "";
let pickContext = { outputMode: "copy", downloadPreset: "preset1", tags: [] };
let multiPickModeActive = false;
let multiPickedArticles = [];
let multiPanelEl = null;
let multiRunning = false;
let multiProgressCurrent = 0;
let multiProgressTotal = 0;
let pageToastTimer = null;
const PAGE_TOAST_ID = "ntm-page-toast";

const isNoteArticleUrl = (url) => NoteToMarkdown.isNoteArticleUrl(url, location.origin);

const clearHover = () => {
  if (!hoverTarget) {
    return;
  }
  hoverTarget.style.outline = "";
  hoverTarget = null;
};

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

const getAnchorTitle = (anchor) =>
  (anchor.getAttribute("aria-label") ?? anchor.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim() || "（タイトル不明）";

const removeMultiPanel = () => {
  multiPanelEl?.remove();
  multiPanelEl = null;
};

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

const handlePickMouseMove = (event) => {
  if (!pickModeActive) {
    return;
  }
  const anchor = resolveAnchorFromEvent(event);
  setHover(anchor);
};

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

const normalizeTag = (tag) => String(tag).replace(/^#/, "").trim();

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

const checkNoteFileExists = async (url) => {
  const response = await chrome.runtime.sendMessage({
    type: "checkNoteFileExists",
    articleUrl: url,
    downloadPreset: pickContext.downloadPreset,
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? "ファイル確認に失敗しました。");
  }
  return response;
};

const convertPickedArticle = async (url, options = {}) => {
  if (!url) {
    throw new Error("記事URLが選択されていません。");
  }

  if (pickContext.outputMode === "download") {
    const existsResult = await checkNoteFileExists(url);
    if (existsResult.exists) {
      if (!options.suppressToast) {
        showPageToast(`スキップ: 既に保存済みです (${existsResult.filename})`, "skip");
      }
      return {
        mode: "download",
        skipped: true,
        title: existsResult.filename,
        message: `既に保存済みです: ${existsResult.filename}`,
      };
    }
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
  const result = NoteToMarkdown.convertNotePageToMarkdown(doc, url, {
    tags: normalizeUserTags(pickContext.tags),
  });

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
    if (downloadResponse.skipped) {
      if (!options.suppressToast) {
        showPageToast(`スキップ: 既に保存済みです (${downloadResponse.filename})`, "skip");
      }
      return {
        mode: "download",
        skipped: true,
        title: downloadResponse.filename,
        message: `既に保存済みです: ${downloadResponse.filename}`,
      };
    }
    if (!options.suppressToast) {
      showPageToast(`ダウンロード完了: ${result.title}`, "ok");
    }
    return {
      mode: "download",
      skipped: false,
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

const runMultiPickedArticleAction = async () => {
  if (!Array.isArray(multiPickedArticles) || multiPickedArticles.length === 0) {
    throw new Error("記事URLが選択されていません。");
  }

  let successCount = 0;
  let skippedCount = 0;
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
      if (result.skipped) {
        skippedCount += 1;
        showPageToast(
          `スキップ (${i + 1}/${multiPickedArticles.length}): ${result.title}`,
          "skip"
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

  if (successCount === 0 && skippedCount === 0) {
    throw new Error("すべての処理に失敗しました。");
  }

  const mode = "download";
  const summary = `一括完了: 保存 ${successCount}件 / スキップ ${skippedCount}件 / 失敗 ${failedCount}件`;
  const summaryKind =
    failedCount > 0 ? "error" : skippedCount > 0 ? "skip" : "ok";
  showPageToast(summary, summaryKind);
  multiRunning = false;
  renderMultiPanel();

  return {
    ok: true,
    mode,
    successCount,
    skippedCount,
    failedCount,
    title: lastTitle,
  };
};

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "startLinkPickMode") {
    pickContext = {
      outputMode: message.outputMode === "download" ? "download" : "copy",
      downloadPreset: String(message.downloadPreset ?? "preset1"),
      tags: normalizeUserTags(message.tags),
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

  if (message?.type !== "convert") {
    return false;
  }

  try {
    const result = NoteToMarkdown.convertNotePageToMarkdown(document, location.href, {
      tags: message.tags,
    });
    sendResponse({ ok: true, title: result.title, markdown: result.markdown });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "変換に失敗しました。";
    sendResponse({ ok: false, error: errorMessage });
  }

  return true;
});

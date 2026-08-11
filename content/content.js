// note.com 上で動作: 記事変換・リンク選択・複数一括ダウンロード

const t = (key, params) => NtmI18n.t(key, params);

// ページ表示直後にトーストを出す経路はないが、選択モード開始前に解決させておく。
void NtmI18n.init();

/**
 * 選択モードは常にこの3値のいずれか。単体選択と複数選択は排他で、
 * 切り替えは必ず setPickMode() を通す（直前のモードを終了してから次へ入る）。
 */
const PICK_MODE = { none: "none", single: "single", multi: "multi" };
let pickMode = PICK_MODE.none;

let hoverTarget = null;
let previousCursor = "";
let pickContext = {
  outputMode: "copy",
  downloadPreset: "preset1",
  tags: [],
  obsidianLinkify: false,
};
let multiPickedArticles = [];
let multiPanelEl = null;
let multiRunning = false;
let multiCancelRequested = false;
let multiProgressCurrent = 0;
let multiProgressTotal = 0;
let pageToastTimer = null;
let uiHostEl = null;
let uiShadowRoot = null;

const UI_HOST_ID = "ntm-ui-root";

// note.com 側の CSS の影響を受けないよう、UI は Shadow DOM 内に閉じる。
const UI_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

  .toast {
    position: fixed;
    left: 50%;
    top: 16px;
    transform: translateX(-50%) translateY(0);
    max-width: min(420px, 85vw);
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #9dd8c2;
    background: linear-gradient(135deg, #ecfaf4, #f8fffc);
    color: #1f5a47;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 8px 20px rgba(60, 84, 92, 0.2);
    opacity: 1;
    transition: opacity 0.2s ease, transform 0.2s ease;
    pointer-events: auto;
  }
  .toast.skip { border-color: #e8d080; background: linear-gradient(135deg, #fffbea, #fffdf5); color: #7a5c14; }
  .toast.error { border-color: #e3a7b1; background: linear-gradient(135deg, #fff0f3, #fff9fa); color: #8e3c4d; }
  .toast.is-hidden { opacity: 0; transform: translateX(-50%) translateY(-8px); }

  .panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 10px;
    background: linear-gradient(135deg, #fff5f8, #ffffff);
    border: 1px solid #efc7d7;
    box-shadow: 0 8px 22px rgba(103, 73, 85, 0.2);
    pointer-events: auto;
  }
  .panel-count { font-size: 12px; font-weight: 700; color: #744257; }
  .panel-progress { font-size: 11px; font-weight: 600; color: #8c4f68; }
  .panel-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 140px;
    overflow: auto;
    min-width: 220px;
    font-size: 11px;
    color: #744257;
  }
  .panel button {
    border: 1px solid #e2cad4;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    background: #fff;
    color: #744257;
    cursor: pointer;
    font-family: inherit;
  }
  .panel button.primary { border: none; font-weight: 700; color: #fff; background: linear-gradient(135deg, #7eb8d4, #d996ae); }
  .panel button.danger { border-color: #e3a7b1; color: #8e3c4d; }
  .panel button:disabled { opacity: 0.5; cursor: default; }
  .panel-hint { font-size: 10px; color: #a08292; }
`;

/**
 * ページ内UI用の Shadow Root を取得する（未生成なら作成する）。
 * @returns {ShadowRoot} UIのルート。
 */
const getUiRoot = () => {
  if (!uiHostEl?.isConnected) {
    uiHostEl = document.createElement("div");
    uiHostEl.id = UI_HOST_ID;
    // ページの操作を妨げないよう、ホスト自体はクリックを透過させる。
    uiHostEl.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;border:0;margin:0;padding:0;";
    uiShadowRoot = uiHostEl.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = UI_STYLES;
    uiShadowRoot.appendChild(style);
    document.documentElement.appendChild(uiHostEl);
  }
  return uiShadowRoot;
};

/**
 * イベントが拡張のページ内UI由来か判定する。
 * Shadow DOM 内のクリックは event.target がホスト要素へ再ターゲットされる。
 * @param {EventTarget|null} target - イベントターゲット。
 * @returns {boolean} UI由来なら true。
 */
const isExtensionUiTarget = (target) =>
  Boolean(uiHostEl && target instanceof Node && (target === uiHostEl || uiHostEl.contains(target)));

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
  const root = getUiRoot();
  let toast = root.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    root.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast${kind === "ok" ? "" : ` ${kind}`}`;

  if (pageToastTimer) {
    clearTimeout(pageToastTimer);
  }
  pageToastTimer = setTimeout(() => {
    toast.classList.add("is-hidden");
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
    .trim() || t("content.untitled");

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
    showPageToast(t("content.toast.noListArticles"), "error");
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
    showPageToast(t("content.toast.listAlreadySelected"), "skip");
    return;
  }

  renderMultiPanel();
  showPageToast(t("content.toast.addedFromList", { count: addedCount }), "ok");
};

/** 複数選択パネルをDOMから削除する。 */
const removeMultiPanel = () => {
  multiPanelEl?.remove();
  multiPanelEl = null;
};

/** 複数選択パネルを現在stateで描画/更新する。 */
const renderMultiPanel = () => {
  if (pickMode !== PICK_MODE.multi) {
    removeMultiPanel();
    return;
  }

  if (!multiPanelEl) {
    const root = getUiRoot();
    multiPanelEl = document.createElement("div");
    multiPanelEl.className = "panel";

    const count = document.createElement("span");
    count.className = "panel-count";
    multiPanelEl.appendChild(count);

    const progress = document.createElement("span");
    progress.className = "panel-progress";
    multiPanelEl.appendChild(progress);

    const list = document.createElement("div");
    list.className = "panel-list";
    multiPanelEl.appendChild(list);

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "primary";
    runBtn.dataset.role = "run";
    runBtn.addEventListener("click", () => {
      // 実行中は同じボタンが「中止」として働く
      if (multiRunning) {
        multiCancelRequested = true;
        renderMultiPanel();
        return;
      }
      void executeMultiPickNow();
    });
    multiPanelEl.appendChild(runBtn);

    const selectVisibleBtn = document.createElement("button");
    selectVisibleBtn.type = "button";
    selectVisibleBtn.dataset.role = "select-visible";
    selectVisibleBtn.textContent = t("content.panel.selectVisible");
    selectVisibleBtn.addEventListener("click", () => {
      addVisibleArticlesToSelection();
    });
    multiPanelEl.appendChild(selectVisibleBtn);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.dataset.role = "clear";
    clearBtn.textContent = t("content.panel.clear");
    clearBtn.addEventListener("click", () => {
      multiPickedArticles = [];
      renderMultiPanel();
      showPageToast(t("content.toast.selectionCleared"), "ok");
    });
    multiPanelEl.appendChild(clearBtn);

    const exitBtn = document.createElement("button");
    exitBtn.type = "button";
    exitBtn.dataset.role = "exit";
    exitBtn.textContent = t("content.panel.exit");
    exitBtn.addEventListener("click", () => {
      endMultiPickMode();
      showPageToast(t("content.toast.multiPickExited"), "ok");
    });
    multiPanelEl.appendChild(exitBtn);

    const hint = document.createElement("span");
    hint.className = "panel-hint";
    hint.textContent = t("content.panel.escHint");
    multiPanelEl.appendChild(hint);

    root.appendChild(multiPanelEl);
  }

  const countEl = multiPanelEl.querySelector(".panel-count");
  if (countEl) {
    countEl.textContent = t("content.panel.count", { count: multiPickedArticles.length });
  }

  const progressEl = multiPanelEl.querySelector(".panel-progress");
  if (progressEl) {
    progressEl.textContent =
      multiRunning && multiProgressTotal > 0
        ? t("content.panel.progress", {
            current: multiProgressCurrent,
            total: multiProgressTotal,
          })
        : "";
  }

  const runBtn = multiPanelEl.querySelector('[data-role="run"]');
  if (runBtn) {
    runBtn.disabled = multiRunning ? multiCancelRequested : multiPickedArticles.length === 0;
    runBtn.classList.toggle("primary", !multiRunning);
    runBtn.classList.toggle("danger", multiRunning);
    if (multiRunning) {
      runBtn.textContent = multiCancelRequested
        ? t("content.panel.cancelling")
        : t("content.panel.cancel");
    } else {
      runBtn.textContent = t("content.panel.run");
    }
  }

  const selectVisibleBtn = multiPanelEl.querySelector('[data-role="select-visible"]');
  if (selectVisibleBtn) {
    selectVisibleBtn.disabled = multiRunning;
  }

  multiPanelEl.querySelectorAll('[data-role="clear"], [data-role="exit"]').forEach((button) => {
    button.disabled = multiRunning;
  });

  const listEl = multiPanelEl.querySelector(".panel-list");
  if (listEl) {
    listEl.innerHTML = "";
    multiPickedArticles.forEach((article, index) => {
      const item = document.createElement("div");
      item.textContent = `${index + 1}. ${article.title}`;
      listEl.appendChild(item);
    });
  }
};

/**
 * 現在のモードを完全に終了し、リスナー・カーソル・表示・選択状態を元に戻す。
 * どのモードから呼ばれても後片付けの内容は同じにして、状態の取りこぼしを防ぐ。
 */
const teardownPickMode = () => {
  if (pickMode === PICK_MODE.none) {
    return;
  }

  // 登録されていないリスナーの解除は無害なので、両モード分をまとめて外す
  document.removeEventListener("mousemove", handlePickMouseMove, true);
  document.removeEventListener("click", handlePickClick, true);
  document.removeEventListener("click", handleMultiPickClick, true);
  document.removeEventListener("keydown", handlePickKeydown, true);

  clearHover();
  document.body.style.cursor = previousCursor;
  previousCursor = "";

  pickMode = PICK_MODE.none;

  // 複数選択の状態はモードを抜けた時点で破棄する
  multiPickedArticles = [];
  multiCancelRequested = false;
  multiProgressCurrent = 0;
  multiProgressTotal = 0;
  removeMultiPanel();
};

/**
 * 選択モードを切り替える。
 * 直前のモードを必ず終了させてから次のモードへ入るため、
 * 単体選択と複数選択が同時に有効になることはない。
 * @param {"none"|"single"|"multi"} nextMode - 切り替え先のモード。
 * @returns {boolean} 切り替えた場合 true。
 */
const setPickMode = (nextMode) => {
  if (pickMode === nextMode) {
    return false;
  }

  teardownPickMode();

  if (nextMode === PICK_MODE.none) {
    return true;
  }

  previousCursor = document.body.style.cursor;
  document.body.style.cursor = "crosshair";
  document.addEventListener("mousemove", handlePickMouseMove, true);
  document.addEventListener(
    "click",
    nextMode === PICK_MODE.multi ? handleMultiPickClick : handlePickClick,
    true
  );
  document.addEventListener("keydown", handlePickKeydown, true);
  pickMode = nextMode;
  return true;
};

/** 選択モード（単体・複数どちらも）を終了する。 */
const endPickMode = () => {
  setPickMode(PICK_MODE.none);
};

/** 複数選択モードを終了する（endPickMode と同じ後片付けを行う）。 */
const endMultiPickMode = () => {
  setPickMode(PICK_MODE.none);
};

/**
 * 選択モード中の Esc キーを処理する。
 * 一括実行中は中止要求、それ以外は選択モードの終了に割り当てる。
 * @param {KeyboardEvent} event - キーイベント。
 */
const handlePickKeydown = (event) => {
  if (event.key !== "Escape" || pickMode === PICK_MODE.none) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  if (multiRunning) {
    if (!multiCancelRequested) {
      multiCancelRequested = true;
      renderMultiPanel();
      showPageToast(t("content.toast.cancelRequested"), "skip");
    }
    return;
  }

  const wasMulti = pickMode === PICK_MODE.multi;
  endPickMode();
  showPageToast(
    wasMulti ? t("content.toast.multiPickExited") : t("content.toast.singlePickExited"),
    "ok"
  );
};

/**
 * リンク選択モード中のマウス移動ハンドラ。
 * @param {MouseEvent} event - マウスイベント。
 */
const handlePickMouseMove = (event) => {
  if (pickMode === PICK_MODE.none) {
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
  if (pickMode !== PICK_MODE.single) {
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
  endPickMode();

  // popup はページクリックで閉じるため、実行はこちらで完結させる。
  // popup が開いたままの場合の URL 欄反映は補助的な通知に留める（受信者不在は無視）。
  chrome.runtime.sendMessage({ type: "pickedArticleUrl", url }).catch(() => {});

  showPageToast(t("content.toast.processing"), "ok");
  void (async () => {
    try {
      await convertPickedArticle(url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t("error.processFailed");
      showPageToast(t("content.toast.processFailed", { message: errorMessage }), "error");
    }
  })();
};

/**
 * 複数選択モード中のクリックハンドラ。
 * @param {MouseEvent} event - クリックイベント。
 */
const handleMultiPickClick = (event) => {
  if (pickMode !== PICK_MODE.multi) {
    return;
  }
  if (isExtensionUiTarget(event.target)) {
    // パネル内ボタンのクリックは通常どおり動かす
    // （Shadow DOM 内のクリックは event.target がホスト要素へ再ターゲットされる）
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
    showPageToast(t("content.toast.added", { count: multiPickedArticles.length }), "ok");
  } else {
    multiPickedArticles = multiPickedArticles.filter((item) => item.url !== url);
    showPageToast(t("content.toast.removed", { count: multiPickedArticles.length }), "ok");
  }
  renderMultiPanel();
};

/**
 * 単一リンク選択モードを開始する。
 * 複数選択モード中に呼ばれた場合は、そちらを終了してから切り替える。
 */
const startPickMode = () => {
  const switchedFromMulti = pickMode === PICK_MODE.multi;
  if (!setPickMode(PICK_MODE.single)) {
    return;
  }
  showPageToast(
    switchedFromMulti
      ? t("content.toast.singlePickStartFromMulti")
      : t("content.toast.singlePickStart"),
    "ok"
  );
};

/**
 * 複数リンク選択モードを開始する。
 * 単体選択モード中に呼ばれた場合は、そちらを終了してから切り替える。
 */
const startMultiPickMode = () => {
  if (!setPickMode(PICK_MODE.multi)) {
    return;
  }
  renderMultiPanel();
  showPageToast(t("content.toast.multiPickStart"), "ok");
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

const noteFolderNameFromUrl = (articleUrl) => NoteToMarkdown.noteFolderNameFromUrl(articleUrl);

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
    throw new Error(t("error.noArticleSelected"));
  }

  let response;
  try {
    response = await NoteToMarkdown.fetchWithTimeout(url, { credentials: "omit" });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(t("error.fetchTimeout"));
    }
    throw new Error(t("error.fetchArticleFailed"));
  }
  if (!response.ok) {
    throw new Error(t("error.fetchFailedHttp", { status: response.status }));
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
      throw new Error(downloadResponse?.error ?? t("error.downloadFailed"));
    }
    if (downloadResponse.overwritten) {
      if (!options.suppressToast) {
        showPageToast(t("content.toast.overwritten", { filename: downloadResponse.filename }), "ok");
      }
      return {
        mode: "download",
        overwritten: true,
        title: downloadResponse.filename,
        message: t("content.result.overwritten", { filename: downloadResponse.filename }),
      };
    }
    if (!options.suppressToast) {
      showPageToast(t("content.toast.downloaded", { title: result.title }), "ok");
    }
    return {
      mode: "download",
      overwritten: false,
      title: result.title,
      message: t("content.result.saved", { title: result.title }),
    };
  }

  const copied = await copyMarkdown(result.markdown);
  if (!copied) {
    throw new Error(t("error.copyFailed"));
  }
  if (!options.suppressToast) {
    showPageToast(t("content.toast.copied", { title: result.title }), "ok");
  }
  return {
    mode: "copy",
    title: result.title,
    message: t("content.result.copied", { title: result.title }),
  };
};

/**
 * 複数選択記事を順次処理して集計結果を返す。
 * @returns {Promise<{ok: true, mode: string, successCount: number, overwrittenCount: number, failedCount: number, title: string}>}
 */
const runMultiPickedArticleAction = async () => {
  if (!Array.isArray(multiPickedArticles) || multiPickedArticles.length === 0) {
    throw new Error(t("error.noArticleSelected"));
  }

  let successCount = 0;
  let overwrittenCount = 0;
  let failedCount = 0;
  let lastTitle = "";
  const targets = [...multiPickedArticles];
  const processedUrls = new Set();
  multiRunning = true;
  multiCancelRequested = false;
  multiProgressCurrent = 0;
  multiProgressTotal = targets.length;
  renderMultiPanel();

  for (let i = 0; i < targets.length; i += 1) {
    if (multiCancelRequested) {
      break;
    }
    const currentUrl = targets[i].url;
    multiProgressCurrent = i + 1;
    renderMultiPanel();
    try {
      const result = await convertPickedArticle(currentUrl, { suppressToast: true });
      lastTitle = result.title;
      if (result.overwritten) {
        overwrittenCount += 1;
        showPageToast(
          t("content.toast.overwrittenProgress", {
            current: i + 1,
            total: targets.length,
            title: result.title,
          }),
          "ok"
        );
      } else {
        successCount += 1;
        showPageToast(
          t("content.toast.savedProgress", {
            current: i + 1,
            total: targets.length,
            title: result.title,
          }),
          "ok"
        );
      }
    } catch (error) {
      failedCount += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[note→Markdown] ${t("content.log.convertFailed")}: ${currentUrl}`, reason);
    }
    processedUrls.add(currentUrl);

    if (!multiCancelRequested && i < targets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }

  const cancelled = multiCancelRequested;
  multiRunning = false;
  multiCancelRequested = false;
  // 中止した場合は未処理分だけを残し、そのまま再実行できるようにする。
  multiPickedArticles = cancelled
    ? multiPickedArticles.filter((article) => !processedUrls.has(article.url))
    : multiPickedArticles;
  renderMultiPanel();

  if (!cancelled && successCount === 0 && overwrittenCount === 0) {
    throw new Error(t("error.allFailed"));
  }

  const summary =
    t("content.summary.counts", {
      state: cancelled ? t("content.summary.cancelled") : t("content.summary.done"),
      saved: successCount,
      overwritten: overwrittenCount,
      failed: failedCount,
    }) +
    (cancelled ? t("content.summary.remaining", { count: multiPickedArticles.length }) : "");
  showPageToast(summary, failedCount > 0 ? "error" : cancelled ? "skip" : "ok");

  return {
    ok: true,
    mode: "download",
    cancelled,
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
    const result = await runMultiPickedArticleAction();
    // 中止時は残りを再実行できるようパネルを残す。
    if (!result.cancelled) {
      endMultiPickMode();
    }
  } catch (error) {
    multiRunning = false;
    multiCancelRequested = false;
    renderMultiPanel();
    const errorMessage = error instanceof Error ? error.message : t("error.processFailed");
    showPageToast(t("content.toast.processFailed", { message: errorMessage }), "error");
  }
};

/** popup/background からのメッセージを受け取り、モード制御や変換処理を実行する。 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 自拡張（popup / background）以外からのメッセージは処理しない。
  if (sender?.id !== chrome.runtime.id) {
    return false;
  }

  if (message?.type === "startLinkPickMode" || message?.type === "startMultiLinkPickMode") {
    void (async () => {
      // ページを開いたまま表示言語を変えられるので、モード開始のたびに読み直す。
      await NtmI18n.reload();

      // 一括処理の実行中にモードを切り替えると処理途中の状態が失われるため受け付けない。
      if (multiRunning) {
        sendResponse({ ok: false, error: t("content.error.multiRunning") });
        return;
      }

      const isMulti = message.type === "startMultiLinkPickMode";
      pickContext = {
        outputMode: isMulti || message.outputMode === "download" ? "download" : "copy",
        downloadPreset: String(message.downloadPreset ?? "preset1"),
        tags: normalizeUserTags(message.tags),
        obsidianLinkify: Boolean(message.obsidianLinkify),
      };

      if (isMulti) {
        startMultiPickMode();
      } else {
        startPickMode();
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "getArticleTitle") {
    if (!isNoteArticleUrl(location.href)) {
      sendResponse({ ok: false, error: t("error.notNoteArticlePage") });
      return false;
    }
    try {
      const title = NoteToMarkdown.extractTitleFromDocument(document);
      sendResponse({ ok: true, title });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t("error.titleUnavailable");
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
      const errorMessage = error instanceof Error ? error.message : t("error.convertFailed");
      sendResponse({ ok: false, error: errorMessage });
    }
  })();

  return true;
});

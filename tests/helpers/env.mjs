/**
 * テスト用の共通ヘルパー。
 * 拡張のスクリプトは MV3 の実行環境（chrome API / DOM）を前提にしているため、
 * jsdom 上に最小限の環境を組み立てて評価する。
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURE_DIR = join(ROOT, "tests", "fixtures");

export const ARTICLE_URL = "https://note.com/hanaviye/n/nabc123";

/**
 * 検査対象。NTM_TARGET=dist を指定すると、ソースではなく
 * ビルド済み（minify 済み）の dist/ を読み込んで同じテストを実行する。
 * 実際に読み込む拡張機能は dist なので、提出前にはこちらでも検証する。
 */
export const TARGET = process.env.NTM_TARGET === "dist" ? "dist" : "";
export const TARGET_DIR = TARGET ? join(ROOT, TARGET) : ROOT;

/**
 * 検査対象のファイルを読み込む。
 * @param {...string} segments - 対象ルートからの相対パス。
 * @returns {string} ファイル内容。
 */
export const readSource = (...segments) => readFileSync(join(TARGET_DIR, ...segments), "utf8");

/**
 * 変換ライブラリを読み込んだウィンドウを作る。
 * @param {{html?: string, url?: string}} [options={}] - 初期HTMLとURL。
 * @returns {import("jsdom").DOMWindow} ライブラリ読み込み済みのウィンドウ。
 */
export const createLibWindow = ({ html = "<!doctype html><html><body></body></html>", url } = {}) => {
  const dom = new JSDOM(html, { runScripts: "outside-only", ...(url ? { url } : {}) });
  dom.window.eval(readSource("lib", "noteToMarkdown.js"));
  return dom.window;
};

/**
 * 記事HTMLを変換して Markdown を返す。
 * @param {string} html - 記事HTML。
 * @param {{viaDomParser?: boolean, options?: object, url?: string}} [params={}] - 変換条件。
 * @returns {{markdown: string, title: string, metadata: object, hostNodeCreations: number}} 変換結果。
 */
export const convertArticle = (html, { viaDomParser = true, options = {}, url = ARTICLE_URL } = {}) => {
  const win = createLibWindow();
  const doc = viaDomParser
    ? new win.DOMParser().parseFromString(html, "text/html")
    : new JSDOM(html).window.document;

  // 外部HTMLが拡張ページ側の Document で組み立てられていないかを計測する
  let hostNodeCreations = 0;
  const createElement = win.document.createElement.bind(win.document);
  const createTextNode = win.document.createTextNode.bind(win.document);
  win.document.createElement = (...args) => {
    hostNodeCreations += 1;
    return createElement(...args);
  };
  win.document.createTextNode = (...args) => {
    hostNodeCreations += 1;
    return createTextNode(...args);
  };

  const result = win.NoteToMarkdown.convertNotePageToMarkdown(doc, url, {
    convertedAt: "2026-01-01T00:00:00.000+09:00",
    ...options,
  });
  return { ...result, hostNodeCreations };
};

/**
 * 記事本文HTMLを最小の記事ページHTMLで包む。
 * @param {string} bodyHtml - 記事本文HTML。
 * @param {{title?: string, author?: string, datetime?: string, likeCount?: string}} [meta={}] - メタ情報。
 * @returns {string} 記事ページHTML。
 */
export const wrapArticle = (bodyHtml, meta = {}) => {
  const { title = "テスト記事", author = "/hanaviye", datetime = "2026-06-06T18:34:43.000+09:00", likeCount = "17" } = meta;
  const attr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><head>
<meta property="og:title" content="${attr(`${title}｜花冷`)}">
<meta property="og:url" content="${ARTICLE_URL}">
</head><body><article>
  <div class="o-noteContentHeader__creatorInfo"><a href="${author}">花冷</a></div>
  <div class="o-noteContentHeader__date"><time datetime="${datetime}">6月6日</time></div>
  <div class="o-noteLikeV3__count">${likeCount}</div>
  <h1>${title}</h1>
  <div data-name="body" class="note-common-styles__textnote-body">${bodyHtml}</div>
</article></body></html>`;
};

/**
 * note.com が表示時に行う DOM 変更を再現する。
 * 具体的には alt="画像" の付与と、画像をライトボックス用リンクで包む処理。
 * @param {string} html - 配信HTML。
 * @returns {string} 表示済みDOM相当のHTML。
 */
export const simulateRenderedDom = (html) => {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  document.querySelectorAll("img").forEach((img) => {
    if (!(img.getAttribute("alt") ?? "").trim()) {
      img.setAttribute("alt", "画像");
    }
    img.setAttribute("data-modal", "true");
    const src = img.getAttribute("src") ?? "";
    if (src && img.parentElement?.tagName !== "A") {
      const anchor = document.createElement("a");
      anchor.setAttribute("href", src.split("?")[0]);
      img.replaceWith(anchor);
      anchor.appendChild(img);
    }
  });
  document.querySelectorAll("h2, h3").forEach((heading) => heading.setAttribute("tabindex", "-1"));
  return dom.serialize();
};

/**
 * chrome.storage.local と chrome.runtime を最小限に模したスタブを作る。
 * @param {object} [initialStore={}] - 初期ストア内容。
 * @param {{uiLanguage?: string}} [options={}] - ブラウザ側の設定。
 * @returns {{chrome: object, store: object, messages: object[]}} スタブ一式。
 */
export const createChromeStub = (initialStore = {}, { uiLanguage = "ja" } = {}) => {
  const store = structuredClone(initialStore);
  const messages = [];
  const chrome = {
    i18n: {
      getUILanguage: () => uiLanguage,
    },
    runtime: {
      id: "test-extension-id",
      lastError: undefined,
      openOptionsPage: () => {},
      sendMessage: async (message) => {
        messages.push(message);
        return { ok: true };
      },
      onMessage: {
        addListener: (listener) => {
          chrome.runtime.__listener = listener;
        },
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          const result = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
            if (key in store) {
              result[key] = structuredClone(store[key]);
            }
          });
          return result;
        },
        set: async (values) => {
          Object.assign(store, structuredClone(values));
        },
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: ARTICLE_URL, title: "テスト記事｜花冷" }],
      sendMessage: async () => ({ ok: true, title: "テスト記事" }),
    },
  };
  return { chrome, store, messages };
};

/** 非同期処理の完了を待つ。 */
export const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

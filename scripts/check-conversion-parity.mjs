/**
 * タブ変換（note.com の表示済みDOM）と URL 変換（配信HTML）で
 * 生成される Markdown が一致することを検証する。
 *
 * note.com は表示時のスクリプトで alt="画像" の付与や画像のライトボックス用
 * <a> ラップを行うため、同じ記事でも2つの経路で DOM が異なる。
 * 変換結果はどちらの経路でも同一である必要がある。
 *
 * 実行: npm run check:parity
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const LIB_SRC = readFileSync("lib/noteToMarkdown.js", "utf8");
const ARTICLE_URL = "https://note.com/hanaviye/n/nabc123";

/**
 * 検証用の記事本文HTMLを組み立てる。
 * @param {{alt: string, lightbox: boolean}} params - note.com の表示時差分を再現するパラメータ。
 * @returns {string} 記事本文HTML。
 */
const buildBody = ({ alt, lightbox }) => `
<h2>見出し2</h2>
<p>本文 <strong>太字</strong> と <a href="/hanaviye/n/nzzz">内部リンク</a> と <code>inline</code>。</p>
<p>改行<br>あり</p>
<blockquote><p>引用文</p></blockquote>
<ul><li>項目1</li><li>項目2<ul><li>ネスト</li></ul></li></ul>
<ol><li>順序1</li><li>順序2</li></ol>
<pre><code class="language-js">const a = 1;</code></pre>
<figure>${lightbox ? '<a href="https://assets.st-note.com/img/x.png" data-modal="true">' : ""}<img src="https://assets.st-note.com/img/x.png?width=1200" alt="${alt}" width="620" height="899" loading="lazy">${lightbox ? "</a>" : ""}<figcaption>キャプション</figcaption></figure>
<figure><a href="https://amzn.to/abc">https://amzn.to/abc</a></figure>
<p>末尾テキスト</p>
<hr>
<p>#タグ1</p>
`;

/**
 * 検証用の記事ページHTMLを組み立てる。
 * @param {{alt: string, lightbox: boolean}} params - 記事本文の生成パラメータ。
 * @returns {string} 記事ページHTML。
 */
const buildPage = (params) => `<!doctype html><html><head>
<meta property="og:title" content="テスト記事｜花冷">
<meta property="og:url" content="${ARTICLE_URL}">
</head><body>
<article>
  <div class="o-noteContentHeader__creatorInfo"><a href="/hanaviye">花冷</a></div>
  <div class="o-noteContentHeader__date"><time datetime="2026-06-06T18:34:43.000+09:00">6月6日</time></div>
  <div class="o-noteLikeV3__count">17</div>
  <h1>テスト記事</h1>
  <div data-name="body" class="note-common-styles__textnote-body">${buildBody(params)}</div>
</article></body></html>`;

/**
 * 変換ライブラリを実行し、Markdown と拡張ページ側のノード生成数を返す。
 * @param {string} html - 変換対象の記事HTML。
 * @param {{viaDomParser: boolean}} options - URL変換（DOMParser経由）かどうか。
 * @returns {{markdown: string, hostNodeCreations: number}} 変換結果。
 */
const convert = (html, { viaDomParser }) => {
  // popup / content script 側の Document を模したホスト環境
  const host = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  const win = host.window;
  win.eval(LIB_SRC);

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

  const result = win.NoteToMarkdown.convertNotePageToMarkdown(doc, ARTICLE_URL, {
    tags: ["日記", "気づき"],
    obsidianLinkify: true,
    obsidianLinkWords: ["太字"],
    convertedAt: "FIXED",
  });
  return { markdown: result.markdown, hostNodeCreations };
};

// タブ変換: note.com の表示時スクリプトが alt とライトボックスを付与した状態
const fromTab = convert(buildPage({ alt: "画像", lightbox: true }), { viaDomParser: false });
// URL変換: 配信されたままのHTML
const fromUrl = convert(buildPage({ alt: "", lightbox: false }), { viaDomParser: true });

const failures = [];

if (fromTab.markdown !== fromUrl.markdown) {
  const tabLines = fromTab.markdown.split("\n");
  const urlLines = fromUrl.markdown.split("\n");
  const diffs = [];
  for (let i = 0; i < Math.max(tabLines.length, urlLines.length); i += 1) {
    if (tabLines[i] !== urlLines[i]) {
      diffs.push(`  L${i + 1}\n    タブ変換: ${JSON.stringify(tabLines[i])}\n    URL変換 : ${JSON.stringify(urlLines[i])}`);
    }
  }
  failures.push(`タブ変換とURL変換の出力が一致しません:\n${diffs.join("\n")}`);
}

if (fromUrl.hostNodeCreations > 0) {
  failures.push(
    `外部HTMLが拡張ページ側の Document で組み立てられています（生成ノード数: ${fromUrl.hostNodeCreations}）。`
  );
}

if (failures.length > 0) {
  console.error("検証に失敗しました。\n" + failures.join("\n"));
  process.exit(1);
}

console.log("OK: タブ変換とURL変換の出力は一致しています（拡張ページ側でのDOM生成なし）。");

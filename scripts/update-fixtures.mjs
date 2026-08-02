/**
 * ゴールデンテスト用のフィクスチャを note.com から取得して更新する。
 *
 * 記事HTMLは 300KB 超あるため、変換ロジックが実際に参照する部分
 * （og メタ / 記事ヘッダ / 本文ルート）だけに絞って保存する。
 * ネットワークアクセスを伴うため、通常のテスト実行では呼ばれない。
 *
 * 実行: npm run update:fixtures
 */
import { JSDOM } from "jsdom";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");

// 著作権上の配慮から、フィクスチャは拡張の作者自身の記事のみを使う。
const ARTICLES = [
  { id: "n361272941d2a", note: "画像・キャプションを含む記事" },
  { id: "n8a766cfc8273", note: "見出しとリスト中心の記事" },
  { id: "nb4d13e9d557c", note: "リンク・埋め込みを含む記事" },
];

const BODY_SELECTORS = [
  '[data-name="body"].note-common-styles__textnote-body',
  ".note-common-styles__textnote-body",
  '[data-name="body"]',
];

/**
 * 記事HTMLから変換に必要な要素だけを抜き出した最小HTMLを組み立てる。
 * @param {string} html - 取得した記事HTML。
 * @returns {string} 最小化したHTML。
 */
const trimArticleHtml = (html) => {
  const { document } = new JSDOM(html).window;

  const body = BODY_SELECTORS.map((selector) => document.querySelector(selector)).find(Boolean);
  if (!body) {
    throw new Error("記事本文が見つかりません。note.com の構造が変わった可能性があります。");
  }

  const pick = (selector, attribute) =>
    document.querySelector(selector)?.getAttribute(attribute)?.trim() ?? "";
  const ogTitle = pick("meta[property='og:title']", "content");
  const ogUrl = pick("meta[property='og:url']", "content");
  const authorHref = pick(
    ".o-noteContentHeader__avatar[href], .o-noteContentHeader__creatorInfo a[href]",
    "href"
  );
  const datetime = pick(
    ".o-noteContentHeader__date time[datetime], article time[datetime]",
    "datetime"
  );
  const likeCount =
    document.querySelector(".o-noteLikeV3__count, .o-noteLike__count")?.textContent?.trim() ?? "";
  const heading = document.querySelector("h1")?.textContent?.trim() ?? "";

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta property="og:title" content="${ogTitle.replace(/"/g, "&quot;")}">
<meta property="og:url" content="${ogUrl.replace(/"/g, "&quot;")}">
</head>
<body>
<article>
  <div class="o-noteContentHeader__creatorInfo"><a href="${authorHref}">author</a></div>
  <div class="o-noteContentHeader__date"><time datetime="${datetime}">date</time></div>
  <div class="o-noteLikeV3__count">${likeCount}</div>
  <h1>${heading}</h1>
  ${body.outerHTML}
</article>
</body>
</html>
`;
};

mkdirSync(FIXTURE_DIR, { recursive: true });

for (const article of ARTICLES) {
  const url = `https://note.com/hanaviye/n/${article.id}`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) {
    throw new Error(`記事の取得に失敗しました（HTTP ${response.status}）: ${url}`);
  }
  const trimmed = trimArticleHtml(await response.text());
  const path = join(FIXTURE_DIR, `${article.id}.html`);
  writeFileSync(path, trimmed, "utf8");
  console.log(`updated: ${path} (${trimmed.length} bytes) — ${article.note}`);
}

console.log("フィクスチャを更新しました。期待Markdownの更新は npm run update:golden で行ってください。");

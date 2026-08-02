/**
 * タブ変換（表示済みDOM）と URL 変換（配信HTML）の出力一致テスト。
 *
 * note.com は表示時に alt="画像" の付与や画像のライトボックス用リンク包みを行うため、
 * 同じ記事でも2経路で DOM が異なる。実記事フィクスチャに現れない記法も含めて検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { convertArticle, simulateRenderedDom, wrapArticle } from "./helpers/env.mjs";

const RICH_BODY = `
<h2>見出し2</h2>
<p>本文 <strong>太字</strong> と <a href="/hanaviye/n/nzzz">内部リンク</a> と <code>inline</code>。</p>
<p>改行<br>あり</p>
<blockquote><p>引用文</p></blockquote>
<ul><li>項目1</li><li>項目2<ul><li>ネスト</li></ul></li></ul>
<ol><li>順序1</li><li>順序2</li></ol>
<pre><code class="language-js">const a = 1;</code></pre>
<figure><img src="https://assets.st-note.com/img/x.png?width=1200" alt="" width="620" height="899" loading="lazy"><figcaption>キャプション</figcaption></figure>
<figure><a href="https://amzn.to/abc">https://amzn.to/abc</a></figure>
<p>末尾テキスト</p>
<hr>
<p>#タグ1</p>
`;

const OPTIONS = {
  tags: ["日記", "気づき"],
  obsidianLinkify: true,
  obsidianLinkWords: ["太字"],
};

test("多様な記法を含む記事でタブ変換とURL変換が一致する", () => {
  const html = wrapArticle(RICH_BODY);
  const fromUrl = convertArticle(html, { options: OPTIONS });
  const fromTab = convertArticle(simulateRenderedDom(html), { viaDomParser: false, options: OPTIONS });
  assert.equal(fromTab.markdown, fromUrl.markdown);
});

test("note.com が付与するプレースホルダ alt は出力しない", () => {
  const html = wrapArticle('<figure><img src="https://assets.st-note.com/img/x.png" alt="画像"></figure>');
  const { markdown } = convertArticle(html);
  assert.match(markdown, /!\[\]\(https:\/\/assets\.st-note\.com\/img\/x\.png\)/);
  assert.doesNotMatch(markdown, /!\[画像\]/);
});

test("ユーザーが指定した alt は保持する", () => {
  const html = wrapArticle('<figure><img src="https://assets.st-note.com/img/x.png" alt="ユーフォニアムの写真"></figure>');
  const { markdown } = convertArticle(html);
  assert.match(markdown, /!\[ユーフォニアムの写真\]/);
});

test("画像を包むライトボックス用リンクは Markdown リンクにしない", () => {
  const html = wrapArticle(
    '<figure><a href="https://assets.st-note.com/img/x.png"><img src="https://assets.st-note.com/img/x.png?width=1200" alt=""></a></figure>'
  );
  const { markdown } = convertArticle(html);
  assert.doesNotMatch(markdown, /\[!\[/);
});

test("URL変換では拡張ページ側の Document を使わない", () => {
  const { hostNodeCreations } = convertArticle(wrapArticle(RICH_BODY));
  assert.equal(hostNodeCreations, 0);
});

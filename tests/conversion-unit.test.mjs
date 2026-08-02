/**
 * 変換ライブラリの個別仕様のテスト。
 * 内部関数は公開されていないため、変換結果を通じて検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { convertArticle, createLibWindow, wrapArticle } from "./helpers/env.mjs";

/* ------------------------------ frontmatter ------------------------------ */

test("YAMLで意味を持つ文字を含むタイトルはクォートする", () => {
  const html = wrapArticle("<p>本文</p>", { title: "対談: 「note」の話 #1" });
  const { markdown } = convertArticle(html);
  const titleLine = markdown.split("\n").find((line) => line.startsWith("title:"));
  assert.ok(titleLine.startsWith('title: "'), `クォートされていません: ${titleLine}`);
});

test("タイトル内のダブルクォートとバックスラッシュをエスケープする", () => {
  const html = wrapArticle("<p>本文</p>", { title: 'a "b" \\c' });
  const { markdown } = convertArticle(html);
  const titleLine = markdown.split("\n").find((line) => line.startsWith("title:"));
  // ダブルクォート文字列として読み戻せる形であること
  assert.equal(JSON.parse(titleLine.slice("title: ".length)), 'a "b" \\c');
});

test("タグは最大5件まで、重複と先頭の # を除いて出力する", () => {
  const { metadata } = convertArticle(wrapArticle("<p>本文</p>"), {
    options: { tags: ["#a", "a", "b", "c", "d", "e", "f"] },
  });
  assert.deepEqual([...metadata.tags], ["a", "b", "c", "d", "e"]);
});

test("スキ数が取得できない場合は like_count を出力しない", () => {
  const html = wrapArticle("<p>本文</p>", { likeCount: "" });
  const { markdown } = convertArticle(html);
  assert.doesNotMatch(markdown, /like_count:/);
});

/* -------------------------------- 本文変換 -------------------------------- */

test("末尾のハッシュタグ行を除去する", () => {
  const { markdown } = convertArticle(
    wrapArticle('<p>本文です</p><p>#日記</p><p><a href="https://note.com/hashtag/note">#note</a></p>')
  );
  assert.match(markdown, /本文です/);
  assert.doesNotMatch(markdown, /#日記/);
  assert.doesNotMatch(markdown, /hashtag/);
});

test("ネストしたリストをインデント付きで出力する", () => {
  const { markdown } = convertArticle(
    wrapArticle("<ul><li>親1</li><li>親2<ul><li>子1</li><li>子2</li></ul></li></ul>")
  );
  assert.match(markdown, /^- 親1$/m);
  assert.match(markdown, /^ {2}- 子1$/m);
});

test("順序付きリストは連番で出力する", () => {
  const { markdown } = convertArticle(wrapArticle("<ol><li>一</li><li>二</li><li>三</li></ol>"));
  assert.match(markdown, /^1\. 一$/m);
  assert.match(markdown, /^3\. 三$/m);
});

test("複数行の太字は行ごとに閉じる", () => {
  const { markdown } = convertArticle(wrapArticle("<p><strong>一行目<br>二行目</strong></p>"));
  assert.match(markdown, /\*\*一行目\*\*/);
  assert.match(markdown, /\*\*二行目\*\*/);
});

test("太字の中のアスタリスクをエスケープする", () => {
  const { markdown } = convertArticle(wrapArticle("<p><strong>2*3</strong></p>"));
  assert.match(markdown, /\*\*2\\\*3\*\*/);
});

test("言語指定付きのコードブロックを出力する", () => {
  const { markdown } = convertArticle(
    wrapArticle('<pre><code class="language-python">print(1)</code></pre>')
  );
  assert.match(markdown, /```python\nprint\(1\)\n```/);
});

test("バッククォートを含むインラインコードはフェンスを伸ばす", () => {
  const { markdown } = convertArticle(wrapArticle("<p><code>a`b</code></p>"));
  assert.match(markdown, /``a`b``/);
});

test("引用は各行に > を付ける", () => {
  const { markdown } = convertArticle(
    wrapArticle("<blockquote><p>一行目</p><p>二行目</p></blockquote>")
  );
  assert.match(markdown, /^> 一行目$/m);
  assert.match(markdown, /^> 二行目$/m);
});

test("figcaption を画像直下のイタリックで出力する", () => {
  const { markdown } = convertArticle(
    wrapArticle(
      '<figure><img src="https://assets.st-note.com/img/x.png" alt=""><figcaption>出典: note</figcaption></figure>'
    )
  );
  assert.match(markdown, /!\[\]\(https:\/\/assets\.st-note\.com\/img\/x\.png\)\n\n\*出典: note\*/);
});

test("相対リンクを絶対URLへ解決する", () => {
  const { markdown } = convertArticle(wrapArticle('<p><a href="/hanaviye/n/nzzz">記事</a></p>'));
  assert.match(markdown, /\[記事\]\(https:\/\/note\.com\/hanaviye\/n\/nzzz\)/);
});

test("記事本文が無い場合はエラーにする", () => {
  assert.throws(
    () => convertArticle("<!doctype html><html><body><p>本文なし</p></body></html>"),
    /記事本文が見つかりません/
  );
});

/* --------------------------- Obsidian リンク化 --------------------------- */

const linkify = (bodyHtml, words) =>
  convertArticle(wrapArticle(bodyHtml), {
    options: { obsidianLinkify: true, obsidianLinkWords: words },
  }).markdown;

test("本文中の対象ワードを [[...]] にする", () => {
  assert.match(linkify("<p>Obsidian を使う</p>", ["Obsidian"]), /\[\[Obsidian\]\] を使う/);
});

test("コードブロック内はリンク化しない", () => {
  const markdown = linkify("<pre><code>Obsidian</code></pre>", ["Obsidian"]);
  assert.match(markdown, /```\nObsidian\n```/);
  assert.doesNotMatch(markdown, /\[\[Obsidian\]\]/);
});

test("インラインコード内はリンク化しない", () => {
  assert.doesNotMatch(linkify("<p><code>Obsidian</code></p>", ["Obsidian"]), /\[\[Obsidian\]\]/);
});

test("既存リンクのラベルとURLはリンク化しない", () => {
  const markdown = linkify('<p><a href="https://obsidian.md">Obsidian</a></p>', ["Obsidian"]);
  assert.match(markdown, /\[Obsidian\]\(https:\/\/obsidian\.md\/?\)/);
  assert.doesNotMatch(markdown, /\[\[Obsidian\]\]/);
});

test("画像のURLはリンク化しない", () => {
  const markdown = linkify(
    '<figure><img src="https://assets.st-note.com/img/note.png" alt=""></figure>',
    ["note"]
  );
  assert.doesNotMatch(markdown, /\[\[note\]\]/);
});

test("英単語は単語境界でのみリンク化する", () => {
  const markdown = linkify("<p>note と notebook</p>", ["note"]);
  assert.match(markdown, /\[\[note\]\] と notebook/);
});

test("二重リンク化しない", () => {
  const markdown = linkify("<p>[[Obsidian]] と Obsidian</p>", ["Obsidian"]);
  assert.equal(markdown.match(/\[\[Obsidian\]\]/g).length, 2);
  assert.doesNotMatch(markdown, /\[\[\[\[/);
});

/* ------------------------------ URL 判定など ------------------------------ */

test("isNoteArticleUrl は note.com の記事URLのみ許可する", () => {
  const { NoteToMarkdown } = createLibWindow();
  assert.equal(NoteToMarkdown.isNoteArticleUrl("https://note.com/hanaviye/n/nabc"), true);
  assert.equal(NoteToMarkdown.isNoteArticleUrl("https://note.com/hanaviye"), false);
  assert.equal(NoteToMarkdown.isNoteArticleUrl("http://note.com/hanaviye/n/nabc"), false);
  assert.equal(NoteToMarkdown.isNoteArticleUrl("https://evil.com/n/nabc"), false);
  assert.equal(NoteToMarkdown.isNoteArticleUrl("https://note.com.evil.com/n/nabc"), false);
  assert.equal(NoteToMarkdown.isNoteArticleUrl("javascript:alert(1)"), false);
  assert.equal(NoteToMarkdown.isNoteArticleUrl(""), false);
});

test("noteFolderNameFromUrl はファイル名に使えない文字を除去する", () => {
  const { NoteToMarkdown } = createLibWindow();
  assert.equal(NoteToMarkdown.noteFolderNameFromUrl("https://note.com/u/n/nabc123"), "nabc123");
  assert.equal(NoteToMarkdown.noteFolderNameFromUrl("https://note.com/u/n/nabc123?from=list#x"), "nabc123");
  assert.equal(NoteToMarkdown.noteFolderNameFromUrl("https://note.com/u/n/a.b"), "a-b");
  // URL 正規化で /n/ が消えるケースは既定名にフォールバックする
  assert.equal(NoteToMarkdown.noteFolderNameFromUrl("https://note.com/u/n/../etc"), "note-article");
  assert.equal(NoteToMarkdown.noteFolderNameFromUrl("not-a-url"), "note-article");
});

test("sanitizeFileBaseName はパス区切りを許さない", () => {
  const { NoteToMarkdown } = createLibWindow();
  assert.equal(NoteToMarkdown.sanitizeFileBaseName("../../evil"), "evil");
  assert.equal(NoteToMarkdown.sanitizeFileBaseName("a/b\\c"), "a-b-c");
  assert.equal(NoteToMarkdown.sanitizeFileBaseName("..."), "note-article");
});

/* ------------------------------- 画像の処理 ------------------------------- */

test("画像ダウンロードモードでは連番ファイル名へ置換する", async () => {
  const win = createLibWindow();
  win.fetch = async () => ({ ok: true, blob: async () => new win.Blob(["x"]) });
  const markdown =
    "![](https://assets.st-note.com/img/a.png?width=1200)\n![](https://assets.st-note.com/img/b.jpg)";
  const result = await win.NoteToMarkdown.processMarkdownImages(markdown, {
    imageImportMode: "download",
    imagePathPrefix: "nabc/",
  });
  assert.match(result.markdown, /!\[\]\(nabc\/img1\.png\)/);
  assert.match(result.markdown, /!\[\]\(nabc\/img2\.jpg\)/);
  assert.deepEqual(
    [...result.images].map((image) => image.filename),
    ["img1.png", "img2.jpg"]
  );
});

test("画像取得に失敗した場合は元のMarkdownを保持する", async () => {
  const win = createLibWindow();
  win.fetch = async () => {
    throw new Error("network");
  };
  const markdown = "![](https://assets.st-note.com/img/a.png)";
  const result = await win.NoteToMarkdown.processMarkdownImages(markdown, {
    imageImportMode: "base64",
  });
  assert.equal(result.markdown, markdown);
});

test("URL参照モードでは何も変換しない", async () => {
  const win = createLibWindow();
  const markdown = "![](https://assets.st-note.com/img/a.png)";
  const result = await win.NoteToMarkdown.processMarkdownImages(markdown, { imageImportMode: "url" });
  assert.equal(result.markdown, markdown);
  assert.equal([...result.images].length, 0);
});

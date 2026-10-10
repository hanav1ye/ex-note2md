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

test("画像の保存結果で参照先を差し替え、失敗分は元URLへ戻す", () => {
  const win = createLibWindow();
  const markdown = "![a](nabc/img1.png)\n![b](nabc/img2.png)\n![c](nabc/img3.jpg)";
  const result = win.NoteToMarkdown.applyImageSaveResults(
    markdown,
    [
      { url: "https://assets.st-note.com/img/a.png", requested: "img1.png", filename: "img1.webp" },
      { url: "https://assets.st-note.com/img/b.png", requested: "img2.png", filename: null },
      { url: "https://assets.st-note.com/img/c.jpg", requested: "img3.jpg", filename: "img3.jpg" },
    ],
    "nabc/"
  );
  assert.equal(
    result,
    "![a](nabc/img1.webp)\n![b](https://assets.st-note.com/img/b.png)\n![c](nabc/img3.jpg)"
  );
});

/* -------------------------------- テーブル -------------------------------- */

test("table を GFM の表へ変換する（1行目を見出し行にする）", () => {
  const { markdown } = convertArticle(
    wrapArticle(
      "<table><thead><tr><th>項目</th><th>値</th></tr></thead><tbody><tr><td>A</td><td><strong>1</strong></td></tr><tr><td>B</td><td>2</td></tr></tbody></table>"
    )
  );
  assert.match(markdown, /^\| 項目 \| 値 \|$/m);
  assert.match(markdown, /^\| --- \| --- \|$/m);
  assert.match(markdown, /^\| A \| \*\*1\*\* \|$/m);
  assert.match(markdown, /^\| B \| 2 \|$/m);
});

test("セル内の | はエスケープし、改行は <br> にし、足りないセルは空で埋める", () => {
  const { markdown } = convertArticle(
    wrapArticle("<table><tr><td>a|b</td><td>一行目<br>二行目</td></tr><tr><td>c</td></tr></table>")
  );
  assert.match(markdown, /^\| a\\|b \| 一行目<br>二行目 \|$/m);
  assert.match(markdown, /^\| c \|  \|$/m);
});

test("table の caption は表の直前に斜体で出す", () => {
  const { markdown } = convertArticle(
    wrapArticle("<table><caption>料金表</caption><tr><th>x</th></tr><tr><td>1</td></tr></table>")
  );
  assert.match(markdown, /\*料金表\*\n\n\| x \|\n\| --- \|\n\| 1 \|/);
});

/* --------------------------------- 引用 --------------------------------- */

test("引用内のリスト・画像・改行を保持する", () => {
  const { markdown } = convertArticle(
    wrapArticle(
      '<blockquote><p>一行目<br>二行目</p><ul><li>項目</li></ul><figure><img src="https://assets.st-note.com/img/a.png" alt=""></figure></blockquote>'
    )
  );
  assert.match(markdown, /^> 一行目 {2}$/m);
  assert.match(markdown, /^> 二行目$/m);
  assert.match(markdown, /^> - 項目$/m);
  assert.match(markdown, /^> !\[\]\(https:\/\/assets\.st-note\.com\/img\/a\.png\)$/m);
});

test("入れ子の引用は > > で出力し、空行の連続は1つにまとめる", () => {
  const { markdown } = convertArticle(
    wrapArticle("<blockquote><p>外側</p><blockquote><p>内側</p></blockquote><p>外側の続き</p></blockquote>")
  );
  assert.match(markdown, /^> 外側\n>\n> > 内側\n>\n> 外側の続き$/m);
  assert.doesNotMatch(markdown, /^>\n>$/m);
});

/* -------------------------------- 有料記事 -------------------------------- */

const PAYWALL_HTML =
  '<div class="p-article__paywall"><div class="note-paywall o-paywall"><div class="m-paywallHeader"><h2><span class="m-paywallHeader__label">ここから先は</span></h2><div><div>4,480字<span>/</span>5画像</div></div></div></div></div>';

test("有料記事は無料公開部分を変換し、末尾に未取得の注記を付ける", () => {
  const html = wrapArticle("<p>無料部分</p>").replace("</article>", `${PAYWALL_HTML}</article>`);
  const { markdown, paywall } = convertArticle(html);
  assert.match(markdown, /無料部分/);
  assert.match(markdown, /\n> ここから先は有料部分（4,480字 \/ 5画像）のため、この Markdown には含まれていません。$/);
  assert.deepEqual({ ...paywall }, { chars: 4480, images: 5 });
  assert.doesNotMatch(markdown, /^paywall:/m);
});

test("paywall が無ければ注記を付けず paywall は null", () => {
  const { markdown, paywall } = convertArticle(wrapArticle("<p>本文</p>"));
  assert.doesNotMatch(markdown, /有料部分/);
  assert.equal(paywall, null);
});

test("無料公開部分が無い有料記事は有料記事である旨のエラーにする", () => {
  const html = wrapArticle("").replace("</article>", `${PAYWALL_HTML}</article>`);
  assert.throws(() => convertArticle(html), /有料記事のため本文を取得できません/);
});

test("課金境界の見出しも量の表示も無い枠は paywall として扱わない", () => {
  const html = wrapArticle("<p>本文</p>").replace(
    "</article>",
    '<div class="p-article__paywall"><div class="note-paywall"><p>購入済み</p></div></div></article>'
  );
  const { markdown, paywall } = convertArticle(html);
  assert.equal(paywall, null);
  assert.doesNotMatch(markdown, /有料部分/);
});

/* -------------------------------- 空行の整理 ------------------------------- */

test("段落の直後に続くブロックとの間の空行を1つにまとめる", () => {
  const blocks = {
    画像: '<figure><img src="https://assets.st-note.com/img/a.png" alt=""></figure>',
    引用: "<blockquote><p>q</p></blockquote>",
    リスト: "<ul><li>item</li></ul>",
    表: "<table><tr><td>a</td></tr></table>",
    見出し: "<h2>見出し</h2>",
    埋め込みリンク: '<figure><a href="https://x.test/">x</a></figure>',
  };
  Object.entries(blocks).forEach(([label, block]) => {
    const { markdown } = convertArticle(wrapArticle(`<p>本文</p>${block}<p>後続</p>`));
    assert.doesNotMatch(markdown, /\n{3,}/, `${label}の前後に余分な空行が残っています`);
  });
});

test("空白だけの行は空行に揃える（ハード改行は残す）", () => {
  const { markdown } = convertArticle(wrapArticle("<p>一行目<br><br>三行目</p><p>次</p>"));
  assert.doesNotMatch(markdown, /^[ \t]+$/m);
  assert.match(markdown, /^一行目 {2}$/m, "行末のハード改行が失われています");
});

test("コードブロック内の空行は残す", () => {
  const { markdown } = convertArticle(wrapArticle("<pre><code>a\n\n\n\nb</code></pre><p>後続</p>"));
  assert.match(markdown, /```\na\n\n\n\nb\n```/);
});

test("ネストしたフェンスを含むコードブロックでも中身を変えない", () => {
  const { markdown } = convertArticle(
    wrapArticle("<pre><code>```\nnested\n```\n\n\n\nafter</code></pre><p>後続</p>")
  );
  assert.match(markdown, /````\n```\nnested\n```\n\n\n\nafter\n````/);
});

/* ------------------------------ 末尾の取りこぼし ----------------------------- */

test("末尾が文字を持たないリンクだけの段落でも落とさない", () => {
  const { markdown } = convertArticle(
    wrapArticle('<p>本文</p><p><a href="https://note.com/hanaviye/n/n111"></a></p>')
  );
  assert.match(markdown, /\[https:\/\/note\.com\/hanaviye\/n\/n111\]\(https:\/\/note\.com\/hanaviye\/n\/n111\)$/);
});

test("リンクの無い埋め込み（iframe だけの figure）は埋め込み先URLを拾う", () => {
  const { markdown } = convertArticle(
    wrapArticle('<p>本文</p><figure><iframe src="https://note.com/qa/embed/hanaviye"></iframe></figure>')
  );
  assert.match(markdown, /\[https:\/\/note\.com\/qa\/embed\/hanaviye\]\(https:\/\/note\.com\/qa\/embed\/hanaviye\)$/);
});

test("遅延読み込みの埋め込みは data-src から拾う", () => {
  const { markdown } = convertArticle(
    wrapArticle('<p>本文</p><figure><iframe data-src="https://note.com/embed/notes/n222"></iframe></figure>')
  );
  assert.match(markdown, /\[https:\/\/note\.com\/embed\/notes\/n222\]/);
});

test("埋め込みにリンクがあれば iframe のURLではなくリンク先を使う", () => {
  const { markdown } = convertArticle(
    wrapArticle(
      '<p>本文</p><figure><a href="https://note.com/hanaviye/n/n333">記事</a><iframe data-src="https://note.com/embed/notes/n333"></iframe></figure>'
    )
  );
  assert.match(markdown, /\[https:\/\/note\.com\/hanaviye\/n\/n333\]/);
  assert.doesNotMatch(markdown, /embed\/notes/);
});

test("javascript: など http(s) 以外の埋め込みURLは拾わない", () => {
  const { markdown } = convertArticle(
    wrapArticle('<p>本文</p><figure><iframe src="javascript:alert(1)"></iframe></figure>')
  );
  assert.doesNotMatch(markdown, /javascript:/);
});

test("中身の無い末尾ブロックは従来どおり落とす", () => {
  const { markdown } = convertArticle(wrapArticle("<p>本文</p><p></p><p>  </p><br>"));
  assert.match(markdown, /本文$/);
});

/* -------------------------------- 公開日時 -------------------------------- */

test("公開日時を日本時間の秒まで出力する（オフセットは付けない）", () => {
  const { markdown } = convertArticle(
    wrapArticle("<p>本文</p>", { datetime: "2026-06-04T19:19:18.000+09:00" })
  );
  assert.match(markdown, /^published: 2026-06-04T19:19:18$/m);
});

test("朝9時より前に公開した記事でも日付がずれない", () => {
  // UTC へ変換してから日付を取ると前日になってしまうケース
  for (const [datetime, expected] of [
    ["2026-06-05T00:30:00.000+09:00", "2026-06-05T00:30:00"],
    ["2026-06-05T07:00:00.000+09:00", "2026-06-05T07:00:00"],
    ["2026-01-01T00:00:00.000+09:00", "2026-01-01T00:00:00"],
  ]) {
    const { markdown } = convertArticle(wrapArticle("<p>本文</p>", { datetime }));
    assert.match(markdown, new RegExp(`^published: ${expected}$`, "m"), `${datetime} の変換結果が違います`);
  }
});

test("別のタイムゾーンで書かれていても日本時間に揃える", () => {
  // 2026-06-04T22:00:00Z = 日本時間 2026-06-05 07:00
  const { markdown } = convertArticle(wrapArticle("<p>本文</p>", { datetime: "2026-06-04T22:00:00.000Z" }));
  assert.match(markdown, /^published: 2026-06-05T07:00:00$/m);
});

test("日時が無ければ published を出力しない", () => {
  const html = wrapArticle("<p>本文</p>").replace(/<time[^>]*>.*?<\/time>/, "");
  const { markdown } = convertArticle(html);
  assert.doesNotMatch(markdown, /^published:/m);
});

test("解釈できない日時でも frontmatter を壊さない", () => {
  const { markdown } = convertArticle(wrapArticle("<p>本文</p>", { datetime: "いつか" }));
  const line = markdown.split("\n").find((l) => l.startsWith("published:"));
  assert.equal(line, "published: いつか");
  assert.match(markdown, /^note_id: /m, "後続の項目が壊れています");
});

test("変換時と更新時で published の形式が一致する", async () => {
  // 変換（lib/noteToMarkdown.js）と更新（lib/likeCount.js）は別々に日時を整形するため、
  // 同じ日時から同じ文字列になることを確かめる。ずれると更新のたびに書き換えが走る。
  const vm = await import("node:vm");
  const { readSource } = await import("./helpers/env.mjs");
  const context = { fetch: undefined, Intl, Date };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readSource("lib", "likeCount.js"), context);

  for (const datetime of [
    "2026-06-04T19:19:18.000+09:00",
    "2026-06-05T00:30:00.000+09:00",
    "2026-06-04T22:00:00.000Z",
    "2026-12-31T23:59:59.000+09:00",
  ]) {
    const { markdown } = convertArticle(wrapArticle("<p>本文</p>", { datetime }));
    const fromConversion = markdown.split("\n").find((line) => line.startsWith("published: "))?.slice(11);
    const fromUpdate = context.NtmLikeCount.formatJapanDateTime(new Date(datetime));
    assert.equal(fromConversion, fromUpdate, `${datetime} で形式がずれています`);
  }
});

/* ---------------------- frontmatter のキー設定 ---------------------- */

test("既定設定では、この機能が無かった頃と1バイトも変わらない", () => {
  // ここが崩れると、既存利用者の次回更新で全ファイルが書き換わる。
  const html = wrapArticle("<p>本文</p>", { title: "記事", datetime: "2026-06-04T19:19:18.000+09:00" });
  const expected = [
    "---",
    "title: 記事",
    'source: "https://note.com/hanaviye/n/nabc123"',
    "note_id: nabc123",
    "author: hanaviye",
    "published: 2026-06-04T19:19:18",
    "like_count: 17",
    "tags:",
    "  - 学習メモ",
    'converted_at: "2026-01-01T00:00:00.000+09:00"',
    "---",
  ].join("\n");

  const withoutConfig = convertArticle(html, { options: { tags: ["学習メモ"] } });
  assert.equal(withoutConfig.markdown.split("\n\n#")[0], expected, "設定なしの出力が変わっています");

  const withDefaults = convertArticle(html, { options: { tags: ["学習メモ"], frontmatterKeys: {} } });
  assert.equal(withDefaults.markdown, withoutConfig.markdown, "既定設定が「設定なし」と違う出力になっています");
});

test("設定に従って出力しない項目を省き、キー名を差し替える", () => {
  const { markdown } = convertArticle(wrapArticle("<p>本文</p>"), {
    options: {
      tags: ["学習メモ"],
      frontmatterKeys: {
        author: { enabled: false },
        converted_at: { enabled: false },
        published: { name: "published_at" },
        tags: { name: "note_tags" },
      },
    },
  });
  assert.doesNotMatch(markdown, /^author:/m);
  assert.doesNotMatch(markdown, /^converted_at:/m);
  assert.match(markdown, /^published_at: /m);
  assert.match(markdown, /^note_tags:\n {2}- 学習メモ$/m);
});

test("改名しても出力順は項目の並びのまま", () => {
  const { markdown } = convertArticle(wrapArticle("<p>本文</p>"), {
    options: {
      tags: ["学習メモ"],
      frontmatterKeys: { published: { name: "zzz_published" }, tags: { name: "aaa_tags" } },
    },
  });
  const keys = markdown
    .split("\n---")[0]
    .split("\n")
    .filter((line) => /^[a-z_]+:/.test(line))
    .map((line) => line.split(":")[0]);
  assert.deepEqual(keys, ["title", "source", "note_id", "author", "zzz_published", "like_count", "aaa_tags", "converted_at"]);
});

test("note_id は設定で消せない", () => {
  const { markdown } = convertArticle(wrapArticle("<p>本文</p>"), {
    options: { frontmatterKeys: { note_id: { enabled: false, name: "nid" } } },
  });
  assert.match(markdown, /^note_id: nabc123$/m, "note_id は常に既定名で出力される必要があります");
});

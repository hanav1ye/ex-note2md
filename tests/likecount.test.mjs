/**
 * スキ数更新ロジック（lib/likeCount.js）のテスト。
 * frontmatter の解析・更新、.md の再帰収集、更新対象の仕分けを検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readSource } from "./helpers/env.mjs";

/**
 * lib/likeCount.js を評価した環境を作る。
 * @param {{fetchImpl?: Function}} [options={}] - 差し替える fetch。
 * @returns {object} NtmLikeCount。
 */
const loadLikeCount = ({ fetchImpl } = {}) => {
  const context = { fetch: fetchImpl };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readSource("lib", "likeCount.js"), context);
  return context.NtmLikeCount;
};

/**
 * File System Access のファイルハンドルを模したスタブ。
 * @param {string} name - ファイル名。
 * @param {string} contents - 初期内容。
 * @returns {object} スタブハンドル。
 */
const createFileHandle = (name, contents) => {
  const state = { contents };
  return {
    kind: "file",
    name,
    state,
    getFile: async () => ({ text: async () => state.contents }),
    createWritable: async () => ({
      write: async (data) => {
        state.contents = data;
      },
      close: async () => {},
    }),
  };
};

/**
 * ディレクトリハンドルを模したスタブ。
 * @param {Record<string, object>} entries - 名前 → ハンドル。
 * @returns {object} スタブハンドル。
 */
const createDirectoryHandle = (entries) => ({
  kind: "directory",
  entries: async function* entriesIterator() {
    for (const [name, handle] of Object.entries(entries)) {
      yield [name, handle];
    }
  },
});

const ARTICLE = `---
title: テスト記事
source: "https://note.com/hanaviye/n/nabc123"
note_id: nabc123
author: hanaviye
published: 2026-04-29
like_count: 10
tags:
  - 日記
---

# テスト記事

本文
`;

/* ----------------------------- frontmatter ----------------------------- */

test("frontmatter と本文を分離する", () => {
  const lib = loadLikeCount();
  const parts = lib.splitFrontmatter(ARTICLE);
  assert.match(parts.frontmatter, /^title: テスト記事/);
  assert.match(parts.body, /# テスト記事/);
  // 分離して組み立て直したときに元へ戻ること（本文先頭の改行が失われないこと）
  assert.equal(`---\n${parts.frontmatter}\n---${parts.trailingNewline}${parts.body}`, ARTICLE);
});

test("frontmatter が無ければ null を返す", () => {
  const lib = loadLikeCount();
  assert.equal(lib.splitFrontmatter("# 見出しだけ\n\n本文"), null);
});

test("note_id は frontmatter・source・ファイル名の順で解決する", () => {
  const lib = loadLikeCount();
  assert.equal(lib.resolveNoteId("note_id: nabc123", "whatever.md"), "nabc123");
  assert.equal(
    lib.resolveNoteId('source: "https://note.com/hanaviye/n/ndef456"', "whatever.md"),
    "ndef456"
  );
  assert.equal(lib.resolveNoteId("title: x", "n361272941d2a.md"), "n361272941d2a");
  assert.equal(lib.resolveNoteId("title: x", "普通のメモ.md"), null);
});

test("既存の like_count を書き換える", () => {
  const lib = loadLikeCount();
  const updated = lib.applyLikeCountToContent(ARTICLE, 42);
  assert.match(updated, /^like_count: 42$/m);
  assert.equal(/like_count:/g.test(updated), true);
  assert.equal(updated.match(/like_count:/g).length, 1, "like_count が重複しています");
  assert.match(updated, /^# テスト記事$/m, "本文が壊れています");
});

test("like_count が無ければ published の直後へ挿入する", () => {
  const lib = loadLikeCount();
  const source = ["---", "title: x", "author: hanaviye", "published: 2026-04-29", "tags:", "  - 日記", "---", "", "本文"].join("\n");
  const updated = lib.applyLikeCountToContent(source, 7);
  assert.match(updated, /published: 2026-04-29\nlike_count: 7\ntags:/);
});

test("published も author も無ければ末尾へ足す", () => {
  const lib = loadLikeCount();
  const updated = lib.applyLikeCountToContent("---\ntitle: x\n---\n\n本文", 3);
  assert.match(updated, /---\ntitle: x\nlike_count: 3\n---/);
});

test("現在の like_count を読み取る", () => {
  const lib = loadLikeCount();
  assert.equal(lib.readLikeCount("like_count: 10"), 10);
  assert.equal(lib.readLikeCount("like_count: なし"), null);
  assert.equal(lib.readLikeCount("title: x"), null);
});

test("CRLF の frontmatter も壊さずに扱える", () => {
  const lib = loadLikeCount();
  const crlf = ARTICLE.replace(/\n/g, "\r\n");
  const updated = lib.applyLikeCountToContent(crlf, 99);
  assert.match(updated, /like_count: 99/);
  assert.match(updated, /# テスト記事/);
});

/* ------------------------------- 走査 --------------------------------- */

test(".md をサブフォルダも含めて収集する", async () => {
  const lib = loadLikeCount();
  const root = createDirectoryHandle({
    "a.md": createFileHandle("a.md", ARTICLE),
    "readme.txt": createFileHandle("readme.txt", "x"),
    sub: createDirectoryHandle({
      "b.md": createFileHandle("b.md", ARTICLE),
      deeper: createDirectoryHandle({ "c.MD": createFileHandle("c.MD", ARTICLE) }),
    }),
  });

  const files = await lib.collectMarkdownFiles(root);
  assert.deepEqual(
    Array.from(files, (file) => file.path),
    ["a.md", "sub/b.md", "sub/deeper/c.MD"]
  );
});

test("更新対象と対象外を仕分ける", async () => {
  const lib = loadLikeCount();
  const root = createDirectoryHandle({
    "ok.md": createFileHandle("ok.md", ARTICLE),
    "plain.md": createFileHandle("plain.md", "# frontmatter なし"),
    "unknown.md": createFileHandle("unknown.md", "---\ntitle: x\n---\n\n本文"),
  });

  const files = await lib.collectMarkdownFiles(root);
  const { targets, skipped } = await lib.planUpdates(files);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].noteId, "nabc123");
  assert.equal(targets[0].currentLikeCount, 10);
  assert.deepEqual(
    Array.from(skipped, (entry) => entry.reason).sort(),
    ["no-frontmatter", "no-note-id"]
  );
});

/* ------------------------------- API ---------------------------------- */

test("note の API から like_count を取得する", async () => {
  const calls = [];
  const lib = loadLikeCount({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ data: { like_count: 55 } }) };
    },
  });

  assert.equal(await lib.fetchLikeCount("nabc123"), 55);
  assert.equal(calls[0].url, "https://note.com/api/v3/notes/nabc123");
  assert.equal(
    calls[0].options.credentials,
    "omit",
    "利用者の note.com のログイン情報を送ってはいけません"
  );
});

test("HTTP エラーは失敗として扱う", async () => {
  const lib = loadLikeCount({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(() => lib.fetchLikeCount("nabc123"), /404/);
});

test("like_count が数値でなければ失敗として扱う", async () => {
  const lib = loadLikeCount({
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
  });
  await assert.rejects(() => lib.fetchLikeCount("nabc123"));
});

/* ------------------------------ 誤爆の防止 ------------------------------ */

test("水平線に挟まれただけの本文は frontmatter とみなさない", () => {
  const lib = loadLikeCount();
  const hr = "---\nここは本文です\n---\n\n続き\n";
  assert.equal(lib.splitFrontmatter(hr), null);
  // 誤って like_count を挿し込まないこと
  assert.equal(lib.applyLikeCountToContent(hr, 55), hr);
});

test("普通のファイル名を note_id と誤認しない", () => {
  const lib = loadLikeCount();
  ["nade", "nabe", "n0", "nada", "nb"].forEach((stem) => {
    assert.equal(
      lib.resolveNoteId("title: 自分のメモ", `${stem}.md`),
      null,
      `${stem}.md を note_id とみなしています`
    );
  });
  // 実在する形式（n + 12桁の16進数）は従来どおり通す
  assert.equal(lib.resolveNoteId("title: x", "n361272941d2a.md"), "n361272941d2a");
});

test("書き込み直前の検査は最新の内容を土台にする", () => {
  const lib = loadLikeCount();
  // 走査後にユーザーが本文へ加筆した状況
  const edited = ARTICLE.replace("本文", "本文\n\nあとから書き足した段落");
  const result = lib.buildUpdatedContent(edited, "nabc123.md", "nabc123", 55);

  assert.equal(result.status, "ok");
  assert.match(result.content, /like_count: 55/);
  assert.match(result.content, /あとから書き足した段落/, "加筆分が失われています");
});

test("走査後に別の記事へ変わったファイルには触らない", () => {
  const lib = loadLikeCount();
  const swapped = ARTICLE.replace(/nabc123/g, "nzzz999");
  const result = lib.buildUpdatedContent(swapped, "nabc123.md", "nabc123", 55);

  assert.equal(result.status, "mismatch");
  assert.equal(result.content, swapped, "内容を書き換えています");
});

test("走査後に frontmatter が消えたファイルには触らない", () => {
  const lib = loadLikeCount();
  const stripped = "# 記事\n\n本文\n";
  const result = lib.buildUpdatedContent(stripped, "nabc123.md", "nabc123", 55);

  assert.equal(result.status, "mismatch");
  assert.equal(result.content, stripped);
});

test("値が変わらないなら書き込み対象にしない", () => {
  const lib = loadLikeCount();
  const result = lib.buildUpdatedContent(ARTICLE, "nabc123.md", "nabc123", 10);
  assert.equal(result.status, "unchanged");
});

/* ------------------- ダッシュボード由来の数値の書き込み ------------------- */

const FRONTMATTER_SAMPLE = [
  "---",
  'title: "テスト記事"',
  "source: https://note.com/hanaviye/n/n111",
  "note_id: n111",
  "author: hanaviye",
  "published: 2026-01-01T00:00:00+09:00",
  "like_count: 10",
  "---",
  "",
  "# テスト記事",
  "",
  "本文",
].join("\n");

test("ページビュー数とインプレッション数を like_count の後ろへ足す", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(FRONTMATTER_SAMPLE, {
    likeCount: 12,
    pageViewCount: 340,
    impressionCount: 5600,
    statsUpdatedAt: "2026-10-05T07:00:00+09:00",
  });
  const lines = next.split("\n");
  assert.deepEqual(lines.slice(6, 10), [
    "like_count: 12",
    "page_view_count: 340",
    "impression_count: 5600",
    "stats_updated_at: 2026-10-05T07:00:00+09:00",
  ]);
  assert.match(next, /\n# テスト記事\n/, "本文を壊していません");
});

test("2回実行しても行が増えず、値だけ入れ替わる", () => {
  const lib = loadLikeCount();
  const stats = { likeCount: 12, pageViewCount: 340, impressionCount: 5600, statsUpdatedAt: "2026-10-05T07:00:00+09:00" };
  const once = lib.applyStatsToContent(FRONTMATTER_SAMPLE, stats);
  const twice = lib.applyStatsToContent(once, { ...stats, pageViewCount: 999 });
  assert.equal(twice.match(/^page_view_count:/gm).length, 1);
  assert.match(twice, /^page_view_count: 999$/m);
  assert.equal(twice.split("\n").length, once.split("\n").length);
});

test("取れなかった数値はキーを足さない（他人の記事）", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(FRONTMATTER_SAMPLE, {
    likeCount: 12,
    pageViewCount: null,
    impressionCount: null,
    statsUpdatedAt: "2026-10-05T07:00:00+09:00",
  });
  assert.match(next, /^like_count: 12$/m);
  assert.doesNotMatch(next, /page_view_count/);
  assert.doesNotMatch(next, /impression_count/);
  assert.doesNotMatch(next, /stats_updated_at/, "数値が無いなら集計日時も書きません");
});

test("インプレッションだけ取れない記事ではページビューだけ書く", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(FRONTMATTER_SAMPLE, {
    likeCount: 12,
    pageViewCount: 340,
    impressionCount: null,
    statsUpdatedAt: "2026-10-05T07:00:00+09:00",
  });
  assert.match(next, /^page_view_count: 340$/m);
  assert.doesNotMatch(next, /impression_count/);
  assert.match(next, /^stats_updated_at: /m);
});

test("既にある impression_count は取れなくても消さない", () => {
  const lib = loadLikeCount();
  const withImpression = lib.applyStatsToContent(FRONTMATTER_SAMPLE, {
    pageViewCount: 1,
    impressionCount: 2,
    statsUpdatedAt: "2026-10-05T07:00:00+09:00",
  });
  const next = lib.applyStatsToContent(withImpression, { pageViewCount: 5, impressionCount: null });
  assert.match(next, /^impression_count: 2$/m);
  assert.match(next, /^page_view_count: 5$/m);
});

test("like_count が無い frontmatter でも published の後ろに並ぶ", () => {
  const lib = loadLikeCount();
  const source = FRONTMATTER_SAMPLE.replace("like_count: 10\n", "");
  const next = lib.applyStatsToContent(source, { pageViewCount: 7, impressionCount: 8, statsUpdatedAt: "2026-10-05T07:00:00+09:00" });
  const lines = next.split("\n");
  const published = lines.findIndex((line) => line.startsWith("published:"));
  assert.deepEqual(lines.slice(published + 1, published + 3), ["page_view_count: 7", "impression_count: 8"]);
});

test("frontmatter が無いファイルは触らない", () => {
  const lib = loadLikeCount();
  const plain = "# 見出しだけのファイル\n\n本文";
  assert.equal(lib.applyStatsToContent(plain, { pageViewCount: 1 }), plain);
});

test("想定外の集計日時はクォートして frontmatter を壊さない", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(FRONTMATTER_SAMPLE, {
    pageViewCount: 1,
    statsUpdatedAt: 'broken: "value"',
  });
  assert.match(next, /^stats_updated_at: "broken: \\"value\\""$/m);
});

test("書き込み直前の検査は数値付きでも効く（別記事なら触らない）", () => {
  const lib = loadLikeCount();
  const stats = { likeCount: 12, pageViewCount: 1, impressionCount: 2, statsUpdatedAt: "2026-10-05T07:00:00+09:00" };

  const ok = lib.buildUpdatedContentWithStats(FRONTMATTER_SAMPLE, "n111.md", "n111", stats);
  assert.equal(ok.status, "ok");

  const mismatch = lib.buildUpdatedContentWithStats(FRONTMATTER_SAMPLE, "n111.md", "n999", stats);
  assert.equal(mismatch.status, "mismatch");
  assert.equal(mismatch.content, FRONTMATTER_SAMPLE, "内容は変えません");

  const unchanged = lib.buildUpdatedContentWithStats(ok.content, "n111.md", "n111", stats);
  assert.equal(unchanged.status, "unchanged", "同じ値なら書き込みません");
});

test("件数として不正な値は書き込まない", () => {
  const lib = loadLikeCount();
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "340", null]) {
    const next = lib.applyStatsToContent(FRONTMATTER_SAMPLE, {
      pageViewCount: value,
      statsUpdatedAt: "2026-10-05T07:00:00+09:00",
    });
    assert.doesNotMatch(next, /page_view_count/, `${String(value)} を書き込んでいます`);
    assert.doesNotMatch(next, /stats_updated_at/, `${String(value)} で集計日時だけ書き込んでいます`);
  }
  // 0 は正当な件数なので書き込む
  const zero = lib.applyStatsToContent(FRONTMATTER_SAMPLE, {
    pageViewCount: 0,
    statsUpdatedAt: "2026-10-05T07:00:00+09:00",
  });
  assert.match(zero, /^page_view_count: 0$/m);
});

/* ------------------------- 公開日時（published） ------------------------- */

test("API の応答からスキ数と公開日時をまとめて取る", async () => {
  const calls = [];
  const lib = loadLikeCount();
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ data: { like_count: 46, publish_at: "2026-06-04T19:19:18.000+09:00" } }),
    };
  };
  const summary = await lib.fetchNoteSummary("n111", fetchImpl);
  assert.deepEqual({ ...summary }, { likeCount: 46, publishedAt: "2026-06-04T19:19:18" });
  assert.equal(calls.length, 1, "公開日時のために通信を増やしてはいけません");
});

test("公開日時が無い・壊れている応答でも落ちない", async () => {
  const lib = loadLikeCount();
  for (const publishAt of [undefined, "", "いつか"]) {
    const summary = await lib.fetchNoteSummary("n111", async () => ({
      ok: true,
      json: async () => ({ data: { like_count: 1, publish_at: publishAt } }),
    }));
    assert.equal(summary.publishedAt, null, `${String(publishAt)} を日時として扱っています`);
    assert.equal(summary.likeCount, 1);
  }
});

test("日付だけの published を時刻入りへ揃える", () => {
  const lib = loadLikeCount();
  const source = FRONTMATTER_SAMPLE.replace(
    "published: 2026-01-01T00:00:00+09:00",
    "published: 2026-01-01"
  );
  const next = lib.applyStatsToContent(source, { likeCount: 12, publishedAt: "2026-01-01T09:30:00" });
  assert.match(next, /^published: 2026-01-01T09:30:00$/m);
  assert.equal(next.match(/^published:/gm).length, 1, "行が増えています");
});

test("published が無い frontmatter には追加する", () => {
  const lib = loadLikeCount();
  const source = ["---", "note_id: n111", "author: hanaviye", "---", "", "本文"].join("\n");
  const next = lib.applyStatsToContent(source, { publishedAt: "2026-06-04T19:19:18" });
  assert.match(next, /^author: hanaviye\npublished: 2026-06-04T19:19:18$/m);
});

test("公開日時が取れなければ published に触らない", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(FRONTMATTER_SAMPLE, { likeCount: 12, publishedAt: null });
  assert.match(next, /^published: 2026-01-01T00:00:00\+09:00$/m, "元の値を変えています");
});

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

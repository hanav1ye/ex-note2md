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
  vm.runInContext(readSource("lib", "frontmatterKeys.js"), context);
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


/* ------------------- frontmatter のブロック再生成 ------------------- */

const SAMPLE = [
  "---",
  'title: "もとのタイトル"',
  'source: "https://note.com/hanaviye/n/n111"',
  "note_id: n111",
  "author: hanaviye",
  "published: 2026-01-01",
  "like_count: 10",
  "tags:",
  "  - エンジニア",
  "  - 学習メモ",
  "converted_at: 2026-01-01T00:00:00.000+09:00",
  "---",
  "",
  "# 記事",
  "",
  "本文",
].join("\n");

/** note から取れた値（更新時に渡すもの）。 */
const VALUES = {
  title: "あたらしいタイトル",
  source: "https://note.com/hanaviye/n/n111",
  note_id: "n111",
  author: "hanaviye",
  published: "2026-01-01T19:19:18",
  like_count: 46,
  page_view_count: 120,
  impression_count: 2949,
  stats_updated_at: "2026-10-05T07:00:00.000Z",
};

/** frontmatter 部分だけを行の配列で取り出す。 */
const frontmatterLines = (content) => content.split("---")[1].trim().split("\n");

test("管理する項目を作り直し、値を最新に揃える", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(SAMPLE, VALUES);
  assert.deepEqual(frontmatterLines(next), [
    "title: あたらしいタイトル",
    'source: "https://note.com/hanaviye/n/n111"',
    "note_id: n111",
    "author: hanaviye",
    "published: 2026-01-01T19:19:18",
    "like_count: 46",
    "page_view_count: 120",
    "impression_count: 2949",
    "stats_updated_at: 2026-10-05T07:00:00.000Z",
    "tags:",
    "  - エンジニア",
    "  - 学習メモ",
    "converted_at: 2026-01-01T00:00:00.000+09:00",
  ]);
  assert.match(next, /^# 記事$/m, "本文が壊れています");
});

test("tags と converted_at は作り直さず、そのまま引き継ぐ", () => {
  const lib = loadLikeCount();
  // tags は popup で選んだ利用者のもの、converted_at は「変換した日時」。
  const next = lib.applyStatsToContent(SAMPLE, { ...VALUES, tags: ["消えるはず"], converted_at: "9999-01-01" });
  assert.match(next, /^ {2}- エンジニア$/m);
  assert.match(next, /^converted_at: 2026-01-01T00:00:00\.000\+09:00$/m);
  assert.doesNotMatch(next, /9999-01-01/);
});

test("利用者が足した項目は消さず、末尾に残す", () => {
  const lib = loadLikeCount();
  const withOwn = SAMPLE.replace("author: hanaviye", "author: hanaviye\nstatus: reading\nrating: 5");
  const next = lib.applyStatsToContent(withOwn, VALUES);
  const lines = frontmatterLines(next);
  assert.equal(lines.includes("status: reading"), true);
  assert.equal(lines.includes("rating: 5"), true);
  assert.equal(lines.at(-2), "status: reading", "未知の項目は相対順序を保って末尾へ");
  assert.equal(lines.at(-1), "rating: 5");
});

test("値が取れなかった項目は、既存の行を引き継ぐ", () => {
  const lib = loadLikeCount();
  // 他人の記事ではダッシュボードの値が取れない。すでにある行を消してはいけない。
  const withStats = lib.applyStatsToContent(SAMPLE, VALUES);
  const next = lib.applyStatsToContent(withStats, {
    ...VALUES,
    page_view_count: null,
    impression_count: null,
    stats_updated_at: null,
  });
  assert.match(next, /^page_view_count: 120$/m);
  assert.match(next, /^impression_count: 2949$/m);
});

test("値も既存の行も無い項目は出力しない", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(SAMPLE, { like_count: 46 });
  assert.doesNotMatch(next, /page_view_count/);
  assert.doesNotMatch(next, /impression_count/);
});

test("2 回実行しても行が増えず、2 回目は内容が変わらない", () => {
  const lib = loadLikeCount();
  const once = lib.applyStatsToContent(SAMPLE, VALUES);
  const twice = lib.applyStatsToContent(once, VALUES);
  assert.equal(twice, once, "同じ値なら 2 回目で変化してはいけません");
  assert.equal(once.match(/^like_count:/gm).length, 1);
});

test("frontmatter が無いファイルは触らない", () => {
  const lib = loadLikeCount();
  const plain = "# 見出しだけのファイル\n\n本文";
  assert.equal(lib.applyStatsToContent(plain, VALUES), plain);
});

/* ------------------------- 出力の ON/OFF と改名 ------------------------- */

test("出力しない設定の項目は、既存ファイルからも消える", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(SAMPLE, VALUES, {
    author: { enabled: false },
    converted_at: { enabled: false },
  });
  assert.doesNotMatch(next, /^author:/m);
  assert.doesNotMatch(next, /^converted_at:/m);
  assert.match(next, /^title: /m, "他の項目まで消しています");
});

test("改名すると、旧名の行が増えずに付け替わる", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(SAMPLE, VALUES, {
    published: { name: "published_at", pendingOldName: "published" },
    tags: { name: "note_tags", pendingOldName: "tags" },
  });
  assert.match(next, /^published_at: 2026-01-01T19:19:18$/m);
  assert.doesNotMatch(next, /^published:/m, "旧名が残っています（二重登録）");
  assert.match(next, /^note_tags:$/m);
  assert.doesNotMatch(next, /^tags:$/m);
  assert.match(next, /^ {2}- エンジニア$/m, "引き継いだ値が失われています");
});

test("改名しても並び順は項目のまま", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(SAMPLE, VALUES, {
    published: { name: "zzz_published" },
    tags: { name: "aaa_tags" },
  });
  const keys = frontmatterLines(next)
    .filter((line) => /^[a-z_]/.test(line))
    .map((line) => line.split(":")[0]);
  assert.equal(keys[4], "zzz_published");
  assert.equal(keys.at(-2), "aaa_tags");
});

test("既定名のファイルも、改名後の設定で 1 回の更新で揃う", () => {
  const lib = loadLikeCount();
  // 保留が無くても既定名は常に照合候補に含まれる
  const next = lib.applyStatsToContent(SAMPLE, VALUES, { published: { name: "published_at" } });
  assert.match(next, /^published_at: /m);
  assert.doesNotMatch(next, /^published:/m);
});

test("note_id は設定を無視して常に出力する", () => {
  const lib = loadLikeCount();
  const next = lib.applyStatsToContent(SAMPLE, VALUES, { note_id: { enabled: false, name: "nid" } });
  assert.match(next, /^note_id: n111$/m);
});

test("書き込み直前の検査は作り直し方式でも効く", () => {
  const lib = loadLikeCount();
  assert.equal(lib.buildUpdatedContentWithStats(SAMPLE, "n111.md", "n111", VALUES).status, "ok");

  const mismatch = lib.buildUpdatedContentWithStats(SAMPLE, "n111.md", "n999", VALUES);
  assert.equal(mismatch.status, "mismatch");
  assert.equal(mismatch.content, SAMPLE, "内容を変えてはいけません");

  const applied = lib.buildUpdatedContentWithStats(SAMPLE, "n111.md", "n111", VALUES).content;
  assert.equal(
    lib.buildUpdatedContentWithStats(applied, "n111.md", "n111", VALUES).status,
    "unchanged"
  );
});

/* ---------------------------- 項目の切り出し ---------------------------- */

test("ぶら下がる行を直前の項目に含めて切り出す", () => {
  const lib = loadLikeCount();
  const entries = lib.parseFrontmatterEntries(
    ["title: a", "tags:", "  - x", "  - y", "note_id: n1"].join("\n")
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(entries)).map((entry) => [entry.key, entry.lines.length]),
    [
      ["title", 1],
      ["tags", 3],
      ["note_id", 1],
    ]
  );
});

/* ---------------------- 公開日時（API からの取得） ---------------------- */

test("API の応答からスキ数・公開日時・タイトル・著者をまとめて取る", async () => {
  const calls = [];
  const lib = loadLikeCount();
  const summary = await lib.fetchNoteSummary("n111", async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({
        data: {
          like_count: 46,
          publish_at: "2026-06-04T19:19:18.000+09:00",
          name: "記事タイトル",
          user: { urlname: "hanaviye" },
          note_url: "https://note.com/hanaviye/n/n111",
        },
      }),
    };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    likeCount: 46,
    publishedAt: "2026-06-04T19:19:18",
    title: "記事タイトル",
    author: "hanaviye",
    source: "https://note.com/hanaviye/n/n111",
  });
  assert.equal(calls.length, 1, "通信を増やしてはいけません");
});

test("欠けているフィールドは null にする", async () => {
  const lib = loadLikeCount();
  const summary = await lib.fetchNoteSummary("n111", async () => ({
    ok: true,
    json: async () => ({ data: { like_count: 1, publish_at: "いつか" } }),
  }));
  assert.equal(summary.publishedAt, null);
  assert.equal(summary.title, null);
  assert.equal(summary.author, null);
  assert.equal(summary.likeCount, 1);
});

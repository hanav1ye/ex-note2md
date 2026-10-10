/**
 * frontmatter の項目定義と設定（lib/frontmatterKeys.js）のテスト。
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readSource } from "./helpers/env.mjs";

/**
 * vm コンテキストで作られた値を、テスト側の素のオブジェクト／配列へ写す。
 * realm が違うと deepEqual が「構造は同じだが別物」と判定するため。
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** lib/frontmatterKeys.js を評価して NtmFrontmatterKeys を返す。 */
const loadKeys = () => {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readSource("lib", "frontmatterKeys.js"), context);
  return context.NtmFrontmatterKeys;
};

/* -------------------------------- 既定値 -------------------------------- */

test("未設定なら全項目が既定名で出力される", () => {
  const keys = loadKeys();
  const config = keys.normalizeConfig(undefined);
  assert.deepEqual(
    plain(keys.enabledKeys(config).map((entry) => entry.name)),
    [
      "title",
      "source",
      "note_id",
      "author",
      "published",
      "like_count",
      "page_view_count",
      "impression_count",
      "stats_updated_at",
      "tags",
      "converted_at",
    ]
  );
});

test("出力順は定義順に固定され、改名しても位置が動かない", () => {
  const keys = loadKeys();
  const config = keys.normalizeConfig({ tags: { name: "note_tags" }, published: { name: "published_at" } });
  const names = keys.enabledKeys(config).map((entry) => entry.name);
  assert.equal(names[4], "published_at", "published の位置が動いています");
  assert.equal(names[9], "note_tags", "tags の位置が動いています");
});

test("壊れた設定でも既定へ倒す", () => {
  const keys = loadKeys();
  const config = keys.normalizeConfig({
    title: { name: "has space", enabled: "yes" },
    author: { name: "" },
    published: null,
  });
  assert.equal(config.title.name, "title", "不正な名前は既定へ戻す必要があります");
  assert.equal(config.title.enabled, true);
  assert.equal(config.author.name, "author");
  assert.equal(config.published.name, "published");
});

/* ----------------------------- 固定キー ----------------------------- */

test("note_id は無効化も改名もできない", () => {
  const keys = loadKeys();
  const config = keys.normalizeConfig({ note_id: { enabled: false, name: "nid" } });
  assert.equal(config.note_id.enabled, true, "note_id を無効化できてはいけません");
  assert.equal(config.note_id.name, "note_id", "note_id を改名できてはいけません");
  assert.deepEqual(plain(keys.validateName("nid", { id: "note_id" })), { ok: false, reason: "fixed" });
});

test("note_id 以外は無効化できる", () => {
  const keys = loadKeys();
  const config = keys.normalizeConfig({ author: { enabled: false }, converted_at: { enabled: false } });
  const ids = keys.enabledKeys(config).map((entry) => entry.id);
  assert.equal(ids.includes("author"), false);
  assert.equal(ids.includes("converted_at"), false);
  assert.equal(ids.includes("note_id"), true);
});

/* ------------------------------ 名前の検証 ------------------------------ */

test("使える名前と使えない名前を見分ける", () => {
  const keys = loadKeys();
  const ok = ["published_at", "_private", "a", "a-b", "x1", "a".repeat(20)];
  for (const name of ok) {
    assert.deepEqual(plain(keys.validateName(name, { id: "published" })), { ok: true }, `${name} は使えるはずです`);
  }
  const ng = [
    ["", "empty"],
    ["   ", "empty"],
    ["a".repeat(21), "too-long"],
    ["1abc", "format"],
    ["-abc", "format"],
    ["has space", "format"],
    ["with:colon", "format"],
    ["公開日", "format"],
    ["with\nnewline", "format"],
  ];
  for (const [name, reason] of ng) {
    assert.deepEqual(
      plain(keys.validateName(name, { id: "published" })),
      { ok: false, reason },
      `${JSON.stringify(name)} は弾くはずです`
    );
  }
});

test("他の項目と同じ名前にはできない", () => {
  const keys = loadKeys();
  const config = keys.normalizeConfig(undefined);
  assert.deepEqual(plain(keys.validateName("author", { id: "published", config })), {
    ok: false,
    reason: "duplicate",
  });
  // 自分自身の現在名は重複ではない
  assert.deepEqual(plain(keys.validateName("published", { id: "published", config })), { ok: true });
});

test("Obsidian が特別扱いする名前は警告の対象になる", () => {
  const keys = loadKeys();
  assert.equal(keys.isReservedName("aliases", "published"), true);
  assert.equal(keys.isReservedName("tags", "published"), true);
  assert.equal(keys.isReservedName("tags", "tags"), false, "既定名のままなら警告しません");
  assert.equal(keys.isReservedName("published_at", "published"), false);
});

/* ---------------------------- 改名と保留 ---------------------------- */

test("改名すると旧名が保留される", () => {
  const keys = loadKeys();
  const config = keys.applyRename(keys.normalizeConfig(undefined), "tags", "note_tags");
  assert.equal(config.tags.name, "note_tags");
  assert.equal(config.tags.pendingOldName, "tags");
});

test("保留が残っているうちに再度改名しても、最初の旧名を保持する", () => {
  const keys = loadKeys();
  // 実ファイルに残っているのは最初の名前なので、そちらを覚えておく必要がある
  let config = keys.applyRename(keys.normalizeConfig(undefined), "tags", "note_tags");
  config = keys.applyRename(config, "tags", "article_tags");
  assert.equal(config.tags.name, "article_tags");
  assert.equal(config.tags.pendingOldName, "tags", "最初の旧名を保持する必要があります");
});

test("反映が終われば保留を捨てる", () => {
  const keys = loadKeys();
  const renamed = keys.applyRename(keys.normalizeConfig(undefined), "tags", "note_tags");
  const cleared = keys.clearPending(renamed);
  assert.equal(cleared.tags.pendingOldName, null);
  assert.equal(cleared.tags.name, "note_tags", "名前は維持されます");
});

test("照合には現在名・保留中の旧名・既定名を使う", () => {
  const keys = loadKeys();
  const config = keys.applyRename(keys.normalizeConfig(undefined), "tags", "note_tags");
  const names = keys.matchNamesFor(config, "tags");
  assert.deepEqual(plain(names).sort(), ["note_tags", "tags"]);

  // 既定名は常に含める（この機能より前のファイルも揃うようにするため）
  const renamedTwice = keys.applyRename(keys.clearPending(config), "tags", "article_tags");
  assert.equal(keys.matchNamesFor(renamedTwice, "tags").includes("tags"), true);
});

/* ---------------------------- 反映待ちの一覧 ---------------------------- */

test("反映待ちの変更を、改名と非表示に分けて並べる", () => {
  const keys = loadKeys();
  let config = keys.applyRename(keys.normalizeConfig(undefined), "published", "published_at");
  config = keys.applyEnabled(config, "author", false);

  assert.deepEqual(plain(keys.listPendingChanges(config)), [
    { id: "author", type: "disable", from: "author", to: null },
    { id: "published", type: "rename", from: "published", to: "published_at" },
  ]);
});

test("既定のままなら反映待ちは何も無い", () => {
  const keys = loadKeys();
  assert.deepEqual(plain(keys.listPendingChanges(keys.normalizeConfig(undefined))), []);
});

test("出力をやめた項目も、反映が終われば反映待ちから消える", () => {
  // 無効であること自体は設定の状態なので、待ち続けてはいけない
  const keys = loadKeys();
  const disabled = keys.applyEnabled(keys.normalizeConfig(undefined), "author", false);
  assert.deepEqual(plain(keys.listPendingChanges(disabled)), [
    { id: "author", type: "disable", from: "author", to: null },
  ]);
  assert.deepEqual(plain(keys.listPendingChanges(keys.clearPending(disabled))), []);
});

test("出力をやめてすぐ戻したら、反映待ちにしない", () => {
  const keys = loadKeys();
  let config = keys.applyEnabled(keys.normalizeConfig(undefined), "author", false);
  config = keys.applyEnabled(config, "author", true);
  assert.deepEqual(plain(keys.listPendingChanges(config)), []);
});

test("出力をやめた項目は、旧名でも照合できる", () => {
  // 改名したあとに出力をやめても、ファイルに残っている行を見つけられる必要がある
  const keys = loadKeys();
  let config = keys.applyRename(keys.normalizeConfig(undefined), "author", "writer");
  config = keys.clearPending(config);
  config = keys.applyEnabled(config, "author", false);
  const names = keys.matchNamesFor(config, "author");
  assert.equal(names.includes("writer"), true, "いまの名前で照合できません");
  assert.equal(names.includes("author"), true, "既定名で照合できません");
});

test("note_id は applyEnabled でも無効にできない", () => {
  const keys = loadKeys();
  const config = keys.applyEnabled(keys.normalizeConfig(undefined), "note_id", false);
  assert.equal(config.note_id.enabled, true);
});

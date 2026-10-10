/**
 * 変換オプションの組み立て（lib/conversionOptions.js）のテスト。
 *
 * 以前は popup / 選択モード / 現在のタブ の 3 か所に同じ組み立てが書かれており、
 * frontmatter のキー設定を足したときに 2 か所取りこぼした。ここを 1 つに保つ。
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readSource } from "./helpers/env.mjs";

/**
 * lib/conversionOptions.js を評価する。
 * @param {object} [store={}] - chrome.storage.local の中身。
 */
const loadOptionsBuilder = (store = {}) => {
  const context = {
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            const result = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
              if (key in store) {
                result[key] = store[key];
              }
            });
            return result;
          },
        },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readSource("lib", "frontmatterKeys.js"), context);
  vm.runInContext(readSource("lib", "conversionOptions.js"), context);
  return context.NtmConversionOptions;
};

const plain = (value) => JSON.parse(JSON.stringify(value));

test("保存済みの設定をまとめて返す", async () => {
  const builder = loadOptionsBuilder({
    obsidianLinkify: true,
    presetObsidianLinkWords: ["Obsidian", " Markdown ", ""],
    frontmatterKeys: { published: { enabled: true, name: "published_at" } },
  });
  const options = await builder.build({ tags: ["学習メモ"] });

  assert.deepEqual(plain(options), {
    tags: ["学習メモ"],
    obsidianLinkify: true,
    obsidianLinkWords: ["Obsidian", "Markdown"],
    frontmatterKeys: { published: { enabled: true, name: "published_at" } },
  });
});

test("frontmatter のキー設定を必ず含める", async () => {
  // ここが抜けると、設定が更新時にしか効かなくなる
  const builder = loadOptionsBuilder({ frontmatterKeys: { author: { enabled: false } } });
  const options = await builder.build({ tags: [] });
  assert.deepEqual(plain(options.frontmatterKeys), { author: { enabled: false } });
});

test("リンク化の指定は、呼び出し側があれば優先する", async () => {
  // 選択モードは開始時の指定を引き継ぐため
  const builder = loadOptionsBuilder({ obsidianLinkify: true });
  assert.equal((await builder.build({ obsidianLinkify: false })).obsidianLinkify, false);
  assert.equal((await builder.build({ obsidianLinkify: true })).obsidianLinkify, true);
  // 省略したら保存済みの設定に従う
  assert.equal((await builder.build({})).obsidianLinkify, true);
});

test("設定が何も保存されていなくても壊れない", async () => {
  const builder = loadOptionsBuilder({});
  const options = await builder.build({});
  assert.deepEqual(plain(options), {
    tags: [],
    obsidianLinkify: false,
    obsidianLinkWords: [],
  });
});

test("storage が使えない環境でも既定を返す", async () => {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readSource("lib", "conversionOptions.js"), context);
  const options = await context.NtmConversionOptions.build({ tags: ["a"] });
  assert.deepEqual(plain(options), { tags: ["a"], obsidianLinkify: false, obsidianLinkWords: [] });
});

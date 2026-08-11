/**
 * 表示言語モジュール（lib/i18n.js）のテスト。
 * ロケール判定・設定による上書き・DOM への適用を検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { flush, readSource } from "./helpers/env.mjs";

/**
 * lib/i18n.js だけを評価した環境を作る。
 * @param {{uiLanguage?: string, store?: object}} [options={}] - ブラウザ言語と保存値。
 * @returns {{i18n: object, store: object}} 実行環境。
 */
const loadI18n = ({ uiLanguage = "ja", store = {} } = {}) => {
  const context = {
    chrome: {
      i18n: { getUILanguage: () => uiLanguage },
      storage: {
        local: {
          get: async (keys) => {
            const result = {};
            keys.forEach((key) => {
              if (key in store) {
                result[key] = store[key];
              }
            });
            return result;
          },
          set: async (values) => Object.assign(store, values),
        },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readSource("lib", "i18n.js"), context);
  return { i18n: context.NtmI18n, store };
};

test("初期化前でもブラウザの表示言語で解決する", () => {
  assert.equal(loadI18n({ uiLanguage: "ja" }).i18n.getLocale(), "ja");
  assert.equal(loadI18n({ uiLanguage: "en-US" }).i18n.getLocale(), "en");
  // 未対応の言語は英語に寄せる
  assert.equal(loadI18n({ uiLanguage: "fr" }).i18n.getLocale(), "en");
});

test("保存された言語設定がブラウザの言語より優先される", async () => {
  const { i18n } = loadI18n({ uiLanguage: "ja", store: { uiLanguage: "en" } });
  await i18n.init();

  assert.equal(i18n.getSetting(), "en");
  assert.equal(i18n.getLocale(), "en");
  assert.equal(i18n.t("popup.convert"), "Convert");
});

test("自動設定ならブラウザの言語に従う", async () => {
  const { i18n } = loadI18n({ uiLanguage: "ja", store: { uiLanguage: "auto" } });
  await i18n.init();
  assert.equal(i18n.getLocale(), "ja");
  assert.equal(i18n.t("popup.convert"), "変換");
});

test("不正な保存値は自動として扱う", async () => {
  const { i18n } = loadI18n({ uiLanguage: "en", store: { uiLanguage: "de" } });
  await i18n.init();
  assert.equal(i18n.getSetting(), "auto");
  assert.equal(i18n.getLocale(), "en");
});

test("setLanguage は保存と現在ロケールの両方を更新する", async () => {
  const { i18n, store } = loadI18n({ uiLanguage: "ja" });
  await i18n.init();
  assert.equal(i18n.getLocale(), "ja");

  await i18n.setLanguage("en");
  assert.equal(store.uiLanguage, "en");
  assert.equal(i18n.getLocale(), "en");
  // init 済みでも、以降の init が古い値へ巻き戻らないこと
  assert.equal(await i18n.init(), "en");
});

test("プレースホルダを置換する", () => {
  const { i18n } = loadI18n({ uiLanguage: "ja" });
  assert.equal(i18n.t("content.panel.count", { count: 3 }), "選択中: 3件");
  // 値を渡さないプレースホルダはそのまま残す
  assert.match(i18n.t("content.panel.count"), /\{count\}/);
});

test("未定義キーは日本語、それも無ければキー自身へフォールバックする", () => {
  const { i18n } = loadI18n({ uiLanguage: "en" });
  assert.equal(i18n.t("存在しないキー"), "存在しないキー");
});

test("ja / en のメッセージキーが揃っている", () => {
  const { i18n: ja } = loadI18n({ uiLanguage: "ja" });
  const { i18n: en } = loadI18n({ uiLanguage: "en" });

  // カタログは非公開なので、既知のキーを両ロケールで引いて差分がないことを確かめる
  const keys = [
    "popup.convert",
    "popup.tags.none",
    "options.transfer.export",
    "content.panel.run",
    "background.imageUrlNotAllowed",
    "error.presetFolderRequired",
  ];
  keys.forEach((key) => {
    assert.notEqual(ja.t(key), key, `ja に ${key} がありません`);
    assert.notEqual(en.t(key), key, `en に ${key} がありません`);
    assert.notEqual(ja.t(key), en.t(key), `${key} が両ロケールで同じ文言です`);
  });
});

test("applyDom が data-i18n 属性の要素を置き換える", async () => {
  const dom = new JSDOM(
    `<!doctype html><html lang="ja"><body>
      <h1 data-i18n="popup.convert">変換</h1>
      <input data-i18n-placeholder="options.tag.placeholder" />
      <button data-i18n-title="popup.settings" data-i18n-aria-label="popup.settings"></button>
    </body></html>`,
    { runScripts: "outside-only" }
  );
  const win = dom.window;
  win.chrome = {
    i18n: { getUILanguage: () => "ja" },
    storage: { local: { get: async () => ({ uiLanguage: "en" }) } },
  };
  win.eval(readSource("lib", "i18n.js"));

  await win.NtmI18n.init();
  win.NtmI18n.applyDom(win.document);
  await flush();

  assert.equal(win.document.querySelector("h1").textContent, "Convert");
  assert.equal(win.document.querySelector("input").placeholder, "e.g. study-notes");
  assert.equal(win.document.querySelector("button").getAttribute("title"), "Settings");
  assert.equal(win.document.querySelector("button").getAttribute("aria-label"), "Settings");
  assert.equal(win.document.documentElement.lang, "en", "html の lang が更新されていません");
});

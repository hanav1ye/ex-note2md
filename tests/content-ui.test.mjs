/**
 * content script のページ内UIと選択モードのテスト。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { flush, readSource } from "./helpers/env.mjs";

const PAGE_HTML = `<!doctype html><html><body>
<div class="mx-auto w-full max-w-[var(--size-content)]">
  <a href="/hanaviye/n/n111">記事1</a>
  <a href="/hanaviye/n/n222">記事2</a>
  <a href="/hanaviye/n/n333">プロフィール</a>
  <a href="/hanaviye">ホーム</a>
</div>
</body></html>`;

/**
 * content script を読み込んだページ環境を作る。
 * @param {{store?: object, html?: string}} [options={}] - chrome.storage.local の初期値とページHTML。
 * @returns {{win: import("jsdom").DOMWindow, send: Function, downloads: string[]}} テスト環境。
 */
const loadContentScript = ({ store = {}, html = PAGE_HTML } = {}) => {
  const dom = new JSDOM(html, {
    url: "https://note.com/hanaviye",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window;
  // jsdom はレイアウトを行わず矩形が常に 0 になるため、可視判定用に最小限の矩形を返す
  win.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 };
  };
  const downloads = [];
  let listener = null;

  win.chrome = {
    i18n: { getUILanguage: () => "ja" },
    runtime: {
      id: "test-extension-id",
      sendMessage: async (message) => {
        if (message.type === "downloadMarkdownByPreset") {
          downloads.push(message.articleUrl);
          await flush(20);
          return { ok: true, filename: "saved.md", overwritten: false };
        }
        return { ok: true };
      },
      onMessage: {
        addListener: (fn) => {
          listener = fn;
        },
      },
    },
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
  };

  win.NoteToMarkdown = {
    isNoteArticleUrl: (url, base) => {
      try {
        const parsed = new win.URL(url, base);
        return parsed.hostname === "note.com" && /\/n\/[^/]+/.test(parsed.pathname);
      } catch {
        return false;
      }
    },
    extractNoteIdFromUrl: (url) => (url.match(/\/n\/([^/]+)/) ?? [])[1] ?? "",
    noteFolderNameFromUrl: (url) => (url.match(/\/n\/([^/]+)/) ?? [])[1] ?? "note-article",
    fetchWithTimeout: async () => ({
      ok: true,
      status: 200,
      text: async () => "<html><body></body></html>",
    }),
    convertNotePageToMarkdown: () => ({ title: "記事", markdown: "# 記事", metadata: {} }),
    processMarkdownImages: async (markdown) => ({ markdown, images: [] }),
    extractTitleFromDocument: () => "記事",
  };

  win.eval(readSource("lib", "i18n.js"));
  win.eval(readSource("content", "content.js"));

  const send = (message, sender = { id: "test-extension-id" }) =>
    new Promise((resolve) => {
      const handled = listener(message, sender, resolve);
      if (handled !== true) {
        resolve(undefined);
      }
    });

  return { win, send, downloads };
};

const shadowOf = (win) => win.document.getElementById("ntm-ui-root")?.shadowRoot ?? null;
const clickLink = (win, href) =>
  win.document
    .querySelector(`a[href="${href}"]`)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
const pressEscape = (win) =>
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

/* ------------------------------- Shadow DOM ------------------------------- */

test("ページ内UIは Shadow DOM に隔離される", async () => {
  const { win, send } = loadContentScript();
  await send({ type: "startLinkPickMode", outputMode: "download", downloadPreset: "preset1", tags: [] });

  const host = win.document.getElementById("ntm-ui-root");
  assert.ok(host.shadowRoot, "Shadow Root が生成されていません");
  assert.equal(win.document.querySelector(".toast"), null, "トーストがページ本体に露出しています");
  assert.ok(host.shadowRoot.querySelector(".toast"), "トーストが Shadow 内にありません");
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.panel button/);
  assert.equal(host.style.pointerEvents, "none", "ホストがページ操作を遮っています");
});

/* ------------------------------- 単体選択 -------------------------------- */

test("Esc で単体選択モードを終了できる", async () => {
  const { win, send, downloads } = loadContentScript();
  await send({ type: "startLinkPickMode", outputMode: "download", downloadPreset: "preset1", tags: [] });
  assert.equal(win.document.body.style.cursor, "crosshair");

  pressEscape(win);
  await flush();

  assert.notEqual(win.document.body.style.cursor, "crosshair");
  clickLink(win, "/hanaviye/n/n111");
  await flush(60);
  assert.equal(downloads.length, 0, "終了後のクリックで変換が走っています");
});

test("リンク選択後は content script 側で変換を実行する", async () => {
  const { win, send, downloads } = loadContentScript();
  await send({ type: "startLinkPickMode", outputMode: "download", downloadPreset: "preset1", tags: [] });

  clickLink(win, "/hanaviye/n/n111");
  await flush(120);

  assert.deepEqual(downloads, ["https://note.com/hanaviye/n/n111"]);
});

test("記事リンク以外のクリックでは変換しない", async () => {
  const { win, send, downloads } = loadContentScript();
  await send({ type: "startLinkPickMode", outputMode: "download", downloadPreset: "preset1", tags: [] });

  clickLink(win, "/hanaviye");
  await flush(60);

  assert.equal(downloads.length, 0);
});

/* ------------------------------- 複数選択 -------------------------------- */

test("複数選択の追加と解除ができる", async () => {
  const { win, send } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  clickLink(win, "/hanaviye/n/n111");
  clickLink(win, "/hanaviye/n/n222");
  await flush();
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "選択中: 2件");

  clickLink(win, "/hanaviye/n/n111");
  await flush();
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "選択中: 1件");
});

test("一覧を全選択でプロフィールリンクを除外する", async () => {
  const { win, send } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  shadowOf(win)
    .querySelector('[data-role="select-visible"]')
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush();

  const items = [...shadowOf(win).querySelectorAll(".panel-list div")].map((el) => el.textContent);
  assert.equal(items.length, 2);
  assert.ok(!items.some((text) => text.includes("プロフィール")));
});

test("一括実行を中止すると未処理分だけが残り再実行できる", async () => {
  const { win, send, downloads } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  clickLink(win, "/hanaviye/n/n111");
  clickLink(win, "/hanaviye/n/n222");
  await flush();

  const runBtn = shadowOf(win).querySelector('[data-role="run"]');
  runBtn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush(15);
  assert.equal(runBtn.textContent, "中止", "実行中は中止ボタンになっていません");

  runBtn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(runBtn.textContent, "中止中...");
  await flush(400);

  assert.equal(downloads.length, 1, "中止後も処理が続いています");
  assert.ok(shadowOf(win).querySelector(".panel"), "中止時はパネルを残すべきです");
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "選択中: 1件");
  assert.equal(shadowOf(win).querySelector('[data-role="run"]').textContent, "実行");

  shadowOf(win)
    .querySelector('[data-role="run"]')
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush(300);

  assert.equal(downloads.length, 2);
  assert.match(downloads[1], /n222$/);
  assert.equal(shadowOf(win).querySelector(".panel"), null, "完走後はパネルを閉じるべきです");
});

test("実行中の Esc は終了ではなく中止として扱う", async () => {
  const { win, send, downloads } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  clickLink(win, "/hanaviye/n/n111");
  clickLink(win, "/hanaviye/n/n222");
  await flush();

  shadowOf(win)
    .querySelector('[data-role="run"]')
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush(15);
  pressEscape(win);
  await flush(400);

  assert.equal(downloads.length, 1);
  assert.ok(shadowOf(win).querySelector(".panel"), "Esc で中止した際にパネルまで閉じています");
});

test("Esc で複数選択モードを終了できる", async () => {
  const { win, send } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  assert.ok(shadowOf(win).querySelector(".panel"));

  pressEscape(win);
  await flush();

  assert.equal(shadowOf(win).querySelector(".panel"), null);
  assert.notEqual(win.document.body.style.cursor, "crosshair");
});

/* ------------------------------ モード切替 ------------------------------- */

test("複数選択から単体選択へ切り替えると複数選択が完全に終了する", async () => {
  const { win, send, downloads } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  clickLink(win, "/hanaviye/n/n111");
  await flush();
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "選択中: 1件");

  // 複数選択モードのまま「選択する」を実行する
  await send({ type: "startLinkPickMode", outputMode: "download", downloadPreset: "preset1", tags: [] });
  await flush();

  assert.equal(shadowOf(win).querySelector(".panel"), null, "複数選択パネルが残っています");

  // 単体選択として動作し、複数選択のトグルにならないこと
  clickLink(win, "/hanaviye/n/n222");
  await flush(150);

  assert.deepEqual(downloads, ["https://note.com/hanaviye/n/n222"]);
  assert.equal(shadowOf(win).querySelector(".panel"), null);
});

test("単体選択から複数選択へ切り替えても単体選択のハンドラが残らない", async () => {
  const { win, send, downloads } = loadContentScript();
  await send({ type: "startLinkPickMode", outputMode: "download", downloadPreset: "preset1", tags: [] });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  await flush();

  clickLink(win, "/hanaviye/n/n111");
  await flush(150);

  // 複数選択として選択されるだけで、変換は実行されない
  assert.equal(downloads.length, 0, "単体選択の変換が走っています");
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "選択中: 1件");
});

test("モードを切り替えてもカーソルが元に戻る", async () => {
  const { win, send } = loadContentScript();
  win.document.body.style.cursor = "auto";

  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  assert.equal(win.document.body.style.cursor, "crosshair");

  await send({ type: "startLinkPickMode", outputMode: "copy", downloadPreset: "preset1", tags: [] });
  assert.equal(win.document.body.style.cursor, "crosshair");

  pressEscape(win);
  await flush();
  assert.equal(win.document.body.style.cursor, "auto", "crosshair のまま戻っていません");
});

test("モード切替で前のモードの選択内容とホバー枠線が残らない", async () => {
  const { win, send } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  const anchor = win.document.querySelector('a[href="/hanaviye/n/n111"]');
  anchor.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true }));
  clickLink(win, "/hanaviye/n/n111");
  await flush();
  assert.notEqual(anchor.style.outline, "", "ホバー枠線が付いていません");

  await send({ type: "startLinkPickMode", outputMode: "copy", downloadPreset: "preset1", tags: [] });
  await flush();
  assert.equal(anchor.style.outline, "", "ホバー枠線が残っています");

  // 複数選択へ戻したときに前回の選択が残っていないこと
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  await flush();
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "選択中: 0件");
});

test("同じモードを二重に開始しても状態を壊さない", async () => {
  const { win, send } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  clickLink(win, "/hanaviye/n/n111");
  await flush();

  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  await flush();

  assert.equal(
    shadowOf(win).querySelector(".panel-count").textContent,
    "選択中: 1件",
    "同一モードの再開始で選択が失われています"
  );
});

test("一括処理の実行中はモード切替を受け付けない", async () => {
  const { win, send } = loadContentScript();
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  clickLink(win, "/hanaviye/n/n111");
  clickLink(win, "/hanaviye/n/n222");
  await flush();

  shadowOf(win)
    .querySelector('[data-role="run"]')
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush(15);

  const response = await send({
    type: "startLinkPickMode",
    outputMode: "download",
    downloadPreset: "preset1",
    tags: [],
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /一括処理を実行中/);
  assert.ok(shadowOf(win).querySelector(".panel"), "実行中のパネルが消えています");

  // 実行は継続する
  await flush(600);
  assert.equal(shadowOf(win).querySelector(".panel"), null, "完走後はパネルを閉じるべきです");
});

/* -------------------------------- 表示言語 -------------------------------- */

test("保存済みの言語設定でページ上UIを英語表示にする", async () => {
  const { win, send } = loadContentScript({ store: { uiLanguage: "en" } });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  assert.equal(shadowOf(win).querySelector(".toast").textContent, "Multi-select mode started. Click article links (Esc to exit).");
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "Selected: 0");
  assert.equal(shadowOf(win).querySelector('[data-role="run"]').textContent, "Run");
  assert.equal(shadowOf(win).querySelector(".panel-hint").textContent, "Esc to exit");
});

test("モード開始のたびに言語設定を読み直す", async () => {
  const store = {};
  const { win, send } = loadContentScript({ store });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  assert.equal(shadowOf(win).querySelector('[data-role="exit"]').textContent, "終了");

  // 別タブのオプション画面で言語を変えた状況を再現する
  store.uiLanguage = "en";
  await send({ type: "startLinkPickMode", outputMode: "copy", downloadPreset: "preset1", tags: [] });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  assert.equal(shadowOf(win).querySelector('[data-role="exit"]').textContent, "Exit");
});

/* ------------------------------ メッセージ検証 ---------------------------- */

test("他の拡張機能からのメッセージは処理しない", async () => {
  const { win, send } = loadContentScript();
  await send(
    { type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] },
    { id: "other-extension-id" }
  );
  assert.equal(shadowOf(win), null);
});

test("記事ページ以外でのタイトル取得はエラーを返す", async () => {
  const { send } = loadContentScript();
  const response = await send({ type: "getArticleTitle" });
  assert.equal(response.ok, false);
  assert.match(response.error, /記事ページ/);
});

/* ------------------------------ マガジンページ ------------------------------ */

/**
 * マガジンページの実際の構造を模したHTML。
 * 記事カードは「カード全面を覆う空の <a>」と「隣の <h3>」で作られ、
 * クリエイターページの一覧コンテナ（mx-auto w-full …）は存在しない。
 * 1枚のカードに同じ記事へのリンクが2本ある点も実物どおり。
 */
const MAGAZINE_HTML = `<!doctype html><html><body>
<header><a href="/csfive">クリエイター</a></header>
<main>
  <div class="grid grid-cols-1 md:grid-cols-3">
    <div class="card">
      <a class="absolute inset-0" href="/csfive/n/naaa111"></a>
      <div class="thumb"><a class="absolute inset-0" href="/csfive/n/naaa111"></a></div>
      <h3>Obsidian を始める前に読む話</h3>
      <p>本文の抜粋</p>
    </div>
    <div class="card">
      <a class="absolute inset-0" href="/csfive/n/nbbb222"></a>
      <h3>デイリーノートの運用</h3>
    </div>
    <div class="card">
      <a class="absolute inset-0" href="/csfive/n/nccc333"></a>
      <h3>プロフィール</h3>
    </div>
  </div>
</main>
</body></html>`;

test("マガジンページでは空のカードリンクからでも見出しをタイトルにする", async () => {
  const { win, send } = loadContentScript({ html: MAGAZINE_HTML });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  clickLink(win, "/csfive/n/naaa111");
  clickLink(win, "/csfive/n/nbbb222");
  await flush();

  const items = [...shadowOf(win).querySelectorAll(".panel-list div")].map((el) => el.textContent);
  assert.deepEqual(items, ["1. Obsidian を始める前に読む話", "2. デイリーノートの運用"]);
  assert.ok(!items.some((text) => text.includes("タイトル不明")), "タイトルが解決できていません");
});

test("マガジンページでも一覧を全選択できる", async () => {
  const { win, send } = loadContentScript({ html: MAGAZINE_HTML });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  shadowOf(win)
    .querySelector('[data-role="select-visible"]')
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush();

  const items = [...shadowOf(win).querySelectorAll(".panel-list div")].map((el) => el.textContent);
  // 同じ記事への2本目のリンクで重複せず、プロフィールは除外される
  assert.deepEqual(items, ["1. Obsidian を始める前に読む話", "2. デイリーノートの運用"]);
  assert.equal(shadowOf(win).querySelector(".panel-count").textContent, "選択中: 2件");
});

test("隣のカードの見出しを拾わない", async () => {
  // 1枚目のカードに見出しが無い場合、共通の親まで上がって2枚目の見出しを取ってはいけない
  const html = `<!doctype html><html><body><div class="grid">
    <div class="card"><a href="/csfive/n/naaa111"></a></div>
    <div class="card"><a href="/csfive/n/nbbb222"></a><h3>二枚目の見出し</h3></div>
  </div></body></html>`;
  const { win, send } = loadContentScript({ html });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  clickLink(win, "/csfive/n/naaa111");
  await flush();

  const items = [...shadowOf(win).querySelectorAll(".panel-list div")].map((el) => el.textContent);
  assert.deepEqual(items, ["1. （タイトル不明）"]);
});

test("クリエイターページの一覧コンテナは従来どおり優先する", async () => {
  // 従来のコンテナがあるページで、その外にある記事リンクを全選択に含めない
  const html = `<!doctype html><html><body>
    <aside><a href="/hanaviye/n/n999">おすすめ記事</a></aside>
    <div class="mx-auto w-full max-w-[var(--size-content)]">
      <a href="/hanaviye/n/n111">記事1</a>
    </div>
  </body></html>`;
  const { win, send } = loadContentScript({ html });
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });

  shadowOf(win)
    .querySelector('[data-role="select-visible"]')
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush();

  const items = [...shadowOf(win).querySelectorAll(".panel-list div")].map((el) => el.textContent);
  assert.deepEqual(items, ["1. 記事1"]);
});

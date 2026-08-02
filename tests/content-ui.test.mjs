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
 * @returns {{win: import("jsdom").DOMWindow, send: Function, downloads: string[]}} テスト環境。
 */
const loadContentScript = () => {
  const dom = new JSDOM(PAGE_HTML, {
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
    storage: { local: { get: async () => ({}) } },
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

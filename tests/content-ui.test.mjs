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
 * @param {{store?: object, html?: string, noteStats?: object, downloadedNotes?: object}} [options={}]
 *   chrome.storage.local の初期値・ページHTML・差し替える依存。
 *   downloadedNotes は background の listDownloadedNotes の応答、url は開いているページ。
 * @returns {{win: import("jsdom").DOMWindow, send: Function, downloads: string[], downloadedQueries: string[][]}}
 *   テスト環境。downloadedQueries は background へ渡した note_id の記録。
 */
const loadContentScript = ({
  store = {},
  html = PAGE_HTML,
  noteStats,
  downloadedNotes,
  url = "https://note.com/hanaviye",
} = {}) => {
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window;
  // jsdom はレイアウトを行わず矩形が常に 0 になるため、可視判定用に最小限の矩形を返す
  win.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 };
  };
  const downloads = [];
  // listDownloadedNotes で background へ渡した note_id を記録する。
  const downloadedQueries = [];
  let listener = null;

  win.chrome = {
    i18n: { getUILanguage: () => "ja" },
    runtime: {
      id: "test-extension-id",
      sendMessage: async (message) => {
        if (message.type === "listDownloadedNotes") {
          downloadedQueries.push(message.noteIds);
          return downloadedNotes ?? { ok: true, found: {}, unreadable: [], configured: 1 };
        }
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
        set: async (values) => {
          Object.assign(store, values);
        },
      },
    },
  };

  /*
   * 一覧ページの判定（listCreatorFromUrl）は印を出す画面を決める要なので、
   * スタブの写しではなく実物を使う。変換系だけを上から差し替える。
   */
  win.eval(readSource("lib", "noteToMarkdown.js"));
  win.NoteToMarkdown = {
    ...win.NoteToMarkdown,
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
  win.eval(readSource("lib", "frontmatterKeys.js"));
  win.eval(readSource("lib", "conversionOptions.js"));
  if (noteStats) {
    // 既定では実物を読み込まず、ダッシュボード取得だけを差し替える。
    win.NtmNoteStats = noteStats;
  } else {
    win.eval(readSource("lib", "noteStats.js"));
  }
  win.eval(readSource("content", "content.js"));

  const send = (message, sender = { id: "test-extension-id" }) =>
    new Promise((resolve) => {
      const handled = listener(message, sender, resolve);
      if (handled !== true) {
        resolve(undefined);
      }
    });

  return { win, send, downloads, downloadedQueries };
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

/* -------------------------------- 有料記事 -------------------------------- */

const toastText = (win) => shadowOf(win).querySelector(".toast")?.textContent ?? "";

test("有料記事を選択してダウンロードすると、無料公開部分のみである旨をトーストに添える", async () => {
  const { win, send, downloads } = loadContentScript();
  win.NoteToMarkdown.convertNotePageToMarkdown = () => ({
    title: "記事",
    markdown: "# 記事",
    metadata: {},
    paywall: { chars: 4480, images: 5 },
  });
  await send({ type: "startLinkPickMode", outputMode: "download", downloadPreset: "preset1", tags: [] });

  clickLink(win, "/hanaviye/n/n111");
  await flush(120);

  assert.equal(downloads.length, 1);
  assert.match(toastText(win), /ダウンロード完了: 記事（有料記事: 無料公開部分のみ）/);
});

test("一括処理の結果に有料記事の件数を出す", async () => {
  const { win, send } = loadContentScript();
  let call = 0;
  win.NoteToMarkdown.convertNotePageToMarkdown = () => {
    call += 1;
    return { title: `記事${call}`, markdown: "# 記事", metadata: {}, paywall: call === 1 ? { chars: 100, images: null } : null };
  };
  await send({ type: "startMultiLinkPickMode", downloadPreset: "preset1", tags: [] });
  clickLink(win, "/hanaviye/n/n111");
  clickLink(win, "/hanaviye/n/n222");
  await flush();

  shadowOf(win).querySelector('[data-role="run"]').dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await flush(700);

  assert.match(toastText(win), /新規保存 2件 \/ 上書き 0件 \/ 失敗 0件 \/ 有料記事 1件（無料公開部分のみ）/);
});

/* --------------------- ダッシュボードの数値の取得依頼 --------------------- */

test("オプション画面からの依頼で記事別の数値を返す", async () => {
  const { send } = loadContentScript({
    noteStats: {
      fetchAllStats: async () => ({
        ok: true,
        rows: [{ noteId: "n111", pageViewCount: 12, impressionCount: 34 }],
        statsUpdatedAt: "2026-10-05T07:00:00+09:00",
      }),
    },
  });

  const response = await send({ type: "fetchNoteStats" });
  assert.equal(response.ok, true);
  assert.equal(response.rows.length, 1);
  assert.equal(response.rows[0].noteId, "n111");
  assert.equal(response.statsUpdatedAt, "2026-10-05T07:00:00+09:00");
});

test("未ログインなら理由が分かるエラーを返す", async () => {
  const { send } = loadContentScript({
    noteStats: { fetchAllStats: async () => ({ ok: false, code: "not-logged-in" }) },
  });
  const response = await send({ type: "fetchNoteStats" });
  assert.equal(response.ok, false);
  assert.equal(response.code, "not-logged-in");
  assert.match(response.error, /ログインしていない/);
});

test("取得中の例外は失敗として返し、ページを壊さない", async () => {
  const { send } = loadContentScript({
    noteStats: {
      fetchAllStats: async () => {
        throw new Error("network");
      },
    },
  });
  const response = await send({ type: "fetchNoteStats" });
  assert.equal(response.ok, false);
  assert.equal(response.code, "fetch-failed");
  assert.match(response.error, /取得できませんでした/);
});

test("認証切れの例外は未ログインとして扱う", async () => {
  const { send } = loadContentScript({
    noteStats: {
      fetchAllStats: async () => {
        throw new Error("unauthenticated");
      },
    },
  });
  const response = await send({ type: "fetchNoteStats" });
  assert.equal(response.code, "not-logged-in");
});

test("他の拡張機能からの数値取得依頼は処理しない", async () => {
  const { send } = loadContentScript({
    noteStats: { fetchAllStats: async () => ({ ok: true, rows: [], statsUpdatedAt: null }) },
  });
  const response = await send({ type: "fetchNoteStats" }, { id: "other-extension-id" });
  assert.equal(response, undefined);
});

test("ページ上の変換でも frontmatter のキー設定が効く", async () => {
  // 設定が更新時にしか効かず、新しく変換したファイルに反映されない不具合があった
  const env = loadContentScript({ store: { frontmatterKeys: { author: { enabled: false } } } });
  let passedOptions = null;
  env.win.NoteToMarkdown.convertNotePageToMarkdown = (_doc, _url, options) => {
    passedOptions = options;
    return { title: "記事", markdown: "# 記事", metadata: {} };
  };

  await env.send({ type: "convert", tags: [] });

  assert.ok(passedOptions, "変換が呼ばれていません");
  assert.deepEqual(
    JSON.parse(JSON.stringify(passedOptions.frontmatterKeys ?? null)),
    { author: { enabled: false } },
    "保存済みのキー設定が変換へ渡っていません"
  );
});


/* ---------------------- ダウンロード済みの印 ---------------------- */

const marksOf = (win) => [...(shadowOf(win)?.querySelectorAll(".dl-mark") ?? [])];

/**
 * ダッシュボードが「自分の記事」として返す集合をスタブする。
 * 持ち主の判定はこれが担保なので、テストでもここを動かして確かめる。
 * @param {...string} noteIds - 自分の記事の note_id。
 * @returns {object} NtmNoteStats の差し替え。
 */
const ownNotes = (...noteIds) => ({
  calls: 0,
  async fetchAllStats() {
    this.calls += 1;
    return { ok: true, rows: noteIds.map((noteId) => ({ noteId })), statsUpdatedAt: null };
  },
});

/* 既定では、一覧に出てくる記事がすべて自分のものだとしておく。 */
const OWN = () => ownNotes("n111", "n222", "n315470bf18a2", "n0f8ab9693bca");

test("保存済みの記事にだけ印を付ける", async () => {
  const { win, send } = loadContentScript({
    noteStats: OWN(),
    downloadedNotes: {
      ok: true,
      found: { n111: ["Obsidian"] },
      unreadable: [],
      configured: 1,
    },
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.equal(response.ok, true);
  assert.equal(response.total, 2, "一覧の記事数が合いません");
  assert.equal(response.marked, 1, "印を付けた件数が合いません");
  const marks = marksOf(win);
  assert.equal(marks.length, 1, "保存していない記事にも印が付いています");
  assert.match(marks[0].title, /Obsidian/, "保存先フォルダ名が hover に出ていません");
  assert.equal(win.document.querySelector(".dl-mark"), null, "印がページ本体に露出しています");
});

test("除外する一覧項目は問い合わせない", async () => {
  // プロフィール・仕事依頼は記事ではないため、保存先を調べる対象から外す
  const { send, downloadedQueries } = loadContentScript({ noteStats: OWN() });

  await send({ type: "showDownloadedMarks" });

  assert.deepEqual([...downloadedQueries[0]].sort(), ["n111", "n222"]);
});

test("同じ記事への複数のリンクは1回だけ問い合わせ、どちらにも印を付ける", async () => {
  const html = `<!doctype html><html><body>
<div class="mx-auto w-full max-w-[var(--size-content)]">
  <a href="/hanaviye/n/n111">サムネイル</a>
  <a href="/hanaviye/n/n111">記事1</a>
</div>
</body></html>`;
  const { win, send, downloadedQueries } = loadContentScript({
    noteStats: OWN(),
    html,
    downloadedNotes: { ok: true, found: { n111: ["Obsidian"] }, unreadable: [], configured: 1 },
  });

  const response = await send({ type: "showDownloadedMarks" });

  // 別レェルの配列は deepEqual が通らないため、広げてから比べる。
  assert.deepEqual([...downloadedQueries[0]], ["n111"], "同じ記事を重複して問い合わせています");
  assert.equal(response.total, 1, "記事数が重複して数えられています");
  assert.equal(marksOf(win).length, 2, "両方のリンクに印が付いていません");
});

test("押し直すと印を引き直す", async () => {
  // 1件保存済みの状態で確認し、そのあとファイルが消えた場合を作る
  let answer = { ok: true, found: { n111: ["Obsidian"] }, unreadable: [], configured: 1 };
  const { win, send } = loadContentScript({
    noteStats: OWN(),
    downloadedNotes: new Proxy({}, { get: (_t, key) => answer[key] }),
  });

  await send({ type: "showDownloadedMarks" });
  assert.equal(marksOf(win).length, 1);

  answer = { ok: true, found: {}, unreadable: [], configured: 1 };
  const response = await send({ type: "showDownloadedMarks" });

  assert.equal(response.marked, 0);
  assert.equal(marksOf(win).length, 0, "前回の印が残っています");
});

test("保存先フォルダが未設定なら印を付けずに知らせる", async () => {
  const { win, send } = loadContentScript({
    noteStats: OWN(),
    downloadedNotes: { ok: true, found: {}, unreadable: [], configured: 0 },
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.equal(response.ok, false);
  assert.match(response.error, /フォルダ/);
  assert.equal(marksOf(win).length, 0);
});

test("記事一覧でないページでは印を付けずに知らせる", async () => {
  const { send } = loadContentScript({
    noteStats: OWN(),
    html: '<!doctype html><html><body><p>記事リンクなし</p></body></html>',
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.equal(response.ok, false);
  assert.match(response.error, /記事一覧/);
});

test("他の拡張機能からの確認依頼は処理しない", async () => {
  const { send } = loadContentScript();
  const response = await send({ type: "showDownloadedMarks" }, { id: "other-extension-id" });
  assert.equal(response, undefined);
});

test("消えたリンクの印はスクロール時に片付ける", async () => {
  // note 側の再描画でカードが入れ替わると、印だけが画面に取り残される
  const { win, send } = loadContentScript({
    noteStats: OWN(),
    downloadedNotes: { ok: true, found: { n111: ["Obsidian"] }, unreadable: [], configured: 1 },
  });
  await send({ type: "showDownloadedMarks" });
  assert.equal(marksOf(win).length, 1);

  win.document.querySelector('a[href="/hanaviye/n/n111"]').remove();
  win.dispatchEvent(new win.Event("scroll"));
  await flush(40);

  assert.equal(marksOf(win).length, 0, "消えた記事の印が残っています");
});


/* ------------------ 印を付ける画面を記事一覧に限る ------------------ */

/*
 * 実ページで測った構造に合わせたHTML。
 * 記事ページは本文の埋め込みカードと末尾のおすすめ欄に、著者本人と他人の
 * 記事が並ぶ（実測で43件・著者以外5名以上）。
 */
const ARTICLE_PAGE_HTML = `<!doctype html><html><body>
<article>
  <a href="/hanaviye/n/n315470bf18a2">埋め込みカード（著者の別記事）</a>
</article>
<section>
  <a href="/hanaviye/n/n0f8ab9693bca">おすすめ（著者の別記事）</a>
  <a href="/hebodan/n/nef6e621706fb">おすすめ（他人の記事）</a>
</section>
</body></html>`;

const FOREIGN_LIST_HTML = `<!doctype html><html><body>
<div class="mx-auto w-full max-w-[var(--size-content)]">
  <a href="/grsn_note/n/n111">他人の記事1</a>
  <a href="/qier___3/n/n222">他人の記事2</a>
</div>
</body></html>`;

const SAVED_EVERYTHING = {
  ok: true,
  found: { n111: ["Obsidian"], n222: ["Obsidian"], n315470bf18a2: ["Obsidian"], n0f8ab9693bca: ["Obsidian"] },
  unreadable: [],
  configured: 1,
};

for (const [label, url, html] of [
  ["記事ページ", "https://note.com/hanaviye/n/n2c4a89eb7a8a", ARTICLE_PAGE_HTML],
  ["トップページ", "https://note.com/", FOREIGN_LIST_HTML],
  ["検索結果", "https://note.com/search?q=markdown", FOREIGN_LIST_HTML],
  ["ハッシュタグ", "https://note.com/tag/個人開発", FOREIGN_LIST_HTML],
  ["ダッシュボード", "https://note.com/sitesettings/stats", FOREIGN_LIST_HTML],
  ["すべての記事", "https://note.com/hanaviye/all", PAGE_HTML],
  ["メンバーシップ", "https://note.com/hanaviye/membership", PAGE_HTML],
]) {
  test(`${label}では押しても何も起きない`, async () => {
    const stats = OWN();
    const { win, send, downloadedQueries } = loadContentScript({
      url,
      html,
      noteStats: stats,
      downloadedNotes: SAVED_EVERYTHING,
    });

    const response = await send({ type: "showDownloadedMarks" });

    assert.equal(response.ok, false, "一覧ではない画面で印を付けようとしています");
    assert.deepEqual([...downloadedQueries], [], "保存先フォルダへ問い合わせています");
    assert.equal(stats.calls, 0, "対象外の画面でダッシュボードへ問い合わせています");
    assert.equal(marksOf(win).length, 0);
  });
}

test("自分の一覧では、おすすめに混ざった他人の記事を問い合わせない", async () => {
  // 一覧の脇に他人の記事が並ぶようになっても、持ち主の記事だけを見る
  const html = `<!doctype html><html><body>
<div class="mx-auto w-full max-w-[var(--size-content)]">
  <a href="/hanaviye/n/n111">自分の記事</a>
  <a href="/hebodan/n/n222">他人の記事（おすすめ枠）</a>
</div>
</body></html>`;
  const { win, send, downloadedQueries } = loadContentScript({
    noteStats: OWN(),
    url: "https://note.com/hanaviye",
    html,
    downloadedNotes: SAVED_EVERYTHING,
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.deepEqual([...downloadedQueries[0]], ["n111"], "他人の記事まで問い合わせています");
  assert.equal(response.total, 1);
  assert.equal(marksOf(win).length, 1);
});

test("マガジンページでも、そのクリエイターの記事に印を付ける", async () => {
  const html = `<!doctype html><html><body>
<div>
  <a href="/hanaviye/n/n111">自分の記事</a>
</div>
</body></html>`;
  const { win, send } = loadContentScript({
    noteStats: OWN(),
    url: "https://note.com/hanaviye/m/mfdf8198c41ab",
    html,
    downloadedNotes: SAVED_EVERYTHING,
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.equal(response.ok, true);
  assert.equal(marksOf(win).length, 1);
});

test("ダッシュボードに無い記事には印を付けない", async () => {
  /*
   * 持ち主の担保はここ。一覧に自分以外の記事が並んでいても、
   * note 側が「自分の記事」として返していないものは対象にしない。
   */
  const { win, send, downloadedQueries } = loadContentScript({
    noteStats: ownNotes("n111"),
    downloadedNotes: {
      ok: true,
      found: { n111: ["Obsidian"], n222: ["Obsidian"] },
      unreadable: [],
      configured: 1,
    },
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.deepEqual([...downloadedQueries[0]], ["n111"], "自分の記事でないものを問い合わせています");
  assert.equal(response.total, 1);
  assert.equal(marksOf(win).length, 1);
});

test("未ログインなら何もしない", async () => {
  const { win, send, downloadedQueries } = loadContentScript({
    noteStats: { fetchAllStats: async () => ({ ok: false, code: "not-logged-in" }) },
    downloadedNotes: { ok: true, found: { n111: ["Obsidian"] }, unreadable: [], configured: 1 },
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.equal(response.ok, false);
  assert.deepEqual([...downloadedQueries], [], "保存先フォルダへ問い合わせています");
  assert.equal(marksOf(win).length, 0);
});

test("他のクリエイターの一覧では何もしない", async () => {
  // 自分の記事が1件も並ばないため、保存先へ問い合わせる前に終わる
  const html = `<!doctype html><html><body>
<div class="mx-auto w-full max-w-[var(--size-content)]">
  <a href="/hebodan/n/n999">他人の記事</a>
</div>
</body></html>`;
  const { win, send, downloadedQueries } = loadContentScript({
    url: "https://note.com/hebodan",
    html,
    noteStats: ownNotes("n111", "n222"),
    downloadedNotes: { ok: true, found: { n999: ["Obsidian"] }, unreadable: [], configured: 1 },
  });

  const response = await send({ type: "showDownloadedMarks" });

  assert.equal(response.ok, false);
  assert.deepEqual([...downloadedQueries], [], "保存先フォルダへ問い合わせています");
  assert.equal(marksOf(win).length, 0);
});

test("押し直してもダッシュボードへ問い合わせ直さない", async () => {
  // スクロール→押し直しを繰り返す使い方なので、毎回の問い合わせは重い
  const stats = ownNotes("n111", "n222");
  const { send } = loadContentScript({
    noteStats: stats,
    downloadedNotes: { ok: true, found: { n111: ["Obsidian"] }, unreadable: [], configured: 1 },
  });

  await send({ type: "showDownloadedMarks" });
  await send({ type: "showDownloadedMarks" });

  assert.equal(stats.calls, 1, "押すたびにダッシュボードへ問い合わせています");
});

test("自分の記事が並ぶ一覧だと確かめたら、持ち主の名前を控える", async () => {
  // popup / サイドパネルが、押す前の可否表示に使う
  const { send, win } = loadContentScript({
    noteStats: OWN(),
    downloadedNotes: { ok: true, found: { n111: ["Obsidian"] }, unreadable: [], configured: 1 },
  });

  await send({ type: "showDownloadedMarks" });

  const stored = await win.chrome.storage.local.get(["verifiedOwnUrlname"]);
  assert.equal(stored.verifiedOwnUrlname, "hanaviye");
});

/**
 * オプション画面のテスト。
 * タグ候補・タグセットプリセット・保存先フォルダの権限導線を検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChromeStub, flush, readSource } from "./helpers/env.mjs";

/**
 * IndexedDB を模したスタブを作る。
 * @param {Record<string, object>} handles - キーごとのディレクトリハンドル。
 * @returns {object} indexedDB スタブ。
 */
const createIndexedDbStub = (handles) => ({
  open: () => {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        transaction: () => ({
          objectStore: () => ({
            get: (key) => {
              const req = {};
              queueMicrotask(() => {
                req.result = handles[key] ?? null;
                req.onsuccess?.();
              });
              return req;
            },
            put: (value, key) => {
              handles[key] = value;
            },
            delete: (key) => {
              delete handles[key];
            },
          }),
          set oncomplete(fn) {
            queueMicrotask(fn);
          },
        }),
        close: () => {},
      };
      request.onsuccess?.();
    });
    return request;
  },
});

/**
 * オプション画面を読み込む。
 * @param {{store?: object, handles?: Record<string, object>}} [options={}] - 初期状態。
 * @returns {Promise<{win: import("jsdom").DOMWindow, doc: Document, store: object}>} テスト環境。
 */
const loadOptions = async ({ store: initialStore = {}, handles = {} } = {}) => {
  const dom = new JSDOM(readSource("options", "options.html"), {
    runScripts: "outside-only",
    url: "https://example.org/",
  });
  const win = dom.window;
  const { chrome, store } = createChromeStub(initialStore);
  win.chrome = chrome;
  win.indexedDB = createIndexedDbStub(handles);
  win.eval(readSource("options", "options.js"));
  await flush(60);
  return { win, doc: win.document, store };
};

const click = (win, element) => element.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
const setValue = (win, element, value) => {
  element.value = value;
};

/* ------------------------------- タグ候補 -------------------------------- */

test("タグ候補を追加・削除できる", async () => {
  const { win, doc, store } = await loadOptions();

  setValue(win, doc.getElementById("newTagInput"), "学習メモ");
  click(win, doc.getElementById("addTagBtn"));
  await flush();

  assert.deepEqual(store.presetTagCandidates, ["学習メモ"]);
  assert.equal(doc.querySelectorAll("#tagCandidateList .tag-item").length, 1);

  click(win, doc.querySelector("#tagCandidateList .tag-item button"));
  await flush();
  assert.deepEqual(store.presetTagCandidates, []);
});

test("同じタグは重複登録しない", async () => {
  const { win, doc, store } = await loadOptions({ store: { presetTagCandidates: ["学習メモ"] } });
  setValue(win, doc.getElementById("newTagInput"), "#学習メモ");
  click(win, doc.getElementById("addTagBtn"));
  await flush();
  assert.deepEqual(store.presetTagCandidates, ["学習メモ"]);
  assert.match(doc.getElementById("tagStatus").textContent, /既に登録/);
});

/* --------------------------- タグセットプリセット --------------------------- */

const TAG_STORE = { presetTagCandidates: ["学習メモ", "技術検証", "日記"] };

test("タグセットを追加・編集・削除できる", async () => {
  const { win, doc, store } = await loadOptions({ store: TAG_STORE });

  const boxes = () => [...doc.querySelectorAll("#tagSetTagSelector input")];
  assert.equal(boxes().length, 3);

  click(win, boxes()[0]);
  click(win, boxes()[1]);
  setValue(win, doc.getElementById("tagSetNameInput"), "技術ノート");
  click(win, doc.getElementById("saveTagSetBtn"));
  await flush();

  assert.equal(store.presetTagSets.length, 1);
  assert.deepEqual(store.presetTagSets[0].tags, ["学習メモ", "技術検証"]);
  assert.equal(doc.getElementById("tagSetNameInput").value, "", "保存後にフォームが初期化されていません");

  // 編集
  click(win, doc.querySelector(".tag-set-card button"));
  await flush();
  assert.equal(doc.getElementById("tagSetNameInput").value, "技術ノート");
  click(win, boxes()[2]);
  click(win, doc.getElementById("saveTagSetBtn"));
  await flush();
  assert.equal(store.presetTagSets.length, 1, "編集で件数が増えています");
  assert.deepEqual(store.presetTagSets[0].tags, ["学習メモ", "技術検証", "日記"]);

  // 削除
  click(win, [...doc.querySelectorAll(".tag-set-card button")][1]);
  await flush();
  assert.deepEqual(store.presetTagSets, []);
});

test("名前かタグが未入力ならタグセットを保存しない", async () => {
  const { win, doc, store } = await loadOptions({ store: TAG_STORE });

  click(win, doc.getElementById("saveTagSetBtn"));
  await flush();
  assert.equal(store.presetTagSets, undefined);
  assert.match(doc.getElementById("tagSetStatus").textContent, /セット名/);

  setValue(win, doc.getElementById("tagSetNameInput"), "名前だけ");
  click(win, doc.getElementById("saveTagSetBtn"));
  await flush();
  assert.match(doc.getElementById("tagSetStatus").textContent, /タグを1つ以上/);
});

test("同名のタグセットは登録できない", async () => {
  const { win, doc } = await loadOptions({
    store: {
      ...TAG_STORE,
      presetTagSets: [{ id: "set-1", name: "技術ノート", tags: ["学習メモ"] }],
    },
  });

  click(win, doc.querySelectorAll("#tagSetTagSelector input")[1]);
  setValue(win, doc.getElementById("tagSetNameInput"), "技術ノート");
  click(win, doc.getElementById("saveTagSetBtn"));
  await flush();

  assert.match(doc.getElementById("tagSetStatus").textContent, /同じ名前/);
});

test("1セットに6つ目のタグは選択できない", async () => {
  const { win, doc } = await loadOptions({
    store: { presetTagCandidates: ["a", "b", "c", "d", "e", "f"] },
  });
  const boxes = [...doc.querySelectorAll("#tagSetTagSelector input")];
  boxes.slice(0, 5).forEach((box) => click(win, box));
  click(win, boxes[5]);
  await flush();

  assert.equal(boxes[5].checked, false);
  assert.match(doc.getElementById("tagSetStatus").textContent, /最大5つ/);
});

test("タグ候補を削除するとタグセットからも除外される", async () => {
  const { win, doc, store } = await loadOptions({
    store: {
      ...TAG_STORE,
      presetTagSets: [{ id: "set-1", name: "技術ノート", tags: ["学習メモ", "日記"] }],
    },
  });

  const target = [...doc.querySelectorAll("#tagCandidateList .tag-item")].find((item) =>
    item.textContent.startsWith("日記")
  );
  click(win, target.querySelector("button"));
  await flush();

  assert.deepEqual(store.presetTagSets[0].tags, ["学習メモ"]);
});

test("タグが空になったタグセットは削除される", async () => {
  const { win, doc, store } = await loadOptions({
    store: {
      presetTagCandidates: ["日記"],
      presetTagSets: [{ id: "set-1", name: "日記だけ", tags: ["日記"] }],
    },
  });

  click(win, doc.querySelector("#tagCandidateList .tag-item button"));
  await flush();

  assert.deepEqual(store.presetTagSets, []);
});

/* --------------------------- 保存先フォルダの権限 --------------------------- */

/**
 * 権限状態を制御できるディレクトリハンドルのスタブを作る。
 * @param {string} initialPermission - 初期の権限状態。
 * @returns {object} スタブハンドル。
 */
const createHandleStub = (initialPermission) => {
  const state = { permission: initialPermission, requestCount: 0 };
  return {
    state,
    name: "Notes",
    queryPermission: async () => state.permission,
    requestPermission: async () => {
      state.requestCount += 1;
      state.permission = "granted";
      return state.permission;
    },
  };
};

const FOLDER_STORE = {
  presetConfigs: {
    preset1: { name: "P1", folderLabel: "Notes", hasFolder: true },
    preset2: { name: "P2", folderLabel: "", hasFolder: false },
    preset3: { name: "P3", folderLabel: "", hasFolder: false },
  },
  imageImportMode: "download",
  imageFolderConfig: { folderLabel: "Images", hasFolder: true },
};

test("権限が失効しているとき再許可ボタンを表示する", async () => {
  const handle = createHandleStub("prompt");
  const { doc } = await loadOptions({
    store: FOLDER_STORE,
    handles: { preset1: handle, imageFolder: handle },
  });

  assert.equal(doc.getElementById("preset1Grant").classList.contains("hidden"), false);
  assert.match(doc.getElementById("preset1Folder").textContent, /再取得が必要/);
  assert.equal(doc.getElementById("imageFolderGrant").classList.contains("hidden"), false);
  assert.equal(
    doc.getElementById("preset2Grant").classList.contains("hidden"),
    true,
    "フォルダ未設定のプリセットにボタンが出ています"
  );
});

test("再許可ボタンで権限を取り直せる", async () => {
  const handle = createHandleStub("prompt");
  const { win, doc } = await loadOptions({ store: FOLDER_STORE, handles: { preset1: handle } });

  click(win, doc.getElementById("preset1Grant"));
  await flush(40);

  assert.equal(handle.state.requestCount, 1);
  assert.equal(doc.getElementById("preset1Grant").classList.contains("hidden"), true);
  assert.equal(doc.getElementById("preset1Folder").textContent, "設定済み: Notes");
});

test("権限が有効なら再許可ボタンを表示しない", async () => {
  const handle = createHandleStub("granted");
  const { doc } = await loadOptions({ store: FOLDER_STORE, handles: { preset1: handle } });

  assert.equal(doc.getElementById("preset1Grant").classList.contains("hidden"), true);
  assert.equal(doc.getElementById("preset1Folder").textContent, "設定済み: Notes");
});

test("ハンドルが失われている場合は再選択を促す", async () => {
  const { doc } = await loadOptions({ store: FOLDER_STORE, handles: {} });
  assert.match(doc.getElementById("preset1Folder").textContent, /見つかりません/);
});

/* ------------------------------ その他の設定 ------------------------------ */

test("画像取込方式を切り替えると保存される", async () => {
  const { win, doc, store } = await loadOptions();
  const base64Radio = doc.querySelector('input[name="imageImportMode"][value="base64"]');
  base64Radio.checked = true;
  base64Radio.dispatchEvent(new win.Event("change", { bubbles: true }));
  await flush();

  assert.equal(store.imageImportMode, "base64");
  assert.equal(doc.getElementById("imageFolderField").classList.contains("hidden"), true);
});

test("Obsidianリンク化の切り替えが保存される", async () => {
  const { win, doc, store } = await loadOptions();
  const toggle = doc.getElementById("obsidianLinkify");
  toggle.checked = true;
  toggle.dispatchEvent(new win.Event("change", { bubbles: true }));
  await flush();
  assert.equal(store.obsidianLinkify, true);
});

test("改行で一括追加できる", async () => {
  const { win, doc, store } = await loadOptions();
  doc.getElementById("bulkAddModal").showModal = () => {};
  doc.getElementById("bulkAddModal").close = () => {};

  click(win, doc.getElementById("openTagBulkModalBtn"));
  setValue(win, doc.getElementById("bulkAddTextarea"), "学習メモ\n技術検証\n学習メモ\n\n");
  doc.getElementById("bulkAddForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await flush(40);

  assert.deepEqual(store.presetTagCandidates, ["学習メモ", "技術検証"]);
  assert.match(doc.getElementById("tagStatus").textContent, /重複スキップ 1/);
});

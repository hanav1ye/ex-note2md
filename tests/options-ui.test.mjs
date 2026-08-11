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
 * @param {{store?: object, handles?: Record<string, object>, uiLanguage?: string}} [options={}] - 初期状態。
 * @returns {Promise<{win: import("jsdom").DOMWindow, doc: Document, store: object, downloads: object[]}>} テスト環境。
 */
const loadOptions = async ({ store: initialStore = {}, handles = {}, uiLanguage = "ja" } = {}) => {
  const dom = new JSDOM(readSource("options", "options.html"), {
    runScripts: "outside-only",
    url: "https://example.org/",
  });
  const win = dom.window;
  const { chrome, store } = createChromeStub(initialStore, { uiLanguage });
  win.chrome = chrome;
  win.indexedDB = createIndexedDbStub(handles);

  // jsdom には Blob URL とアンカーによるダウンロードが無いので、呼び出しを記録するだけにする。
  const downloads = [];
  const blobs = new Map();
  win.URL.createObjectURL = (blob) => {
    const url = `blob:stub/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  win.URL.revokeObjectURL = (url) => blobs.delete(url);
  win.HTMLAnchorElement.prototype.click = function recordDownload() {
    downloads.push({ download: this.download, blob: blobs.get(this.getAttribute("href")) });
  };

  win.eval(readSource("lib", "i18n.js"));
  win.eval(readSource("options", "options.js"));
  await flush(60);
  return { win, doc: win.document, store, downloads };
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

/* -------------------------------- 表示言語 -------------------------------- */

const change = (win, element) => element.dispatchEvent(new win.Event("change", { bubbles: true }));

test("ブラウザが英語なら英語で表示する", async () => {
  const { doc } = await loadOptions({ uiLanguage: "en" });
  assert.equal(doc.getElementById("languageSectionTitle").textContent, "Display language");
  assert.equal(doc.getElementById("addTagBtn").textContent, "Add");
  assert.equal(doc.documentElement.lang, "en");
});

test("保存済みの言語設定がブラウザの言語より優先される", async () => {
  const { doc } = await loadOptions({ store: { uiLanguage: "en" }, uiLanguage: "ja" });
  assert.equal(doc.getElementById("languageSelect").value, "en");
  assert.equal(doc.getElementById("tagSectionTitle").textContent, "Tag candidates");
});

test("言語を切り替えると保存され、その場で表示が変わる", async () => {
  const { win, doc, store } = await loadOptions({ store: { presetTagCandidates: ["日記"] } });
  assert.equal(doc.getElementById("tagSectionTitle").textContent, "タグ候補");

  const select = doc.getElementById("languageSelect");
  select.value = "en";
  change(win, select);
  await flush(40);

  assert.equal(store.uiLanguage, "en");
  assert.equal(doc.getElementById("tagSectionTitle").textContent, "Tag candidates");
  assert.equal(
    doc.querySelector("#tagCandidateList .tag-item button").textContent,
    "Remove",
    "JS が生成した文言が切り替わっていません"
  );
  assert.match(doc.getElementById("languageStatus").textContent, /English/);
});

test("プリセット名が未設定なら表示言語の既定名を出す", async () => {
  const { doc } = await loadOptions({ uiLanguage: "en" });
  assert.equal(doc.querySelector('[data-preset-id="preset1"] h3').textContent, "Preset 1");
});

test("旧バージョンが保存した既定名は未設定として扱う", async () => {
  const { doc } = await loadOptions({
    store: {
      presetConfigs: {
        preset1: { name: "プリセット1", folderLabel: "", hasFolder: false },
        preset2: { name: "自分の名前", folderLabel: "", hasFolder: false },
        preset3: { name: "", folderLabel: "", hasFolder: false },
      },
    },
    uiLanguage: "en",
  });

  assert.equal(doc.querySelector('[data-preset-id="preset1"] h3').textContent, "Preset 1");
  assert.equal(doc.getElementById("preset1Name").value, "");
  assert.equal(
    doc.querySelector('[data-preset-id="preset2"] h3').textContent,
    "自分の名前",
    "ユーザーが付けた名前は残すべきです"
  );
});

/* ------------------------ 設定のインポート / エクスポート ------------------------ */

const TRANSFER_STORE = {
  presetTagCandidates: ["学習メモ", "技術検証"],
  presetTagSets: [{ id: "set-1", name: "技術ノート", tags: ["学習メモ", "技術検証"] }],
  presetObsidianLinkWords: ["Obsidian"],
  obsidianLinkify: true,
};

/**
 * インポート用のファイル選択を再現する。
 * @param {import("jsdom").DOMWindow} win - 対象ウィンドウ。
 * @param {Document} doc - 対象ドキュメント。
 * @param {string} text - ファイル内容。
 */
const selectImportFile = async (win, doc, text) => {
  const input = doc.getElementById("importSettingsInput");
  Object.defineProperty(input, "files", {
    value: [{ name: "settings.json", text: async () => text }],
    configurable: true,
  });
  change(win, input);
  await flush(40);
};

test("タグと Obsidian 設定をエクスポートできる", async () => {
  const { win, doc, downloads } = await loadOptions({ store: TRANSFER_STORE });

  click(win, doc.getElementById("exportSettingsBtn"));
  await flush();

  assert.equal(downloads.length, 1);
  assert.match(downloads[0].download, /^note2md-settings-\d{8}\.json$/);

  const payload = JSON.parse(await downloads[0].blob.text());
  assert.equal(payload.type, "ex-note2md-settings");
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.tagCandidates, ["学習メモ", "技術検証"]);
  assert.deepEqual(payload.tagSets, [{ name: "技術ノート", tags: ["学習メモ", "技術検証"] }]);
  assert.deepEqual(payload.obsidianLinkWords, ["Obsidian"]);
  assert.equal(payload.obsidianLinkify, true);
  assert.equal("presetConfigs" in payload, false, "保存先フォルダ設定は含めません");
  assert.match(doc.getElementById("transferStatus").textContent, /エクスポート/);
});

test("インポートは既存設定へマージし、重複はスキップする", async () => {
  const { win, doc, store } = await loadOptions({ store: TRANSFER_STORE });

  await selectImportFile(
    win,
    doc,
    JSON.stringify({
      type: "ex-note2md-settings",
      version: 1,
      tagCandidates: ["学習メモ", "読書メモ"],
      tagSets: [{ name: "技術ノート", tags: ["学習メモ"] }, { name: "読書", tags: ["読書メモ"] }],
      obsidianLinkWords: ["Obsidian", "Markdown"],
      obsidianLinkify: false,
    })
  );

  assert.deepEqual(store.presetTagCandidates, ["学習メモ", "技術検証", "読書メモ"]);
  assert.deepEqual(store.presetObsidianLinkWords, ["Obsidian", "Markdown"]);
  assert.equal(store.presetTagSets.length, 2, "同名セットが二重登録されています");
  assert.equal(store.presetTagSets[1].name, "読書");
  assert.equal(store.obsidianLinkify, true, "既存の ON を OFF へ戻してはいけません");
  assert.match(doc.getElementById("transferStatus").textContent, /重複スキップ 3/);
});

test("インポートしたタグセットのタグはタグ候補にも追加される", async () => {
  const { win, doc, store } = await loadOptions();

  await selectImportFile(
    win,
    doc,
    JSON.stringify({
      type: "ex-note2md-settings",
      version: 1,
      tagSets: [{ name: "技術ノート", tags: ["学習メモ", "技術検証"] }],
    })
  );

  assert.deepEqual(store.presetTagCandidates, ["学習メモ", "技術検証"]);
  assert.deepEqual(store.presetTagSets[0].tags, ["学習メモ", "技術検証"]);
  assert.equal(doc.querySelectorAll("#tagCandidateList .tag-item").length, 2);
});

test("インポートでリンク化が有効になったら知らせる", async () => {
  const { win, doc, store } = await loadOptions();

  await selectImportFile(
    win,
    doc,
    JSON.stringify({
      type: "ex-note2md-settings",
      version: 1,
      obsidianLinkWords: ["Obsidian"],
      obsidianLinkify: true,
    })
  );

  assert.equal(store.obsidianLinkify, true);
  assert.equal(doc.getElementById("obsidianLinkify").checked, true);
  assert.match(doc.getElementById("transferStatus").textContent, /Obsidianリンク化を有効/);
});

test("タグセットの上限を超える分は取り込まない", async () => {
  const existing = Array.from({ length: 9 }, (_, index) => ({
    id: `set-${index}`,
    name: `セット${index}`,
    tags: ["日記"],
  }));
  const { win, doc, store } = await loadOptions({
    store: { presetTagCandidates: ["日記"], presetTagSets: existing },
  });

  await selectImportFile(
    win,
    doc,
    JSON.stringify({
      type: "ex-note2md-settings",
      version: 1,
      tagSets: [
        { name: "追加1", tags: ["日記"] },
        { name: "追加2", tags: ["日記"] },
      ],
    })
  );

  assert.equal(store.presetTagSets.length, 10);
  assert.match(doc.getElementById("transferStatus").textContent, /1件を取り込めませんでした/);
});

test("他アプリの JSON はインポートしない", async () => {
  const { win, doc, store } = await loadOptions({ store: TRANSFER_STORE });

  await selectImportFile(win, doc, JSON.stringify({ tagCandidates: ["乗っ取り"] }));

  assert.deepEqual(store.presetTagCandidates, ["学習メモ", "技術検証"]);
  assert.match(doc.getElementById("transferStatus").textContent, /エクスポートファイルではありません/);
});

test("壊れた JSON はインポートしない", async () => {
  const { win, doc, store } = await loadOptions({ store: TRANSFER_STORE });

  await selectImportFile(win, doc, "{ not json");

  assert.deepEqual(store.presetTagCandidates, ["学習メモ", "技術検証"]);
  assert.match(doc.getElementById("transferStatus").textContent, /確認してください/);
});

test("未対応バージョンのファイルはインポートしない", async () => {
  const { win, doc, store } = await loadOptions({ store: TRANSFER_STORE });

  await selectImportFile(
    win,
    doc,
    JSON.stringify({ type: "ex-note2md-settings", version: 99, tagCandidates: ["未来"] })
  );

  assert.deepEqual(store.presetTagCandidates, ["学習メモ", "技術検証"]);
  assert.match(doc.getElementById("transferStatus").textContent, /バージョン/);
});

test("中身が空のファイルは取り込むものが無いと伝える", async () => {
  const { win, doc } = await loadOptions();

  await selectImportFile(win, doc, JSON.stringify({ type: "ex-note2md-settings", version: 1 }));

  assert.match(doc.getElementById("transferStatus").textContent, /含まれていません/);
});

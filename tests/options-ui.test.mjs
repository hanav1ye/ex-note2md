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

  // jsdom には <dialog> のモーダル表示が無い。popup からの自動起動は読み込み直後に
  // ダイアログを開くため、インスタンス単位ではなくプロトタイプごと差し替えておく。
  win.HTMLDialogElement.prototype.showModal = function showModalStub() {
    this.setAttribute("open", "");
  };
  win.HTMLDialogElement.prototype.close = function closeStub() {
    this.removeAttribute("open");
  };

  // note の API 呼び出しを記録しつつ、既定では固定のスキ数を返す。
  const apiCalls = [];
  win.fetch = async (url) => {
    apiCalls.push(String(url));
    return { ok: true, json: async () => ({ data: { like_count: 55 } }) };
  };

  win.eval(readSource("lib", "i18n.js"));
  win.eval(readSource("lib", "likeCount.js"));
  win.eval(readSource("options", "options.js"));
  await flush(60);
  return { win, doc: win.document, store, downloads, apiCalls };
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

/* ------------------------------ スキ数の更新 ------------------------------ */

/**
 * .md ファイルハンドルのスタブを作る。
 * @param {string} name - ファイル名。
 * @param {string} contents - 初期内容。
 * @returns {object} スタブハンドル。
 */
const createMarkdownFile = (name, contents) => {
  const state = { contents, writes: 0 };
  return {
    kind: "file",
    name,
    state,
    getFile: async () => ({ text: async () => state.contents }),
    createWritable: async () => ({
      write: async (data) => {
        state.contents = data;
        state.writes += 1;
      },
      close: async () => {},
    }),
  };
};

/**
 * 走査対象のディレクトリハンドルのスタブを作る。
 * @param {Record<string, object>} entries - 名前 → ハンドル。
 * @param {string} [permission="granted"] - 権限状態。
 * @returns {object} スタブハンドル。
 */
const createVaultHandle = (entries, permission = "granted") => {
  const state = { permission, requestCount: 0 };
  return {
    kind: "directory",
    name: "Notes",
    state,
    queryPermission: async () => state.permission,
    requestPermission: async () => {
      state.requestCount += 1;
      return state.permission;
    },
    entries: async function* vaultEntries() {
      for (const [name, handle] of Object.entries(entries)) {
        yield [name, handle];
      }
    },
  };
};

const LIKE_COUNT_STORE = {
  presetConfigs: {
    preset1: { name: "Obsidian", folderLabel: "Notes", hasFolder: true },
    preset2: { name: "P2", folderLabel: "", hasFolder: false },
    preset3: { name: "P3", folderLabel: "", hasFolder: false },
  },
};

const articleMarkdown = (noteId, likeCount) =>
  `---\ntitle: 記事\nsource: "https://note.com/hanaviye/n/${noteId}"\nnote_id: ${noteId}\nauthor: hanaviye\npublished: 2026-04-29\nlike_count: ${likeCount}\n---\n\n# 記事\n\n本文\n`;

/**
 * 確認ダイアログを jsdom で扱えるようにする。
 * @param {Document} doc - 対象ドキュメント。
 * @returns {HTMLElement} ダイアログ要素。
 */
const stubConfirmModal = (doc) => doc.getElementById("likeCountConfirmModal");

/**
 * 確認ダイアログの「更新する」を押す。
 * @param {import("jsdom").DOMWindow} win - 対象ウィンドウ。
 * @param {Document} doc - 対象ドキュメント。
 */
const acceptConfirm = (win, doc) => {
  doc
    .getElementById("likeCountConfirmForm")
    .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
};

test("フォルダ未設定なら実行できない", async () => {
  const { doc } = await loadOptions();
  assert.equal(doc.getElementById("likeCountRunBtn").disabled, true);
  assert.equal(doc.getElementById("likeCountPresetHint").classList.contains("hidden"), false);
});

test("フォルダ設定済みのプリセットだけが対象に並ぶ", async () => {
  const { doc } = await loadOptions({ store: LIKE_COUNT_STORE });
  const select = doc.getElementById("likeCountPreset");
  assert.equal(select.options.length, 1);
  assert.equal(select.value, "preset1");
  assert.match(select.options[0].textContent, /Obsidian \(Notes\)/);
  assert.equal(doc.getElementById("likeCountRunBtn").disabled, false);
});

test("確認してから frontmatter の like_count を更新する", async () => {
  const file = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const vault = createVaultHandle({ "nabc123.md": file });
  const { win, doc, apiCalls } = await loadOptions({
    store: LIKE_COUNT_STORE,
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);

  click(win, doc.getElementById("likeCountRunBtn"));
  await flush(80);

  assert.match(doc.getElementById("likeCountConfirmBody").textContent, /1件/);
  assert.equal(file.state.writes, 0, "確認前に書き換えています");

  acceptConfirm(win, doc);
  await flush(600);

  assert.deepEqual(apiCalls, ["https://note.com/api/v3/notes/nabc123"]);
  assert.match(file.state.contents, /^like_count: 55$/m);
  assert.match(file.state.contents, /^# 記事$/m, "本文が壊れています");
  assert.match(doc.getElementById("likeCountStatus").textContent, /更新 1件/);
});

test("キャンセルするとファイルを書き換えない", async () => {
  const file = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const vault = createVaultHandle({ "nabc123.md": file });
  const { win, doc, apiCalls } = await loadOptions({
    store: LIKE_COUNT_STORE,
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);

  click(win, doc.getElementById("likeCountRunBtn"));
  await flush(80);
  click(win, doc.getElementById("likeCountConfirmCancelBtn"));
  await flush(80);

  assert.equal(file.state.writes, 0);
  assert.deepEqual(apiCalls, [], "キャンセルしたのに API を呼んでいます");
});

test("値が同じファイルは書き込まない", async () => {
  const file = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 55));
  const vault = createVaultHandle({ "nabc123.md": file });
  const { win, doc } = await loadOptions({
    store: LIKE_COUNT_STORE,
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);

  click(win, doc.getElementById("likeCountRunBtn"));
  await flush(80);
  acceptConfirm(win, doc);
  await flush(600);

  assert.equal(file.state.writes, 0, "同じ値なのに書き込んでいます");
  assert.match(doc.getElementById("likeCountStatus").textContent, /変更なし 1件/);
});

test("note_id を解決できないファイルは対象外にする", async () => {
  const target = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const plain = createMarkdownFile("メモ.md", "# frontmatter なし\n");
  const vault = createVaultHandle({ "nabc123.md": target, "メモ.md": plain });
  const { win, doc } = await loadOptions({
    store: LIKE_COUNT_STORE,
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);

  click(win, doc.getElementById("likeCountRunBtn"));
  await flush(80);
  assert.match(doc.getElementById("likeCountConfirmSkipped").textContent, /1件/);

  acceptConfirm(win, doc);
  await flush(600);

  assert.equal(plain.state.writes, 0, "対象外のファイルを書き換えています");
  assert.match(doc.getElementById("likeCountStatus").textContent, /対象外 1件/);
});

test("同じ記事が複数あっても API は1回だけ呼ぶ", async () => {
  const first = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const copy = createMarkdownFile("copy.md", articleMarkdown("nabc123", 11));
  const vault = createVaultHandle({ "nabc123.md": first, "copy.md": copy });
  const { win, doc, apiCalls } = await loadOptions({
    store: LIKE_COUNT_STORE,
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);

  click(win, doc.getElementById("likeCountRunBtn"));
  await flush(80);
  acceptConfirm(win, doc);
  await flush(700);

  assert.equal(apiCalls.length, 1);
  assert.match(first.state.contents, /like_count: 55/);
  assert.match(copy.state.contents, /like_count: 55/);
});

test("権限が無ければ再許可を促して何もしない", async () => {
  const file = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const vault = createVaultHandle({ "nabc123.md": file }, "prompt");
  const { win, doc, apiCalls } = await loadOptions({
    store: LIKE_COUNT_STORE,
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);

  click(win, doc.getElementById("likeCountRunBtn"));
  await flush(120);

  assert.equal(vault.state.requestCount, 1, "再許可を求めていません");
  assert.equal(file.state.writes, 0);
  assert.deepEqual(apiCalls, []);
  assert.match(doc.getElementById("likeCountStatus").textContent, /アクセス権限がありません/);
});

test("更新できる .md が無ければその旨を伝える", async () => {
  const vault = createVaultHandle({ "readme.txt": createMarkdownFile("readme.txt", "x") });
  const { win, doc } = await loadOptions({
    store: LIKE_COUNT_STORE,
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);

  click(win, doc.getElementById("likeCountRunBtn"));
  await flush(80);

  assert.match(doc.getElementById("likeCountStatus").textContent, /見つかりませんでした/);
});

test("popup から渡された実行指示を受け取って確認まで進む", async () => {
  const file = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const vault = createVaultHandle({ "nabc123.md": file });
  const { win, doc, store } = await loadOptions({
    store: { ...LIKE_COUNT_STORE, pendingLikeCountRun: true },
    handles: { preset1: vault },
  });
  stubConfirmModal(doc);
  await flush(120);

  assert.equal(store.pendingLikeCountRun, undefined, "指示が消費されていません");
  assert.match(doc.getElementById("likeCountConfirmBody").textContent, /1件/);

  acceptConfirm(win, doc);
  await flush(600);
  assert.match(file.state.contents, /like_count: 55/);
});

test("自動起動では権限ダイアログを出さず案内に留める", async () => {
  const file = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const vault = createVaultHandle({ "nabc123.md": file }, "prompt");
  const { doc } = await loadOptions({
    store: { ...LIKE_COUNT_STORE, pendingLikeCountRun: true },
    handles: { preset1: vault },
  });
  await flush(120);

  assert.equal(
    vault.state.requestCount,
    0,
    "ユーザー操作が無い場面で権限ダイアログを開こうとしています"
  );
  assert.equal(file.state.writes, 0);
  assert.match(doc.getElementById("likeCountStatus").textContent, /アクセス権限がありません/);
});

test("指示が無ければ勝手に走らない", async () => {
  const file = createMarkdownFile("nabc123.md", articleMarkdown("nabc123", 10));
  const vault = createVaultHandle({ "nabc123.md": file });
  const { doc } = await loadOptions({ store: LIKE_COUNT_STORE, handles: { preset1: vault } });
  stubConfirmModal(doc);
  await flush(120);

  assert.equal(file.state.writes, 0);
  assert.equal(doc.getElementById("likeCountStatus").textContent, "");
});

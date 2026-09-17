/**
 * popup のテスト。
 * タグ選択・タグセット適用・保存先プリセットの表示制御を検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChromeStub, flush, readSource } from "./helpers/env.mjs";

/**
 * popup を読み込む。
 * @param {object} [initialStore={}] - chrome.storage.local の初期値。
 * @param {{uiLanguage?: string}} [options={}] - ブラウザ側の設定。
 * @returns {Promise<{win: import("jsdom").DOMWindow, doc: Document, store: object}>} テスト環境。
 */
const loadPopup = async (initialStore = {}, options = {}) => {
  const dom = new JSDOM(readSource("popup", "popup.html"), {
    runScripts: "outside-only",
    url: "https://example.org/",
  });
  const win = dom.window;
  const { chrome, store } = createChromeStub(initialStore, options);
  win.chrome = chrome;
  win.eval(readSource("lib", "i18n.js"));
  win.eval(readSource("lib", "noteToMarkdown.js"));
  win.eval(readSource("lib", "convertPanel.js"));
  await flush(40);
  return { win, doc: win.document, store };
};

const change = (win, element) => element.dispatchEvent(new win.Event("change", { bubbles: true }));
const click = (win, element) => element.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

const TAG_STORE = {
  presetTagCandidates: ["学習メモ", "技術検証", "日記"],
  presetTagSets: [
    { id: "set-1", name: "技術ノート", tags: ["学習メモ", "技術検証"] },
    { id: "set-2", name: "日記だけ", tags: ["日記"] },
  ],
};

const checkedTags = (doc) =>
  [...doc.querySelectorAll('#tagSelector input[type="checkbox"]:checked')].map((input) => input.value);

/* -------------------------------- タグ選択 -------------------------------- */

test("タグ候補が未登録ならヒントを表示する", async () => {
  const { doc } = await loadPopup();
  assert.equal(doc.getElementById("tagSelectorHint").classList.contains("hidden"), false);
  assert.equal(doc.querySelectorAll("#tagSelector input").length, 0);
});

test("保存済みのタグ選択を復元する", async () => {
  const { doc } = await loadPopup({ ...TAG_STORE, tags: ["日記"] });
  assert.deepEqual(checkedTags(doc), ["日記"]);
});

test("6つ目のタグは選択できない", async () => {
  const { win, doc } = await loadPopup({ presetTagCandidates: ["a", "b", "c", "d", "e", "f"] });
  const boxes = [...doc.querySelectorAll('#tagSelector input[type="checkbox"]')];
  boxes.slice(0, 5).forEach((box) => {
    box.checked = true;
    change(win, box);
  });
  boxes[5].checked = true;
  change(win, boxes[5]);
  await flush();

  assert.equal(boxes[5].checked, false);
  assert.match(doc.getElementById("status").textContent, /最大5つ/);
});

/* ----------------------------- タグセット適用 ----------------------------- */

test("タグセットが無ければ選択欄を隠す", async () => {
  const { doc } = await loadPopup({ presetTagCandidates: ["日記"] });
  assert.equal(doc.getElementById("tagSetField").classList.contains("hidden"), true);
});

test("タグセットを選ぶとタグが一括適用される", async () => {
  const { win, doc, store } = await loadPopup(TAG_STORE);
  const select = doc.getElementById("tagSetSelect");
  assert.equal(doc.getElementById("tagSetField").classList.contains("hidden"), false);
  assert.equal(select.options.length, 3, "「選択なし」と2セットが並ぶはずです");

  select.value = "set-1";
  change(win, select);
  await flush();

  assert.deepEqual(checkedTags(doc), ["学習メモ", "技術検証"]);
  assert.deepEqual(store.tags, ["学習メモ", "技術検証"]);
  assert.equal(store.selectedTagSetId, "set-1");
});

test("「選択なし」で全解除される", async () => {
  const { win, doc } = await loadPopup({ ...TAG_STORE, tags: ["学習メモ", "技術検証"] });
  const select = doc.getElementById("tagSetSelect");

  select.value = "";
  change(win, select);
  await flush();

  assert.deepEqual(checkedTags(doc), []);
});

test("タグを手動で変えるとセット選択が外れる", async () => {
  const { win, doc } = await loadPopup(TAG_STORE);
  const select = doc.getElementById("tagSetSelect");
  select.value = "set-1";
  change(win, select);
  await flush();

  const box = [...doc.querySelectorAll('#tagSelector input[type="checkbox"]')].find(
    (input) => input.value === "日記"
  );
  box.checked = true;
  change(win, box);
  await flush();

  assert.equal(select.value, "");
});

test("保存済みタグがセットと一致すればセットを選択状態にする", async () => {
  const { doc } = await loadPopup({ ...TAG_STORE, tags: ["技術検証", "学習メモ"] });
  assert.equal(doc.getElementById("tagSetSelect").value, "set-1");
});

test("タグ候補から消えたタグを含むセットは補正して表示する", async () => {
  const { doc } = await loadPopup({
    presetTagCandidates: ["学習メモ"],
    presetTagSets: [{ id: "set-1", name: "技術ノート", tags: ["学習メモ", "消えたタグ"] }],
  });
  const option = [...doc.getElementById("tagSetSelect").options].find((o) => o.value === "set-1");
  assert.ok(option);
  assert.equal(option.textContent.includes("消えたタグ"), false);
});

/* --------------------------- 保存先プリセット表示 --------------------------- */

const PRESET_STORE = {
  presetConfigs: {
    preset1: { name: "仕事メモ", folderLabel: "Work", hasFolder: true },
    preset2: { name: "P2", folderLabel: "", hasFolder: false },
    preset3: { name: "P3", folderLabel: "", hasFolder: false },
  },
};

test("未設定のプリセットは選択できない", async () => {
  const { doc } = await loadPopup(PRESET_STORE);
  const select = doc.getElementById("downloadPreset");
  assert.equal(select.querySelector('option[value="preset1"]').disabled, false);
  assert.equal(select.querySelector('option[value="preset2"]').disabled, true);
  assert.match(select.querySelector('option[value="preset1"]').textContent, /仕事メモ \(Work\)/);
});

test("設定済みプリセットが1つもなければ注意書きを出す", async () => {
  const { win, doc } = await loadPopup();
  const download = doc.querySelector('input[name="outputMode"][value="download"]');
  download.checked = true;
  change(win, download);
  await flush();

  assert.equal(doc.getElementById("downloadLocationField").classList.contains("hidden"), false);
  assert.equal(doc.getElementById("downloadPresetHint").classList.contains("hidden"), false);
});

test("変換後をダウンロードにすると保存先欄が出る", async () => {
  const { win, doc, store } = await loadPopup(PRESET_STORE);
  const download = doc.querySelector('input[name="outputMode"][value="download"]');
  download.checked = true;
  change(win, download);
  await flush();

  assert.equal(doc.getElementById("downloadLocationField").classList.contains("hidden"), false);
  assert.equal(doc.getElementById("downloadPresetHint").classList.contains("hidden"), true);
  assert.equal(store.outputMode, "download");
});

/* -------------------------------- 変換元 --------------------------------- */

test("変換元をURLにするとURL欄が出る", async () => {
  const { win, doc, store } = await loadPopup();
  const urlRadio = doc.querySelector('input[name="sourceMode"][value="url"]');
  urlRadio.checked = true;
  change(win, urlRadio);
  await flush();

  assert.equal(doc.getElementById("urlField").classList.contains("hidden"), false);
  assert.equal(doc.getElementById("tabField").classList.contains("hidden"), true);
  assert.equal(store.sourceMode, "url");
});

/* -------------------------------- 表示言語 -------------------------------- */

test("保存済みの言語設定で popup を英語表示にする", async () => {
  const { doc } = await loadPopup({ uiLanguage: "en", ...PRESET_STORE }, { uiLanguage: "ja" });

  assert.equal(doc.getElementById("sourceModeLabel").textContent, "Source");
  assert.equal(doc.getElementById("convertBtn").textContent, "Convert");
  assert.equal(doc.getElementById("settingsBtn").getAttribute("title"), "Settings");
  assert.equal(doc.documentElement.lang, "en");
});

test("英語表示では未設定プリセットも英語で並べる", async () => {
  const { doc } = await loadPopup({}, { uiLanguage: "en" });
  const select = doc.getElementById("downloadPreset");
  assert.equal(select.querySelector('option[value="preset1"]').textContent, "Preset 1 (not set)");
});

test("英語表示ではタグ上限の警告も英語になる", async () => {
  const { win, doc } = await loadPopup(
    { presetTagCandidates: ["a", "b", "c", "d", "e", "f"] },
    { uiLanguage: "en" }
  );
  const boxes = [...doc.querySelectorAll('#tagSelector input[type="checkbox"]')];
  boxes.slice(0, 5).forEach((box) => {
    box.checked = true;
    change(win, box);
  });
  boxes[5].checked = true;
  change(win, boxes[5]);
  await flush();

  assert.match(doc.getElementById("status").textContent, /up to 5 tags/);
});

test("設定ボタンでオプション画面を開く", async () => {
  const { win, doc } = await loadPopup();
  let opened = false;
  win.chrome.runtime.openOptionsPage = () => {
    opened = true;
  };
  click(win, doc.getElementById("settingsBtn"));
  await flush();
  assert.equal(opened, true);
});

/* ---------------------------- スキ数更新への導線 ---------------------------- */

test("スキ数更新ボタンはオプション画面へ実行を引き継ぐ", async () => {
  const { win, doc, store } = await loadPopup();
  let opened = false;
  win.chrome.runtime.openOptionsPage = () => {
    opened = true;
  };
  win.close = () => {};

  click(win, doc.getElementById("likeCountBtn"));
  await flush(40);

  assert.equal(store.pendingLikeCountRun, true, "実行の意思が引き継がれていません");
  assert.equal(opened, true, "オプション画面が開かれていません");
});

test("スキ数更新ボタンに用途が分かるツールチップを付ける", async () => {
  const { doc } = await loadPopup();
  assert.match(doc.getElementById("likeCountBtn").getAttribute("title"), /スキ数を更新/);

  const { doc: en } = await loadPopup({ uiLanguage: "en" });
  assert.match(en.getElementById("likeCountBtn").getAttribute("title"), /Refresh like counts/);
});

/* ---------------------------- プリセットの件数 ---------------------------- */

test("保存先プリセットの選択肢を5つ並べる", async () => {
  const { doc } = await loadPopup();
  const select = doc.getElementById("downloadPreset");
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ["preset1", "preset2", "preset3", "preset4", "preset5"]
  );
});

test("4つ目以降のプリセットも選択して保存できる", async () => {
  const { win, doc, store } = await loadPopup({
    presetConfigs: {
      preset4: { name: "4番目", folderLabel: "Work", hasFolder: true },
    },
  });
  const select = doc.getElementById("downloadPreset");
  assert.equal(select.querySelector('option[value="preset4"]').disabled, false);

  select.value = "preset4";
  change(win, select);
  await flush();

  assert.equal(store.downloadPreset, "preset4");
});

test("保存済みの選択プリセットを復元する", async () => {
  const { doc } = await loadPopup({
    downloadPreset: "preset5",
    presetConfigs: {
      preset1: { name: "P1", folderLabel: "A", hasFolder: true },
      preset5: { name: "P5", folderLabel: "B", hasFolder: true },
    },
  });
  assert.equal(doc.getElementById("downloadPreset").value, "preset5");
});

/* ------------------------------ 画面の並び ------------------------------ */

test("タグ欄を「変換後」の下に置く", async () => {
  const { doc } = await loadPopup();
  const titles = [...doc.querySelectorAll(".option-group-title")].map((el) => el.id);
  assert.deepEqual(titles, ["sourceModeLabel", "outputModeLabel", "tagSelectorLabel"]);
});

/* ------------------------------ サイドパネル ------------------------------ */

/**
 * サイドパネルを読み込む。popup と同じ共有 JS（lib/convertPanel.js）を使う。
 * @param {object} [initialStore={}] - chrome.storage.local の初期値。
 * @param {{uiLanguage?: string}} [options={}] - ブラウザ側の設定。
 * @returns {Promise<{win: import("jsdom").DOMWindow, doc: Document, store: object}>} テスト環境。
 */
const loadSidePanel = async (initialStore = {}, options = {}) => {
  const dom = new JSDOM(readSource("sidepanel", "sidepanel.html"), {
    runScripts: "outside-only",
    url: "https://example.org/",
  });
  const win = dom.window;
  const { chrome, store } = createChromeStub(initialStore, options);
  win.chrome = chrome;
  win.eval(readSource("lib", "i18n.js"));
  win.eval(readSource("lib", "noteToMarkdown.js"));
  win.eval(readSource("lib", "convertPanel.js"));
  await flush(40);
  return { win, doc: win.document, store };
};

test("popup の「サイドバーで開く」でサイドパネルを開いて popup を閉じる", async () => {
  const { win, doc } = await loadPopup();
  let closed = false;
  win.close = () => {
    closed = true;
  };

  click(win, doc.getElementById("openSidePanelBtn"));
  await flush(40);

  assert.equal(win.chrome.sidePanel.__opened.length, 1);
  assert.equal(win.chrome.sidePanel.__opened[0].windowId, -2, "現在のウィンドウで開いていません");
  assert.equal(closed, true, "開いた後に popup を閉じていません");
});

test("サイドパネルを開けなければエラーを表示して popup は閉じない", async () => {
  const { win, doc } = await loadPopup();
  win.chrome.sidePanel.open = async () => {
    throw new Error("nope");
  };
  let closed = false;
  win.close = () => {
    closed = true;
  };

  click(win, doc.getElementById("openSidePanelBtn"));
  await flush(40);

  assert.equal(closed, false);
  assert.match(doc.getElementById("status").textContent, /サイドバーを開けませんでした/);
});

test("サイドパネルでも popup と同じ機能が使える", async () => {
  const { win, doc, store } = await loadSidePanel({ ...TAG_STORE, ...PRESET_STORE });

  // タグセットの一括適用
  const select = doc.getElementById("tagSetSelect");
  select.value = "set-1";
  change(win, select);
  await flush();
  assert.deepEqual(checkedTags(doc), ["学習メモ", "技術検証"]);

  // 保存先プリセットの表示
  assert.match(
    doc.getElementById("downloadPreset").querySelector('option[value="preset1"]').textContent,
    /仕事メモ \(Work\)/
  );
  assert.equal(store.tags.length, 2);

  // 「サイドバーで開く」は popup 専用なので出さない
  assert.equal(doc.getElementById("openSidePanelBtn"), null);
});

test("サイドパネルはアクティブなタブの変化に追従する", async () => {
  const { win, doc } = await loadSidePanel();
  const listeners = win.chrome.tabs.__onActivated;
  assert.equal(listeners.length, 1, "onActivated を購読していません");
  assert.equal(win.chrome.tabs.__onUpdated.length, 1, "onUpdated を購読していません");

  // 別の記事タブへ移った状況を再現する
  win.chrome.tabs.query = async () => [{ id: 2, url: "https://note.com/hanaviye/n/nxyz789", title: "別の記事｜花冷" }];
  win.chrome.tabs.sendMessage = async () => ({ ok: true, title: "別の記事" });
  listeners.forEach((fn) => fn({ tabId: 2, windowId: 1 }));
  await flush(40);

  assert.equal(doc.getElementById("tabArticleTitle").textContent, "別の記事");
});

test("サイドパネルは読み込み途中のタブ更新では取り直さない", async () => {
  const { win } = await loadSidePanel();
  let queries = 0;
  win.chrome.tabs.query = async () => {
    queries += 1;
    return [{ id: 1, url: "https://note.com/hanaviye/n/nabc123", title: "t" }];
  };

  win.chrome.tabs.__onUpdated.forEach((fn) => fn(1, { status: "loading" }, { active: true }));
  win.chrome.tabs.__onUpdated.forEach((fn) => fn(1, { status: "complete" }, { active: false }));
  await flush(40);
  assert.equal(queries, 0, "不要なタイミングで取り直しています");

  win.chrome.tabs.__onUpdated.forEach((fn) => fn(1, { status: "complete" }, { active: true }));
  await flush(40);
  assert.equal(queries, 1);
});

test("popup はタブの変化を購読しない", async () => {
  const { win } = await loadPopup();
  assert.equal(win.chrome.tabs.__onActivated.length, 0);
  assert.equal(win.chrome.tabs.__onUpdated.length, 0);
});

test("サイドパネルのスキ数更新ボタンは自分を閉じない", async () => {
  const { win, doc, store } = await loadSidePanel();
  let closed = false;
  win.close = () => {
    closed = true;
  };
  let opened = false;
  win.chrome.runtime.openOptionsPage = () => {
    opened = true;
  };

  click(win, doc.getElementById("likeCountBtn"));
  await flush(40);

  assert.equal(store.pendingLikeCountRun, true);
  assert.equal(opened, true);
  assert.equal(closed, false, "サイドパネルは閉じられないので close を呼ぶべきではありません");
});

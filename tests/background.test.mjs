/**
 * Service Worker（background.js）のテスト。
 * chrome API / IndexedDB / File System Access API をスタブし、
 * 保存処理と入力値の正規化を検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readSource } from "./helpers/env.mjs";

/**
 * File System Access API のディレクトリハンドルを模したスタブ。
 * @param {{name?: string, permission?: string}} [options={}] - 挙動の指定。
 * @returns {object} スタブハンドル。
 */
const createDirectoryHandle = ({ name = "root", permission = "granted" } = {}) => {
  const files = new Map();
  const directories = new Map();
  const handle = {
    name,
    files,
    directories,
    queryPermission: async () => permission,
    requestPermission: async () => permission,
    getDirectoryHandle: async (dirName, { create } = {}) => {
      if (/[/\\]/.test(dirName) || dirName === "..") {
        throw Object.assign(new Error("invalid name"), { name: "TypeError" });
      }
      if (!directories.has(dirName)) {
        if (!create) {
          throw Object.assign(new Error("not found"), { name: "NotFoundError" });
        }
        directories.set(dirName, createDirectoryHandle({ name: dirName, permission }));
      }
      return directories.get(dirName);
    },
    getFileHandle: async (fileName, { create } = {}) => {
      if (/[/\\]/.test(fileName)) {
        throw Object.assign(new Error("invalid name"), { name: "TypeError" });
      }
      if (!files.has(fileName)) {
        if (!create) {
          throw Object.assign(new Error("not found"), { name: "NotFoundError" });
        }
        files.set(fileName, { contents: null });
      }
      const entry = files.get(fileName);
      return {
        createWritable: async () => ({
          write: async (data) => {
            entry.contents = data;
          },
          close: async () => {},
        }),
      };
    },
  };
  return handle;
};

/**
 * background.js を評価し、メッセージ送信用のヘルパーを返す。
 * @param {{store?: object, handles?: object, fetchImpl?: Function}} [options={}] - 環境設定。
 * @returns {{send: Function, context: object}} 実行環境。
 */
const loadBackground = ({ store = {}, handles = {}, fetchImpl } = {}) => {
  let listener = null;
  const fetchCalls = [];

  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    TextEncoder,
    Uint8Array,
    Error,
    fetchCalls,
    fetch:
      fetchImpl ??
      (async (url) => {
        fetchCalls.push(url);
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode("image").buffer };
      }),
    chrome: {
      i18n: { getUILanguage: () => "ja" },
      runtime: {
        id: "test-extension-id",
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
            keys.forEach((key) => {
              if (key in store) {
                result[key] = store[key];
              }
            });
            return result;
          },
        },
      },
    },
    indexedDB: {
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
              }),
            }),
            close: () => {},
          };
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
  context.self = context;
  context.globalThis = context;
  // Service Worker の importScripts と同じく、同じグローバルへ同期的に評価する。
  context.importScripts = (...paths) => {
    paths.forEach((path) => vm.runInContext(readSource(...path.split("/")), context));
  };
  vm.createContext(context);
  vm.runInContext(readSource("background.js"), context);

  const send = (message, sender = { id: "test-extension-id" }) =>
    new Promise((resolve) => {
      const handled = listener(message, sender, resolve);
      if (handled !== true) {
        resolve(undefined);
      }
    });

  return { send, context };
};

/* ------------------------------ Markdown 保存 ----------------------------- */

test("プリセットフォルダへ .md を保存する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Notes" });
  const { send } = loadBackground({
    store: { presetConfigs: { preset1: { name: "P1", folderLabel: "Notes", hasFolder: true } } },
    handles: { preset1: rootHandle },
  });

  const response = await send({
    type: "downloadMarkdownByPreset",
    markdown: "# 本文",
    articleUrl: "https://note.com/hanaviye/n/nabc123",
    downloadPreset: "preset1",
  });

  assert.equal(response.ok, true);
  assert.equal(response.filename, "nabc123.md");
  assert.equal(response.overwritten, false);
  assert.equal(rootHandle.files.get("nabc123.md").contents, "# 本文");
});

test("同名ファイルがある場合は上書きとして報告する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Notes" });
  rootHandle.files.set("nabc123.md", { contents: "古い内容" });
  const { send } = loadBackground({
    store: { presetConfigs: { preset1: { name: "P1", folderLabel: "Notes", hasFolder: true } } },
    handles: { preset1: rootHandle },
  });

  const response = await send({
    type: "downloadMarkdownByPreset",
    markdown: "新しい内容",
    articleUrl: "https://note.com/hanaviye/n/nabc123",
    downloadPreset: "preset1",
  });

  assert.equal(response.overwritten, true);
  assert.equal(rootHandle.files.get("nabc123.md").contents, "新しい内容");
});

test("フォルダ未設定のプリセットはエラーを返す", async () => {
  const { send } = loadBackground({
    store: { presetConfigs: { preset1: { name: "P1", folderLabel: "", hasFolder: false } } },
  });
  const response = await send({
    type: "downloadMarkdownByPreset",
    markdown: "x",
    articleUrl: "https://note.com/hanaviye/n/nabc123",
    downloadPreset: "preset1",
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /保存先フォルダが設定されていません/);
});

test("権限が失効している場合は再許可を案内する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Notes", permission: "prompt" });
  const { send } = loadBackground({
    store: { presetConfigs: { preset1: { name: "P1", folderLabel: "Notes", hasFolder: true } } },
    handles: { preset1: rootHandle },
  });
  const response = await send({
    type: "downloadMarkdownByPreset",
    markdown: "x",
    articleUrl: "https://note.com/hanaviye/n/nabc123",
    downloadPreset: "preset1",
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /アクセスを再許可/);
});

test("保存済みの言語設定でエラー文言を英語にする", async () => {
  const { send } = loadBackground({
    store: {
      uiLanguage: "en",
      presetConfigs: { preset1: { name: "", folderLabel: "", hasFolder: false } },
    },
  });
  const response = await send({
    type: "downloadMarkdownByPreset",
    markdown: "x",
    articleUrl: "https://note.com/hanaviye/n/nabc123",
    downloadPreset: "preset1",
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /^“Preset 1” has no destination folder\./);
});

test("ファイル名を抽出できないURLは既定名で保存する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Notes" });
  const { send } = loadBackground({
    store: { presetConfigs: { preset1: { name: "P1", folderLabel: "Notes", hasFolder: true } } },
    handles: { preset1: rootHandle },
  });
  const response = await send({
    type: "downloadMarkdownByPreset",
    markdown: "x",
    articleUrl: "not-a-url",
    downloadPreset: "preset1",
  });
  assert.equal(response.filename, "note-article.md");
});

/* -------------------------------- 画像保存 -------------------------------- */

const imageStore = { imageFolderConfig: { folderLabel: "Images", hasFolder: true } };

test("画像を note ID フォルダ配下へ保存する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Images" });
  const { send, context } = loadBackground({ store: imageStore, handles: { imageFolder: rootHandle } });

  const response = await send({
    type: "saveImagesForArticle",
    noteId: "nabc123",
    images: [
      { filename: "img1.png", url: "https://assets.st-note.com/img/a.png" },
      { filename: "img2.jpg", url: "https://assets.st-note.com/img/b.jpg" },
    ],
  });

  assert.equal(response.ok, true);
  assert.equal(response.savedCount, 2);
  assert.deepEqual([...rootHandle.directories.get("nabc123").files.keys()], ["img1.png", "img2.jpg"]);
  assert.equal(context.fetchCalls.length, 2);
});

test("許可ホスト以外の画像URLは取得しない", async () => {
  const rootHandle = createDirectoryHandle({ name: "Images" });
  const { send, context } = loadBackground({ store: imageStore, handles: { imageFolder: rootHandle } });

  const response = await send({
    type: "saveImagesForArticle",
    noteId: "nabc123",
    images: [{ filename: "img1.png", url: "https://evil.example.com/track.png" }],
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /許可されていない画像URL/);
  assert.equal(context.fetchCalls.length, 0);
});

test("http の画像URLは取得しない", async () => {
  const rootHandle = createDirectoryHandle({ name: "Images" });
  const { send, context } = loadBackground({ store: imageStore, handles: { imageFolder: rootHandle } });
  const response = await send({
    type: "saveImagesForArticle",
    noteId: "nabc123",
    images: [{ filename: "img1.png", url: "http://assets.st-note.com/img/a.png" }],
  });
  assert.equal(response.ok, false);
  assert.equal(context.fetchCalls.length, 0);
});

test("パス区切りを含むファイル名は保存対象から除外する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Images" });
  const { send } = loadBackground({ store: imageStore, handles: { imageFolder: rootHandle } });

  const response = await send({
    type: "saveImagesForArticle",
    noteId: "nabc123",
    images: [
      { filename: "../../evil.png", url: "https://assets.st-note.com/img/a.png" },
      { filename: "sub/dir.png", url: "https://assets.st-note.com/img/b.png" },
      { filename: "..\\evil.png", url: "https://assets.st-note.com/img/c.png" },
      { filename: "img1.png", url: "https://assets.st-note.com/img/d.png" },
    ],
  });

  assert.equal(response.ok, true);
  assert.deepEqual([...rootHandle.directories.get("nabc123").files.keys()], ["img1.png"]);
});

test("noteId のパス区切りも除去する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Images" });
  const { send } = loadBackground({ store: imageStore, handles: { imageFolder: rootHandle } });

  await send({
    type: "saveImagesForArticle",
    noteId: "../../escaped",
    images: [{ filename: "img1.png", url: "https://assets.st-note.com/img/a.png" }],
  });

  assert.deepEqual([...rootHandle.directories.keys()], ["escaped"]);
});

test("一部の画像が失敗しても成功分は保存する", async () => {
  const rootHandle = createDirectoryHandle({ name: "Images" });
  let call = 0;
  const { send } = loadBackground({
    store: imageStore,
    handles: { imageFolder: rootHandle },
    fetchImpl: async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 404 };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("image").buffer };
    },
  });

  const response = await send({
    type: "saveImagesForArticle",
    noteId: "nabc123",
    images: [
      { filename: "img1.png", url: "https://assets.st-note.com/img/a.png" },
      { filename: "img2.png", url: "https://assets.st-note.com/img/b.png" },
    ],
  });

  assert.equal(response.ok, true);
  assert.equal(response.savedCount, 1);
});

/* ------------------------------ メッセージ検証 ----------------------------- */

test("他の拡張機能からのメッセージは処理しない", async () => {
  const rootHandle = createDirectoryHandle({ name: "Notes" });
  const { send } = loadBackground({
    store: { presetConfigs: { preset1: { name: "P1", folderLabel: "Notes", hasFolder: true } } },
    handles: { preset1: rootHandle },
  });

  const response = await send(
    {
      type: "downloadMarkdownByPreset",
      markdown: "x",
      articleUrl: "https://note.com/hanaviye/n/nabc123",
      downloadPreset: "preset1",
    },
    { id: "other-extension-id" }
  );

  assert.equal(response, undefined);
  assert.equal(rootHandle.files.size, 0);
});

test("未知のメッセージ種別には応答しない", async () => {
  const { send } = loadBackground();
  assert.equal(await send({ type: "unknown" }), undefined);
});

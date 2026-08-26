/**
 * ストア掲載用スクリーンショット（1280x800）を生成する。
 *
 * dist/ の実UIをそのまま使い、chrome API だけをスタブして
 * サンプルデータを流し込んだ状態をヘッドレス Chrome で撮影する。
 *
 * レイアウトは 640x400 のまま描画倍率だけ 2 倍にして撮る。
 * ストアが許すサイズは 1280x800 か 640x400 の2種類だけで縦横比が同じなので、
 * こうすると構図を変えずに解像度だけ上げられる。
 *
 * 実行: npm run make:screenshots（事前に npm run build:dist が必要）
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** レイアウト上の寸法（CSSピクセル）。 */
const WIDTH = 640;
const HEIGHT = 400;
/** 描画倍率。出力は WIDTH*SCALE x HEIGHT*SCALE になる。 */
const SCALE = 2;
const OUT_DIR = "docs/screenshots";
const SOURCE_DIR = "dist";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!chromePath) {
  console.error("Chrome / Edge が見つかりません。CHROME_CANDIDATES にパスを追加してください。");
  process.exit(1);
}
if (!existsSync(`${SOURCE_DIR}/popup/popup.html`)) {
  console.error("dist/ がありません。先に npm run build:dist を実行してください。");
  process.exit(1);
}

/** 掲載イメージ用のサンプル設定。実際の保存データと同じ形式にする。 */
const SAMPLE_STORAGE = {
  uiLanguage: "ja",
  sourceMode: "tab",
  outputMode: "download",
  articleUrl: "",
  tags: ["エンジニア", "学習メモ"],
  downloadPreset: "preset2",
  imageImportMode: "download",
  imageFolderConfig: { folderLabel: "note-images", hasFolder: true },
  presetConfigs: {
    preset1: { name: "仕事メモ", folderLabel: "work-notes", hasFolder: true },
    preset2: { name: "Obsidian Inbox", folderLabel: "obsidian-inbox", hasFolder: true },
    preset3: { name: "公開記事", folderLabel: "note-public", hasFolder: true },
    preset4: { name: "下書き置き場", folderLabel: "", hasFolder: false },
    preset5: { name: "", folderLabel: "", hasFolder: false },
  },
  presetTagCandidates: ["エンジニア", "学習メモ", "技術検証", "日記", "気づき", "読書メモ"],
  presetTagSets: [
    { id: "set-1", name: "技術ノート", tags: ["エンジニア", "技術検証"] },
    { id: "set-2", name: "日々の記録", tags: ["日記", "気づき"] },
  ],
  selectedTagSetId: "",
  presetObsidianLinkWords: ["Obsidian", "Markdown", "note"],
  obsidianLinkify: true,
};

/**
 * chrome API と IndexedDB を模したスタブスクリプトを組み立てる。
 * @param {object} [overrides={}] - サンプル設定の上書き。
 * @returns {string} スタブのJavaScript。
 */
const buildStub = (overrides = {}) => `
(() => {
  const store = ${JSON.stringify({ ...SAMPLE_STORAGE, ...overrides })};
  const handle = {
    name: "folder",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  };
  window.chrome = {
    i18n: { getUILanguage: () => "ja" },
    runtime: {
      id: "screenshot",
      openOptionsPage: () => {},
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener: () => {} },
    },
    storage: {
      local: {
        get: async (keys) => {
          const result = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
            if (key in store) { result[key] = store[key]; }
          });
          return result;
        },
        set: async (values) => Object.assign(store, values),
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://note.com/hanaviye/n/n361272941d2a", title: "はじめまして！花冷（はなびえ）です🌸｜花冷" }],
      sendMessage: async (_id, message) =>
        message.type === "getArticleTitle"
          ? { ok: true, title: "はじめまして！花冷（はなびえ）です🌸" }
          : { ok: true },
    },
  };
  window.indexedDB = {
    open: () => {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => {},
          transaction: () => ({ objectStore: () => ({ get: (key) => { const r = {}; queueMicrotask(() => { r.result = handle; r.onsuccess?.(); }); return r; }, put: () => {}, delete: () => {} }) }),
          close: () => {},
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
})();
`;

/** popup を枠付きで中央に置くための追加スタイル。 */
const POPUP_FRAME_STYLE = `
  html {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(140deg, #eef6fb 0%, #ffffff 50%, #fdf1f5 100%);
  }
  body {
    border: 1px solid #dce9f0;
    border-radius: 14px;
    box-shadow: 0 14px 40px rgba(90, 143, 168, 0.22);
    /* popup の実寸（幅420px・高さ約520px）を 640x400 に収める */
    transform: scale(0.74);
  }
`;

const workDir = mkdtempSync(join(tmpdir(), "ntm-shots-"));
mkdirSync(OUT_DIR, { recursive: true });

/** 撮影用の作業ディレクトリへ dist の資材を複製する。 */
cpSync(SOURCE_DIR, workDir, { recursive: true });

/**
 * 撮影用HTMLを生成する。
 * @param {{name: string, page: "popup"|"options", extraStyle?: string, script?: string, storage?: object}} params - 生成条件。
 * @returns {string} 生成したHTMLのパス。
 */
const buildShotPage = ({ name, page, extraStyle = "", script = "", storage = {} }) => {
  const stubName = `_stub-${name}.js`;
  writeFileSync(join(workDir, stubName), buildStub(storage), "utf8");
  const source = readFileSync(join(workDir, page, `${page}.html`), "utf8");
  const html = source
    .replace("<body>", `<body>\n<script src="../${stubName}"></script>`)
    .replace(
      "</head>",
      `<style>${extraStyle}</style></head>`
    )
    .replace("</body>", `<script>${script}</script>\n</body>`);
  const path = join(workDir, page, `_shot-${name}.html`);
  writeFileSync(path, html, "utf8");
  return path;
};

/**
 * PNG の IHDR を読み、サイズと色タイプを返す。
 * @param {string} path - PNG のパス。
 * @returns {{width: number, height: number, bitDepth: number, colorType: number}} 画像情報。
 */
const readPngHeader = (path) => {
  const buffer = readFileSync(path);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
};

/**
 * ヘッドレス Chrome で1枚撮影し、ストアの要件を満たしているか検査する。
 * @param {string} htmlPath - 撮影対象HTMLのパス。
 * @param {string} outputName - 出力ファイル名。
 */
const capture = (htmlPath, outputName) => {
  const output = resolve(OUT_DIR, outputName);
  execFileSync(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--force-device-scale-factor=${SCALE}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      "--virtual-time-budget=3000",
      `--screenshot=${output}`,
      `file:///${resolve(htmlPath).replace(/\\/g, "/")}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  const header = readPngHeader(output);
  if (header.width !== WIDTH * SCALE || header.height !== HEIGHT * SCALE) {
    console.error(
      `${outputName}: サイズが ${header.width}x${header.height} です（期待: ${WIDTH * SCALE}x${HEIGHT * SCALE}）。`
    );
    process.exit(1);
  }
  // 色タイプ 2 = トゥルーカラー（アルファなし）。6 だとアルファ付きでストアに弾かれる。
  if (header.colorType !== 2 || header.bitDepth !== 8) {
    console.error(
      `${outputName}: 24 ビット（アルファなし）ではありません（bitDepth=${header.bitDepth}, colorType=${header.colorType}）。`
    );
    process.exit(1);
  }
  console.log(`captured: ${OUT_DIR}/${outputName} (${header.width}x${header.height}, 24bit)`);
};

/**
 * 指定したセクションだけを表示するスタイルを組み立てる。
 * スクロール位置に依存せず、狙ったセクションを確実に画面上部へ出すため。
 * @param {string[]} keepTitleIds - 残すセクションの見出しID。
 * @returns {string} 追加スタイル。
 */
const onlySections = (keepTitleIds) => {
  const all = [
    "languageSectionTitle",
    "presetSectionTitle",
    "imageImportSectionTitle",
    "tagSectionTitle",
    "tagSetSectionTitle",
    "obsidianSectionTitle",
    "likeCountSectionTitle",
    "transferSectionTitle",
  ];
  const hidden = all
    .filter((id) => !keepTitleIds.includes(id))
    .map((id) => `[aria-labelledby="${id}"]`)
    .join(", ");
  return `
    .page-title, .page-intro { display: none; }
    .container { padding-top: 16px; }
    ${hidden ? `${hidden} { display: none; }` : ""}
    .settings-section { margin-bottom: 18px; padding-bottom: 18px; }
  `;
};

const SHOTS = [
  {
    name: "01-popup",
    page: "popup",
    extraStyle: POPUP_FRAME_STYLE,
    storage: {
      outputMode: "copy",
      tags: ["エンジニア", "技術検証"],
      selectedTagSetId: "set-1",
      presetTagCandidates: ["エンジニア", "技術検証", "日記", "読書メモ"],
    },
  },
  {
    name: "02-options-presets",
    page: "options",
    // プリセット5件が収まるよう余白と倍率を詰める。
    // 撮影は描画倍率2倍なので、CSS上で小さくしても出力は潰れない。
    extraStyle: `${onlySections(["presetSectionTitle"])}
      .preset-card { padding: 7px 10px; }
      .preset-card h3 { margin-bottom: 2px; font-size: 14px; }
      .preset-card label { margin-bottom: 2px; }
      .preset-card input[type="text"] { padding: 4px 8px; }
      .preset-list { gap: 6px; }
      .settings-section > .hint.inline { display: none; }
      .container { padding-top: 8px; transform: scale(0.56); transform-origin: top center; }`,
  },
  {
    name: "03-options-image",
    page: "options",
    extraStyle: onlySections(["imageImportSectionTitle"]),
  },
  {
    // ストアのスクリーンショットは最大5枚のため、タグ候補ではなく
    // 差別化要素であるタグセットプリセットを掲載する
    name: "04-options-tagsets",
    page: "options",
    // 登録済みセット2件が下で切れないよう、わずかに縮めて収める
    extraStyle: `${onlySections(["tagSetSectionTitle"])}
      .container { transform: scale(0.9); transform-origin: top center; }`,
  },
  {
    name: "05-options-obsidian",
    page: "options",
    // 内容が短いため上下の余白を均す
    extraStyle: `${onlySections(["obsidianSectionTitle"])}
      .container { padding-top: 70px; }`,
  },
];

for (const shot of SHOTS) {
  capture(buildShotPage(shot), `${shot.name}.png`);
}

rmSync(workDir, { recursive: true, force: true });
console.log(`\n${SHOTS.length} 枚を ${WIDTH * SCALE}x${HEIGHT * SCALE} で ${OUT_DIR}/ に出力しました。`);

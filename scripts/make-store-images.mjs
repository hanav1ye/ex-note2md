/**
 * Chrome ウェブストア掲載用のプロモーションタイルを生成する。
 *
 * ストアの要件は「JPEG または 24 ビット PNG（アルファなし）」で、サイズは
 * プロモーションタイル（小）440x280 / マーキー 1400x560 の固定。
 * 背景を完全な不透明にしておくと Chrome は色タイプ 2（アルファなし）で書き出すため、
 * 生成後に IHDR を読み直して要件を満たしているか検査する。
 *
 * 実行: npm run make:store-images
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT_DIR = "docs/screenshots";
const ICON_PATH = "icons/icon128.png";

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

/** アイコンから採取した配色。タイルと拡張機能の見た目を揃えるために使う。 */
const COLOR = {
  navyDark: "#161a2e",
  navy: "#1e2340",
  navyLight: "#28305180",
  pink: "#f0bccb",
  blue: "#c3e2ec",
  text: "#ffffff",
};

const NAME = "note to Markdown";
const TAGLINE = "Turn note articles into Markdown.";

const iconDataUri = `data:image/png;base64,${readFileSync(ICON_PATH).toString("base64")}`;

/**
 * タイル共通のスタイルを組み立てる。
 * @param {number} width - キャンバス幅。
 * @param {number} height - キャンバス高さ。
 * @returns {string} CSS。
 */
const baseStyle = (width, height) => `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    /* アルファ無しで書き出させるため、背景は必ず不透明にする */
    background: ${COLOR.navy};
  }
  body {
    position: relative;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: ${COLOR.text};
    background: ${COLOR.navy};
  }
  /*
   * アイコンの斜め分割を踏襲した帯。
   * 濃く出すと文字の上を横切って読みにくくなるため、地の模様として感じる程度に留める。
   */
  .band {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(112deg,
        rgba(0, 0, 0, 0) 34%,
        rgba(195, 226, 236, 0.055) 39%,
        rgba(195, 226, 236, 0.055) 51%,
        rgba(240, 188, 203, 0.075) 56%,
        rgba(240, 188, 203, 0.075) 65%,
        rgba(0, 0, 0, 0) 70%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(0, 0, 0, 0.16) 100%);
  }
  /* アイコンのアールデコ枠に合わせた細い内枠 */
  .frame {
    position: absolute;
    border: 1px solid rgba(195, 226, 236, 0.28);
  }
  .icon {
    display: block;
    border-radius: 16%;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  }
  .name { font-weight: 700; letter-spacing: 0.01em; }
  .tagline { color: ${COLOR.blue}; font-weight: 500; }
  .rule {
    background: linear-gradient(90deg, ${COLOR.pink}, ${COLOR.blue});
    border-radius: 2px;
  }
  .content { position: relative; }
`;

/** プロモーションタイル（小）440x280。中央寄せの縦積み。 */
const SMALL_TILE_HTML = `
<style>
  ${baseStyle(440, 280)}
  .frame { inset: 12px; border-radius: 4px; }
  .content {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 13px;
    padding: 0 30px;
    text-align: center;
  }
  .icon { width: 72px; height: 72px; }
  .name { font-size: 27px; }
  .rule { width: 54px; height: 3px; }
  .tagline { font-size: 14.5px; line-height: 1.45; }
</style>
<div class="band"></div>
<div class="frame"></div>
<div class="content">
  <img class="icon" src="${iconDataUri}" alt="" />
  <div class="name">${NAME}</div>
  <div class="rule"></div>
  <div class="tagline">${TAGLINE}</div>
</div>
`;

/** マーキープロモーションタイル 1400x560。アイコンとテキストを横並びにする。 */
const MARQUEE_TILE_HTML = `
<style>
  ${baseStyle(1400, 560)}
  .frame { inset: 28px; border-radius: 6px; }
  .content {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 52px;
    /* ストア側で端が切られても中身が欠けないよう、内容は中央に寄せる */
    padding: 0 120px;
  }
  /* 128px の原寸で置いて拡大によるボケを避ける */
  .icon { width: 128px; height: 128px; flex: none; }
  .text { display: flex; flex-direction: column; gap: 16px; }
  .name { font-size: 58px; line-height: 1.1; }
  .rule { width: 92px; height: 4px; }
  .tagline { font-size: 26px; line-height: 1.4; }
</style>
<div class="band"></div>
<div class="frame"></div>
<div class="content">
  <img class="icon" src="${iconDataUri}" alt="" />
  <div class="text">
    <div class="name">${NAME}</div>
    <div class="rule"></div>
    <div class="tagline">${TAGLINE}</div>
  </div>
</div>
`;

const TILES = [
  { name: "promo-tile-small.png", width: 440, height: 280, html: SMALL_TILE_HTML },
  { name: "promo-tile-marquee.png", width: 1400, height: 560, html: MARQUEE_TILE_HTML },
];

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

const workDir = mkdtempSync(join(tmpdir(), "ntm-store-"));
mkdirSync(OUT_DIR, { recursive: true });

for (const tile of TILES) {
  const htmlPath = join(workDir, `${tile.name}.html`);
  writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8">${tile.html}`, "utf8");

  const output = resolve(OUT_DIR, tile.name);
  execFileSync(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${tile.width},${tile.height}`,
      "--virtual-time-budget=3000",
      `--screenshot=${output}`,
      `file:///${resolve(htmlPath).replace(/\\/g, "/")}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  const header = readPngHeader(output);
  if (header.width !== tile.width || header.height !== tile.height) {
    console.error(
      `${tile.name}: サイズが ${header.width}x${header.height} です（期待: ${tile.width}x${tile.height}）。`
    );
    process.exit(1);
  }
  // 色タイプ 2 = トゥルーカラー（アルファなし）。6 だとアルファ付きでストアに弾かれる。
  if (header.colorType !== 2 || header.bitDepth !== 8) {
    console.error(
      `${tile.name}: 24 ビット（アルファなし）ではありません（bitDepth=${header.bitDepth}, colorType=${header.colorType}）。`
    );
    process.exit(1);
  }
  console.log(`captured: ${OUT_DIR}/${tile.name} (${header.width}x${header.height}, 24bit)`);
}

rmSync(workDir, { recursive: true, force: true });
console.log(`\n${TILES.length} 枚を ${OUT_DIR}/ に出力しました。`);

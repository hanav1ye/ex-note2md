/**
 * Chrome ウェブストア提出用の dist/ を生成する。
 *
 * 提出物が未検証のまま出来上がらないよう、ビルド前に
 * バージョン整合・manifest の参照ファイル・lint・テストを確認する。
 * 検証を省略したい場合のみ --skip-verify を付ける。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const DIST_DIR = "dist";
const skipVerify = process.argv.includes("--skip-verify");

/**
 * シェルコマンドを同期実行する。
 * @param {string} command - 実行コマンド。
 */
const run = (command) => {
  execSync(command, { stdio: "inherit" });
};

/**
 * ビルドを中止する。
 * @param {string} message - 失敗理由。
 */
const fail = (message) => {
  console.error(`ビルドを中止しました: ${message}`);
  process.exit(1);
};

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

/** manifest と package.json のバージョンずれを防ぐ。 */
if (manifest.version !== pkg.version) {
  fail(
    `manifest.json (${manifest.version}) と package.json (${pkg.version}) のバージョンが一致していません。`
  );
}

/** ストア提出時に弾かれやすい形式をあらかじめ検査する。 */
if (manifest.manifest_version !== 3) {
  fail(
    `manifest.json の manifest_version は整数の 3 である必要があります: ${JSON.stringify(manifest.manifest_version)}`
  );
}
if (typeof manifest.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  fail(`manifest.json の version 形式が不正です: ${JSON.stringify(manifest.version)}`);
}

/**
 * name / description は __MSG_*__ 参照なので、実文言は _locales 側を検査する。
 * default_locale の欠落や未定義メッセージは読み込み時エラーになるため事前に弾く。
 */
const LOCALE_DIRS = ["ja", "en"];
const REQUIRED_MESSAGE_KEYS = ["appName", "appDescription", "actionTitle"];

if (!manifest.default_locale) {
  fail("_locales を使う場合は manifest.json に default_locale が必要です。");
}
if (!LOCALE_DIRS.includes(manifest.default_locale)) {
  fail(`default_locale (${manifest.default_locale}) に対応する _locales がありません。`);
}

LOCALE_DIRS.forEach((locale) => {
  const path = `_locales/${locale}/messages.json`;
  if (!existsSync(path)) {
    fail(`${path} がありません。`);
  }
  const messages = JSON.parse(readFileSync(path, "utf8"));
  const missingKeys = REQUIRED_MESSAGE_KEYS.filter((key) => !messages[key]?.message);
  if (missingKeys.length > 0) {
    fail(`${path} にメッセージがありません: ${missingKeys.join(", ")}`);
  }
  if (messages.appDescription.message.length > 132) {
    fail(`${path} の appDescription は 132 文字以内である必要があります。`);
  }
});

/** manifest が参照するファイルの実在を確認する。 */
const referencedFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...Object.values(manifest.icons ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((entry) => [...(entry.js ?? []), ...(entry.css ?? [])]),
].filter(Boolean);

const missing = referencedFiles.filter((file) => !existsSync(file));
if (missing.length > 0) {
  fail(`manifest.json が参照するファイルがありません: ${missing.join(", ")}`);
}

/** lint とテストを通過した状態だけを配布物にする。 */
if (skipVerify) {
  console.warn("警告: --skip-verify が指定されたため lint / test を省略しました。");
} else {
  run("npm run lint");
  run("npm test");
}

/** 古い dist を削除して配布用フォルダを再作成する。 */
rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(`${DIST_DIR}/content`, { recursive: true });
mkdirSync(`${DIST_DIR}/icons`, { recursive: true });
mkdirSync(`${DIST_DIR}/lib`, { recursive: true });
mkdirSync(`${DIST_DIR}/options`, { recursive: true });
mkdirSync(`${DIST_DIR}/popup`, { recursive: true });
mkdirSync(`${DIST_DIR}/sidepanel`, { recursive: true });

/** HTML/manifest/画像など、圧縮不要の静的ファイルをコピーする。 */
cpSync("manifest.json", `${DIST_DIR}/manifest.json`);
cpSync("popup/popup.html", `${DIST_DIR}/popup/popup.html`);
cpSync("options/options.html", `${DIST_DIR}/options/options.html`);
cpSync("sidepanel/sidepanel.html", `${DIST_DIR}/sidepanel/sidepanel.html`);
cpSync("icons", `${DIST_DIR}/icons`, { recursive: true });
cpSync("_locales", `${DIST_DIR}/_locales`, { recursive: true });

/** JavaScript/CSS を minify して dist 配下へ出力する。 */
run('npx --no-install terser "background.js" -c -m -o "dist/background.js"');
run('npx --no-install terser "content/content.js" -c -m -o "dist/content/content.js"');
run('npx --no-install terser "lib/i18n.js" -c -m -o "dist/lib/i18n.js"');
run('npx --no-install terser "lib/likeCount.js" -c -m -o "dist/lib/likeCount.js"');
run('npx --no-install terser "lib/noteToMarkdown.js" -c -m -o "dist/lib/noteToMarkdown.js"');
run('npx --no-install terser "lib/convertPanel.js" -c -m -o "dist/lib/convertPanel.js"');
run('npx --no-install terser "options/options.js" -c -m -o "dist/options/options.js"');
run('npx --no-install clean-css-cli -o "dist/popup/popup.css" "popup/popup.css"');
run('npx --no-install clean-css-cli -o "dist/options/options.css" "options/options.css"');
run('npx --no-install clean-css-cli -o "dist/sidepanel/sidepanel.css" "sidepanel/sidepanel.css"');

/** 出力漏れがないことを確認する。 */
const expectedOutputs = [
  "manifest.json",
  "background.js",
  "content/content.js",
  "lib/i18n.js",
  "lib/likeCount.js",
  "lib/noteToMarkdown.js",
  "_locales/ja/messages.json",
  "_locales/en/messages.json",
  "popup/popup.html",
  "lib/convertPanel.js",
  "popup/popup.css",
  "options/options.html",
  "options/options.js",
  "options/options.css",
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];
const emptyOrMissing = expectedOutputs.filter((file) => {
  const path = `${DIST_DIR}/${file}`;
  return !existsSync(path) || statSync(path).size === 0;
});
if (emptyOrMissing.length > 0) {
  fail(`dist の出力が不足しています: ${emptyOrMissing.join(", ")}`);
}

/**
 * dist は生成物なので手で編集しないこと。
 * それでも壊れた状態のまま提出しないよう、出力側の JSON も読み直して検査する。
 */
try {
  const distManifest = JSON.parse(readFileSync(`${DIST_DIR}/manifest.json`, "utf8"));
  if (distManifest.manifest_version !== 3 || distManifest.version !== manifest.version) {
    fail("dist/manifest.json の内容が manifest.json と一致していません。");
  }
} catch (error) {
  fail(`dist/manifest.json を JSON として読めません: ${error.message}`);
}

/** minify 後の成果物そのものに対しても同じテストを流す。 */
if (!skipVerify) {
  run("npm run test:dist");
}

console.log(`dist build complete (version ${manifest.version})`);

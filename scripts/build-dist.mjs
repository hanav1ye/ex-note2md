import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * シェルコマンドを同期実行する。
 * @param {string} command - 実行コマンド。
 */
const run = (command) => {
  execSync(command, { stdio: "inherit" });
};

const DIST_DIR = "dist";

/** 古い dist を削除して配布用フォルダを再作成する。 */
rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(`${DIST_DIR}/content`, { recursive: true });
mkdirSync(`${DIST_DIR}/icons`, { recursive: true });
mkdirSync(`${DIST_DIR}/lib`, { recursive: true });
mkdirSync(`${DIST_DIR}/options`, { recursive: true });
mkdirSync(`${DIST_DIR}/popup`, { recursive: true });

/** HTML/manifest/画像など、圧縮不要の静的ファイルをコピーする。 */
cpSync("manifest.json", `${DIST_DIR}/manifest.json`);
cpSync("popup/popup.html", `${DIST_DIR}/popup/popup.html`);
cpSync("options/options.html", `${DIST_DIR}/options/options.html`);
cpSync("icons", `${DIST_DIR}/icons`, { recursive: true });

/** JavaScript/CSS を minify して dist 配下へ出力する。 */
run('npx --yes terser "background.js" -c -m -o "dist/background.js"');
run('npx --yes terser "content/content.js" -c -m -o "dist/content/content.js"');
run('npx --yes terser "lib/noteToMarkdown.js" -c -m -o "dist/lib/noteToMarkdown.js"');
run('npx --yes terser "popup/popup.js" -c -m -o "dist/popup/popup.js"');
run('npx --yes terser "options/options.js" -c -m -o "dist/options/options.js"');
run('npx --yes clean-css-cli -o "dist/popup/popup.css" "popup/popup.css"');
run('npx --yes clean-css-cli -o "dist/options/options.css" "options/options.css"');

console.log("dist build complete");

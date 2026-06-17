import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const run = (command) => {
  execSync(command, { stdio: "inherit" });
};

const DIST_DIR = "dist";

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(`${DIST_DIR}/content`, { recursive: true });
mkdirSync(`${DIST_DIR}/icons`, { recursive: true });
mkdirSync(`${DIST_DIR}/lib`, { recursive: true });
mkdirSync(`${DIST_DIR}/options`, { recursive: true });
mkdirSync(`${DIST_DIR}/popup`, { recursive: true });

cpSync("manifest.json", `${DIST_DIR}/manifest.json`);
cpSync("popup/popup.html", `${DIST_DIR}/popup/popup.html`);
cpSync("options/options.html", `${DIST_DIR}/options/options.html`);
cpSync("icons", `${DIST_DIR}/icons`, { recursive: true });

run('npx --yes terser "background.js" -c -m -o "dist/background.js"');
run('npx --yes terser "content/content.js" -c -m -o "dist/content/content.js"');
run('npx --yes terser "lib/noteToMarkdown.js" -c -m -o "dist/lib/noteToMarkdown.js"');
run('npx --yes terser "popup/popup.js" -c -m -o "dist/popup/popup.js"');
run('npx --yes terser "options/options.js" -c -m -o "dist/options/options.js"');
run('npx --yes clean-css-cli -o "dist/popup/popup.css" "popup/popup.css"');
run('npx --yes clean-css-cli -o "dist/options/options.css" "options/options.css"');

console.log("dist build complete");

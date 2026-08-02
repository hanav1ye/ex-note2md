/**
 * ビルド済みの dist/ に対してテストスイートを実行する。
 *
 * 実際にブラウザへ読み込むのは minify 済みの dist なので、
 * ソースだけでなく成果物そのものも同じテストで検証する。
 *
 * 実行: npm run test:dist（事前に npm run build:dist が必要）
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("dist/manifest.json")) {
  console.error("dist/ がありません。先に npm run build:dist を実行してください。");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", "tests/**/*.test.mjs"], {
  stdio: "inherit",
  env: { ...process.env, NTM_TARGET: "dist" },
});

process.exit(result.status ?? 1);

/**
 * ゴールデンテストの期待Markdownを再生成する。
 *
 * 変換仕様を意図的に変更したときだけ実行し、
 * 生成された差分を必ず目視で確認すること。
 *
 * 実行: npm run update:golden
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convertArticle, FIXTURE_DIR } from "../tests/helpers/env.mjs";
import { GOLDEN_OPTIONS } from "../tests/golden-options.mjs";

const fixtures = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".html"));

for (const fixture of fixtures) {
  const html = readFileSync(join(FIXTURE_DIR, fixture), "utf8");
  const { markdown } = convertArticle(html, {
    options: GOLDEN_OPTIONS,
    url: `https://note.com/hanaviye/n/${fixture.replace(/\.html$/, "")}`,
  });
  const target = join(FIXTURE_DIR, fixture.replace(/\.html$/, ".expected.md"));
  writeFileSync(target, markdown, "utf8");
  console.log(`updated: ${target} (${markdown.length} chars)`);
}

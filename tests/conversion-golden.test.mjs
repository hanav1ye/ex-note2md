/**
 * 実記事フィクスチャに対する変換出力の回帰テスト。
 * 期待値の更新は npm run update:golden で行い、差分を必ず目視確認すること。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { convertArticle, FIXTURE_DIR, simulateRenderedDom } from "./helpers/env.mjs";
import { GOLDEN_OPTIONS } from "./golden-options.mjs";

const fixtures = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".html"));

test("フィクスチャが存在する", () => {
  assert.ok(fixtures.length > 0, "tests/fixtures に記事HTMLがありません");
});

for (const fixture of fixtures) {
  const noteId = fixture.replace(/\.html$/, "");
  const articleUrl = `https://note.com/hanaviye/n/${noteId}`;
  const html = readFileSync(join(FIXTURE_DIR, fixture), "utf8");
  const expectedPath = join(FIXTURE_DIR, `${noteId}.expected.md`);

  test(`${noteId}: 期待Markdownと一致する`, () => {
    assert.ok(
      existsSync(expectedPath),
      `期待Markdownがありません。npm run update:golden を実行してください: ${expectedPath}`
    );
    const { markdown } = convertArticle(html, { options: GOLDEN_OPTIONS, url: articleUrl });
    assert.equal(markdown, readFileSync(expectedPath, "utf8"));
  });

  test(`${noteId}: タブ変換とURL変換で出力が一致する`, () => {
    const fromUrl = convertArticle(html, { options: GOLDEN_OPTIONS, url: articleUrl });
    const fromTab = convertArticle(simulateRenderedDom(html), {
      viaDomParser: false,
      options: GOLDEN_OPTIONS,
      url: articleUrl,
    });
    assert.equal(fromTab.markdown, fromUrl.markdown);
  });

  test(`${noteId}: URL変換で拡張ページのDOMを使わない`, () => {
    const { hostNodeCreations } = convertArticle(html, { options: GOLDEN_OPTIONS, url: articleUrl });
    assert.equal(hostNodeCreations, 0, "外部HTMLが拡張ページ側の Document で組み立てられています");
  });

  test(`${noteId}: frontmatter に必須項目が含まれる`, () => {
    const { markdown, metadata } = convertArticle(html, { options: GOLDEN_OPTIONS, url: articleUrl });
    assert.equal(metadata.note_id, noteId);
    assert.match(markdown, /^---\n/);
    assert.match(markdown, /\nsource: /);
    assert.match(markdown, /\nconverted_at: /);
    assert.ok(metadata.title.length > 0);
  });
}

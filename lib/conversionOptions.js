/**
 * 変換へ渡すオプションを、保存済みの設定から組み立てる。
 * popup / サイドパネル / content script の各経路から NtmConversionOptions として利用する。
 *
 * 変換そのもの（lib/noteToMarkdown.js）は 1 実装で共有されているが、その手前の
 * 「どの設定を渡すか」は経路ごとに書かれていた。設定を 1 つ足すたびに 3 か所直す必要があり、
 * 実際に frontmatter のキー設定で取りこぼしたため、ここへまとめた。
 *
 * 経路ごとに違うのはタグと、Obsidian リンク化を使うかどうかだけ。
 * それ以外（リンク化のワード一覧、frontmatter のキー設定）はどこでも同じものを読む。
 */
(function (global) {
  /**
   * 変換オプションを組み立てる。
   * @param {{tags?: unknown[], obsidianLinkify?: boolean|undefined}} [params={}] - 経路ごとに違う値。
   *   obsidianLinkify を省略した場合は保存済みの設定から読む。
   * @returns {Promise<{tags: unknown[], obsidianLinkify: boolean, obsidianLinkWords: string[], frontmatterKeys: object|undefined}>} 変換オプション。
   */
  const build = async ({ tags = [], obsidianLinkify } = {}) => {
    const keysStorageKey = global.NtmFrontmatterKeys?.STORAGE_KEY ?? "frontmatterKeys";

    if (!global.chrome?.storage?.local) {
      return { tags, obsidianLinkify: Boolean(obsidianLinkify), obsidianLinkWords: [], frontmatterKeys: undefined };
    }

    const stored = await global.chrome.storage.local.get([
      "obsidianLinkify",
      "presetObsidianLinkWords",
      keysStorageKey,
    ]);

    return {
      tags,
      // 呼び出し側が指定したらそれに従う（選択モードは開始時の指定を引き継ぐため）。
      obsidianLinkify: obsidianLinkify === undefined ? Boolean(stored.obsidianLinkify) : Boolean(obsidianLinkify),
      obsidianLinkWords: Array.isArray(stored.presetObsidianLinkWords)
        ? stored.presetObsidianLinkWords.map((word) => String(word).trim()).filter(Boolean)
        : [],
      frontmatterKeys: stored[keysStorageKey],
    };
  };

  global.NtmConversionOptions = { build };
})(typeof globalThis !== "undefined" ? globalThis : window);

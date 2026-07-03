import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const API_BASE = "https://note.com/api/v3/notes/";
const DEFAULT_DELAY_MS = 300;

/**
 * CLI引数をパースする。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{targetDir: string, dryRun: boolean, force: boolean, delayMs: number, help: boolean}}
 */
const parseArgs = (argv) => {
  let targetDir = "";
  let dryRun = false;
  let force = false;
  let delayMs = DEFAULT_DELAY_MS;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--delay") {
      delayMs = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(delayMs) || delayMs < 0) {
        throw new Error("--delay には 0 以上の整数を指定してください。");
      }
    } else if (!arg.startsWith("-")) {
      targetDir = arg;
    } else {
      throw new Error(`不明なオプション: ${arg}`);
    }
  }

  return { targetDir, dryRun, force, delayMs, help };
};

const printHelp = () => {
  console.log(`用法:
  node scripts/update-like-count.mjs <フォルダ> [オプション]

説明:
  指定フォルダ配下の .md ファイル frontmatter に like_count を追加/更新します。
  note_id は frontmatter、source URL、ファイル名（nxxxx.md）の順で解決します。

オプション:
  --dry-run    ファイルを書き換えず結果だけ表示
  --force      既存の like_count も最新値で上書き（既定は未設定のみ）
  --delay N    API呼び出し間隔ミリ秒（既定: ${DEFAULT_DELAY_MS}）
  -h, --help   このヘルプを表示

例:
  npm run update-like-count -- "C:\\path\\to\\articles"
  npm run update-like-count -- "C:\\path\\to\\articles" --dry-run
  npm run update-like-count -- "C:\\path\\to\\articles" --force
`);
};

/**
 * ディレクトリ配下の .md ファイルパスを再帰収集する。
 * @param {string} dir - 走査起点。
 * @returns {string[]} .md ファイルの絶対パス一覧。
 */
const collectMarkdownFiles = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
};

/**
 * frontmatter ブロックを分離する。
 * @param {string} content - ファイル全文。
 * @returns {{frontmatter: string, body: string}|null}
 */
const splitFrontmatter = (content) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n?)([\s\S]*)$/);
  if (!match) {
    return null;
  }
  return {
    frontmatter: match[1],
    body: match[3],
    trailingNewline: match[2],
  };
};

/**
 * YAML値から引用符を除去する。
 * @param {string} raw - 生値。
 * @returns {string}
 */
const unquoteYamlValue = (raw) => raw.trim().replace(/^["']|["']$/g, "");

/**
 * note_id を frontmatter / ファイル名から解決する。
 * @param {string} frontmatter - frontmatter 本文。
 * @param {string} filePath - ファイルパス。
 * @returns {string|null}
 */
const resolveNoteId = (frontmatter, filePath) => {
  const noteIdMatch = frontmatter.match(/^note_id:\s*(.+)$/m);
  if (noteIdMatch) {
    return unquoteYamlValue(noteIdMatch[1]);
  }

  const sourceMatch = frontmatter.match(/^source:\s*(.+)$/m);
  if (sourceMatch) {
    const source = unquoteYamlValue(sourceMatch[1]);
    const fromSource = source.match(/\/n\/([^/?#]+)/);
    if (fromSource) {
      return fromSource[1];
    }
  }

  const stem = basename(filePath, ".md");
  if (/^n[a-f0-9]+$/i.test(stem)) {
    return stem;
  }

  return null;
};

/**
 * frontmatter に like_count 行があるか判定する。
 * @param {string} frontmatter
 * @returns {boolean}
 */
const hasLikeCount = (frontmatter) => /^like_count:/m.test(frontmatter);

/**
 * frontmatter の like_count を追加または更新する。
 * @param {string} frontmatter
 * @param {number} likeCount
 * @returns {string}
 */
const upsertLikeCount = (frontmatter, likeCount) => {
  const line = `like_count: ${likeCount}`;
  if (hasLikeCount(frontmatter)) {
    return frontmatter.replace(/^like_count:.*$/m, line);
  }
  if (/^published:/m.test(frontmatter)) {
    return frontmatter.replace(/^(published:.*)$/m, `$1\n${line}`);
  }
  if (/^author:/m.test(frontmatter)) {
    return frontmatter.replace(/^(author:.*)$/m, `$1\n${line}`);
  }
  return `${frontmatter}\n${line}`;
};

/**
 * note API から like_count を取得する。
 * @param {string} noteId
 * @returns {Promise<number>}
 */
const fetchLikeCount = async (noteId) => {
  const response = await fetch(`${API_BASE}${encodeURIComponent(noteId)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = await response.json();
  const likeCount = json?.data?.like_count;
  if (typeof likeCount !== "number") {
    throw new Error("like_count が取得できませんでした");
  }
  return likeCount;
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.targetDir) {
    printHelp();
    throw new Error("対象フォルダを指定してください。");
  }

  const targetDir = resolve(args.targetDir);
  if (!statSync(targetDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`フォルダが見つかりません: ${targetDir}`);
  }

  const files = collectMarkdownFiles(targetDir);
  const likeCountCache = new Map();
  const results = {
    updated: [],
    skipped: [],
    failed: [],
  };

  console.log(`対象: ${targetDir}`);
  console.log(`ファイル数: ${files.length}`);
  console.log(`モード: ${args.force ? "force（上書き）" : "missing only（未設定のみ）"}${args.dryRun ? " / dry-run" : ""}`);
  console.log("");

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    const parts = splitFrontmatter(content);
    if (!parts) {
      results.skipped.push({ filePath, reason: "frontmatter なし" });
      continue;
    }

    const noteId = resolveNoteId(parts.frontmatter, filePath);
    if (!noteId) {
      results.skipped.push({ filePath, reason: "note_id を解決できません" });
      continue;
    }

    if (!args.force && hasLikeCount(parts.frontmatter)) {
      results.skipped.push({ filePath, reason: "like_count 既存（--force で上書き可）" });
      continue;
    }

    try {
      let likeCount = likeCountCache.get(noteId);
      if (likeCount === undefined) {
        likeCount = await fetchLikeCount(noteId);
        likeCountCache.set(noteId, likeCount);
        await sleep(args.delayMs);
      }

      const nextFrontmatter = upsertLikeCount(parts.frontmatter, likeCount);
      const nextContent = `---\n${nextFrontmatter}\n---${parts.trailingNewline}${parts.body}`;

      if (!args.dryRun) {
        writeFileSync(filePath, nextContent, "utf8");
      }

      results.updated.push({ filePath, noteId, likeCount });
      console.log(`${args.dryRun ? "[dry-run] " : ""}更新: ${filePath} -> like_count: ${likeCount}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.failed.push({ filePath, noteId, reason: message });
      console.error(`失敗: ${filePath} (${noteId}) - ${message}`);
    }
  }

  console.log("");
  console.log("--- 結果 ---");
  console.log(`更新: ${results.updated.length}`);
  console.log(`スキップ: ${results.skipped.length}`);
  console.log(`失敗: ${results.failed.length}`);

  if (results.failed.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

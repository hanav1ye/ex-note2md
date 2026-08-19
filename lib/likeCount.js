/**
 * 変換済み Markdown の frontmatter にある like_count を更新するためのロジック。
 * オプション画面から NtmLikeCount として利用する。
 *
 * scripts/update-like-count.mjs（CLI）と同じ仕様を保つこと。
 * frontmatter の書式は lib/noteToMarkdown.js の buildYamlFrontmatter が出力するものに合わせる。
 */
(function (global) {
  const API_BASE = "https://note.com/api/v3/notes/";
  /** note の API を連続で叩かないための既定間隔。 */
  const DEFAULT_DELAY_MS = 300;

  /**
   * frontmatter ブロックと本文を分離する。
   * @param {string} content - ファイル全文。
   * @returns {{frontmatter: string, body: string, trailingNewline: string}|null} frontmatter が無ければ null。
   */
  const splitFrontmatter = (content) => {
    const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n?)([\s\S]*)$/);
    if (!match) {
      return null;
    }
    if (!looksLikeFrontmatter(match[1])) {
      return null;
    }
    return {
      frontmatter: match[1],
      trailingNewline: match[2],
      body: match[3],
    };
  };

  /**
   * frontmatter らしさを検査する。
   *
   * `---` で囲まれた塊は、水平線に挟まれただけの本文でも同じ形になる。
   * それを frontmatter とみなすと本文へ like_count を挿し込んでしまうため、
   * YAML のキー行が1つ以上あることを条件にする。
   * @param {string} frontmatter - frontmatter 候補。
   * @returns {boolean} frontmatter とみなせるなら true。
   */
  const looksLikeFrontmatter = (frontmatter) => /^[A-Za-z_][\w-]*\s*:/m.test(String(frontmatter));

  /**
   * ファイル名から note_id を推定してよいか判定する。
   *
   * note の記事IDは n + 十数桁の16進数。短い語まで許すと `nade` `nabe` のような
   * 普通のファイル名まで一致してしまうため、桁数の下限を設ける。
   * @param {string} stem - 拡張子を除いたファイル名。
   * @returns {boolean} note_id とみなせるなら true。
   */
  const looksLikeNoteIdFileName = (stem) => /^n[0-9a-f]{8,}$/i.test(String(stem));

  /**
   * YAML値から引用符を除去する。
   * @param {string} raw - 生値。
   * @returns {string} 引用符を外した値。
   */
  const unquoteYamlValue = (raw) => String(raw).trim().replace(/^["']|["']$/g, "");

  /**
   * note_id を frontmatter またはファイル名から解決する。
   * note_id → source の URL → ファイル名（nxxxx.md）の順で探す。
   * @param {string} frontmatter - frontmatter 本文。
   * @param {string} fileName - ファイル名（拡張子込み）。
   * @returns {string|null} note_id。解決できなければ null。
   */
  const resolveNoteId = (frontmatter, fileName) => {
    const noteIdMatch = String(frontmatter).match(/^note_id:\s*(.+)$/m);
    if (noteIdMatch) {
      const noteId = unquoteYamlValue(noteIdMatch[1]);
      if (noteId) {
        return noteId;
      }
    }

    const sourceMatch = String(frontmatter).match(/^source:\s*(.+)$/m);
    if (sourceMatch) {
      const fromSource = unquoteYamlValue(sourceMatch[1]).match(/\/n\/([^/?#]+)/);
      if (fromSource) {
        return fromSource[1];
      }
    }

    const stem = String(fileName).replace(/\.md$/i, "");
    if (looksLikeNoteIdFileName(stem)) {
      return stem;
    }

    return null;
  };

  /**
   * frontmatter に like_count 行があるか判定する。
   * @param {string} frontmatter - frontmatter 本文。
   * @returns {boolean} あれば true。
   */
  const hasLikeCount = (frontmatter) => /^like_count:/m.test(String(frontmatter));

  /**
   * frontmatter の like_count を追加または更新する。
   * 新規追加時は published → author の後ろへ差し込み、無ければ末尾に足す。
   * @param {string} frontmatter - frontmatter 本文。
   * @param {number} likeCount - 設定するスキ数。
   * @returns {string} 更新後の frontmatter。
   */
  const upsertLikeCount = (frontmatter, likeCount) => {
    const line = `like_count: ${likeCount}`;
    const source = String(frontmatter);
    if (hasLikeCount(source)) {
      return source.replace(/^like_count:.*$/m, line);
    }
    if (/^published:/m.test(source)) {
      return source.replace(/^(published:.*)$/m, `$1\n${line}`);
    }
    if (/^author:/m.test(source)) {
      return source.replace(/^(author:.*)$/m, `$1\n${line}`);
    }
    return `${source}\n${line}`;
  };

  /**
   * 現在の like_count を読み取る。
   * @param {string} frontmatter - frontmatter 本文。
   * @returns {number|null} 数値として読めた場合のみ返す。
   */
  const readLikeCount = (frontmatter) => {
    const match = String(frontmatter).match(/^like_count:\s*(-?\d+)\s*$/m);
    return match ? Number.parseInt(match[1], 10) : null;
  };

  /**
   * ファイル全文へ like_count を反映する。
   * @param {string} content - ファイル全文。
   * @param {number} likeCount - 設定するスキ数。
   * @returns {string} 更新後の全文。
   */
  const applyLikeCountToContent = (content, likeCount) => {
    const parts = splitFrontmatter(content);
    if (!parts) {
      return String(content);
    }
    const nextFrontmatter = upsertLikeCount(parts.frontmatter, likeCount);
    return `---\n${nextFrontmatter}\n---${parts.trailingNewline}${parts.body}`;
  };

  /**
   * ディレクトリハンドル配下の .md ファイルを再帰的に集める。
   * @param {FileSystemDirectoryHandle} directoryHandle - 走査起点。
   * @param {{prefix?: string, maxFiles?: number}} [options={}] - 表示用パスの接頭辞と上限。
   * @returns {Promise<{handle: FileSystemFileHandle, name: string, path: string}[]>} .md ファイル一覧。
   */
  const collectMarkdownFiles = async (directoryHandle, options = {}) => {
    const { prefix = "", maxFiles = Infinity } = options;
    const files = [];

    for await (const [name, handle] of directoryHandle.entries()) {
      if (files.length >= maxFiles) {
        break;
      }
      const path = prefix ? `${prefix}/${name}` : name;

      if (handle.kind === "directory") {
        const nested = await collectMarkdownFiles(handle, {
          prefix: path,
          maxFiles: maxFiles - files.length,
        });
        files.push(...nested);
        continue;
      }

      if (handle.kind === "file" && /\.md$/i.test(name)) {
        files.push({ handle, name, path });
      }
    }

    return files;
  };

  /**
   * note の API から like_count を取得する。
   * @param {string} noteId - 対象の note_id。
   * @param {typeof fetch} [fetchImpl=fetch] - 差し替え用の fetch。
   * @returns {Promise<number>} スキ数。
   */
  const fetchLikeCount = async (noteId, fetchImpl = global.fetch) => {
    const response = await fetchImpl(`${API_BASE}${encodeURIComponent(noteId)}`, {
      headers: { Accept: "application/json" },
      // 利用者の note.com のログイン情報を送らない。
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    const likeCount = json?.data?.like_count;
    if (typeof likeCount !== "number") {
      throw new Error("like_count");
    }
    return likeCount;
  };

  /**
   * 走査した .md を「更新対象」と「対象外」に仕分ける。
   * API を呼ばずに判定できる部分だけを行い、実行前の確認に使う。
   * @param {{handle: object, name: string, path: string}[]} files - 走査済みファイル。
   * @returns {Promise<{targets: object[], skipped: {path: string, reason: "no-frontmatter"|"no-note-id"}[]}>} 仕分け結果。
   */
  const planUpdates = async (files) => {
    const targets = [];
    const skipped = [];

    for (const file of files) {
      const content = await (await file.handle.getFile()).text();
      const parts = splitFrontmatter(content);
      if (!parts) {
        skipped.push({ path: file.path, reason: "no-frontmatter" });
        continue;
      }
      const noteId = resolveNoteId(parts.frontmatter, file.name);
      if (!noteId) {
        skipped.push({ path: file.path, reason: "no-note-id" });
        continue;
      }
      targets.push({
        ...file,
        noteId,
        content,
        currentLikeCount: readLikeCount(parts.frontmatter),
      });
    }

    return { targets, skipped };
  };

  /**
   * 書き込み直前に、そのファイルが今も更新してよい状態かを検査して新しい内容を作る。
   *
   * 走査から書き込みまでの間にユーザーがそのファイルを編集している可能性があるため、
   * 走査時に読んだ内容ではなく、必ず読み直した最新の内容を土台にする。
   * こうしないと実行中に Obsidian で加えた編集を消してしまう。
   * @param {string} freshContent - 書き込み直前に読み直した全文。
   * @param {string} fileName - ファイル名。
   * @param {string} expectedNoteId - 走査時に確定した note_id。
   * @param {number} likeCount - 設定するスキ数。
   * @returns {{status: "ok"|"unchanged"|"mismatch", content: string}} 判定結果と書き込む内容。
   */
  const buildUpdatedContent = (freshContent, fileName, expectedNoteId, likeCount) => {
    const parts = splitFrontmatter(freshContent);
    if (!parts) {
      return { status: "mismatch", content: freshContent };
    }
    // 別の記事のファイルに書き換わっていたら触らない。
    if (resolveNoteId(parts.frontmatter, fileName) !== expectedNoteId) {
      return { status: "mismatch", content: freshContent };
    }

    const nextContent = applyLikeCountToContent(freshContent, likeCount);
    if (nextContent === freshContent) {
      return { status: "unchanged", content: freshContent };
    }
    return { status: "ok", content: nextContent };
  };

  global.NtmLikeCount = {
    API_BASE,
    DEFAULT_DELAY_MS,
    buildUpdatedContent,
    applyLikeCountToContent,
    collectMarkdownFiles,
    fetchLikeCount,
    hasLikeCount,
    planUpdates,
    readLikeCount,
    resolveNoteId,
    splitFrontmatter,
    upsertLikeCount,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

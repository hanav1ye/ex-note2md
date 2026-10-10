/**
 * 変換済み Markdown の frontmatter にある like_count を更新するためのロジック。
 * オプション画面から NtmLikeCount として利用する。
 *
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
   * 日時を日本時間の「YYYY-MM-DDTHH:mm:ss」にする（オフセットなし）。
   *
   * lib/noteToMarkdown.js の formatJapanDateTime と同じ結果になること
   * （変換時と更新時で published の形式がずれないようにするため。tests で一致を検証している）。
   * オプション画面は変換ライブラリを読み込まないため、ここに小さく持つ。
   * @param {Date} date - 対象日時。
   * @returns {string} 日時文字列。
   */
  const formatJapanDateTime = (date) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };


  /**
   * frontmatter を項目ごとに分解する。
   *
   * `tags:` のように続く行がぶら下がる項目があるため、キー行で区切り、
   * 字下げされた行は直前の項目に属するものとして扱う。
   * @param {string} frontmatter - frontmatter 本文。
   * @returns {{key: string, lines: string[]}[]} 現れた順の項目。
   */
  const parseFrontmatterEntries = (frontmatter) => {
    const entries = [];
    for (const line of String(frontmatter).split("\n")) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
      if (match) {
        entries.push({ key: match[1], lines: [line] });
        continue;
      }
      if (entries.length > 0) {
        entries[entries.length - 1].lines.push(line);
        continue;
      }
      // キー行より前に現れた行は、そのまま先頭へ置く。
      entries.push({ key: null, lines: [line] });
    }
    return entries;
  };

  /**
   * 項目の値の行を、新しいキー名へ付け替える。
   * @param {{key: string, lines: string[]}} entry - 既存の項目。
   * @param {string} name - 新しいキー名。
   * @returns {string[]} 付け替えた行。
   */
  const renameEntry = (entry, name) => {
    const [first, ...rest] = entry.lines;
    return [first.replace(/^[A-Za-z_][A-Za-z0-9_-]*\s*:/, `${name}:`), ...rest];
  };

  /**
   * frontmatter を、拡張機能が管理する項目について作り直す。
   *
   * upsert（1 行ずつ足す・書き換える）をやめた理由は docs/research/frontmatter-keys.md を参照。
   * 作り直すことで、改名による二重登録と、出力をやめた項目が消えない問題が
   * 構造的に起きなくなる。
   *
   * - 値が取れた管理項目は、設定の名前と順序で作り直す
   * - 値が取れなかった管理項目は、既存の行を引き継ぐ（勝手に消さない）
   * - tags と converted_at は値を作り直さず、名前だけ揃えて引き継ぐ
   * - 利用者が足した未知の項目は、相対順序を保ったまま末尾へ置く
   * @param {string} frontmatter - 既存の frontmatter 本文。
   * @param {object} values - 書き込む値（項目IDをキーにする）。
   * @param {object} config - 正規化済みのキー設定。
   * @returns {string} 作り直した frontmatter 本文。
   */
  const rebuildFrontmatter = (frontmatter, values, rawConfig) => {
    const keys = global.NtmFrontmatterKeys;
    // 未指定でも既定で動くようにする（normalizeConfig は正規化済みの値に対しても安全）。
    const config = keys.normalizeConfig(rawConfig);
    const entries = parseFrontmatterEntries(frontmatter);

    // 既存の行がどの項目のものかを、現在名・保留中の旧名・既定名で照合する。
    const entryById = new Map();
    const claimed = new Set();
    for (const id of keys.KEY_IDS) {
      const names = keys.matchNamesFor(config, id);
      const found = entries.find((entry) => entry.key && !claimed.has(entry) && names.includes(entry.key));
      if (found) {
        entryById.set(id, found);
        claimed.add(found);
      }
    }


    const lines = [];
    for (const { id, name, rebuilt: isRebuilt } of keys.enabledKeys(config)) {
      const existing = entryById.get(id);
      const value = values?.[id];
      if (isRebuilt && value !== undefined && value !== null) {
        lines.push(...keys.renderKeyLines(id, name, value));
        continue;
      }
      // 値が取れなかった項目と、作り直さない項目（tags / converted_at）は引き継ぐ。
      if (existing) {
        lines.push(...renameEntry(existing, name));
      }
    }

    // 管理対象に一致しなかった行は利用者のもの。消さずに末尾へ残す。
    for (const entry of entries) {
      if (!claimed.has(entry)) {
        lines.push(...entry.lines);
      }
    }

    return lines.join("\n");
  };

  /**
   * ファイル全文の frontmatter を作り直す。
   * @param {string} content - ファイル全文。
   * @param {object} values - 書き込む値。
   * @param {object} config - 正規化済みのキー設定。
   * @returns {string} 更新後の全文。
   */
  const applyStatsToContent = (content, values, config) => {
    const parts = splitFrontmatter(content);
    if (!parts) {
      return String(content);
    }
    const next = rebuildFrontmatter(parts.frontmatter, values, config);
    return `---\n${next}\n---${parts.trailingNewline}${parts.body}`;
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
  const fetchLikeCount = async (noteId, fetchImpl = global.fetch) =>
    (await fetchNoteSummary(noteId, fetchImpl)).likeCount;

  /**
   * note の API からスキ数と公開日時をまとめて取得する。
   * 公開日時は同じ応答に入っているため、取得のための通信は増えない。
   * @param {string} noteId - 対象の note_id。
   * @param {typeof fetch} [fetchImpl=fetch] - 差し替え用の fetch。
   * @returns {Promise<{likeCount: number, publishedAt: string|null}>} スキ数と公開日時。
   */
  const fetchNoteSummary = async (noteId, fetchImpl = global.fetch) => {
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

    // タイトル・著者・URL も同じ応答に入っているため、取得のための通信は増えない。
    const data = json?.data ?? {};
    const text = (value) => {
      const raw = typeof value === "string" ? value.trim() : "";
      return raw || null;
    };
    const parsed = new Date(String(data.publish_at ?? ""));
    return {
      likeCount,
      publishedAt: Number.isNaN(parsed.getTime()) ? null : formatJapanDateTime(parsed),
      title: text(data.name),
      author: text(data.user?.urlname),
      source: text(data.note_url),
    };
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

  /**
   * 書き込み直前に検査して、ダッシュボード由来の数値まで含めた新しい内容を作る。
   * 検査の考え方は buildUpdatedContent と同じ（走査時の内容ではなく読み直した内容を土台にする）。
   * @param {string} freshContent - 書き込み直前に読み直した全文。
   * @param {string} fileName - ファイル名。
   * @param {string} expectedNoteId - 走査時に確定した note_id。
   * @param {object} stats - 設定する値。
   * @returns {{status: "ok"|"unchanged"|"mismatch", content: string}} 判定結果と書き込む内容。
   */
  const buildUpdatedContentWithStats = (freshContent, fileName, expectedNoteId, values, config) => {
    const parts = splitFrontmatter(freshContent);
    if (!parts) {
      return { status: "mismatch", content: freshContent };
    }
    // 別の記事のファイルに書き換わっていたら触らない。
    if (resolveNoteId(parts.frontmatter, fileName) !== expectedNoteId) {
      return { status: "mismatch", content: freshContent };
    }

    const nextContent = applyStatsToContent(freshContent, values, config);
    if (nextContent === freshContent) {
      return { status: "unchanged", content: freshContent };
    }
    return { status: "ok", content: nextContent };
  };

  global.NtmLikeCount = {
    API_BASE,
    DEFAULT_DELAY_MS,
    applyStatsToContent,
    buildUpdatedContentWithStats,
    parseFrontmatterEntries,
    rebuildFrontmatter,
    buildUpdatedContent,
    applyLikeCountToContent,
    collectMarkdownFiles,
    fetchLikeCount,
    fetchNoteSummary,
    formatJapanDateTime,
    hasLikeCount,
    planUpdates,
    readLikeCount,
    resolveNoteId,
    splitFrontmatter,
    upsertLikeCount,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

/**
 * frontmatter の項目定義と、利用者による出力制御・キー名変更の設定を扱う。
 * 変換（lib/noteToMarkdown.js）・更新（lib/likeCount.js）・設定画面から
 * NtmFrontmatterKeys として利用する。
 *
 * 仕様の経緯は docs/research/frontmatter-keys.md を参照。
 */
(function (global) {
  /** 設定の保存キー（chrome.storage.local）。 */
  const STORAGE_KEY = "frontmatterKeys";

  /** キー名として受け付ける形式。1〜20文字・英字か _ で始まる・英数字と _ - のみ。 */
  const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,19}$/;
  const NAME_MAX_LENGTH = 20;

  /** Obsidian が特別扱いするため、改名先に選ぶと既存の値と衝突しやすい名前。 */
  const RESERVED_NAMES = ["tags", "aliases", "cssclasses", "cssclass", "publish", "permalink"];

  /**
   * 項目の定義。配列の順序が、そのまま frontmatter の出力順になる。
   *
   * - fixed: 出力の ON/OFF も改名もできない（識別に使うため）
   * - rebuilt: 「数値を更新」でブロックを作り直すときに値を生成し直すか。
   *   false のものは既存ファイルの値をそのまま引き継ぐ。
   */
  const KEY_DEFS = [
    { id: "title", defaultName: "title", fixed: false, rebuilt: true },
    { id: "source", defaultName: "source", fixed: false, rebuilt: true },
    // note_id は記事の識別と、書き込み直前の「同じ記事か」の照合に使う。
    { id: "note_id", defaultName: "note_id", fixed: true, rebuilt: true },
    { id: "author", defaultName: "author", fixed: false, rebuilt: true },
    { id: "published", defaultName: "published", fixed: false, rebuilt: true },
    { id: "like_count", defaultName: "like_count", fixed: false, rebuilt: true },
    { id: "page_view_count", defaultName: "page_view_count", fixed: false, rebuilt: true },
    { id: "impression_count", defaultName: "impression_count", fixed: false, rebuilt: true },
    { id: "stats_updated_at", defaultName: "stats_updated_at", fixed: false, rebuilt: true },
    // tags は popup で利用者が選んだもので note 側のデータではない。
    { id: "tags", defaultName: "tags", fixed: false, rebuilt: false },
    // converted_at は「変換した日時」。更新で現在時刻にすると意味が変わる。
    { id: "converted_at", defaultName: "converted_at", fixed: false, rebuilt: false },
  ];

  const KEY_IDS = KEY_DEFS.map((def) => def.id);
  const KEY_DEF_BY_ID = new Map(KEY_DEFS.map((def) => [def.id, def]));

  /**
   * 文字列として扱えない値を空文字にする。
   * @param {unknown} value - 任意の値。
   * @returns {string} 文字列。
   */
  const asString = (value) => (typeof value === "string" ? value.trim() : "");

  /**
   * 保存済みの設定を、欠けや不正値を埋めた形へ正規化する。
   *
   * 未設定なら既定（全項目を出力し、既定名を使う）になる。
   * 既定のままなら、この機能が無かった頃とまったく同じ出力になること。
   * @param {any} raw - chrome.storage.local から読んだ値。
   * @returns {Record<string, {enabled: boolean, name: string, pendingOldName: string|null}>} 正規化後の設定。
   */
  const normalizeConfig = (raw) => {
    const config = {};
    for (const def of KEY_DEFS) {
      const stored = raw?.[def.id];
      const name = asString(stored?.name);
      const pendingOldName = asString(stored?.pendingOldName);
      config[def.id] = {
        // 固定キーは常に出力する。
        enabled: def.fixed ? true : stored?.enabled !== false,
        name: !def.fixed && NAME_PATTERN.test(name) ? name : def.defaultName,
        // 反映が済むまでの保留。完了したら捨てる（履歴は持たない）。
        pendingOldName: NAME_PATTERN.test(pendingOldName) ? pendingOldName : null,
      };
    }
    return config;
  };

  /**
   * キー名として使えるか検査する。
   * @param {string} name - 検査する名前。
   * @param {{id: string, config?: object}} [context={}] - 対象の項目IDと、他項目との重複を見るための設定。
   * @returns {{ok: true}|{ok: false, reason: "empty"|"format"|"too-long"|"duplicate"|"fixed"}} 検査結果。
   */
  const validateName = (name, context = {}) => {
    const def = KEY_DEF_BY_ID.get(context.id);
    if (def?.fixed) {
      return { ok: false, reason: "fixed" };
    }
    const value = asString(name);
    if (!value) {
      return { ok: false, reason: "empty" };
    }
    if (value.length > NAME_MAX_LENGTH) {
      return { ok: false, reason: "too-long" };
    }
    if (!NAME_PATTERN.test(value)) {
      return { ok: false, reason: "format" };
    }
    // 2つの項目が同じ名前になると、どちらの行か判別できなくなる。
    const config = context.config;
    if (config) {
      const taken = KEY_IDS.some((id) => id !== context.id && config[id]?.name === value);
      if (taken) {
        return { ok: false, reason: "duplicate" };
      }
    }
    return { ok: true };
  };

  /**
   * 改名先が、Obsidian などが特別扱いする名前かどうか。
   * 禁止はしないが、警告を出すために使う。
   * @param {string} name - 検査する名前。
   * @param {string} id - 対象の項目ID（既定名のままなら警告しない）。
   * @returns {boolean} 警告すべきなら true。
   */
  const isReservedName = (name, id) => {
    const value = asString(name);
    if (KEY_DEF_BY_ID.get(id)?.defaultName === value) {
      return false;
    }
    return RESERVED_NAMES.includes(value);
  };

  /**
   * 改名を設定へ反映する。
   *
   * 旧名は「まだファイルに残っているかもしれない名前」として保留する。
   * すでに保留があるときは上書きしない（実ファイルに残っているのは古い方のため）。
   * @param {object} config - 正規化済みの設定。
   * @param {string} id - 対象の項目ID。
   * @param {string} nextName - 新しい名前。
   * @returns {object} 更新後の設定（引数は変更しない）。
   */
  const applyRename = (config, id, nextName) => {
    const current = config[id];
    const def = KEY_DEF_BY_ID.get(id);
    if (!current || !def || def.fixed || current.name === nextName) {
      return config;
    }
    return {
      ...config,
      [id]: {
        ...current,
        name: nextName,
        pendingOldName: current.pendingOldName ?? current.name,
      },
    };
  };

  /**
   * 反映が終わった項目の保留を捨てる。
   * @param {object} config - 正規化済みの設定。
   * @returns {object} 更新後の設定（引数は変更しない）。
   */
  const clearPending = (config) => {
    const next = {};
    for (const id of KEY_IDS) {
      next[id] = { ...config[id], pendingOldName: null };
    }
    return next;
  };

  /**
   * 既存ファイルへの反映を待っている変更の一覧。
   * 設定画面の「反映待ち」表示に使う。
   * @param {object} config - 正規化済みの設定。
   * @returns {{id: string, type: "rename"|"disable", from: string, to: string|null}[]} 保留中の変更。
   */
  const listPendingChanges = (config) => {
    const changes = [];
    for (const def of KEY_DEFS) {
      const entry = config[def.id];
      if (!entry) {
        continue;
      }
      if (!entry.enabled) {
        changes.push({ id: def.id, type: "disable", from: entry.name, to: null });
        continue;
      }
      if (entry.pendingOldName && entry.pendingOldName !== entry.name) {
        changes.push({ id: def.id, type: "rename", from: entry.pendingOldName, to: entry.name });
      }
    }
    return changes;
  };

  /**
   * ファイル内の行が、どの項目かを判定するための候補名を返す。
   *
   * 現在の名前・保留中の旧名・既定名を見る。既定名を常に含めるので、
   * この機能より前に保存したファイルも1回の更新で揃う。
   * @param {object} config - 正規化済みの設定。
   * @param {string} id - 対象の項目ID。
   * @returns {string[]} 候補名（重複なし）。
   */
  const matchNamesFor = (config, id) => {
    const def = KEY_DEF_BY_ID.get(id);
    const entry = config[id];
    const names = [entry?.name, entry?.pendingOldName, def?.defaultName].filter(Boolean);
    return Array.from(new Set(names));
  };

  /**
   * 出力する項目を、順序どおりに並べて返す。
   * @param {object} config - 正規化済みの設定。
   * @returns {{id: string, name: string, rebuilt: boolean}[]} 出力対象。
   */
  const enabledKeys = (config) =>
    KEY_DEFS.filter((def) => config[def.id]?.enabled).map((def) => ({
      id: def.id,
      name: config[def.id].name,
      rebuilt: def.rebuilt,
    }));

  /**
   * YAML の値として安全に 1 行で書ける形にする。
   *
   * 変換と更新で結果がずれると、設定を触っていない利用者のファイルまで
   * 書き換わってしまうため、ここに 1 つだけ置いて両方から使う。
   * @param {string} value - 生の値。
   * @returns {string} YAML の値。
   */
  const escapeYamlString = (value) => {
    const raw = String(value);
    if (/[:#{}[\],&*!|>'"%@`]/.test(raw) || raw.includes("\n") || /^\s|\s$/.test(raw)) {
      return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return raw;
  };

  /** 引用符を付けずに書いてよい日時の項目。既存ファイルの形に合わせるため。 */
  const TIMESTAMP_IDS = new Set(["published", "stats_updated_at"]);
  /** 引用符なしで 1 行に書いても YAML を壊さない文字だけか。 */
  const INLINE_SAFE_PATTERN = /^[\w:+.-]+$/;

  /**
   * 1 項目ぶんの frontmatter の行を作る。
   * 値が無い項目は空配列を返す（行自体を出さない）。
   * @param {string} id - 項目ID。
   * @param {string} name - 出力するキー名。
   * @param {unknown} value - 値。tags は配列。
   * @returns {string[]} 出力する行。
   */
  const renderKeyLines = (id, name, value) => {
    if (value === undefined || value === null || value === "") {
      return [];
    }
    if (id === "tags") {
      const tags = Array.isArray(value) ? value : [];
      return tags.length ? [`${name}:`, ...tags.map((tag) => `  - ${escapeYamlString(tag)}`)] : [];
    }
    if (typeof value === "number") {
      return [`${name}: ${value}`];
    }
    /*
     * published と stats_updated_at は、安全な文字だけなら引用符を付けない。
     * 既存ファイルがこの形で保存されているため、揃えないと設定を触っていない
     * 利用者のファイルまで書き換わってしまう（converted_at は逆に引用符付きで
     * 保存されてきたので、escapeYamlString のままにする）。
     */
    if (TIMESTAMP_IDS.has(id) && INLINE_SAFE_PATTERN.test(String(value))) {
      return [`${name}: ${value}`];
    }
    return [`${name}: ${escapeYamlString(value)}`];
  };
  global.NtmFrontmatterKeys = {
    KEY_DEFS,
    KEY_IDS,
    NAME_MAX_LENGTH,
    NAME_PATTERN,
    RESERVED_NAMES,
    STORAGE_KEY,
    applyRename,
    escapeYamlString,
    renderKeyLines,
    clearPending,
    enabledKeys,
    isReservedName,
    listPendingChanges,
    matchNamesFor,
    normalizeConfig,
    validateName,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

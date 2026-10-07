/**
 * note.com 記事の DOM → Markdown 変換ライブラリ。
 * popup / content script から NoteToMarkdown として利用する。
 */
(function (global) {
  const MARKDOWN_HARD_LINE_BREAK = "  \n";
  const MARKDOWN_HORIZONTAL_RULE = "\n\n---\n\n";

  /**
   * URLがnote記事形式（/n/...）か判定する。
   * @param {string} url - 判定対象URL。
   * @param {string} [base] - 相対URL解決に使うベースURL。
   * @returns {boolean} 記事URLであれば true。
   */
  const isNoteArticleUrl = (url, base) => {
    try {
      const parsed = base ? new URL(url, base) : new URL(url);
      // manifest の host_permissions / content_scripts と同じ範囲に揃える。
      // （サブドメインは権限外で fetch できないため、ここで許可しても失敗するだけ）
      return parsed.protocol === "https:" && parsed.hostname === "note.com" && /\/n\/[^/]+/.test(parsed.pathname);
    } catch {
      return false;
    }
  };

  /**
   * タイムアウト付きで fetch を実行する。
   * @param {string} url - 取得URL。
   * @param {RequestInit} [options={}] - fetchオプション。
   * @param {number} [timeoutMs=15000] - タイムアウトミリ秒。
   * @returns {Promise<Response>} fetch結果。
   */
  const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  /** タイトル末尾の媒体名などを除去して整形する。 */
  const sanitizeTitle = (raw) => raw.replace(/\s*[｜|]\s*[^｜|]+$/, "").trim();

  /**
   * href を baseUrl 基準で絶対URL化する。
   * @param {string} href - 生href。
   * @param {string} baseUrl - 基準URL。
   * @returns {string} 解決後URL。
   */
  const resolveLinkHref = (href, baseUrl) => {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  };

  /**
   * code要素の内容をインライン/フェンスコードとしてMarkdown化する。
   * @param {string} raw - codeテキスト。
   * @returns {string} Markdownコード表現。
   */
  const wrapInlineCode = (raw) => {
    if (raw.includes("\n")) {
      let fence = "```";
      while (raw.includes(fence)) {
        fence += "`";
      }
      return `\n${fence}\n${raw.trimEnd()}\n${fence}\n`;
    }
    let fence = "`";
    while (raw.includes(fence)) {
      fence += "`";
    }
    return `${fence}${raw}${fence}`;
  };

  /**
   * 言語指定付きのフェンスコードブロックを構築する。
   * @param {string} lang - 言語名。
   * @param {string} body - コード本文。
   * @returns {string} Markdownコードブロック。
   */
  const buildFencedCodeBlock = (lang, body) => {
    let fence = "```";
    while (body.includes(fence)) {
      fence += "`";
    }
    const langLine = lang.trim();
    return `\n${fence}${langLine ? langLine : ""}\n${body.trimEnd()}\n${fence}\n`;
  };

  /**
   * 太字テキストをMarkdown強調記法へ変換する。
   * 改行を含む場合は行単位で `**` を閉じる。
   * @param {string} raw - 元テキスト。
   * @returns {string} Markdown太字表現。
   */
  const wrapStrongText = (raw) => {
    const escaped = (raw ?? "").replace(/\*/g, "\\*");
    if (!escaped.includes("\n")) {
      return `**${escaped}**`;
    }

    return escaped
      .split("\n")
      .map((line) => {
        const hasHardBreak = line.endsWith("  ");
        const base = hasHardBreak ? line.slice(0, -2) : line;
        if (base.length === 0) {
          return hasHardBreak ? "  " : "";
        }
        const wrapped = `**${base}**`;
        return hasHardBreak ? `${wrapped}  ` : wrapped;
      })
      .join("\n");
  };

  /** 文字列が既に画像Markdown構文か判定する。 */
  const isMarkdownImageSyntax = (text) => /^!\[[^\]]*]\([^)]+\)$/.test(text.trim());

  /**
   * a要素をMarkdownリンク（または画像）として置換する文字列を返す。
   * @param {HTMLAnchorElement} anchor - 対象リンク。
   * @param {string} baseUrl - 相対URL解決用ベース。
   * @returns {string} 置換用Markdown文字列。
   */
  const buildMarkdownLinkReplacement = (anchor, baseUrl) => {
    const rawHref = anchor.getAttribute("href")?.trim() ?? "";
    const labelRaw = anchor.textContent?.trim() ?? "";
    if (!rawHref) {
      return labelRaw;
    }
    // note.com は画像を拡大用リンクで包む。画像 Markdown はリンクで包まない。
    if (isMarkdownImageSyntax(labelRaw)) {
      if (anchor.closest("p")) {
        return labelRaw;
      }
      return `\n\n${labelRaw}\n\n`;
    }
    const resolvedHref = resolveLinkHref(rawHref, baseUrl);
    const label = labelRaw.length > 0 ? labelRaw : resolvedHref;
    const safeLabel = label.replace(/\]/g, "\\]");
    const markdownLink = `[${safeLabel}](${resolvedHref})`;
    if (anchor.closest("p")) {
      return markdownLink;
    }
    return `\n\n${markdownLink}\n\n`;
  };

  /**
   * 指定要素をテキストノードへ置換する。
   * ノードは対象要素と同じ Document 上に生成する（外部HTMLを別Documentへ持ち込まない）。
   * @param {Element} element - 置換対象要素。
   * @param {string} text - 置換テキスト。
   */
  const replaceElementWithText = (element, text) => {
    const doc = element.ownerDocument ?? document;
    element.replaceWith(doc.createTextNode(text));
  };

  /**
   * 末尾ブロックが空要素か判定する。
   * 文字が無くてもリンクや埋め込みを含むものは中身があるので落とさない
   * （文字を持たない `<a>` だけの段落や、iframe だけの埋め込みが末尾にある記事がある）。
   */
  const isEmptyTrailingBlock = (el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "br" || tag === "hr") {
      return true;
    }
    if ((el.textContent ?? "").trim().length > 0) {
      return false;
    }
    const keepSelector = "a[href], iframe[src], iframe[data-src]";
    return !(el.matches?.(keepSelector) || el.querySelector(keepSelector));
  };

  /** 末尾ブロックが画像のみで構成されるか判定する。 */
  const isImageOnlyBlock = (el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "figure" || tag === "img") {
      return true;
    }
    if (tag === "p" || tag === "div") {
      if (!el.querySelector("img")) {
        return false;
      }
      const clone = el.cloneNode(true);
      clone.querySelectorAll("img, br").forEach((node) => node.remove());
      return (clone.textContent ?? "").trim().length === 0;
    }
    return false;
  };

  /** note.com固有の装飾/不要要素を除去する。 */
  const removeNoteChrome = (root) => {
    root.querySelectorAll(".o-noteEyecatch-tableOfContents").forEach((el) => el.remove());
    root.querySelectorAll('button, [role="button"]').forEach((el) => {
      const label = (el.textContent ?? "").trim().toLowerCase();
      const ariaLabel = (el.getAttribute("aria-label") ?? "").trim().toLowerCase();
      if (label === "copy" || label === "コピー" || ariaLabel === "copy" || ariaLabel === "コピー") {
        el.remove();
      }
    });
  };

  /**
   * iframe の埋め込み先URLを取得する。
   * note は記事カードを遅延読み込みするため、URL が `src` ではなく `data-src` に入ることがある。
   * @param {Element} iframe - iframe要素。
   * @param {string} baseUrl - 相対URL解決用ベース。
   * @returns {string} http(s) のURL。取得できない場合は空文字。
   */
  const resolveEmbedUrl = (iframe, baseUrl) => {
    const raw = (iframe.getAttribute("src") || iframe.getAttribute("data-src") || "").trim();
    if (!raw) {
      return "";
    }
    try {
      const resolved = new URL(raw, baseUrl);
      return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.toString() : "";
    } catch {
      return "";
    }
  };

  /**
   * 画像を含まない figure のリンク／埋め込みをMarkdownリンクとして保全する。
   * リンクが無い埋め込み（note の質問箱など iframe だけの figure）は、
   * このあとの整理で文字を持たない要素として消えてしまうため、iframe の URL を拾う。
   * @param {Element} root - 変換対象ルート。
   * @param {string} baseUrl - 相対URL解決用ベース。
   */
  const preserveFigureLinks = (root, baseUrl) => {
    root.querySelectorAll("figure").forEach((figure) => {
      if (figure.querySelector("img, picture")) {
        return;
      }

      const links = Array.from(figure.querySelectorAll("a[href]"))
        .map((anchor) => anchor.getAttribute("href")?.trim() ?? "")
        .filter(Boolean);

      // アンカーがあるときはそちら（記事カードは data-src の埋め込みURLより読みやすいURLを持つ）。
      const embeds =
        links.length > 0
          ? []
          : Array.from(figure.querySelectorAll("iframe")).map((iframe) => resolveEmbedUrl(iframe, baseUrl));

      const uniqueLinks = Array.from(new Set([...links, ...embeds].filter(Boolean)));
      if (uniqueLinks.length === 0) {
        return;
      }

      const markdownLinks = uniqueLinks.map((href) => `\n\n[${href}](${href})\n\n`).join("");
      replaceElementWithText(figure, markdownLinks);
    });
  };

  /** 画像altテキストをMarkdown向けにエスケープする。 */
  const escapeMarkdownImageAlt = (alt) => alt.replace(/\]/g, "\\]");

  // note.com は表示時のスクリプトで alt="画像" を後付けする（配信HTMLでは alt=""）。
  // タブ変換とURL変換で出力が変わらないよう、意味を持たないプレースホルダは空扱いにする。
  const PLACEHOLDER_IMAGE_ALTS = new Set(["画像", "image", "写真"]);

  /**
   * img要素のaltを取得する（note.com のプレースホルダaltは空文字にする）。
   * @param {HTMLImageElement} img - 対象画像。
   * @returns {string} Markdown向けにエスケープ済みのalt。
   */
  const resolveImageAlt = (img) => {
    const alt = (img.getAttribute("alt") ?? "").trim();
    if (PLACEHOLDER_IMAGE_ALTS.has(alt)) {
      return "";
    }
    return escapeMarkdownImageAlt(alt);
  };

  /**
   * img要素から最適な画像URLを解決する。
   * @param {HTMLImageElement} img - 対象画像。
   * @param {string} baseUrl - 相対URL解決用ベース。
   * @returns {string} 解決済みURL。見つからない場合は空文字。
   */
  const resolveImageSrc = (img, baseUrl) => {
    const src = img.getAttribute("src")?.trim() ?? "";
    const dataSrc = img.getAttribute("data-src")?.trim() ?? "";
    const rawSrcSet = img.getAttribute("srcset") ?? img.getAttribute("data-srcset") ?? "";
    const srcSetFirst = rawSrcSet
      .split(",")
      .map((entry) => entry.trim().split(/\s+/)[0] ?? "")
      .find(Boolean);
    const candidate = src || dataSrc || srcSetFirst || "";
    if (!candidate) {
      return "";
    }
    return resolveLinkHref(candidate, baseUrl);
  };

  /**
   * 画像Markdown（必要ならcaption含む）を構築する。
   * @param {string} alt - alt文字列。
   * @param {string} src - 画像URL。
   * @param {string} caption - キャプション。
   * @returns {string} 画像Markdown。
   */
  const buildImageMarkdown = (alt, src, caption) => {
    let markdown = `\n\n![${alt}](${src})\n\n`;
    if (caption) {
      markdown += `*${caption.replace(/\*/g, "\\*")}*\n\n`;
    }
    return markdown;
  };

  /** figcaption を Markdown の斜体行へ変換する。 */
  const convertFigcaptions = (root) => {
    root.querySelectorAll("figcaption").forEach((figcaption) => {
      const text = (figcaption.textContent ?? "").trim();
      if (!text) {
        figcaption.remove();
        return;
      }
      replaceElementWithText(figcaption, `*${text.replace(/\*/g, "\\*")}*\n\n`);
    });
  };

  /**
   * 画像関連要素（figure/img/picture）をMarkdownへ変換する。
   * @param {Element} root - 変換対象ルート。
   * @param {string} baseUrl - 相対URL解決用ベース。
   */
  const convertImagesToMarkdown = (root, baseUrl) => {
    root.querySelectorAll("figure").forEach((figure) => {
      const img = figure.querySelector("img");
      if (!img) {
        return;
      }
      const src = resolveImageSrc(img, baseUrl);
      if (!src) {
        return;
      }
      const alt = resolveImageAlt(img);
      const caption = (figure.querySelector("figcaption")?.textContent ?? "").trim();
      replaceElementWithText(figure, buildImageMarkdown(alt, src, caption));
    });

    root.querySelectorAll("img").forEach((img) => {
      const src = resolveImageSrc(img, baseUrl);
      if (!src) {
        img.remove();
        return;
      }
      const alt = resolveImageAlt(img);
      replaceElementWithText(img, `\n\n![${alt}](${src})\n\n`);
    });

    convertFigcaptions(root);

    root.querySelectorAll("picture").forEach((picture) => {
      if (!picture.querySelector("img")) {
        picture.remove();
      }
    });

    root.querySelectorAll("figure").forEach((figure) => {
      const hasMeaningfulText = (figure.textContent ?? "").trim().length > 0;
      const hasLink = Boolean(figure.querySelector("a[href]"));
      if (!hasMeaningfulText && !hasLink) {
        figure.remove();
      }
    });
  };

  const removeTrailingBlocks = (root) => {
    while (root.lastElementChild) {
      const last = root.lastElementChild;
      if (isEmptyTrailingBlock(last)) {
        last.remove();
        continue;
      }
      if (isImageOnlyBlock(last)) {
        last.remove();
        continue;
      }
      break;
    }
  };

  /** h1-h6 を Markdown 見出しへ変換する。 */
  const convertHeadings = (root) => {
    for (let level = 6; level >= 1; level -= 1) {
      root.querySelectorAll(`h${level}`).forEach((heading) => {
        const raw = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!raw) {
          heading.remove();
          return;
        }
        replaceElementWithText(heading, `${"#".repeat(level)} ${raw}\n\n`);
      });
    }
  };

  /** hr を Markdown の区切り線へ変換する。 */
  const convertHorizontalRules = (root) => {
    root.querySelectorAll("hr").forEach((hr) => {
      replaceElementWithText(hr, MARKDOWN_HORIZONTAL_RULE);
    });
  };

  /**
   * 指定タグ名に一致する祖先要素の数を返す（入れ子の深さ判定用）。
   * @param {Element} el - 起点要素。
   * @param {...string} tagNames - 数える祖先のタグ名（小文字）。
   * @returns {number} 一致した祖先の数。
   */
  const getAncestorCount = (el, ...tagNames) => {
    let count = 0;
    let current = el.parentElement;
    while (current) {
      if (tagNames.includes(current.tagName?.toLowerCase())) {
        count += 1;
      }
      current = current.parentElement;
    }
    return count;
  };

  /** 指定リスト要素のネスト深さ（親ul/ol数）を返す。 */
  const getNestedListDepth = (el) => getAncestorCount(el, "ul", "ol");

  /** liテキストを行単位で整形し、不要空行を除去する。 */
  const normalizeListItemText = (raw) =>
    raw
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");

  /** ul/ol 要素を Markdown 箇条書きへ変換する。 */
  const convertListElement = (list) => {
    const listTag = list.tagName?.toLowerCase();
    if (listTag !== "ul" && listTag !== "ol") {
      return;
    }
    const depth = getNestedListDepth(list);
    const indent = "  ".repeat(depth);
    const lines = [];
    let order = 1;

    Array.from(list.children).forEach((child) => {
      if (child.tagName?.toLowerCase() !== "li") {
        return;
      }
      const marker = listTag === "ol" ? `${order}. ` : "- ";
      order += 1;
      const normalized = normalizeListItemText(child.textContent ?? "");
      if (!normalized) {
        lines.push(`${indent}${marker}`);
        return;
      }
      const parts = normalized.split("\n");
      lines.push(`${indent}${marker}${parts[0]}`);
      for (let i = 1; i < parts.length; i += 1) {
        lines.push(`${indent}  ${parts[i]}`);
      }
    });

    replaceElementWithText(list, `\n${lines.join("\n")}\n`);
  };

  /** ルート配下のリスト要素を深い順でMarkdown化する。 */
  const convertLists = (root) => {
    const lists = Array.from(root.querySelectorAll("ul, ol")).sort(
      (a, b) => getNestedListDepth(b) - getNestedListDepth(a)
    );
    lists.forEach((list) => {
      if (root.contains(list)) {
        convertListElement(list);
      }
    });
  };

  /**
   * テーブルのセル内容を1行のMarkdownセル文字列へ整形する。
   * 区切り文字 `|` はエスケープし、セル内改行は `<br>` にする（GFM の表は複数行セルを持てない）。
   * @param {Element} cell - th / td 要素。
   * @returns {string} セル文字列。
   */
  const normalizeTableCellText = (cell) =>
    (cell.textContent ?? "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("<br>")
      .replace(/\|/g, "\\|");

  /**
   * table 要素を GFM の表へ変換する。
   * 1行目を見出し行として扱う（`th` が無い表でも GFM は見出し行を必須とするため）。
   * @param {Element} table - 変換対象の table 要素。
   */
  const convertTableElement = (table) => {
    const rows = Array.from(table.querySelectorAll("tr"))
      .map((tr) => Array.from(tr.children).filter((cell) => /^t[hd]$/i.test(cell.tagName ?? "")))
      .filter((cells) => cells.length > 0)
      .map((cells) => cells.map(normalizeTableCellText));

    if (rows.length === 0) {
      table.remove();
      return;
    }

    const columnCount = Math.max(...rows.map((cells) => cells.length));
    const padded = rows.map((cells) => [...cells, ...Array(columnCount - cells.length).fill("")]);
    const toLine = (cells) => `| ${cells.join(" | ")} |`;
    const lines = [toLine(padded[0]), `| ${Array(columnCount).fill("---").join(" | ")} |`];
    padded.slice(1).forEach((cells) => lines.push(toLine(cells)));

    const captionText = (table.querySelector("caption")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const caption = captionText ? `*${captionText.replace(/\*/g, "\\*")}*\n\n` : "";
    replaceElementWithText(table, `\n\n${caption}${lines.join("\n")}\n\n`);
  };

  /** ルート配下の table を内側から順に GFM の表へ変換する。 */
  const convertTables = (root) => {
    const tables = Array.from(root.querySelectorAll("table")).sort(
      (a, b) => getAncestorCount(b, "table") - getAncestorCount(a, "table")
    );
    tables.forEach((table) => {
      if (root.contains(table)) {
        convertTableElement(table);
      }
    });
  };

  /** 段落・li・tr の末尾に改行を補う。 */
  const appendParagraphNewlines = (root) => {
    const doc = root.ownerDocument ?? document;
    root.querySelectorAll("p").forEach((el) => {
      el.append(doc.createTextNode("\n\n"));
    });
    root.querySelectorAll("li, tr").forEach((el) => {
      el.append(doc.createTextNode("\n"));
    });
  };

  /**
   * 引用内テキストを `>` 付きの行へ変換する。
   * 連続する空行は1つにまとめ、先頭と末尾の空行は落とす。
   * @param {string} raw - 引用内テキスト。
   * @returns {string} `>` 付きテキスト。
   */
  const quoteLines = (raw) => {
    const lines = raw.split("\n").map((line) => (line.trim() === "" ? ">" : `> ${line}`));
    const collapsed = lines.filter((line, index) => line !== ">" || lines[index - 1] !== ">");
    while (collapsed[0] === ">") {
      collapsed.shift();
    }
    while (collapsed[collapsed.length - 1] === ">") {
      collapsed.pop();
    }
    return collapsed.join("\n");
  };

  /**
   * blockquote を `>` 記法のMarkdown引用へ変換する。
   * 内側の引用から先に文字列化するので、入れ子は `> >` として残る。
   */
  const convertBlockquotes = (root) => {
    const blockquotes = Array.from(root.querySelectorAll("blockquote")).sort(
      (a, b) => getAncestorCount(b, "blockquote") - getAncestorCount(a, "blockquote")
    );
    blockquotes.forEach((blockquote) => {
      if (!root.contains(blockquote)) {
        return;
      }
      appendParagraphNewlines(blockquote);
      const raw = (blockquote.textContent ?? "").trim();
      if (!raw) {
        blockquote.remove();
        return;
      }
      replaceElementWithText(blockquote, `\n\n${quoteLines(raw)}\n\n`);
    });
  };

  /** ブロック要素境界の改行を補正する。 */
  const appendBlockNewlines = (root) => {
    appendParagraphNewlines(root);
    const doc = root.ownerDocument ?? document;
    Array.from(root.children).forEach((el) => {
      if (el.tagName?.toLowerCase() === "div") {
        el.append(doc.createTextNode("\n"));
      }
    });
  };

  /**
   * フェンスコードブロック（``` 以上のバッククォート対）。
   * コード内の空行は意味を持つので、整形の対象外にする。
   */
  const FENCED_CODE_PATTERN = /(`{3,})[\s\S]*?\1/g;

  /**
   * 余分な空行を整理する。
   * 各ブロックの変換が前後に改行を足すため、段落の直後に画像・引用・表・リストが続くと
   * 改行が積み重なって空行が 2〜3 行並ぶ。Markdown では 1 行の空行と同じ意味なので、
   * 空白だけの行を空行に揃えたうえで、連続する空行を 1 つにまとめる。
   * フェンスコードブロックの中身は手を付けない。
   * @param {string} markdown - 整形対象Markdown。
   * @returns {string} 整形後Markdown。
   */
  const collapseBlankLines = (markdown) => {
    const pattern = new RegExp(FENCED_CODE_PATTERN.source, "g");
    // ハード改行（行末の2スペース）は残す必要があるため、空白だけの行に限って空行へ揃える。
    const normalize = (text) => text.replace(/^[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");

    let output = "";
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      output += normalize(markdown.slice(lastIndex, match.index)) + match[0];
      lastIndex = pattern.lastIndex;
    }
    return output + normalize(markdown.slice(lastIndex));
  };

  /** 行が末尾ハッシュタグ（noteタグ）か判定する。 */
  const isTrailingHashtagLine = (line) => {
    const trimmed = line.trim();
    return (
      /^#[\p{Letter}\p{Number}_-]+$/u.test(trimmed) ||
      /^\[#.+?\]\(https:\/\/note\.com\/hashtag\/.+\)$/.test(trimmed)
    );
  };

  /**
   * 本文末尾に付与されるnoteタグ行を除去する。
   * @param {string} markdown - 処理対象Markdown。
   * @returns {string} タグ行除去後Markdown。
   */
  const stripTrailingHashtags = (markdown) => {
    const lines = markdown.split("\n");
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    while (lines.length > 0 && isTrailingHashtagLine(lines[lines.length - 1])) {
      lines.pop();
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
      }
    }
    return lines.join("\n").trim();
  };

  /**
   * 記事本文DOMをMarkdown本文へ変換する中核処理。
   * @param {Element} articleRoot - 記事本文ルート要素。
   * @param {string} baseUrl - 相対URL解決用ベース。
   * @returns {string} Markdown本文。
   */
  const articleElementToMarkdown = (articleRoot, baseUrl) => {
    // 記事DOMと同じ Document 上で複製する。
    // popup から URL 変換する場合、DOMParser で作った不活性ドキュメント内に閉じるため、
    // 外部HTMLが拡張ページの生きた DOM に入らない（画像の再取得も発生しない）。
    const doc = articleRoot.ownerDocument ?? document;
    const wrapper = doc.createElement("div");
    wrapper.id = "__article-root";
    wrapper.append(...Array.from(articleRoot.cloneNode(true).childNodes));

    removeNoteChrome(wrapper);
    preserveFigureLinks(wrapper, baseUrl);
    convertImagesToMarkdown(wrapper, baseUrl);
    removeTrailingBlocks(wrapper);

    wrapper.querySelectorAll("br").forEach((br) => {
      replaceElementWithText(br, MARKDOWN_HARD_LINE_BREAK);
    });

    while (wrapper.querySelector("pre")) {
      const pre = wrapper.querySelector("pre");
      const innerCode = pre.querySelector("code");
      let lang = "";
      if (innerCode) {
        const cls = innerCode.getAttribute("class") ?? "";
        const match = cls.match(/language-([\w-]+)/);
        lang = match ? match[1] ?? "" : "";
      }
      const bodySource = innerCode ?? pre;
      replaceElementWithText(pre, buildFencedCodeBlock(lang, bodySource.textContent ?? ""));
    }

    let guard = 0;
    while (guard++ < 10000) {
      const codeLeaves = Array.from(wrapper.querySelectorAll("code")).filter(
        (el) => !el.querySelector("code")
      );
      if (codeLeaves.length > 0) {
        codeLeaves.forEach((el) => {
          replaceElementWithText(el, wrapInlineCode(el.textContent ?? ""));
        });
        continue;
      }
      const strongLeaves = Array.from(wrapper.querySelectorAll("strong, b")).filter(
        (el) => !el.querySelector("strong, b")
      );
      if (strongLeaves.length > 0) {
        strongLeaves.forEach((el) => {
          replaceElementWithText(el, wrapStrongText(el.textContent ?? ""));
        });
        continue;
      }
      break;
    }

    guard = 0;
    while (guard++ < 10000) {
      const linkLeaves = Array.from(wrapper.querySelectorAll("a[href]")).filter(
        (el) => !el.querySelector("a")
      );
      if (linkLeaves.length === 0) {
        break;
      }
      linkLeaves.forEach((anchor) => {
        replaceElementWithText(anchor, buildMarkdownLinkReplacement(anchor, baseUrl));
      });
    }

    convertLists(wrapper);
    convertTables(wrapper);
    convertHeadings(wrapper);
    convertHorizontalRules(wrapper);
    convertBlockquotes(wrapper);
    appendBlockNewlines(wrapper);

    return stripTrailingHashtags(collapseBlankLines(wrapper.textContent ?? ""));
  };

  /**
   * note記事本文のDOMルート候補を順に探索する。
   * @param {Document} doc - 対象ドキュメント。
   * @returns {Element|null} 本文ルート。
   */
  const findArticleRoot = (doc) => {
    const bodySelectors = [
      '[data-name="body"].note-common-styles__textnote-body',
      ".note-common-styles__textnote-body",
      '[data-name="body"]',
    ];

    for (const selector of bodySelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        return el;
      }
    }

    const article = doc.querySelector("article");
    if (article) {
      const innerBody = article.querySelector(
        '[data-name="body"], .note-common-styles__textnote-body'
      );
      if (innerBody) {
        return innerBody;
      }
    }

    return null;
  };

  /**
   * 有料記事の課金境界（paywall）を検出する。
   * note.com は配信HTMLに無料公開部分だけを載せ、続きは `.note-paywall` の
   * 「ここから先は N字 / M画像」ブロックに置き換えている。
   * 購入済み・自分の記事では paywall 要素が無いので、その場合は null。
   * @param {Document} doc - 対象ドキュメント。
   * @returns {{chars: number|null, images: number|null}|null} 未取得部分の量。paywall が無ければ null。
   */
  const extractPaywall = (doc) => {
    const paywall = doc.querySelector(".note-paywall, .p-article__paywall");
    if (!paywall) {
      return null;
    }
    const headerText = (paywall.querySelector(".m-paywallHeader") ?? paywall).textContent ?? "";
    const chars = headerText.match(/([\d,]+)\s*字/)?.[1]?.replace(/,/g, "");
    const images = headerText.match(/(\d+)\s*画像/)?.[1];
    // 「ここから先は」の見出しも量の表示も無い枠は課金境界とみなさない
    //（購入済み表示など、同じクラスの別状態を誤検出しないため）。
    if (!/ここから先は/.test(headerText) && !chars && !images) {
      return null;
    }
    return {
      chars: chars ? Number(chars) : null,
      images: images ? Number(images) : null,
    };
  };

  /**
   * 有料部分が含まれていないことを示す注記行を作る。
   * 出力ファイルだけを見て「途中までしか無い」と分かるようにする。
   * @param {{chars: number|null, images: number|null}} paywall - 未取得部分の量。
   * @returns {string} 注記行（Markdown）。
   */
  const buildPaywallNotice = (paywall) => {
    const amount = [
      paywall.chars != null ? `${paywall.chars.toLocaleString("en-US")}字` : "",
      paywall.images != null ? `${paywall.images}画像` : "",
    ]
      .filter(Boolean)
      .join(" / ");
    return `> ここから先は有料部分${amount ? `（${amount}）` : ""}のため、この Markdown には含まれていません。`;
  };

  /**
   * 記事タイトルを優先順位付きで抽出する。
   * @param {Document} doc - 対象ドキュメント。
   * @returns {string} タイトル。
   */
  const extractTitle = (doc) => {
    const ogTitle = doc.querySelector("meta[property='og:title']")?.getAttribute("content");
    if (ogTitle) {
      return sanitizeTitle(ogTitle);
    }
    const h1 = doc.querySelector("h1")?.textContent?.trim();
    if (h1) {
      return sanitizeTitle(h1);
    }
    return sanitizeTitle(doc.title || "untitled");
  };

  /**
   * YAML文字列値として安全に出力するためのエスケープを行う。
   * @param {string} value - 生文字列。
   * @returns {string} YAML向け文字列。
   */
  const escapeYamlString = (value) => {
    if (/[:#{}[\],&*!|>'"%@`]/.test(value) || value.includes("\n") || /^\s|\s$/.test(value)) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return value;
  };

  /**
   * ユーザー指定タグを重複なし・上限付きで正規化する。
   * @param {unknown[]} tags - 入力タグ配列。
   * @param {number} [maxTags=5] - 最大件数。
   * @returns {string[]} 正規化済みタグ。
   */
  const normalizeUserTags = (tags, maxTags = 5) => {
    const normalized = [];
    (Array.isArray(tags) ? tags : []).forEach((tag) => {
      const value = String(tag).replace(/^#/, "").trim();
      if (value && !normalized.includes(value) && normalized.length < maxTags) {
        normalized.push(value);
      }
    });
    return normalized;
  };

  /** 正規表現で使う特殊文字をエスケープする。 */
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * Obsidianリンク化対象ワードを正規化し、長い語を優先する順で返す。
   * @param {unknown[]} words - 入力ワード配列。
   * @returns {string[]} 正規化済みワード。
   */
  const normalizeObsidianLinkWords = (words) => {
    const normalized = [];
    (Array.isArray(words) ? words : []).forEach((word) => {
      const value = String(word).trim();
      if (value && !normalized.includes(value)) {
        normalized.push(value);
      }
    });
    return normalized.sort((a, b) => b.length - a.length);
  };

  const LINKIFY_PROTECTED_PATTERN =
    /(```[\s\S]*?```|`[^`\n]+`|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|\[\[[^\]]*\]\])/g;

  const splitMarkdownForLinkify = (text) => {
    const parts = [];
    let lastIndex = 0;
    const pattern = new RegExp(LINKIFY_PROTECTED_PATTERN.source, "g");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), protected: false });
      }
      parts.push({ text: match[0], protected: true });
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), protected: false });
    }
    if (parts.length === 0) {
      parts.push({ text, protected: false });
    }
    return parts;
  };

  const ASCII_WORD_CHAR_CLASS = "A-Za-z0-9_";
  const ASCII_WORD_CHAR_PATTERN = /[A-Za-z0-9_]/;

  /**
   * 保護対象外の平文テキストだけを `[[word]]` へ変換する。
   * @param {string} text - 処理対象テキスト。
   * @param {string[]} words - 置換対象ワード。
   * @returns {string} 置換後テキスト。
   */
  const linkifyPlainText = (text, words) => {
    let result = text;
    for (const word of words) {
      const regex = ASCII_WORD_CHAR_PATTERN.test(word)
        ? new RegExp(
            `(?<!\\[\\[)(?<![${ASCII_WORD_CHAR_CLASS}])(${escapeRegex(word)})(?![${ASCII_WORD_CHAR_CLASS}])(?!\\]\\])`,
            "gu"
          )
        : new RegExp(`(?<!\\[\\[)(${escapeRegex(word)})(?!\\]\\])`, "gu");
      result = result.replace(regex, "[[$1]]");
    }
    return result;
  };

  /**
   * Markdown本文へ Obsidianリンク化を適用する。
   * コードブロック・既存リンク・既存 `[[...]]` は保護する。
   * @param {string} markdown - 対象Markdown。
   * @param {unknown[]} words - 対象ワード配列。
   * @returns {string} 変換後Markdown。
   */
  const applyObsidianLinkify = (markdown, words) => {
    const normalized = normalizeObsidianLinkWords(words);
    if (!normalized.length) {
      return markdown;
    }
    return splitMarkdownForLinkify(markdown)
      .map((part) => (part.protected ? part.text : linkifyPlainText(part.text, normalized)))
      .join("");
  };

  /**
   * ファイル名／フォルダ名として安全な文字列へ正規化する。
   * @param {string} value - 元文字列。
   * @returns {string} 正規化後の名前。空になる場合は "note-article"。
   */
  const sanitizeFileBaseName = (value) =>
    String(value ?? "")
      .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "note-article";

  /** 記事URLから note_id を抽出する。 */
  const extractNoteId = (pageUrl) => {
    try {
      const match = new URL(pageUrl).pathname.match(/\/n\/([^/]+)/);
      return match?.[1] ?? "";
    } catch {
      return "";
    }
  };

  /**
   * 記事作成者ユーザー名を抽出する。
   * @param {Document} doc - 対象ドキュメント。
   * @param {string} pageUrl - 記事URL（フォールバック抽出用）。
   * @returns {string} 作成者ユーザー名。
   */
  const extractAuthor = (doc, pageUrl) => {
    const creatorLink = doc.querySelector(
      ".o-noteContentHeader__avatar[href], .o-noteContentHeader__creatorInfo a[href]"
    );
    if (creatorLink) {
      const href = creatorLink.getAttribute("href") ?? "";
      const username = href.replace(/^\/+/, "").split("/")[0]?.trim();
      if (username) {
        return username;
      }
    }

    try {
      const segments = new URL(pageUrl).pathname.split("/").filter(Boolean);
      const nIndex = segments.indexOf("n");
      if (nIndex > 0) {
        return segments[nIndex - 1];
      }
    } catch {
      // ignore
    }

    return "";
  };

  /**
   * テキストからスキ数（非負整数）をパースする。
   * @param {string} raw - 生テキスト。
   * @returns {number|null} パース結果。数値でなければ null。
   */
  const parseLikeCountText = (raw) => {
    const match = String(raw ?? "").replace(/,/g, "").match(/\d+/);
    if (!match) {
      return null;
    }
    const count = Number.parseInt(match[0], 10);
    return Number.isFinite(count) ? count : null;
  };

  /**
   * 記事のスキ数を抽出する。
   * @param {Document} doc - 対象ドキュメント。
   * @returns {number|null} スキ数。未取得時は null。
   */
  const extractLikeCount = (doc) => {
    const countSelectors = [
      ".o-noteLikeV3__count",
      ".o-noteLike__count",
      "button[class*='noteLike'][class*='count']",
    ];
    for (const selector of countSelectors) {
      for (const el of doc.querySelectorAll(selector)) {
        const count = parseLikeCountText(el.textContent);
        if (count !== null) {
          return count;
        }
        const ariaLabel = el.getAttribute("aria-label") ?? "";
        const ariaCount = parseLikeCountText(ariaLabel.match(/^(\d[\d,]*)/)?.[1]);
        if (ariaCount !== null) {
          return ariaCount;
        }
      }
    }

    for (const el of doc.querySelectorAll("[aria-label*='スキ'][class*='noteLike']")) {
      const ariaCount = parseLikeCountText(el.getAttribute("aria-label")?.match(/^(\d[\d,]*)/)?.[1]);
      if (ariaCount !== null) {
        return ariaCount;
      }
    }

    return null;
  };

  /**
   * 公開日を `YYYY-MM-DD` 形式で抽出する。
   * @param {Document} doc - 対象ドキュメント。
   * @returns {string} 公開日文字列。未取得時は空文字。
   */
  const extractPublished = (doc) => {
    const datetime = doc
      .querySelector(".o-noteContentHeader__date time[datetime], article time[datetime]")
      ?.getAttribute("datetime");
    if (!datetime) {
      return "";
    }

    const parsed = new Date(datetime);
    if (Number.isNaN(parsed.getTime())) {
      // 解釈できない形式でも、ISO らしき先頭部分だけは残す。
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(datetime)
        ? datetime.slice(0, 19)
        : datetime.slice(0, 10);
    }
    /*
     * 日本時間の「年月日と時刻」をそのまま書く。
     *
     * オフセットを付けないのは、Obsidian が「日付と時刻」のプロパティとして
     * 認識できる形式が YYYY-MM-DDTHH:mm:ss のためで、付けるとテキスト扱いになる。
     * note は日本時間が前提なので、日本時間に揃えたうえで表記を省く。
     */
    return formatJapanDateTime(parsed);
  };

  /**
   * ソースURL（og:url優先）を取得する。
   * @param {Document} doc - 対象ドキュメント。
   * @param {string} pageUrl - フォールバックURL。
   * @returns {string} ソースURL。
   */
  const extractSource = (doc, pageUrl) =>
    doc.querySelector("meta[property='og:url']")?.getAttribute("content")?.trim() ?? pageUrl;

  /**
   * 日時を日本時間（JST）の ISO 8601 文字列へ整形する。
   * @param {Date} [date=new Date()] - 変換対象日時。
   * @returns {string} `YYYY-MM-DDTHH:mm:ss.sss+09:00` 形式の文字列。
   */
  /**
   * 日時を日本時間の各要素へ分解する。
   * @param {Date} date - 対象日時。
   * @param {boolean} [withMilliseconds=false] - ミリ秒を含めるか。
   * @returns {Record<string, string>} 年月日時分秒（必要ならミリ秒）。
   */
  const toJapanTimeParts = (date, withMilliseconds = false) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        ...(withMilliseconds ? { fractionalSecondDigits: 3 } : {}),
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

  /**
   * 日本時間の「YYYY-MM-DDTHH:mm:ss」を返す（オフセットなし）。
   * @param {Date} date - 対象日時。
   * @returns {string} 日時文字列。
   */
  const formatJapanDateTime = (date) => {
    const parts = toJapanTimeParts(date);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };

  const formatJapanTimeISO = (date = new Date()) => {
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
        fractionalSecondDigits: 3,
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

    const fractionalSecond = parts.fractionalSecond ?? "000";
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${fractionalSecond}+09:00`;
  };

  /**
   * メタデータからYAML frontmatterを構築する。
   * @param {{title?: string, source?: string, note_id?: string, author?: string, published?: string, like_count?: number|null, tags?: string[], converted_at?: string}} metadata
   * @returns {string} YAML frontmatter。
   */
  const buildYamlFrontmatter = (metadata) => {
    const lines = ["---"];

    if (metadata.title) {
      lines.push(`title: ${escapeYamlString(metadata.title)}`);
    }
    if (metadata.source) {
      lines.push(`source: ${escapeYamlString(metadata.source)}`);
    }
    if (metadata.note_id) {
      lines.push(`note_id: ${escapeYamlString(metadata.note_id)}`);
    }
    if (metadata.author) {
      lines.push(`author: ${escapeYamlString(metadata.author)}`);
    }
    if (metadata.published) {
      lines.push(`published: ${metadata.published}`);
    }
    if (metadata.like_count != null) {
      lines.push(`like_count: ${metadata.like_count}`);
    }
    if (metadata.tags?.length) {
      lines.push("tags:");
      metadata.tags.forEach((tag) => {
        lines.push(`  - ${escapeYamlString(tag)}`);
      });
    }
    if (metadata.converted_at) {
      lines.push(`converted_at: ${escapeYamlString(metadata.converted_at)}`);
    }
    lines.push("---");
    return lines.join("\n");
  };

  /**
   * note記事ページDOM全体をMarkdownへ変換する公開API。
   * @param {Document} [doc=document] - 変換対象ドキュメント。
   * @param {string} [pageUrl=global.location?.href ?? ""] - 記事URL。
   * @param {{tags?: unknown[], obsidianLinkify?: boolean, obsidianLinkWords?: unknown[], convertedAt?: string}} [options={}] - 変換オプション。
   * @returns {{title: string, markdown: string, metadata: object}} 変換結果。
   */
  const convertNotePageToMarkdown = (
    doc = document,
    pageUrl = global.location?.href ?? "",
    options = {}
  ) => {
    const articleRoot = findArticleRoot(doc);
    const paywall = extractPaywall(doc);
    if (!articleRoot) {
      if (paywall) {
        throw new Error("有料記事のため本文を取得できません（無料公開部分がありません）。");
      }
      throw new Error("記事本文が見つかりません。note.com の記事ページで実行してください。");
    }

    const title = extractTitle(doc);
    let body = articleElementToMarkdown(articleRoot, pageUrl);
    if (paywall && !body) {
      throw new Error("有料記事のため本文を取得できません（無料公開部分がありません）。");
    }
    if (options.obsidianLinkify) {
      body = applyObsidianLinkify(body ?? "", options.obsidianLinkWords);
    }
    if (paywall) {
      body = `${body}\n\n${buildPaywallNotice(paywall)}`;
    }
    const tags = normalizeUserTags(options.tags);
    const metadata = {
      title,
      source: extractSource(doc, pageUrl),
      note_id: extractNoteId(pageUrl),
      author: extractAuthor(doc, pageUrl),
      published: extractPublished(doc),
      like_count: extractLikeCount(doc),
      tags,
      converted_at: options.convertedAt ?? formatJapanTimeISO(),
    };
    const frontmatter = buildYamlFrontmatter(metadata);
    const markdown = body ? `${frontmatter}\n\n# ${title}\n\n${body}` : `${frontmatter}\n\n# ${title}`;

    // paywall は frontmatter には出さない（buildYamlFrontmatter が扱うキーだけが出力される）。
    // 呼び出し側が「途中までしか取れていない」ことを利用者へ知らせるために返す。
    return { title, markdown, metadata, paywall };
  };

  const IMAGE_MARKDOWN_URL_PATTERN = /!\[([^\]]*)]\((https?:\/\/[^)]+)\)/g;

  const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

  /**
   * note記事URLから note_id を抽出する。
   * @param {string} pageUrl - 記事URL。
   * @returns {string} note_id。未取得時は空文字。
   */
  const extractNoteIdFromUrl = (pageUrl) => extractNoteId(pageUrl);

  /**
   * 画像保存先に使う note ID フォルダ名を返す。
   * パス区切りなどファイル名に使えない文字は除去する。
   * @param {string} pageUrl - 記事URL。
   * @returns {string} フォルダ名。抽出できない場合は "note-article"。
   */
  const noteFolderNameFromUrl = (pageUrl) => {
    const noteId = extractNoteId(pageUrl);
    if (!noteId) {
      return "note-article";
    }
    return sanitizeFileBaseName(noteId);
  };

  /**
   * URLパスから画像拡張子を推定する。
   * @param {string} url - 画像URL。
   * @returns {string} 拡張子。不明時は空文字。
   */
  const extensionFromUrl = (url) => {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      const ext = match?.[1]?.toLowerCase() ?? "";
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        return "";
      }
      return ext === "jpeg" ? "jpg" : ext;
    } catch {
      return "";
    }
  };

  /**
   * Blob を data URI 文字列へ変換する。
   * @param {Blob} blob - 変換対象Blob。
   * @returns {Promise<string>} data URI。
   */
  const blobToDataUri = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("画像の読み込みに失敗しました。"));
      reader.readAsDataURL(blob);
    });

  /**
   * 画像URLを取得し Blob を返す。
   * @param {string} url - 画像URL。
   * @returns {Promise<Blob>} 取得した画像Blob。
   */
  const fetchImageBlob = async (url) => {
    const response = await fetchWithTimeout(url, { credentials: "omit" });
    if (!response.ok) {
      throw new Error(`画像の取得に失敗しました（HTTP ${response.status}）。`);
    }
    return response.blob();
  };

  /**
   * Markdown 内の note 画像 URL を取込方式に応じて置換する。
   * @param {string} markdown - 変換済みMarkdown。
   * @param {{imageImportMode?: "url"|"download"|"base64", imagePathPrefix?: string}} [options={}] - 画像取込オプション。
   * @returns {Promise<{markdown: string, images: {filename: string, url: string}[]}>} 処理後Markdownと保存対象画像。
   */
  const processMarkdownImages = async (markdown, options = {}) => {
    const mode = options.imageImportMode ?? "url";
    if (mode === "url") {
      return { markdown, images: [] };
    }

    const pathPrefix = String(options.imagePathPrefix ?? "");
    const pattern = new RegExp(IMAGE_MARKDOWN_URL_PATTERN.source, "g");
    const images = [];
    let output = "";
    let lastIndex = 0;
    let imageIndex = 0;
    let match;

    while ((match = pattern.exec(markdown)) !== null) {
      const [full, alt, url] = match;
      output += markdown.slice(lastIndex, match.index);

      try {
        if (mode === "base64") {
          const blob = await fetchImageBlob(url);
          imageIndex += 1;
          const dataUri = await blobToDataUri(blob);
          output += `![${alt}](${dataUri})`;
        } else {
          const ext = extensionFromUrl(url) || "png";
          imageIndex += 1;
          const basename = `img${imageIndex}.${ext}`;
          const markdownPath = pathPrefix ? `${pathPrefix}${basename}` : basename;
          images.push({ filename: basename, url });
          output += `![${alt}](${markdownPath})`;
        }
      } catch {
        output += full;
      }

      lastIndex = pattern.lastIndex;
    }

    output += markdown.slice(lastIndex);
    return { markdown: output, images };
  };

  /**
   * 画像保存の結果を Markdown へ反映する。
   * 保存時に拡張子が変わった画像は参照先を差し替え、保存できなかった画像は
   * ローカル参照のままにせず元の note URL へ戻す（リンク切れの Markdown を残さない）。
   * @param {string} markdown - processMarkdownImages 後の Markdown。
   * @param {{url: string, requested: string, filename: string|null}[]} results - 画像ごとの保存結果。
   * @param {string} [pathPrefix=""] - Markdown 内の参照パスに付けた接頭辞。
   * @returns {string} 反映後 Markdown。
   */
  const applyImageSaveResults = (markdown, results, pathPrefix = "") => {
    let output = markdown;
    for (const result of results ?? []) {
      const requested = String(result?.requested ?? "");
      if (!requested) {
        continue;
      }
      const target = `](${pathPrefix}${requested})`;
      const replacement = result?.filename ? `](${pathPrefix}${result.filename})` : `](${result?.url ?? ""})`;
      if (target !== replacement) {
        output = output.split(target).join(replacement);
      }
    }
    return output;
  };

  global.NoteToMarkdown = {
    convertNotePageToMarkdown,
    extractTitleFromDocument: extractTitle,
    extractNoteIdFromUrl,
    noteFolderNameFromUrl,
    sanitizeFileBaseName,
    processMarkdownImages,
    applyImageSaveResults,
    isNoteArticleUrl,
    fetchWithTimeout,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

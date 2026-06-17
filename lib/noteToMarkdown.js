/**
 * note.com 記事の DOM → Markdown 変換ライブラリ。
 * popup / content script から NoteToMarkdown として利用する。
 */
(function (global) {
  const MARKDOWN_HARD_LINE_BREAK = "  \n";
  const MARKDOWN_HORIZONTAL_RULE = "\n\n---\n\n";

  const isNoteArticleUrl = (url, base) => {
    try {
      const parsed = base ? new URL(url, base) : new URL(url);
      const host = parsed.hostname;
      const isNoteHost = host === "note.com" || host.endsWith(".note.com");
      return isNoteHost && /\/n\/[^/]+/.test(parsed.pathname);
    } catch {
      return false;
    }
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const sanitizeTitle = (raw) => raw.replace(/\s*[｜|]\s*[^｜|]+$/, "").trim();

  const resolveLinkHref = (href, baseUrl) => {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  };

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

  const buildFencedCodeBlock = (lang, body) => {
    let fence = "```";
    while (body.includes(fence)) {
      fence += "`";
    }
    const langLine = lang.trim();
    return `\n${fence}${langLine ? langLine : ""}\n${body.trimEnd()}\n${fence}\n`;
  };

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

  const isMarkdownImageSyntax = (text) => /^!\[[^\]]*]\([^)]+\)$/.test(text.trim());

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

  const replaceElementWithText = (element, text) => {
    element.replaceWith(document.createTextNode(text));
  };

  const isEmptyTrailingBlock = (el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "br" || tag === "hr") {
      return true;
    }
    return (el.textContent ?? "").trim().length === 0;
  };

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

  const preserveFigureLinks = (root) => {
    root.querySelectorAll("figure").forEach((figure) => {
      if (figure.querySelector("img, picture")) {
        return;
      }

      const links = Array.from(figure.querySelectorAll("a[href]"))
        .map((anchor) => anchor.getAttribute("href")?.trim() ?? "")
        .filter(Boolean);

      const uniqueLinks = Array.from(new Set(links));
      if (uniqueLinks.length === 0) {
        return;
      }

      const markdownLinks = uniqueLinks.map((href) => `\n\n[${href}](${href})\n\n`).join("");
      replaceElementWithText(figure, markdownLinks);
    });
  };

  const escapeMarkdownImageAlt = (alt) => alt.replace(/\]/g, "\\]");

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

  const buildImageMarkdown = (alt, src, caption) => {
    let markdown = `\n\n![${alt}](${src})\n\n`;
    if (caption) {
      markdown += `*${caption.replace(/\*/g, "\\*")}*\n\n`;
    }
    return markdown;
  };

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
      const alt = escapeMarkdownImageAlt((img.getAttribute("alt") ?? "").trim());
      const caption = (figure.querySelector("figcaption")?.textContent ?? "").trim();
      replaceElementWithText(figure, buildImageMarkdown(alt, src, caption));
    });

    root.querySelectorAll("img").forEach((img) => {
      const src = resolveImageSrc(img, baseUrl);
      if (!src) {
        img.remove();
        return;
      }
      const alt = escapeMarkdownImageAlt((img.getAttribute("alt") ?? "").trim());
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

  const convertHorizontalRules = (root) => {
    root.querySelectorAll("hr").forEach((hr) => {
      replaceElementWithText(hr, MARKDOWN_HORIZONTAL_RULE);
    });
  };

  const getNestedListDepth = (el) => {
    let depth = 0;
    let current = el.parentElement;
    while (current) {
      const tag = current.tagName?.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        depth += 1;
      }
      current = current.parentElement;
    }
    return depth;
  };

  const normalizeListItemText = (raw) =>
    raw
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");

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

  const appendParagraphNewlines = (root) => {
    root.querySelectorAll("p").forEach((el) => {
      el.append(document.createTextNode("\n\n"));
    });
    root.querySelectorAll("li, tr").forEach((el) => {
      el.append(document.createTextNode("\n"));
    });
  };

  const convertBlockquotes = (root) => {
    let blockquote = root.querySelector("blockquote:not(blockquote blockquote)");
    while (blockquote) {
      appendParagraphNewlines(blockquote);
      const raw = (blockquote.textContent ?? "").trim();
      if (!raw) {
        blockquote.remove();
      } else {
        const quoted = raw
          .split("\n")
          .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
          .join("\n");
        replaceElementWithText(blockquote, `\n\n${quoted}\n\n`);
      }
      blockquote = root.querySelector("blockquote:not(blockquote blockquote)");
    }
  };

  const appendBlockNewlines = (root) => {
    appendParagraphNewlines(root);
    Array.from(root.children).forEach((el) => {
      if (el.tagName?.toLowerCase() === "div") {
        el.append(document.createTextNode("\n"));
      }
    });
  };

  const isTrailingHashtagLine = (line) => {
    const trimmed = line.trim();
    return (
      /^#[\p{Letter}\p{Number}_-]+$/u.test(trimmed) ||
      /^\[#.+?\]\(https:\/\/note\.com\/hashtag\/.+\)$/.test(trimmed)
    );
  };

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

  const articleElementToMarkdown = (articleRoot, baseUrl) => {
    const wrapper = document.createElement("div");
    wrapper.id = "__article-root";
    wrapper.innerHTML = articleRoot.innerHTML;

    removeNoteChrome(wrapper);
    preserveFigureLinks(wrapper);
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
    convertHeadings(wrapper);
    convertHorizontalRules(wrapper);
    convertBlockquotes(wrapper);
    appendBlockNewlines(wrapper);

    return stripTrailingHashtags(wrapper.textContent ?? "");
  };

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

  const escapeYamlString = (value) => {
    if (/[:#{}[\],&*!|>'"%@`]/.test(value) || value.includes("\n") || /^\s|\s$/.test(value)) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return value;
  };

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

  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

  const WORD_CHAR_CLASS = "\\p{Letter}\\p{Number}_";
  const ASCII_WORD_CHAR_CLASS = "A-Za-z0-9_";
  const ASCII_WORD_CHAR_PATTERN = /[A-Za-z0-9_]/;

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

  const applyObsidianLinkify = (markdown, words) => {
    const normalized = normalizeObsidianLinkWords(words);
    if (!normalized.length) {
      return markdown;
    }
    return splitMarkdownForLinkify(markdown)
      .map((part) => (part.protected ? part.text : linkifyPlainText(part.text, normalized)))
      .join("");
  };

  const extractNoteId = (pageUrl) => {
    try {
      const match = new URL(pageUrl).pathname.match(/\/n\/([^/]+)/);
      return match?.[1] ?? "";
    } catch {
      return "";
    }
  };

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

  const extractPublished = (doc) => {
    const datetime = doc
      .querySelector(".o-noteContentHeader__date time[datetime], article time[datetime]")
      ?.getAttribute("datetime");
    if (!datetime) {
      return "";
    }

    const parsed = new Date(datetime);
    if (Number.isNaN(parsed.getTime())) {
      return datetime.slice(0, 10);
    }
    return parsed.toISOString().slice(0, 10);
  };

  const extractSource = (doc, pageUrl) =>
    doc.querySelector("meta[property='og:url']")?.getAttribute("content")?.trim() ?? pageUrl;

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
    if (metadata.tags?.length) {
      lines.push("tags:");
      metadata.tags.forEach((tag) => {
        lines.push(`  - ${escapeYamlString(tag)}`);
      });
    }
    if (metadata.converted_at) {
      lines.push(`converted_at: ${metadata.converted_at}`);
    }
    lines.push("---");
    return lines.join("\n");
  };

  const convertNotePageToMarkdown = (
    doc = document,
    pageUrl = global.location?.href ?? "",
    options = {}
  ) => {
    const articleRoot = findArticleRoot(doc);
    if (!articleRoot) {
      throw new Error("記事本文が見つかりません。note.com の記事ページで実行してください。");
    }

    const title = extractTitle(doc);
    let body = articleElementToMarkdown(articleRoot, pageUrl);
    if (options.obsidianLinkify) {
      body = applyObsidianLinkify(body ?? "", options.obsidianLinkWords);
    }
    const tags = normalizeUserTags(options.tags);
    const metadata = {
      title,
      source: extractSource(doc, pageUrl),
      note_id: extractNoteId(pageUrl),
      author: extractAuthor(doc, pageUrl),
      published: extractPublished(doc),
      tags,
      converted_at: options.convertedAt ?? new Date().toISOString(),
    };
    const frontmatter = buildYamlFrontmatter(metadata);
    const markdown = body ? `${frontmatter}\n\n# ${title}\n\n${body}` : `${frontmatter}\n\n# ${title}`;

    return { title, markdown, metadata };
  };

  global.NoteToMarkdown = {
    convertNotePageToMarkdown,
    isNoteArticleUrl,
    fetchWithTimeout
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

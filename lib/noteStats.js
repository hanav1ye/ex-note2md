/**
 * note のダッシュボードから記事別のページビュー数・インプレッション数を取得するロジック。
 * content script（note.com オリジン）から NtmNoteStats として利用する。
 *
 * 2026-09-08 のダッシュボード刷新以降、これらの数値は公開 API では取れず、
 * ログイン済みセッションを前提とした GraphQL からのみ取得できる。
 * 仕組みと判断の経緯は docs/research/view-count.md を参照。
 *
 * この処理を content script に置いているのは、トークン発行が note.com と同一オリジンで
 * ある必要があり、GraphQL 側の CORS も note.com オリジンに対して開いているため。
 * オプション画面や Service Worker からは実行できない。
 */
(function (global) {
  /** トークン発行。note.com と同一オリジンで呼ぶ必要がある。 */
  const AUTH_URL = "https://note.com/api/v3/graphql/auth";
  /** ダッシュボードが使う GraphQL エンドポイント。 */
  const GRAPHQL_URL = "https://graphql.note.com/graphql";
  /** 発行されたトークンが入るクッキー名（HttpOnly ではない）。 */
  const TOKEN_COOKIE = "note_gql_auth_token";
  /** 1 ページあたりの取得件数。実際の上限は公開されていないため控えめにしてページングする。 */
  const PAGE_SIZE = 50;
  /** ページングの間隔。 */
  const PAGE_DELAY_MS = 200;
  /** 取得ページ数の上限。想定外の応答で無限ループしないための保険。 */
  const MAX_PAGES = 200;

  /**
   * ダッシュボードの Dashboard_StatPageQuery から必要なフィールドだけに絞ったクエリ。
   * 売上（salesAmount）は要求しない。GraphQL なので要求しなければ返ってこない。
   */
  const STATS_QUERY = `query NoteToMarkdown_Stats($unit: DashboardPeriodUnit!, $date: Datetime!, $first: Int!, $after: String) {
  dashboardNoteListConnection(unit: $unit, date: $date, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      note { key publishedAt }
      metrics { pageViewCount impressionCount }
    } }
  }
  dashboardStatLastUpdatedTimes { noteStatLastUpdatedAt }
}`;

  /** 指定ミリ秒待つ。 */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * クッキー文字列から値を取り出す。
   * @param {string} cookieString - document.cookie 相当の文字列。
   * @param {string} name - クッキー名。
   * @returns {string} 値。無ければ空文字。
   */
  const readCookie = (cookieString, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(cookieString ?? "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    if (!match) {
      return "";
    }
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  };

  /**
   * JWT のペイロードを読む。
   * 検証は行わない（署名の確認は note 側の仕事）。ゲストかどうかと有効期限を見るだけに使う。
   * @param {string} token - JWT 文字列。
   * @returns {{gu?: boolean, exp?: number, sub?: string}|null} ペイロード。読めなければ null。
   */
  const decodeTokenPayload = (token) => {
    const segment = String(token ?? "").split(".")[1];
    if (!segment) {
      return null;
    }
    try {
      const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
      return JSON.parse(global.atob(padded));
    } catch {
      return null;
    }
  };

  /**
   * トークンが「ログイン済みの利用者のものとして、いま使える」かを判定する。
   * 有効期限は 30 分と短いため、残りが少ないものは使わずに取り直す。
   * @param {string} token - JWT 文字列。
   * @param {number} [nowMs=Date.now()] - 現在時刻。
   * @returns {boolean} 使えるなら true。
   */
  const isUsableToken = (token, nowMs = Date.now()) => {
    const payload = decodeTokenPayload(token);
    if (!payload || payload.gu === true) {
      return false;
    }
    if (typeof payload.exp !== "number") {
      return false;
    }
    // 処理中に切れないよう、残り 1 分未満は切れている扱いにする。
    return payload.exp * 1000 - nowMs > 60_000;
  };

  /**
   * トークンを発行させる。
   * ダッシュボードと同じく、XSRF トークンがあればヘッダへ載せる。
   * @param {{fetchImpl?: typeof fetch, cookieString?: string}} [deps={}] - 差し替え用。
   * @returns {Promise<void>}
   */
  const requestToken = async ({ fetchImpl = global.fetch, cookieString } = {}) => {
    const xsrf = readCookie(cookieString ?? global.document?.cookie, "XSRF-TOKEN");
    await fetchImpl(AUTH_URL, {
      method: "POST",
      // 同一オリジンなのでセッションクッキーがそのまま載る。
      credentials: "include",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        ...(xsrf ? { "x-xsrf-token": xsrf } : {}),
      },
    });
  };

  /**
   * 使えるトークンを用意する。すでに有効なものがあれば発行し直さない。
   * @param {{fetchImpl?: typeof fetch, readCookieString?: () => string}} [deps={}] - 差し替え用。
   * @returns {Promise<{ok: true, token: string}|{ok: false, code: "not-logged-in"|"no-token"}>} 結果。
   */
  const ensureToken = async ({ fetchImpl = global.fetch, readCookieString } = {}) => {
    const currentCookies = () => (readCookieString ? readCookieString() : global.document?.cookie ?? "");

    const existing = readCookie(currentCookies(), TOKEN_COOKIE);
    if (isUsableToken(existing)) {
      return { ok: true, token: existing };
    }

    await requestToken({ fetchImpl, cookieString: currentCookies() });

    const issued = readCookie(currentCookies(), TOKEN_COOKIE);
    if (!issued) {
      return { ok: false, code: "no-token" };
    }
    // 未ログインでもゲスト用トークンが発行される。これでは自分の記事が返らない。
    if (!isUsableToken(issued)) {
      return { ok: false, code: "not-logged-in" };
    }
    return { ok: true, token: issued };
  };

  /**
   * 応答に入っていた数値を「件数」として受け入れてよいか検査する。
   *
   * 件数なので 0 以上の整数しかありえない。note 側の型が変わって小数や負数が
   * 来た場合に frontmatter へそのまま書かないよう、ここで弾いて「値なし」扱いにする。
   * @param {unknown} value - 応答の値。
   * @returns {number|null} 受け入れた件数。受け入れられなければ null。
   */
  const toCount = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

  /**
   * GraphQL の応答から必要な値を取り出す。
   * @param {any} json - 応答 JSON。
   * @returns {{rows: {noteId: string, pageViewCount: number|null, impressionCount: number|null, publishedAt: string|null}[], hasNextPage: boolean, endCursor: string|null, statsUpdatedAt: string|null}} 取り出した値。
   * @throws {Error} GraphQL エラーや想定外の形のとき。
   */
  const parseStatsResponse = (json) => {
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      const message = String(json.errors[0]?.message ?? "");
      // トークンが切れた・ゲストだった場合はここに来る。
      throw new Error(/unauthenticated/i.test(message) ? "unauthenticated" : `graphql: ${message}`);
    }
    const connection = json?.data?.dashboardNoteListConnection;
    if (!connection || !Array.isArray(connection.edges)) {
      throw new Error("unexpected-response");
    }

    const rows = [];
    for (const edge of connection.edges) {
      const noteId = String(edge?.node?.note?.key ?? "").trim();
      if (!noteId) {
        continue;
      }
      const metrics = edge?.node?.metrics ?? {};
      rows.push({
        noteId,
        pageViewCount: toCount(metrics.pageViewCount),
        impressionCount: toCount(metrics.impressionCount),
        publishedAt: edge?.node?.note?.publishedAt ?? null,
      });
    }

    return {
      rows,
      hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
      endCursor: connection.pageInfo?.endCursor ?? null,
      statsUpdatedAt: json?.data?.dashboardStatLastUpdatedTimes?.noteStatLastUpdatedAt ?? null,
    };
  };

  /**
   * GraphQL を 1 ページ分だけ問い合わせる。
   * @param {{token: string, after?: string|null, fetchImpl?: typeof fetch, now?: Date}} params - 問い合わせ条件。
   * @returns {Promise<ReturnType<typeof parseStatsResponse>>} 取り出した値。
   */
  const fetchStatsPage = async ({ token, after = null, fetchImpl = global.fetch, now = new Date() }) => {
    const response = await fetchImpl(GRAPHQL_URL, {
      method: "POST",
      // ログイン情報はクッキーではなく Bearer トークンで渡す。
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: STATS_QUERY,
        // unit: ALL で全期間の累計を取る。date は「いつまで」の指定。
        variables: { unit: "ALL", date: now.toISOString(), first: PAGE_SIZE, after },
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parseStatsResponse(await response.json());
  };

  /**
   * 全記事分のページビュー数・インプレッション数を取得する。
   * @param {{fetchImpl?: typeof fetch, readCookieString?: () => string, onProgress?: (count: number) => void, now?: Date, pageDelayMs?: number}} [deps={}] - 差し替え用。
   * @returns {Promise<{ok: true, rows: object[], statsUpdatedAt: string|null}|{ok: false, code: string}>} 結果。
   */
  const fetchAllStats = async (deps = {}) => {
    const { fetchImpl = global.fetch, readCookieString, onProgress, now, pageDelayMs = PAGE_DELAY_MS } = deps;

    const auth = await ensureToken({ fetchImpl, readCookieString });
    if (!auth.ok) {
      return auth;
    }

    const rows = [];
    let statsUpdatedAt = null;
    let after = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await fetchStatsPage({ token: auth.token, after, fetchImpl, now });
      rows.push(...result.rows);
      statsUpdatedAt = result.statsUpdatedAt ?? statsUpdatedAt;
      onProgress?.(rows.length);

      if (!result.hasNextPage || !result.endCursor) {
        return { ok: true, rows, statsUpdatedAt };
      }
      after = result.endCursor;
      await sleep(pageDelayMs);
    }

    // 上限に達した分までを返す。取りこぼしは呼び出し側で「値が無い記事」として扱われる。
    return { ok: true, rows, statsUpdatedAt, truncated: true };
  };

  global.NtmNoteStats = {
    AUTH_URL,
    GRAPHQL_URL,
    MAX_PAGES,
    PAGE_DELAY_MS,
    PAGE_SIZE,
    STATS_QUERY,
    TOKEN_COOKIE,
    decodeTokenPayload,
    ensureToken,
    fetchAllStats,
    fetchStatsPage,
    isUsableToken,
    parseStatsResponse,
    readCookie,
    toCount,
    requestToken,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

/**
 * ダッシュボード由来の数値（ページビュー・インプレッション）の取得ロジックのテスト。
 * 実際の note.com へは接続せず、fetch とクッキーをスタブで差し替える。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readSource } from "./helpers/env.mjs";

/**
 * lib/noteStats.js を評価して NtmNoteStats を返す。
 * @param {{cookies?: string, fetchImpl?: Function}} [options={}] - 環境設定。
 */
const loadNoteStats = ({ cookies = "", fetchImpl } = {}) => {
  const state = { cookies, calls: [] };
  const context = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    setTimeout,
    clearTimeout,
    JSON,
    Date,
    Error,
    document: {
      get cookie() {
        return state.cookies;
      },
    },
    fetch:
      fetchImpl ??
      (async () => ({
        ok: true,
        json: async () => ({ data: { dashboardNoteListConnection: { pageInfo: {}, edges: [] } } }),
      })),
  };
  context.globalThis = context;
  // readSource 経由にしておくと、minify 済みの dist に対しても同じテストが流れる。
  const source = readSource("lib", "noteStats.js");
  new Function("globalThis", `${source}\nreturn globalThis.NtmNoteStats;`).call(context, context);
  return { stats: context.NtmNoteStats, state, context };
};

/** 期限付きの擬似 JWT を作る。 */
const makeToken = ({ guest = false, expiresInSeconds = 1800 } = {}) => {
  const payload = {
    gu: guest,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    iss: "note.com",
    sub: "00000000-0000-0000-0000-000000000000",
  };
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
};

/* ------------------------------- トークン ------------------------------- */

test("クッキーから値を取り出す（URLエンコードも戻す）", () => {
  const { stats } = loadNoteStats();
  const cookies = "a=1; note_gql_auth_token=abc%2Edef; XSRF-TOKEN=tok";
  assert.equal(stats.readCookie(cookies, "note_gql_auth_token"), "abc.def");
  assert.equal(stats.readCookie(cookies, "XSRF-TOKEN"), "tok");
  assert.equal(stats.readCookie(cookies, "missing"), "");
});

test("ログイン済みで期限内のトークンは使える", () => {
  const { stats } = loadNoteStats();
  assert.equal(stats.isUsableToken(makeToken()), true);
});

test("ゲストトークンと期限切れ間際のトークンは使えないとみなす", () => {
  const { stats } = loadNoteStats();
  assert.equal(stats.isUsableToken(makeToken({ guest: true })), false, "ゲストは不可");
  assert.equal(stats.isUsableToken(makeToken({ expiresInSeconds: 30 })), false, "残り30秒は不可");
  assert.equal(stats.isUsableToken("not-a-jwt"), false);
  assert.equal(stats.isUsableToken(""), false);
});

test("有効なトークンが既にあれば発行し直さない", async () => {
  const calls = [];
  const { stats } = loadNoteStats({
    cookies: `note_gql_auth_token=${makeToken()}`,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({}) };
    },
  });
  const result = await stats.ensureToken();
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [], "発行のリクエストは不要です");
});

test("トークンが無ければ発行し、XSRF トークンをヘッダへ載せる", async () => {
  const calls = [];
  const loaded = loadNoteStats({
    cookies: "XSRF-TOKEN=xsrf-value",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      // 発行に成功したらクッキーが増える、という挙動を再現する。
      loaded.state.cookies = `XSRF-TOKEN=xsrf-value; note_gql_auth_token=${makeToken()}`;
      return { ok: true, json: async () => ({}) };
    },
  });
  const result = await loaded.stats.ensureToken();

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, loaded.stats.AUTH_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "include", "同一オリジンのセッションを使う必要があります");
  assert.equal(calls[0].init.headers["x-xsrf-token"], "xsrf-value");
  assert.equal(calls[0].init.headers["x-requested-with"], "XMLHttpRequest");
});

test("未ログインだとゲストトークンが発行されるので not-logged-in を返す", async () => {
  const loaded = loadNoteStats({
    fetchImpl: async () => {
      loaded.state.cookies = `note_gql_auth_token=${makeToken({ guest: true })}`;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.deepEqual(await loaded.stats.ensureToken(), { ok: false, code: "not-logged-in" });
});

test("発行してもトークンが入らなければ no-token を返す", async () => {
  const loaded = loadNoteStats({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(await loaded.stats.ensureToken(), { ok: false, code: "no-token" });
});

/* -------------------------------- 応答解析 ------------------------------- */

const sampleResponse = {
  data: {
    dashboardNoteListConnection: {
      pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      edges: [
        { node: { note: { key: "n111", publishedAt: "2026-01-01T00:00:00+09:00" }, metrics: { pageViewCount: 120, impressionCount: 3400 } } },
        { node: { note: { key: "n222", publishedAt: "2020-01-01T00:00:00+09:00" }, metrics: { pageViewCount: 9, impressionCount: null } } },
      ],
    },
    dashboardStatLastUpdatedTimes: { noteStatLastUpdatedAt: "2026-10-05T07:00:00+09:00" },
  },
};

test("応答から記事別の数値と集計日時を取り出す", () => {
  const { stats } = loadNoteStats();
  const parsed = stats.parseStatsResponse(sampleResponse);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].noteId, "n111");
  assert.equal(parsed.rows[0].pageViewCount, 120);
  assert.equal(parsed.rows[0].impressionCount, 3400);
  assert.equal(parsed.rows[1].impressionCount, null, "データが無い期間は null のままにします");
  assert.equal(parsed.hasNextPage, true);
  assert.equal(parsed.endCursor, "cursor-1");
  assert.equal(parsed.statsUpdatedAt, "2026-10-05T07:00:00+09:00");
});

test("GraphQL エラーは例外にする。認証切れは unauthenticated で区別する", () => {
  const { stats } = loadNoteStats();
  assert.throws(
    () => stats.parseStatsResponse({ errors: [{ message: "Unauthenticated" }] }),
    /unauthenticated/
  );
  assert.throws(() => stats.parseStatsResponse({ errors: [{ message: "boom" }] }), /graphql: boom/);
  assert.throws(() => stats.parseStatsResponse({ data: {} }), /unexpected-response/);
});

test("key の無い行は捨てる", () => {
  const { stats } = loadNoteStats();
  const parsed = stats.parseStatsResponse({
    data: {
      dashboardNoteListConnection: {
        pageInfo: {},
        edges: [{ node: { note: {}, metrics: { pageViewCount: 1 } } }, { node: null }],
      },
    },
  });
  assert.equal(parsed.rows.length, 0);
});

/* --------------------------------- 取得 --------------------------------- */

test("全期間を指定し、ログイン情報はクッキーではなく Bearer で渡す", async () => {
  const calls = [];
  const { stats } = loadNoteStats({
    cookies: `note_gql_auth_token=${makeToken()}`,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ data: { dashboardNoteListConnection: { pageInfo: {}, edges: [] } } }) };
    },
  });
  await stats.fetchAllStats();

  assert.equal(calls[0].url, stats.GRAPHQL_URL);
  assert.equal(calls[0].init.credentials, "omit");
  assert.match(calls[0].init.headers.authorization, /^Bearer /);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.variables.unit, "ALL", "全期間の累計を取る必要があります");
  assert.equal(body.variables.first, stats.PAGE_SIZE);
  assert.doesNotMatch(body.query, /salesAmount/, "売上は要求しません");
});

test("hasNextPage が続く間ページングして全件集める", async () => {
  const pages = [
    { keys: ["n1", "n2"], hasNextPage: true, endCursor: "c1" },
    { keys: ["n3"], hasNextPage: true, endCursor: "c2" },
    { keys: ["n4"], hasNextPage: false, endCursor: null },
  ];
  const cursors = [];
  let index = 0;
  const { stats } = loadNoteStats({
    cookies: `note_gql_auth_token=${makeToken()}`,
    fetchImpl: async (_url, init) => {
      cursors.push(JSON.parse(init.body).variables.after);
      const page = pages[index++];
      return {
        ok: true,
        json: async () => ({
          data: {
            dashboardNoteListConnection: {
              pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
              edges: page.keys.map((key) => ({ node: { note: { key }, metrics: { pageViewCount: 1, impressionCount: 2 } } })),
            },
            dashboardStatLastUpdatedTimes: { noteStatLastUpdatedAt: "2026-10-05T07:00:00+09:00" },
          },
        }),
      };
    },
  });

  const result = await stats.fetchAllStats({ pageDelayMs: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((r) => r.noteId), ["n1", "n2", "n3", "n4"]);
  assert.deepEqual(cursors, [null, "c1", "c2"]);
  assert.equal(result.statsUpdatedAt, "2026-10-05T07:00:00+09:00");
});

test("ログインしていなければ取得せずに理由を返す", async () => {
  const loaded = loadNoteStats({
    fetchImpl: async () => {
      loaded.state.cookies = `note_gql_auth_token=${makeToken({ guest: true })}`;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.deepEqual(await loaded.stats.fetchAllStats(), { ok: false, code: "not-logged-in" });
});

test("HTTP エラーは例外にする", async () => {
  const { stats } = loadNoteStats({
    cookies: `note_gql_auth_token=${makeToken()}`,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(() => stats.fetchAllStats(), /HTTP 503/);
});

test("ページ数の上限で打ち切る（無限ループしない）", async () => {
  let calls = 0;
  const { stats } = loadNoteStats({
    cookies: `note_gql_auth_token=${makeToken()}`,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          data: {
            dashboardNoteListConnection: {
              // 常に「続きがある」と答え続ける応答を模す
              pageInfo: { hasNextPage: true, endCursor: `c${calls}` },
              edges: [{ node: { note: { key: `n${calls}` }, metrics: {} } }],
            },
          },
        }),
      };
    },
  });
  const result = await stats.fetchAllStats({ pageDelayMs: 0 });
  assert.equal(calls, stats.MAX_PAGES);
  assert.equal(result.truncated, true);
});

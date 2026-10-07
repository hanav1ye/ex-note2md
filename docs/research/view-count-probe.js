/**
 * ビュー数・インプレッション数の取得可否を、ログイン済みセッションで確認するための読み取り専用スクリプト。
 *
 * 使い方:
 *   1. ログイン済みの https://note.com/ を開く
 *   2. DevTools（F12）のコンソールにこのファイルの中身を貼って実行する
 *   3. 出力された結果を伝える
 *
 * この確認では記事の書き換えも設定の変更も行わない。ダッシュボードが使うのと同じ問い合わせを
 * 読み取りのためだけに 1 回行い、取得した件数と先頭 3 件の数値を表示する。
 * 売上（salesAmount）は要求していない。
 */
(async () => {
  const log = (...args) => console.log("[note2md probe]", ...args);

  // 1) ダッシュボードと同じ手順でトークンを発行させる
  const xsrf = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1];
  const authRes = await fetch("https://note.com/api/v3/graphql/auth", {
    method: "POST",
    credentials: "include",
    headers: {
      "x-requested-with": "XMLHttpRequest",
      ...(xsrf ? { "x-xsrf-token": decodeURIComponent(xsrf) } : {}),
    },
  });
  log("トークン発行:", authRes.status);

  // 2) 発行されたトークンを読む（HttpOnly ではない）
  const raw = document.cookie.match(/(?:^|; )note_gql_auth_token=([^;]*)/)?.[1];
  if (!raw) {
    log("note_gql_auth_token が見つかりません。ここで中断します。");
    return;
  }
  const token = decodeURIComponent(raw);
  const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  log("トークンのクレーム:", { guest: claims.gu, 有効期限まで分: Math.round((claims.exp * 1000 - Date.now()) / 60000) });
  if (claims.gu) {
    log("ゲスト扱いになっています。note.com にログインした状態で実行してください。");
    return;
  }

  // 3) 全期間の記事別の数値を問い合わせる（読み取りのみ・売上は要求しない）
  const query = `query($unit: DashboardPeriodUnit!, $date: Datetime!, $first: Int!, $after: String) {
    dashboardNoteListConnection(unit: $unit, date: $date, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        note { key title status publishedAt }
        metrics { pageViewCount impressionCount likeCount commentCount }
      } }
    }
    dashboardStatLastUpdatedTimes { noteStatLastUpdatedAt }
  }`;

  const ask = async (first, after = null) => {
    const res = await fetch("https://graphql.note.com/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables: { unit: "ALL", date: new Date().toISOString(), first, after } }),
    });
    return { status: res.status, json: await res.json() };
  };

  // 1 ページあたりの上限を確かめるため、大きめの件数で 1 回だけ投げる
  const first = await ask(100);
  if (first.json.errors) {
    log("GraphQL エラー:", first.json.errors);
    return;
  }
  const conn = first.json.data.dashboardNoteListConnection;
  const rows = conn.edges.map((e) => e.node);
  log("HTTP:", first.status, "/ 取得件数:", rows.length, "/ 続きがあるか:", conn.pageInfo.hasNextPage);
  log("集計日時:", first.json.data.dashboardStatLastUpdatedTimes?.noteStatLastUpdatedAt);
  log("先頭3件:", rows.slice(0, 3).map((r) => ({
    key: r.note.key,
    title: r.note.title?.slice(0, 24),
    publishedAt: r.note.publishedAt,
    ...r.metrics,
  })));

  // 2021-05-01 より前の記事でインプレッションが null になるかを確認する
  const old = rows.filter((r) => r.note.publishedAt && r.note.publishedAt < "2021-05-01");
  log("2021-05-01 より前の記事:", old.length, old.length ? "→ impressionCount の例: " + JSON.stringify(old.slice(0, 3).map((r) => r.metrics.impressionCount)) : "（なし）");
})();

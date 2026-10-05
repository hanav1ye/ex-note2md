# 調査: ビュー数・インプレッション数の取得

**調査日**: 2026-10-05
**結論**: **技術的に実現できる**。認証は「ログイン済みの note.com タブ上で、ダッシュボードと同じ 2 段階を踏む」形で通せる。manifest の権限追加は不要。ただしプライバシーポリシーの書き換えと、非公式 API への依存を受け入れる必要がある。

## 前提の変化（2026-09-08 のダッシュボード刷新）

これまで「ビュー」1 つだった指標が、**インプレッション**と**ページビュー**に分かれた。

| 指標 | 意味 |
|------|------|
| インプレッション | note 内（タイムライン・検索結果・ハッシュタグ・関連記事など）に記事が表示された回数。**2021-05-01 より前のデータは無い** |
| ページビュー | 記事ページが開かれた回数。有料記事は購入の有無を問わず 1 回と数える |
| スキ | その期間に新しく付いたスキ。記事ページの「現在の合計」とは一致しない |
| コメント | その期間に新しく付いたコメント |
| 売上 | 記事・マガジン・メンバーシップ・チップの合計 |

- 「これまでのビュー = インプレッション + ページビュー」にはならない（集計対象が違う）
- **数値はリアルタイムではない**。当日分は約 2 時間ごと、前日までは毎朝確定。インプレッションは更新が遅い
- 集計方法の改善で過去の数値が後から変わることがある

出典: [ダッシュボードの「アクセス状況」について](https://www.help-note.com/hc/ja/articles/360010324194)、[各指標とグラフをみる](https://www.help-note.com/hc/ja/articles/61982979089305)、[記事ごとの数値をみる](https://www.help-note.com/hc/ja/articles/61982766676121)

## 旧 REST API は使えない

`https://note.com/api/v1/stats/pv?filter=all&page=1&sort=pv` は現存するが、未ログインで
`{"error":{"code":"auth","message":"not_login"}}` を **HTTP 200** で返す（`response.ok` では失敗を判定できない）。
刷新後のダッシュボードはこの API を使っておらず、インプレッションも返さないため採用しない。

## 新ダッシュボードの実体は GraphQL

ダッシュボードは `https://note.com/dashboard` 配下の別 Next.js アプリで、公開 JS バンドルから次が判明した。

- エンドポイント: **`https://graphql.note.com/graphql`**
- トークン発行: **`POST https://note.com/api/v3/graphql/auth`**
- クライアント: Apollo（`apollographql-client-name` / `-version` ヘッダを付ける）
- **introspection が有効**（スキーマをそのまま確認できる）

### 認証の流れ（実測）

1. note.com オリジンから `POST /api/v3/graphql/auth` を叩く
   - `credentials: "include"`、`x-requested-with: XMLHttpRequest`、`XSRF-TOKEN` クッキーの値を `x-xsrf-token` ヘッダへ
   - **未ログインでも 201 を返し、ゲスト用トークンが発行される**
2. レスポンスで **`note_gql_auth_token` クッキー**（HttpOnly ではない = JS から読める）が入る
   - RS256 の JWT、576 文字、`iss: note.com`
   - クレーム: `gu`（ゲストか）、`sub`、`sid`、`iat`、`exp`
   - **有効期限は 30 分**。切れたら 1 を再実行して取り直す（ダッシュボードも `Unauthenticated` で同じことをしている）
3. `POST https://graphql.note.com/graphql` に `Authorization: Bearer <JWT>` を付けてクエリ

未ログインのゲストトークンで実際にクエリを投げると、エラーではなく
`{"data":{"dashboardNoteListConnection":{"edges":[]}}}` が返る（= 自分の記事が無い状態）。
**つまり CORS は note.com オリジンに対して開いており、仕組みとしては通っている。欠けているのはログイン済みセッションだけ。**

### 使うクエリ

ダッシュボードの `Dashboard_StatPageQuery` から、必要なフィールドだけに絞ったもの。

```graphql
query($unit: DashboardPeriodUnit!, $date: Datetime!, $first: Int!, $after: String) {
  dashboardNoteListConnection(unit: $unit, date: $date, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      note { key title status publishedAt }
      metrics { pageViewCount impressionCount likeCount commentCount }
    } }
  }
  dashboardStatLastUpdatedTimes { noteStatLastUpdatedAt }
}
```

- `note.key` が `nXXXXXXXX` 形式の note ID。**frontmatter の `note_id` とファイル名にそのまま一致する**ので突き合わせが要らない
- `unit: ALL` + `date: <現在時刻の ISO>` で**全期間の累計**が取れる（さかのぼれるのは 2014-04-01 まで）
- Relay 形式のページング。`first: 100` / `500` もエラーにならなかった（UI は 20）
- `dashboardStatLastUpdatedTimes.noteStatLastUpdatedAt` で「いつ時点の集計か」が取れる

### スキーマ（introspection で確認）

```
DashboardNoteMetrics: pageViewCount: Int, impressionCount: Int, likeCount: Int,
                      commentCount: Int, salesAmount: Int, currency: String
DashboardPeriodUnit:  DAY WEEK MONTH YEAR ALL LAST_7_DAYS LAST_28_DAYS LAST_365_DAYS CUSTOM
DashboardNoteListOrder: PUBLISHED_DATE_DESC IMPRESSION_COUNT_DESC PAGE_VIEW_COUNT_DESC
                        LIKE_COUNT_DESC COMMENT_COUNT_DESC SALES_DESC
```

**`salesAmount` は GraphQL なので要求しなければ返ってこない。** 売上を一切受け取らない形にできる。

## 実装方式

### 採る案: ログイン済みの note.com タブ上の content script で取得する

| 手順 | 場所 | 理由 |
|------|------|------|
| トークン発行 | content script（note.com） | 同一オリジンなのでセッションクッキーと XSRF がそのまま効く |
| GraphQL 問い合わせ | content script（note.com） | オリジンが `https://note.com` なので、ダッシュボード自身と同じ条件で CORS を通る |
| ファイルの読み書き | オプション画面 | 既存のスキ数更新と同じ。Service Worker は長時間処理で止まるため使わない |

**manifest の変更は不要**。`https://graphql.note.com/*` をホスト権限に足す必要もない
（content script のオリジンは note.com であり、権限ではなく CORS で通っているため）。

### 採らない案

- **背景（Service Worker）から直接叩く** — `graphql.note.com` のホスト権限追加が必要な上、
  MV3 の拡張発オリジンからのリクエストには SameSite の制約でセッションクッキーが乗らず、
  トークン発行の段階で失敗する
- **`cookies` 権限でトークンを読む** — 権限が増え、審査の説明も増える。content script で足りる

## 既存機能との差

| | スキ数更新（実装済み） | ビュー数更新（今回） |
|---|---|---|
| 認証 | 不要（`credentials: "omit"`） | **ログイン済みセッションが必要** |
| 対象 | 変換した全記事（他人の記事も） | **自分の記事だけ** |
| 値の性質 | 現在の合計 | 期間の集計（`ALL` で累計） |
| 必要なもの | 保存先フォルダ | 保存先フォルダ + **ログイン済みの note.com タブ** |
| API | `/api/v3/notes/{id}`（公開） | GraphQL（非公式・刷新直後） |
| 通信回数 | 記事ごとに 1 回 | **全記事分をページングで数回**（軽い） |

## 受け入れが必要なこと

1. **PRIVACY.md の前提が崩れる。** 現在は「認証情報を伴わない形（`credentials: "omit"`）で取得しているため、
   note.com にログインしていてもアカウント情報が送られることはありません」と明記している。
   この機能はログイン済みセッションを使うので、該当箇所の書き換えが必要
2. **ストア審査の見え方が変わる。** 「ログインセッションを使う拡張機能」になる。
   送信先が note.com 自身であること、取得するのは自分の記事の統計だけであること、
   売上は要求していないことを justification に明記する必要がある
3. **非公式 API への依存。** 2026-09-08 に刷新されたばかりで、バンドルには `graphql-beta*` のホストも残っている。
   スキーマが変わったら止まる。失敗時は「取得できませんでした」で止まる作りにする
4. **他人の記事には値が入らない。** 自分の記事だけの機能になる

## 決定事項（2026-10-05）

### 1. frontmatter のキー名 — `page_view_count` / `impression_count`

旧「ビュー」とは別物なので `view_count` は使わない。

### 2. 集計日時を残す — `stats_updated_at`

GraphQL の `dashboardStatLastUpdatedTimes.noteStatLastUpdatedAt` をそのまま書く。
数値がリアルタイムでないことがファイル上で分かるようにする。

### 3. 他人の記事は触らない

ダッシュボードは自分の記事しか返さないので、値が無い記事にはキーを追加しない。

### 4. 3 つの数値はすべて「常に最新」で上書きする

| frontmatter | 取得元 | 性質 |
|-------------|--------|------|
| `like_count` | `https://note.com/api/v3/notes/{id}`（公開・`credentials: "omit"`） | **現在の合計** |
| `page_view_count` | GraphQL `metrics.pageViewCount`（`unit: ALL`） | 全期間の累計 |
| `impression_count` | GraphQL `metrics.impressionCount`（`unit: ALL`） | 全期間の累計（2021-05-01 以降） |

毎回取り直して上書きする。前回値や差分はファイルに残さない。

**スキ数に GraphQL の `likeCount` は使わない。** `unit: ALL` にしても、これは
「期間内に新しく付いたスキの累計」であって現在の合計ではない。ヘルプに
「スキが取り消されても、数が減らないことがあります」と明記されており、
取り消しの分だけ現在の合計より大きくなりうる。
**現在の合計が欲しいので、スキ数は既存どおり公開 API の値を使う。**

この結果、1 回の実行で通信は次の 2 種類に分かれる。

- GraphQL: 全記事分の PV / インプレッションをページングで数回（軽い）
- 公開 API: スキ数は記事ごとに 1 回ずつ（既存どおり 300ms 間隔）

「ページビューとインプレッションだけで、スキ数は触らない」という選択肢は作らない。
3 つとも最新にするのが既定の挙動。

### 5. ログイン済みタブが無いときの導線（未決）

content script が必要なので、ログイン済みの note.com タブが開いていないと実行できない。
既定は「note.com を開いてから実行してください」と案内する形にする。
こちらで `chrome.tabs.create` してタブを開く案もあるが、勝手にタブが増えるため既定にはしない。

## 未確認（ログイン済みセッションが必要）

- ログイン済みトークン（`gu: false`）で `dashboardNoteListConnection` が自分の記事を返すこと
- 1 ページあたりの実際の上限件数（`first: 500` が通るか、データがある状態での確認）
- `unit: ALL` のときの `impressionCount` が 2021-05-01 以降の合計になること（それ以前の記事で `null` か）

確認方法: ログイン済みの note.com を開き、DevTools のコンソールで `docs/research/view-count-probe.js` を実行する。
読み取りだけで、記事の書き換えは行わない。

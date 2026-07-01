# ADR-001: Web Worker → API Worker プロキシのアーキテクチャ

- **日付:** 2026-07-01
- **ステータス:** 採用（暫定対応含む）
- **関連Issue:** #14, #15

## コンテキスト

aimani-gsは3 Workers構成（Web / API / Agent）で、ブラウザからの `/api/*` リクエストをWeb Worker経由でAPI Workerに転送する必要がある。OAuth callbackなどブラウザが直接アクセスするAPIパスを正しく処理することが要件。

## 決定

### 1. カスタムWorkerエントリーポイント（server.ts）

TanStack Startのデフォルトエントリーポイント（`@tanstack/react-start/server-entry`）ではなく、`src/server.ts` をカスタムエントリーポイントとして使用する。

```
wrangler.jsonc: "main": "src/server.ts"
```

server.tsで `/api/*` をTanStack Startのルーティングより先にインターセプトし、Service Binding（`env.API`）経由でAPI Workerに転送する。それ以外はTanStack Startに委譲。

**理由:** TanStack Startの `createFileRoute('/api/$')` server routeは、ブラウザからのnavigation request（OAuth callback等）に対してserver handlerを呼ばず、SSRレンダリングに回してしまう。Workerレベルでのインターセプトが必要。

**Cloudflare公式根拠:** [TanStack Start ガイド](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) にカスタムエントリーポイントの方法が記載されている。

### 2. Workers Assetsの設定

```json
"assets": {
  "not_found_handling": "none",
  "run_worker_first": ["/api", "/api/*"]
}
"compatibility_flags": ["nodejs_compat", "assets_navigation_has_no_effect"]
```

- `run_worker_first: ["/api", "/api/*"]` — `/api/*` のリクエストをAssetsより先にWorkerに渡す
- `not_found_handling: "none"` — SSRアプリとして、静的アセットにマッチしないリクエストをWorkerに渡す
- `assets_navigation_has_no_effect` — `compatibility_date >= 2025-04-01` でデフォルト有効になる `assets_navigation_prefers_asset_serving` を無効化。navigation requestもWorkerに到達させる

### 3. プロキシのレスポンス転送

Service Binding（`env.API.fetch()`）のレスポンスを `upstream.text()` で文字列化してから `new Response(body, ...)` で再構築する。

**理由:** ReadableStreamの直接転送（`new Response(upstream.body, ...)`）がブラウザ向けレスポンスで壊れるケースがあった。text化は多少のオーバーヘッドがあるが、安定性を優先。

### 4. Set-Cookieヘッダーの転送

`upstream.headers.getSetCookie()` で個別に取得し、`downHeaders.append('set-cookie', cookie)` で追加する。`Headers.forEach()` ではSet-Cookieが結合されてしまうため。

## 暫定対応（#14 解決まで）

`@cloudflare/vite-plugin` のビルドラッパーがService Bindingのプロキシレスポンスを壊す問題があり、ビルド後に `dist/server/index.js` を手動で差し替えてデプロイしている。

```bash
# デプロイ手順（暫定）
vite build
# dist/server/index.js を手動差し替え（Viteラッパーをバイパス）
wrangler deploy
```

この手動差し替えは #14 の解決後に廃止する。

## 却下した案

### A. TanStack Start server route（`routes/api/$.ts`）

`createFileRoute('/api/$')` の `server.handlers` でGET/POST等を定義する方式。ブラウザからのnavigation requestに対してserver handlerが呼ばれず404になるため却下。

### B. `run_worker_first: true`（全リクエストWorker優先）

全リクエストがWorkerを経由するため、静的アセット（`/assets/*.js`）もWorkerが処理する必要がある。`ASSETS` bindingが未設定だとクライアントJSが404になる。パフォーマンスへの影響も大きいため却下。

## ログイン状態表示の正しいアプローチ（#13）

`authClient.useSession()`（クライアントReact hook）をSSRコンポーネントで呼ぶと500エラーになる。Better Auth公式のTanStack Start統合ガイドに従い、`createServerFn` + `auth.api.getSession()` + `beforeLoad` パターンを使うこと。

```typescript
// NG: SSRで500
const { data: session } = authClient.useSession(); 

// OK: createServerFn + beforeLoad
const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  return session;
});
```

**参考:** https://better-auth.com/docs/integrations/tanstack

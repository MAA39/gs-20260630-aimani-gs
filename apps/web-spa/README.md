# Aimani GS Web SPA Probe

TanStack Start SSR を触らずに、TanStack Router + Vite React SPA と Cloudflare Workers の薄い /api/* proxy だけで認証・API疎通を検証するための暫定アプリです。

## 方針

- 既存 apps/web は残す
- SSR / createServerFn / TanStack Start server route は使わない
- /api/* は Worker fetch 層で aimani-gs-api Service Binding へ proxy
- 非APIリクエストは ASSETS binding へ渡し、SPA fallback で index.html を返す
- OAuth callback のため、proxy fetch は redirect: manual
- Service Binding response は一度 upstream.text() で文字列化して返す

## 確認コマンド

pnpm --filter @aimani-gs/web-spa typecheck
pnpm --filter @aimani-gs/web-spa build
pnpm --filter @aimani-gs/web-spa deploy

## 確認観点

1. /chat/new が表示される
2. document.documentElement.dataset.hydrated === 'true' になる
3. GitHubログインボタンでOAuthへ遷移する
4. callback後に /chat/new へ戻る
5. /api/auth/get-session がCookie付きでuser/sessionを返す
6. カテゴリボタンかtextareaから相談作成POSTが通る

この検証が通ったら、既存 apps/web のUIをSPA側へ順番に移植します。

# 引き継ぎ: G's版MVPアイマニ

> 別セッションでの実装着手のためのコンテキスト。

## 入り口

| ソース | 参照先 |
|---|---|
| Linear戦略正本 | slug `d647ece41246` |
| GitHub | `MAA39/gs-20260630-aimani-gs` |
| 移植元 | `MAA39/gs-20260620-bs-job-board` |
| UI参考 | `imaimai17468/imaimai-front-templete` |
| 体験参考 | `imaimai17468/poc-island` |
| Workers AI調査 | slug `11df1b67e3e2` |
| 環境変数 | slug `d14b9d54b954` |

## 現在の状態

- README + ADR 6本 + モノレポ骨格 + DB初期スキーマ が入っている
- pnpm install はまだ（依存パッケージ未追加）
- 実装コードはまだない（package.jsonの骨格のみ）

## 別セッションでやること（順番）

1. bs-job-boardからコード移植（apps/api, apps/agent の核心部分）
2. pnpm install + 依存パッケージ追加
3. Better Auth + GitHub OAuth（imaimai-front-templeteのlib/auth/を参考）
4. SYSTEM_PROMPT差し替え（ADR-003参照）
5. UI変更（掲示板→相談UI）
6. Workers AI binding設定（ADR-006参照）
7. D1作成 + マイグレーション適用
8. デプロイ

## 参考リポの役割分担（混ぜない）

- **bs-job-board** = 土台。3 Workers構成、非同期AI処理、SSE、D1の実装を移植
- **imaimai-front-templete** = UI/フロント構成の参考。Better Auth + shadcn/ui + Drizzleの設定パターン
- **poc-island** = 体験・デモの見せ方。Gallery的な一覧表示の参考

## 合言葉

> BsJobBoardを土台に、G's生が相談前にAIで言葉を整えるMVPへ、全体構成から再設計する。

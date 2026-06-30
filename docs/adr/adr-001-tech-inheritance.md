# ADR-001: bs-job-boardからの技術資産継承

**状態:** 確定
**日付:** 2026-06-30

## 決定

bs-job-board（MAA39/gs-20260620-bs-job-board）の技術資産を継承する。新規リポジトリとして作成し、必要なコードを移植する。

## 継承するもの

- 3 Workers分離構成（web/api/agent）
- Cloudflare D1
- Flue Agent
- SSEイベント（ai_runs/ai_run_events）
- Turborepo + pnpm workspaces
- ADRによる設計判断記録

## 変えるもの

- SYSTEM_PROMPT（2ch風→CBTアプローチ言語化支援）
- データモデル（thread/post→consultation/message）
- UI（掲示板→相談UI）
- 認証（匿名→GitHub OAuth実名）
- AIプロバイダー（さくらAI→Workers AI）

## 捨てるもの

- 「ブルシット・ジョブ解体」のテーマ・文言
- 2ch風の口調
- さくらAI Engine依存

## 根拠

bs-job-boardで実証済みの3 Workers分離・非同期AI処理・SSEは、相談プロダクトでもそのまま使える。ゼロから作り直す理由がない。

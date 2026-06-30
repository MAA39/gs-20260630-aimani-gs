# ADR-006: AI基盤 — Workers AI統一

**状態:** 確定
**日付:** 2026-06-30

## 決定

Cloudflare Workers AIに統一する。さくらAI Engineは使わない。

## 根拠

- さくらAI: 月3,000回上限。G's版MVPでは不足
- Workers AI: 無料枠10,000 Neurons/日（毎日リセット）
- gpt-oss-120bはWorkers AIカタログにもある。品質低下なし

## モデル戦略（ハイブリッド）

| 用途 | モデル | Neurons/回 |
|---|---|---|
| レス生成（高品質） | @cf/openai/gpt-oss-120b | ~52 |
| 分類・概要（軽量） | @cf/qwen/qwen3-30b-a3b-fp8 | ~14 |

1投稿あたり ~80 Neurons → 125投稿/日。G's課題として十分。

## 呼び出し方法

wrangler.jsoncにAI binding追加。env.AI.run()で直接呼び出し。

## 未決定

- Flue providerがAI bindingに対応するか要検証
- レス生成モデルの最終選定（gpt-oss-120b vs kimi-k2.6）は実機ベンチ後

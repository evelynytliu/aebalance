# 琳婷帳本（aebalance — Claude Code 版）

Evelyn（婷）和 April（琳）的姊妹分帳網站，取代原本的 Google Sheets。

## 使用

- **網站**：https://evelynytliu.github.io/aebalance/ （手機、電腦都能開，輸入 PIN 進入；PIN 可在網站「⚙️ 設定」裡變更）
- 兩人共用同一份資料，即時同步。

### 功能
- **快速記一筆**：選誰付＋平分/代墊 → 金額 → 品項（有歷史自動建議）→ 記一筆。付款人與分法會記住上次選擇。
- **平分** = 各付一半（對方欠一半）；**代墊** = 整筆算對方的（沿用原試算表的算法）。金額可輸入負數代表退款/歸還。
- **結算付款**：首頁大卡片隨時顯示「誰應給誰多少」，按「結算付款」即記錄一筆結算、所有未結清帳目標記為已結清（可復原）。
- **Uber Eats 自動記帳**：排程任務每天掃 Evelyn Gmail 的 Uber Eats 電子明細，自動寫入為「待確認」；在網站上一鍵選誰付/分法後入帳（用 gmail_message_id 去重，不會重複入帳）。
- **貼上匯入 📋**：貼 Uber Eats 明細信全文（自動抓餐廳+總計+日期），或一行一筆「7/5 麥當勞 320」批次補帳。
- 搜尋、逐筆編輯/刪除、月份分組、已結清歷史、深色模式。

## 架構

| 元件 | 位置 |
|---|---|
| 前端（單檔 SPA） | [docs/index.html](docs/index.html) → GitHub Pages |
| API | Supabase Edge Function `aebalance`（專案 `vrkrocxpdmtfmhzotfnk`，[supabase/functions/aebalance/index.ts](supabase/functions/aebalance/index.ts)） |
| 資料庫 | 同專案 Postgres：`aeb_expenses` / `aeb_settlements` / `aeb_config`（[migration](supabase/migrations/001_init.sql)） |

- 驗證：所有 `/api/*` 請求帶 `x-aeb-pin` header，與 `aeb_config.pin` 比對；資料表開 RLS 且無 policy，僅 Edge Function（service role）能存取。
- Supabase 平台不允許 Edge Function 回傳 HTML（會被改寫成 text/plain），所以頁面放 GitHub Pages，Function 的 GET / 會 302 轉址到網站。
- 舊帳已從原 Google Sheet 匯入（source=`sheet`）。註：原表「琳付」小計公式顯示 69,014，但逐筆明細加總為 69,024（差 10，疑原表 SUM 範圍漏列），本系統以逐筆明細為準。

## 開發 / 部署

- **改前端**：編輯 `docs/index.html`，commit + push 即自動更新（GitHub Pages）。
- **改 API**：編輯 `supabase/functions/aebalance/index.ts`，用 Supabase MCP 的 `deploy_edge_function` 或 `supabase functions deploy aebalance --project-ref vrkrocxpdmtfmhzotfnk` 部署。
- **API 端點**：`POST /api/login`、`GET /api/data`、`POST /api/expenses`（單筆或 `{items:[...]}` 批次，gmail_message_id 衝突自動略過）、`PATCH|DELETE /api/expense?id=`、`POST /api/settle`、`DELETE /api/settlement?id=`（復原結算）、`POST /api/config`。

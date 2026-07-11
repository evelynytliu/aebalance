// aebalance — 琳婷姊妹分帳 API (Edge Function)
// 前端頁面放在 GitHub Pages（docs/index.html）；Supabase 平台會把 Edge Function
// 回傳的 text/html 強制改寫成 text/plain，所以這裡只做 API（/api/*，以 x-aeb-pin 驗證）。
// 資料表：aeb_expenses / aeb_settlements / aeb_config（見 supabase/migrations/001_init.sql）
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE_URL = "https://evelynytliu.github.io/aebalance/";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-aeb-pin",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function getConfig(): Promise<Record<string, string>> {
  const { data, error } = await db.from("aeb_config").select("key, value");
  if (error) throw error;
  const cfg: Record<string, string> = {};
  for (const row of data ?? []) cfg[row.key] = row.value;
  return cfg;
}

// 每一筆帳「對方應付」金額：平分=一半、代墊=全額，可用 owed_override 覆寫
function owedOf(e: { amount: string | number; split_type: string; owed_override: string | number | null }): number {
  if (e.owed_override != null) return Number(e.owed_override);
  const amt = Number(e.amount);
  return e.split_type === "half" ? amt / 2 : amt;
}

const EXPENSE_FIELDS = ["date", "title", "amount", "paid_by", "split_type", "owed_override", "status", "source", "gmail_message_id", "note"];
const CONFIG_KEYS = ["pin", "name_lin", "name_ting", "uber_default_payer", "uber_default_split"];

function pickExpense(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EXPENSE_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/aebalance/, "") || "/";

  if (req.method === "GET" && !path.startsWith("/api")) {
    return new Response(null, { status: 302, headers: { Location: SITE_URL, ...CORS } });
  }

  try {
    const cfg = await getConfig();

    if (req.method === "POST" && path === "/api/login") {
      const body = await req.json();
      if (String(body.pin ?? "") !== cfg.pin) return json({ error: "PIN 錯誤" }, 401);
      return json({ ok: true });
    }

    if (req.headers.get("x-aeb-pin") !== cfg.pin) return json({ error: "unauthorized" }, 401);

    if (req.method === "GET" && path === "/api/data") {
      const [exp, set] = await Promise.all([
        db.from("aeb_expenses").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
        db.from("aeb_settlements").select("*").order("settled_at", { ascending: false }),
      ]);
      if (exp.error) throw exp.error;
      if (set.error) throw set.error;
      const { pin: _pin, ...publicCfg } = cfg;
      return json({ config: publicCfg, expenses: exp.data, settlements: set.data });
    }

    if (req.method === "POST" && path === "/api/expenses") {
      const body = await req.json();
      const items = (Array.isArray(body.items) ? body.items : [body]).map(pickExpense);
      for (const it of items) {
        if (!it.title || it.amount == null || !["lin", "ting"].includes(String(it.paid_by))) {
          return json({ error: "缺少必要欄位（品項/金額/付款人）" }, 400);
        }
      }
      // gmail_message_id 有唯一索引：自動匯入重複寄送時直接略過
      const { data, error } = await db.from("aeb_expenses")
        .upsert(items, { onConflict: "gmail_message_id", ignoreDuplicates: true })
        .select();
      if (error) throw error;
      return json({ inserted: data?.length ?? 0, items: data });
    }

    if (req.method === "PATCH" && path === "/api/expense") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const patch = pickExpense(await req.json());
      patch.updated_at = new Date().toISOString();
      const { data, error } = await db.from("aeb_expenses").update(patch).eq("id", id).select();
      if (error) throw error;
      return json({ item: data?.[0] ?? null });
    }

    if (req.method === "DELETE" && path === "/api/expense") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const { error } = await db.from("aeb_expenses").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (req.method === "POST" && path === "/api/settle") {
      const body = await req.json().catch(() => ({}));
      const { data: rows, error } = await db.from("aeb_expenses")
        .select("id, amount, paid_by, split_type, owed_override")
        .is("settlement_id", null).eq("status", "confirmed");
      if (error) throw error;
      let net = 0; // 正數 = 婷應給琳
      for (const r of rows ?? []) net += (r.paid_by === "lin" ? 1 : -1) * owedOf(r);
      net = Math.round(net * 100) / 100;
      if (Math.abs(net) < 0.01) return json({ error: "目前沒有未結清的款項" }, 400);
      const payer = net > 0 ? "ting" : "lin";
      const { data: s, error: e1 } = await db.from("aeb_settlements")
        .insert({ payer, amount: Math.abs(net), note: body.note ?? null }).select().single();
      if (e1) throw e1;
      const ids = (rows ?? []).map((r) => r.id);
      const { error: e2 } = await db.from("aeb_expenses")
        .update({ settlement_id: s.id }).in("id", ids);
      if (e2) throw e2;
      return json({ settlement: s, count: ids.length });
    }

    // 刪除結算 = 復原：該次結算的帳目自動變回未結清 (FK on delete set null)
    if (req.method === "DELETE" && path === "/api/settlement") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const { error } = await db.from("aeb_settlements").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (req.method === "POST" && path === "/api/config") {
      const body = await req.json();
      const rows = Object.entries(body)
        .filter(([k]) => CONFIG_KEYS.includes(k))
        .map(([key, value]) => ({ key, value: String(value) }));
      if (rows.length === 0) return json({ error: "no valid keys" }, 400);
      const { error } = await db.from("aeb_config").upsert(rows);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

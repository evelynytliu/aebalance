-- aebalance: 姊妹分帳 app 專用資料表（皆以 aeb_ 前綴，與本專案其他資料互不影響）
-- 已於 2026-07-11 套用到 Supabase 專案 vrkrocxpdmtfmhzotfnk（migration 名稱 aebalance_init）
create table if not exists aeb_settlements (
  id uuid primary key default gen_random_uuid(),
  settled_at timestamptz not null default now(),
  payer text not null check (payer in ('lin','ting')),
  amount numeric(12,2) not null,
  note text
);

create table if not exists aeb_expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  title text not null,
  amount numeric(12,2) not null,
  paid_by text not null check (paid_by in ('lin','ting')),
  split_type text not null default 'advance' check (split_type in ('half','advance')),
  owed_override numeric(12,2),
  status text not null default 'confirmed' check (status in ('pending','confirmed')),
  source text not null default 'manual' check (source in ('manual','ubereats','sheet','paste')),
  gmail_message_id text unique,
  note text,
  settlement_id uuid references aeb_settlements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aeb_expenses_date_idx on aeb_expenses (date desc);
create index if not exists aeb_expenses_unsettled_idx on aeb_expenses (settlement_id) where settlement_id is null;

create table if not exists aeb_config (
  key text primary key,
  value text not null
);

insert into aeb_config (key, value) values
  ('pin', '1234'),
  ('name_lin', '琳'),
  ('name_ting', '婷'),
  ('uber_default_payer', 'ting'),
  ('uber_default_split', 'half')
on conflict (key) do nothing;

-- 前端一律透過 Edge Function（service role）存取；直接的 anon 存取全部擋掉
alter table aeb_expenses enable row level security;
alter table aeb_settlements enable row level security;
alter table aeb_config enable row level security;

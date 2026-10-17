-- Supabase SQL Editor में पूरा SQL एक बार चलाएं.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense','lend','borrow','repay')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'अन्य',
  entry_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions(user_id, entry_date desc);

create table if not exists public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  unique(user_id, month)
);

alter table public.transactions enable row level security;
alter table public.monthly_budgets enable row level security;

drop policy if exists "Users can read own transactions" on public.transactions;
create policy "Users can read own transactions" on public.transactions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can add own transactions" on public.transactions;
create policy "Users can add own transactions" on public.transactions for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own transactions" on public.transactions;
create policy "Users can update own transactions" on public.transactions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own transactions" on public.transactions;
create policy "Users can delete own transactions" on public.transactions for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own budgets" on public.monthly_budgets;
create policy "Users can read own budgets" on public.monthly_budgets for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own budgets" on public.monthly_budgets;
create policy "Users can insert own budgets" on public.monthly_budgets for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own budgets" on public.monthly_budgets;
create policy "Users can update own budgets" on public.monthly_budgets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own budgets" on public.monthly_budgets;
create policy "Users can delete own budgets" on public.monthly_budgets for delete to authenticated using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.monthly_budgets to authenticated;

-- Business Session event administration backend
-- Separate Supabase project. No production passwords are committed here.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.access_settings (
  id smallint primary key default 1 check (id = 1),
  admin_password_hash text,
  checkin_password_hash text,
  updated_at timestamptz not null default now()
);
insert into public.access_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  event_type text not null check (event_type in ('bs','corporate')),
  registration_no integer not null check (registration_no > 0),
  overnight boolean not null default false,
  fee_amount numeric(12,2) not null check (fee_amount >= 0),
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  unique(participant_id,event_type),
  unique(event_type,registration_no),
  check (event_type = 'corporate' or overnight = false)
);

create table if not exists public.ledger (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('bs','corporate')),
  entry_type text not null check (entry_type in ('registration_income','expense','reversal','adjustment')),
  amount numeric(12,2) not null check (amount > 0),
  title text not null check (char_length(btrim(title)) between 1 and 220),
  participant_id uuid references public.participants(id) on delete set null,
  registration_id uuid,
  operation_group uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.raffle_winners (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid,
  participant_id uuid,
  first_name text not null,
  last_name text not null,
  registration_no integer not null,
  created_at timestamptz not null default now()
);

alter table public.access_settings enable row level security;
alter table public.participants enable row level security;
alter table public.registrations enable row level security;
alter table public.ledger enable row level security;
alter table public.raffle_winners enable row level security;

revoke all on public.access_settings, public.participants, public.registrations, public.ledger, public.raffle_winners from anon, authenticated;

create or replace function public.check_admin_password(p_password text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select admin_password_hash is not null and extensions.crypt(coalesce(p_password,''), admin_password_hash) = admin_password_hash from public.access_settings where id=1), false);
$$;

create or replace function public.check_checkin_password(p_password text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select checkin_password_hash is not null and extensions.crypt(coalesce(p_password,''), checkin_password_hash) = checkin_password_hash from public.access_settings where id=1), false);
$$;

create or replace function public.admin_login(p_password text)
returns boolean language sql stable security definer set search_path=public as $$ select public.check_admin_password(p_password); $$;

create or replace function public.checkin_login(p_password text)
returns boolean language sql stable security definer set search_path=public as $$ select public.check_checkin_password(p_password); $$;

create or replace function public.account_balance(p_account text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(case when entry_type in ('registration_income','adjustment') then amount else -amount end),0)
  from public.ledger where account=p_account;
$$;

create or replace function public.admin_summary(p_password text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.check_admin_password(p_password) then raise exception 'ADMIN_ONLY'; end if;
  select jsonb_build_object(
    'bs_balance', public.account_balance('bs'),
    'corporate_balance', public.account_balance('corporate'),
    'bs_income', coalesce((select sum(amount) from public.ledger where account='bs' and entry_type='registration_income'),0),
    'corporate_income', coalesce((select sum(amount) from public.ledger where account='corporate' and entry_type='registration_income'),0),
    'bs_count', (select count(*) from public.registrations where event_type='bs'),
    'corporate_count', (select count(*) from public.registrations where event_type='corporate'),
    'overnight_count', (select count(*) from public.registrations where event_type='corporate' and overnight),
    'inside_count', (select count(*) from public.registrations where event_type='bs' and checked_in)
  ) into v_result;
  return v_result;
end; $$;

create or replace function public.next_registration_no(p_event_type text)
returns integer language plpgsql security definer set search_path=public as $$
declare v_no integer;
begin
  perform pg_advisory_xact_lock(hashtext('registration_no_' || p_event_type));
  select coalesce(max(registration_no),0)+1 into v_no from public.registrations where event_type=p_event_type;
  return v_no;
end; $$;

create or replace function public.admin_add_participant(
  p_password text,
  p_first_name text,
  p_last_name text,
  p_add_bs boolean,
  p_add_corporate boolean,
  p_overnight boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_participant uuid; v_bs_reg uuid; v_corp_reg uuid; v_bs_no integer; v_corp_no integer; v_corp_fee numeric;
begin
  if not public.check_admin_password(p_password) then raise exception 'ADMIN_ONLY'; end if;
  if coalesce(p_add_bs,false) is not true and coalesce(p_add_corporate,false) is not true then raise exception 'SELECT_EVENT'; end if;
  if p_first_name is null or btrim(p_first_name)='' or p_last_name is null or btrim(p_last_name)='' then raise exception 'INVALID_NAME'; end if;

  insert into public.participants(first_name,last_name) values (btrim(p_first_name),btrim(p_last_name)) returning id into v_participant;

  if p_add_bs then
    v_bs_no := public.next_registration_no('bs');
    insert into public.registrations(participant_id,event_type,registration_no,overnight,fee_amount)
    values(v_participant,'bs',v_bs_no,false,1000) returning id into v_bs_reg;
    insert into public.ledger(account,entry_type,amount,title,participant_id,registration_id)
    values('bs','registration_income',1000,btrim(p_first_name)||' '||btrim(p_last_name)||' · участие БС',v_participant,v_bs_reg);
  end if;

  if p_add_corporate then
    v_corp_fee := case when coalesce(p_overnight,false) then 3500 else 3000 end;
    v_corp_no := public.next_registration_no('corporate');
    insert into public.registrations(participant_id,event_type,registration_no,overnight,fee_amount)
    values(v_participant,'corporate',v_corp_no,coalesce(p_overnight,false),v_corp_fee) returning id into v_corp_reg;
    insert into public.ledger(account,entry_type,amount,title,participant_id,registration_id)
    values('corporate','registration_income',v_corp_fee,btrim(p_first_name)||' '||btrim(p_last_name)||case when p_overnight then ' 💤 · корпоратив' else ' · корпоратив' end,v_participant,v_corp_reg);
  end if;

  return jsonb_build_object('participant_id',v_participant,'bs_registration_id',v_bs_reg,'corporate_registration_id',v_corp_reg);
end; $$;

create or replace function public.admin_list_registrations(p_password text,p_event_type text)
returns table(registration_id uuid,participant_id uuid,registration_no integer,first_name text,last_name text,overnight boolean,fee_amount numeric,checked_in boolean,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.check_admin_password(p_password) then raise exception 'ADMIN_ONLY'; end if;
  if p_event_type not in ('bs','corporate') then raise exception 'INVALID_EVENT'; end if;
  return query select r.id,p.id,r.registration_no,p.first_name,p.last_name,r.overnight,r.fee_amount,r.checked_in,r.created_at
  from public.registrations r join public.participants p on p.id=r.participant_id
  where r.event_type=p_event_type order by r.registration_no;
end; $$;

create or replace function public.admin_remove_registration(p_password text,p_registration_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_reg public.registrations%rowtype; v_name text;
begin
  if not public.check_admin_password(p_password) then raise exception 'ADMIN_ONLY'; end if;
  select * into v_reg from public.registrations where id=p_registration_id for update;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  select first_name||' '||last_name into v_name from public.participants where id=v_reg.participant_id;
  insert into public.ledger(account,entry_type,amount,title,participant_id,registration_id)
  values(v_reg.event_type,'reversal',v_reg.fee_amount,v_name||' · возврат/удаление из списка',v_reg.participant_id,v_reg.id);
  delete from public.registrations where id=v_reg.id;
  if not exists(select 1 from public.registrations where participant_id=v_reg.participant_id) then delete from public.participants where id=v_reg.participant_id; end if;
  return true;
end; $$;

create or replace function public.admin_add_expense(p_password text,p_title text,p_amount numeric,p_preferred_account text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_bs numeric; v_corp numeric; v_first numeric; v_second numeric; v_group uuid:=gen_random_uuid(); v_preferred_balance numeric; v_other text;
begin
  if not public.check_admin_password(p_password) then raise exception 'ADMIN_ONLY'; end if;
  if p_title is null or btrim(p_title)='' or char_length(btrim(p_title))>220 then raise exception 'INVALID_TITLE'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_preferred_account not in ('bs','corporate') then raise exception 'INVALID_ACCOUNT'; end if;

  perform pg_advisory_xact_lock(hashtext('event_finances'));
  v_bs:=public.account_balance('bs'); v_corp:=public.account_balance('corporate');
  if greatest(v_bs,0)+greatest(v_corp,0) < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  v_preferred_balance:=case when p_preferred_account='bs' then greatest(v_bs,0) else greatest(v_corp,0) end;
  v_other:=case when p_preferred_account='bs' then 'corporate' else 'bs' end;
  v_first:=least(p_amount,v_preferred_balance);
  v_second:=p_amount-v_first;

  if v_first>0 then insert into public.ledger(account,entry_type,amount,title,operation_group) values(p_preferred_account,'expense',v_first,btrim(p_title),v_group); end if;
  if v_second>0 then insert into public.ledger(account,entry_type,amount,title,operation_group) values(v_other,'expense',v_second,btrim(p_title),v_group); end if;
  return jsonb_build_object('split',v_second>0,'preferred_amount',v_first,'second_amount',v_second,'operation_group',v_group);
end; $$;

create or replace function public.admin_operations(p_password text,p_limit integer default 200)
returns table(id uuid,account text,entry_type text,amount numeric,title text,created_at timestamptz,operation_group uuid)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.check_admin_password(p_password) then raise exception 'ADMIN_ONLY'; end if;
  return query select l.id,l.account,l.entry_type,l.amount,l.title,l.created_at,l.operation_group from public.ledger l order by l.created_at desc limit greatest(1,least(coalesce(p_limit,200),1000));
end; $$;

create or replace function public.checkin_list(p_password text)
returns table(registration_id uuid,registration_no integer,participant_id uuid,first_name text,last_name text,checked_in boolean,checked_in_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.check_checkin_password(p_password) then raise exception 'CHECKIN_ONLY'; end if;
  return query select r.id,r.registration_no,p.id,p.first_name,p.last_name,r.checked_in,r.checked_in_at
  from public.registrations r join public.participants p on p.id=r.participant_id where r.event_type='bs' order by r.registration_no;
end; $$;

create or replace function public.checkin_set_presence(p_password text,p_registration_id uuid,p_checked_in boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.check_checkin_password(p_password) then raise exception 'CHECKIN_ONLY'; end if;
  update public.registrations set checked_in=coalesce(p_checked_in,false),checked_in_at=case when p_checked_in then now() else null end where id=p_registration_id and event_type='bs';
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  return p_checked_in;
end; $$;

create or replace function public.checkin_winners(p_password text)
returns table(id uuid,registration_id uuid,first_name text,last_name text,registration_no integer,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.check_checkin_password(p_password) then raise exception 'CHECKIN_ONLY'; end if;
  return query select w.id,w.registration_id,w.first_name,w.last_name,w.registration_no,w.created_at from public.raffle_winners w order by w.created_at desc;
end; $$;

create or replace function public.checkin_draw_winner(p_password text,p_exclude_previous boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row record;
begin
  if not public.check_checkin_password(p_password) then raise exception 'CHECKIN_ONLY'; end if;
  select r.id registration_id,r.participant_id,r.registration_no,p.first_name,p.last_name into v_row
  from public.registrations r join public.participants p on p.id=r.participant_id
  where r.event_type='bs' and r.checked_in=true
    and (not coalesce(p_exclude_previous,true) or not exists(select 1 from public.raffle_winners w where w.registration_id=r.id))
  order by random() limit 1;
  if not found then raise exception 'NO_ELIGIBLE_PARTICIPANTS'; end if;
  insert into public.raffle_winners(registration_id,participant_id,first_name,last_name,registration_no)
  values(v_row.registration_id,v_row.participant_id,v_row.first_name,v_row.last_name,v_row.registration_no);
  return jsonb_build_object('registration_id',v_row.registration_id,'registration_no',v_row.registration_no,'first_name',v_row.first_name,'last_name',v_row.last_name);
end; $$;

revoke all on function public.check_admin_password(text) from public;
revoke all on function public.check_checkin_password(text) from public;
revoke all on function public.account_balance(text) from public;
revoke all on function public.next_registration_no(text) from public;
revoke all on function public.admin_login(text) from public;
revoke all on function public.checkin_login(text) from public;
revoke all on function public.admin_summary(text) from public;
revoke all on function public.admin_add_participant(text,text,text,boolean,boolean,boolean) from public;
revoke all on function public.admin_list_registrations(text,text) from public;
revoke all on function public.admin_remove_registration(text,uuid) from public;
revoke all on function public.admin_add_expense(text,text,numeric,text) from public;
revoke all on function public.admin_operations(text,integer) from public;
revoke all on function public.checkin_list(text) from public;
revoke all on function public.checkin_set_presence(text,uuid,boolean) from public;
revoke all on function public.checkin_winners(text) from public;
revoke all on function public.checkin_draw_winner(text,boolean) from public;

grant execute on function public.admin_login(text) to anon,authenticated;
grant execute on function public.checkin_login(text) to anon,authenticated;
grant execute on function public.admin_summary(text) to anon,authenticated;
grant execute on function public.admin_add_participant(text,text,text,boolean,boolean,boolean) to anon,authenticated;
grant execute on function public.admin_list_registrations(text,text) to anon,authenticated;
grant execute on function public.admin_remove_registration(text,uuid) to anon,authenticated;
grant execute on function public.admin_add_expense(text,text,numeric,text) to anon,authenticated;
grant execute on function public.admin_operations(text,integer) to anon,authenticated;
grant execute on function public.checkin_list(text) to anon,authenticated;
grant execute on function public.checkin_set_presence(text,uuid,boolean) to anon,authenticated;
grant execute on function public.checkin_winners(text) to anon,authenticated;
grant execute on function public.checkin_draw_winner(text,boolean) to anon,authenticated;

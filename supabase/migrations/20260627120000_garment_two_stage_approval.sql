-- Two-stage approval for garment_orders.
--   stage 1: clinical_approval — PT/OT named on the request
--   stage 2: final_approval    — any coordinators.role in ('admin','super_admin')
-- Plus an in-app notification feed mirroring note_notifications.

alter table public.garment_orders
  add column if not exists clinical_approval_status text not null default 'pending'
    check (clinical_approval_status in ('pending','approved','denied','cancelled')),
  add column if not exists clinical_approver_id uuid references public.coordinators(id) on delete set null,
  add column if not exists clinical_approver_name text,
  add column if not exists clinical_approver_email text,
  add column if not exists clinical_approval_date timestamptz,
  add column if not exists clinical_approval_comments text,
  add column if not exists final_approval_status text not null default 'pending'
    check (final_approval_status in ('pending','approved','denied','cancelled')),
  add column if not exists final_approver_id uuid references public.coordinators(id) on delete set null,
  add column if not exists final_approver_name text,
  add column if not exists final_approver_email text,
  add column if not exists final_approval_date timestamptz,
  add column if not exists final_approval_comments text;

-- Backfill from legacy single-stage approval_status so historic rows aren't
-- stuck pending. A legacy 'approved' row had implicit final sign-off too.
update public.garment_orders
   set clinical_approval_status = 'approved',
       clinical_approver_name   = coalesce(clinical_approver_name, approver_name),
       clinical_approver_email  = coalesce(clinical_approver_email, approver_email),
       clinical_approver_id     = coalesce(clinical_approver_id, approver_id),
       clinical_approval_date   = coalesce(clinical_approval_date, approval_date),
       clinical_approval_comments = coalesce(clinical_approval_comments, approval_comments),
       final_approval_status    = 'approved',
       final_approval_date      = coalesce(final_approval_date, approval_date)
 where approval_status = 'approved'
   and clinical_approval_status = 'pending';

update public.garment_orders
   set clinical_approval_status = 'denied',
       clinical_approver_name   = coalesce(clinical_approver_name, approver_name),
       clinical_approval_date   = coalesce(clinical_approval_date, approval_date),
       clinical_approval_comments = coalesce(clinical_approval_comments, approval_comments),
       final_approval_status    = 'denied'
 where approval_status = 'denied'
   and clinical_approval_status = 'pending';

update public.garment_orders
   set clinical_approval_status = 'cancelled',
       final_approval_status    = 'cancelled'
 where approval_status = 'cancelled'
   and clinical_approval_status = 'pending';

create index if not exists garment_orders_clinical_approval_status_idx
  on public.garment_orders(clinical_approval_status);
create index if not exists garment_orders_final_approval_status_idx
  on public.garment_orders(final_approval_status);

-- In-app notification feed for garment-order events. Mirrors note_notifications
-- so the existing realtime + bell pattern can light it up.
create table if not exists public.garment_order_notifications (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.garment_orders(id) on delete cascade,
  recipient_id uuid references public.coordinators(id) on delete cascade,
  recipient_email text,
  event        text not null check (event in (
    'submitted',
    'clinical_approved',
    'clinical_denied',
    'final_approved',
    'final_denied',
    'cancelled'
  )),
  message      text,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists garment_order_notifications_recipient_idx
  on public.garment_order_notifications(recipient_id, read, created_at desc);
create index if not exists garment_order_notifications_order_idx
  on public.garment_order_notifications(order_id);

alter table public.garment_order_notifications enable row level security;

-- Recipients can read their own notifications and mark them read.
drop policy if exists garment_order_notifications_recipient_select
  on public.garment_order_notifications;
create policy garment_order_notifications_recipient_select
  on public.garment_order_notifications
  for select using (recipient_id = auth.uid());

drop policy if exists garment_order_notifications_recipient_update
  on public.garment_order_notifications;
create policy garment_order_notifications_recipient_update
  on public.garment_order_notifications
  for update using (recipient_id = auth.uid());

-- Any authenticated coordinator can insert (the page emits rows directly when
-- it transitions an order — same trust model as note_notifications).
drop policy if exists garment_order_notifications_authenticated_insert
  on public.garment_order_notifications;
create policy garment_order_notifications_authenticated_insert
  on public.garment_order_notifications
  for insert with check (auth.uid() is not null);

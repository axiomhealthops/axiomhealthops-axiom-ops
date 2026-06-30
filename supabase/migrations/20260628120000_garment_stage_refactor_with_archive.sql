-- New stage flow:
--   submitted → auth_pending → ready_to_order → order_placed → delivered → archived
-- Auto-archive fires 14 days after delivery_date; computed in the view so no
-- cron job is needed.

drop view if exists public.v_garment_orders_with_stage;
create view public.v_garment_orders_with_stage as
select
  g.*,
  case
    when final_approval_status = 'cancelled' then 'cancelled'
    when clinical_approval_status = 'denied' or final_approval_status = 'denied' then 'denied'
    when delivery_date is not null and delivery_date + interval '14 days' < current_date then 'archived'
    when delivery_date is not null then 'delivered'
    when order_placed_date is not null then 'order_placed'
    when final_approval_status = 'approved' then 'ready_to_order'
    when clinical_approval_status = 'approved' then 'auth_pending'
    else 'submitted'
  end as stage
from public.garment_orders g;

-- Sidebar cleanup — these supply-management nav entries were superseded by the
-- Garment Tracker. Removing them from page_permissions hides them from every
-- role's sidebar.
delete from public.user_page_overrides
 where page_key in ('stuck-orders','supply-manager','supply-worklist','supply-monthly-plan','supply-care-delays');
delete from public.page_permissions
 where page_key in ('stuck-orders','supply-manager','supply-worklist','supply-monthly-plan','supply-care-delays');

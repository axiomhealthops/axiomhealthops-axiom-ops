-- docs/base44/setup-cron.sql
--
-- One-time setup to schedule sync-base44-orders every 30 minutes.
-- RUN THIS MANUALLY AFTER YOU'VE:
--   1. Created the base44 backend function (see sync-orders-function.js)
--   2. Set BASE44_SYNC_SECRET in both base44 env and Supabase Edge secrets
--   3. Set BASE44_BASE_URL in Supabase Edge secrets (default https://ahmops.com)
--   4. Verified a manual call to the edge function returns ok:true
--
-- Why not in a migration: this depends on secrets that aren't checked into
-- git. Auto-applying the cron schedule before secrets exist will produce
-- 401 errors on every tick.

-- STEP 1: Store the Supabase service_role key in vault (one time only).
-- Get the key from Supabase dashboard -> Settings -> API -> service_role.
-- The vault encrypts it; pg_cron can decrypt it at call time without
-- exposing it in pg_stat_activity or logs.

SELECT vault.create_secret(
  'eyJ...PASTE_SERVICE_ROLE_KEY_HERE...',
  'sync_base44_orders_service_key',
  'Service role key for cron-driven base44 sync'
);

-- STEP 2: Create the helper function pg_cron calls.
-- pg_cron runs as the postgres superuser; the function reads the vault
-- secret and POSTs to the edge function URL.

CREATE OR REPLACE FUNCTION public.trigger_base44_sync()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_service_key  text;
  v_request_id   bigint;
BEGIN
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'sync_base44_orders_service_key';

  IF v_service_key IS NULL THEN
    RAISE EXCEPTION 'sync_base44_orders_service_key not in vault';
  END IF;

  SELECT net.http_post(
    url := 'https://kndiyailsqrialgbozac.supabase.co/functions/v1/sync-base44-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'x-cron-secret', 'cron'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN jsonb_build_object('request_id', v_request_id, 'triggered_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_base44_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_base44_sync() TO postgres;

-- STEP 3: Schedule it every 30 minutes.

SELECT cron.schedule(
  'sync-base44-orders-30min',
  '*/30 * * * *',
  $$ SELECT public.trigger_base44_sync(); $$
);

-- STEP 4: Verify it's scheduled.
SELECT jobid, schedule, command, active
FROM cron.job
WHERE jobname = 'sync-base44-orders-30min';

-- STEP 5: To kick off a one-time backfill of all historical orders, call
-- the edge function with ?backfill=1 from the Supabase dashboard or:
-- curl -X POST https://kndiyailsqrialgbozac.supabase.co/functions/v1/sync-base44-orders?backfill=1 \
--   -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
--
-- This sets cursor_since=epoch and pulls every order in base44 (up to the
-- 20-page safety cap = 10,000 orders). The dashboard will populate with
-- historical PPPM the moment the run finishes.

-- TO DISABLE THE CRON (if base44 is down or you need to stop syncs):
-- SELECT cron.unschedule('sync-base44-orders-30min');

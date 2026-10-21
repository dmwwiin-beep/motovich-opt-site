-- MOTOVICH scheduled task Push reminders.
-- Run once in Supabase SQL Editor after enabling pg_cron, pg_net and Vault.
-- IMPORTANT: replace both placeholder values before executing. Keep the secret identical
-- to the server-side Edge Function secret MOTOVICH_PUSH_CRON_SECRET.
--
-- The schedule only calls push-schedule. The function itself validates the secret and
-- reads users' last explicitly uploaded task snapshot. No service-role key is stored here.

-- 1) Store the full Edge Function URL and cron secret in Supabase Vault.
select vault.create_secret(
  'https://<PROJECT-REF>.supabase.co/functions/v1/push-schedule',
  'motovich_push_schedule_url',
  'MOTOVICH scheduled due-task Push URL'
);

select vault.create_secret(
  '<PASTE-THE-SAME-RANDOM-SECRET-AS-MOTOVICH_PUSH_CRON_SECRET>',
  'motovich_push_cron_secret',
  'MOTOVICH scheduled due-task Push cron header secret'
);

-- 2) If this named job already exists, remove it to avoid duplicate schedules.
select cron.unschedule(jobid)
from cron.job
where jobname = 'motovich-push-schedule';

-- 3) Run every minute. There is no browser-visible cron token.
select cron.schedule(
  'motovich-push-schedule',
  '* * * * *',
  $motovich$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'motovich_push_schedule_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-motovich-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'motovich_push_cron_secret'
        )
      ),
      body := jsonb_build_object('scheduled_at', now())
    ) as request_id;
  $motovich$
);

-- 4) Verify that the job is enabled.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'motovich-push-schedule';

-- Diagnose failures with:
-- select * from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname='motovich-push-schedule')
-- order by start_time desc limit 20;

# MOTOVICH backend preparation

This folder contains the secure backend for optional cloud persistence and the real AI coach. The published app now includes an opt-in client panel for Supabase Auth and explicit cloud upload/download, plus a coach client hook. The cloud features remain **inactive until a real Supabase project is configured, the migration is applied, the Edge Function is deployed, and its secrets are set**. Without that setup the app continues in local-only mode with its template/rule-based coach.

## Included

- `migrations/202610210001_motovich_cloud.sql` — per-user JSON state table with four owner-only RLS policies, revision tracking, and a server-side daily AI request counter.
- `functions/coach/index.ts` — authenticated edge endpoint that keeps the OpenAI key on the server, validates inputs, limits payload size, and enforces a 30-request per-user daily quota in the database.
- `config.toml` — enables JWT verification for the coach endpoint and configures the internal push sender to require a separate secret header.
- `tests/manual_security_checks.sql` — read-only structural checks for RLS and grants.
- `migrations/202610210002_motovich_push.sql` — stores browser push subscriptions under owner-only RLS.
- `migrations/202610210003_motovich_push_deliveries.sql` — server-only ledger prevents repeat task reminders.
- `functions/push-send/index.ts` — internal server-side sender, protected by `MOTOVICH_PUSH_CRON_SECRET`; it deletes expired 404/410 subscriptions and never returns endpoint values.
- `functions/delete-account/index.ts` — authenticated account-deletion endpoint; it validates the caller's JWT and deletes only that caller's account.
- `functions/push-test/index.ts` — authenticated delivery test sent only to the signed-in user's devices.
- `functions/push-schedule/index.ts` — cron-only task reminder sender that uses the saved user time zone and an idempotent server-side ledger.
- `functions/.env.example` — names of local secrets without any real values.

## Deployment outline

1. Create a Supabase project and link it locally with the Supabase CLI.
2. Apply all three SQL migrations in numeric order using `supabase db push`, or execute each migration file in order in the project's SQL Editor.
3. Copy `functions/.env.example` to `functions/.env` for local development; do not commit the real file.
4. Configure the Edge Function secrets in the Supabase dashboard or CLI. Set `OPENAI_API_KEY`, `OPENAI_MODEL`, and `MOTOVICH_ALLOWED_ORIGIN`. For push delivery also configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `MOTOVICH_PUSH_CRON_SECRET` as server-only secrets. `SUPABASE_URL` and the legacy `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase into hosted Edge Functions; the `SUPABASE_` prefix is reserved and those values must not be sent through `supabase secrets set`. The model name must be one available to the configured OpenAI project.
5. Deploy `coach`, `push-send`, `push-test`, `push-schedule`, and `delete-account` with `supabase functions deploy <function-name>`. Keep the cron secret and all VAPID private material server-side; the Supabase service-role key is runtime-provided and must never be in client code.
6. Enable `pg_cron`, `pg_net`, and Vault in Supabase. Set `MOTOVICH_PUSH_CRON_SECRET` as a server-side Edge Function secret, then run `setup/push-schedule-cron.sql` after replacing the project URL and the same random secret in the template. The script stores the URL and cron secret in Vault and schedules `push-schedule` every minute through `x-motovich-cron-secret`; do not expose the secret to the browser. Run the template only once unless you first update the existing Vault values. The scheduler uses the last explicitly uploaded cloud snapshot and only tasks with both `date` and `time`. Users must upload local data again after changing tasks. `push-send` remains a generic internal broadcaster; `push-test` sends only to the signed-in user's subscriptions.
7. Apply `tests/manual_security_checks.sql` in SQL Editor to verify table RLS, grants, policies, and quota RPC access.


### Generate VAPID keys (only once)

Install the official `web-push` CLI on a trusted computer and create one pair:

```bash
npm install --global web-push
web-push generate-vapid-keys --json
```

Store `publicKey` as the Supabase Edge Function secret `VAPID_PUBLIC_KEY` and paste that value into MOTOVICH Settings. Store `privateKey` only in Supabase Edge Function secrets as `VAPID_PRIVATE_KEY`. Choose a verified developer contact for `VAPID_SUBJECT=mailto:...`. **Generate once and retain the same pair**; replacing the pair invalidates existing browser Push subscriptions. Do not commit the output or send the private key in chat/email. Reference: https://github.com/web-push-libs/web-push#command-line

## Security notes

- Never place an OpenAI secret key or Supabase secret/service-role key in `motovich-app/`, GitHub Pages, or a client-side environment variable.
- The published frontend does not access the cloud table until a project URL and publishable key are configured in Settings and a user signs in. A publishable key is not a substitute for RLS: the migration restricts user-state rows to the signed-in owner.
- The quota table has no direct grants for browser roles; users may only request quota consumption through the fixed-limit function.
- The endpoint deliberately accepts a short message and an optional compact context summary; it does not upload the user's entire local state.
- The code is prepared but not deployed or runtime-tested against a live Supabase/OpenAI project. Service credentials, project creation and deployment cannot be inferred from the GitHub repository alone.


The scheduler time zone is stored in `state.preferences.timeZone` when local state is saved and before manual cloud upload. Tasks without an explicit time are not due-time reminders. Schedule the cron every minute and monitor its summary counts; Push permission alone does not configure a scheduler.


The scheduler reads `state.preferences.timeZone` from the uploaded task snapshot, retries failed notifications after a cooldown, removes expired subscriptions, and uses a server-side unique ledger key to avoid repeatedly sending the same task/date/time. The cron should run every minute and be monitored. See `setup/push-schedule-cron.sql` for the executable setup template. Push permission alone does not activate any server schedule.

## Optional one-click backend deployment with GitHub Actions

The repository has a manual workflow at `.github/workflows/deploy-supabase.yml`. To use it, add GitHub Actions repository secrets named `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `MOTOVICH_PUSH_CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. `OPENAI_API_KEY` is optional; `OPENAI_MODEL` can be set as a repository variable. Do **not** add `SUPABASE_SERVICE_ROLE_KEY`: Supabase injects the hosted runtime variable and rejects secrets whose names start with `SUPABASE_`.

Then open Actions → “Deploy MOTOVICH Supabase backend (manual)”, enter the project ref, type `DEPLOY`, and run it. This applies migrations and deploys five functions. It does not configure the cron schedule automatically: after deployment, run `setup/push-schedule-cron.sql` once with the same cron secret stored in Supabase Vault, then test the push from the app.

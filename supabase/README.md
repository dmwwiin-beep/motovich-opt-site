# MOTOVICH backend preparation

This folder contains the secure backend for optional cloud persistence and the real AI coach. The published app now includes an opt-in client panel for Supabase Auth and explicit cloud upload/download, plus a coach client hook. The cloud features remain **inactive until a real Supabase project is configured, the migration is applied, the Edge Function is deployed, and its secrets are set**. Without that setup the app continues in local-only mode with its template/rule-based coach.

## Included

- `migrations/202610210001_motovich_cloud.sql` — per-user JSON state table with four owner-only RLS policies, revision tracking, and a server-side daily AI request counter.
- `functions/coach/index.ts` — authenticated edge endpoint that keeps the OpenAI key on the server, validates inputs, limits payload size, and enforces a 30-request per-user daily quota in the database.
- `config.toml` — enables JWT verification for the coach endpoint and configures the internal push sender to require a separate secret header.
- `tests/manual_security_checks.sql` — read-only structural checks for RLS and grants.
- `migrations/202610210002_motovich_push.sql` — stores browser push subscriptions under owner-only RLS.
- `functions/push-send/index.ts` — internal server-side sender, protected by `MOTOVICH_PUSH_CRON_SECRET`; it deletes expired 404/410 subscriptions and never returns endpoint values.
- `functions/.env.example` — names of local secrets without any real values.

## Deployment outline

1. Create a Supabase project and link it locally with the Supabase CLI.
2. Apply both SQL migrations using `supabase db push`, or execute the migration files in order in the project's SQL Editor.
3. Copy `functions/.env.example` to `functions/.env` for local development; do not commit the real file.
4. Configure the Edge Function secrets in the Supabase dashboard or CLI. Set `OPENAI_API_KEY`, `OPENAI_MODEL`, and `MOTOVICH_ALLOWED_ORIGIN`. For push delivery also configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `MOTOVICH_PUSH_CRON_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` as server-only secrets. The model name must be one available to the configured OpenAI project. Supabase's function environment must also provide `SUPABASE_URL` and a publishable/anon key.
5. Deploy the AI endpoint with `supabase functions deploy coach` and the internal sender with `supabase functions deploy push-send`. Keep the cron secret and service-role key server-side.
6. Configure a trusted scheduler to POST to the push-send function with the `x-motovich-cron-secret` header; do not expose that secret to the browser. Schedule only reminders users have explicitly enabled.
7. Apply `tests/manual_security_checks.sql` in SQL Editor to verify table RLS, grants, policies, and quota RPC access.

## Security notes

- Never place an OpenAI secret key or Supabase secret/service-role key in `motovich-app/`, GitHub Pages, or a client-side environment variable.
- The published frontend does not access the cloud table until a project URL and publishable key are configured in Settings and a user signs in. A publishable key is not a substitute for RLS: the migration restricts user-state rows to the signed-in owner.
- The quota table has no direct grants for browser roles; users may only request quota consumption through the fixed-limit function.
- The endpoint deliberately accepts a short message and an optional compact context summary; it does not upload the user's entire local state.
- The code is prepared but not deployed or runtime-tested against a live Supabase/OpenAI project. Service credentials, project creation and deployment cannot be inferred from the GitHub repository alone.

# P11 PM

P11 PM is an internal creative-operations workspace for P11 Creative. It keeps Basecamp’s clarity, adds the executive workload visibility P11 needs, and connects the workspace to Slack and Claude Cowork.

## Included

- Invite-only Supabase Auth with passwordless magic-link login
- Basecamp-imported project spaces
- Basecamp-style to-do threads with multiple assignees, “when done” subscribers,
  subtasks, notes, mentions, attachments, comments, and completion history
- Threaded message board
- Realtime project Campfire
- Realtime P11 Chat with public/private channels and one-to-one/group DMs
- Supabase Storage-backed docs and files
- Executive Team View with per-person workload, project grouping, overdue filters, and a plain-language due-next list
- Cross-project activity feed
- Slack app with `/pm`, events, message actions, and notifications
- Remote streamable-HTTP MCP server for Claude Cowork

Local development includes optional demo data. Production demo access is disabled.

P11 PM intentionally omits social reactions, boosts, and likes. Work context stays
in the thread through comments, mentions, files, and explicit completion state.

## Local setup

Requirements: Node.js 20.9+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use **Preview demo workspace** before the live database is provisioned.

## Environment

Populate only `.env.local`; environment files are ignored by Git.

Minimum for live auth and data:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The service-role key is server-only. Never prefix it with `NEXT_PUBLIC_`.

Optional integrations fail closed with a clear `503` until configured:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- Cowork connector: `MCP_API_KEY`

Accelo is intentionally disabled and has no Vercel schedule or runtime
credentials.

## Supabase provisioning

The schema in `supabase/migrations` enables RLS on exposed tables, installs project-file Storage policies, and creates the auth profile trigger.

```bash
npx supabase db push
# Or:
npx supabase db push --db-url "$DATABASE_URL"
```

In Supabase Auth settings:

1. Set the Site URL to the Vercel production URL.
2. Add local and production `/auth/callback` URLs to Redirect URLs.
3. Keep public signup disabled; accounts are created through hashed, expiring `invites`.

Generate a 32-byte random token, store its SHA-256 digest in `invites.token_hash`, and send the raw token as:

```text
https://YOUR_APP/invite?token=RAW_TOKEN
```

## Basecamp production import

The supplied Basecamp snapshot is stored at
`data/basecamp/basecamp_export.json`. The importer validates reported entity
counts, preserves native Basecamp IDs and raw payloads, and is safe to rerun.

```bash
npm run import:basecamp -- --dry-run
npm run import:basecamp
```

The command requires the production Supabase URL and server-only secret in the
environment. Export coverage and known source gaps are recorded in
`integration_settings` and the organization settings.

## P11 Chat

`/chat` is the internal P11 messaging area. It supports public and private
channels plus one-to-one and group direct messages with persistent unread
state, single-level Slack-style threads with independent unread state, secure
file attachments and image previews, keyset-paginated history, idempotent
sends, and Supabase Realtime delivery. It intentionally omits nested threads,
reactions, presence, and message editing or deletion.

P11 Chat is separate from project Campfire and from the external Slack app:
Campfire stays scoped to one project, while Slack commands and notifications
continue to operate in Slack.

Shared-password roster provisioning is retired. Verify SMTP and Auth redirect
URLs, keep public signup disabled, configure the database signup hook, and
issue one-time workspace invites so every teammate claims an individual
passwordless account. `npm run provision:chat-users` now exits with those
instructions and never mutates Auth users.

## Accelo (disabled)

Accelo is not active functionality. Its Vercel cron schedule is removed, the
application does not promise synchronization or freshness, and no Accelo
credentials are required for release. Imported external IDs remain only for
data lineage; the scheduled route and write-back implementation are absent.

## Slack

1. Create a Slack app from `slack/manifest.yaml`.
2. Replace the example app URL with the Vercel production URL.
3. Install it and add the bot token and signing secret to Vercel.
4. Invite the bot to project channels and map those channels in P11 PM.

Commands:

- `/pm my tasks`
- `/pm project status PROJECT`
- `/pm create task PROJECT | TASK`
- Message shortcut: **Add to P11 PM**

Every Slack request is HMAC-verified against the raw body with a five-minute replay window and constant-time comparison.

## Claude Cowork

Add a custom remote MCP connector:

```text
URL: https://YOUR_APP/api/mcp
Authorization: Bearer YOUR_MCP_API_KEY
```

Tools cover project search/status, assignments, to-do creation and updates, and project messages/comments.

## Vercel deployment

1. Import the repository into Vercel.
2. Add variables from `.env.example`.
3. Set `NEXT_PUBLIC_APP_URL` to the production URL.
4. Deploy.
5. Update Supabase redirects and the Slack manifest with the final domain.
6. Add the MCP URL to Claude Cowork.

`data/`, local load credentials, and generated evidence are excluded from
deployment. No compute region is pinned until `pdx1` and `sfo1` are measured
against Supabase. Web Analytics, Speed Insights, and privacy-filtered
OpenTelemetry are initialized by the root layout and instrumentation hook.

No credential is committed. Demo mode is disabled in production unless `ALLOW_DEMO_MODE=true` is explicitly set.

## Performance and release evidence

`performance/contract.json` is the versioned release contract.
`performance/baseline.json` records the pre-remediation measured and modeled
baseline, and `performance/schemas/v1/` defines machine-readable evidence.

```bash
npm run build
npm run check:route-budgets
npm run evidence:release -- --environment ci --check build=pass
```

CI runs lint, types, unit tests, a production build, and route bundle budgets.
Preview E2E, staging load, nightly soak, and manual promotion workflows skip
with an explicit notice when their runtime-only secrets are unavailable.
Production promotion accepts an already-tested preview only; it does not
rebuild a different artifact. The release gate requires three target-load
runs plus distinct burst and soak evidence, verifies a rollback deployment,
and chains candidate evidence into the final production record.

Workflow-only configuration uses `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`,
`VERCEL_AUTOMATION_BYPASS_SECRET`, `PREVIEW_BASE_URL`, `STAGING_BASE_URL`,
`PLAYWRIGHT_STORAGE_STATE_B64`, and `K6_SESSION_FILE_B64`. Keep these in
GitHub secrets; preview and staging origins are not accepted as dispatch input.
Staging performance runs take the deployed full commit SHA and a load profile;
nightly soak can be manually rerun for the same candidate SHA.

## Validation

```bash
npm run check
```

This runs ESLint, TypeScript, unit tests, a production build, and the versioned
route bundle budgets. Playwright and k6 are separate because remote,
authenticated runs require runtime-only state:

```bash
npm run test:e2e
K6_BASE_URL=https://staging.example.com npm run test:load:smoke
```

## Routes

- `/dashboard` — operating overview
- `/projects` and `/projects/[projectId]` — project workspaces
- `/chat` and `/chat/[conversationId]` — P11 channels and direct messages
- `/team` — executive workload view
- `/my-work` — personal assignments
- `/activity` — cross-project activity
- `/api/mcp` — Claude Cowork connector
- `/api/slack/*` — Slack app

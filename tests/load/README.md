# Staging load tests

These k6 tests are intentionally read-only. They are safe to run against a
dedicated staging dataset and cannot create tasks, messages, or files.

Public smoke:

```bash
K6_BASE_URL=https://staging.example.com npm run test:load:smoke
```

Authenticated target, navigation, burst, or soak:

```bash
K6_BASE_URL=https://staging.example.com \
K6_SESSION_FILE=tests/load/.sessions.json \
K6_PROFILE=target \
  npm run test:load:workspace
```

`.sessions.json` is runtime-only and ignored by Git. It must be a JSON array
of complete `Cookie` header values, one for each virtual user. The target and
soak profiles require 33 distinct sessions; burst requires 66. Setting
`K6_ALLOW_SHARED_SESSION=true` permits a shared-session diagnostic run, but
that run is not capacity-certifying.

For a protected Vercel staging deployment, set the runtime-only
`K6_VERCEL_AUTOMATION_BYPASS_SECRET`; requests send it as a header and evidence
never records it.

Optional `K6_PROJECT_ID` and `K6_CHAT_CONVERSATION_ID` values add a project
page and bounded message-page request. Do not put any session, identifier, or
URL containing credentials in source control or workflow logs.

Profiles:

- `target`: one simultaneous cold navigation for 33 users.
- `navigation`: 33 users navigating for 60 seconds.
- `burst`: 66 users for five minutes.
- `soak`: 33 users for one hour.

The destructive race, upload, and write-mix gates in
`performance/contract.json` need an isolated fixture plus idempotent cleanup.
They remain explicit release requirements and must not be simulated by
writing uncontrolled data to production.

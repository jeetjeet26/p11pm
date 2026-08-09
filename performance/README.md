# Performance evidence

`contract.json` is the versioned source of truth for release thresholds.
`baseline.json` preserves the pre-remediation audit without presenting modeled
values as measured results. Schemas under `schemas/v1/` make contract,
baseline, and release evidence machine-checkable.

Generated files belong in `performance/artifacts/` and
`performance/evidence/`. They are ignored by Git and should be uploaded by CI
as immutable workflow artifacts:

```bash
npm run build
npm run check:route-budgets
npm run evidence:release -- \
  --environment ci \
  --check lint=pass \
  --check typecheck=pass \
  --check unit=pass \
  --check build=pass
```

Release evidence contains only normalized deployment metadata, checksums, and
check outcomes. It never copies environment variables, request data, user
identifiers, or artifact contents.

The `target` profile is an intentional cold-start storm: all 33 users enter the
workspace together after an idle deployment. It uses the separate cold-start
TTFB budget. The 66-session burst profile has a separate saturation budget,
while navigation and soak retain the strict steady-state authenticated-page
TTFB budget. The cold target sends every user through the Basecamp archive;
long-running profiles distribute archive reads across ten percent of iterations
to model occasional historical lookup instead of continuous archive refreshes.
Archive TTFB is reported against its own historical-query budget so it cannot
hide regressions in the latency-sensitive dashboard, project, team, or chat
routes.

The contract pins application compute to `sfo1`, the lower-latency measured
region for the Supabase `us-west-2` database.

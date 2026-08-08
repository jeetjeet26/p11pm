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

The contract intentionally leaves `regionPolicy.pinnedRegion` unset. Benchmark
`pdx1` and `sfo1` against the Supabase region, record the result as evidence,
then update the contract in a reviewed change.

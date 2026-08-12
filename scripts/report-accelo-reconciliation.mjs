import { createClient } from "@supabase/supabase-js";

const organizationId = process.argv[2]?.trim();
const sourceAccountId = process.argv[3]?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (
  !organizationId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    organizationId,
  ) ||
  !sourceAccountId ||
  sourceAccountId.length > 200
) {
  throw new Error(
    "Usage: node scripts/report-accelo-reconciliation.mjs <organization-uuid> <source-account-id>",
  );
}
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await client.rpc("get_accelo_pending_report", {
  target_organization_id: organizationId,
  target_source_account_id: sourceAccountId,
});
if (error) {
  throw new Error(`Could not read Accelo reconciliation report (${error.code}).`);
}

process.stdout.write(`${stableJson(data)}\n`);

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

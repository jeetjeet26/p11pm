#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

async function createSession(admin, url, publishableKey, email) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const { data: link, error: linkError } =
      await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError) {
      if (linkError.status === 429 && attempt < 12) {
        await sleep(30_000);
        continue;
      }
      throw linkError;
    }

    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verified, error: verifyError } = await client.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (!verifyError && verified.session) return verified.session;
    if (verifyError?.status === 429 && attempt < 12) {
      await sleep(30_000);
      continue;
    }
    throw verifyError ?? new Error("Session was not returned.");
  }
  throw new Error("Session generation exhausted its retry budget.");
}

function cookieHeader(storageKey, session) {
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const chunks = [];
  for (let offset = 0; offset < encoded.length; offset += 3180) {
    chunks.push(encoded.slice(offset, offset + 3180));
  }
  return chunks.length === 1
    ? `${storageKey}=${chunks[0]}`
    : chunks
        .map((value, index) => `${storageKey}.${index}=${value}`)
        .join("; ");
}

async function main() {
  const url = requiredEnvironment("SUPABASE_URL");
  const publishableKey = requiredEnvironment("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const count = positiveInteger("K6_SESSION_COUNT", 33);
  const initialDelaySeconds = positiveInteger("K6_SESSION_INITIAL_DELAY_SECONDS", 60);
  const outputPath = path.resolve(
    process.cwd(),
    process.env.K6_SESSION_OUTPUT ?? "test-results/k6-sessions.json",
  );

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: page, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;
  const users = page.users.filter((user) => user.email).slice(0, 33);
  if (users.length !== 33) {
    throw new Error(`Expected 33 load users, found ${users.length}.`);
  }

  const projectRef = new URL(url).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const cookieHeaders = [];
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sleep(initialDelaySeconds * 1000);

  for (let index = 0; index < count; index += 1) {
    const user = users[index % users.length];
    const session = await createSession(admin, url, publishableKey, user.email);
    cookieHeaders.push(cookieHeader(storageKey, session));
    await writeFile(outputPath, JSON.stringify(cookieHeaders), { mode: 0o600 });
    console.log(`Created load session ${index + 1}/${count}.`);
    await sleep(2_000);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

import { config as loadDotenv } from "dotenv";

const ENV_PATH = ".env.dropbox.local";
const APP_KEY = process.env.DROPBOX_APP_KEY ?? "k2ze3wue28eshwb";
const REDIRECT_URI = "http://localhost:53682/dropbox/callback";

if (existsSync(ENV_PATH)) {
  loadDotenv({ path: ENV_PATH, override: false, quiet: true });
}

function base64Url(value) {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function saveTokens(payload) {
  const existing = existsSync(ENV_PATH) ? await readFile(ENV_PATH, "utf8") : "";
  const retained = existing
    .split(/\r?\n/)
    .filter(
      (line) =>
        line &&
        !line.startsWith("DROPBOX_ACCESS_TOKEN=") &&
        !line.startsWith("DROPBOX_REFRESH_TOKEN=") &&
        !line.startsWith("DROPBOX_APP_KEY=") &&
        !line.startsWith("DROPBOX_TOKEN_EXPIRES_AT="),
    );
  retained.push(
    `DROPBOX_APP_KEY=${APP_KEY}`,
    `DROPBOX_ACCESS_TOKEN=${payload.access_token}`,
    `DROPBOX_REFRESH_TOKEN=${payload.refresh_token}`,
    `DROPBOX_TOKEN_EXPIRES_AT=${Date.now() + Number(payload.expires_in) * 1_000}`,
  );
  await writeFile(ENV_PATH, `${retained.join("\n")}\n`, { mode: 0o600 });
}

async function main() {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(24));
  const authorization = new URL("https://www.dropbox.com/oauth2/authorize");
  authorization.searchParams.set("client_id", APP_KEY);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("redirect_uri", REDIRECT_URI);
  authorization.searchParams.set("token_access_type", "offline");
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  authorization.searchParams.set("state", state);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", REDIRECT_URI);
    if (url.pathname !== "/dropbox/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (url.searchParams.get("state") !== state) {
      response.writeHead(400).end("Invalid OAuth state");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      response.writeHead(400).end("Dropbox authorization was not completed");
      return;
    }
    try {
      const tokenResponse = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          client_id: APP_KEY,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
        }),
      });
      const payload = await tokenResponse.json();
      if (!tokenResponse.ok || !payload.refresh_token) {
        throw new Error(payload.error_description ?? payload.error ?? "Token exchange failed.");
      }
      await saveTokens(payload);
      response
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("Dropbox read-only authorization saved. You can close this tab.");
      console.log("DROPBOX_AUTHORIZATION_COMPLETE");
      server.close();
    } catch (error) {
      response.writeHead(500).end("Dropbox token exchange failed.");
      console.error(error instanceof Error ? error.message : String(error));
      server.close();
      process.exitCode = 1;
    }
  });

  server.listen(53682, "127.0.0.1", () => {
    console.log(`DROPBOX_REDIRECT_URI=${REDIRECT_URI}`);
    console.log(`DROPBOX_AUTHORIZATION_URL=${authorization}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

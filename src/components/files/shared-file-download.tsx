"use client";

import { Download, FileLock2, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SharedFileDownload({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openFile() {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/files/shares/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: password || undefined }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      url?: string;
    } | null;
    setLoading(false);
    if (!response.ok || !body?.url) {
      setError(body?.error ?? "This file could not be opened.");
      return;
    }
    window.location.assign(body.url);
  }

  return (
    <div className="space-y-5">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <FileLock2 className="size-7" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold">A file was shared with you</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Shared links are short-lived, revocable, and delivered through a private
          signed download.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="share-password">Password, if required</Label>
        <Input
          id="share-password"
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void openFile();
          }}
          type="password"
          value={password}
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={loading} onClick={() => void openFile()}>
        {loading ? <LoaderCircle className="animate-spin" /> : <Download />}
        Open file
      </Button>
    </div>
  );
}

import { Building2, Mail, Search, WalletCards } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { CrmClient } from "./types";

export function ClientsDirectory({
  clients,
  query,
  ownerId,
  parentClientId,
  owners,
  accountOptions,
}: {
  clients: CrmClient[];
  query: string;
  ownerId?: string;
  parentClientId?: string;
  owners: Array<{ id: string; name: string }>;
  accountOptions: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]" role="search">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                defaultValue={query}
                name="q"
                placeholder="Search companies, contacts, or owners…"
                type="search"
              />
            </div>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              defaultValue={ownerId ?? ""}
              name="ownerId"
            >
              <option value="">All owners</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              defaultValue={parentClientId ?? ""}
              name="parentClientId"
            >
              <option value="">All parents</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button type="submit" variant="outline">Filter</Button>
              {(query || ownerId || parentClientId) && (
                <Button asChild type="button" variant="ghost">
                  <Link href="/clients">Clear</Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {clients.length ? (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Client</TableHead>
                <TableHead className="hidden md:table-cell">Primary contact</TableHead>
                <TableHead className="hidden lg:table-cell">Owner</TableHead>
                <TableHead className="hidden xl:table-cell">Parent</TableHead>
                <TableHead>Work</TableHead>
                <TableHead className="pr-4 text-right">Receivables</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="pl-4">
                    <Link
                      className="group flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/clients/${client.id}`}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Building2 className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium group-hover:underline">
                          {client.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {client.industry || client.email || "Client account"}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {client.primaryContactName || (
                      <span className="text-muted-foreground">Not assigned</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {client.ownerName ? (
                      <Link
                        className="hover:underline"
                        href={`/clients?ownerId=${client.ownerId}`}
                      >
                        {client.ownerName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {client.parentClientName ? (
                      <Link
                        className="hover:underline"
                        href={`/clients/${client.parentClientId}`}
                      >
                        {client.parentClientName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">
                        {client.activeProjects ?? 0} projects
                      </Badge>
                      <Badge variant="outline">
                        {client.activeRetainers ?? 0} retainers
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="pr-4 text-right font-mono text-xs">
                    {formatCurrency(client.outstandingAmount ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-14 text-center">
            {query ? (
              <Search className="mx-auto size-8 text-muted-foreground" />
            ) : (
              <Mail className="mx-auto size-8 text-muted-foreground" />
            )}
            <p className="mt-3 font-medium">
              {query ? "No matching clients" : "No clients yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {query
                ? "Try a company name, contact, or account owner."
                : "Create the first account to start building your directory."}
            </p>
          </CardContent>
        </Card>
      )}
      {clients.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <WalletCards className="size-3.5" />
          Receivables show the currently outstanding client balance.
        </p>
      )}
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

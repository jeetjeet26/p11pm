import {
  Activity,
  BriefcaseBusiness,
  CalendarClock,
  ExternalLink,
  Mail,
  Phone,
  Repeat2,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { FileBrowser } from "@/components/files/file-browser";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ContactAffiliationActions } from "./contact-affiliation-actions";
import { ActivityDialog, ContactDialog, ContactEditDialog } from "./crm-dialogs";
import { RelationshipTimeline } from "./relationship-timeline";
import type { ClientDetailData } from "./types";

export function ClientOverview({
  data,
  canManage = false,
}: {
  data: ClientDetailData;
  canManage?: boolean;
}) {
  const { client, contacts, projects, retainers, activities, receivables } = data;
  const outstanding = receivables
    .filter((item) => item.status !== "paid")
    .reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label="Contacts" value={contacts.length} />
        <MetricCard icon={BriefcaseBusiness} label="Projects" value={projects.length} />
        <MetricCard icon={Repeat2} label="Retainers" value={retainers.length} />
        <MetricCard
          icon={WalletCards}
          label="Outstanding"
          value={formatCurrency(outstanding)}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="receivables">Receivables</TabsTrigger>
        </TabsList>

        <TabsContent className="grid gap-4 pt-4 lg:grid-cols-[1fr_320px]" value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Account snapshot</CardTitle>
              <CardDescription>Commercial and relationship details.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Detail label="Account owner" value={client.ownerName || "Not assigned"} />
              <Detail
                label="Parent account"
                value={client.parentClientName || "None"}
              />
              <Detail label="Industry" value={client.industry || "Not specified"} />
              <Detail label="Email" value={client.email || "Not specified"} />
              <Detail label="Phone" value={client.phone || "Not specified"} />
              {client.notes && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Internal notes
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{client.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Primary contact</CardTitle>
              <CardDescription>Your first point of contact.</CardDescription>
            </CardHeader>
            <CardContent>
              {contacts[0] ? (
                <Contact contact={contacts[0]} clientId={client.id} />
              ) : (
                <Empty icon={UserRound} label="No contact has been added." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="space-y-4 pt-4" value="contacts">
          <SectionHeader
            action={canManage ? <ContactDialog clientId={client.id} /> : undefined}
            description="People associated with this account."
            title="Contacts"
          />
          {contacts.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {contacts.map((contact) => (
                <Card key={contact.id}>
                  <CardContent>
                    <Contact contact={contact} clientId={client.id} />
                    {canManage ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2">
                        <ContactEditDialog contact={contact} />
                        <ContactAffiliationActions
                          clientId={client.id}
                          contact={contact}
                        />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyCard icon={Users} label="No contacts yet" />
          )}
        </TabsContent>

        <TabsContent className="grid gap-4 pt-4 lg:grid-cols-2" value="work">
          <WorkList
            description="Delivery work for this client."
            empty="No linked projects."
            icon={BriefcaseBusiness}
            items={projects.map((project) => ({
              id: project.id,
              href: `/projects/${project.id}`,
              title: project.name,
              meta: project.code || project.status || "Project",
            }))}
            title="Projects"
          />
          <WorkList
            description="Recurring service agreements."
            empty="No retainers."
            icon={Repeat2}
            items={retainers.map((retainer) => ({
              id: retainer.id,
              href: `/retainers/${retainer.id}`,
              title: retainer.name,
              meta: `${formatHours(retainer.loggedHours)} of ${formatHours(retainer.allowanceHours)}`,
            }))}
            title="Retainers"
          />
        </TabsContent>

        <TabsContent className="space-y-4 pt-4" value="files">
          <SectionHeader
            description="Briefs, deliverables, approvals, and shared client resources."
            title="Client files"
          />
          <FileBrowser clientId={client.id} compact />
        </TabsContent>

        <TabsContent className="space-y-4 pt-4" value="activity">
          <SectionHeader
            action={canManage ? <ActivityDialog clientId={client.id} /> : undefined}
            description="Calls, meetings, notes, and account updates."
            title="Activity"
          />
          {activities.length ? (
            <RelationshipTimeline
              clientId={client.id}
              initialActivities={activities}
            />
          ) : (
            <EmptyCard icon={Activity} label="No activity has been logged." />
          )}
        </TabsContent>

        <TabsContent className="space-y-4 pt-4" value="receivables">
          <SectionHeader
            description="Open and settled amounts associated with this account."
            title="Receivables"
          />
          {receivables.length ? (
            <div className="grid gap-3">
              {receivables.map((item) => (
                <Card size="sm" key={item.id}>
                  <CardContent className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">{item.reference || "Receivable"}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarClock className="size-3" />
                        {item.dueDate ? `Due ${formatDate(item.dueDate)}` : "No due date"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-semibold">{formatCurrency(item.amount)}</p>
                      <Badge variant={item.status === "overdue" ? "destructive" : "secondary"}>
                        {item.status || "open"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyCard icon={WalletCards} label="No receivables for this client." />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Contact({
  contact,
  clientId,
}: {
  contact: ClientDetailData["contacts"][number];
  clientId: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-primary/10 font-medium text-primary">
          {contact.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <p className="font-medium">{contact.name}</p>
          <p className="text-xs text-muted-foreground">
            {contact.role || contact.position || contact.title || "Contact"}
          </p>
        </div>
      </div>
      {contact.isPrimary || contact.receivesInvoices ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {contact.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
          {contact.receivesInvoices ? (
            <Badge variant="outline">Invoice recipient</Badge>
          ) : null}
          {contact.status === "inactive" ? (
            <Badge variant="destructive">Inactive</Badge>
          ) : null}
        </div>
      ) : contact.status === "inactive" ? (
        <div className="mt-3">
          <Badge variant="destructive">Inactive</Badge>
        </div>
      ) : null}
      {contact.affiliations && contact.affiliations.length > 1 ? (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <p className="font-medium uppercase tracking-wide">Also affiliated with</p>
          {contact.affiliations
            .filter((affiliation) => affiliation.clientId !== clientId)
            .map((affiliation) => (
              <Link
                className="block hover:underline"
                href={`/clients/${affiliation.clientId}`}
                key={affiliation.id}
              >
                {affiliation.clientName}
                {affiliation.role ? ` · ${affiliation.role}` : ""}
              </Link>
            ))}
        </div>
      ) : null}
      <Separator className="my-4" />
      <div className="space-y-2 text-sm">
        {contact.email && (
          <a className="flex items-center gap-2 hover:underline" href={`mailto:${contact.email}`}>
            <Mail className="size-4 text-muted-foreground" /> {contact.email}
          </a>
        )}
        {contact.phone && (
          <a className="flex items-center gap-2 hover:underline" href={`tel:${contact.phone}`}>
            <Phone className="size-4 text-muted-foreground" /> {contact.phone}
          </a>
        )}
      </div>
    </div>
  );
}

function WorkList({
  title,
  description,
  icon: Icon,
  items,
  empty,
}: {
  title: string;
  description: string;
  icon: typeof Repeat2;
  items: Array<{ id: string; href: string; title: string; meta: string }>;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="size-4" />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="divide-y">
            {items.map((item) => (
              <Link className="flex items-center justify-between gap-3 py-3 hover:text-primary" href={item.href} key={item.id}>
                <span><span className="block font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{item.meta}</span></span>
                <ExternalLink className="size-4 shrink-0" />
              </Link>
            ))}
          </div>
        ) : <Empty icon={Icon} label={empty} />}
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return <Card size="sm"><CardContent className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-muted"><Icon className="size-4 text-muted-foreground" /></span><span><span className="block text-lg font-semibold">{value}</span><span className="text-xs text-muted-foreground">{label}</span></span></CardContent></Card>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm">{value}</p></div>;
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{action}</div>;
}

function Empty({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground"><Icon className="mx-auto mb-2 size-7" />{label}</div>;
}

function EmptyCard(props: { icon: typeof Users; label: string }) {
  return <Card><CardContent><Empty {...props} /></CardContent></Card>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function formatHours(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

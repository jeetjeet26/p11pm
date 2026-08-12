import { ContactRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectStakeholderManager } from "@/components/projects/project-stakeholder-manager";
import { createClient } from "@/lib/supabase/server";

export async function ProjectStakeholders({
  projectId,
  canManage = false,
}: {
  projectId: string;
  canManage?: boolean;
}) {
  const supabase = await createClient();
  if (!supabase) return null;
  const [linksResult, projectResult] = await Promise.all([
    supabase
      .from("project_contacts")
      .select(
        "id,contact_id,role,is_primary,contact:contacts(first_name,last_name,email,title)",
      )
      .eq("project_id", projectId)
      .order("is_primary", { ascending: false })
      .limit(50),
    supabase.from("projects").select("client_id").eq("id", projectId).maybeSingle(),
  ]);
  if (linksResult.error || projectResult.error) return null;
  const data = linksResult.data ?? [];
  const contactResult =
    canManage && projectResult.data?.client_id
      ? await supabase
          .from("client_contacts")
          .select(
            "contact:contacts(id,first_name,last_name,email)",
          )
          .eq("client_id", projectResult.data.client_id)
          .limit(250)
      : { data: [], error: null };
  if (contactResult.error || (!data.length && !canManage)) return null;
  const links = data.flatMap((link) => {
    const contact = Array.isArray(link.contact) ? link.contact[0] : link.contact;
    if (!contact) return [];
    return [
      {
        id: link.id,
        contactId: link.contact_id,
        name:
          `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
          contact.email ||
          "Contact",
        role: link.role,
        isPrimary: link.is_primary,
      },
    ];
  });
  const contacts = (contactResult.data ?? []).flatMap((item) => {
    const contact = Array.isArray(item.contact) ? item.contact[0] : item.contact;
    if (!contact) return [];
    return [
      {
        id: contact.id,
        name:
          `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
          contact.email ||
          "Contact",
        email: contact.email,
      },
    ];
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        <span className="mr-1 flex items-center gap-2 text-sm font-medium">
          <ContactRound className="size-4 text-primary" />
          Stakeholders
        </span>
        {data.map((link) => {
          const contact = Array.isArray(link.contact)
            ? link.contact[0]
            : link.contact;
          if (!contact) return null;
          const name =
            `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
            contact.email ||
            "Contact";
          return (
            <Badge key={link.id} variant={link.is_primary ? "default" : "secondary"}>
              {name}
              {link.role ? ` · ${link.role}` : ""}
            </Badge>
          );
        })}
        {canManage ? (
          <ProjectStakeholderManager
            contacts={contacts}
            links={links}
            projectId={projectId}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

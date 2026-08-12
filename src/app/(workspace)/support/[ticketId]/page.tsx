import { notFound } from "next/navigation";

import { SupportWorkspace } from "@/components/support/support-workspace";
import { getSupportPageContext } from "@/lib/support/server";

export default async function SupportTicketPage(
  props: PageProps<"/support/[ticketId]">,
) {
  const [{ ticketId }, context] = await Promise.all([
    props.params,
    getSupportPageContext(),
  ]);
  if (!context.canRead) notFound();
  return (
    <SupportWorkspace
      canWrite={context.canWrite}
      clients={context.clients}
      initialTicketId={ticketId}
      profiles={context.profiles}
    />
  );
}

import { redirect } from "next/navigation";

import { OpportunityDetail } from "@/components/pipeline/opportunity-detail";
import { getViewer } from "@/lib/auth/viewer";

export const metadata = { title: "Opportunity" };

export default async function OpportunityPage({
  params,
}: PageProps<"/clients/prospects/[prospectId]">) {
  const { prospectId } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return (
    <OpportunityDetail
      canManage={viewer.capabilities.pipelineWrite}
      prospectId={prospectId}
    />
  );
}

import { TeamView } from "@/components/team/team-view";
import { Badge } from "@/components/ui/badge";
import { getTeamData } from "@/lib/data";

export const metadata = { title: "Team view" };

export default async function TeamPage() {
  const data = await getTeamData();

  return (
    <div className="space-y-7">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Team view</h1>
          <Badge variant="secondary">Executive view</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          See who is assigned to what, where work is getting heavy, and what is due next.
        </p>
      </header>
      <TeamView data={data} />
    </div>
  );
}

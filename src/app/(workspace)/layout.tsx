import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { currentProfile } from "@/lib/demo-data";
import { isDemoModeAllowed } from "@/lib/demo-mode";
import { getViewer } from "@/lib/auth/viewer";

export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const demoMode =
    isDemoModeAllowed() &&
    cookieStore.get("p11-demo")?.value === "true";
  const viewer = demoMode ? null : await getViewer();
  if (!demoMode && !viewer) {
    redirect(
      "/login?error=This%20account%20is%20not%20active%20in%20the%20P11%20workspace.",
    );
  }

  let shellUser = {
    name: currentProfile.fullName,
    initials: currentProfile.initials,
    title: currentProfile.jobTitle,
  };
  if (viewer) {
    const fullName = viewer.profile.fullName || viewer.profile.email;
    shellUser = {
      name: fullName,
      initials: fullName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase(),
      title: viewer.profile.title ?? viewer.organization.name,
    };
  }

  return (
    <AppShell
      canCommercialRead={
        demoMode || (viewer?.capabilities.commercialRead ?? false)
      }
      canSupportRead={demoMode || (viewer?.capabilities.supportRead ?? false)}
      demoMode={demoMode}
      isAdmin={viewer?.role === "admin"}
      user={shellUser}
    >
      {children}
    </AppShell>
  );
}

import { FolderSearch } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <FolderSearch className="mx-auto size-11 text-muted-foreground" />
        <h1 className="mt-5 text-2xl font-semibold">We couldn’t find that project</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been archived or you may not have access.
        </p>
        <Button asChild className="mt-6"><Link href="/projects">Back to projects</Link></Button>
      </div>
    </main>
  );
}

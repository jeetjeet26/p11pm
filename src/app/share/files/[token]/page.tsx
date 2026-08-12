import { SharedFileDownload } from "@/components/files/shared-file-download";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Shared file" };

export default async function SharedFilePage({
  params,
}: PageProps<"/share/files/[token]">) {
  const { token } = await params;
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent>
          <SharedFileDownload token={token} />
        </CardContent>
      </Card>
    </main>
  );
}

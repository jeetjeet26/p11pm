import { QuickCapture } from "@/components/capture/quick-capture";

export const metadata = { title: "Quick capture" };

export default function CapturePage() {
  return (
    <div className="space-y-6">
      <header className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Capture work</h1>
        <p className="mt-2 text-muted-foreground">
          A fast, mobile-friendly path from thought to accountable work.
        </p>
      </header>
      <QuickCapture />
    </div>
  );
}

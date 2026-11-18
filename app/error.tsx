"use client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/state";
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto grid max-w-xl gap-4 p-10">
      <h1 className="text-3xl font-bold">The workspace could not load</h1>
      <Notice>Reconnect if you are offline, then retry.</Notice>
      <Button className="w-fit" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}

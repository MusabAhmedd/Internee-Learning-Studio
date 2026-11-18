import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto grid max-w-xl gap-4 p-10">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="smallprint">This URL is not part of Learning Studio.</p>
      <Button className="w-fit" asChild>
        <Link href="/">Back to Learning Studio</Link>
      </Button>
    </main>
  );
}

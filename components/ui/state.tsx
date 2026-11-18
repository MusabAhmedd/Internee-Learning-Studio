import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "./button";

export function Loading({ label = "Loading workspace…" }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <LoaderCircle
        size={19}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {label}
    </p>
  );
}
export function Notice({
  children,
  retry,
}: {
  children: React.ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="notice" role="alert">
      <TriangleAlert size={17} aria-hidden="true" />
      <div>{children}</div>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

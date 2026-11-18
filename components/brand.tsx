import { Layers3 } from "lucide-react";

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <Layers3 size={21} aria-hidden="true" />
      </span>
      <span>
        <strong>
          Internee<span className="brand-accent">.pk</span>
        </strong>
        <small>LEARNING STUDIO</small>
      </span>
    </span>
  );
}

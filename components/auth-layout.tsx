import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Brand } from "./brand";
import { demoEnabled } from "@/lib/firebase-client";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="entry" id="main-content">
      <section className="entry-art" aria-label="About Learning Studio">
        <Link href="/" aria-label="Internee.pk Learning Studio">
          <Brand />
        </Link>
        <div className="entry-pitch">
          <span className="eyebrow">
            <Sparkles size={15} aria-hidden="true" /> YOUR STUDY WORKSPACE
          </span>
          <p>
            Make your next
            <br />
            step count.
          </p>
          <div>
            Build practical skills with a study plan that adapts as you learn.
          </div>
        </div>
        <span className="entry-caption">
          INTERN LEARNING PLATFORM {demoEnabled && " / SAMPLE ENVIRONMENT"}
        </span>
      </section>
      <section className="entry-pane">
        <div className="entry-form">{children}</div>
      </section>
    </main>
  );
}

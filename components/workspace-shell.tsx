"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { browserAuth, demoEnabled } from "@/lib/firebase-client";
import type { Workspace } from "./workspace-gate";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import { Notice } from "./ui/state";

const nav = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Study plan", href: "/plan", icon: CalendarDays },
  { label: "Modules", href: "/modules", icon: BookOpen },
];
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");

export function WorkspaceShell({
  context,
  section,
  active = section,
  sample = false,
  tutorLessonId,
  children,
}: {
  context: Workspace;
  section: string;
  active?: string;
  sample?: boolean;
  tutorLessonId?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function leave() {
    setBusy(true);
    setError("");
    try {
      await signOut(browserAuth());
      router.replace("/login");
    } catch {
      setError("Could not sign out. Try again.");
      setBusy(false);
    }
  }
  const { profile } = context;
  return (
    <div className="studio">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-top">
          <Link href="/dashboard" aria-label="Learning Studio overview">
            <Brand />
          </Link>
          <Button
            size="icon"
            variant="ghost"
            className="mobile-menu"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            aria-controls="studio-nav"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </Button>
        </div>
        <div className={`sidebar-body ${menu ? "shown" : ""}`} id="studio-nav">
          <nav aria-label="Workspace" className="nav-group">
            <span className="nav-caption">WORKSPACE</span>
            {nav.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={label === active ? "page" : undefined}
                onClick={() => setMenu(false)}
              >
                <Icon aria-hidden="true" size={18} />
                {label}
                {label === active && <span className="nav-current-dot" />}
              </Link>
            ))}
            {tutorLessonId && (
              <Link
                href={`/lesson/${tutorLessonId}#tutor`}
                onClick={() => setMenu(false)}
              >
                <Sparkles aria-hidden="true" size={18} />
                AI tutor
              </Link>
            )}
            {context.admin && (
              <Link
                href="/admin"
                aria-current={section === "Cohort admin" ? "page" : undefined}
                onClick={() => setMenu(false)}
              >
                <ShieldCheck aria-hidden="true" size={18} />
                Cohort admin
              </Link>
            )}
          </nav>
          <nav aria-label="Account" className="nav-group">
            <span className="nav-caption">ACCOUNT</span>
            <Link href="/onboarding" onClick={() => setMenu(false)}>
              <CircleUserRound aria-hidden="true" size={18} />
              Learning profile
            </Link>
          </nav>
          <div className="sidebar-footer">
            <div className="sidebar-track">
              <span className="tool-icon">
                <BookOpen size={15} aria-hidden="true" />
              </span>
              <div>
                <small>ACTIVE TRACK</small>
                <strong>{profile.track}</strong>
              </div>
            </div>
            <div className="sidebar-person">
              <span className="avatar" aria-hidden="true">
                {initials(profile.displayName)}
              </span>
              <div>
                <strong>{profile.displayName}</strong>
                <small>{profile.track}</small>
              </div>
              <Button
                aria-label="Sign out"
                title="Sign out"
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={leave}
              >
                <LogOut />
              </Button>
            </div>
          </div>
        </div>
      </aside>
      <div className="studio-main">
        <header className="topbar">
          <div className="crumb">
            <span>Workspace</span>
            <ChevronRight size={13} aria-hidden="true" />
            <strong>{section}</strong>
          </div>
          <div className="top-actions">
            {(demoEnabled || sample) && (
              <span className="sample-pill">
                <FlaskConical size={12} aria-hidden="true" />
                SAMPLE DATA
              </span>
            )}
            <Link
              className="avatar avatar-top"
              href="/onboarding"
              aria-label="Learning profile"
            >
              {initials(profile.displayName)}
            </Link>
          </div>
        </header>
        <main id="main-content" className="workspace-content">
          {error && <Notice>{error}</Notice>}
          {children}
        </main>
      </div>
    </div>
  );
}

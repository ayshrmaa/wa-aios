import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authRequired, isAuthenticated } from "../../lib/auth";
import { getTenant, source } from "../../lib/api";
import { Nav } from "./nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");
  const tenant = await getTenant();
  const brand = tenant.branding || {};
  const style = { "--brand": brand.primary || "#173f35", "--accent": brand.accent || "#d8ff73", "--surface": brand.surface || "#f2f5f3", "--ink": brand.ink || "#10231e" } as CSSProperties;
  const initials = tenant.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="shell" style={style}>
      <aside className="sidebar">
        <Link href="/" className="wordmark"><span className="wordmark-mark">{initials[0]}</span>{brand.logoText || tenant.name}</Link>
        <Nav />
        <div className="sidebar-foot">
          <span className={`status-dot ${source === "api" ? "live" : "demo"}`} />
          <span>{source === "api" ? "Live · verbunden" : "Demo · Beispieldaten"}</span>
          {authRequired ? <form action="/api/logout" method="post"><button className="link-button" type="submit">Abmelden</button></form> : null}
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

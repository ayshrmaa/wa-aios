"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Übersicht" },
  { href: "/termine", label: "Termine" },
  { href: "/anrufe", label: "Anrufe" },
  { href: "/leads", label: "Leads" },
  { href: "/bewertungen", label: "Bewertungen" },
  { href: "/nachrichten", label: "Nachrichten" }
];
export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Hauptnavigation">
      {items.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{item.label}</Link>;
      })}
    </nav>
  );
}

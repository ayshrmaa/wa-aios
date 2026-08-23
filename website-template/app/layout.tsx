import type { Metadata } from "next";
import type { ReactNode } from "react";
import tenant from "../../config/tenant.demo.json";
import "./globals.css";

export const metadata: Metadata = {
  title: `${tenant.salonName} | Digitale Rezeption`,
  description: tenant.website.hero.body
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={tenant.locale.split("-")[0]}>
      <body>{children}</body>
    </html>
  );
}

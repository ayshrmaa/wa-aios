import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-geist",
  display: "swap"
});

export const metadata: Metadata = {
  title: "AIOS — AI Receptionist Platform",
  description: "Calls, CRM, follow-ups, reactivation and analytics for your salon's AI receptionist."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}

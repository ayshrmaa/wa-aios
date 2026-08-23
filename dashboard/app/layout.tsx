import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-geist",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Salon Performance | WA AIOS",
  description: "Owner dashboard for calls, bookings, no-shows, recovery and reviews."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de-CH">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}

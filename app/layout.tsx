import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TenderPack — Tender Document Package Builder",
  description: "Prepare and check tender documents privately in your browser.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "Family Emergency File",
    template: "%s · Family Emergency File",
  },
  description:
    "A privacy-first household emergency checklist. Map accounts and access plans — never dump passwords.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

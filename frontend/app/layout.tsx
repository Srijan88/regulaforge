import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "RegulaForge",
  description: "Enterprise compliance policy compiler and enforcement engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#060e20] text-[#e2e2e6] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

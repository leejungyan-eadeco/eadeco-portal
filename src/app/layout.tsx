import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { Shell } from "./sidebar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Headings and the brand, as on eadepro.com. Body text, tables and numbers stay Inter for readability.
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-playfair" });

export const metadata: Metadata = {
  title: "EADEPRO Portal",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="font-sans antialiased">
        <Shell user={user}>{children}</Shell>
      </body>
    </html>
  );
}

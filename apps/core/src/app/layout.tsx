import { color } from "@fortitudo/tokens";
import type { Metadata, Viewport } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

// The two faces named in the tokens (font.serif, font.sans). next/font serves them from this app.
const serif = EB_Garamond({ subsets: ["latin"], variable: "--font-serif-face", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans-face", display: "swap" });

export const metadata: Metadata = {
  title: "Fortitudo",
  applicationName: "Fortitudo",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Fortitudo", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: color.base,
  colorScheme: "dark",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-base text-text antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}

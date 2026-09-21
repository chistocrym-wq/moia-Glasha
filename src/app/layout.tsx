import type { Metadata, Viewport } from "next";
import { PwaRuntime } from "@/components/PwaClient";
import "./globals.css";

export const metadata: Metadata = {
  title: "Глаша — мой личный помощник",
  description: "Личное пространство для дел, работы, планов, финансов, здоровья и всего важного.",
  applicationName: "Глаша",
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    title: "Глаша",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#5964EA",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <PwaRuntime />
        {children}
      </body>
    </html>
  );
}

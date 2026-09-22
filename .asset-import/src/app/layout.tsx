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
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Глаша",
    short_name: "Глаша",
    description: "Личный помощник для дел, работы, планов, финансов, здоровья и всего важного.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#5964EA",
    lang: "ru",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

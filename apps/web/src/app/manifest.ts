import type { MetadataRoute } from "next";

/**
 * Web app manifest (ADR 0024): "Add to home screen" opens VoiceDesk full screen, starting on
 * Today. Colours are the Aurora Glow dark background (manifests can't read CSS tokens).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "VoiceDesk",
    short_name: "VoiceDesk",
    description: "Your AI receptionist: calls, chats, bookings and messages in one place.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#070b14",
    theme_color: "#070b14",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

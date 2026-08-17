import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playlarr",
  description: "Turn music-service playlists into a local Lidarr-managed library.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Suspense fallback={<main><h1>Playlarr</h1><p>Loading your library…</p></main>}>{children}</Suspense></body>
    </html>
  );
}

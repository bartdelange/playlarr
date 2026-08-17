import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playlarr",
  description: "Turn music-service playlists into a local Lidarr-managed library.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import Link from "next/link";

export default function DashboardPage() {
  return (
    <main>
      <h1>Playlarr</h1>
      <p>Playlist imports, matching, Lidarr planning, and local-library exports.</p>
      <nav aria-label="Primary navigation">
        <Link href="/imports">Imports</Link>
        <Link href="/playlists">Playlists</Link>
        <Link href="/jobs">Jobs</Link>
        <Link href="/settings">Settings</Link>
      </nav>
    </main>
  );
}

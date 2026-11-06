'use client';

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <section aria-labelledby="dashboard-error-title" role="alert">
      <h1 id="dashboard-error-title">Dashboard unavailable</h1>
      <p>Playlarr could not load your imported playlists.</p>
      <button onClick={reset} type="button">
        Try again
      </button>
    </section>
  );
}

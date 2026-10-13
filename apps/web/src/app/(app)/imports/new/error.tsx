'use client';

export default function NewImportError({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <p>Playlarr could not load Spotify playlists.</p>
      <button onClick={reset} type="button">
        Try again
      </button>
    </div>
  );
}

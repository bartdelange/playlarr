'use client';

export default function ImportWorkspaceError({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <p>Playlarr could not load this import.</p>
      <button onClick={reset} type="button">
        Try again
      </button>
    </div>
  );
}

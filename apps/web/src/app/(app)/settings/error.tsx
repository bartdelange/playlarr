'use client';

export default function SettingsError({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <p>Playlarr could not load settings.</p>
      <button onClick={reset} type="button">
        Try again
      </button>
    </div>
  );
}

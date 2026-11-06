import { TidalAuthorizationResult } from '../tidal-settings/tidal-settings.js';

export function TidalImportUnavailable({
  authorizationResult,
}: {
  authorizationResult?: { status?: string; error?: string };
}) {
  return (
    <main>
      <h1>Import from TIDAL</h1>
      <TidalAuthorizationResult result={authorizationResult} />
      <p>TIDAL playlist importing is not available yet.</p>
      <a href="/imports/new">Choose another source</a>
    </main>
  );
}

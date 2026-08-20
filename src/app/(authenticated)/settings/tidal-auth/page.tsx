import { TidalAuthStatus } from "../../../../components/settings/tidal-auth-status";

export default async function TidalAuthenticationPage({
  searchParams,
}: {
  searchParams: Promise<{ verification_url?: string; user_code?: string }>;
}) {
  const query = await searchParams;
  const verificationUrl = tidalVerificationUrl(query.verification_url);
  const userCode = query.user_code?.trim();

  return (
    <main className="settings-page">
      <p className="eyebrow">TIDAL authentication</p>
      <h1>Connect TIDAL</h1>
      <div className="card">
        <p>
          Open TIDAL and approve this device. This page will continue
          automatically.
        </p>
        {userCode && (
          <p>
            Device code: <strong>{userCode}</strong>
          </p>
        )}
        {verificationUrl ? (
          <p>
            <a
              className="button"
              href={verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open TIDAL authentication
            </a>
          </p>
        ) : (
          <p role="alert">TIDAL did not return a valid verification URL.</p>
        )}
        <TidalAuthStatus enabled={Boolean(verificationUrl)} />
      </div>
    </main>
  );
}

function tidalVerificationUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "tidal.com" || url.hostname.endsWith(".tidal.com"))
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

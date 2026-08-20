import { TidalAuthStatus } from "../../../../components/settings/tidal-auth-status";
import { Suspense } from "react";

export default function TidalAuthenticationPage({
  searchParams,
}: {
  searchParams: Promise<{ verification_url?: string; user_code?: string }>;
}) {
  return (
    <main className="settings-page">
      <p className="eyebrow">TIDAL authentication</p>
      <h1>Connect TIDAL</h1>
      <Suspense
        fallback={
          <section className="card skeleton">
            Preparing TIDAL authentication…
          </section>
        }
      >
        <TidalAuthenticationContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function TidalAuthenticationContent({
  searchParams,
}: {
  searchParams: Promise<{ verification_url?: string; user_code?: string }>;
}) {
  const query = await searchParams;
  const verificationUrl = tidalVerificationUrl(query.verification_url);
  const userCode = query.user_code?.trim();

  return (
    <>
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
    </>
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

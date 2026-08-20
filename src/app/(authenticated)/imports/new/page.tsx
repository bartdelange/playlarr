import { queuePlaylistAcquisition } from "../../../actions/workflows";
import { requestCsrfToken } from "../../../../server/security/request";
export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const csrf = await requestCsrfToken();
  const { error } = await searchParams;
  return (
    <main>
      <p className="eyebrow">Playlist source</p>
      <h1>Add playlist</h1>
      {error && <p role="alert">{error}</p>}
      <div className="card-list">
        {["spotify", "tidal"].map((source) => (
          <section className="card" key={source}>
            <h2>{source === "spotify" ? "Spotify" : "TIDAL"}</h2>
            <p>
              Paste a playlist URL or ID. The durable worker preserves every
              ordered occurrence.
            </p>
            <form action={queuePlaylistAcquisition}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="source" value={source} />
              <label>
                Playlist URL or ID
                <input name="reference" required />
              </label>
              <button>
                Import from {source === "spotify" ? "Spotify" : "TIDAL"}
              </button>
            </form>
          </section>
        ))}
      </div>
    </main>
  );
}

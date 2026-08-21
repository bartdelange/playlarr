import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { addLocalTrack, removeLocalTrack } from "../../../../actions/exports";
import { NavidromeClient, type NavidromeSong } from "../../../../../server/integrations/navidrome/client";
import { ImportRepository } from "../../../../../server/persistence/import-repository";
import { LocalAdditionsRepository } from "../../../../../server/persistence/local-additions-repository";
import { config, database, settings } from "../../../../../server/runtime";
import { requestCsrfToken } from "../../../../../server/security/request";

export default function LocalAdditionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  return (
    <main>
      <p className="eyebrow">Export enrichment</p>
      <Suspense fallback={<LocalAdditionsSkeleton />}>
        <LocalAdditionsContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LocalAdditionsContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  await connection();
  const { id } = await params;
  const { q = "", error: requestedError } = await searchParams;
  let imported;
  try {
    imported = new ImportRepository(database).getImport(id);
  } catch {
    notFound();
  }
  const csrf = await requestCsrfToken();
  const additions = new LocalAdditionsRepository(database).list(id);
  const navidrome = {
    url: settings.get("navidrome_url", config.navidrome.url ?? ""),
    username: settings.get("navidrome_username", config.navidrome.username ?? ""),
    password: settings.get("navidrome_password", config.navidrome.password ?? ""),
  };
  const configured = Boolean(navidrome.url && navidrome.username && navidrome.password);
  let songs: NavidromeSong[] = [];
  let error = requestedError;
  if (configured && q.trim()) {
    try {
      songs = await new NavidromeClient(navidrome).searchSongs(q.trim());
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }

  return (
    <>
      <section className="playlist-context">
        <div>
          <span className="badge">{imported.source}</span>
          <h1>{imported.playlistName}</h1>
        </div>
      </section>
      <div className="step-actions">
        <div>
          <p className="eyebrow">Export enrichment</p>
          <h2>Local additions</h2>
          <p>Add Navidrome-only songs after the imported playlist tracks.</p>
        </div>
        <Link className="button secondary" href={`/imports/${id}?stage=final`}>
          Back to final
        </Link>
      </div>
      {error && <div role="alert">{error}</div>}
      {!configured ? (
        <div className="next-step">
          <strong>Navidrome is not configured.</strong>
          <span>Add its URL and credentials in Settings.</span>
        </div>
      ) : (
        <form method="get" className="card">
          <label>
            Search Navidrome
            <input name="q" defaultValue={q} placeholder="Song, artist, or album" />
          </label>
          <button>Search</button>
        </form>
      )}
      {songs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Song</th>
                <th>Album</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {songs.map((song) => (
                <tr key={song.id}>
                  <td>
                    <strong>{song.title}</strong>
                    <small>{song.artist}</small>
                  </td>
                  <td>{song.album}</td>
                  <td>
                    <form action={addLocalTrack}>
                      <input type="hidden" name="csrf_token" value={csrf} />
                      <input type="hidden" name="import_id" value={id} />
                      <input type="hidden" name="song_id" value={song.id} />
                      <button>Add</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Appended on export</p>
            <h2>{additions.length} local songs</h2>
          </div>
        </div>
        {additions.length ? (
          <ol>
            {additions.map((addition) => (
              <li key={addition.id}>
                <strong>{addition.title}</strong> — {addition.artists.join(", ")}
                {addition.album && ` · ${addition.album}`}
                <form action={removeLocalTrack} className="inline">
                  <input type="hidden" name="csrf_token" value={csrf} />
                  <input type="hidden" name="import_id" value={id} />
                  <input type="hidden" name="addition_id" value={addition.id} />
                  <button className="secondary">Remove</button>
                </form>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No local songs have been added.</p>
        )}
      </section>
    </>
  );
}

function LocalAdditionsSkeleton() {
  return <section className="card skeleton">Loading local additions…</section>;
}

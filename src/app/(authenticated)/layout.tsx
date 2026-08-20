import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout } from "../actions/security";
import { security } from "../../server/runtime";
import { sessionCookie } from "../../server/security/web-security";
import { ActiveNav } from "../../components/navigation/active-nav";
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = (await cookies()).get(sessionCookie)?.value;
  if (!security.configured) redirect("/setup");
  if (!security.authorizationEnabled && !security.validSession(session))
    redirect("/api/auth/session");
  if (!security.validSession(session)) redirect("/login");
  const csrf = security.csrfToken(session!);
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          Playlarr
        </Link>
        <ActiveNav
          label="Primary navigation"
          className="primary-nav"
          items={[
            { href: "/", label: "Playlists", exact: true },
            { href: "/imports/new", label: "New import", exact: true },
            { href: "/jobs", label: "Background jobs" },
            { href: "/settings", label: "Settings" },
          ]}
        />
        {security.authorizationEnabled && (
          <form action={logout}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <button className="link-button">Log out</button>
          </form>
        )}
      </header>
      {children}
    </>
  );
}

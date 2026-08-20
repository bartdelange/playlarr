import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { security } from "../../server/runtime";
import { login } from "../actions/security";
export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="auth-card">
      <h1>Log in</h1>
      <Suspense fallback={<p>Preparing secure login…</p>}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
async function LoginForm({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  if (!security.configured) redirect("/setup");
  const { error } = await searchParams;
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <form action={login}>
        <label>
          Password
          <input name="password" type="password" required autoFocus />
        </label>
        <button>Log in</button>
      </form>
    </>
  );
}

import { redirect } from "next/navigation";
import { authRequired, isAuthenticated } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!authRequired || (await isAuthenticated())) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="login">
      <form className="login-card" action="/api/login" method="post">
        <span className="eyebrow">AI Receptionist Platform</span>
        <h1>Sign in</h1>
        <p>This dashboard is for salon management. Enter the access password.</p>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" name="password" autoComplete="current-password" required autoFocus />
        </div>
        {error ? <p className="form-error">That password is not correct.</p> : null}
        <button className="btn primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}

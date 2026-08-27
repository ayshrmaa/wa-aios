import { redirect } from "next/navigation";
import { authRequired, isAuthenticated } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!authRequired || (await isAuthenticated())) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="login">
      <form className="login-card" action="/api/login" method="post">
        <span className="label">Salon Performance</span>
        <h1>Anmelden</h1>
        <p>Das Dashboard ist nur für die Salonleitung. Bitte Passwort eingeben.</p>
        <label>Passwort<input type="password" name="password" autoComplete="current-password" required autoFocus /></label>
        {error ? <p className="form-error">Passwort ist nicht korrekt.</p> : null}
        <button className="button-primary" type="submit">Anmelden</button>
      </form>
    </main>
  );
}

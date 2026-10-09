import Link from "next/link";

export function Shell({
  children,
  signedIn = false,
}: {
  children?: React.ReactNode;
  signedIn?: boolean;
}) {
  return (
    <div className="shell">
      <header className="shell-header">
        <Link href={signedIn ? "/app" : "/"} className="wordmark">
          Family Emergency File
        </Link>
        <nav className="nav" aria-label="Primary">
          {signedIn ? (
            <>
              <Link href="/app">Dashboard</Link>
              <Link href="/app/export">Export</Link>
              <Link href="/app/settings">Settings</Link>
            </>
          ) : (
            <Link href="/sign-in">Sign in</Link>
          )}
        </nav>
      </header>
      <main className="shell-main">{children}</main>
      <footer className="shell-footer">
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <p>
          Not legal advice. Not a password manager. Store access plans and
          locations — never passwords here.
        </p>
      </footer>
    </div>
  );
}

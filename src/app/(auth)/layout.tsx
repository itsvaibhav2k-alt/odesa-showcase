import Link from 'next/link';

import './auth.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-site">
      <header className="auth-masthead">
        <Link className="auth-brand" href="/" aria-label="Odesa home">odesa</Link>
        <nav className="auth-nav" aria-label="Primary">
          <Link href="/work">Work</Link>
          <Link href="/method">Method</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/owners">Owners</Link>
          <Link href="/pilot">Pilot</Link>
        </nav>
        <div className="auth-masthead__right">
          <Link href="/">Back to the gallery</Link>
          <Link className="auth-masthead__cta" href="/pilot">Request access</Link>
        </div>
      </header>

      <main className="auth-grid">
        <section className="auth-gallery" aria-label="Odesa night garden">
          <div className="auth-gallery__art" aria-hidden="true" />
          <div className="auth-gallery__wash" aria-hidden="true" />
          <span className="auth-gallery__label">Claude Monet · Water Lilies · public domain</span>
          <div className="auth-gallery__copy">
            <span className="auth-gallery__kicker">The night watch · Members entrance</span>
            <h1>The building sleeps.<br /><em>Odesa doesn&apos;t.</em></h1>
            <p>Your portfolio&apos;s calls, rent, maintenance, and owner decisions remain quietly observed.</p>
          </div>
        </section>
        <section className="auth-workspace">
          <div className="auth-workspace__inner">
            <div className="auth-workspace__label">Private operator desk</div>
            {children}
          </div>
        </section>
      </main>
    </div>
  );
}

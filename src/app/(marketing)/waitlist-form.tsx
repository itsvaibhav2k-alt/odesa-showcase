'use client';

/**
 * WaitlistForm — the final CTA form. POSTs { email, unitCount, source }
 * to /api/waitlist (the existing public endpoint) and swaps to a success
 * state on a successful insert/upsert. No fake submission claims.
 */

import { useState } from 'react';
import { c } from './cx';

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [doors, setDoors] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || loading) return;
    setLoading(true);
    setError('');

    const parsedDoors = Number.parseInt(doors, 10);
    const unitCount =
      Number.isFinite(parsedDoors) && parsedDoors > 0 ? parsedDoors : undefined;

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, unitCount, source: 'landing-v3' }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubmitted(true);
      } else {
        setError(data.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <p className={c('cta__success')} role="status">
        You&apos;re on the list — we&apos;ll be in touch.
      </p>
    );
  }

  return (
    <>
      <form className={c('form')} onSubmit={handleSubmit}>
        <input
          className={c('input')}
          type="email"
          placeholder="you@portfolio.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={c('input input--narrow')}
          type="number"
          min={1}
          placeholder="Doors"
          aria-label="Number of doors"
          value={doors}
          onChange={(e) => setDoors(e.target.value)}
        />
        <button className={c('btn btn--primary btn--lg')} type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Request access'}
        </button>
      </form>
      {error && <p className={c('cta__error')}>{error}</p>}
    </>
  );
}

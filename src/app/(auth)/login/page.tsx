'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod/v4';
import { createBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { AuthPanel, FormField } from '@/components/shared';

const loginSchema = z.object({
  email: z.email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const DEFAULT_NEXT = '/';

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_NEXT;
  // Browsers normalize backslashes in URLs, so accepting them can turn an
  // apparently relative path into a scheme-relative redirect.
  if (raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) {
    return DEFAULT_NEXT;
  }
  try {
    const base = new URL('https://odesa.invalid');
    const parsed = new URL(raw, base);
    if (parsed.origin !== base.origin) return DEFAULT_NEXT;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

function requestedNextPath(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // /auth/callback redirects here with ?error=auth_callback when the
  // PKCE exchange fails; window.location keeps the page out of the
  // useSearchParams Suspense requirement. One post-mount setState is
  // the hydration-safe way to surface it (the SSR pass has no query
  // string), so the cascading-render lint rule is intentionally waived.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'auth_callback') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Sign-in could not be completed. Please try again.');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setLoading(true);
    const supabase = createBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Invite links survive password sign-in, while malformed/external values
    // fail closed to the capability-aware root landing.
    router.push(requestedNextPath());
    router.refresh();
  }

  async function handleGoogleSignIn() {
    const supabase = createBrowserClient();
    // PKCE: Google bounces back with a one-time ?code= that only the
    // /auth/callback route handler can exchange for a session cookie —
    // redirecting straight to /today would land logged-out.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          requestedNextPath(),
        )}`,
      },
    });
    if (oauthError) setError(oauthError.message);
  }

  return (
    <AuthPanel
      eyebrow="Welcome back"
      title="Sign in"
      description="Sign in to your Odesa workspace."
      footer={
        <>
          Looking for access?{' '}
          <Link href="/pilot#access" className="underline underline-offset-4">
            Request a guided pilot
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} data-testid="login-form" className="flex flex-col gap-5">
        {error && (
          <p className="text-sm text-destructive" data-testid="login-error">
            {error}
          </p>
        )}
        <FormField label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="login-email"
          />
        </FormField>
        <FormField label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            data-testid="login-password"
          />
        </FormField>
        <Button
          type="submit"
          className="w-full"
          disabled={loading}
          data-testid="login-submit"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignIn}
          data-testid="login-google"
        >
          Sign in with Google
        </Button>
      </form>
    </AuthPanel>
  );
}

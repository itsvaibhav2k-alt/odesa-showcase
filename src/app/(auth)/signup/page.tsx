"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod/v4";
import { createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthPanel, FormField } from "@/components/shared";

const signupSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  organizationName: z.string().min(1, "Organization name is required"),
});
const inviteSignupSchema = signupSchema.omit({ organizationName: true });
const INVITE_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

type InviteMode =
  | { kind: "none" }
  | { kind: "valid"; token: string }
  | { kind: "invalid" };

function inviteModeFromSearch(search: string): InviteMode {
  const params = new URLSearchParams(search);
  if (!params.has("invite")) return { kind: "none" };
  const token = params.get("invite") ?? "";
  return INVITE_TOKEN_PATTERN.test(token)
    ? { kind: "valid", token }
    : { kind: "invalid" };
}

function invitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);
  const [inviteMode, setInviteMode] = useState<InviteMode>({ kind: "none" });

  useEffect(() => {
    // The invite URL carries only the opaque token. Invitation email, role,
    // organization, and scope remain unreadable until the database claim.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInviteMode(inviteModeFromSearch(window.location.search));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Read directly at the action boundary so a click during initial hydration
    // cannot accidentally fall through to self-serve organization creation.
    const currentInviteMode = inviteModeFromSearch(window.location.search);
    if (currentInviteMode.kind === "invalid") {
      setError("This invitation link is invalid. Ask the owner for a new one.");
      return;
    }

    const result = (
      currentInviteMode.kind === "valid" ? inviteSignupSchema : signupSchema
    ).safeParse({
      fullName,
      email,
      password,
      organizationName,
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setLoading(true);
    const destination =
      currentInviteMode.kind === "valid"
        ? invitePath(currentInviteMode.token)
        : "/onboarding";
    const supabase = createBrowserClient();
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(currentInviteMode.kind === "valid"
            ? {}
            : { organization_name: organizationName }),
        },
        // Confirmation links must land on the PKCE exchange route for this
        // deployment. Invite mode preserves only the opaque token and returns
        // to the explicit database-authoritative claim page.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          destination,
        )}`,
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Email confirmation is required on hosted projects: signUp can succeed
    // without a session. Do not route into a protected page until confirmed.
    if (!data.session) {
      setConfirmEmailSent(true);
      setLoading(false);
      return;
    }

    router.push(destination);
    router.refresh();
  }

  return (
    <AuthPanel
      eyebrow={inviteMode.kind === "none" ? "Get started" : "Odesa invitation"}
      title="Create your account"
      description={
        inviteMode.kind === "none"
          ? "Set up your Odesa workspace in under a minute."
          : "Create your account, then explicitly accept your invitation."
      }
      footer={
        <>
          Have an account?{" "}
          <Link
            href={
              inviteMode.kind === "valid"
                ? `/login?next=${encodeURIComponent(invitePath(inviteMode.token))}`
                : "/login"
            }
            className="underline underline-offset-4"
          >
            Sign in
          </Link>
        </>
      }
    >
      {confirmEmailSent ? (
        <div className="flex flex-col gap-2" data-testid="signup-confirm-sent">
          <p className="text-sm font-medium">Check your email</p>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to {email}. Open it to finish creating
            your account. It will return you to{" "}
            {inviteMode.kind === "valid" ? "the invitation" : "onboarding"}.
          </p>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          data-testid="signup-form"
          className="flex flex-col gap-5"
        >
          {(error || inviteMode.kind === "invalid") && (
            <p className="text-sm text-destructive" data-testid="signup-error">
              {error ||
                "This invitation link is invalid. Ask the owner for a new one."}
            </p>
          )}
          <FormField label="Full name" htmlFor="fullName">
            <Input
              id="fullName"
              type="text"
              placeholder="Jane Smith"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              data-testid="signup-fullname"
            />
          </FormField>
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="signup-email"
            />
          </FormField>
          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              placeholder="Min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              data-testid="signup-password"
            />
          </FormField>
          {inviteMode.kind === "none" ? (
            <FormField label="Organization name" htmlFor="organizationName">
              <Input
                id="organizationName"
                type="text"
                placeholder="Galaxy Estates"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
                data-testid="signup-organization"
              />
            </FormField>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={loading || inviteMode.kind === "invalid"}
            data-testid="signup-submit"
          >
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>
      )}
    </AuthPanel>
  );
}

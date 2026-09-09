import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";

const OUTCOMES: Record<
  string,
  { title: string; body: string; enter?: boolean; retry?: boolean }
> = {
  claimed: {
    title: "You're in.",
    body: "Your role and property assignment are active.",
    enter: true,
  },
  already_member: {
    title: "You already have access.",
    body: "This invitation targets an organization you already belong to.",
    enter: true,
  },
  invalid: {
    title: "This invite link isn't valid.",
    body: "Ask the owner to create a new link.",
  },
  expired: {
    title: "This invite link has expired.",
    body: "Invite links expire after seven days. Ask the owner for a new one.",
  },
  revoked: {
    title: "This invite link was revoked.",
    body: "Nothing changed. Ask the owner for a new link.",
  },
  email_mismatch: {
    title: "This invitation belongs to a different email address.",
    body: "Sign in with the invited address and reopen this link. It has not been consumed.",
    retry: true,
  },
  email_unverified: {
    title: "Confirm your email first.",
    body: "Confirm the invited address, then reopen this link. It has not been consumed.",
    retry: true,
  },
  switching_unavailable: {
    title: "Organization switching is unavailable.",
    body: "Your account already has another active membership. Nothing changed and this invitation remains unused.",
  },
  failed: {
    title: "We couldn't process this invite.",
    body: "Try again in a moment.",
    retry: true,
  },
};

function statusOf(value: Json | null): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "failed";
  return typeof value.status === "string" ? value.status : "failed";
}

export default async function InviteClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { token } = await params;
  const status = (await searchParams).status;
  // Query parameters are not proof that a claim succeeded. Successful claims
  // go straight through the capability-aware root; only failure outcomes are
  // rendered from the URL.
  const requestedOutcome =
    status && status !== "claimed" && status !== "already_member"
      ? (OUTCOMES[status] ?? OUTCOMES.failed)
      : null;
  const invitePath = `/invite/${encodeURIComponent(token)}`;
  const loginPath = `/login?next=${encodeURIComponent(invitePath)}`;

  async function claim() {
    "use server";
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc(
      "claim_organization_invitation",
      { p_token: token },
    );
    const claimStatus = error ? "failed" : statusOf(data);
    if (claimStatus === "claimed" || claimStatus === "already_member") {
      redirect("/");
    }
    redirect(`${invitePath}?status=${claimStatus}`);
  }

  async function switchAccount() {
    "use server";
    const supabase = await createServerClient();
    await supabase.auth.signOut();
    redirect(loginPath);
  }

  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser();
  const outcome = user ? requestedOutcome : null;

  return (
    <main
      data-testid="invite-claim-page"
      className="flex min-h-dvh items-center justify-center p-6"
      style={{ background: "var(--paper-50, #faf7ef)" }}
    >
      <section
        className="grid w-full max-w-md gap-4 rounded-xl p-7"
        style={{
          border: "1px solid var(--ink-200, #e5ded0)",
          background: "var(--paper-0, #fffdf8)",
        }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          Odesa invitation
        </span>
        {outcome ? (
          <div data-testid="invite-claim-outcome" data-status={status}>
            <h1 className="font-serif-display text-3xl">{outcome.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {outcome.body}
            </p>
          </div>
        ) : (
          <div>
            <h1 className="font-serif-display text-3xl">
              Join this Odesa workspace.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {user?.email
                ? `You are signed in as ${user.email}. The invitation only works for its exact verified address.`
                : "Use the exact invited email. Invitation details stay private until you create an account or sign in and explicitly accept."}
            </p>
          </div>
        )}

        {outcome?.enter ? (
          <Link
            href="/"
            data-testid="invite-claim-enter"
            className="w-fit rounded-md bg-[var(--navy-700)] px-4 py-2 text-sm font-medium text-white"
          >
            Enter Odesa
          </Link>
        ) : null}
        {user && (!outcome || outcome.retry) ? (
          <form action={claim}>
            <button
              type="submit"
              data-testid="invite-claim-submit"
              className="rounded-md bg-[var(--navy-700)] px-4 py-2 text-sm font-medium text-white"
            >
              Accept invitation
            </button>
          </form>
        ) : null}
        {!user ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href={`/login?next=${encodeURIComponent(invitePath)}`}
              data-testid="invite-sign-in"
              className="rounded-md bg-[var(--navy-700)] px-4 py-2 text-center text-sm font-medium text-white"
            >
              Sign in
            </Link>
            <Link
              href={`/signup?invite=${encodeURIComponent(token)}`}
              data-testid="invite-create-account"
              className="rounded-md border border-[var(--ink-200)] px-4 py-2 text-center text-sm font-medium"
            >
              Create account
            </Link>
          </div>
        ) : null}
        {user && outcome?.retry ? (
          <form action={switchAccount}>
            <button
              type="submit"
              data-testid="invite-switch-account"
              className="text-sm underline underline-offset-4"
            >
              Sign out and use a different account
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

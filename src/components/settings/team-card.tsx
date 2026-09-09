"use client";

import { Check, Copy, Mail, X } from "lucide-react";
import { useState, useTransition } from "react";

import {
  createInvitationAction,
  revokeInvitationAction,
  type PendingInvitation,
  type TeamInviteState,
} from "@/app/(dashboard)/settings/actions";
import type { UserRole } from "@/types/database";

interface TeamMember {
  id: string;
  fullName: string | null;
  email: string | null;
  role: UserRole;
}

interface TeamCardProps {
  members: TeamMember[];
  initialInviteState: TeamInviteState;
  initialError: string | null;
}

const INVITE_ROLES: readonly UserRole[] = [
  "owner",
  "manager",
  "accountant",
  "va",
];

function roleLabel(role: UserRole): string {
  if (role === "owner") return "Owner";
  if (role === "manager") return "Property manager";
  if (role === "accountant") return "Accountant";
  return "Operations assistant";
}

function initials(member: TeamMember): string {
  const parts = (member.fullName ?? member.email ?? "?").trim().split(/\s+/);
  return parts
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function expiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "Expiry unavailable";
  if (date.valueOf() <= Date.now()) return "Expired";
  return `Expires ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function scopeLabel(
  invitation: PendingInvitation,
  properties: TeamInviteState["properties"],
): string {
  if (invitation.allProperties) return "All current and future properties";
  if (invitation.propertyIds.length === 0) return "No properties assigned";
  const names = new Map(
    properties.map((property) => [property.id, property.name]),
  );
  return invitation.propertyIds
    .map((id) => names.get(id) ?? "Assigned property")
    .join(", ");
}

const fieldStyle = {
  minHeight: 34,
  border: "1px solid var(--ink-200)",
  borderRadius: 6,
  background: "var(--paper-0)",
  color: "var(--ink-800)",
  fontSize: 13,
  padding: "6px 9px",
} as const;

export function TeamCard({
  members,
  initialInviteState,
  initialError,
}: TeamCardProps) {
  const { canInvite, properties } = initialInviteState;
  const [invitations, setInvitations] = useState(
    initialInviteState.invitations,
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("accountant");
  const [allProperties, setAllProperties] = useState(false);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [created, setCreated] = useState<{ url: string; email: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();

  function toggleProperty(id: string) {
    setPropertyIds((current) =>
      current.includes(id)
        ? current.filter((propertyId) => propertyId !== id)
        : [...current, id].sort(),
    );
  }

  function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCopied(false);
    const address = email.trim();
    startTransition(async () => {
      const result = await createInvitationAction({
        email: address,
        role,
        allProperties: role === "owner" || allProperties,
        propertyIds,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setInvitations((current) => [result.data.invitation, ...current]);
      setCreated({
        email: address,
        url: `${window.location.origin}${result.data.path}`,
      });
      setEmail("");
    });
  }

  function revoke(id: string) {
    const before = invitations;
    setError(null);
    setInvitations((current) => current.filter((row) => row.id !== id));
    startTransition(async () => {
      const result = await revokeInvitationAction({ id });
      if (!result.success) {
        setInvitations(before);
        setError(result.error);
      }
    });
  }

  return (
    <section
      data-testid="settings-team-section"
      style={{
        overflow: "hidden",
        border: "1px solid var(--ink-200)",
        borderRadius: "var(--radius-lg-odesa)",
        background: "var(--paper-0)",
      }}
    >
      <ul data-testid="settings-team-list">
        {members.map((member) => (
          <li
            key={member.id}
            data-testid={`settings-team-member-${member.id}`}
            className="flex items-center justify-between gap-4"
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--ink-200)",
            }}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--paper-200)", fontSize: 11 }}
              >
                {initials(member)}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm">
                  {member.fullName ?? member.email ?? "Unnamed member"}
                </strong>
                {member.email ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                ) : null}
              </span>
            </span>
            <span
              data-testid={`settings-team-member-role-${member.id}`}
              data-role={member.role}
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: "var(--paper-200)",
                color: "var(--navy-700)",
              }}
            >
              {roleLabel(member.role)}
            </span>
          </li>
        ))}
      </ul>

      {invitations.length > 0 ? (
        <ul data-testid="settings-team-invitations">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              data-testid={`settings-team-invitation-${invitation.id}`}
              className="flex items-start justify-between gap-4"
              style={{
                padding: "12px 20px",
                borderBottom: "1px solid var(--ink-200)",
                background: "var(--paper-50)",
              }}
            >
              <span className="text-xs leading-relaxed">
                <strong className="block">{invitation.email}</strong>
                <span className="block text-muted-foreground">
                  Pending {roleLabel(invitation.role)} ·{" "}
                  {expiry(invitation.expiresAt)}
                </span>
                <span
                  data-testid={`settings-team-invitation-scope-${invitation.id}`}
                  className="block text-muted-foreground"
                >
                  {scopeLabel(invitation, properties)}
                </span>
              </span>
              {canInvite ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => revoke(invitation.id)}
                  data-testid={`settings-team-invitation-revoke-${invitation.id}`}
                  className="inline-flex items-center gap-1 text-xs"
                >
                  <X className="size-3.5" aria-hidden /> Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        data-testid="settings-team-invite-form"
        style={{ padding: "16px 20px", background: "var(--paper-50)" }}
      >
        {canInvite ? (
          <form onSubmit={create} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Mail className="mt-2 hidden size-4 sm:block" aria-hidden />
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Invite by email"
                aria-label="Invite by email"
                data-testid="settings-team-invite-email"
                className="flex-1"
                style={fieldStyle}
              />
              <select
                value={role}
                aria-label="Invited role"
                data-testid="settings-team-invite-role"
                onChange={(event) => {
                  const next = event.target.value as UserRole;
                  setRole(next);
                  if (next === "owner") {
                    setAllProperties(true);
                    setPropertyIds([]);
                  } else if (role === "owner") {
                    setAllProperties(false);
                  }
                }}
                style={fieldStyle}
              >
                {INVITE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={pending || !email.trim()}
                data-testid="settings-team-invite-submit"
                className="rounded-md px-3 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--navy-700)", minHeight: 34 }}
              >
                {pending ? "Working…" : "Create invite link"}
              </button>
            </div>

            <fieldset
              data-testid="settings-team-invite-scope"
              className="grid gap-2 rounded-md p-3 text-xs"
              style={{ border: "1px solid var(--ink-200)" }}
            >
              <legend className="px-1 font-medium">Property access</legend>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={role === "owner" || allProperties}
                  disabled={role === "owner"}
                  data-testid="settings-team-invite-all-properties"
                  onChange={(event) => {
                    setAllProperties(event.target.checked);
                    if (event.target.checked) setPropertyIds([]);
                  }}
                />
                All current and future properties
              </label>
              {role !== "owner" && !allProperties ? (
                properties.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {properties.map((property) => (
                      <label
                        key={property.id}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          checked={propertyIds.includes(property.id)}
                          onChange={() => toggleProperty(property.id)}
                          data-testid={`settings-team-invite-property-${property.id}`}
                        />
                        {property.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <span>No active properties are available to assign.</span>
                )
              ) : null}
              {role !== "owner" &&
              !allProperties &&
              propertyIds.length === 0 ? (
                <span className="text-muted-foreground">
                  This invitation starts with zero property access.
                </span>
              ) : null}
            </fieldset>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only the owner can invite teammates.
          </p>
        )}

        {created ? (
          <div
            data-testid="settings-team-invite-link-panel"
            className="mt-3 grid gap-2 rounded-md p-3"
            style={{
              border: "1px solid var(--ink-200)",
              background: "var(--paper-0)",
            }}
          >
            <strong className="text-xs">Invite link for {created.email}</strong>
            <div className="flex gap-2">
              <input
                readOnly
                value={created.url}
                aria-label="Invite link"
                data-testid="settings-team-invite-link"
                className="min-w-0 flex-1 font-mono"
                style={fieldStyle}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                data-testid="settings-team-invite-copy"
                className="inline-flex items-center gap-1 text-xs"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(created.url)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              No email is sent. This raw link is shown once; Odesa stores only
              its hash. Deliver it yourself or revoke it if it is lost.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { DashboardShell } from '@/components/shared/dashboard-shell';
import { Sidebar } from '@/components/shared/sidebar';
import { TopBar } from '@/components/shared/top-bar';
import type { SidebarOrg, SidebarUser } from '@/components/shared/sidebar';
import { requiredCapabilityForRoute } from '@/lib/authz/access-policy';
import {
  requireAccessContext,
  type AccessContextResult,
} from '@/lib/authz/context';
import { getNavCounts, type NavCounts } from '@/lib/shell/nav-counts';
import { createServerClient } from '@/lib/supabase/server';

interface SidebarContext {
  access: AccessContextResult;
  counts: NavCounts;
  user: SidebarUser | null;
  org: SidebarOrg | null;
}

function emptyCounts(propertyCount = 0): NavCounts {
  return {
    todayUrgent: 0,
    inboxDraftsAwaitingReview: 0,
    ownerReview: 0,
    properties: propertyCount,
    tenants: 0,
    vendors: 0,
    rentMonthLabel: new Date().toLocaleString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    }),
  };
}

function initials(fullName: string): string {
  return (
    fullName
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'U'
  );
}

function accountantIdentity(value: unknown): {
  fullName: string;
  organizationName: string;
  propertyCount: number;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.full_name !== 'string' ||
    row.full_name.trim().length === 0 ||
    typeof row.organization_name !== 'string' ||
    row.organization_name.trim().length === 0 ||
    typeof row.property_count !== 'number' ||
    !Number.isSafeInteger(row.property_count) ||
    row.property_count < 0
  ) {
    return null;
  }
  return {
    fullName: row.full_name.trim(),
    organizationName: row.organization_name.trim(),
    propertyCount: row.property_count,
  };
}

/**
 * Resolve shell identity once per request. Accountant takes a projection-only
 * branch before any legacy count or `users`/organization read can run.
 */
async function fetchSidebarContext(pathname: string): Promise<SidebarContext> {
  const supabase = await createServerClient();
  const access = await requireAccessContext({ auth: supabase, db: supabase });
  if (!access.ok) {
    return { access, counts: emptyCounts(), user: null, org: null };
  }

  const { context } = access;
  if (context.role === 'accountant') {
    const capability = requiredCapabilityForRoute(pathname);
    if (!capability || !context.capabilities.has(capability)) {
      return {
        access: { ok: false, status: 403, error: 'Forbidden' },
        counts: emptyCounts(),
        user: null,
        org: null,
      };
    }

    const { data, error } = await supabase.rpc('accountant_identity_context');
    const identity = error ? null : accountantIdentity(data);
    if (!identity) {
      return {
        access: { ok: false, status: 403, error: 'Forbidden' },
        counts: emptyCounts(),
        user: null,
        org: null,
      };
    }

    return {
      access,
      counts: emptyCounts(identity.propertyCount),
      user: {
        id: context.userId,
        fullName: identity.fullName,
        email: '',
        avatarUrl: null,
        initials: initials(identity.fullName),
        role: 'accountant',
        capabilities: [...context.capabilities].sort(),
      },
      org: {
        id: context.organizationId,
        name: identity.organizationName,
        propertyCount: identity.propertyCount,
      },
    };
  }

  // Preserve the shipped Owner/Manager/VA shell. The compatibility `users`
  // view is intentionally narrow and routes these reads to profiles plus the
  // caller's one active membership.
  const counts = await getNavCounts(supabase);
  const { data: dbUser } = await supabase
    .from('users')
    .select('id, email, full_name, avatar_url, organization_id, role')
    .eq('id', context.userId)
    .maybeSingle();

  if (!dbUser) return { access, counts, user: null, org: null };

  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', context.organizationId)
    .maybeSingle();
  const fullName = dbUser.full_name?.trim() || dbUser.email || 'User';

  return {
    access,
    counts,
    user: {
      id: dbUser.id,
      fullName,
      email: dbUser.email ?? '',
      avatarUrl: dbUser.avatar_url,
      initials: initials(fullName),
      role: context.role,
      capabilities: [...context.capabilities].sort(),
    },
    org: organization
      ? {
          id: organization.id,
          name: organization.name,
          propertyCount: counts.properties,
        }
      : null,
  };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get('x-pathname') ?? '';
  const { access, counts, user, org } = await fetchSidebarContext(pathname);
  if (!access.ok) {
    if (access.status === 401) redirect('/login');
    notFound();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[200px] shrink-0 lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar counts={counts} user={user} org={org} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar counts={counts} user={user} org={org} />
        <DashboardShell>
          <main data-testid="dashboard-main" className="min-w-0 flex-1">
            {children}
          </main>
        </DashboardShell>
      </div>
    </div>
  );
}

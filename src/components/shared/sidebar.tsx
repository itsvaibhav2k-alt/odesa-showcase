'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  DollarSign,
  FileText,
  Inbox,
  LogOut,
  MessageCircle,
  Phone,
  Settings as SettingsIcon,
  Sun,
  User as UserIcon,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createBrowserClient } from '@/lib/supabase/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { NavCounts } from '@/lib/shell/nav-counts';
import type { UserRole } from '@/types/database';
import {
  capabilitiesFor,
  landingRouteForAccess,
  type Capability,
} from '@/lib/authz/access-policy';

export interface SidebarUser {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
  role: UserRole;
  /** Exact effective capabilities; populated for projection-only personas. */
  capabilities?: readonly string[];
}

export interface SidebarOrg {
  id: string;
  name: string;
  propertyCount: number;
}

interface SidebarProps {
  counts: NavCounts;
  user: SidebarUser | null;
  org: SidebarOrg | null;
  /** Called when a nav link is clicked. Mobile Sheet uses this to close itself. */
  onNavigate?: () => void;
}

interface NavLinkSpec {
  href: string;
  label: string;
  /** Muted per-route lucide glyph rendered left of the label. */
  icon?: LucideIcon;
  /** Count value to render at right-aligned mono badge. */
  count?: number | string;
  /**
   * Scope word(s) for the count badge's accessible label, e.g. 'open' or
   * 'pending owner decisions'. When set, the badge announces
   * `${count} ${countScope}` so screen readers hear what the numeral
   * measures (the link label already carries the surface name). Omitted
   * for self-evident totals (Properties, Tenants, …).
   */
  countScope?: string;
  /** Route exists today? If false → render disabled (coming soon). */
  comingSoon?: boolean;
  /**
   * Active matching strategy. By default the link is active when
   * `pathname` equals `href` or starts with `${href}/`. For query-only
   * variants (e.g. `/inbox?filter=owner_review`) we need exact match on
   * both pathname and search string.
   */
  matchSearch?: string;
}

export function Sidebar({ counts, user, org, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const [currentHash, setCurrentHash] = useState('');
  const isOwner = user?.role === 'owner';
  const isManager = user?.role === 'manager';
  const isVa = user?.role === 'va';
  const isAccountant = user?.role === 'accountant';
  const defaultCapabilities = capabilitiesFor(user?.role);
  const can = (capability: Capability) =>
    user?.capabilities
      ? user.capabilities.includes(capability)
      : defaultCapabilities.has(capability);
  const homeHref =
    landingRouteForAccess(user?.role, user?.capabilities ?? []) ?? '/today';

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash);
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [pathname]);

  const ownerLinks: NavLinkSpec[] = [
    {
      href: '/today',
      label: 'Today',
      icon: Sun,
      count: counts.todayUrgent,
      countScope: 'operational items summarized today',
    },
    { href: '/assistant', label: 'Ask Odesa', icon: MessageCircle },
    {
      href: '/owner-queue',
      label: 'Owner Queue',
      icon: ClipboardCheck,
      count: counts.ownerReview,
      countScope: 'pending owner decisions',
    },
    {
      href: '/inbox',
      label: 'Inbox',
      icon: Inbox,
      count: counts.inboxDraftsAwaitingReview,
      countScope: 'drafts awaiting review',
    },
    { href: '/calls', label: 'Calls', icon: Phone },
    {
      href: '/properties',
      label: 'Properties',
      icon: Building2,
      count: counts.properties,
    },
    {
      href: '/rent',
      label: 'Rent',
      icon: DollarSign,
      count: counts.rentMonthLabel,
    },
    { href: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  const managerOperatorLinkCandidates: Array<NavLinkSpec | null> = [
    can('view_dashboard') ? { href: '/today', label: 'Today', icon: Sun } : null,
    can('view_inbox') ? { href: '/inbox', label: 'Inbox', icon: Inbox } : null,
    can('view_calls') ? { href: '/calls', label: 'Calls', icon: Phone } : null,
    can('view_properties')
      ? { href: '/properties', label: 'Properties', icon: Building2, count: counts.properties }
      : null,
    can('view_rent')
      ? { href: '/rent', label: 'Rent', icon: DollarSign, count: counts.rentMonthLabel }
      : null,
    can('view_settings')
      ? { href: '/settings', label: 'Settings', icon: SettingsIcon }
      : null,
  ];
  const managerOperatorLinks = managerOperatorLinkCandidates.filter(
    (link): link is NavLinkSpec => link !== null,
  );

  const operatorLinks: NavLinkSpec[] = isOwner
    ? ownerLinks
    : isManager
      ? managerOperatorLinks
      : isVa
        ? [
        {
          href: '/today',
          label: 'My shift',
          icon: Sun,
          // The VA shell has one workload numeral: the canonical queue
          // rendered on Today. Inbox and escalation links remain unbadged so
          // one org-wide item cannot masquerade as several separate fires.
          count: counts.todayUrgent,
          countScope: 'items needing attention',
        },
        { href: '/inbox', label: 'Work inbox', icon: Inbox },
        { href: '/calls', label: 'Calls', icon: Phone },
        {
          href: '/escalations',
          label: 'Escalations',
          icon: ClipboardCheck,
        },
          ]
        : isAccountant
          ? can('view_dashboard')
            ? [
                {
                  href: '/today',
                  label: 'Reconciliation',
                  icon: ClipboardCheck,
                },
              ]
            : []
          : [];

  const managerContextLinkCandidates: Array<NavLinkSpec | null> = [
    can('view_tenants')
      ? { href: '/tenants', label: 'Tenants', icon: Users, count: counts.tenants }
      : null,
    can('view_vendors')
      ? { href: '/vendors', label: 'Vendors', icon: Wrench, count: counts.vendors }
      : null,
    can('view_documents')
      ? { href: '/documents', label: 'Documents', icon: FileText }
      : null,
  ];
  const managerContextLinks = managerContextLinkCandidates.filter(
    (link): link is NavLinkSpec => link !== null,
  );

  const vaContextLinks: NavLinkSpec[] = [
    {
      href: '/properties',
      label: 'Properties',
      icon: Building2,
      count: counts.properties,
    },
    { href: '/tenants', label: 'Tenants', icon: Users, count: counts.tenants },
    { href: '/vendors', label: 'Vendors', icon: Wrench, count: counts.vendors },
    { href: '/documents', label: 'Documents', icon: FileText },
  ];

  const accountantLinkCandidates: Array<NavLinkSpec | null> = [
    can('view_rent')
      ? {
          href: '/rent',
          label: 'Rent',
          icon: DollarSign,
          count: counts.rentMonthLabel,
        }
      : null,
    can('view_financials')
      ? { href: '/financials', label: 'Financials', icon: BarChart3 }
      : null,
    can('view_documents')
      ? { href: '/documents', label: 'Documents', icon: FileText }
      : null,
  ];
  const accountantLinks = accountantLinkCandidates.filter(
    (link): link is NavLinkSpec => link !== null,
  );

  return (
    // Rendered as a plain `<div>` because the dashboard layout already
    // wraps this in an `<aside>` landmark (mobile Sheet does too). A
    // nested `<aside>` here would trigger axe
    // `landmark-complementary-is-top-level`.
    <div
      data-testid="sidebar"
      className="flex h-full flex-col bg-canvas border-r border-hairline-strong"
      style={
        {
          // Local scope for warm-operator ink scale (only defined under
          // .today-theme globally; we re-declare here so the sidebar can
          // use the same names without polluting :root).
          '--sidebar-ink': '#1B1712',
          '--sidebar-ink-2': '#56493A',
          '--sidebar-ink-3': '#87796A',
          '--sidebar-hairline': '#E0D6BE',
          padding: '22px 14px 18px',
        } as React.CSSProperties
      }
    >
      <Link
        href={homeHref}
        onClick={onNavigate}
        className="font-serif-display italic text-[22px] leading-none"
        style={{
          color: 'var(--sidebar-ink)',
          padding: '0 6px 22px',
          fontFamily: 'var(--font-serif-display)',
        }}
      >
        odesa
      </Link>

      <div
        aria-hidden
        style={{
          height: '1px',
          background: 'var(--sidebar-hairline)',
          margin: '0 0 16px',
        }}
      />

      <nav
        className="flex flex-1 flex-col gap-5 overflow-y-auto"
        aria-label="Primary"
      >
        {operatorLinks.length > 0 ? (
          <NavSection eyebrow={isVa ? 'Shift' : isAccountant ? 'Close' : isManager ? 'Operations' : 'Owner'}>
            {operatorLinks.map((link) => (
              <NavLink
                key={link.href + (link.matchSearch ?? '')}
                link={link}
                pathname={pathname}
                currentHash={currentHash}
                onNavigate={onNavigate}
              />
            ))}
          </NavSection>
        ) : null}

        {(isVa || isManager || isAccountant) &&
        (isVa ? vaContextLinks : isManager ? managerContextLinks : accountantLinks).length > 0 ? (
        <NavSection eyebrow={isVa ? 'Context' : isAccountant ? 'Evidence' : 'Context'}>
          {(isVa ? vaContextLinks : isManager ? managerContextLinks : accountantLinks).map((link) => (
            <NavLink
              key={link.href}
              link={link}
              pathname={pathname}
              currentHash={currentHash}
              onNavigate={onNavigate}
            />
          ))}
        </NavSection>
        ) : null}
      </nav>

      <AccountFooter user={user} org={org} />
      <SidebarStyles />
    </div>
  );
}

function NavSection({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="font-mono uppercase"
        style={{
          fontFamily: 'var(--font-mono-operator)',
          fontSize: '9.5px',
          letterSpacing: '0.14em',
          color: 'var(--sidebar-ink-3)',
          padding: '0 8px 7px',
        }}
      >
        {eyebrow}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

function isLinkActive(
  pathname: string | null,
  href: string,
  matchSearch?: string,
  currentHash = '',
): boolean {
  if (!pathname) return false;
  const parsedHref = new URL(href, 'https://odesa.local');
  const hrefPath = parsedHref.pathname;
  const hrefQuery = parsedHref.search.slice(1);
  const hrefHash = parsedHref.hash;

  // Review records are source evidence for the VA escalation desk. Keep the
  // parent workspace active while the assistant inspects one of those records.
  if (hrefPath === '/escalations' && pathname.startsWith('/review/')) {
    return true;
  }

  if (hrefHash) {
    return pathname === hrefPath && currentHash === hrefHash;
  }

  if (matchSearch || hrefQuery) {
    // Search-aware match: only active if we're on the exact route +
    // the current URL carries the matching query. We can't read
    // `searchParams` in a layout-rendered nav without making this a
    // suspense boundary, so we approximate via window.location when
    // hydrated. Server render uses pathname-only (acceptable: no FOUC
    // on a query-scoped link).
    if (pathname !== hrefPath) return false;
    if (typeof window === 'undefined') return false;
    const needle = matchSearch ?? hrefQuery ?? '';
    return window.location.search.includes(needle);
  }
  if (pathname === hrefPath) return currentHash === '';
  return pathname.startsWith(hrefPath + '/');
}

function NavLink({
  link,
  pathname,
  currentHash,
  onNavigate,
}: {
  link: NavLinkSpec;
  pathname: string | null;
  currentHash: string;
  onNavigate?: () => void;
}) {
  const active = isLinkActive(
    pathname,
    link.href,
    link.matchSearch,
    currentHash,
  );
  const slug = link.label.toLowerCase().replace(/\s+/g, '-');
  const Icon = link.icon;
  // Scoped accessible label for the count badge (e.g. "3 open"), so the
  // numeral conveys what it measures rather than reading as a bare figure.
  const countAriaLabel =
    link.count !== undefined && link.countScope
      ? `${link.count} ${link.countScope}`
      : undefined;

  const baseStyle: React.CSSProperties = {
    fontSize: '13px',
    color: 'var(--sidebar-ink-2)',
    padding: '6px 8px',
    borderRadius: '4px',
    position: 'relative',
  };

  if (link.comingSoon) {
    return (
      <span
        aria-disabled="true"
        data-testid={`sidebar-link-${slug}`}
        className="flex items-center justify-between"
        style={{
          ...baseStyle,
          opacity: 0.55,
          cursor: 'default',
          pointerEvents: 'none',
        }}
      >
        <span className="flex items-center gap-2 min-w-0">
          {Icon && (
            <Icon
              size={15}
              strokeWidth={1.75}
              aria-hidden
              style={{ color: 'var(--sidebar-ink-3)', flexShrink: 0 }}
            />
          )}
          <span className="truncate">{link.label}</span>
        </span>
        {link.count !== undefined && link.count !== 0 && (
          <NavCount value={link.count} ariaLabel={countAriaLabel} />
        )}
      </span>
    );
  }

  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      data-testid={`sidebar-link-${slug}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center justify-between transition-colors',
        active ? 'sidebar-link-active' : 'sidebar-link-idle',
      )}
      style={baseStyle}
    >
      <span className="flex items-center gap-2 min-w-0">
        {Icon && (
          <Icon
            size={15}
            strokeWidth={1.75}
            aria-hidden
            style={{
              color: active ? 'var(--sidebar-ink)' : 'var(--sidebar-ink-3)',
              flexShrink: 0,
            }}
          />
        )}
        <span
          className="truncate"
          style={{ color: active ? 'var(--sidebar-ink)' : undefined }}
        >
          {link.label}
        </span>
      </span>
      {link.count !== undefined && link.count !== 0 && (
        <NavCount value={link.count} ariaLabel={countAriaLabel} />
      )}
    </Link>
  );
}

/**
 * Static CSS for sidebar link hover/active states. Tailwind v4 supports
 * `before:` utilities, but the active dot uses a negative offset relative
 * to the link box and shares its color with `--terracotta` from globals;
 * a single co-located rule block keeps the markup readable. React 19
 * hoists the style tag (with `precedence`) and dedupes across renders.
 */
function SidebarStyles() {
  return (
    <style
      // React 19 supports `precedence` on <style> for dedupe + hoisting.
      precedence="default"
      href="sidebar-link-styles"
      dangerouslySetInnerHTML={{
        __html: `
.sidebar-link-idle:hover {
  background: var(--canvas-deep);
  color: var(--sidebar-ink, #1B1712);
}
.sidebar-link-active {
  background: var(--panel);
  color: var(--sidebar-ink, #1B1712);
  font-weight: 450;
  box-shadow: inset 0 0 0 1px var(--sidebar-hairline, #E0D6BE);
}
.sidebar-link-active::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--terracotta);
  transform: translateY(-50%);
}
`,
      }}
    />
  );
}

function NavCount({
  value,
  ariaLabel,
}: {
  value: number | string;
  /** Scoped accessible label, e.g. "3 open"; falls back to the numeral. */
  ariaLabel?: string;
}) {
  return (
    <span
      className="font-mono tabular-nums"
      aria-label={ariaLabel}
      style={{
        fontFamily: 'var(--font-mono-operator)',
        fontSize: '11.5px',
        color: 'var(--sidebar-ink-3)',
      }}
    >
      {value}
    </span>
  );
}

function AccountFooter({
  user,
  org,
}: {
  user: SidebarUser | null;
  org: SidebarOrg | null;
}) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const displayName = user?.fullName ?? 'Sign in';
  const initials = user?.initials ?? 'U';
  const isVa = user?.role === 'va';
  const isAccountant = user?.role === 'accountant';
  const orgLine = org
    ? `${org.name} · ${org.propertyCount} ${isAccountant ? 'assigned ' : ''}prop${org.propertyCount === 1 ? '' : 's'}`
    : user?.role === 'va'
      ? 'Portfolio context'
      : 'No organization';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="user-menu"
        className="flex w-full items-center gap-2 rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--terracotta)]"
        style={{
          padding: '8px',
          border: '1px solid transparent',
        }}
      >
        <span
          aria-hidden
          className="flex items-center justify-center rounded-full"
          style={{
            width: '26px',
            height: '26px',
            background: 'var(--sidebar-ink)',
            color: '#FBF6E8',
            fontSize: '10.5px',
            fontWeight: 500,
            letterSpacing: '0.02em',
            fontFamily: 'var(--font-sans-operator)',
          }}
        >
          {initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate"
            style={{
              fontSize: '12.5px',
              color: 'var(--sidebar-ink)',
              fontWeight: 500,
            }}
          >
            {displayName}
          </span>
          <span
            className="truncate"
            style={{
              fontSize: '10.5px',
              color: 'var(--sidebar-ink-3)',
            }}
          >
            {isVa || isAccountant ? (
              <>
                <span
                  data-testid="user-role-label"
                  className="font-mono"
                  style={{ fontFamily: 'var(--font-mono-operator)' }}
                >
                  {isAccountant ? 'Accountant' : 'Operations Assistant'}
                </span>{' '}
                ·{' '}
              </>
            ) : null}
            {orgLine}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8}>
        {!isVa && !isAccountant ? (
          <>
            <DropdownMenuItem
              onClick={() => router.push('/settings')}
              data-testid="user-menu-profile"
            >
              <UserIcon className="size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push('/settings')}
              data-testid="user-menu-settings"
            >
              <SettingsIcon className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onClick={handleSignOut}
          data-testid="user-menu-signout"
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

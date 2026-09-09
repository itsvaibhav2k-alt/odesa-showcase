'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Menu } from 'lucide-react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Sidebar, type SidebarOrg, type SidebarUser } from './sidebar';
import type { NavCounts } from '@/lib/shell/nav-counts';

interface TopBarProps {
  counts: NavCounts;
  user: SidebarUser | null;
  org: SidebarOrg | null;
}

/**
 * Slim global top bar. Hosts the mobile menu trigger + notifications
 * bell. The account dropdown lives in the sidebar `AccountFooter`; it
 * is intentionally absent here so the chrome stays quiet.
 */
export function TopBar({ counts, user, org }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isVa = user?.role === 'va';
  const isAccountant = user?.role === 'accountant';
  const showStatusPill =
    !isAccountant || user?.capabilities?.includes('view_dashboard') === true;
  // Unread-count wiring lands once notifications table exists (Phase 2+).
  // Until then the bell opens an empty-state popover pointing at Owner
  // Review on /today rather than sitting dead.
  const [unreadCount] = useState(0);

  return (
    <>
      <header
        data-testid="top-bar"
        className="flex h-14 items-center justify-between bg-panel border-b border-hairline-strong shadow-[0_1px_2px_rgba(39,31,22,0.05)] px-4 lg:px-6"
      >
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            data-testid="mobile-menu-toggle"
          >
            <Menu className="size-5" />
            <span className="sr-only">Open menu</span>
          </Button>
          <h2
            className="text-sm font-medium"
            style={{ color: 'var(--ink-700, #33302A)' }}
          >
            {org?.name || 'My organization'}
          </h2>
          {showStatusPill ? <StatusPill counts={counts} role={user?.role} /> : null}
        </div>
        {!isAccountant ? <div className="flex items-center gap-2">
          <PopoverPrimitive.Root>
            <PopoverPrimitive.Trigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid="notifications"
                  className="relative"
                />
              }
            >
              <Bell className="size-4" />
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 size-4 justify-center p-0 text-[10px]"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Badge>
              )}
              <span className="sr-only">Notifications</span>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Positioner
                align="end"
                side="bottom"
                sideOffset={8}
                style={{ zIndex: 50 }}
              >
                <PopoverPrimitive.Popup
                  data-testid="notifications-popover"
                  className="max-w-[280px] rounded-md border border-hairline-strong bg-panel-clean p-3 text-sm leading-relaxed text-muted-foreground shadow-[0_12px_32px_rgba(39,31,22,0.12)]"
                >
                  {isVa
                    ? 'No notifications right now. Time-sensitive context appears in your shift queue.'
                    : user?.role === 'manager'
                      ? 'No notifications right now. Time-sensitive items appear on Today.'
                      : 'No notifications right now. Pending commitments appear in Owner Queue.'}
                </PopoverPrimitive.Popup>
              </PopoverPrimitive.Positioner>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
        </div> : null}
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[200px] p-0 border-r border-hairline-strong"
          style={{
            background: 'var(--canvas)',
            boxShadow: '12px 0 32px rgba(39, 31, 22, 0.16)',
          }}
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar
            counts={counts}
            user={user}
            org={org}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Calm portfolio status pill. Reads the already-fetched `ownerReview`
 * count from `counts` (no own fetch). When work is waiting it links to
 * the owner queue; otherwise it precisely reports that Owner Queue is clear
 * reassurance. Hidden on the smallest widths so the mobile menu button
 * never gets crowded.
 */
function StatusPill({
  counts,
  role,
}: {
  counts: NavCounts;
  role?: SidebarUser['role'];
}) {
  if (role === 'accountant') {
    return (
      <Link
        href="/today"
        className="hidden sm:flex items-center gap-2 rounded-full bg-panel-clean border border-hairline-strong px-2.5 py-1 text-xs font-medium text-muted-foreground"
        aria-label="Open reconciliation desk"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ backgroundColor: 'var(--sage-600, #62805f)' }}
        />
        <span>Read-only close</span>
      </Link>
    );
  }
  if (role === 'va') {
    const hasShiftWork = counts.todayUrgent > 0;
    return (
      <Link
        href="/today"
        className="hidden sm:flex items-center gap-2 rounded-full bg-panel-clean border border-hairline-strong px-2.5 py-1 text-xs font-medium text-muted-foreground"
        aria-label="Open shift workspace"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: hasShiftWork
              ? 'var(--terracotta)'
              : 'var(--hairline-strong)',
          }}
        />
        <span>Shift workspace</span>
      </Link>
    );
  }
  if (role === 'manager') {
    return (
      <Link
        href="/today"
        className="hidden sm:flex items-center gap-2 rounded-full bg-panel-clean border border-hairline-strong px-2.5 py-1 text-xs font-medium text-muted-foreground"
        aria-label="Open operations workspace"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ backgroundColor: 'var(--hairline-strong)' }}
        />
        <span>Operations workspace</span>
      </Link>
    );
  }

  const n = counts.ownerReview ?? 0;
  const dotColor = n > 0 ? 'var(--terracotta)' : 'var(--hairline-strong)';
  const pillClassName =
    'hidden sm:flex items-center gap-2 rounded-full bg-panel-clean border border-hairline-strong px-2.5 py-1 text-xs font-medium text-muted-foreground';
  const dot = (
    <span
      aria-hidden="true"
      className="size-1.5 rounded-full"
      style={{ backgroundColor: dotColor }}
    />
  );

  if (n > 0) {
    return (
      <Link
        href="/owner-queue"
        className={pillClassName}
        aria-label={`${n} pending Owner Queue decisions`}
      >
        {dot}
        <span>{`${n} in Owner Queue`}</span>
      </Link>
    );
  }

  return (
    <span
      className={pillClassName}
      aria-label="Owner Queue has no pending decisions"
    >
      {dot}
      <span>Owner Queue clear</span>
    </span>
  );
}

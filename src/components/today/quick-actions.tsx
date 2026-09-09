import Link from 'next/link';
import { Activity, Building2, Settings } from 'lucide-react';

/**
 * Bottom-of-screen quick-action bar. Three anchors to the other three
 * surfaces; designed as an editorial rail rather than a prominent nav
 * because the sidebar is the primary navigator.
 */
const ACTIONS = [
  { href: '/inbox', label: 'Activity Feed', icon: Activity },
  { href: '/properties', label: 'Properties', icon: Building2 },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function QuickActions() {
  return (
    <nav
      data-testid="today-quick-actions"
      aria-label="Quick actions"
      className="flex flex-wrap gap-3"
    >
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            data-testid={`today-quick-action-${slugify(a.label)}`}
            className="inline-flex items-center gap-2 transition-row-hover"
            style={{
              padding: '10px 14px',
              background: 'var(--paper-0)',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--radius-sm-odesa)',
              color: 'var(--ink-700)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.01em',
              textDecoration: 'none',
            }}
          >
            <Icon size={14} color="var(--navy-700)" />
            <span>{a.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

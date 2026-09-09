'use client';

/**
 * Thin client shell for the Property Interior room drawers.
 *
 * Mirrors `UnitDrawerMount`: the parent `page.tsx` stays a server component
 * and renders the matching async server room component as `children`. This
 * shell owns the Sheet open-state ↔ URL transition and a Suspense boundary so
 * the drawer + skeleton paint immediately while the room content streams in.
 *
 * Close semantics use `router.replace` (NOT push) so that pressing Back after
 * closing a room does not re-open it.
 */

import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { CSSProperties } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';

import { ROOM_META, type RoomKey, type RoomMeta } from './rooms-meta';

export interface RoomDrawerMountProps {
  propertyId: string;
  room: RoomKey | null;
  children?: React.ReactNode;
}

const contentStyle: CSSProperties = {
  width: '100%',
  maxWidth: 'min(720px, 92vw)',
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  padding: 0,
  gap: 0,
};

const headerStyle: CSSProperties = {
  padding: '24px 26px 18px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const titleStyle: CSSProperties = {
  margin: '9px 0 0',
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 30,
  lineHeight: 1,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
};

const descriptionStyle: CSSProperties = {
  margin: '11px 0 0',
  maxWidth: '52ch',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13.5,
  lineHeight: 1.5,
  color: 'var(--ink-2)',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '20px 26px 28px',
};

export function RoomDrawerMount({
  propertyId,
  room,
  children,
}: RoomDrawerMountProps): React.ReactElement {
  const router = useRouter();

  // Keep the last opened room's copy during the close animation so the
  // SheetTitle/SheetDescription primitives never flash empty (a11y) while the
  // popup is still mounted-but-closing.
  const [lastMeta, setLastMeta] = React.useState<RoomMeta | null>(
    room != null ? ROOM_META[room] : null,
  );
  React.useEffect(() => {
    if (room != null) {
      setLastMeta(ROOM_META[room]);
    }
  }, [room]);
  const meta = room != null ? ROOM_META[room] : lastMeta;

  return (
    <Sheet
      open={room != null}
      onOpenChange={(open: boolean) => {
        if (!open) {
          // replace, not push — Back must not re-open the closed drawer.
          router.replace(`/properties/${propertyId}`, { scroll: false });
        }
      }}
    >
      <SheetContent
        side="right"
        className="today-theme"
        data-testid="room-drawer"
        data-room={meta?.key}
        style={contentStyle}
      >
        <header style={headerStyle}>
          <p style={eyebrowStyle}>{meta?.eyebrow ?? ''}</p>
          <SheetTitle className="text-foreground" style={titleStyle}>
            {meta?.title ?? ''}
          </SheetTitle>
          <SheetDescription
            className="text-muted-foreground"
            style={descriptionStyle}
          >
            {meta?.description ?? ''}
          </SheetDescription>
        </header>
        <div style={bodyStyle}>
          <React.Suspense fallback={<RoomSkeleton />}>{children}</React.Suspense>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const skeletonWrapStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const skeletonStatRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 10,
};

const skeletonBlockStyle: CSSProperties = {
  border: '1px solid var(--hairline-faint)',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--panel-lift) 70%, transparent)',
};

/** Quiet hairline placeholder shown while a room's server content streams. */
function RoomSkeleton(): React.ReactElement {
  return (
    <div aria-hidden="true" style={skeletonWrapStyle}>
      <div style={{ ...skeletonBlockStyle, height: 88 }} />
      <div style={skeletonStatRowStyle}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ ...skeletonBlockStyle, height: 74 }} />
        ))}
      </div>
      <div style={{ ...skeletonBlockStyle, height: 240 }} />
    </div>
  );
}

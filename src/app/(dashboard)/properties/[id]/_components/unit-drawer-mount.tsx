'use client';

/**
 * Tiny client wrapper that owns the close-→-URL transition for the
 * property page's UnitDetailDrawer. Keeping this separate lets the
 * parent `page.tsx` remain a server component while the drawer's
 * onClose callback uses `useRouter`.
 *
 * The data prop is the server-fetched UnitDetail — `null` keeps the
 * drawer closed, so the same component handles both the "no unit in
 * URL" and "URL specifies an invalid unit" cases.
 */

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { UnitDetailDrawer } from '@/components/properties/unit-detail-drawer';
import type { UnitDetail } from '@/lib/properties/queries';

export interface UnitDrawerMountProps {
  propertyId: string;
  data: UnitDetail | null;
  /**
   * Where closing the drawer navigates. Defaults to the property root; the
   * interior page passes `?room=units` so the unit drawer always closes back
   * into the units room rather than a stale room param.
   */
  closeHref?: string;
  readOnly?: boolean;
}

export function UnitDrawerMount({
  propertyId,
  data,
  closeHref,
  readOnly = false,
}: UnitDrawerMountProps): React.ReactElement {
  const router = useRouter();
  const resolvedCloseHref = closeHref ?? `/properties/${propertyId}`;

  return (
    <UnitDetailDrawer
      open={data != null}
      data={data}
      readOnly={readOnly}
      onClose={() => {
        // replace, not push — Back must not re-open the closed unit drawer.
        router.replace(resolvedCloseHref, { scroll: false });
      }}
    />
  );
}

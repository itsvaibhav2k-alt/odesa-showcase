'use client';

/**
 * UnitDetailDrawer — the inline drawer that opens when a row of the
 * Units table is clicked. URL-synced via `?unit=<id>` on the property
 * detail page; the server component fetches `getUnitDetail` and passes
 * the result through `data`.
 *
 * Internal tabs (Tenant / Lease / Payments / Conversations)
 * render existing components from `@/components/properties/*` and the
 * unit-detail co-located `TenantPreferencesEditor`. No data fetching
 * happens here — the drawer is pure render.
 *
 * `data === null` keeps the sheet closed even when `open` is true so
 * the page can race the fetch without flashing an empty drawer.
 */

import * as React from 'react';

import type { UnitDetail } from '@/lib/properties/queries';
import { ConversationsRail } from '@/components/properties/conversations-rail';
import { LeaseBlock } from '@/components/properties/lease-block';
import { RentPaymentHistory } from '@/components/properties/rent-payment-history';
import { TenantBlock } from '@/components/properties/tenant-block';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { TenantPreferencesEditor } from '@/app/(dashboard)/properties/[id]/units/[unitId]/_components/tenant-preferences';
import { AddTenantDialog } from '@/app/(dashboard)/properties/[id]/_components/add-tenant-dialog';

export interface UnitDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Server-fetched unit payload. When null the drawer renders nothing. */
  data: UnitDetail | null;
  /** VA context mode: evidence stays visible; owner mutations do not. */
  readOnly?: boolean;
}

type DrawerTabKey =
  | 'tenant'
  | 'lease'
  | 'payments'
  | 'conversations';

const DEFAULT_TAB: DrawerTabKey = 'tenant';

export function UnitDetailDrawer({
  open,
  onClose,
  data,
  readOnly = false,
}: UnitDetailDrawerProps): React.ReactElement | null {
  // Reset the active tab whenever the unit identity changes so opening
  // a different unit doesn't strand the user on a tab that may be empty.
  const [tab, setTab] = React.useState<DrawerTabKey>(DEFAULT_TAB);
  const unitId = data?.unit.id;
  React.useEffect(() => {
    if (unitId) setTab(DEFAULT_TAB);
  }, [unitId]);

  if (!data) return null;

  const { occupancy, unit, tenant, lease, payments, rentPayments, conversations } = data;
  // A pending lease is move-in setup, never vacancy — branch on the
  // structured occupancy, not on "tenant is null".
  const pendingMoveIn = occupancy === 'pending_move_in';

  return (
    <Sheet
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side='right'
        // `sm:max-w-2xl` (42rem) gives room for the 4-tab strip and the
        // 2-col preferences grid; inline width is a belt-and-suspenders
        // guard against any future class-based regression.
        style={{ width: 'min(720px, 92vw)' }}
        className='sm:max-w-2xl flex flex-col gap-0 p-0 overflow-x-hidden'
        data-testid='unit-detail-drawer'
        data-unit-id={unit.id}
      >
        <SheetHeader className='border-b border-[var(--paper-300)] px-5 py-4'>
          <SheetTitle data-testid='unit-detail-drawer-title'>
            {unit.propertyName} · {unit.label}
          </SheetTitle>
          <SheetDescription>
            {tenant
              ? tenant.fullName
              : pendingMoveIn
                ? 'Lease pending — move-in being set up'
                : 'Vacant unit'}
          </SheetDescription>
        </SheetHeader>

        <div className='flex-1 overflow-y-auto px-5 py-5'>
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as DrawerTabKey)}
            className='gap-4'
          >
            <TabsList
              variant='line'
              className='w-full justify-start overflow-x-auto'
              data-testid='unit-detail-drawer-tabs'
            >
              <TabsTrigger value='tenant' data-testid='unit-detail-tab-tenant'>
                Tenant
              </TabsTrigger>
              <TabsTrigger value='lease' data-testid='unit-detail-tab-lease'>
                Lease
              </TabsTrigger>
              <TabsTrigger
                value='payments'
                data-testid='unit-detail-tab-payments'
              >
                Payments
              </TabsTrigger>
              <TabsTrigger
                value='conversations'
                data-testid='unit-detail-tab-conversations'
              >
                Conversations
              </TabsTrigger>
            </TabsList>

            <TabsContent value='tenant' className='flex flex-col gap-6'>
              {tenant ? (
                <>
                  <TenantBlock tenant={tenant} lease={lease} />
                  {!readOnly ? (
                    <TenantPreferencesEditor
                      propertyId={unit.propertyId}
                      unitId={unit.id}
                      tenantId={tenant.id}
                      tenantName={tenant.fullName}
                      initial={tenant.preferences}
                    />
                  ) : null}
                </>
              ) : pendingMoveIn ? (
                <DrawerEmpty
                  testId='unit-detail-drawer-tenant-empty'
                  title='Lease pending'
                  body={
                    readOnly
                      ? 'Lease pending — move-in being set up. Owner approval is required to finalize the tenant record.'
                      : 'Lease pending — move-in being set up. Finish lease terms to populate tenant info.'
                  }
                />
              ) : (
                <DrawerEmpty
                  testId='unit-detail-drawer-tenant-empty'
                  title='No tenant assigned'
                  body={
                    readOnly
                      ? 'No tenant is assigned. Use this unit record as context for an owner handoff.'
                      : 'Add a tenant to begin occupancy, rent, and communication tracking for this unit.'
                  }
                  cta={
                    readOnly ? undefined : (
                      <AddTenantDialog
                        propertyId={unit.propertyId}
                        units={[{ id: unit.id, label: unit.label }]}
                        variant='primary'
                      />
                    )
                  }
                />
              )}
            </TabsContent>

            <TabsContent value='lease' className='flex flex-col gap-6'>
              {lease ? (
                <LeaseBlock lease={lease} payments={payments} />
              ) : pendingMoveIn ? (
                <DrawerEmpty
                  testId='unit-detail-drawer-lease-empty'
                  title='Lease pending'
                  body={
                    readOnly
                      ? 'A lease is pending on this unit. Owner approval is required before rent tracking starts.'
                      : 'A lease is pending on this unit. Finish lease terms to start tracking rent.'
                  }
                />
              ) : (
                <DrawerEmpty
                  testId='unit-detail-drawer-lease-empty'
                  title='No active lease'
                  body={
                    readOnly
                      ? 'No active lease is recorded. Tenant and lease setup remain owner-managed.'
                      : 'Create lease terms after a tenant is assigned. Add a tenant first to start a lease.'
                  }
                />
              )}
            </TabsContent>

            <TabsContent value='payments'>
              {lease ? (
                <RentPaymentHistory payments={rentPayments} />
              ) : pendingMoveIn ? (
                <DrawerEmpty
                  testId='unit-detail-drawer-payments-empty'
                  title='No rent ledger yet'
                  body={
                    readOnly
                      ? 'Rent tracking starts after the owner activates the pending lease.'
                      : 'Rent tracking starts once the pending lease is active. Finish lease terms to open the ledger.'
                  }
                />
              ) : (
                <DrawerEmpty
                  testId='unit-detail-drawer-payments-empty'
                  title='No rent ledger yet'
                  body={
                    readOnly
                      ? 'This unit is vacant, so there is no rent ledger to review.'
                      : 'This unit is vacant, so there is no rent to collect. Assign a tenant to start a rent ledger.'
                  }
                />
              )}
            </TabsContent>

            <TabsContent value='conversations'>
              {tenant ? (
                <ConversationsRail conversations={conversations} />
              ) : (
                <DrawerEmpty
                  testId='unit-detail-drawer-conversations-empty'
                  title='No tenant conversations yet'
                  body='Calls and texts with the tenant appear here automatically once a tenant is assigned to this unit.'
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface DrawerEmptyProps {
  testId: string;
  title: string;
  body: string;
  /** Optional next-action affordance rendered under the body. */
  cta?: React.ReactNode;
}

function DrawerEmpty({ testId, title, body, cta }: DrawerEmptyProps) {
  return (
    <div
      data-testid={testId}
      className='rounded-md border border-[var(--paper-300)] bg-[var(--paper-0)] px-6 py-8 text-sm text-[var(--ink-500)]'
    >
      <p className='heading-5 text-[var(--ink-800)]'>{title}</p>
      <p className='mt-2 leading-relaxed'>{body}</p>
      {cta ? <div className='mt-4'>{cta}</div> : null}
    </div>
  );
}

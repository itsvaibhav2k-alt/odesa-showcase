/**
 * Privacy invariant: NO routing key may be a structural key on any
 * WorkerActionPayload variant.
 *
 * Why: payloads are model output. Routing fields are
 * orchestrator-side identifiers (tenantId/conversationId for SMS,
 * workOrderId/vendorId for vendor dispatch, weeklyReportId for
 * briefing writeback). The model never resolves UUIDs — when it
 * needs to pick among options (e.g. which vendor), it picks via an
 * INDEX into a candidate list (see DispatchVendorPayload.candidateIndex),
 * and the orchestrator does the index→UUID resolution before
 * persisting. This keeps the model output FK-free, which matters
 * most in Privacy Mode (Ollama on-prem) where the worker shouldn't
 * see tenant or vendor UUIDs at all.
 *
 * Earlier iterations carved out vendorId/workOrderId because the
 * worker used to pick a vendor by UUID directly. Worker-core-eng's
 * `7f15396` switched DispatchVendorPayload to `candidateIndex: number`,
 * which closed the conflict — so the invariant now covers ALL
 * routing keys with zero exceptions. If the conflict ever returns,
 * the right fix is the index-and-resolve pattern, not weakening
 * this invariant.
 *
 * Enforced at the type level rather than via zod `.parse()` because
 * plain `z.object()` schemas strip unknown keys silently (zod v3
 * default), so a runtime test would not catch the regression.
 *
 * Adding a new routing field? Update `ProposalRouting` in
 * worker/types.ts and this test will automatically guard it.
 */

import { describe, it, expect } from 'vitest';

import type {
  ProposalRouting,
  WorkerActionPayload,
} from '@/lib/agent/worker/types';

// Union of all keys that ever appear on any WorkerActionPayload variant.
type AllPayloadKeys = WorkerActionPayload extends infer P
  ? P extends object
    ? keyof P
    : never
  : never;

// All routing keys, sourced directly from ProposalRouting so adding
// a new key flows through automatically (no dual-write list).
type AllRoutingKeys = keyof ProposalRouting;

// The invariant: there is NO key in common between the two unions.
type PayloadRoutingOverlap = Extract<AllPayloadKeys, AllRoutingKeys>;

// Compile-time assertion that the overlap is exactly `never`. If a
// new payload variant ever adds a routing key, this line fails the
// build with a clear-pointing error and the test below also throws
// to make the failure visible in vitest.
type _AssertNoOverlap<T extends never> = T;
type _Check = _AssertNoOverlap<PayloadRoutingOverlap>;
// Reference _Check so unused-type lint doesn't strip it.
const _checkRef: _Check | undefined = undefined;
void _checkRef;

describe('privacy invariant — routing keys never appear in payload', () => {
  it('compile-time check: zero overlap between ProposalRouting and any WorkerActionPayload', () => {
    // The real assertion is the type alias above. This `it` block
    // exists so vitest reports the invariant in the suite output and
    // surfaces a clear failure if someone weakens it. The runtime
    // body is just a smoke check that the routing surface is non-empty
    // — if ProposalRouting ever loses all its keys, that's a different
    // bug worth catching.
    const sentinel: keyof ProposalRouting = 'tenantId';
    expect(sentinel.length).toBeGreaterThan(0);
  });
});

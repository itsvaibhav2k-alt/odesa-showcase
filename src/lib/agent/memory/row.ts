/**
 * Row → typed-fact hydration. Centralized so query/record/decay all agree
 * on the snake_case → camelCase mapping and on the JSONB content cast.
 *
 * `MemoryFactRow` is defined locally rather than imported from
 * `src/types/database.ts` because the generated shape widens to
 * `fact_type: string`, `source: string`, `content: Json` (no CHECK-
 * constraint narrowing on the TS side). The local definition narrows
 * these to the discriminator unions so `rowToFact`'s switch is
 * exhaustive without an upstream cast.
 */

import type {
  BuildingQuirkContent,
  DerivedRuleContent,
  FactSource,
  FactType,
  MemoryFact,
  OwnerRuleContent,
  TenantPatternContent,
  VendorRelationshipContent,
} from './types';

export interface MemoryFactRow {
  id: string;
  organization_id: string;
  property_id: string;
  fact_type: FactType;
  subject_id: string | null;
  content: unknown;
  confidence: number | string;
  source: FactSource;
  evidence_proposal_ids: string[] | null;
  created_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
}

/**
 * Hydrate a row into the discriminated union. Caller is responsible for
 * making sure the JSONB body actually conforms to the per-fact-type shape;
 * the SQL CHECK constraint on `fact_type` does not enforce body shape, so
 * upstream writers (recordFact + extract) are the gatekeepers.
 */
export function rowToFact(row: MemoryFactRow): MemoryFact {
  // Supabase returns numerics as either number or string depending on the
  // driver path. Normalize once so consumers don't have to.
  const confidence =
    typeof row.confidence === 'string' ? Number(row.confidence) : row.confidence;

  const base = {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    subjectId: row.subject_id,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    source: row.source,
    evidenceProposalIds: row.evidence_proposal_ids ?? [],
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
    supersededBy: row.superseded_by,
  } as const;

  switch (row.fact_type) {
    case 'vendor_relationship':
      return {
        ...base,
        factType: 'vendor_relationship',
        content: row.content as VendorRelationshipContent,
      };
    case 'tenant_pattern':
      return {
        ...base,
        factType: 'tenant_pattern',
        content: row.content as TenantPatternContent,
      };
    case 'building_quirk':
      return {
        ...base,
        factType: 'building_quirk',
        content: row.content as BuildingQuirkContent,
      };
    case 'derived_rule':
      return {
        ...base,
        factType: 'derived_rule',
        content: row.content as DerivedRuleContent,
      };
    case 'owner_rule':
      return {
        ...base,
        factType: 'owner_rule',
        content: row.content as OwnerRuleContent,
      };
  }
}

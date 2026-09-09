/**
 * Shared severity / risk → StatusChip tone mapping for the financial
 * surface. Maps the domain's `RiskLevel` / `ExceptionSeverity` onto the
 * EXISTING `StatusChip` tone palette (no invented tones — see
 * `src/components/shared/status-chip.tsx`).
 */

import type { StatusChipTone } from '@/components/shared/status-chip';
import type { ExceptionSeverity, RiskLevel } from '@/lib/financials/types';

/** Map a property/portfolio risk level to an existing chip tone + label. */
export function riskTone(level: RiskLevel): { tone: StatusChipTone; label: string } {
  switch (level) {
    case 'healthy':
      return { tone: 'green', label: 'Healthy' };
    case 'watch':
      return { tone: 'amber-soft', label: 'Watch' };
    case 'attention':
      return { tone: 'amber', label: 'Attention' };
    case 'critical':
      return { tone: 'clay', label: 'Critical' };
    case 'unknown':
    default:
      return { tone: 'neutral-gold', label: 'Unknown' };
  }
}

/** Map an exception severity to an existing chip tone + label. */
export function severityTone(
  severity: ExceptionSeverity,
): { tone: StatusChipTone; label: string } {
  switch (severity) {
    case 'critical':
      return { tone: 'clay', label: 'Critical' };
    case 'attention':
      return { tone: 'amber', label: 'Attention' };
    case 'watch':
      return { tone: 'amber-soft', label: 'Watch' };
    case 'info':
    default:
      return { tone: 'neutral-gold', label: 'Info' };
  }
}

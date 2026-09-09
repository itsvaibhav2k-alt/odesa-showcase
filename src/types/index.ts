// Re-export database row types + enum unions from the generated schema types
// so `@/types` remains the canonical import path. Do NOT add parallel
// interface definitions here — they will shadow the DB-backed shapes and
// drift.

export type {
  Database,
  Json,
  Organization,
  User,
  Property,
  Unit,
  Tenant,
  Lease,
  Conversation,
  Message,
  WorkOrder,
  Vendor,
  RentEvent,
  WeeklyReport,
  OrgPulseKpis,
  MessagingProviderChoice,
  OrganizationPlan,
  UserRole,
  LeaseStatus,
  ConversationChannel,
  ConversationStatus,
  MessageDirection,
  MessageProvider,
  MessageDraftStatus,
  WorkOrderCategory,
  WorkOrderUrgency,
  WorkOrderStatus,
  RentEventStatus,
} from './database';

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

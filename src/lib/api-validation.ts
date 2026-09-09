/**
 * API input validation utilities for Odesa.
 *
 * Provides Zod schemas for every API-facing input shape and a generic
 * `validateBody` helper that parses a NextRequest body against a schema,
 * returning a discriminated Result type.
 */

import { type NextRequest } from 'next/server';
import { z, type ZodSchema } from 'zod';

// ---------------------------------------------------------------------------
// Reusable base patterns
// ---------------------------------------------------------------------------

/** Safe string: rejects HTML tags, curly braces, and script-injection chars. */
const safeString = z.string().max(2000).regex(
  /^[^<>{}]*$/,
  'Must not contain <, >, {, or } characters',
);

/** Safe name: alphanumeric, spaces, hyphens, underscores, dots. */
const safeName = z.string().min(1).max(100).regex(
  /^[a-zA-Z0-9\s\-_.]+$/,
  'Must contain only letters, numbers, spaces, hyphens, underscores, or dots',
);

/** Safe identifier (UUIDs, slug-style IDs). */
const safeId = z.string().min(1).max(100).regex(
  /^[a-zA-Z0-9\-_]+$/,
  'Must contain only letters, numbers, hyphens, or underscores',
);

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

type ValidationSuccess<T> = { readonly ok: true; readonly data: T };
type ValidationFailure = { readonly ok: false; readonly error: string };
type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Reads and validates the JSON body of a NextRequest against a Zod schema.
 *
 * @param request - The incoming NextRequest
 * @param schema - Zod schema to validate against
 * @returns A discriminated result with parsed data or a human-readable error
 */
export async function validateBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
): Promise<ValidationResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, error: 'Invalid JSON body' };
  }

  const result = schema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const issues = result.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  return { ok: false, error: `Validation failed: ${issues}` };
}

// ---------------------------------------------------------------------------
// Agent schemas
// ---------------------------------------------------------------------------

export const createAgentSchema = z.object({
  name: safeName,
  description: safeString.optional(),
  systemPrompt: z.string().min(1).max(50_000),
  model: safeString.optional(),
  temperature: z.number().min(0).max(2).optional(),
  toolsConfig: z.record(z.string(), z.unknown()).optional(),
  category: safeId.optional(),
  teamId: safeId.nullable().optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = createAgentSchema.partial();

export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

// ---------------------------------------------------------------------------
// Chat schemas
// ---------------------------------------------------------------------------

export const chatMessageSchema = z.object({
  agentId: safeId,
  message: z.string().min(1).max(10_000),
  conversationId: safeId.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

// ---------------------------------------------------------------------------
// Embed schemas
// ---------------------------------------------------------------------------

export const createEmbedSchema = z.object({
  agentId: safeId,
  label: safeName.optional(),
  allowedOrigins: z.array(z.string().url().max(500)).max(20).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  position: z.enum(['bottom-right', 'bottom-left', 'center']).optional(),
});

export type CreateEmbedInput = z.infer<typeof createEmbedSchema>;

// ---------------------------------------------------------------------------
// Workflow schemas
// ---------------------------------------------------------------------------

const workflowStepSchema = z.object({
  id: safeId,
  agentId: safeId,
  prompt: z.string().min(1).max(5_000),
  dependsOn: z.array(safeId).max(50).optional(),
  timeout: z.number().int().positive().max(300).optional(),
});

export const createWorkflowSchema = z.object({
  name: safeName,
  description: safeString.optional(),
  teamId: safeId.nullable().optional(),
  steps: z.array(workflowStepSchema).min(1).max(50),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

export const runWorkflowSchema = z.object({
  workflowId: safeId,
  mode: z.enum(['dry', 'mock', 'live']),
  params: z.record(z.string(), z.string().max(2_000)).optional(),
});

export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { safeString, safeName, safeId };

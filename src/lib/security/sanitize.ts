/**
 * Security sanitization utilities for Odesa.
 *
 * Provides input sanitization, prompt injection detection, sensitive data
 * redaction, and shell/path injection guards for use across API routes
 * and agent pipelines.
 */

const MAX_INPUT_LENGTH = 10_000;

// ---------------------------------------------------------------------------
// Prompt injection detection
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate prompt-injection attempts via role spoofing or
 * instruction override tokens commonly used against LLMs.
 */
const ROLE_INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(SYSTEM|ASSISTANT|HUMAN|USER)\s*:/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<\s*SYS\s*>>/gi,
  /<<\s*\/SYS\s*>>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /###\s*(Instruction|Response|System)\s*:/gi,
];

interface PromptInjectionResult {
  readonly safe: boolean;
  readonly reason?: string;
}

/**
 * Detects prompt injection attempts in user input by scanning for role
 * spoofing tokens and instruction-override patterns.
 *
 * @param input - Raw user input to inspect
 * @returns An object indicating whether the input is safe
 */
export function detectPromptInjection(input: string): PromptInjectionResult {
  for (const pattern of ROLE_INJECTION_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(input)) {
      return {
        safe: false,
        reason: `Prompt injection detected: input matches pattern ${pattern.source}`,
      };
    }
  }
  return { safe: true };
}

// ---------------------------------------------------------------------------
// Sensitive data redaction
// ---------------------------------------------------------------------------

/**
 * Patterns for API keys, tokens, emails, and other secrets that must be
 * masked before logging or returning to clients.
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  // OpenAI keys
  /sk-[A-Za-z0-9]{20,}/g,
  // Slack tokens
  /xox[bpors]-[A-Za-z0-9\-]+/g,
  // GitHub PATs
  /ghp_[A-Za-z0-9]{36,}/g,
  // GitHub fine-grained PATs
  /github_pat_[A-Za-z0-9_]{20,}/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  // Generic api_key / apikey assignments
  /api[_-]?key[=:]\s*[A-Za-z0-9\-._~+/]{8,}/gi,
  // Supabase anon / service-role keys (eyJ...)
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  // Stripe keys
  /sk_live_[A-Za-z0-9]{20,}/g,
  /sk_test_[A-Za-z0-9]{20,}/g,
  // Telegram bot tokens
  /\d{8,}:AA[A-Za-z0-9_-]{30,}/g,
  // Email addresses
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];

const REDACTION_PLACEHOLDER = '***';

/**
 * Redacts sensitive data (API keys, tokens, emails) from text by replacing
 * matches with `***`.
 *
 * @param text - The text to redact
 * @returns A new string with sensitive values masked
 */
export function redactSensitiveData(text: string): string {
  let redacted = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return redacted;
}

// ---------------------------------------------------------------------------
// Shell injection detection
// ---------------------------------------------------------------------------

/**
 * Patterns for common shell meta-characters and command substitution.
 */
const SHELL_INJECTION_PATTERNS: readonly RegExp[] = [
  /;\s*/,         // command chaining
  /\|\s*/,        // pipe
  /&&/,           // logical AND
  /\$\(/,         // command substitution $(...)
  /`[^`]*`/,      // backtick command substitution
  /\|\|/,         // logical OR
  />\s*/,         // output redirection
  /<\s*/,         // input redirection
];

/**
 * Detects shell injection patterns in user input.
 *
 * @param input - The input to check
 * @returns `true` if shell injection patterns are detected
 */
export function detectShellInjection(input: string): boolean {
  return SHELL_INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

// ---------------------------------------------------------------------------
// File path validation
// ---------------------------------------------------------------------------

/**
 * Blocked path prefixes and traversal sequences.
 */
const BLOCKED_PATH_PATTERNS: readonly RegExp[] = [
  /\.\.\//,          // path traversal
  /\.\.\\/,          // Windows-style path traversal
  /^\/etc\//,        // system config
  /^\/proc\//,       // process info
  /^\/sys\//,        // kernel params
  /^\/dev\//,        // device files
  /^~\//,            // home directory expansion
  /\.env\b/,         // dotenv files
  /\.ssh\//,         // SSH keys
  /\.aws\//,         // AWS credentials
  /\.gnupg\//,       // GPG keys
  /credentials/i,    // credential files
];

/**
 * Validates that a file path does not contain traversal sequences or
 * reference sensitive system locations.
 *
 * @param path - The file path to validate
 * @returns `true` if the path is safe to use
 */
export function validateFilePath(path: string): boolean {
  const normalized = path.trim();
  if (normalized.length === 0) {
    return false;
  }
  return !BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// General user input sanitization
// ---------------------------------------------------------------------------

/**
 * Control characters regex (C0 controls except tab/newline/carriage-return).
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Sanitizes raw user input by trimming whitespace, enforcing a length limit,
 * and stripping control characters.
 *
 * @param input - Raw user input
 * @param maxLength - Maximum allowed length (defaults to MAX_INPUT_LENGTH)
 * @returns Sanitized string
 */
export function sanitizeUserInput(
  input: string,
  maxLength: number = MAX_INPUT_LENGTH,
): string {
  let sanitized = input.trim();

  // Enforce length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  // Strip control characters (keep tab, newline, carriage return)
  sanitized = sanitized.replace(CONTROL_CHARS, '');

  return sanitized;
}

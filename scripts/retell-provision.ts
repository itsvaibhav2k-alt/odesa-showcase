/**
 * Retell production-candidate provisioning.
 *
 * Dry-run is the default and performs no network I/O. Every network mode needs
 * an explicit canonical HTTPS production origin. Candidate/commit creates and
 * publishes immutable records but never touches the phone. A separate cutover
 * mode requires the saved transaction plus explicit confirmation before it
 * can pin the phone. SMS is absent unless both an explicit CLI capability and
 * truthful A2P approval are present.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRetellConfig,
  type RetellConfig,
  type RetellPrivacyConfig,
} from '../src/lib/voice/providers/retell-config';

const RETELL_API_BASE = 'https://api.retellai.com';
const TRANSACTION_FORMAT = 1 as const;

export interface RetellCustomTool {
  type: 'custom';
  name: string;
  description: string;
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  parameters: RetellConfig['tools'][number]['parameters'];
  timeout_ms: number;
}

export interface CreateLlmPayload {
  model: RetellConfig['agent']['model'];
  general_prompt: string;
  general_tools: RetellCustomTool[];
}

export interface CreateAgentPayload extends RetellPrivacyConfig {
  response_engine: { type: 'retell-llm'; llm_id: string; version?: number };
  voice_id: string;
  webhook_url: string;
  webhook_events: string[];
}

export interface AgentWeight {
  agent_id: string;
  agent_version?: number;
  weight: number;
}

export interface UpdatePhonePayload {
  inbound_agents: AgentWeight[];
  inbound_webhook_url: string;
  inbound_sms_agents?: AgentWeight[];
  outbound_sms_agents?: AgentWeight[];
  inbound_sms_webhook_url?: string;
}

export interface RetellProvisionPayloads {
  createLlm: CreateLlmPayload;
  createAgent: CreateAgentPayload;
  updatePhone: UpdatePhonePayload;
}

export interface ConfigToPayloadsOptions {
  voiceId: string;
  llmId?: string;
  llmVersion?: number;
  agentId?: string;
  agentVersion?: number;
  /** Off by default. This is the only switch capable of adding SMS fields. */
  includeSms?: boolean;
  /** Must be literally true when includeSms is true. */
  smsA2pApproved?: boolean;
  smsAgentId?: string;
  smsDispatchAgentId?: string;
}

export interface PhoneState {
  [key: string]: unknown;
  inbound_agents?: AgentWeight[] | null;
  inbound_webhook_url?: string | null;
  inbound_sms_agents?: AgentWeight[] | null;
  outbound_sms_agents?: AgentWeight[] | null;
  inbound_sms_webhook_url?: string | null;
}

export interface RetellTransaction {
  format: typeof TRANSACTION_FORMAT;
  transaction_id: string;
  created_at: string;
  updated_at: string;
  stage: string;
  production_base_url: string;
  phone_last4: string;
  phone_before: PhoneState;
  llm?: { id: string; version: number };
  agent?: { id: string; version: number; is_published: boolean };
  phone_after_expected?: UpdatePhonePayload;
  cutover_at?: string;
  restored_at?: string;
}

function headersToObject(
  headers: readonly { name: string; value: string }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers) result[header.name] = header.value;
  return result;
}

function requireNumericVersion(value: number | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative numeric version`);
  }
  return value as number;
}

/** Pure config-to-provider mapper. No environment reads or network I/O. */
export function configToRetellPayloads(
  config: RetellConfig,
  options: ConfigToPayloadsOptions,
): RetellProvisionPayloads {
  const generalTools: RetellCustomTool[] = config.tools.map((tool) => ({
    type: 'custom',
    name: tool.name,
    description: tool.description,
    url: tool.url,
    method: 'POST',
    headers: headersToObject(tool.headers),
    parameters: tool.parameters,
    timeout_ms: tool.timeout_ms,
  }));

  const responseEngine: CreateAgentPayload['response_engine'] = {
    type: 'retell-llm',
    llm_id: options.llmId ?? '',
    ...(options.llmVersion === undefined
      ? {}
      : { version: requireNumericVersion(options.llmVersion, 'llmVersion') }),
  };
  const inboundAgents: AgentWeight[] = options.agentId
    ? [{
        agent_id: options.agentId,
        ...(options.agentVersion === undefined
          ? {}
          : { agent_version: requireNumericVersion(options.agentVersion, 'agentVersion') }),
        weight: 1,
      }]
    : [];

  let smsFields: Pick<
    UpdatePhonePayload,
    'inbound_sms_agents' | 'outbound_sms_agents' | 'inbound_sms_webhook_url'
  > = {};
  if (options.includeSms === true) {
    if (options.smsA2pApproved !== true) {
      throw new Error('SMS inclusion requires truthful A2P approval');
    }
    if (!options.smsAgentId || !options.smsDispatchAgentId) {
      throw new Error('SMS inclusion requires both SMS agent ids');
    }
    smsFields = {
      inbound_sms_agents: [{ agent_id: options.smsAgentId, weight: 1 }],
      outbound_sms_agents: [{ agent_id: options.smsDispatchAgentId, weight: 1 }],
      inbound_sms_webhook_url: `${config.base_url}/api/messaging/inbound/retell`,
    };
  }

  return {
    createLlm: {
      model: config.agent.model,
      general_prompt: config.agent.general_prompt,
      general_tools: generalTools,
    },
    createAgent: {
      response_engine: responseEngine,
      voice_id: options.voiceId,
      webhook_url: config.agent.webhook_url,
      webhook_events: [...config.agent.webhook_events],
      ...config.agent.privacy,
    },
    updatePhone: {
      inbound_agents: inboundAgents,
      inbound_webhook_url: config.agent.inbound_webhook_url,
      ...smsFields,
    },
  };
}

const FORBIDDEN_HOST_PARTS = [
  'example',
  'placeholder',
  'your-app',
  'preview',
  'staging',
  'sandbox',
  'tunnel',
  '-git-',
  '-pr-',
] as const;
const FORBIDDEN_HOST_SUFFIXES = [
  '.test',
  '.example',
  '.invalid',
  '.localhost',
  '.local',
  '.ngrok.io',
  '.ngrok.app',
  '.ngrok-free.app',
  '.trycloudflare.com',
  '.localtunnel.me',
  '.tunnelmole.net',
  '.loca.lt',
  '.localhost.run',
  '.serveo.net',
] as const;

/**
 * Validate and canonicalize the explicit origin required by every network
 * mode. It rejects paths, credentials, ports, IPs, placeholders, preview
 * hosts, and common tunnel domains. A vercel.app host must be separately
 * allowlisted by its exact production hostname.
 */
export function requireCanonicalProductionBaseUrl(
  raw: string,
  allowedVercelHost?: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('production base URL must be a valid absolute URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowlistedVercel = allowedVercelHost?.trim().toLowerCase();
  const nonCanonical =
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search !== '' ||
    parsed.hash !== '';
  const unsafeHost =
    !hostname.includes('.') ||
    net.isIP(hostname) !== 0 ||
    hostname === 'localhost' ||
    FORBIDDEN_HOST_PARTS.some((part) => hostname.includes(part)) ||
    FORBIDDEN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  const unapprovedVercel =
    hostname.endsWith('.vercel.app') && hostname !== allowlistedVercel;

  if (nonCanonical || unsafeHost || unapprovedVercel) {
    throw new Error('production base URL must be the canonical HTTPS production origin');
  }
  return parsed.origin;
}

function isoForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function redactPhone(phone: string | undefined): string {
  if (!phone) return '<unset>';
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '****';
}

function redactId(id: string | undefined): string {
  if (!id) return '<unset>';
  if (id.length <= 10) return `${id.slice(0, 3)}…`;
  return `${id.slice(0, 7)}…${id.slice(-4)}`;
}

function pickPhoneState(phone: PhoneState): PhoneState {
  return {
    ...phone,
    inbound_agents: phone.inbound_agents ?? null,
    inbound_webhook_url: phone.inbound_webhook_url ?? null,
    inbound_sms_agents: phone.inbound_sms_agents ?? null,
    outbound_sms_agents: phone.outbound_sms_agents ?? null,
    inbound_sms_webhook_url: phone.inbound_sms_webhook_url ?? null,
  };
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

/** Create the immutable pre-write phone snapshot in its own timestamped file. */
export function createTransactionSnapshot(
  transactionDir: string,
  input: {
    now?: Date;
    productionBaseUrl: string;
    phone: string;
    phoneBefore: PhoneState;
  },
): { filePath: string; transaction: RetellTransaction } {
  if (!path.isAbsolute(transactionDir)) {
    throw new Error('transaction directory must be an absolute path');
  }
  fs.mkdirSync(transactionDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(transactionDir, 0o700);
  const now = input.now ?? new Date();
  const transactionId = `${isoForFilename(now)}-${crypto.randomBytes(6).toString('hex')}`;
  const transaction: RetellTransaction = {
    format: TRANSACTION_FORMAT,
    transaction_id: transactionId,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    stage: 'pre-write-snapshot',
    production_base_url: input.productionBaseUrl,
    phone_last4: redactPhone(input.phone),
    phone_before: pickPhoneState(input.phoneBefore),
  };
  const filePath = path.join(transactionDir, `retell-transaction-${transactionId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(transaction, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return { filePath, transaction };
}

function readTransaction(filePath: string): RetellTransaction {
  if (!path.isAbsolute(filePath)) throw new Error('transaction path must be absolute');
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('transaction path must be a regular file');
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<RetellTransaction>;
  if (
    parsed.format !== TRANSACTION_FORMAT ||
    typeof parsed.transaction_id !== 'string' ||
    typeof parsed.production_base_url !== 'string' ||
    typeof parsed.phone_last4 !== 'string' ||
    typeof parsed.phone_before !== 'object' ||
    parsed.phone_before === null
  ) {
    throw new Error('invalid Retell transaction snapshot');
  }
  return parsed as RetellTransaction;
}

function updateTransaction(
  filePath: string,
  patch: Partial<Omit<RetellTransaction, 'phone_before'>>,
): RetellTransaction {
  const current = readTransaction(filePath);
  const next: RetellTransaction = {
    ...current,
    ...patch,
    phone_before: current.phone_before,
    updated_at: new Date().toISOString(),
  };
  writeJsonAtomic(filePath, next);
  return next;
}

/** Restore touches only the prior voice binding and inbound webhook. */
export function buildRestorePhonePayload(
  before: PhoneState,
): Pick<PhoneState, 'inbound_agents' | 'inbound_webhook_url'> {
  return {
    inbound_agents: before.inbound_agents ?? null,
    inbound_webhook_url: before.inbound_webhook_url ?? null,
  };
}

function stable(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

/** Throw if a voice-only PATCH changed any SMS binding or webhook field. */
export function assertNoAccidentalSmsChange(before: PhoneState, after: PhoneState): void {
  const keys = [
    'inbound_sms_agents',
    'outbound_sms_agents',
    'inbound_sms_webhook_url',
  ] as const;
  for (const key of keys) {
    if (stable(before[key]) !== stable(after[key])) {
      throw new Error(`voice-only verification failed: phone.${key} changed`);
    }
  }
}

/** Verify that a phone PATCH did not alter fields outside its explicit scope. */
export function assertUnrelatedPhoneFieldsPreserved(
  before: PhoneState,
  after: PhoneState,
  includeSms: boolean,
): void {
  const allowed = new Set<string>([
    'inbound_agents',
    'inbound_webhook_url',
    // Provider-managed metadata is expected to advance after a successful PATCH.
    'last_modification_timestamp',
    'updated_at',
  ]);
  if (includeSms) {
    allowed.add('inbound_sms_agents');
    allowed.add('outbound_sms_agents');
    allowed.add('inbound_sms_webhook_url');
  }
  const withoutAllowed = (phone: PhoneState): Record<string, unknown> =>
    Object.fromEntries(Object.entries(phone).filter(([key]) => !allowed.has(key)));
  if (stable(withoutAllowed(before)) !== stable(withoutAllowed(after))) {
    throw new Error('phone readback failed: unrelated fields changed');
  }
}

interface CreateLlmResponse {
  llm_id?: string;
  version?: number;
}

interface CreateAgentResponse {
  agent_id?: string;
  version?: number;
  is_published?: boolean;
}

interface GetLlmResponse extends CreateLlmResponse {
  model?: string;
  general_prompt?: string;
  general_tools?: Array<Partial<RetellCustomTool>>;
}

interface GetAgentResponse extends CreateAgentResponse, Partial<RetellPrivacyConfig> {
  voice_id?: string;
  webhook_url?: string;
  webhook_events?: string[];
  response_engine?: { type?: string; llm_id?: string; version?: number };
}

interface GetVoiceResponse {
  voice_id?: string;
}

async function retellFetch(
  method: 'GET' | 'POST' | 'PATCH',
  endpoint: string,
  apiKey: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${RETELL_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Retell ${method} failed: HTTP ${response.status}`);
  const text = await response.text();
  return text.length === 0 ? {} : (JSON.parse(text) as unknown);
}

function requireCreatedId(value: string | undefined, label: string): string {
  if (!value || value.trim() === '') throw new Error(`Retell did not return ${label}`);
  return value;
}

function versionedEndpoint(endpoint: string, version: number): string {
  return `${endpoint}?version=${encodeURIComponent(String(version))}`;
}

function sorted(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].sort();
}

function verifyLlmReadback(
  llm: GetLlmResponse,
  expected: CreateLlmPayload,
  llmId: string,
  version: number,
): void {
  const problems: string[] = [];
  if (llm.llm_id !== llmId) problems.push('LLM id mismatch');
  if (llm.version !== version) problems.push('LLM version mismatch');
  if (llm.model !== expected.model) problems.push('LLM model mismatch');
  if (llm.general_prompt !== expected.general_prompt) problems.push('LLM prompt mismatch');
  const got = new Map((llm.general_tools ?? []).map((tool) => [tool.name, tool]));
  if (got.size !== expected.general_tools.length) problems.push('LLM tool count mismatch');
  for (const tool of expected.general_tools) {
    const actual = got.get(tool.name);
    if (!actual) {
      problems.push(`LLM tool missing: ${tool.name}`);
      continue;
    }
    const expectedFields: Array<keyof RetellCustomTool> = [
      'type',
      'name',
      'description',
      'url',
      'method',
      'headers',
      'parameters',
      'timeout_ms',
    ];
    for (const field of expectedFields) {
      const actualValue = field === 'headers' ? (actual[field] ?? {}) : actual[field];
      if (stable(actualValue) !== stable(tool[field])) {
        problems.push(`LLM tool ${field} mismatch: ${tool.name}`);
      }
    }
  }
  if (problems.length > 0) throw new Error(`LLM readback failed: ${problems.join('; ')}`);
}

function verifyAgentReadback(
  agent: GetAgentResponse,
  expected: CreateAgentPayload,
  agentId: string,
  version: number,
  published: boolean,
): void {
  const problems: string[] = [];
  if (agent.agent_id !== agentId) problems.push('agent id mismatch');
  if (agent.version !== version) problems.push('agent version mismatch');
  if (agent.is_published !== published) problems.push('agent publication mismatch');
  if (agent.voice_id !== expected.voice_id) problems.push('agent voice mismatch');
  if (agent.webhook_url !== expected.webhook_url) problems.push('agent webhook URL mismatch');
  if (stable(sorted(agent.webhook_events)) !== stable(sorted(expected.webhook_events))) {
    problems.push('agent webhook events mismatch');
  }
  if (agent.response_engine?.llm_id !== expected.response_engine.llm_id) {
    problems.push('response engine LLM mismatch');
  }
  if (agent.response_engine?.version !== expected.response_engine.version) {
    problems.push('response engine version mismatch');
  }
  const privacyKeys: Array<keyof RetellPrivacyConfig> = [
    'data_storage_setting',
    'data_storage_retention_days',
    'opt_in_signed_url',
    'signed_url_expiration_ms',
  ];
  for (const key of privacyKeys) {
    if (agent[key] !== expected[key]) problems.push(`agent privacy mismatch: ${key}`);
  }
  if (problems.length > 0) throw new Error(`agent readback failed: ${problems.join('; ')}`);
}

function verifyPhoneReadback(
  phone: PhoneState,
  expected: UpdatePhonePayload,
  before: PhoneState,
  includeSms: boolean,
): void {
  if (stable(phone.inbound_agents) !== stable(expected.inbound_agents)) {
    throw new Error('phone readback failed: exact versioned voice binding mismatch');
  }
  if (phone.inbound_webhook_url !== expected.inbound_webhook_url) {
    throw new Error('phone readback failed: inbound webhook URL mismatch');
  }
  if (includeSms) {
    if (
      stable(phone.inbound_sms_agents) !== stable(expected.inbound_sms_agents) ||
      stable(phone.outbound_sms_agents) !== stable(expected.outbound_sms_agents) ||
      phone.inbound_sms_webhook_url !== expected.inbound_sms_webhook_url
    ) {
      throw new Error('phone readback failed: requested SMS binding mismatch');
    }
  } else {
    assertNoAccidentalSmsChange(before, phone);
  }
  assertUnrelatedPhoneFieldsPreserved(before, phone, includeSms);
}

type Mode = 'dry-run' | 'snapshot' | 'candidate' | 'cutover' | 'verify' | 'restore';

function parseMode(args: string[]): Mode {
  if (args.includes('update') || args.includes('--update')) {
    throw new Error('update mode is disabled; create an isolated versioned candidate instead');
  }
  if (args.includes('restore') || args.includes('--restore')) return 'restore';
  if (args.includes('cutover') || args.includes('--cutover')) return 'cutover';
  if (args.includes('verify') || args.includes('--verify')) return 'verify';
  if (args.includes('snapshot') || args.includes('--snapshot')) return 'snapshot';
  if (
    args.includes('candidate') ||
    args.includes('--candidate') ||
    args.includes('commit') ||
    args.includes('--commit')
  ) return 'candidate';
  return 'dry-run';
}

function flagValue(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1).trim();
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set; refusing to run`);
  return value;
}

function resolveNetworkBaseUrl(args: string[]): string {
  const explicit = flagValue(args, '--production-base-url');
  if (!explicit) throw new Error('network modes require --production-base-url=<canonical HTTPS origin>');
  return requireCanonicalProductionBaseUrl(
    explicit,
    process.env.RETELL_CANONICAL_VERCEL_HOST,
  );
}

function resolveDryRunBaseUrl(args: string[]): string {
  const explicit = flagValue(args, '--production-base-url');
  if (explicit) {
    return requireCanonicalProductionBaseUrl(explicit, process.env.RETELL_CANONICAL_VERCEL_HOST);
  }
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://your-app.example.com').replace(/\/$/, '');
}

function resolveTransactionDir(args: string[]): string {
  const value = flagValue(args, '--transaction-dir') ?? process.env.RETELL_TRANSACTION_DIR?.trim();
  if (!value) throw new Error('snapshot/candidate requires an explicit transaction directory');
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) throw new Error('transaction directory cannot be a filesystem root');
  return resolved;
}

function resolveTransactionPath(args: string[]): string {
  const value = flagValue(args, '--transaction');
  if (!value) throw new Error('cutover/verify/restore requires --transaction=<absolute snapshot path>');
  if (!path.isAbsolute(value)) throw new Error('transaction path must be absolute');
  return value;
}

function smsOptionsFromEnv(args: string[]): Pick<
  ConfigToPayloadsOptions,
  'includeSms' | 'smsA2pApproved' | 'smsAgentId' | 'smsDispatchAgentId'
> {
  if (!args.includes('--include-sms')) return {};
  if (process.env.RETELL_SMS_A2P_APPROVED?.trim() !== 'true') {
    throw new Error('--include-sms requires RETELL_SMS_A2P_APPROVED=true');
  }
  return {
    includeSms: true,
    smsA2pApproved: true,
    smsAgentId: requireEnv('RETELL_SMS_AGENT_ID'),
    smsDispatchAgentId: requireEnv('RETELL_SMS_DISPATCH_AGENT_ID'),
  };
}

function printDryRun(payloads: RetellProvisionPayloads, baseUrl: string): void {
  const printable: RetellProvisionPayloads = {
    ...payloads,
    createAgent: {
      ...payloads.createAgent,
      voice_id: redactId(payloads.createAgent.voice_id),
      response_engine: {
        ...payloads.createAgent.response_engine,
        llm_id: redactId(payloads.createAgent.response_engine.llm_id),
      },
    },
    updatePhone: {
      ...payloads.updatePhone,
      inbound_agents: payloads.updatePhone.inbound_agents.map((agent) => ({
        ...agent,
        agent_id: redactId(agent.agent_id),
      })),
      ...(payloads.updatePhone.inbound_sms_agents
        ? {
            inbound_sms_agents: payloads.updatePhone.inbound_sms_agents.map((agent) => ({
              ...agent,
              agent_id: redactId(agent.agent_id),
            })),
          }
        : {}),
      ...(payloads.updatePhone.outbound_sms_agents
        ? {
            outbound_sms_agents: payloads.updatePhone.outbound_sms_agents.map((agent) => ({
              ...agent,
              agent_id: redactId(agent.agent_id),
            })),
          }
        : {}),
    },
  };
  process.stdout.write([
    '=== Retell provisioning: DRY-RUN (no network) ===',
    `base_url: ${baseUrl}`,
    `voice_id: ${redactId(payloads.createAgent.voice_id)}`,
    `tools: ${payloads.createLlm.general_tools.length}`,
    `sms_fields: ${'inbound_sms_agents' in payloads.updatePhone ? 'included' : 'absent'}`,
    '',
    JSON.stringify(printable, null, 2),
    '',
  ].join('\n'));
}

async function getPhone(apiKey: string, phone: string): Promise<PhoneState> {
  return (await retellFetch(
    'GET',
    `/get-phone-number/${encodeURIComponent(phone)}`,
    apiKey,
  )) as PhoneState;
}

async function runSnapshot(baseUrl: string, args: string[]): Promise<void> {
  const apiKey = requireEnv('RETELL_API_KEY');
  const phone = requireEnv('RETELL_PHONE_NUMBER');
  const before = await getPhone(apiKey, phone);
  const snapshot = createTransactionSnapshot(resolveTransactionDir(args), {
    productionBaseUrl: baseUrl,
    phone,
    phoneBefore: before,
  });
  process.stdout.write(`snapshot OK: ${snapshot.filePath} for ${redactPhone(phone)}\n`);
}

function transactionMatchesTarget(
  transaction: RetellTransaction,
  baseUrl: string,
  phone: string,
): void {
  if (transaction.production_base_url !== baseUrl) throw new Error('transaction base URL mismatch');
  if (transaction.phone_last4 !== redactPhone(phone)) throw new Error('transaction phone mismatch');
}

async function verifyPublishedCandidate(
  apiKey: string,
  config: RetellConfig,
  voiceId: string,
  transaction: RetellTransaction,
  smsOptions: ReturnType<typeof smsOptionsFromEnv>,
): Promise<RetellProvisionPayloads> {
  if (!transaction.llm || !transaction.agent) throw new Error('transaction has no created candidate');
  const expected = configToRetellPayloads(config, {
    voiceId,
    llmId: transaction.llm.id,
    llmVersion: transaction.llm.version,
    agentId: transaction.agent.id,
    agentVersion: transaction.agent.version,
    ...smsOptions,
  });
  const llm = (await retellFetch(
    'GET',
    versionedEndpoint(`/get-retell-llm/${encodeURIComponent(transaction.llm.id)}`, transaction.llm.version),
    apiKey,
  )) as GetLlmResponse;
  verifyLlmReadback(llm, expected.createLlm, transaction.llm.id, transaction.llm.version);
  const agent = (await retellFetch(
    'GET',
    versionedEndpoint(`/get-agent/${encodeURIComponent(transaction.agent.id)}`, transaction.agent.version),
    apiKey,
  )) as GetAgentResponse;
  verifyAgentReadback(agent, expected.createAgent, transaction.agent.id, transaction.agent.version, true);
  return expected;
}

export async function runCommit(baseUrl: string, args: string[]): Promise<void> {
  const apiKey = requireEnv('RETELL_API_KEY');
  const phone = requireEnv('RETELL_PHONE_NUMBER');
  const voiceId = requireEnv('RETELL_VOICE_ID');
  const smsOptions = smsOptionsFromEnv(args);
  const config = buildRetellConfig({ baseUrl });

  const phoneBefore = await getPhone(apiKey, phone);
  const snapshot = createTransactionSnapshot(resolveTransactionDir(args), {
    productionBaseUrl: baseUrl,
    phone,
    phoneBefore,
  });
  const transactionPath = snapshot.filePath;

  const voice = (await retellFetch(
    'GET',
    `/get-voice/${encodeURIComponent(voiceId)}`,
    apiKey,
  )) as GetVoiceResponse;
  if (voice.voice_id !== voiceId) throw new Error('voice readback failed');

  const initial = configToRetellPayloads(config, { voiceId, ...smsOptions });
  const llmCreated = (await retellFetch(
    'POST',
    '/create-retell-llm',
    apiKey,
    initial.createLlm,
  )) as CreateLlmResponse;
  const llmId = requireCreatedId(llmCreated.llm_id, 'llm_id');
  const llmVersion = requireNumericVersion(llmCreated.version, 'created LLM version');
  updateTransaction(transactionPath, {
    stage: 'llm-created',
    llm: { id: llmId, version: llmVersion },
  });

  const versioned = configToRetellPayloads(config, {
    voiceId,
    llmId,
    llmVersion,
    ...smsOptions,
  });
  const llmReadback = (await retellFetch(
    'GET',
    versionedEndpoint(`/get-retell-llm/${encodeURIComponent(llmId)}`, llmVersion),
    apiKey,
  )) as GetLlmResponse;
  verifyLlmReadback(llmReadback, versioned.createLlm, llmId, llmVersion);

  const agentCreated = (await retellFetch(
    'POST',
    '/create-agent',
    apiKey,
    versioned.createAgent,
  )) as CreateAgentResponse;
  const agentId = requireCreatedId(agentCreated.agent_id, 'agent_id');
  const agentVersion = requireNumericVersion(agentCreated.version, 'created agent version');
  updateTransaction(transactionPath, {
    stage: 'agent-created',
    agent: { id: agentId, version: agentVersion, is_published: false },
  });

  const pinned = configToRetellPayloads(config, {
    voiceId,
    llmId,
    llmVersion,
    agentId,
    agentVersion,
    ...smsOptions,
  });
  const draftReadback = (await retellFetch(
    'GET',
    versionedEndpoint(`/get-agent/${encodeURIComponent(agentId)}`, agentVersion),
    apiKey,
  )) as GetAgentResponse;
  verifyAgentReadback(draftReadback, pinned.createAgent, agentId, agentVersion, false);

  await retellFetch(
    'POST',
    `/publish-agent-version/${encodeURIComponent(agentId)}`,
    apiKey,
    { version: agentVersion },
  );
  const publishedReadback = (await retellFetch(
    'GET',
    versionedEndpoint(`/get-agent/${encodeURIComponent(agentId)}`, agentVersion),
    apiKey,
  )) as GetAgentResponse;
  verifyAgentReadback(publishedReadback, pinned.createAgent, agentId, agentVersion, true);
  updateTransaction(transactionPath, {
    stage: 'candidate-published',
    agent: { id: agentId, version: agentVersion, is_published: true },
    phone_after_expected: pinned.updatePhone,
  });

  process.stdout.write(
    `candidate OK: llm ${redactId(llmId)} v${llmVersion}, agent ${redactId(agentId)} v${agentVersion} published; phone ${redactPhone(phone)} unchanged; transaction ${transactionPath}\n`,
  );
}

export async function runCutover(baseUrl: string, args: string[]): Promise<void> {
  if (!args.includes('--confirm-cutover')) {
    throw new Error('cutover requires --confirm-cutover');
  }
  const transactionPath = resolveTransactionPath(args);
  const transaction = readTransaction(transactionPath);
  if (
    transaction.stage !== 'candidate-published' ||
    transaction.agent?.is_published !== true ||
    !transaction.phone_after_expected
  ) {
    throw new Error('cutover requires a verified candidate-published transaction');
  }

  const apiKey = requireEnv('RETELL_API_KEY');
  const phone = requireEnv('RETELL_PHONE_NUMBER');
  const voiceId = requireEnv('RETELL_VOICE_ID');
  transactionMatchesTarget(transaction, baseUrl, phone);
  const smsOptions = smsOptionsFromEnv(args);
  const expected = await verifyPublishedCandidate(
    apiKey,
    buildRetellConfig({ baseUrl }),
    voiceId,
    transaction,
    smsOptions,
  );
  if (stable(expected.updatePhone) !== stable(transaction.phone_after_expected)) {
    throw new Error('cutover options do not match the published candidate transaction');
  }

  const immediatelyBeforePatch = pickPhoneState(await getPhone(apiKey, phone));
  if (stable(immediatelyBeforePatch) !== stable(transaction.phone_before)) {
    throw new Error('phone changed after snapshot; refusing stale cutover');
  }

  try {
    await retellFetch(
      'PATCH',
      `/update-phone-number/${encodeURIComponent(phone)}`,
      apiKey,
      expected.updatePhone,
    );
    const phoneReadback = pickPhoneState(await getPhone(apiKey, phone));
    verifyPhoneReadback(
      phoneReadback,
      expected.updatePhone,
      transaction.phone_before,
      smsOptions.includeSms === true,
    );
  } catch (error) {
    const voiceRestore = buildRestorePhonePayload(transaction.phone_before);
    const restorePayload = {
      ...voiceRestore,
      ...(smsOptions.includeSms === true
        ? {
            inbound_sms_agents: transaction.phone_before.inbound_sms_agents ?? null,
            outbound_sms_agents: transaction.phone_before.outbound_sms_agents ?? null,
            inbound_sms_webhook_url: transaction.phone_before.inbound_sms_webhook_url ?? null,
          }
        : {}),
    };
    updateTransaction(transactionPath, { stage: 'automatic-rollback-started' });
    await retellFetch(
      'PATCH',
      `/update-phone-number/${encodeURIComponent(phone)}`,
      apiKey,
      restorePayload,
    );
    const restored = pickPhoneState(await getPhone(apiKey, phone));
    if (
      stable(restored.inbound_agents) !== stable(voiceRestore.inbound_agents) ||
      stable(restored.inbound_webhook_url) !== stable(voiceRestore.inbound_webhook_url)
    ) {
      throw new Error('phone cutover failed and automatic rollback could not be verified');
    }
    try {
      assertNoAccidentalSmsChange(transaction.phone_before, restored);
      assertUnrelatedPhoneFieldsPreserved(transaction.phone_before, restored, false);
    } catch {
      throw new Error('phone cutover failed and automatic rollback left unrelated drift');
    }
    updateTransaction(transactionPath, {
      stage: 'automatic-rollback-verified',
      restored_at: new Date().toISOString(),
    });
    throw new Error(
      `phone cutover failed; automatic rollback verified (${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }

  updateTransaction(transactionPath, {
    stage: 'cutover-verified',
    cutover_at: new Date().toISOString(),
  });
  process.stdout.write(
    `cutover OK: agent ${redactId(transaction.agent.id)} v${transaction.agent.version} pinned to ${redactPhone(phone)}; transaction ${transactionPath}\n`,
  );
}

async function runVerify(baseUrl: string, args: string[]): Promise<void> {
  const apiKey = requireEnv('RETELL_API_KEY');
  const phone = requireEnv('RETELL_PHONE_NUMBER');
  const voiceId = requireEnv('RETELL_VOICE_ID');
  const transaction = readTransaction(resolveTransactionPath(args));
  transactionMatchesTarget(transaction, baseUrl, phone);
  const smsOptions = smsOptionsFromEnv(args);
  const expected = await verifyPublishedCandidate(
    apiKey,
    buildRetellConfig({ baseUrl }),
    voiceId,
    transaction,
    smsOptions,
  );
  if (
    transaction.phone_after_expected &&
    stable(expected.updatePhone) !== stable(transaction.phone_after_expected)
  ) {
    throw new Error('verify options do not match the published candidate transaction');
  }
  process.stdout.write(
    `candidate verify OK: llm ${redactId(transaction.llm?.id)} v${transaction.llm?.version}, agent ${redactId(transaction.agent?.id)} v${transaction.agent?.version}; phone ${redactPhone(phone)} binding not required\n`,
  );
}

async function runRestore(baseUrl: string, args: string[]): Promise<void> {
  if (!args.includes('--confirm-restore')) {
    throw new Error('restore requires --confirm-restore');
  }
  const apiKey = requireEnv('RETELL_API_KEY');
  const phone = requireEnv('RETELL_PHONE_NUMBER');
  const transactionPath = resolveTransactionPath(args);
  const transaction = readTransaction(transactionPath);
  transactionMatchesTarget(transaction, baseUrl, phone);
  const restorePayload = buildRestorePhonePayload(transaction.phone_before);
  const immediatelyBeforeRestore = pickPhoneState(await getPhone(apiKey, phone));
  await retellFetch(
    'PATCH',
    `/update-phone-number/${encodeURIComponent(phone)}`,
    apiKey,
    restorePayload,
  );
  const restored = await getPhone(apiKey, phone);
  if (
    stable(restored.inbound_agents) !== stable(restorePayload.inbound_agents) ||
    stable(restored.inbound_webhook_url) !== stable(restorePayload.inbound_webhook_url)
  ) {
    throw new Error('restore readback failed');
  }
  assertUnrelatedPhoneFieldsPreserved(immediatelyBeforeRestore, restored, false);
  updateTransaction(transactionPath, {
    stage: 'restored',
    restored_at: new Date().toISOString(),
  });
  process.stdout.write(`restore OK: prior voice binding/webhook restored for ${redactPhone(phone)}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseMode(args);
  if (mode === 'dry-run') {
    const voiceId = requireEnv('RETELL_VOICE_ID');
    const baseUrl = resolveDryRunBaseUrl(args);
    const config = buildRetellConfig({ baseUrl });
    printDryRun(
      configToRetellPayloads(config, { voiceId, ...smsOptionsFromEnv(args) }),
      baseUrl,
    );
    return;
  }

  const baseUrl = resolveNetworkBaseUrl(args);
  if (mode === 'snapshot') return runSnapshot(baseUrl, args);
  if (mode === 'candidate') return runCommit(baseUrl, args);
  if (mode === 'cutover') return runCutover(baseUrl, args);
  if (mode === 'verify') return runVerify(baseUrl, args);
  return runRestore(baseUrl, args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `retell-provision failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

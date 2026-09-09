/** Offline unit coverage for the Retell candidate mapper and safety gates. */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  agentToolNames,
  buildRetellConfig,
  RETELL_PRIVACY,
} from '../src/lib/voice/providers/retell-config';
import {
  assertNoAccidentalSmsChange,
  assertUnrelatedPhoneFieldsPreserved,
  buildRestorePhonePayload,
  configToRetellPayloads,
  createTransactionSnapshot,
  requireCanonicalProductionBaseUrl,
  runCommit,
  runCutover,
} from './retell-provision';

const BASE_URL = 'https://app.odesa.example.org';
const VOICE_ID = 'retell-Cimo';
const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const directory of tempDirs.splice(0)) {
    if (directory.startsWith(os.tmpdir() + path.sep)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installCandidateFetch(transactionDir: string, published = true) {
  let llmBody: Record<string, unknown> | undefined;
  let agentBody: Record<string, unknown> | undefined;
  let phoneBody: Record<string, unknown> | undefined;
  const observed: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  const priorSms = [{ agent_id: 'existing_sms', weight: 1 }];

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : undefined;
    observed.push({ method, url, body });

    if (method === 'GET' && url.includes('/get-phone-number/') && phoneBody === undefined) {
      return jsonResponse({
        inbound_agents: [{ agent_id: 'prior_voice', agent_version: 2, weight: 1 }],
        inbound_webhook_url: 'https://prior.odesa.ai/inbound',
        inbound_sms_agents: priorSms,
        outbound_sms_agents: priorSms,
        inbound_sms_webhook_url: 'https://prior.odesa.ai/sms',
      });
    }
    if (method === 'GET' && url.endsWith('/get-voice/voice_candidate')) {
      return jsonResponse({ voice_id: 'voice_candidate', provider: 'retell' });
    }
    if (method === 'POST' && url.endsWith('/create-retell-llm')) {
      const files = fs.readdirSync(transactionDir);
      expect(files).toHaveLength(1);
      const beforeWrite = JSON.parse(
        fs.readFileSync(path.join(transactionDir, files[0]!), 'utf8'),
      ) as Record<string, unknown>;
      expect(beforeWrite.stage).toBe('pre-write-snapshot');
      expect(beforeWrite).not.toHaveProperty('llm');
      llmBody = body;
      return jsonResponse({ llm_id: 'llm_candidate_123', version: 3 });
    }
    if (method === 'GET' && url.endsWith('/get-retell-llm/llm_candidate_123?version=3')) {
      return jsonResponse({ ...llmBody, llm_id: 'llm_candidate_123', version: 3 });
    }
    if (method === 'POST' && url.endsWith('/create-agent')) {
      agentBody = body;
      return jsonResponse({ agent_id: 'agent_candidate_456', version: 5, is_published: false });
    }
    if (method === 'GET' && url.endsWith('/get-agent/agent_candidate_456?version=5')) {
      const alreadyPublished = observed.some((call) => call.url.includes('/publish-agent-version/'));
      return jsonResponse({
        ...agentBody,
        agent_id: 'agent_candidate_456',
        version: 5,
        is_published: alreadyPublished && published,
      });
    }
    if (method === 'POST' && url.endsWith('/publish-agent-version/agent_candidate_456')) {
      return jsonResponse({});
    }
    if (method === 'PATCH' && url.includes('/update-phone-number/')) {
      phoneBody = body;
      return jsonResponse({});
    }
    if (method === 'GET' && url.includes('/get-phone-number/') && phoneBody !== undefined) {
      return jsonResponse({
        ...phoneBody,
        inbound_sms_agents: priorSms,
        outbound_sms_agents: priorSms,
        inbound_sms_webhook_url: 'https://prior.odesa.ai/sms',
      });
    }
    throw new Error(`unexpected mocked Retell request: ${method} ${url}`);
  }));

  return observed;
}

function build() {
  const config = buildRetellConfig({ baseUrl: BASE_URL });
  return { config, payloads: configToRetellPayloads(config, { voiceId: VOICE_ID }) };
}

describe('configToRetellPayloads', () => {
  it('maps the safe initial LLM config with no static tool bearer', () => {
    const { config, payloads } = build();
    expect(payloads.createLlm.model).toBe('gpt-5.5');
    expect(payloads.createLlm.general_prompt).toBe(config.agent.general_prompt);
    expect(payloads.createLlm.general_tools.map((tool) => tool.name).sort()).toEqual(
      agentToolNames().sort(),
    );
    expect(payloads.createLlm.general_tools).toHaveLength(10);
    for (const tool of payloads.createLlm.general_tools) {
      expect(tool.url).toBe(`${BASE_URL}/api/retell/tools/${tool.name}`);
      expect(tool.headers).toEqual({});
      expect(JSON.stringify(tool)).not.toContain('RETELL_API_KEY');
      expect(tool.type).toBe('custom');
      expect(tool.method).toBe('POST');
    }
  });

  it('sets explicit conservative privacy and retention on the agent', () => {
    const { payloads } = build();
    expect(payloads.createAgent).toMatchObject(RETELL_PRIVACY);
    expect(payloads.createAgent.webhook_url).toBe(`${BASE_URL}/api/retell/webhook`);
    expect(payloads.createAgent.webhook_events).toEqual([
      'call_started',
      'call_ended',
      'call_analyzed',
    ]);
  });

  it('pins the exact numeric LLM and phone-agent versions when supplied', () => {
    const config = buildRetellConfig({ baseUrl: BASE_URL });
    const payloads = configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      llmId: 'llm_candidate',
      llmVersion: 7,
      agentId: 'agent_candidate',
      agentVersion: 11,
    });
    expect(payloads.createAgent.response_engine).toEqual({
      type: 'retell-llm',
      llm_id: 'llm_candidate',
      version: 7,
    });
    expect(payloads.updatePhone.inbound_agents).toEqual([
      { agent_id: 'agent_candidate', agent_version: 11, weight: 1 },
    ]);
  });

  it('rejects non-numeric, fractional, or negative candidate versions', () => {
    const config = buildRetellConfig({ baseUrl: BASE_URL });
    expect(() => configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      llmVersion: Number.NaN,
    })).toThrow(/numeric version/);
    expect(() => configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      agentId: 'agent_candidate',
      agentVersion: 1.5,
    })).toThrow(/numeric version/);
    expect(() => configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      llmVersion: -1,
    })).toThrow(/numeric version/);
  });

  it('is voice-only by default even when SMS ids or approval are present', () => {
    const config = buildRetellConfig({ baseUrl: BASE_URL });
    const { updatePhone } = configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      agentId: 'agent_voice',
      smsA2pApproved: true,
      smsAgentId: 'agent_sms',
      smsDispatchAgentId: 'agent_dispatch',
    });
    expect(updatePhone).toEqual({
      inbound_agents: [{ agent_id: 'agent_voice', weight: 1 }],
      inbound_webhook_url: `${BASE_URL}/api/retell/inbound`,
    });
    expect(Object.keys(updatePhone).some((key) => key.includes('sms'))).toBe(false);
  });

  it('requires both explicit SMS inclusion and truthful A2P approval', () => {
    const config = buildRetellConfig({ baseUrl: BASE_URL });
    expect(() => configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      includeSms: true,
      smsA2pApproved: false,
      smsAgentId: 'agent_sms',
      smsDispatchAgentId: 'agent_dispatch',
    })).toThrow(/A2P approval/);
    expect(() => configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      includeSms: true,
      smsA2pApproved: true,
      smsAgentId: 'agent_sms',
    })).toThrow(/both SMS agent ids/);

    const { updatePhone } = configToRetellPayloads(config, {
      voiceId: VOICE_ID,
      includeSms: true,
      smsA2pApproved: true,
      smsAgentId: 'agent_sms',
      smsDispatchAgentId: 'agent_dispatch',
    });
    expect(updatePhone.inbound_sms_agents).toEqual([{ agent_id: 'agent_sms', weight: 1 }]);
    expect(updatePhone.outbound_sms_agents).toEqual([{ agent_id: 'agent_dispatch', weight: 1 }]);
    expect(updatePhone.inbound_sms_webhook_url).toBe(
      `${BASE_URL}/api/messaging/inbound/retell`,
    );
  });
});

describe('canonical production base URL gate', () => {
  it('accepts only a canonical HTTPS production origin', () => {
    expect(requireCanonicalProductionBaseUrl('https://app.odesa.ai/')).toBe(
      'https://app.odesa.ai',
    );
    expect(
      requireCanonicalProductionBaseUrl('https://odesa.vercel.app', 'odesa.vercel.app'),
    ).toBe('https://odesa.vercel.app');
  });

  it.each([
    'http://app.odesa.ai',
    'https://app.odesa.ai/api',
    'https://preview.odesa.ai',
    'https://odesa-staging.example.org',
    'https://your-app.example.com',
    'https://candidate.ngrok-free.app',
    'https://127.0.0.1',
    'https://localhost',
    'https://odesa.vercel.app',
    'https://odesa-git-main-team.vercel.app',
  ])('rejects non-production or non-canonical URL %s', (url) => {
    expect(() => requireCanonicalProductionBaseUrl(url)).toThrow(/canonical HTTPS production/);
  });
});

describe('transaction snapshot and restore', () => {
  it('writes a timestamped private pre-write snapshot before any candidate ids exist', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odesa-retell-'));
    tempDirs.push(directory);
    const result = createTransactionSnapshot(directory, {
      now: new Date('2026-08-11T12:34:56.789Z'),
      productionBaseUrl: 'https://app.odesa.ai',
      phone: '+15551234567',
      phoneBefore: {
        inbound_agents: [{ agent_id: 'prior_agent', agent_version: 4, weight: 1 }],
        inbound_webhook_url: 'https://prior.example.org/inbound',
        inbound_sms_agents: [{ agent_id: 'prior_sms', weight: 1 }],
      },
    });

    expect(path.basename(result.filePath)).toMatch(
      /^retell-transaction-2026-08-11T12-34-56-789Z-[0-9a-f]{12}\.json$/,
    );
    expect(result.transaction.stage).toBe('pre-write-snapshot');
    expect(result.transaction).not.toHaveProperty('llm');
    expect(result.transaction).not.toHaveProperty('agent');
    expect(result.transaction.phone_last4).toBe('***4567');
    expect(JSON.stringify(result.transaction)).not.toContain('+15551234567');
    expect(result.transaction.phone_before.inbound_agents).toEqual([
      { agent_id: 'prior_agent', agent_version: 4, weight: 1 },
    ]);
    expect(fs.statSync(result.filePath).mode & 0o777).toBe(0o600);
  });

  it('builds an executable restore PATCH containing only prior voice fields', () => {
    const payload = buildRestorePhonePayload({
      inbound_agents: [{ agent_id: 'prior_agent', agent_version: 4, weight: 1 }],
      inbound_webhook_url: 'https://prior.example.org/inbound',
      inbound_sms_agents: [{ agent_id: 'keep_sms', weight: 1 }],
      inbound_sms_webhook_url: 'https://prior.example.org/sms',
    });
    expect(payload).toEqual({
      inbound_agents: [{ agent_id: 'prior_agent', agent_version: 4, weight: 1 }],
      inbound_webhook_url: 'https://prior.example.org/inbound',
    });
    expect(Object.keys(payload)).toEqual(['inbound_agents', 'inbound_webhook_url']);
  });

  it('detects any accidental SMS mutation while tolerating absent/null normalization', () => {
    expect(() => assertNoAccidentalSmsChange({}, {
      inbound_sms_agents: null,
      outbound_sms_agents: null,
      inbound_sms_webhook_url: null,
    })).not.toThrow();
    expect(() => assertNoAccidentalSmsChange(
      { inbound_sms_agents: [{ agent_id: 'sms_old', weight: 1 }] },
      { inbound_sms_agents: [{ agent_id: 'sms_new', weight: 1 }] },
    )).toThrow(/inbound_sms_agents changed/);
  });

  it('detects changes to unrelated phone fields while allowing voice cutover metadata', () => {
    expect(() => assertUnrelatedPhoneFieldsPreserved(
      { country_code: 'US', inbound_agents: [], last_modification_timestamp: 1 },
      {
        country_code: 'US',
        inbound_agents: [{ agent_id: 'new_voice', agent_version: 2, weight: 1 }],
        last_modification_timestamp: 2,
      },
      false,
    )).not.toThrow();
    expect(() => assertUnrelatedPhoneFieldsPreserved(
      { country_code: 'US', inbound_agents: [] },
      { country_code: 'CA', inbound_agents: [] },
      false,
    )).toThrow(/unrelated fields changed/);
  });
});

describe('two-phase candidate and cutover orchestration (mocked provider)', () => {
  function prepare(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odesa-retell-commit-'));
    tempDirs.push(directory);
    vi.stubEnv('RETELL_API_KEY', 'offline-test-api-key');
    vi.stubEnv('RETELL_PHONE_NUMBER', '+15551234567');
    vi.stubEnv('RETELL_VOICE_ID', 'voice_candidate');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    return directory;
  }

  function transactionPath(directory: string): string {
    return path.join(directory, fs.readdirSync(directory)[0]!);
  }

  it('snapshots and publishes the exact candidate with zero phone PATCHes', async () => {
    const directory = prepare();
    const observed = installCandidateFetch(directory);

    await runCommit('https://app.odesa.ai', [`--transaction-dir=${directory}`]);

    const createAgent = observed.find((call) => call.url.endsWith('/create-agent'));
    expect(createAgent?.body?.response_engine).toEqual({
      type: 'retell-llm',
      llm_id: 'llm_candidate_123',
      version: 3,
    });
    const publish = observed.find((call) => call.url.includes('/publish-agent-version/'));
    expect(publish).toEqual(expect.objectContaining({
      method: 'POST',
      body: { version: 5 },
    }));
    expect(observed.some((call) => call.method === 'PATCH')).toBe(false);

    const llmGets = observed.filter((call) => call.url.includes('/get-retell-llm/'));
    const agentGets = observed.filter((call) => call.url.includes('/get-agent/'));
    expect(llmGets.every((call) => call.url.endsWith('?version=3'))).toBe(true);
    expect(agentGets.every((call) => call.url.endsWith('?version=5'))).toBe(true);
    const transaction = JSON.parse(
      fs.readFileSync(transactionPath(directory), 'utf8'),
    ) as Record<string, unknown>;
    expect(transaction.stage).toBe('candidate-published');
    expect(transaction.agent).toEqual({
      id: 'agent_candidate_456',
      version: 5,
      is_published: true,
    });
    expect(transaction.phone_after_expected).toEqual({
      inbound_agents: [{ agent_id: 'agent_candidate_456', agent_version: 5, weight: 1 }],
      inbound_webhook_url: 'https://app.odesa.ai/api/retell/inbound',
    });
  });

  it('makes cutover impossible without explicit confirmation and performs no new request', async () => {
    const directory = prepare();
    const observed = installCandidateFetch(directory);
    await runCommit('https://app.odesa.ai', [`--transaction-dir=${directory}`]);
    const requestsBeforeCutover = observed.length;

    await expect(runCutover('https://app.odesa.ai', [
      `--transaction=${transactionPath(directory)}`,
    ])).rejects.toThrow(/--confirm-cutover/);
    expect(observed).toHaveLength(requestsBeforeCutover);
    expect(observed.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('re-verifies the candidate and cuts over only from the confirmed transaction', async () => {
    const directory = prepare();
    const observed = installCandidateFetch(directory);
    await runCommit('https://app.odesa.ai', [`--transaction-dir=${directory}`]);
    const requestsBeforeCutover = observed.length;

    await runCutover('https://app.odesa.ai', [
      `--transaction=${transactionPath(directory)}`,
      '--confirm-cutover',
    ]);

    const cutoverCalls = observed.slice(requestsBeforeCutover);
    expect(cutoverCalls.some((call) => call.url.endsWith(
      '/get-retell-llm/llm_candidate_123?version=3',
    ))).toBe(true);
    expect(cutoverCalls.some((call) => call.url.endsWith(
      '/get-agent/agent_candidate_456?version=5',
    ))).toBe(true);
    const phonePatch = cutoverCalls.find((call) => call.method === 'PATCH');
    expect(phonePatch?.body).toEqual({
      inbound_agents: [{ agent_id: 'agent_candidate_456', agent_version: 5, weight: 1 }],
      inbound_webhook_url: 'https://app.odesa.ai/api/retell/inbound',
    });
    expect(Object.keys(phonePatch?.body ?? {}).some((key) => key.includes('sms'))).toBe(false);
    const transaction = JSON.parse(
      fs.readFileSync(transactionPath(directory), 'utf8'),
    ) as Record<string, unknown>;
    expect(transaction.stage).toBe('cutover-verified');
  });

  it('fails closed before the phone PATCH when exact-version publication is not confirmed', async () => {
    const directory = prepare();
    const observed = installCandidateFetch(directory, false);

    await expect(
      runCommit('https://app.odesa.ai', [`--transaction-dir=${directory}`]),
    ).rejects.toThrow(/publication mismatch/);
    expect(observed.some((call) => call.method === 'PATCH')).toBe(false);
  });
});

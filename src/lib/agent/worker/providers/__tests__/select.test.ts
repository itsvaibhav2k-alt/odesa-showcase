import { describe, expect, it, vi } from 'vitest';

import { HostedHaikuProvider } from '../hosted-haiku';
import { OllamaProvider } from '../ollama';
import {
  PrivacyModeMisconfiguredError,
  selectProvider,
} from '../select';
import type { WorkerModelProvider } from '../types';

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: vi.fn() };
  }
  return { default: MockAnthropic };
});

describe('selectProvider', () => {
  it('returns HostedHaikuProvider when privacyMode=hosted', () => {
    const provider = selectProvider({ privacyMode: 'hosted' });
    expect(provider).toBeInstanceOf(HostedHaikuProvider);
    expect(provider.name).toBe('haiku-4-5');
  });

  it('returns OllamaProvider when privacyMode=on_prem with a host', () => {
    const provider = selectProvider({
      privacyMode: 'on_prem',
      ollamaHost: 'http://mac-studio.local:11434',
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama-llama3.3');
  });

  it('passes ollamaModel override through to OllamaProvider', () => {
    const captured: Array<{ host: string; model?: string }> = [];
    const provider = selectProvider(
      {
        privacyMode: 'on_prem',
        ollamaHost: 'http://x:11434',
        ollamaModel: 'qwen2.5:72b',
      },
      {},
      {
        ollamaFactory: (cfg) => {
          captured.push(cfg);
          return { name: 'mock' } as WorkerModelProvider;
        },
      },
    );
    expect(provider.name).toBe('mock');
    expect(captured).toEqual([
      { host: 'http://x:11434', model: 'qwen2.5:72b' },
    ]);
  });

  it('picks Sonnet 4.6 for draft_sms_reply (hosted mode)', () => {
    const provider = selectProvider(
      { privacyMode: 'hosted' },
      { actionType: 'draft_sms_reply' },
    );
    expect(provider).toBeInstanceOf(HostedHaikuProvider);
    expect(provider.name).toBe('sonnet-4-6');
  });

  it('picks Haiku 4.5 for classify_intent (hosted mode)', () => {
    const provider = selectProvider(
      { privacyMode: 'hosted' },
      { actionType: 'classify_intent' },
    );
    expect(provider.name).toBe('haiku-4-5');
  });

  it('picks Opus 4.7 for update_rulebook (hosted mode)', () => {
    const provider = selectProvider(
      { privacyMode: 'hosted' },
      { actionType: 'update_rulebook' },
    );
    expect(provider.name).toBe('opus-4-7');
  });

  it('honours per-action env override', () => {
    const prev = process.env.WORKER_MODEL_DRAFT_SMS_REPLY;
    process.env.WORKER_MODEL_DRAFT_SMS_REPLY = 'claude-opus-4-7';
    try {
      const provider = selectProvider(
        { privacyMode: 'hosted' },
        { actionType: 'draft_sms_reply' },
      );
      expect(provider.name).toBe('opus-4-7');
    } finally {
      if (prev === undefined) {
        delete process.env.WORKER_MODEL_DRAFT_SMS_REPLY;
      } else {
        process.env.WORKER_MODEL_DRAFT_SMS_REPLY = prev;
      }
    }
  });

  it('falls back to Haiku default when actionType is omitted', () => {
    const provider = selectProvider({ privacyMode: 'hosted' });
    expect(provider.name).toBe('haiku-4-5');
  });

  it('throws PrivacyModeMisconfiguredError when on_prem has no host', () => {
    expect(() =>
      selectProvider({ privacyMode: 'on_prem', ollamaHost: null }),
    ).toThrow(PrivacyModeMisconfiguredError);

    expect(() =>
      selectProvider({ privacyMode: 'on_prem', ollamaHost: '' }),
    ).toThrow(PrivacyModeMisconfiguredError);

    expect(() =>
      selectProvider({ privacyMode: 'on_prem', ollamaHost: '   ' }),
    ).toThrow(PrivacyModeMisconfiguredError);
  });

  it('respects hostedFactory override for tests', () => {
    const stub = { name: 'stub-hosted' } as WorkerModelProvider;
    const provider = selectProvider(
      { privacyMode: 'hosted' },
      {},
      { hostedFactory: () => stub },
    );
    expect(provider).toBe(stub);
  });

  it('respects ollamaFactory override for tests', () => {
    const stub = { name: 'stub-ollama' } as WorkerModelProvider;
    const provider = selectProvider(
      { privacyMode: 'on_prem', ollamaHost: 'http://x' },
      {},
      { ollamaFactory: () => stub },
    );
    expect(provider).toBe(stub);
  });
});

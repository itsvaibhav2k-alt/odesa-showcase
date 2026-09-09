/**
 * Unit tests for `use-inbox-realtime.ts`.
 *
 * The hook subscribes to a Supabase realtime channel and debounces
 * incoming events at 250 ms. We mock `@/lib/supabase/client` so each
 * test can introspect:
 *
 *   - the channel name used (`inbox:${orgId}`)
 *   - which `postgres_changes` filters were registered
 *   - debounced behaviour: N rapid events => 1 onChange
 *   - cleanup: `removeChannel` called on unmount, no further onChange
 *
 * Vitest fake timers drive the 250 ms trailing window so the suite
 * stays sub-100 ms per case. The mocked channel records every `on()`
 * call so we can assert filter shape verbatim.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Hoisted shared state so the vi.mock factory and the tests reference
// the same objects across `vi.resetModules()` invocations would otherwise
// give us fresh module copies.
type RealtimeListener = (payload: unknown) => void;

interface OnCall {
  type: string;
  config: {
    event?: string;
    schema?: string;
    table?: string;
    filter?: string;
  };
  callback: RealtimeListener;
}

interface MockChannel {
  name: string;
  onCalls: OnCall[];
  subscribeStatus: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
  on: Mock;
  subscribe: Mock;
  unsubscribe: Mock;
}

interface MockClient {
  channel: Mock;
  removeChannel: Mock;
  channels: MockChannel[];
}

const mockState: { client: MockClient | null } = { client: null };

function freshChannel(name: string): MockChannel {
  const ch: MockChannel = {
    name,
    onCalls: [],
    subscribeStatus: 'SUBSCRIBED',
    on: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  ch.on.mockImplementation(
    (
      type: string,
      config: OnCall['config'],
      callback: RealtimeListener,
    ): MockChannel => {
      ch.onCalls.push({ type, config, callback });
      return ch;
    },
  );
  ch.subscribe.mockImplementation(
    (cb?: (status: MockChannel['subscribeStatus']) => void): MockChannel => {
      cb?.(ch.subscribeStatus);
      return ch;
    },
  );
  return ch;
}

function freshClient(): MockClient {
  const client: MockClient = {
    channels: [],
    channel: vi.fn(),
    removeChannel: vi.fn(),
  };
  client.channel.mockImplementation((name: string): MockChannel => {
    const ch = freshChannel(name);
    client.channels.push(ch);
    return ch;
  });
  return client;
}

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    if (!mockState.client) {
      throw new Error('mock client not initialised');
    }
    return mockState.client;
  },
}));

// Import AFTER vi.mock so the hook resolves to the mock.
import { useInboxRealtime } from '@/components/inbox/use-inbox-realtime';

describe('useInboxRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockState.client = freshClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockState.client = null;
  });

  it('subscribes to the per-org channel on mount', () => {
    const onChange = vi.fn();
    renderHook(() => useInboxRealtime('org-abc', onChange));

    const client = mockState.client!;
    expect(client.channel).toHaveBeenCalledWith('inbox:org-abc');
    expect(client.channels).toHaveLength(1);
    expect(client.channels[0].subscribe).toHaveBeenCalledTimes(1);
  });

  it('registers postgres_changes handlers for messages + action_proposals', () => {
    renderHook(() => useInboxRealtime('org-abc', vi.fn()));
    const ch = mockState.client!.channels[0];
    const tables = ch.onCalls.map((c) => `${c.config.table}:${c.config.event}`);
    expect(tables).toEqual(
      expect.arrayContaining([
        'messages:INSERT',
        'messages:UPDATE',
        'action_proposals:INSERT',
        'action_proposals:UPDATE',
      ]),
    );
    // Every handler is the postgres_changes type filtered by org id.
    for (const call of ch.onCalls) {
      expect(call.type).toBe('postgres_changes');
      expect(call.config.schema).toBe('public');
      expect(call.config.filter).toBe('organization_id=eq.org-abc');
    }
  });

  it('debounces multiple rapid events into a single onChange', () => {
    const onChange = vi.fn();
    renderHook(() => useInboxRealtime('org-abc', onChange));

    const ch = mockState.client!.channels[0];
    const handlers = ch.onCalls.map((c) => c.callback);

    act(() => {
      handlers[0]({});
      handlers[1]({});
      handlers[2]({});
      handlers[3]({});
    });

    // No fire yet — within debounce window.
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('coalesces events landing across multiple debounce windows', () => {
    const onChange = vi.fn();
    renderHook(() => useInboxRealtime('org-abc', onChange));
    const ch = mockState.client!.channels[0];
    const fire = ch.onCalls[0].callback;

    act(() => {
      fire({});
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => {
      fire({});
      fire({});
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('cleans up via removeChannel on unmount', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() =>
      useInboxRealtime('org-abc', onChange),
    );
    const client = mockState.client!;
    const ch = client.channels[0];

    unmount();

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledWith(ch);
  });

  it('does not invoke onChange after unmount even if a trailing timer was pending', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() =>
      useInboxRealtime('org-abc', onChange),
    );
    const ch = mockState.client!.channels[0];
    const fire = ch.onCalls[0].callback;

    act(() => {
      fire({});
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('is a no-op when orgId is empty', () => {
    renderHook(() => useInboxRealtime('', vi.fn()));
    expect(mockState.client!.channel).not.toHaveBeenCalled();
  });

  it('logs a warning once when subscribe reports a non-SUBSCRIBED status', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Custom client where the channel reports CHANNEL_ERROR.
    const client = freshClient();
    client.channel.mockImplementation((name: string) => {
      const ch = freshChannel(name);
      ch.subscribeStatus = 'CHANNEL_ERROR';
      client.channels.push(ch);
      return ch;
    });
    mockState.client = client;

    renderHook(() => useInboxRealtime('org-abc', vi.fn()));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/CHANNEL_ERROR/);
    warnSpy.mockRestore();
  });
});

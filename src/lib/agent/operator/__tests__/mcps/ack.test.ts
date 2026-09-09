/**
 * Unit tests for the ack MCP.
 *
 * `createSdkMcpServer` returns an MCP wrapper around our tool
 * definitions. Rather than poke at its private surface, we drive the
 * tool handler directly — the factory wires the same closure either
 * way, so testing the closure is the more durable contract.
 */

import { describe, expect, it, vi } from 'vitest';

import { createAckMcp, type CreateAckMcpDeps } from '../../mcps/ack';
import type { DispatcherEvent } from '../../types';

interface Harness {
  emitted: DispatcherEvent[];
  inlineCalls: string[];
  inlineFn: ReturnType<typeof vi.fn>;
  deps: CreateAckMcpDeps;
}

function harness(
  channel: CreateAckMcpDeps['channel'],
  inlineBehavior: 'ok' | 'throws' | 'omit' = 'ok',
): Harness {
  const emitted: DispatcherEvent[] = [];
  const inlineCalls: string[] = [];
  const inlineFn = vi.fn(async (text: string) => {
    inlineCalls.push(text);
    if (inlineBehavior === 'throws') {
      throw new Error('linq down');
    }
  });
  const deps: CreateAckMcpDeps = {
    channel,
    emit: (ev) => {
      emitted.push(ev);
    },
    sendInline: inlineBehavior === 'omit' ? undefined : inlineFn,
  };
  return { emitted, inlineCalls, inlineFn, deps };
}

interface ToolDefShape {
  handler: (
    args: { message: string },
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getSendAckHandler(server: unknown): ToolDefShape['handler'] {
  // The SDK's createSdkMcpServer returns an opaque wrapper; surface
  // the handler we registered. In every observed shape the tool ends
  // up reachable via `instance._registeredTools[name]` OR the top-
  // level `tools` array we passed in. Try both.
  const s = server as McpServerShape;
  const fromInstance = s.instance?._registeredTools?.send_ack;
  if (fromInstance) return fromInstance.handler;
  const fromTools = s.tools?.find(
    (t) => (t as unknown as { name?: string }).name === 'send_ack',
  );
  if (fromTools) return fromTools.handler;
  throw new Error('send_ack handler not found on MCP server');
}

describe('createAckMcp', () => {
  it('should emit ack event and call sendInline on imessage channel', async () => {
    const { deps, emitted, inlineCalls } = harness('imessage');
    const server = createAckMcp(deps);
    const handler = getSendAckHandler(server);

    const result = await handler({ message: 'on it' }, {});

    expect(inlineCalls).toEqual(['on it']);
    expect(emitted).toEqual([{ type: 'ack', text: 'on it' }]);
    expect(result.content[0]?.text).toBe('Ack sent.');
  });

  it('should emit ack event but NOT call sendInline on web channel', async () => {
    const { deps, emitted, inlineFn } = harness('web');
    const server = createAckMcp(deps);
    const handler = getSendAckHandler(server);

    await handler({ message: 'pulling that up' }, {});

    expect(inlineFn).not.toHaveBeenCalled();
    expect(emitted).toEqual([{ type: 'ack', text: 'pulling that up' }]);
  });

  it('should emit ack event but NOT call sendInline on mcp channel', async () => {
    const { deps, emitted, inlineFn } = harness('mcp');
    const server = createAckMcp(deps);
    const handler = getSendAckHandler(server);

    await handler({ message: 'thinking' }, {});

    expect(inlineFn).not.toHaveBeenCalled();
    expect(emitted).toEqual([{ type: 'ack', text: 'thinking' }]);
  });

  it('should swallow sendInline failures and still emit + return success', async () => {
    const { deps, emitted } = harness('imessage', 'throws');
    const server = createAckMcp(deps);
    const handler = getSendAckHandler(server);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await handler({ message: 'working on it' }, {});

    expect(emitted).toEqual([{ type: 'ack', text: 'working on it' }]);
    expect(result.content[0]?.text).toBe('Ack sent.');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('should still emit when sendInline is omitted on imessage channel', async () => {
    const { deps, emitted } = harness('imessage', 'omit');
    const server = createAckMcp(deps);
    const handler = getSendAckHandler(server);

    await handler({ message: 'one sec' }, {});

    expect(emitted).toEqual([{ type: 'ack', text: 'one sec' }]);
  });
});

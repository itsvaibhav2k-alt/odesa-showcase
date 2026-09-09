/**
 * retell-config tests — the config is code-derived, so these assert it stays
 * honest against the real code it mirrors: every mapped tool has a definition,
 * every definition points at a route that exists on disk, and the built prompt
 * names every tool. Behavioral, not snapshot.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

import { describe, expect, it } from 'vitest';

import { buildVoiceAgentPrompt } from '../../agent-prompt';
import { defaultSettings } from '../../settings';
import { VOICE_ACTION_TOOL_MAP } from '../../tool-map';
import {
  agentToolNames,
  buildRetellConfig,
  RETELL_MODEL,
  RETELL_PRIVACY,
  RETELL_TOOL_TIMEOUT_MS,
  RETELL_WEBHOOK_EVENTS,
} from '../retell-config';

const ROUTES_DIR = resolve(__dirname, '../../../../app/api/retell/tools');

describe('retell-config', () => {
  describe('buildRetellToolDefinitions', () => {
    it('should define the safe initial tool set and keep direct messaging dark', () => {
      const { tools } = buildRetellConfig();
      const definedNames = tools.map((t) => t.name).sort();

      expect(definedNames).toEqual(agentToolNames().sort());
      expect(definedNames).toHaveLength(10);
      expect(definedNames).not.toContain('send_sms_followup');
      expect(definedNames).not.toContain('escalate_to_landlord');
      expect(definedNames).toContain('create_followup_sms_draft');
      // The always-on tools the prompt requires but VOICE_ACTION_TOOL_MAP omits.
      // report_intents is the policy brain — omitting it lets the agent act
      // WITHOUT the deterministic policy engine, the exact bypass we forbid.
      expect(definedNames).toContain('report_intents');
      expect(definedNames).toContain('lookup_tenant_by_phone');
      expect(definedNames).toContain('confirm_emergency');
    });

    it('should expose the full mapped set only after separate messaging approval', () => {
      const { tools } = buildRetellConfig({ directMessagingApproved: true });
      expect(tools).toHaveLength(12);
      const byName = new Set(tools.map((t) => t.name));
      for (const tool of Object.values(VOICE_ACTION_TOOL_MAP)) {
        if (tool !== null) expect(byName.has(tool)).toBe(true);
      }
    });

    it('should point every definition at a route file that exists on disk', () => {
      const { tools } = buildRetellConfig();
      for (const tool of tools) {
        const routeFile = resolve(ROUTES_DIR, tool.name, 'route.ts');
        expect(existsSync(routeFile), `missing route for ${tool.name}`).toBe(true);
      }
    });

    it('should build tool urls from the base url and the real provider shape', () => {
      const { tools } = buildRetellConfig({ baseUrl: 'https://ex.test' });
      const rent = tools.find((t) => t.name === 'get_rent_status');
      expect(rent).toBeDefined();
      expect(rent?.url).toBe('https://ex.test/api/retell/tools/get_rent_status');
      expect(rent?.method).toBe('POST');
      expect(rent?.timeout_ms).toBe(RETELL_TOOL_TIMEOUT_MS);
    });

    it('should emit no static bearer or provider-held secret', () => {
      const { tools } = buildRetellConfig();
      for (const tool of tools) {
        expect(tool.headers).toEqual([]);
        expect(JSON.stringify(tool)).not.toContain('RETELL_API_KEY');
        expect(JSON.stringify(tool)).not.toContain('Authorization');
      }
    });

    it('should mirror route arg schemas (required args, enums) not the flat shape', () => {
      const { tools } = buildRetellConfig();
      const callback = tools.find((t) => t.name === 'schedule_callback');
      expect(callback?.parameters.required).toEqual(['preferred_time', 'topic']);
      // call metadata is NOT an LLM arg — must be absent from the schema
      expect(callback?.parameters.properties).not.toHaveProperty('from_number');

      const workOrder = tools.find((t) => t.name === 'create_work_order');
      expect(workOrder?.parameters.required).toEqual(['description']);
      expect(workOrder?.parameters.properties.urgency.enum).toContain('emergency');

      const rent = tools.find((t) => t.name === 'get_rent_status');
      expect(rent?.parameters.properties).toEqual({});
    });
  });

  describe('buildRetellAgentConfig', () => {
    it('should use a current verified in-enum model id', () => {
      const { agent } = buildRetellConfig();
      expect(agent.model).toBe(RETELL_MODEL);
      // Must stay within Retell's verified create-retell-llm model enum (research §4).
      const VERIFIED_ENUM = ['gpt-5.5', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'claude-5-sonnet', 'claude-4.6-sonnet', 'claude-4.5-sonnet'];
      expect(VERIFIED_ENUM).toContain(agent.model);
    });

    it('should limit webhook events to the three handled events', () => {
      const { agent } = buildRetellConfig();
      expect(agent.webhook_events).toEqual(RETELL_WEBHOOK_EVENTS);
      expect([...agent.webhook_events].sort()).toEqual(
        ['call_analyzed', 'call_ended', 'call_started'],
      );
    });

    it('should set env-aware webhook and inbound urls', () => {
      const { agent } = buildRetellConfig({ baseUrl: 'https://ex.test' });
      expect(agent.webhook_url).toBe('https://ex.test/api/retell/webhook');
      expect(agent.inbound_webhook_url).toBe('https://ex.test/api/retell/inbound');
    });

    it('should build the prompt from buildVoiceAgentPrompt and name every tool', () => {
      const { agent, tools } = buildRetellConfig();
      const expectedPrompt = buildVoiceAgentPrompt(defaultSettings('config-export'));
      expect(agent.general_prompt).toBe(expectedPrompt);
      for (const tool of tools) {
        expect(agent.general_prompt, `prompt is missing tool ${tool.name}`).toContain(tool.name);
      }
      expect(agent.general_prompt).not.toContain('within 24 hours');
      expect(agent.general_prompt).not.toContain('send_sms_followup');
    });

    it('should fail away from provider defaults with conservative explicit privacy', () => {
      expect(buildRetellConfig().agent.privacy).toEqual(RETELL_PRIVACY);
      const privacy = {
        data_storage_setting: 'everything_except_pii' as const,
        data_storage_retention_days: 30,
        opt_in_signed_url: true,
        signed_url_expiration_ms: 86_400_000,
      };
      expect(buildRetellConfig({ privacy }).agent.privacy).toEqual(privacy);
    });

    it('should expose the privacy-gated dynamic variable names', () => {
      const { agent } = buildRetellConfig();
      expect(agent.dynamic_variable_names).toContain('caller_name');
      expect(agent.dynamic_variable_names).toContain('ledger_status_line');
    });
  });
});

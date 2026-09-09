export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      action_proposals: {
        Row: {
          action_type: string;
          committed_at: string | null;
          confidence: number;
          context_fact_ids: string[] | null;
          created_at: string;
          edit_diff: Json | null;
          execution_evidence: Json | null;
          gate_decision: string;
          id: string;
          organization_id: string;
          outcome: Json | null;
          payload: Json;
          property_id: string;
          reasoning: string;
          rejected_at: string | null;
          retell_artifact_key: string | null;
          retryable: boolean;
          routing: Json | null;
          status: string;
          last_attempted_at: string | null;
          worker_model: string;
        };
        Insert: {
          action_type: string;
          committed_at?: string | null;
          confidence: number;
          context_fact_ids?: string[] | null;
          created_at?: string;
          edit_diff?: Json | null;
          execution_evidence?: Json | null;
          gate_decision: string;
          id?: string;
          organization_id: string;
          outcome?: Json | null;
          payload: Json;
          property_id: string;
          reasoning: string;
          rejected_at?: string | null;
          retell_artifact_key?: string | null;
          retryable?: boolean;
          routing?: Json | null;
          status?: string;
          last_attempted_at?: string | null;
          worker_model: string;
        };
        Update: {
          action_type?: string;
          committed_at?: string | null;
          confidence?: number;
          context_fact_ids?: string[] | null;
          created_at?: string;
          edit_diff?: Json | null;
          execution_evidence?: Json | null;
          gate_decision?: string;
          id?: string;
          organization_id?: string;
          outcome?: Json | null;
          payload?: Json;
          property_id?: string;
          reasoning?: string;
          rejected_at?: string | null;
          retell_artifact_key?: string | null;
          retryable?: boolean;
          routing?: Json | null;
          status?: string;
          last_attempted_at?: string | null;
          worker_model?: string;
        };
        Relationships: [
          {
            foreignKeyName: "action_proposals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_proposals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "action_proposals_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_runs: {
        Row: {
          channel: string;
          chat_id: string;
          created_at: string;
          error: string | null;
          error_notified_at: string | null;
          finished_at: string | null;
          heartbeat_at: string | null;
          id: string;
          message: string;
          organization_id: string;
          property_hint: Json | null;
          reply_text: string | null;
          reply_to_e164: string | null;
          started_at: string | null;
          status: string;
          surface: string;
          turn_id: string;
          user_id: string;
        };
        Insert: {
          channel: string;
          chat_id: string;
          created_at?: string;
          error?: string | null;
          error_notified_at?: string | null;
          finished_at?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          message: string;
          organization_id: string;
          property_hint?: Json | null;
          reply_text?: string | null;
          reply_to_e164?: string | null;
          started_at?: string | null;
          status?: string;
          surface: string;
          turn_id: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          chat_id?: string;
          created_at?: string;
          error?: string | null;
          error_notified_at?: string | null;
          finished_at?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          message?: string;
          organization_id?: string;
          property_hint?: Json | null;
          reply_text?: string | null;
          reply_to_e164?: string | null;
          started_at?: string | null;
          status?: string;
          surface?: string;
          turn_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_chat_id_fkey";
            columns: ["chat_id"];
            isOneToOne: false;
            referencedRelation: "operator_chats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "agent_runs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      appliances: {
        Row: {
          confidence: number;
          created_at: string;
          id: string;
          install_date: string | null;
          last_service_date: string | null;
          make: string | null;
          model: string | null;
          notes: string | null;
          organization_id: string;
          property_id: string;
          serial_number: string | null;
          source: string;
          type: string;
          unit_id: string | null;
          updated_at: string;
          warranty_expires_at: string | null;
        };
        Insert: {
          confidence?: number;
          created_at?: string;
          id?: string;
          install_date?: string | null;
          last_service_date?: string | null;
          make?: string | null;
          model?: string | null;
          notes?: string | null;
          organization_id: string;
          property_id: string;
          serial_number?: string | null;
          source?: string;
          type: string;
          unit_id?: string | null;
          updated_at?: string;
          warranty_expires_at?: string | null;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          id?: string;
          install_date?: string | null;
          last_service_date?: string | null;
          make?: string | null;
          model?: string | null;
          notes?: string | null;
          organization_id?: string;
          property_id?: string;
          serial_number?: string | null;
          source?: string;
          type?: string;
          unit_id?: string | null;
          updated_at?: string;
          warranty_expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "appliances_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appliances_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "appliances_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appliances_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          channel: Database["public"]["Enums"]["conversation_channel"];
          created_at: string;
          id: string;
          last_message_at: string | null;
          muted: boolean;
          organization_id: string;
          property_id: string | null;
          retell_artifact_key: string | null;
          snoozed_until: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          summary: string | null;
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          channel: Database["public"]["Enums"]["conversation_channel"];
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          muted?: boolean;
          organization_id: string;
          property_id?: string | null;
          retell_artifact_key?: string | null;
          snoozed_until?: string | null;
          status?: Database["public"]["Enums"]["conversation_status"];
          summary?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          channel?: Database["public"]["Enums"]["conversation_channel"];
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          muted?: boolean;
          organization_id?: string;
          property_id?: string | null;
          retell_artifact_key?: string | null;
          snoozed_until?: string | null;
          status?: Database["public"]["Enums"]["conversation_status"];
          summary?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "conversations_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_digests: {
        Row: {
          created_at: string;
          digest_date: string;
          id: string;
          organization_id: string;
          sections: Json;
          version: number;
          window_end: string;
          window_start: string;
        };
        Insert: {
          created_at?: string;
          digest_date: string;
          id?: string;
          organization_id: string;
          sections: Json;
          version?: number;
          window_end: string;
          window_start: string;
        };
        Update: {
          created_at?: string;
          digest_date?: string;
          id?: string;
          organization_id?: string;
          sections?: Json;
          version?: number;
          window_end?: string;
          window_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_digests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_digests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      documents: {
        Row: {
          accountant_evidence_class: string | null;
          created_at: string;
          expiry_date: string | null;
          file_key: string | null;
          id: string;
          lease_id: string | null;
          organization_id: string;
          property_id: string | null;
          tenant_id: string | null;
          title: string;
          type: string;
          unit_id: string | null;
          updated_at: string;
          uploaded_by: string | null;
          vendor_id: string | null;
        };
        Insert: {
          accountant_evidence_class?: string | null;
          created_at?: string;
          expiry_date?: string | null;
          file_key?: string | null;
          id?: string;
          lease_id?: string | null;
          organization_id: string;
          property_id?: string | null;
          tenant_id?: string | null;
          title: string;
          type: string;
          unit_id?: string | null;
          updated_at?: string;
          uploaded_by?: string | null;
          vendor_id?: string | null;
        };
        Update: {
          accountant_evidence_class?: string | null;
          created_at?: string;
          expiry_date?: string | null;
          file_key?: string | null;
          id?: string;
          lease_id?: string | null;
          organization_id?: string;
          property_id?: string | null;
          tenant_id?: string | null;
          title?: string;
          type?: string;
          unit_id?: string | null;
          updated_at?: string;
          uploaded_by?: string | null;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "documents_organization_lease_fkey";
            columns: ["organization_id", "lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "documents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "documents_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      inbound_webhook_dedup: {
        Row: {
          provider: string;
          provider_message_id: string;
          received_at: string;
        };
        Insert: {
          provider: string;
          provider_message_id: string;
          received_at?: string;
        };
        Update: {
          provider?: string;
          provider_message_id?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      import_entities: {
        Row: {
          created_at: string;
          entity_id: string;
          entity_type: string;
          import_request_id: string;
          natural_key: string;
          organization_id: string;
        };
        Insert: {
          created_at?: string;
          entity_id: string;
          entity_type: string;
          import_request_id: string;
          natural_key: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          import_request_id?: string;
          natural_key?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_entities_import_request_id_fkey";
            columns: ["import_request_id"];
            isOneToOne: false;
            referencedRelation: "import_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_entities_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      import_requests: {
        Row: {
          completed_at: string;
          created_at: string;
          id: string;
          idempotency_key: string;
          organization_id: string;
          payload_hash: string;
          result: Json;
          source: string;
        };
        Insert: {
          completed_at?: string;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          organization_id: string;
          payload_hash: string;
          result: Json;
          source: string;
        };
        Update: {
          completed_at?: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          organization_id?: string;
          payload_hash?: string;
          result?: Json;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      leases: {
        Row: {
          created_at: string;
          end_date: string | null;
          id: string;
          late_fee_policy: Json;
          organization_id: string;
          rent_amount: number;
          rent_due_day: number;
          source_aero_id: string | null;
          start_date: string | null;
          status: Database["public"]["Enums"]["lease_status"];
          tenant_id: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          end_date?: string | null;
          id?: string;
          late_fee_policy?: Json;
          organization_id: string;
          rent_amount: number;
          rent_due_day: number;
          source_aero_id?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["lease_status"];
          tenant_id: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          end_date?: string | null;
          id?: string;
          late_fee_policy?: Json;
          organization_id?: string;
          rent_amount?: number;
          rent_due_day?: number;
          source_aero_id?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["lease_status"];
          tenant_id?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leases_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leases_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "leases_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leases_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      maintenance_tickets: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          photos: Json;
          property_id: string;
          reported_by: string | null;
          severity: string;
          status: string;
          summary: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          photos?: Json;
          property_id: string;
          reported_by?: string | null;
          severity?: string;
          status?: string;
          summary: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          photos?: Json;
          property_id?: string;
          reported_by?: string | null;
          severity?: string;
          status?: string;
          summary?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_tickets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_tickets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "maintenance_tickets_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_tickets_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      mcp_api_keys: {
        Row: {
          created_at: string;
          id: string;
          key_hash: string;
          key_prefix: string;
          label: string;
          last_used_at: string | null;
          organization_id: string;
          revoked_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          key_hash: string;
          key_prefix: string;
          label?: string;
          last_used_at?: string | null;
          organization_id: string;
          revoked_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          label?: string;
          last_used_at?: string | null;
          organization_id?: string;
          revoked_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mcp_api_keys_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mcp_api_keys_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "mcp_api_keys_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      membership_capability_overrides: {
        Row: {
          capability: string;
          created_at: string;
          effect: string;
          id: string;
          membership_id: string;
          updated_at: string;
        };
        Insert: {
          capability: string;
          created_at?: string;
          effect: string;
          id?: string;
          membership_id: string;
          updated_at?: string;
        };
        Update: {
          capability?: string;
          created_at?: string;
          effect?: string;
          id?: string;
          membership_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "membership_capability_overrides_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "organization_memberships";
            referencedColumns: ["id"];
          },
        ];
      };
      membership_property_grants: {
        Row: {
          created_at: string;
          id: string;
          membership_id: string;
          organization_id: string;
          property_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          membership_id: string;
          organization_id: string;
          property_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          membership_id?: string;
          organization_id?: string;
          property_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "membership_property_grants_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "organization_memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membership_property_grants_membership_org_fkey";
            columns: ["membership_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "organization_memberships";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "membership_property_grants_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membership_property_grants_property_org_fkey";
            columns: ["organization_id", "property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      memory_facts: {
        Row: {
          confidence: number;
          content: Json;
          created_at: string;
          embedding: string | null;
          evidence_proposal_ids: string[] | null;
          fact_type: string;
          id: string;
          organization_id: string;
          property_id: string;
          source: string;
          subject_id: string | null;
          superseded_at: string | null;
          superseded_by: string | null;
        };
        Insert: {
          confidence?: number;
          content: Json;
          created_at?: string;
          embedding?: string | null;
          evidence_proposal_ids?: string[] | null;
          fact_type: string;
          id?: string;
          organization_id: string;
          property_id: string;
          source: string;
          subject_id?: string | null;
          superseded_at?: string | null;
          superseded_by?: string | null;
        };
        Update: {
          confidence?: number;
          content?: Json;
          created_at?: string;
          embedding?: string | null;
          evidence_proposal_ids?: string[] | null;
          fact_type?: string;
          id?: string;
          organization_id?: string;
          property_id?: string;
          source?: string;
          subject_id?: string | null;
          superseded_at?: string | null;
          superseded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "memory_facts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memory_facts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "memory_facts_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memory_facts_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "memory_facts";
            referencedColumns: ["id"];
          },
        ];
      };
      message_delivery_callback_inbox: {
        Row: {
          dispatch_id: string | null;
          id: string;
          message_id: string | null;
          occurred_at: string | null;
          organization_id: string | null;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_event_id: string;
          provider_message_id: string;
          raw_payload: Json;
          received_at: string;
          status: Database["public"]["Enums"]["message_delivery_status"];
        };
        Insert: {
          dispatch_id?: string | null;
          id?: string;
          message_id?: string | null;
          occurred_at?: string | null;
          organization_id?: string | null;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_event_id: string;
          provider_message_id: string;
          raw_payload?: Json;
          received_at?: string;
          status: Database["public"]["Enums"]["message_delivery_status"];
        };
        Update: Partial<
          Database["public"]["Tables"]["message_delivery_callback_inbox"]["Insert"]
        >;
        Relationships: [];
      };
      message_delivery_events: {
        Row: {
          dispatch_id: string;
          id: string;
          message_id: string | null;
          occurred_at: string | null;
          organization_id: string;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_event_id: string;
          provider_message_id: string;
          raw_payload: Json;
          received_at: string;
          status: Database["public"]["Enums"]["message_delivery_status"];
        };
        Insert: {
          dispatch_id: string;
          id?: string;
          message_id?: string | null;
          occurred_at?: string | null;
          organization_id: string;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_event_id: string;
          provider_message_id: string;
          raw_payload?: Json;
          received_at?: string;
          status: Database["public"]["Enums"]["message_delivery_status"];
        };
        Update: Partial<
          Database["public"]["Tables"]["message_delivery_events"]["Insert"]
        >;
        Relationships: [];
      };
      message_lifecycle_events: {
        Row: {
          from_status:
            | Database["public"]["Enums"]["message_delivery_status"]
            | null;
          id: string;
          message_id: string;
          occurred_at: string;
          organization_id: string;
          to_status: Database["public"]["Enums"]["message_delivery_status"];
        };
        Insert: {
          from_status?:
            | Database["public"]["Enums"]["message_delivery_status"]
            | null;
          id?: string;
          message_id: string;
          occurred_at?: string;
          organization_id: string;
          to_status: Database["public"]["Enums"]["message_delivery_status"];
        };
        Update: Partial<
          Database["public"]["Tables"]["message_lifecycle_events"]["Insert"]
        >;
        Relationships: [];
      };
      messaging_consent_command_events: {
        Row: {
          command: string;
          event_key: string;
          id: string;
          occurred_at: string | null;
          organization_id: string;
          provider: Database["public"]["Enums"]["message_provider"] | null;
          provider_message_id: string | null;
          received_at: string;
          recipient_e164: string;
        };
        Insert: {
          command: string;
          event_key: string;
          id?: string;
          occurred_at?: string | null;
          organization_id: string;
          provider?: Database["public"]["Enums"]["message_provider"] | null;
          provider_message_id?: string | null;
          received_at?: string;
          recipient_e164: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["messaging_consent_command_events"]["Insert"]
        >;
        Relationships: [];
      };
      messaging_consent_transitions: {
        Row: {
          command: string;
          command_event_id: string;
          consent_id: string;
          from_state: Database["public"]["Enums"]["messaging_consent_state"];
          id: string;
          metadata: Json;
          occurred_at: string;
          organization_id: string;
          provider: Database["public"]["Enums"]["message_provider"] | null;
          provider_message_id: string | null;
          recipient_e164: string;
          to_state: Database["public"]["Enums"]["messaging_consent_state"];
        };
        Insert: {
          command: string;
          command_event_id: string;
          consent_id: string;
          from_state: Database["public"]["Enums"]["messaging_consent_state"];
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          organization_id: string;
          provider?: Database["public"]["Enums"]["message_provider"] | null;
          provider_message_id?: string | null;
          recipient_e164: string;
          to_state: Database["public"]["Enums"]["messaging_consent_state"];
        };
        Update: Partial<
          Database["public"]["Tables"]["messaging_consent_transitions"]["Insert"]
        >;
        Relationships: [];
      };
      messaging_recipient_consents: {
        Row: {
          created_at: string;
          id: string;
          last_transition_at: string | null;
          last_transition_event_key: string | null;
          last_transition_had_provider_time: boolean;
          last_transition_rank: number;
          organization_id: string;
          recipient_e164: string;
          state: Database["public"]["Enums"]["messaging_consent_state"];
          transition_version: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_transition_at?: string | null;
          last_transition_event_key?: string | null;
          last_transition_had_provider_time?: boolean;
          last_transition_rank?: number;
          organization_id: string;
          recipient_e164: string;
          state?: Database["public"]["Enums"]["messaging_consent_state"];
          transition_version?: number;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["messaging_recipient_consents"]["Insert"]
        >;
        Relationships: [];
      };
      outbound_message_attempts: {
        Row: {
          attempt_number: number;
          completed_at: string | null;
          created_at: string;
          dispatch_id: string;
          error: string | null;
          id: string;
          lease_expires_at: string;
          lease_token: string;
          network_started_at: string | null;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_message_id: string | null;
          status: string;
        };
        Insert: {
          attempt_number: number;
          completed_at?: string | null;
          created_at?: string;
          dispatch_id: string;
          error?: string | null;
          id?: string;
          lease_expires_at: string;
          lease_token?: string;
          network_started_at?: string | null;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_message_id?: string | null;
          status: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["outbound_message_attempts"]["Insert"]
        >;
        Relationships: [];
      };
      outbound_message_dispatches: {
        Row: {
          attempt_count: number;
          body_sha256: string;
          created_at: string;
          id: string;
          idempotency_key: string;
          last_error: string | null;
          message_id: string | null;
          organization_id: string;
          provider: Database["public"]["Enums"]["message_provider"] | null;
          provider_message_id: string | null;
          recipient_e164: string;
          status: Database["public"]["Enums"]["message_delivery_status"];
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          body_sha256: string;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          last_error?: string | null;
          message_id?: string | null;
          organization_id: string;
          provider?: Database["public"]["Enums"]["message_provider"] | null;
          provider_message_id?: string | null;
          recipient_e164: string;
          status?: Database["public"]["Enums"]["message_delivery_status"];
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["outbound_message_dispatches"]["Insert"]
        >;
        Relationships: [];
      };
      messages: {
        Row: {
          body: string | null;
          conversation_id: string;
          created_at: string;
          delivered_at: string | null;
          delivery_error: string | null;
          delivery_status: Database["public"]["Enums"]["message_delivery_status"];
          delivery_status_updated_at: string;
          direction: Database["public"]["Enums"]["message_direction"];
          draft_status: Database["public"]["Enums"]["message_draft_status"];
          id: string;
          idempotency_key: string | null;
          organization_id: string;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_accepted_at: string | null;
          provider_message_id: string | null;
          recipient_e164: string | null;
          retell_artifact_key: string | null;
          sent_at: string | null;
        };
        Insert: {
          body?: string | null;
          conversation_id: string;
          created_at?: string;
          delivered_at?: string | null;
          delivery_error?: string | null;
          delivery_status?: Database["public"]["Enums"]["message_delivery_status"];
          delivery_status_updated_at?: string;
          direction: Database["public"]["Enums"]["message_direction"];
          draft_status?: Database["public"]["Enums"]["message_draft_status"];
          id?: string;
          idempotency_key?: string | null;
          organization_id: string;
          provider: Database["public"]["Enums"]["message_provider"];
          provider_accepted_at?: string | null;
          provider_message_id?: string | null;
          recipient_e164?: string | null;
          retell_artifact_key?: string | null;
          sent_at?: string | null;
        };
        Update: {
          body?: string | null;
          conversation_id?: string;
          created_at?: string;
          delivered_at?: string | null;
          delivery_error?: string | null;
          delivery_status?: Database["public"]["Enums"]["message_delivery_status"];
          delivery_status_updated_at?: string;
          direction?: Database["public"]["Enums"]["message_direction"];
          draft_status?: Database["public"]["Enums"]["message_draft_status"];
          id?: string;
          idempotency_key?: string | null;
          organization_id?: string;
          provider?: Database["public"]["Enums"]["message_provider"];
          provider_accepted_at?: string | null;
          provider_message_id?: string | null;
          recipient_e164?: string | null;
          retell_artifact_key?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      meta_insights: {
        Row: {
          acknowledged_at: string | null;
          acted_on_at: string | null;
          affected_property_ids: string[] | null;
          created_at: string;
          id: string;
          insight: string;
          organization_id: string;
          pattern_type: string;
          recommended_action: Json | null;
        };
        Insert: {
          acknowledged_at?: string | null;
          acted_on_at?: string | null;
          affected_property_ids?: string[] | null;
          created_at?: string;
          id?: string;
          insight: string;
          organization_id: string;
          pattern_type: string;
          recommended_action?: Json | null;
        };
        Update: {
          acknowledged_at?: string | null;
          acted_on_at?: string | null;
          affected_property_ids?: string[] | null;
          created_at?: string;
          id?: string;
          insight?: string;
          organization_id?: string;
          pattern_type?: string;
          recommended_action?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "meta_insights_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meta_insights_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      oauth_tokens: {
        Row: {
          access_token: string;
          account_email: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          organization_id: string;
          provider: string;
          refresh_token: string;
          scope: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token: string;
          account_email?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          organization_id: string;
          provider: string;
          refresh_token: string;
          scope?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token?: string;
          account_email?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          provider?: string;
          refresh_token?: string;
          scope?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "oauth_tokens_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oauth_tokens_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "oauth_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      operator_chat_turns: {
        Row: {
          body: string | null;
          chat_id: string;
          created_at: string;
          id: string;
          organization_id: string;
          proposal_id: string | null;
          role: string;
          tool_input: Json | null;
          tool_name: string | null;
          tool_result: Json | null;
          tool_use_id: string | null;
          turn_id: string;
        };
        Insert: {
          body?: string | null;
          chat_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          proposal_id?: string | null;
          role: string;
          tool_input?: Json | null;
          tool_name?: string | null;
          tool_result?: Json | null;
          tool_use_id?: string | null;
          turn_id: string;
        };
        Update: {
          body?: string | null;
          chat_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          proposal_id?: string | null;
          role?: string;
          tool_input?: Json | null;
          tool_name?: string | null;
          tool_result?: Json | null;
          tool_use_id?: string | null;
          turn_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operator_chat_turns_chat_id_fkey";
            columns: ["chat_id"];
            isOneToOne: false;
            referencedRelation: "operator_chats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operator_chat_turns_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operator_chat_turns_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "operator_chat_turns_proposal_id_fkey";
            columns: ["proposal_id"];
            isOneToOne: false;
            referencedRelation: "action_proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      operator_chats: {
        Row: {
          channel: string;
          created_at: string;
          id: string;
          last_message_at: string | null;
          organization_id: string;
          property_id: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          channel: string;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          organization_id: string;
          property_id?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          organization_id?: string;
          property_id?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operator_chats_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operator_chats_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "operator_chats_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operator_chats_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_invitation_property_grants: {
        Row: {
          created_at: string;
          id: string;
          invitation_id: string;
          organization_id: string;
          property_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          invitation_id: string;
          organization_id: string;
          property_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          invitation_id?: string;
          organization_id?: string;
          property_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_invitation_grants_invitation_org_fkey";
            columns: ["invitation_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "organization_invitations";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "organization_invitation_grants_property_org_fkey";
            columns: ["organization_id", "property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      organization_invitations: {
        Row: {
          accepted_at: string | null;
          all_properties: boolean;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          organization_id: string;
          revoked_at: string | null;
          role: Database["public"]["Enums"]["user_role"];
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          all_properties?: boolean;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invited_by?: string | null;
          organization_id: string;
          revoked_at?: string | null;
          role: Database["public"]["Enums"]["user_role"];
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          all_properties?: boolean;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          organization_id?: string;
          revoked_at?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      organization_memberships: {
        Row: {
          all_properties: boolean;
          created_at: string;
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["user_role"];
          status: Database["public"]["Enums"]["membership_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          all_properties?: boolean;
          created_at?: string;
          id?: string;
          organization_id: string;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          all_properties?: boolean;
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          assistant_name: string;
          created_at: string;
          id: string;
          linq_account_id: string | null;
          messaging_primary: Database["public"]["Enums"]["messaging_provider_choice"];
          name: string;
          odesa_phone_number: string | null;
          plan: Database["public"]["Enums"]["organization_plan"];
          slug: string | null;
          source_aero_id: string | null;
          timezone: string;
          twilio_account_id: string | null;
          updated_at: string;
          voice_enabled: boolean;
        };
        Insert: {
          assistant_name?: string;
          created_at?: string;
          id?: string;
          linq_account_id?: string | null;
          messaging_primary?: Database["public"]["Enums"]["messaging_provider_choice"];
          name: string;
          odesa_phone_number?: string | null;
          plan?: Database["public"]["Enums"]["organization_plan"];
          slug?: string | null;
          source_aero_id?: string | null;
          timezone?: string;
          twilio_account_id?: string | null;
          updated_at?: string;
          voice_enabled?: boolean;
        };
        Update: {
          assistant_name?: string;
          created_at?: string;
          id?: string;
          linq_account_id?: string | null;
          messaging_primary?: Database["public"]["Enums"]["messaging_provider_choice"];
          name?: string;
          odesa_phone_number?: string | null;
          plan?: Database["public"]["Enums"]["organization_plan"];
          slug?: string | null;
          source_aero_id?: string | null;
          timezone?: string;
          twilio_account_id?: string | null;
          updated_at?: string;
          voice_enabled?: boolean;
        };
        Relationships: [];
      };
      phone_verifications: {
        Row: {
          attempts: number;
          code_hash: string;
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          organization_id: string;
          phone_e164: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          organization_id: string;
          phone_e164: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          phone_e164?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "phone_verifications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "phone_verifications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "phone_verifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      portal_otps: {
        Row: {
          attempts: number;
          code_hash: string;
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          organization_id: string;
          phone_e164: string;
          tenant_id: string;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          organization_id: string;
          phone_e164: string;
          tenant_id: string;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          phone_e164?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "portal_otps_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "portal_otps_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "portal_otps_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          phone_e164: string | null;
          phone_verified_at: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          phone_e164?: string | null;
          phone_verified_at?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          phone_e164?: string | null;
          phone_verified_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          address_city: string | null;
          address_state: string | null;
          address_street: string | null;
          address_zip: string | null;
          archived_at: string | null;
          autonomy_level: number;
          created_at: string;
          id: string;
          name: string;
          ollama_host: string | null;
          organization_id: string;
          privacy_mode: string;
          rules_text: string;
          source_aero_id: string | null;
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          address_city?: string | null;
          address_state?: string | null;
          address_street?: string | null;
          address_zip?: string | null;
          archived_at?: string | null;
          autonomy_level?: number;
          created_at?: string;
          id?: string;
          name: string;
          ollama_host?: string | null;
          organization_id: string;
          privacy_mode?: string;
          rules_text?: string;
          source_aero_id?: string | null;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          address_city?: string | null;
          address_state?: string | null;
          address_street?: string | null;
          address_zip?: string | null;
          archived_at?: string | null;
          autonomy_level?: number;
          created_at?: string;
          id?: string;
          name?: string;
          ollama_host?: string | null;
          organization_id?: string;
          privacy_mode?: string;
          rules_text?: string;
          source_aero_id?: string | null;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "properties_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      property_vendors: {
        Row: {
          category: string;
          confidence: number;
          created_at: string;
          notes: string | null;
          organization_id: string;
          property_id: string;
          source: string;
          updated_at: string;
          vendor_id: string;
        };
        Insert: {
          category: string;
          confidence?: number;
          created_at?: string;
          notes?: string | null;
          organization_id: string;
          property_id: string;
          source?: string;
          updated_at?: string;
          vendor_id: string;
        };
        Update: {
          category?: string;
          confidence?: number;
          created_at?: string;
          notes?: string | null;
          organization_id?: string;
          property_id?: string;
          source?: string;
          updated_at?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_vendors_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_vendors_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "property_vendors_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_vendors_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      rent_events: {
        Row: {
          amount_due: number;
          amount_paid: number;
          created_at: string;
          cycle_month: string;
          due_date: string | null;
          id: string;
          lease_id: string;
          organization_id: string;
          status: Database["public"]["Enums"]["rent_event_status"];
          updated_at: string;
          waived_amount: number | null;
          waived_at: string | null;
          waived_by: string | null;
          waived_reason: string | null;
        };
        Insert: {
          amount_due: number;
          amount_paid?: number;
          created_at?: string;
          cycle_month: string;
          due_date?: string | null;
          id?: string;
          lease_id: string;
          organization_id: string;
          status?: Database["public"]["Enums"]["rent_event_status"];
          updated_at?: string;
          waived_amount?: number | null;
          waived_at?: string | null;
          waived_by?: string | null;
          waived_reason?: string | null;
        };
        Update: {
          amount_due?: number;
          amount_paid?: number;
          created_at?: string;
          cycle_month?: string;
          due_date?: string | null;
          id?: string;
          lease_id?: string;
          organization_id?: string;
          status?: Database["public"]["Enums"]["rent_event_status"];
          updated_at?: string;
          waived_amount?: number | null;
          waived_at?: string | null;
          waived_by?: string | null;
          waived_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "rent_events_lease_id_fkey";
            columns: ["lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rent_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rent_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      rent_payments: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          id: string;
          lease_id: string;
          organization_id: string;
          paid_at: string | null;
          payment_link_url: string | null;
          payment_method_type: string | null;
          receipt_url: string | null;
          rent_event_id: string | null;
          status: string;
          stripe_customer_id: string | null;
          stripe_payment_intent_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          id?: string;
          lease_id: string;
          organization_id: string;
          paid_at?: string | null;
          payment_link_url?: string | null;
          payment_method_type?: string | null;
          receipt_url?: string | null;
          rent_event_id?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_payment_intent_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          lease_id?: string;
          organization_id?: string;
          paid_at?: string | null;
          payment_link_url?: string | null;
          payment_method_type?: string | null;
          receipt_url?: string | null;
          rent_event_id?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_payment_intent_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rent_payments_lease_id_fkey";
            columns: ["lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rent_payments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rent_payments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "rent_payments_rent_event_id_fkey";
            columns: ["rent_event_id"];
            isOneToOne: false;
            referencedRelation: "rent_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rent_payments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_actions: {
        Row: {
          action_payload: Json;
          action_text: string;
          action_type: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          condition: Json | null;
          condition_failure_reason: string | null;
          condition_text: string;
          created_at: string;
          fired_at: string | null;
          fired_proposal_id: string | null;
          id: string;
          inngest_event_id: string | null;
          organization_id: string;
          property_id: string | null;
          status: string;
          trigger_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          action_payload: Json;
          action_text: string;
          action_type: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          condition?: Json | null;
          condition_failure_reason?: string | null;
          condition_text: string;
          created_at?: string;
          fired_at?: string | null;
          fired_proposal_id?: string | null;
          id?: string;
          inngest_event_id?: string | null;
          organization_id: string;
          property_id?: string | null;
          status?: string;
          trigger_at: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          action_payload?: Json;
          action_text?: string;
          action_type?: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          condition?: Json | null;
          condition_failure_reason?: string | null;
          condition_text?: string;
          created_at?: string;
          fired_at?: string | null;
          fired_proposal_id?: string | null;
          id?: string;
          inngest_event_id?: string | null;
          organization_id?: string;
          property_id?: string | null;
          status?: string;
          trigger_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_actions_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_fired_proposal_id_fkey";
            columns: ["fired_proposal_id"];
            isOneToOne: false;
            referencedRelation: "action_proposals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "scheduled_actions_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      sendblue_number_pool: {
        Row: {
          assigned_at: string | null;
          assigned_to_organization_id: string | null;
          created_at: string;
          e164: string;
          id: string;
          status: string;
        };
        Insert: {
          assigned_at?: string | null;
          assigned_to_organization_id?: string | null;
          created_at?: string;
          e164: string;
          id?: string;
          status?: string;
        };
        Update: {
          assigned_at?: string | null;
          assigned_to_organization_id?: string | null;
          created_at?: string;
          e164?: string;
          id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sendblue_number_pool_assigned_to_organization_id_fkey";
            columns: ["assigned_to_organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sendblue_number_pool_assigned_to_organization_id_fkey";
            columns: ["assigned_to_organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      tenant_property_links: {
        Row: {
          created_at: string;
          created_by: string | null;
          organization_id: string;
          property_id: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          organization_id: string;
          property_id: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          organization_id?: string;
          property_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_property_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_property_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_property_links_property_org_fkey";
            columns: ["organization_id", "property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "tenant_property_links_tenant_org_fkey";
            columns: ["organization_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          date_of_birth: string | null;
          email: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          full_name: string;
          id: string;
          language: string | null;
          organization_id: string;
          parking_space: string | null;
          pets_jsonb: Json;
          phone_e164: string;
          preferences_confidence: number;
          preferences_source: string;
          preferred_channel: string | null;
          source_aero_id: string | null;
          stripe_customer_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date_of_birth?: string | null;
          email?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          full_name: string;
          id?: string;
          language?: string | null;
          organization_id: string;
          parking_space?: string | null;
          pets_jsonb?: Json;
          phone_e164: string;
          preferences_confidence?: number;
          preferences_source?: string;
          preferred_channel?: string | null;
          source_aero_id?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date_of_birth?: string | null;
          email?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          full_name?: string;
          id?: string;
          language?: string | null;
          organization_id?: string;
          parking_space?: string | null;
          pets_jsonb?: Json;
          phone_e164?: string;
          preferences_confidence?: number;
          preferences_source?: string;
          preferred_channel?: string | null;
          source_aero_id?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenants_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenants_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      units: {
        Row: {
          bathrooms: number | null;
          bedrooms: number | null;
          created_at: string;
          id: string;
          label: string;
          organization_id: string;
          property_id: string;
          source_aero_id: string | null;
          square_feet: number | null;
          updated_at: string;
        };
        Insert: {
          bathrooms?: number | null;
          bedrooms?: number | null;
          created_at?: string;
          id?: string;
          label: string;
          organization_id: string;
          property_id: string;
          source_aero_id?: string | null;
          square_feet?: number | null;
          updated_at?: string;
        };
        Update: {
          bathrooms?: number | null;
          bedrooms?: number | null;
          created_at?: string;
          id?: string;
          label?: string;
          organization_id?: string;
          property_id?: string;
          source_aero_id?: string | null;
          square_feet?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "units_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "units_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "units_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          organization_id: string;
          phone_e164: string | null;
          phone_verified_at: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          organization_id: string;
          phone_e164?: string | null;
          phone_verified_at?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          organization_id?: string;
          phone_e164?: string | null;
          phone_verified_at?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "users_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      vendors: {
        Row: {
          acceptance_rate: number;
          category: Database["public"]["Enums"]["work_order_category"];
          created_at: string;
          id: string;
          name: string;
          org_default_categories: string[];
          organization_id: string;
          phone_e164: string | null;
          updated_at: string;
        };
        Insert: {
          acceptance_rate?: number;
          category: Database["public"]["Enums"]["work_order_category"];
          created_at?: string;
          id?: string;
          name: string;
          org_default_categories?: string[];
          organization_id: string;
          phone_e164?: string | null;
          updated_at?: string;
        };
        Update: {
          acceptance_rate?: number;
          category?: Database["public"]["Enums"]["work_order_category"];
          created_at?: string;
          id?: string;
          name?: string;
          org_default_categories?: string[];
          organization_id?: string;
          phone_e164?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendors_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      waitlist: {
        Row: {
          created_at: string;
          current_stack: string | null;
          email: string;
          full_name: string | null;
          id: string;
          ip_hash: string | null;
          referer: string | null;
          source: string | null;
          unit_count: number | null;
        };
        Insert: {
          created_at?: string;
          current_stack?: string | null;
          email: string;
          full_name?: string | null;
          id?: string;
          ip_hash?: string | null;
          referer?: string | null;
          source?: string | null;
          unit_count?: number | null;
        };
        Update: {
          created_at?: string;
          current_stack?: string | null;
          email?: string;
          full_name?: string | null;
          id?: string;
          ip_hash?: string | null;
          referer?: string | null;
          source?: string | null;
          unit_count?: number | null;
        };
        Relationships: [];
      };
      voice_settings: {
        Row: {
          id: string;
          organization_id: string;
          retell_phone_number_e164: string | null;
          retell_agent_id: string | null;
          voice_enabled: boolean;
          live_calls_enabled: boolean;
          hmac_verification_enabled: boolean;
          operator_summary: Json;
          property_context_policy: Json;
          information_to_collect: Json;
          topics_to_avoid: Json;
          closing_guidance: string | null;
          script_overrides: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          retell_phone_number_e164?: string | null;
          retell_agent_id?: string | null;
          voice_enabled?: boolean;
          live_calls_enabled?: boolean;
          hmac_verification_enabled?: boolean;
          operator_summary?: Json;
          property_context_policy?: Json;
          information_to_collect?: Json;
          topics_to_avoid?: Json;
          closing_guidance?: string | null;
          script_overrides?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          retell_phone_number_e164?: string | null;
          retell_agent_id?: string | null;
          voice_enabled?: boolean;
          live_calls_enabled?: boolean;
          hmac_verification_enabled?: boolean;
          operator_summary?: Json;
          property_context_policy?: Json;
          information_to_collect?: Json;
          topics_to_avoid?: Json;
          closing_guidance?: string | null;
          script_overrides?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "voice_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      retell_tool_invocations: {
        Row: {
          attempt_count: number;
          call_id: string;
          canonical_result: Json | null;
          claim_token: string;
          claim_generation: number;
          completed_at: string | null;
          created_at: string;
          error_code: string | null;
          evidence: Json;
          http_status: number | null;
          id: string;
          idempotency_key: string;
          lease_expires_at: string;
          organization_id: string;
          request_hash: string;
          retryable: boolean;
          status: string;
          tool_name: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          call_id: string;
          canonical_result?: Json | null;
          claim_token?: string;
          claim_generation?: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          evidence?: Json;
          http_status?: number | null;
          id?: string;
          idempotency_key: string;
          lease_expires_at?: string;
          organization_id: string;
          request_hash: string;
          retryable?: boolean;
          status?: string;
          tool_name: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          call_id?: string;
          canonical_result?: Json | null;
          claim_token?: string;
          claim_generation?: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          evidence?: Json;
          http_status?: number | null;
          id?: string;
          idempotency_key?: string;
          lease_expires_at?: string;
          organization_id?: string;
          request_hash?: string;
          retryable?: boolean;
          status?: string;
          tool_name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "retell_tool_invocations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      voice_calls: {
        Row: {
          caller_kind: string;
          conversation_id: string | null;
          created_at: string;
          direction: string;
          ended_at: string | null;
          from_number: string;
          finalization_richness: number;
          id: string;
          organization_id: string;
          outcome: Json | null;
          property_id: string | null;
          retell_call_id: string;
          session: Json;
          started_at: string;
          status: string;
          summary: string | null;
          tenant_id: string | null;
          to_number: string;
          transcript: string | null;
          unit_id: string | null;
          updated_at: string;
          vendor_id: string | null;
        };
        Insert: {
          caller_kind?: string;
          conversation_id?: string | null;
          created_at?: string;
          direction?: string;
          ended_at?: string | null;
          from_number: string;
          finalization_richness?: number;
          id?: string;
          organization_id: string;
          outcome?: Json | null;
          property_id?: string | null;
          retell_call_id: string;
          session?: Json;
          started_at?: string;
          status?: string;
          summary?: string | null;
          tenant_id?: string | null;
          to_number: string;
          transcript?: string | null;
          unit_id?: string | null;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Update: {
          caller_kind?: string;
          conversation_id?: string | null;
          created_at?: string;
          direction?: string;
          ended_at?: string | null;
          from_number?: string;
          finalization_richness?: number;
          id?: string;
          organization_id?: string;
          outcome?: Json | null;
          property_id?: string | null;
          retell_call_id?: string;
          session?: Json;
          started_at?: string;
          status?: string;
          summary?: string | null;
          tenant_id?: string | null;
          to_number?: string;
          transcript?: string | null;
          unit_id?: string | null;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "voice_calls_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_calls_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_calls_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "voice_calls_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_calls_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_calls_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_calls_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      weekly_reports: {
        Row: {
          briefing_text: string | null;
          created_at: string;
          generated_at: string;
          id: string;
          metrics: Json;
          organization_id: string;
          updated_at: string;
          week_start_date: string;
        };
        Insert: {
          briefing_text?: string | null;
          created_at?: string;
          generated_at?: string;
          id?: string;
          metrics?: Json;
          organization_id: string;
          updated_at?: string;
          week_start_date: string;
        };
        Update: {
          briefing_text?: string | null;
          created_at?: string;
          generated_at?: string;
          id?: string;
          metrics?: Json;
          organization_id?: string;
          updated_at?: string;
          week_start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "weekly_reports_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weekly_reports_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      work_order_mutation_requests: {
        Row: {
          created_at: string;
          payload_hash: string;
          request_id: string;
          result: Json;
          work_order_id: string;
        };
        Insert: {
          created_at?: string;
          payload_hash: string;
          request_id: string;
          result: Json;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          payload_hash?: string;
          request_id?: string;
          result?: Json;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_mutation_requests_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_orders: {
        Row: {
          category: Database["public"]["Enums"]["work_order_category"];
          created_at: string;
          description: string | null;
          id: string;
          lifecycle_version: number;
          organization_id: string;
          retell_artifact_key: string | null;
          reviewed_at: string | null;
          source_aero_id: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          status_timeline: Json;
          tenant_id: string | null;
          unit_id: string;
          updated_at: string;
          urgency: Database["public"]["Enums"]["work_order_urgency"];
          vendor_assigned_at: string | null;
          vendor_id: string | null;
          vendor_responded_at: string | null;
          vendor_response:
            | Database["public"]["Enums"]["work_order_vendor_response"]
            | null;
        };
        Insert: {
          category: Database["public"]["Enums"]["work_order_category"];
          created_at?: string;
          description?: string | null;
          id?: string;
          lifecycle_version?: number;
          organization_id: string;
          retell_artifact_key?: string | null;
          reviewed_at?: string | null;
          source_aero_id?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          status_timeline?: Json;
          tenant_id?: string | null;
          unit_id: string;
          updated_at?: string;
          urgency?: Database["public"]["Enums"]["work_order_urgency"];
          vendor_assigned_at?: string | null;
          vendor_id?: string | null;
          vendor_responded_at?: string | null;
          vendor_response?:
            | Database["public"]["Enums"]["work_order_vendor_response"]
            | null;
        };
        Update: {
          category?: Database["public"]["Enums"]["work_order_category"];
          created_at?: string;
          description?: string | null;
          id?: string;
          lifecycle_version?: number;
          organization_id?: string;
          retell_artifact_key?: string | null;
          reviewed_at?: string | null;
          source_aero_id?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          status_timeline?: Json;
          tenant_id?: string | null;
          unit_id?: string;
          updated_at?: string;
          urgency?: Database["public"]["Enums"]["work_order_urgency"];
          vendor_assigned_at?: string | null;
          vendor_id?: string | null;
          vendor_responded_at?: string | null;
          vendor_response?:
            | Database["public"]["Enums"]["work_order_vendor_response"]
            | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "v_org_pulse_kpis";
            referencedColumns: ["organization_id"];
          },
          {
            foreignKeyName: "work_orders_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      v_org_pulse_kpis: {
        Row: {
          late_tenants_count: number | null;
          occupancy_pct: number | null;
          open_work_orders_count: number | null;
          organization_id: string | null;
          rent_collected_this_month_cents: number | null;
          rent_due_this_month_cents: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      claim_retell_tool_invocation: {
        Args: {
          p_call_id: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_request_hash: string;
          p_tool_name: string;
        };
        Returns: Json;
      };
      complete_retell_tool_invocation: {
        Args: {
          p_canonical_result: Json;
          p_claim_token: string;
          p_claim_generation: number;
          p_error_code?: string | null;
          p_evidence?: Json;
          p_http_status: number;
          p_invocation_id: string;
          p_retryable?: boolean;
          p_status: string;
        };
        Returns: Json;
      };
      finalize_retell_call_artifacts: {
        Args: {
          p_ended_at: string;
          p_message_body: string;
          p_richness?: number;
          p_needs_review: boolean;
          p_outcome: Json;
          p_property_id: string | null;
          p_proposal_payload?: Json | null;
          p_proposal_reasoning?: string | null;
          p_retell_call_id: string;
          p_session: Json;
          p_summary: string;
          p_tenant_id: string | null;
          p_transcript: string | null;
        };
        Returns: Json;
      };
      renew_retell_tool_invocation_lease: {
        Args: {
          p_claim_generation: number;
          p_claim_token: string;
          p_invocation_id: string;
        };
        Returns: boolean;
      };
      accountant_document_index: { Args: never; Returns: Json };
      accountant_identity_context: { Args: never; Returns: Json };
      accountant_payment_history: {
        Args: {
          p_before: string;
          p_from: string;
          p_include_recorded_exceptions?: boolean;
        };
        Returns: Json;
      };
      accountant_property_lease_context: {
        Args: { p_capability: string };
        Returns: Json;
      };
      accountant_rent_events: {
        Args: { p_cycle_end: string; p_cycle_start: string };
        Returns: Json;
      };
      can_see_property: { Args: { p_property_id: string }; Returns: boolean };
      can_see_vendor: { Args: { p_vendor_id: string }; Returns: boolean };
      claim_organization_invitation: {
        Args: { p_token: string };
        Returns: Json;
      };
      conversation_property_id: {
        Args: { p_conversation_id: string };
        Returns: string;
      };
      create_organization_invitation: {
        Args: {
          p_all_properties?: boolean;
          p_email: string;
          p_organization_id: string;
          p_property_ids?: string[];
          p_role: Database["public"]["Enums"]["user_role"];
        };
        Returns: Json;
      };
      current_membership_id: { Args: never; Returns: string };
      current_user_has_capability: {
        Args: { p_capability: string };
        Returns: boolean;
      };
      document_property_id: {
        Args: { p_document_id: string };
        Returns: string;
      };
      lease_property_id: { Args: { p_lease_id: string }; Returns: string };
      manager_has_capability: {
        Args: { p_capability: string };
        Returns: boolean;
      };
      membership_in_current_org: {
        Args: { p_membership_id: string };
        Returns: boolean;
      };
      profile_shares_current_org: {
        Args: { p_profile_id: string };
        Returns: boolean;
      };
      tenant_property_ids: { Args: { p_tenant_id: string }; Returns: string[] };
      unit_property_id: { Args: { p_unit_id: string }; Returns: string };
      visible_property_ids: { Args: never; Returns: string[] };
      voice_call_property_id: {
        Args: { p_voice_call_id: string };
        Returns: string;
      };
      work_order_property_id: {
        Args: { p_work_order_id: string };
        Returns: string;
      };
      apply_messaging_consent_command: {
        Args: {
          p_command: string;
          p_occurred_at?: string | null;
          p_organization_id: string;
          p_provider?: Database["public"]["Enums"]["message_provider"] | null;
          p_provider_message_id?: string | null;
          p_recipient_e164: string;
        };
        Returns: {
          changed: boolean;
          state: Database["public"]["Enums"]["messaging_consent_state"];
        }[];
      };
      attach_pending_delivery_callbacks: {
        Args: { p_dispatch_id: string };
        Returns: undefined;
      };
      begin_outbound_message_attempt: {
        Args: { p_attempt_id: string; p_lease_token: string };
        Returns: boolean;
      };
      claim_outbound_message_dispatch: {
        Args: {
          p_body_sha256: string;
          p_idempotency_key: string;
          p_message_id: string | null;
          p_organization_id: string;
          p_recipient_e164: string;
        };
        Returns: {
          canonical_provider:
            | Database["public"]["Enums"]["message_provider"]
            | null;
          canonical_provider_message_id: string | null;
          dispatch_id: string;
          outcome: string;
        }[];
      };
      create_tenant_with_active_lease: {
        Args: {
          p_email: string | null;
          p_full_name: string;
          p_idempotency_key: string;
          p_phone_e164: string;
          p_property_id: string;
          p_rent_amount: number;
          p_start_date: string | null;
          p_unit_id: string;
        };
        Returns: {
          idempotent: boolean;
          lease_id: string;
          tenant_id: string;
        }[];
      };
      commit_portfolio_import: {
        Args: {
          p_idempotency_key: string;
          p_organization_id: string;
          p_payload_hash: string;
          p_plan: Json;
          p_source: string;
        };
        Returns: Json;
      };
      current_user_org_id: { Args: never; Returns: string };
      current_user_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      lease_outbound_message_attempt: {
        Args: {
          p_dispatch_id: string;
          p_lease_seconds?: number;
          p_provider: Database["public"]["Enums"]["message_provider"];
        };
        Returns: {
          attempt_id: string | null;
          lease_token: string | null;
          outcome: string;
        }[];
      };
      match_memory_facts_org: {
        Args: {
          match_limit?: number;
          organization_id_arg: string;
          query_embedding: string;
        };
        Returns: {
          confidence: number;
          content: Json;
          created_at: string;
          evidence_proposal_ids: string[];
          fact_type: string;
          id: string;
          organization_id: string;
          property_id: string;
          similarity: number;
          source: string;
          subject_id: string;
          superseded_at: string;
          superseded_by: string;
        }[];
      };
      match_memory_facts_property: {
        Args: {
          match_limit?: number;
          property_id_arg: string;
          query_embedding: string;
        };
        Returns: {
          confidence: number;
          content: Json;
          created_at: string;
          evidence_proposal_ids: string[];
          fact_type: string;
          id: string;
          organization_id: string;
          property_id: string;
          similarity: number;
          source: string;
          subject_id: string;
          superseded_at: string;
          superseded_by: string;
        }[];
      };
      create_work_order_audited: {
        Args: {
          p_category: Database["public"]["Enums"]["work_order_category"];
          p_description: string;
          p_tenant_id: string | null;
          p_unit_id: string;
          p_urgency: Database["public"]["Enums"]["work_order_urgency"];
        };
        Returns: Json;
      };
      mutate_work_order_audited: {
        Args: {
          p_set_vendor?: boolean;
          p_status?: Database["public"]["Enums"]["work_order_status"] | null;
          p_urgency?: Database["public"]["Enums"]["work_order_urgency"] | null;
          p_vendor_id?: string | null;
          p_work_order_id: string;
        };
        Returns: Json;
      };
      mutate_work_order_lifecycle: {
        Args: {
          p_action: string;
          p_expected_version: number;
          p_request_id: string;
          p_vendor_id?: string | null;
          p_vendor_response?:
            | Database["public"]["Enums"]["work_order_vendor_response"]
            | null;
          p_work_order_id: string;
        };
        Returns: Json;
      };
      reconcile_succeeded_rent_payment: {
        Args: {
          p_paid_at: string;
          p_payment_method_type?: string;
          p_provider_amount_cents?: number;
          p_provider_currency?: string;
          p_receipt_url?: string;
          p_stripe_payment_intent_id: string;
        };
        Returns: {
          applied_cents: number;
          due_cents: number;
          event_status: string;
          overpayment_cents: number;
          paid_cents_after: number;
          payment_id: string;
          rent_event_id: string;
          replay: boolean;
        }[];
      };
      reconcile_message_delivery_event: {
        Args: {
          p_occurred_at: string | null;
          p_provider: Database["public"]["Enums"]["message_provider"];
          p_provider_event_id: string;
          p_provider_message_id: string;
          p_raw_payload?: Json;
          p_status: Database["public"]["Enums"]["message_delivery_status"];
        };
        Returns: {
          canonical_status: Database["public"]["Enums"]["message_delivery_status"];
          dispatch_id: string | null;
          duplicate: boolean;
          message_id: string | null;
          pending: boolean;
        }[];
      };
      record_outbound_dispatch_accepted: {
        Args: {
          p_attempt_id: string;
          p_provider_message_id: string;
        };
        Returns: undefined;
      };
      record_outbound_dispatch_failure: {
        Args: {
          p_ambiguous: boolean;
          p_attempt_id: string;
          p_error: string;
          p_terminal: boolean;
        };
        Returns: undefined;
      };
    };
    Enums: {
      conversation_channel: "voice" | "sms" | "imessage";
      conversation_status: "open" | "resolved" | "escalated";
      lease_status: "active" | "pending" | "expired" | "terminated";
      membership_status: "active" | "suspended";
      message_direction: "inbound" | "outbound";
      message_delivery_status:
        | "draft"
        | "approved"
        | "queued"
        | "provider_accepted"
        | "delivered"
        | "undelivered"
        | "failed"
        | "suppressed";
      message_draft_status:
        | "auto_sent"
        | "pending_review"
        | "approved"
        | "rejected"
        | "sent_by_human"
        | "sending";
      message_provider: "linq" | "twilio" | "retell";
      messaging_provider_choice: "linq" | "twilio" | "retell";
      messaging_consent_state: "unknown" | "opted_in" | "suppressed";
      organization_plan: "starter" | "pro" | "managed";
      rent_event_status:
        | "pending"
        | "reminder_sent"
        | "due_sent"
        | "late_1"
        | "late_3"
        | "late_7"
        | "paid"
        | "escalated"
        | "plan_agreed";
      user_role: "owner" | "manager" | "va" | "accountant";
      work_order_category:
        | "plumbing"
        | "electrical"
        | "hvac"
        | "appliances"
        | "flooring"
        | "painting"
        | "landscaping"
        | "security"
        | "cleaning"
        | "general"
        | "other";
      work_order_status:
        | "open"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled";
      work_order_urgency: "emergency" | "urgent" | "routine";
      work_order_vendor_response: "accepted" | "declined" | "no_response";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      conversation_channel: ["voice", "sms", "imessage"],
      conversation_status: ["open", "resolved", "escalated"],
      lease_status: ["active", "pending", "expired", "terminated"],
      membership_status: ["active", "suspended"],
      message_direction: ["inbound", "outbound"],
      message_delivery_status: [
        "draft",
        "approved",
        "queued",
        "provider_accepted",
        "delivered",
        "undelivered",
        "failed",
        "suppressed",
      ],
      message_draft_status: [
        "auto_sent",
        "pending_review",
        "approved",
        "rejected",
        "sent_by_human",
        "sending",
      ],
      message_provider: ["linq", "twilio", "retell"],
      messaging_provider_choice: ["linq", "twilio", "retell"],
      messaging_consent_state: ["unknown", "opted_in", "suppressed"],
      organization_plan: ["starter", "pro", "managed"],
      rent_event_status: [
        "pending",
        "reminder_sent",
        "due_sent",
        "late_1",
        "late_3",
        "late_7",
        "paid",
        "escalated",
        "plan_agreed",
      ],
      user_role: ["owner", "manager", "va", "accountant"],
      work_order_category: [
        "plumbing",
        "electrical",
        "hvac",
        "appliances",
        "flooring",
        "painting",
        "landscaping",
        "security",
        "cleaning",
        "general",
        "other",
      ],
      work_order_status: [
        "open",
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
      ],
      work_order_urgency: ["emergency", "urgent", "routine"],
      work_order_vendor_response: ["accepted", "declined", "no_response"],
    },
  },
} as const;
// =====================================================================

// Row aliases ---------------------------------------------------------

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Property = Database["public"]["Tables"]["properties"]["Row"];
export type Unit = Database["public"]["Tables"]["units"]["Row"];
export type Tenant = Database["public"]["Tables"]["tenants"]["Row"];
export type Lease = Database["public"]["Tables"]["leases"]["Row"];
export type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type WorkOrder = Database["public"]["Tables"]["work_orders"]["Row"];
export type Vendor = Database["public"]["Tables"]["vendors"]["Row"];
export type RentEvent = Database["public"]["Tables"]["rent_events"]["Row"];
export type WeeklyReport =
  Database["public"]["Tables"]["weekly_reports"]["Row"];
export type OrgPulseKpis =
  Database["public"]["Views"]["v_org_pulse_kpis"]["Row"];
export type SendblueNumber =
  Database["public"]["Tables"]["sendblue_number_pool"]["Row"];
export type ScheduledActionRow =
  Database["public"]["Tables"]["scheduled_actions"]["Row"];
export type MaintenanceTicket =
  Database["public"]["Tables"]["maintenance_tickets"]["Row"];
// Wave 7 ---------------------------------------------------------------
export type Appliance = Database["public"]["Tables"]["appliances"]["Row"];
export type PropertyVendor =
  Database["public"]["Tables"]["property_vendors"]["Row"];
export type OAuthToken = Database["public"]["Tables"]["oauth_tokens"]["Row"];
export type RentPayment = Database["public"]["Tables"]["rent_payments"]["Row"];
// Voice Operator V1 ----------------------------------------------------
export type VoiceCall = Database["public"]["Tables"]["voice_calls"]["Row"];
export type MessagingRecipientConsent =
  Database["public"]["Tables"]["messaging_recipient_consents"]["Row"];
export type MessagingConsentCommandEvent =
  Database["public"]["Tables"]["messaging_consent_command_events"]["Row"];
export type MessagingConsentTransition =
  Database["public"]["Tables"]["messaging_consent_transitions"]["Row"];
export type OutboundMessageDispatch =
  Database["public"]["Tables"]["outbound_message_dispatches"]["Row"];
export type OutboundMessageAttempt =
  Database["public"]["Tables"]["outbound_message_attempts"]["Row"];
export type MessageDeliveryCallbackInbox =
  Database["public"]["Tables"]["message_delivery_callback_inbox"]["Row"];
export type MessageDeliveryEvent =
  Database["public"]["Tables"]["message_delivery_events"]["Row"];
export type MessageLifecycleEvent =
  Database["public"]["Tables"]["message_lifecycle_events"]["Row"];

// Enum unions ---------------------------------------------------------

export type MessagingProviderChoice =
  Database["public"]["Enums"]["messaging_provider_choice"];
export type OrganizationPlan = Database["public"]["Enums"]["organization_plan"];
export type UserRole = Database["public"]["Enums"]["user_role"];
export type MembershipStatus = Database["public"]["Enums"]["membership_status"];
export type LeaseStatus = Database["public"]["Enums"]["lease_status"];
export type ConversationChannel =
  Database["public"]["Enums"]["conversation_channel"];
export type ConversationStatus =
  Database["public"]["Enums"]["conversation_status"];
export type MessageDirection = Database["public"]["Enums"]["message_direction"];
export type MessageProvider = Database["public"]["Enums"]["message_provider"];
export type MessageDraftStatus =
  Database["public"]["Enums"]["message_draft_status"];
export type MessageDeliveryStatus =
  Database["public"]["Enums"]["message_delivery_status"];
export type MessagingConsentState =
  Database["public"]["Enums"]["messaging_consent_state"];
export type WorkOrderCategory =
  Database["public"]["Enums"]["work_order_category"];
export type WorkOrderUrgency =
  Database["public"]["Enums"]["work_order_urgency"];
export type WorkOrderStatus = Database["public"]["Enums"]["work_order_status"];
export type WorkOrderVendorResponse =
  Database["public"]["Enums"]["work_order_vendor_response"];
export type RentEventStatus = Database["public"]["Enums"]["rent_event_status"];

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_groups: {
        Row: {
          ai_suggestion: string
          audience: string
          bid_strategy: string
          campaign_id: string
          channel: string
          clicks: number
          compliance_pass_rate: number
          created_at: string
          daily_budget: number
          id: string
          impressions: number
          name: string
          placement: string
          sort_order: number
          spent_today: number
          status: string
          updated_at: string
        }
        Insert: {
          ai_suggestion?: string
          audience?: string
          bid_strategy?: string
          campaign_id: string
          channel: string
          clicks?: number
          compliance_pass_rate?: number
          created_at?: string
          daily_budget?: number
          id: string
          impressions?: number
          name: string
          placement?: string
          sort_order?: number
          spent_today?: number
          status?: string
          updated_at?: string
        }
        Update: {
          ai_suggestion?: string
          audience?: string
          bid_strategy?: string
          campaign_id?: string
          channel?: string
          clicks?: number
          compliance_pass_rate?: number
          created_at?: string
          daily_budget?: number
          id?: string
          impressions?: number
          name?: string
          placement?: string
          sort_order?: number
          spent_today?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_groups_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_groups_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_facts"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      advisor_runs: {
        Row: {
          dropped: Json
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: number
          model: string | null
          ok: boolean
          raw_output: string | null
          started_at: string
          suggestions_kept: number
          suggestions_raw: number
          trigger_source: string
        }
        Insert: {
          dropped?: Json
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          model?: string | null
          ok?: boolean
          raw_output?: string | null
          started_at?: string
          suggestions_kept?: number
          suggestions_raw?: number
          trigger_source?: string
        }
        Update: {
          dropped?: Json
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          model?: string | null
          ok?: boolean
          raw_output?: string | null
          started_at?: string
          suggestions_kept?: number
          suggestions_raw?: number
          trigger_source?: string
        }
        Relationships: []
      }
      agent_decisions: {
        Row: {
          action_type: string
          ad_group_id: string | null
          ad_group_name: string | null
          agent_type: string
          campaign_id: string
          campaign_name: string
          confidence_score: number
          created_at: string
          creative_id: string | null
          creative_name: string | null
          effect: string
          guardrail_note: string | null
          id: string
          reasoning_chain: Json
          rollback_to: string | null
          status: string
          target_channel: string
          timestamp: string
          trigger_current_value: number
          trigger_metric: string
          trigger_source: string
          trigger_threshold_value: number
        }
        Insert: {
          action_type: string
          ad_group_id?: string | null
          ad_group_name?: string | null
          agent_type: string
          campaign_id: string
          campaign_name: string
          confidence_score?: number
          created_at?: string
          creative_id?: string | null
          creative_name?: string | null
          effect?: string
          guardrail_note?: string | null
          id: string
          reasoning_chain?: Json
          rollback_to?: string | null
          status?: string
          target_channel: string
          timestamp?: string
          trigger_current_value?: number
          trigger_metric: string
          trigger_source?: string
          trigger_threshold_value?: number
        }
        Update: {
          action_type?: string
          ad_group_id?: string | null
          ad_group_name?: string | null
          agent_type?: string
          campaign_id?: string
          campaign_name?: string
          confidence_score?: number
          created_at?: string
          creative_id?: string | null
          creative_name?: string | null
          effect?: string
          guardrail_note?: string | null
          id?: string
          reasoning_chain?: Json
          rollback_to?: string | null
          status?: string
          target_channel?: string
          timestamp?: string
          trigger_current_value?: number
          trigger_metric?: string
          trigger_source?: string
          trigger_threshold_value?: number
        }
        Relationships: []
      }
      agent_settings: {
        Row: {
          agent_online: boolean
          auto_takeovers: number
          cps_improvement_pct: number
          id: string
          kill_switch: boolean
          max_actions_per_hour: number
          max_ad_group_daily_budget: number
          max_budget_delta_pct: number
          max_daily_budget_delta_pct: number
          mode: string
          risk_first: boolean
          updated_at: string
        }
        Insert: {
          agent_online?: boolean
          auto_takeovers?: number
          cps_improvement_pct?: number
          id?: string
          kill_switch?: boolean
          max_actions_per_hour?: number
          max_ad_group_daily_budget?: number
          max_budget_delta_pct?: number
          max_daily_budget_delta_pct?: number
          mode?: string
          risk_first?: boolean
          updated_at?: string
        }
        Update: {
          agent_online?: boolean
          auto_takeovers?: number
          cps_improvement_pct?: number
          id?: string
          kill_switch?: boolean
          max_actions_per_hour?: number
          max_ad_group_daily_budget?: number
          max_budget_delta_pct?: number
          max_daily_budget_delta_pct?: number
          mode?: string
          risk_first?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      budget_pool_entries: {
        Row: {
          ad_group_id: string
          ad_group_name: string
          amount: number
          campaign_id: string
          campaign_name: string
          created_at: string
          decision_id: string | null
          direction: string
          id: number
          note: string
          pool_day: string
          reason: string
          status: string
          updated_at: string
        }
        Insert: {
          ad_group_id?: string
          ad_group_name?: string
          amount?: number
          campaign_id?: string
          campaign_name?: string
          created_at?: string
          decision_id?: string | null
          direction: string
          id?: number
          note?: string
          pool_day?: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Update: {
          ad_group_id?: string
          ad_group_name?: string
          amount?: number
          campaign_id?: string
          campaign_name?: string
          created_at?: string
          decision_id?: string | null
          direction?: string
          id?: number
          note?: string
          pool_day?: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          ai_suggestion: string
          approved_loans: number
          channel: string
          clicks: number
          compliance_pass_rate: number
          cpl: number
          cps: number
          created_at: string
          daily_budget: number
          disbursed_amount: number
          id: string
          impressions: number
          last20_approval_rate: number
          leads: number
          name: string
          placement: string
          sort_order: number
          spent_today: number
          status: string
          updated_at: string
        }
        Insert: {
          ai_suggestion?: string
          approved_loans?: number
          channel: string
          clicks?: number
          compliance_pass_rate?: number
          cpl?: number
          cps?: number
          created_at?: string
          daily_budget?: number
          disbursed_amount?: number
          id: string
          impressions?: number
          last20_approval_rate?: number
          leads?: number
          name: string
          placement: string
          sort_order?: number
          spent_today?: number
          status?: string
          updated_at?: string
        }
        Update: {
          ai_suggestion?: string
          approved_loans?: number
          channel?: string
          clicks?: number
          compliance_pass_rate?: number
          cpl?: number
          cps?: number
          created_at?: string
          daily_budget?: number
          disbursed_amount?: number
          id?: string
          impressions?: number
          last20_approval_rate?: number
          leads?: number
          name?: string
          placement?: string
          sort_order?: number
          spent_today?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      channel_breakdown: {
        Row: {
          ad_group_id: string | null
          approval: number
          campaign_id: string | null
          channel: string
          cps: number
          disbursed: number
          id: number
          sort_order: number
          spend: number
        }
        Insert: {
          ad_group_id?: string | null
          approval: number
          campaign_id?: string | null
          channel: string
          cps: number
          disbursed: number
          id?: never
          sort_order?: number
          spend: number
        }
        Update: {
          ad_group_id?: string | null
          approval?: number
          campaign_id?: string | null
          channel?: string
          cps?: number
          disbursed?: number
          id?: never
          sort_order?: number
          spend?: number
        }
        Relationships: []
      }
      channel_trend: {
        Row: {
          day: string
          google_front_end_roi: number
          google_true_roas: number
          id: number
          meta_front_end_roi: number
          meta_true_roas: number
          sort_order: number
        }
        Insert: {
          day: string
          google_front_end_roi: number
          google_true_roas: number
          id?: never
          meta_front_end_roi: number
          meta_true_roas: number
          sort_order?: number
        }
        Update: {
          day?: string
          google_front_end_roi?: number
          google_true_roas?: number
          id?: never
          meta_front_end_roi?: number
          meta_true_roas?: number
          sort_order?: number
        }
        Relationships: []
      }
      conversion_settings: {
        Row: {
          conversion_action: string
          destination_id: string
          enabled: boolean
          lookback_days: number
          mode: string
          platform: string
          updated_at: string
          value_rules: Json
        }
        Insert: {
          conversion_action?: string
          destination_id?: string
          enabled?: boolean
          lookback_days?: number
          mode?: string
          platform: string
          updated_at?: string
          value_rules?: Json
        }
        Update: {
          conversion_action?: string
          destination_id?: string
          enabled?: boolean
          lookback_days?: number
          mode?: string
          platform?: string
          updated_at?: string
          value_rules?: Json
        }
        Relationships: []
      }
      conversion_uploads: {
        Row: {
          attempts: number
          created_at: string
          error_code: string | null
          event_id: string
          id: string
          match_quality: number
          platform: string
          request_payload: Json
          response_body: Json
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          event_id: string
          id: string
          match_quality?: number
          platform: string
          request_payload?: Json
          response_body?: Json
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          event_id?: string
          id?: string
          match_quality?: number
          platform?: string
          request_payload?: Json
          response_body?: Json
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_uploads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "lead_events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_assets: {
        Row: {
          body_text: string
          compliance_logs: Json
          compliance_status: string
          created_at: string
          fatigue_level: string
          fatigue_score: number
          headline: string
          id: string
          image_url: string | null
          last_scanned_at: string | null
          launched_at: string
          loan_term_range: string
          max_apr: number
          sort_order: number
        }
        Insert: {
          body_text: string
          compliance_logs?: Json
          compliance_status?: string
          created_at?: string
          fatigue_level?: string
          fatigue_score?: number
          headline: string
          id: string
          image_url?: string | null
          last_scanned_at?: string | null
          launched_at?: string
          loan_term_range?: string
          max_apr?: number
          sort_order?: number
        }
        Update: {
          body_text?: string
          compliance_logs?: Json
          compliance_status?: string
          created_at?: string
          fatigue_level?: string
          fatigue_score?: number
          headline?: string
          id?: string
          image_url?: string | null
          last_scanned_at?: string | null
          launched_at?: string
          loan_term_range?: string
          max_apr?: number
          sort_order?: number
        }
        Relationships: []
      }
      creative_experiments: {
        Row: {
          arm_stats: Json
          created_at: string
          decided_at: string | null
          id: string
          parent_creative_id: string
          started_at: string
          status: string
          updated_at: string
          winner_variant_id: string | null
        }
        Insert: {
          arm_stats?: Json
          created_at?: string
          decided_at?: string | null
          id: string
          parent_creative_id: string
          started_at?: string
          status?: string
          updated_at?: string
          winner_variant_id?: string | null
        }
        Update: {
          arm_stats?: Json
          created_at?: string
          decided_at?: string | null
          id?: string
          parent_creative_id?: string
          started_at?: string
          status?: string
          updated_at?: string
          winner_variant_id?: string | null
        }
        Relationships: []
      }
      creative_metrics: {
        Row: {
          ad_group_id: string | null
          campaign_id: string | null
          clicks: number
          cpl: number
          cps: number
          created_at: string
          creative_id: string
          ctr: number
          day: string
          frequency: number
          id: number
          impressions: number
          spend: number
        }
        Insert: {
          ad_group_id?: string | null
          campaign_id?: string | null
          clicks?: number
          cpl?: number
          cps?: number
          created_at?: string
          creative_id: string
          ctr?: number
          day: string
          frequency?: number
          id?: number
          impressions?: number
          spend?: number
        }
        Update: {
          ad_group_id?: string | null
          campaign_id?: string | null
          clicks?: number
          cpl?: number
          cps?: number
          created_at?: string
          creative_id?: string
          ctr?: number
          day?: string
          frequency?: number
          id?: number
          impressions?: number
          spend?: number
        }
        Relationships: []
      }
      creative_placements: {
        Row: {
          ad_group_id: string
          campaign_id: string
          created_at: string
          creative_id: string
          share: number
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          ad_group_id: string
          campaign_id: string
          created_at?: string
          creative_id: string
          share?: number
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          ad_group_id?: string
          campaign_id?: string
          created_at?: string
          creative_id?: string
          share?: number
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      creative_variants: {
        Row: {
          angle: string
          body_text: string
          compliance_logs: Json
          compliance_score: number
          compliance_status: string
          created_at: string
          experiment_id: string | null
          headline: string
          id: string
          image_url: string | null
          parent_creative_id: string
          status: string
          updated_at: string
        }
        Insert: {
          angle?: string
          body_text?: string
          compliance_logs?: Json
          compliance_score?: number
          compliance_status?: string
          created_at?: string
          experiment_id?: string | null
          headline?: string
          id: string
          image_url?: string | null
          parent_creative_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          angle?: string
          body_text?: string
          compliance_logs?: Json
          compliance_score?: number
          compliance_status?: string
          created_at?: string
          experiment_id?: string | null
          headline?: string
          id?: string
          image_url?: string | null
          parent_creative_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_variants_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "creative_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_stages: {
        Row: {
          id: number
          note: string
          sort_order: number
          stage: string
          value: number
        }
        Insert: {
          id?: never
          note?: string
          sort_order?: number
          stage: string
          value: number
        }
        Update: {
          id?: never
          note?: string
          sort_order?: number
          stage?: string
          value?: number
        }
        Relationships: []
      }
      guardrail_events: {
        Row: {
          action: string
          created_at: string
          detail: string
          id: number
          requested: Json
          rule: string
          target_id: string
          verdict: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string
          id?: number
          requested?: Json
          rule: string
          target_id?: string
          verdict: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string
          id?: number
          requested?: Json
          rule?: string
          target_id?: string
          verdict?: string
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          created_at: string
          currency: string
          event_type: string
          external_ref: string | null
          id: string
          lead_id: string
          occurred_at: string
          value: number
        }
        Insert: {
          created_at?: string
          currency?: string
          event_type: string
          external_ref?: string | null
          id: string
          lead_id: string
          occurred_at?: string
          value?: number
        }
        Update: {
          created_at?: string
          currency?: string
          event_type?: string
          external_ref?: string | null
          id?: string
          lead_id?: string
          occurred_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      pid_controller_state: {
        Row: {
          ad_group_id: string
          integral: number
          last_cps: number
          last_error: number
          last_output: number
          last_suggestion_at: string | null
          updated_at: string
        }
        Insert: {
          ad_group_id: string
          integral?: number
          last_cps?: number
          last_error?: number
          last_output?: number
          last_suggestion_at?: string | null
          updated_at?: string
        }
        Update: {
          ad_group_id?: string
          integral?: number
          last_cps?: number
          last_error?: number
          last_output?: number
          last_suggestion_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          ad_group_id: string | null
          campaign_id: string
          channel: string
          click_at: string
          created_at: string
          creative_id: string | null
          fbc: string | null
          fbclid: string | null
          fbp: string | null
          gbraid: string | null
          gclid: string | null
          hashed_email: string | null
          hashed_phone: string | null
          id: string
          landing_url: string
          updated_at: string
          wbraid: string | null
        }
        Insert: {
          ad_group_id?: string | null
          campaign_id: string
          channel: string
          click_at?: string
          created_at?: string
          creative_id?: string | null
          fbc?: string | null
          fbclid?: string | null
          fbp?: string | null
          gbraid?: string | null
          gclid?: string | null
          hashed_email?: string | null
          hashed_phone?: string | null
          id: string
          landing_url?: string
          updated_at?: string
          wbraid?: string | null
        }
        Update: {
          ad_group_id?: string | null
          campaign_id?: string
          channel?: string
          click_at?: string
          created_at?: string
          creative_id?: string | null
          fbc?: string | null
          fbclid?: string | null
          fbp?: string | null
          gbraid?: string | null
          gclid?: string | null
          hashed_email?: string | null
          hashed_phone?: string | null
          id?: string
          landing_url?: string
          updated_at?: string
          wbraid?: string | null
        }
        Relationships: []
      }
      sweep_runs: {
        Row: {
          detail: Json
          experiments_settled: number
          fatigue_alerts: number
          finished_at: string | null
          id: number
          ok: boolean
          pace_breaches: number
          risk_pauses: number
          started_at: string
        }
        Insert: {
          detail?: Json
          experiments_settled?: number
          fatigue_alerts?: number
          finished_at?: string | null
          id?: number
          ok?: boolean
          pace_breaches?: number
          risk_pauses?: number
          started_at?: string
        }
        Update: {
          detail?: Json
          experiments_settled?: number
          fatigue_alerts?: number
          finished_at?: string | null
          id?: number
          ok?: boolean
          pace_breaches?: number
          risk_pauses?: number
          started_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_adgroup_facts: {
        Row: {
          ad_group_id: string | null
          approved_loans: number | null
          campaign_id: string | null
          cpl: number | null
          cps: number | null
          disbursed_amount: number | null
          disbursed_count: number | null
          last20_approval_rate: number | null
          leads: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_groups_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_groups_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_facts"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      v_campaign_facts: {
        Row: {
          approved_loans: number | null
          campaign_id: string | null
          cpl: number | null
          cps: number | null
          disbursed_amount: number | null
          disbursed_count: number | null
          last20_approval_rate: number | null
          leads: number | null
        }
        Relationships: []
      }
      v_creative_facts: {
        Row: {
          approval_rate: number | null
          approved_loans: number | null
          cpl: number | null
          cps: number | null
          creative_id: string | null
          disbursed_amount: number | null
          disbursed_count: number | null
          leads: number | null
          spend: number | null
        }
        Relationships: []
      }
      v_funnel: {
        Row: {
          sort_order: number | null
          stage: string | null
          value: number | null
        }
        Relationships: []
      }
      v_placement_facts: {
        Row: {
          ad_group_id: string | null
          approved: number | null
          campaign_id: string | null
          creative_id: string | null
          disbursed_amount: number | null
          disbursed_count: number | null
          leads: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_agent_snapshot: { Args: never; Returns: Json }
      get_budget_pool_today: { Args: never; Returns: Json }
      get_conversion_snapshot: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

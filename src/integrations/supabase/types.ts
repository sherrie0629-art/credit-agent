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
      agent_decisions: {
        Row: {
          action_type: string
          agent_type: string
          campaign_id: string
          campaign_name: string
          confidence_score: number
          created_at: string
          effect: string
          id: string
          reasoning_chain: Json
          rollback_to: string | null
          status: string
          target_channel: string
          timestamp: string
          trigger_current_value: number
          trigger_metric: string
          trigger_threshold_value: number
        }
        Insert: {
          action_type: string
          agent_type: string
          campaign_id: string
          campaign_name: string
          confidence_score?: number
          created_at?: string
          effect?: string
          id: string
          reasoning_chain?: Json
          rollback_to?: string | null
          status?: string
          target_channel: string
          timestamp?: string
          trigger_current_value?: number
          trigger_metric: string
          trigger_threshold_value?: number
        }
        Update: {
          action_type?: string
          agent_type?: string
          campaign_id?: string
          campaign_name?: string
          confidence_score?: number
          created_at?: string
          effect?: string
          id?: string
          reasoning_chain?: Json
          rollback_to?: string | null
          status?: string
          target_channel?: string
          timestamp?: string
          trigger_current_value?: number
          trigger_metric?: string
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
          mode: string
          risk_first: boolean
          updated_at: string
        }
        Insert: {
          agent_online?: boolean
          auto_takeovers?: number
          cps_improvement_pct?: number
          id?: string
          mode?: string
          risk_first?: boolean
          updated_at?: string
        }
        Update: {
          agent_online?: boolean
          auto_takeovers?: number
          cps_improvement_pct?: number
          id?: string
          mode?: string
          risk_first?: boolean
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
          approval: number
          channel: string
          cps: number
          disbursed: number
          id: number
          sort_order: number
          spend: number
        }
        Insert: {
          approval: number
          channel: string
          cps: number
          disbursed: number
          id?: never
          sort_order?: number
          spend: number
        }
        Update: {
          approval?: number
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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

// Generated file — do not edit by hand.
//
//   supabase gen types typescript --local > src/lib/database.types.ts
//
// Regenerate after every migration in supabase/migrations/ and commit the
// result, so `Database` always matches the schema (PLAN.md §7).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      climate_fields: {
        Row: {
          climate_link: string
          description: string
          id: string
          name: string
          sector_group: string
          sources: string[]
          transferable_functions: string[]
          updated_at: string
        }
        Insert: {
          climate_link: string
          description: string
          id: string
          name: string
          sector_group: string
          sources?: string[]
          transferable_functions?: string[]
          updated_at?: string
        }
        Update: {
          climate_link?: string
          description?: string
          id?: string
          name?: string
          sector_group?: string
          sources?: string[]
          transferable_functions?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      example_job_posts: {
        Row: {
          company: string
          field_id: string
          id: string
          posted_date: string | null
          requirements_summary: string
          retrieved_at: string
          role_id: string | null
          source_url: string
          title: string
        }
        Insert: {
          company: string
          field_id: string
          id: string
          posted_date?: string | null
          requirements_summary: string
          retrieved_at?: string
          role_id?: string | null
          source_url: string
          title: string
        }
        Update: {
          company?: string
          field_id?: string
          id?: string
          posted_date?: string | null
          requirements_summary?: string
          retrieved_at?: string
          role_id?: string | null
          source_url?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "example_job_posts_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "climate_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "example_job_posts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "example_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      example_roles: {
        Row: {
          day_to_day: string
          example_companies: string[]
          field_id: string
          function: string
          id: string
          sources: string[]
          title: string
          updated_at: string
        }
        Insert: {
          day_to_day: string
          example_companies?: string[]
          field_id: string
          function: string
          id: string
          sources?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          day_to_day?: string
          example_companies?: string[]
          field_id?: string
          function?: string
          id?: string
          sources?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "example_roles_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "climate_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_usage: {
        Row: {
          cache_creation_input_tokens: number | null
          cache_read_input_tokens: number | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          session_id: string
          step: string
        }
        Insert: {
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          session_id: string
          step: string
        }
        Update: {
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          session_id?: string
          step?: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


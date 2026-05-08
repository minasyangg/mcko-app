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
      assignments: {
        Row: {
          created_at: string | null
          created_by: string | null
          ends_at: string | null
          group_id: string | null
          id: string
          max_attempts: number | null
          organization_id: string
          preserve_answers: boolean
          starts_at: string | null
          student_id: string | null
          test_version_id: string
          time_limit_override_sec: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          group_id?: string | null
          id?: string
          max_attempts?: number | null
          organization_id: string
          preserve_answers?: boolean
          starts_at?: string | null
          student_id?: string | null
          test_version_id: string
          time_limit_override_sec?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          group_id?: string | null
          id?: string
          max_attempts?: number | null
          organization_id?: string
          preserve_answers?: boolean
          starts_at?: string | null
          student_id?: string | null
          test_version_id?: string
          time_limit_override_sec?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_test_version_id_fkey"
            columns: ["test_version_id"]
            isOneToOne: false
            referencedRelation: "test_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_task_answers: {
        Row: {
          answer_json: Json | null
          answer_version: number | null
          attempt_id: string | null
          auto_checked_at: string | null
          awarded_score: number | null
          id: string
          is_correct: boolean | null
          is_locked: boolean
          locked_in_attempt_id: string | null
          normalized_answer_json: Json | null
          task_id: string | null
          teacher_checked_at: string | null
          teacher_comment: string | null
          updated_at: string | null
        }
        Insert: {
          answer_json?: Json | null
          answer_version?: number | null
          attempt_id?: string | null
          auto_checked_at?: string | null
          awarded_score?: number | null
          id?: string
          is_correct?: boolean | null
          is_locked?: boolean
          locked_in_attempt_id?: string | null
          normalized_answer_json?: Json | null
          task_id?: string | null
          teacher_checked_at?: string | null
          teacher_comment?: string | null
          updated_at?: string | null
        }
        Update: {
          answer_json?: Json | null
          answer_version?: number | null
          attempt_id?: string | null
          auto_checked_at?: string | null
          awarded_score?: number | null
          id?: string
          is_correct?: boolean | null
          is_locked?: boolean
          locked_in_attempt_id?: string | null
          normalized_answer_json?: Json | null
          task_id?: string | null
          teacher_checked_at?: string | null
          teacher_comment?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempt_task_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempt_task_answers_locked_in_attempt_id_fkey"
            columns: ["locked_in_attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempt_task_answers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "test_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      attempts: {
        Row: {
          assignment_id: string
          checked_at: string | null
          created_at: string | null
          current_task_number: number | null
          id: string
          last_activity_at: string | null
          max_score: number | null
          score: number | null
          started_at: string | null
          status: string
          student_id: string
          submitted_at: string | null
          teacher_comment: string | null
        }
        Insert: {
          assignment_id: string
          checked_at?: string | null
          created_at?: string | null
          current_task_number?: number | null
          id?: string
          last_activity_at?: string | null
          max_score?: number | null
          score?: number | null
          started_at?: string | null
          status?: string
          student_id: string
          submitted_at?: string | null
          teacher_comment?: string | null
        }
        Update: {
          assignment_id?: string
          checked_at?: string | null
          created_at?: string | null
          current_task_number?: number | null
          id?: string
          last_activity_at?: string | null
          max_score?: number | null
          score?: number | null
          started_at?: string | null
          status?: string
          student_id?: string
          submitted_at?: string | null
          teacher_comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          meta: Json | null
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          meta?: Json | null
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          meta?: Json | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          added_at: string | null
          group_id: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          group_id: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          name: string
          settings: Json | null
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          settings?: Json | null
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          settings?: Json | null
          slug?: string
        }
        Relationships: []
      }
      parsing_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          result_summary: Json | null
          started_at: string | null
          status: string
          test_version_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          result_summary?: Json | null
          started_at?: string | null
          status?: string
          test_version_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          result_summary?: Json | null
          started_at?: string | null
          status?: string
          test_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parsing_jobs_test_version_id_fkey"
            columns: ["test_version_id"]
            isOneToOne: false
            referencedRelation: "test_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      parsing_warnings: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_resolved: boolean | null
          parsing_job_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_page: number | null
          source_text_snippet: string | null
          task_id: string | null
          warning_type: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_resolved?: boolean | null
          parsing_job_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_page?: number | null
          source_text_snippet?: string | null
          task_id?: string | null
          warning_type: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_resolved?: boolean | null
          parsing_job_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_page?: number | null
          source_text_snippet?: string | null
          task_id?: string | null
          warning_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "parsing_warnings_parsing_job_id_fkey"
            columns: ["parsing_job_id"]
            isOneToOne: false
            referencedRelation: "parsing_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsing_warnings_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsing_warnings_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "test_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      presence_events: {
        Row: {
          attempt_id: string | null
          created_at: string | null
          current_task_number: number | null
          event_type: string
          id: string
          meta: Json | null
          student_id: string | null
        }
        Insert: {
          attempt_id?: string | null
          created_at?: string | null
          current_task_number?: number | null
          event_type: string
          id?: string
          meta?: Json | null
          student_id?: string | null
        }
        Update: {
          attempt_id?: string | null
          created_at?: string | null
          current_task_number?: number | null
          event_type?: string
          id?: string
          meta?: Json | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "presence_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presence_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          full_name: string
          grade: string | null
          id: string
          is_active: boolean | null
          organization_id: string | null
          role: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          full_name: string
          grade?: string | null
          id: string
          is_active?: boolean | null
          organization_id?: string | null
          role: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          full_name?: string
          grade?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_rule_items: {
        Row: {
          id: string
          max_score: number
          note: string | null
          rule_id: string
          task_number: number
        }
        Insert: {
          id?: string
          max_score?: number
          note?: string | null
          rule_id: string
          task_number: number
        }
        Update: {
          id?: string
          max_score?: number
          note?: string | null
          rule_id?: string
          task_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_rule_items_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "scoring_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_rules: {
        Row: {
          created_at: string | null
          created_by: string | null
          exam_type: string | null
          grade: string | null
          id: string
          name: string
          organization_id: string
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          exam_type?: string | null
          grade?: string | null
          id?: string
          name: string
          organization_id: string
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          exam_type?: string | null
          grade?: string | null
          id?: string
          name?: string
          organization_id?: string
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      solution_media: {
        Row: {
          alt_text: string | null
          created_at: string | null
          file_size_bytes: number | null
          format: string | null
          height_px: number | null
          id: string
          media_type: string
          original_filename: string | null
          solution_id: string | null
          sort_order: number | null
          source_page: number | null
          storage_path: string
          width_px: number | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          format?: string | null
          height_px?: number | null
          id?: string
          media_type?: string
          original_filename?: string | null
          solution_id?: string | null
          sort_order?: number | null
          source_page?: number | null
          storage_path: string
          width_px?: number | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          format?: string | null
          height_px?: number | null
          id?: string
          media_type?: string
          original_filename?: string | null
          solution_id?: string | null
          sort_order?: number | null
          source_page?: number | null
          storage_path?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "solution_media_solution_id_fkey"
            columns: ["solution_id"]
            isOneToOne: false
            referencedRelation: "task_solutions"
            referencedColumns: ["id"]
          },
        ]
      }
      solution_requests: {
        Row: {
          attempt_id: string
          created_at: string | null
          expires_at: string | null
          id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          student_id: string
          student_message: string | null
          task_id: string
          teacher_note: string | null
        }
        Insert: {
          attempt_id: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          student_id: string
          student_message?: string | null
          task_id: string
          teacher_note?: string | null
        }
        Update: {
          attempt_id?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          student_id?: string
          student_message?: string | null
          task_id?: string
          teacher_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solution_requests_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solution_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solution_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solution_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "test_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      student_final_results: {
        Row: {
          attempt_count: number | null
          created_at: string | null
          final_score: number | null
          id: string
          last_completed_at: string | null
          max_score: number | null
          status: string | null
          student_id: string
          test_version_id: string
          updated_at: string | null
        }
        Insert: {
          attempt_count?: number | null
          created_at?: string | null
          final_score?: number | null
          id?: string
          last_completed_at?: string | null
          max_score?: number | null
          status?: string | null
          student_id: string
          test_version_id: string
          updated_at?: string | null
        }
        Update: {
          attempt_count?: number | null
          created_at?: string | null
          final_score?: number | null
          id?: string
          last_completed_at?: string | null
          max_score?: number | null
          status?: string | null
          student_id?: string
          test_version_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_final_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_final_results_test_version_id_fkey"
            columns: ["test_version_id"]
            isOneToOne: false
            referencedRelation: "test_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      task_answer_keys: {
        Row: {
          correct_answer: Json
          created_at: string | null
          grading_config: Json | null
          grading_method: string
          id: string
          parse_confidence: number | null
          partial_score_rules: Json | null
          task_id: string | null
        }
        Insert: {
          correct_answer: Json
          created_at?: string | null
          grading_config?: Json | null
          grading_method?: string
          id?: string
          parse_confidence?: number | null
          partial_score_rules?: Json | null
          task_id?: string | null
        }
        Update: {
          correct_answer?: Json
          created_at?: string | null
          grading_config?: Json | null
          grading_method?: string
          id?: string
          parse_confidence?: number | null
          partial_score_rules?: Json | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_answer_keys_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "test_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_media: {
        Row: {
          alt_text: string | null
          created_at: string | null
          file_size_bytes: number | null
          format: string | null
          height_px: number | null
          id: string
          is_manually_uploaded: boolean | null
          media_type: string
          original_filename: string | null
          placement: string | null
          sort_order: number | null
          source_bbox: Json | null
          source_page: number | null
          storage_path: string
          task_id: string | null
          width_px: number | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          format?: string | null
          height_px?: number | null
          id?: string
          is_manually_uploaded?: boolean | null
          media_type?: string
          original_filename?: string | null
          placement?: string | null
          sort_order?: number | null
          source_bbox?: Json | null
          source_page?: number | null
          storage_path: string
          task_id?: string | null
          width_px?: number | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string | null
          file_size_bytes?: number | null
          format?: string | null
          height_px?: number | null
          id?: string
          is_manually_uploaded?: boolean | null
          media_type?: string
          original_filename?: string | null
          placement?: string | null
          sort_order?: number | null
          source_bbox?: Json | null
          source_page?: number | null
          storage_path?: string
          task_id?: string | null
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_media_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "test_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_solutions: {
        Row: {
          access_policy: string | null
          created_at: string | null
          has_images: boolean | null
          id: string
          solution_html: string | null
          solution_text: string | null
          task_id: string | null
        }
        Insert: {
          access_policy?: string | null
          created_at?: string | null
          has_images?: boolean | null
          id?: string
          solution_html?: string | null
          solution_text?: string | null
          task_id?: string | null
        }
        Update: {
          access_policy?: string | null
          created_at?: string | null
          has_images?: boolean | null
          id?: string
          solution_html?: string | null
          solution_text?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_solutions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "test_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      test_documents: {
        Row: {
          created_at: string | null
          doc_type: string
          extracted_images_count: number | null
          extracted_text: Json | null
          id: string
          original_filename: string | null
          page_count: number | null
          parse_status: string | null
          storage_path: string
          test_version_id: string | null
        }
        Insert: {
          created_at?: string | null
          doc_type: string
          extracted_images_count?: number | null
          extracted_text?: Json | null
          id?: string
          original_filename?: string | null
          page_count?: number | null
          parse_status?: string | null
          storage_path: string
          test_version_id?: string | null
        }
        Update: {
          created_at?: string | null
          doc_type?: string
          extracted_images_count?: number | null
          extracted_text?: Json | null
          id?: string
          original_filename?: string | null
          page_count?: number | null
          parse_status?: string | null
          storage_path?: string
          test_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_documents_test_version_id_fkey"
            columns: ["test_version_id"]
            isOneToOne: false
            referencedRelation: "test_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      test_tasks: {
        Row: {
          answer_format_hint: string | null
          answer_parts: Json | null
          created_at: string | null
          has_images: boolean | null
          id: string
          max_score: number | null
          options: Json | null
          parse_confidence: number | null
          prompt_html: string | null
          prompt_text: string
          review_note: string | null
          review_status: string | null
          sort_order: number
          source_doc_id: string | null
          source_pages: number[] | null
          task_number: number
          task_type: string
          test_version_id: string | null
          title: string | null
        }
        Insert: {
          answer_format_hint?: string | null
          answer_parts?: Json | null
          created_at?: string | null
          has_images?: boolean | null
          id?: string
          max_score?: number | null
          options?: Json | null
          parse_confidence?: number | null
          prompt_html?: string | null
          prompt_text: string
          review_note?: string | null
          review_status?: string | null
          sort_order: number
          source_doc_id?: string | null
          source_pages?: number[] | null
          task_number: number
          task_type?: string
          test_version_id?: string | null
          title?: string | null
        }
        Update: {
          answer_format_hint?: string | null
          answer_parts?: Json | null
          created_at?: string | null
          has_images?: boolean | null
          id?: string
          max_score?: number | null
          options?: Json | null
          parse_confidence?: number | null
          prompt_html?: string | null
          prompt_text?: string
          review_note?: string | null
          review_status?: string | null
          sort_order?: number
          source_doc_id?: string | null
          source_pages?: number[] | null
          task_number?: number
          task_type?: string
          test_version_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_tasks_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "test_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_tasks_test_version_id_fkey"
            columns: ["test_version_id"]
            isOneToOne: false
            referencedRelation: "test_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      test_versions: {
        Row: {
          created_at: string | null
          id: string
          max_attempts: number | null
          published_at: string | null
          published_by: string | null
          result_visibility: string | null
          scoring_policy: Json | null
          shuffle_tasks: boolean | null
          status: string
          test_id: string | null
          time_limit_sec: number | null
          version_number: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          max_attempts?: number | null
          published_at?: string | null
          published_by?: string | null
          result_visibility?: string | null
          scoring_policy?: Json | null
          shuffle_tasks?: boolean | null
          status?: string
          test_id?: string | null
          time_limit_sec?: number | null
          version_number: number
        }
        Update: {
          created_at?: string | null
          id?: string
          max_attempts?: number | null
          published_at?: string | null
          published_by?: string | null
          result_visibility?: string | null
          scoring_policy?: Json | null
          shuffle_tasks?: boolean | null
          status?: string
          test_id?: string | null
          time_limit_sec?: number | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_versions_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      tests: {
        Row: {
          created_at: string | null
          created_by: string | null
          current_published_version_id: string | null
          description: string | null
          exam_type: string | null
          grade: string | null
          id: string
          is_active: boolean
          organization_id: string
          status: string
          subject: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          current_published_version_id?: string | null
          description?: string | null
          exam_type?: string | null
          grade?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          status?: string
          subject?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          current_published_version_id?: string | null
          description?: string | null
          exam_type?: string | null
          grade?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          status?: string
          subject?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_tests_current_version"
            columns: ["current_published_version_id"]
            isOneToOne: false
            referencedRelation: "test_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org: { Args: never; Returns: string }
      auth_role: { Args: never; Returns: string }
      check_test_in_auth_org: { Args: { p_test_id: string }; Returns: boolean }
      delete_student_cascade: {
        Args: { target_student_id: string }
        Returns: Json
      }
      get_active_students: {
        Args: { org_id: string }
        Returns: {
          created_at: string
          deleted_at: string
          full_name: string
          grade: string
          id: string
          is_active: boolean
        }[]
      }
      student_has_task_assignment: {
        Args: { p_version_id: string }
        Returns: boolean
      }
      student_has_test_assignment: {
        Args: { p_test_id: string }
        Returns: boolean
      }
      student_has_version_assignment: {
        Args: { p_version_id: string }
        Returns: boolean
      }
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

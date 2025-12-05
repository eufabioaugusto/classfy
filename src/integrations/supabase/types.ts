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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      actions: {
        Row: {
          content_id: string | null
          course_id: string | null
          created_at: string
          id: string
          multiplier: number
          points: number
          type: Database["public"]["Enums"]["action_type"]
          user_id: string
          value: number
        }
        Insert: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          multiplier?: number
          points?: number
          type: Database["public"]["Enums"]["action_type"]
          user_id: string
          value?: number
        }
        Update: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          multiplier?: number
          points?: number
          type?: Database["public"]["Enums"]["action_type"]
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "actions_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      actions_config: {
        Row: {
          action_type: Database["public"]["Enums"]["action_type"]
          active: boolean
          base_points: number
          base_value: number
          created_at: string
          id: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["action_type"]
          active?: boolean
          base_points?: number
          base_value?: number
          created_at?: string
          id?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["action_type"]
          active?: boolean
          base_points?: number
          base_value?: number
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      awards: {
        Row: {
          created_at: string
          description: string | null
          icon_url: string | null
          id: string
          name: string
          points_required: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
          points_required?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
          points_required?: number | null
        }
        Relationships: []
      }
      badges: {
        Row: {
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
          name: string
          requirement_type: string
          requirement_value: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
          requirement_type: string
          requirement_value?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
          requirement_type?: string
          requirement_value?: number | null
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boosts: {
        Row: {
          audience_filters: Json | null
          audience_type: Database["public"]["Enums"]["audience_type"]
          clicks_count: number | null
          content_id: string | null
          created_at: string | null
          daily_budget: number
          duration_days: number
          end_date: string | null
          id: string
          impressions_count: number | null
          objective: Database["public"]["Enums"]["boost_objective"]
          start_date: string | null
          status: Database["public"]["Enums"]["boost_status"]
          stripe_payment_intent_id: string | null
          total_budget: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          audience_filters?: Json | null
          audience_type?: Database["public"]["Enums"]["audience_type"]
          clicks_count?: number | null
          content_id?: string | null
          created_at?: string | null
          daily_budget: number
          duration_days: number
          end_date?: string | null
          id?: string
          impressions_count?: number | null
          objective: Database["public"]["Enums"]["boost_objective"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["boost_status"]
          stripe_payment_intent_id?: string | null
          total_budget?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          audience_filters?: Json | null
          audience_type?: Database["public"]["Enums"]["audience_type"]
          clicks_count?: number | null
          content_id?: string | null
          created_at?: string | null
          daily_budget?: number
          duration_days?: number
          end_date?: string | null
          id?: string
          impressions_count?: number | null
          objective?: Database["public"]["Enums"]["boost_objective"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["boost_status"]
          stripe_payment_intent_id?: string | null
          total_budget?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boosts_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boosts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          content_id: string
          created_at: string
          id: string
          parent_id: string | null
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content_id: string
          created_at?: string
          id?: string
          parent_id?: string | null
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content_id?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_metrics: {
        Row: {
          content_id: string
          created_at: string
          event: string
          id: string
          user_id: string
        }
        Insert: {
          content_id: string
          created_at?: string
          event: string
          id?: string
          user_id: string
        }
        Update: {
          content_id?: string
          created_at?: string
          event?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_metrics_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
        ]
      }
      content_views: {
        Row: {
          content_id: string | null
          course_id: string | null
          created_at: string | null
          first_viewed_at: string | null
          id: string
          last_viewed_at: string | null
          total_watch_time_seconds: number | null
          updated_at: string | null
          user_id: string
          view_count: number | null
          view_date: string
        }
        Insert: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string | null
          first_viewed_at?: string | null
          id?: string
          last_viewed_at?: string | null
          total_watch_time_seconds?: number | null
          updated_at?: string | null
          user_id: string
          view_count?: number | null
          view_date?: string
        }
        Update: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string | null
          first_viewed_at?: string | null
          id?: string
          last_viewed_at?: string | null
          total_watch_time_seconds?: number | null
          updated_at?: string | null
          user_id?: string
          view_count?: number | null
          view_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_views_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_views_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      contents: {
        Row: {
          category_id: string | null
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          creator_id: string
          description: string | null
          discount: number | null
          duration_minutes: number | null
          duration_seconds: number | null
          file_url: string | null
          id: string
          is_free: boolean
          lesson_count: number | null
          likes_count: number | null
          price: number | null
          published_at: string | null
          required_plan: Database["public"]["Enums"]["plan_type"] | null
          status: string | null
          tags: string[] | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_url: string | null
          views_count: number | null
          visibility: Database["public"]["Enums"]["content_visibility"] | null
        }
        Insert: {
          category_id?: string | null
          content_type: Database["public"]["Enums"]["content_type"]
          created_at?: string
          creator_id: string
          description?: string | null
          discount?: number | null
          duration_minutes?: number | null
          duration_seconds?: number | null
          file_url?: string | null
          id?: string
          is_free?: boolean
          lesson_count?: number | null
          likes_count?: number | null
          price?: number | null
          published_at?: string | null
          required_plan?: Database["public"]["Enums"]["plan_type"] | null
          status?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
          views_count?: number | null
          visibility?: Database["public"]["Enums"]["content_visibility"] | null
        }
        Update: {
          category_id?: string | null
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          creator_id?: string
          description?: string | null
          discount?: number | null
          duration_minutes?: number | null
          duration_seconds?: number | null
          file_url?: string | null
          id?: string
          is_free?: boolean
          lesson_count?: number | null
          likes_count?: number | null
          price?: number | null
          published_at?: string | null
          required_plan?: Database["public"]["Enums"]["plan_type"] | null
          status?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
          views_count?: number | null
          visibility?: Database["public"]["Enums"]["content_visibility"] | null
        }
        Relationships: [
          {
            foreignKeyName: "contents_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contents_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          id: string
          is_archived: boolean
          is_muted: boolean
          joined_at: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          is_archived?: boolean
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          is_archived?: boolean
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      course_enrollments: {
        Row: {
          completed_at: string | null
          completed_lessons: string[] | null
          course_id: string
          enrolled_at: string
          id: string
          last_lesson_id: string | null
          progress_percent: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_lessons?: string[] | null
          course_id: string
          enrolled_at?: string
          id?: string
          last_lesson_id?: string | null
          progress_percent?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_lessons?: string[] | null
          course_id?: string
          enrolled_at?: string
          id?: string
          last_lesson_id?: string | null
          progress_percent?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_enrollments_last_lesson_id_fkey"
            columns: ["last_lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_lessons: {
        Row: {
          content_id: string | null
          course_id: string
          created_at: string
          description: string | null
          duration_seconds: number | null
          id: string
          is_preview: boolean | null
          module_id: string
          order_index: number
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          content_id?: string | null
          course_id: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean | null
          module_id: string
          order_index: number
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          content_id?: string | null
          course_id?: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean | null
          module_id?: string
          order_index?: number
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_lessons_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      course_materials: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          file_size: number | null
          file_type: string
          file_url: string
          id: string
          lesson_id: string | null
          module_id: string | null
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          file_size?: number | null
          file_type: string
          file_url: string
          id?: string
          lesson_id?: string | null
          module_id?: string | null
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          file_size?: number | null
          file_type?: string
          file_url?: string
          id?: string
          lesson_id?: string | null
          module_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_materials_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_materials_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_materials_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      course_modules: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          id: string
          order_index: number
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          order_index: number
          title: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          order_index?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_quizzes: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          id: string
          max_attempts: number | null
          module_id: string | null
          order_index: number
          passing_score: number | null
          questions: Json
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          max_attempts?: number | null
          module_id?: string | null
          order_index: number
          passing_score?: number | null
          questions: Json
          title: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          max_attempts?: number | null
          module_id?: string | null
          order_index?: number
          passing_score?: number | null
          questions?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_quizzes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_quizzes_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          creator_id: string
          description: string | null
          discount: number | null
          id: string
          level: string | null
          likes_count: number | null
          price: number | null
          published_at: string | null
          requirements: string | null
          status: string
          students_count: number | null
          tags: string[] | null
          thumbnail_url: string | null
          title: string
          total_duration_seconds: number | null
          total_lessons: number | null
          updated_at: string
          views_count: number | null
          visibility: Database["public"]["Enums"]["content_visibility"] | null
          what_you_learn: string | null
        }
        Insert: {
          created_at?: string
          creator_id: string
          description?: string | null
          discount?: number | null
          id?: string
          level?: string | null
          likes_count?: number | null
          price?: number | null
          published_at?: string | null
          requirements?: string | null
          status?: string
          students_count?: number | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title: string
          total_duration_seconds?: number | null
          total_lessons?: number | null
          updated_at?: string
          views_count?: number | null
          visibility?: Database["public"]["Enums"]["content_visibility"] | null
          what_you_learn?: string | null
        }
        Update: {
          created_at?: string
          creator_id?: string
          description?: string | null
          discount?: number | null
          id?: string
          level?: string | null
          likes_count?: number | null
          price?: number | null
          published_at?: string | null
          requirements?: string | null
          status?: string
          students_count?: number | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string
          total_duration_seconds?: number | null
          total_lessons?: number | null
          updated_at?: string
          views_count?: number | null
          visibility?: Database["public"]["Enums"]["content_visibility"] | null
          what_you_learn?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courses_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_requests: {
        Row: {
          admin_notes: string | null
          bio: string | null
          channel_name: string
          created_at: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["creator_status"]
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          bio?: string | null
          channel_name: string
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["creator_status"]
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          bio?: string | null
          channel_name?: string
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["creator_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          content_id: string | null
          course_id: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      featured_creators: {
        Row: {
          background_image_url: string
          badge_text: string
          created_at: string | null
          creator_id: string
          description: string
          featured_image_url: string
          id: string
          link_url: string
          order_index: number
          updated_at: string | null
        }
        Insert: {
          background_image_url: string
          badge_text?: string
          created_at?: string | null
          creator_id: string
          description: string
          featured_image_url: string
          id?: string
          link_url: string
          order_index?: number
          updated_at?: string | null
        }
        Update: {
          background_image_url?: string
          badge_text?: string
          created_at?: string | null
          creator_id?: string
          description?: string
          featured_image_url?: string
          id?: string
          link_url?: string
          order_index?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "featured_creators_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_following_id_fkey"
            columns: ["following_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_settings: {
        Row: {
          created_at: string
          id: string
          privacy_mode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          privacy_mode?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          privacy_mode?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_read: boolean
          is_request: boolean
          request_status: string | null
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          is_request?: boolean
          request_status?: string | null
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          is_request?: boolean
          request_status?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          related_content_id: string | null
          related_reward_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          related_content_id?: string | null
          related_reward_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          related_content_id?: string | null
          related_reward_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_related_content_id_fkey"
            columns: ["related_content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_related_reward_id_fkey"
            columns: ["related_reward_id"]
            isOneToOne: false
            referencedRelation: "reward_events"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          billing_id: string | null
          bio: string | null
          cover_image_url: string | null
          created_at: string
          creator_bio: string | null
          creator_channel_name: string | null
          creator_status: Database["public"]["Enums"]["creator_status"]
          display_name: string
          id: string
          plan: Database["public"]["Enums"]["plan_type"]
          plan_expires_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          billing_id?: string | null
          bio?: string | null
          cover_image_url?: string | null
          created_at?: string
          creator_bio?: string | null
          creator_channel_name?: string | null
          creator_status?: Database["public"]["Enums"]["creator_status"]
          display_name: string
          id: string
          plan?: Database["public"]["Enums"]["plan_type"]
          plan_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          billing_id?: string | null
          bio?: string | null
          cover_image_url?: string | null
          created_at?: string
          creator_bio?: string | null
          creator_channel_name?: string | null
          creator_status?: Database["public"]["Enums"]["creator_status"]
          display_name?: string
          id?: string
          plan?: Database["public"]["Enums"]["plan_type"]
          plan_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      purchased_contents: {
        Row: {
          content_id: string
          discount_applied: number | null
          id: string
          price_paid: number
          purchased_at: string | null
          user_id: string
        }
        Insert: {
          content_id: string
          discount_applied?: number | null
          id?: string
          price_paid: number
          purchased_at?: string | null
          user_id: string
        }
        Update: {
          content_id?: string
          discount_applied?: number | null
          id?: string
          price_paid?: number
          purchased_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchased_contents_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          answers: Json
          completed_at: string | null
          id: string
          max_score: number
          quiz_id: string
          score: number
          time_spent_seconds: number | null
          user_id: string
        }
        Insert: {
          answers: Json
          completed_at?: string | null
          id?: string
          max_score: number
          quiz_id: string
          score: number
          time_spent_seconds?: number | null
          user_id: string
        }
        Update: {
          answers?: Json
          completed_at?: string | null
          id?: string
          max_score?: number
          quiz_id?: string
          score?: number
          time_spent_seconds?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "study_quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_commissions: {
        Row: {
          commission_amount: number
          commission_rate: number
          conversion_id: string
          created_at: string | null
          id: string
          paid_at: string | null
          purchase_amount: number
          purchase_type: string
          referred_user_id: string
          referrer_id: string
          status: string | null
          stripe_charge_id: string | null
        }
        Insert: {
          commission_amount: number
          commission_rate: number
          conversion_id: string
          created_at?: string | null
          id?: string
          paid_at?: string | null
          purchase_amount: number
          purchase_type: string
          referred_user_id: string
          referrer_id: string
          status?: string | null
          stripe_charge_id?: string | null
        }
        Update: {
          commission_amount?: number
          commission_rate?: number
          conversion_id?: string
          created_at?: string | null
          id?: string
          paid_at?: string | null
          purchase_amount?: number
          purchase_type?: string
          referred_user_id?: string
          referrer_id?: string
          status?: string | null
          stripe_charge_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_commissions_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "referral_conversions"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_conversions: {
        Row: {
          commission_paid: boolean | null
          converted_at: string | null
          created_at: string | null
          first_purchase_at: string | null
          id: string
          referral_code: string
          referred_user_id: string
          referrer_id: string
        }
        Insert: {
          commission_paid?: boolean | null
          converted_at?: string | null
          created_at?: string | null
          first_purchase_at?: string | null
          id?: string
          referral_code: string
          referred_user_id: string
          referrer_id: string
        }
        Update: {
          commission_paid?: boolean | null
          converted_at?: string | null
          created_at?: string | null
          first_purchase_at?: string | null
          id?: string
          referral_code?: string
          referred_user_id?: string
          referrer_id?: string
        }
        Relationships: []
      }
      referral_links: {
        Row: {
          created_at: string | null
          id: string
          referral_code: string
          total_clicks: number | null
          total_conversions: number | null
          total_purchases: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          referral_code: string
          total_clicks?: number | null
          total_conversions?: number | null
          total_purchases?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          referral_code?: string
          total_clicks?: number | null
          total_conversions?: number | null
          total_purchases?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reward_action_tracking: {
        Row: {
          action_key: string
          content_id: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action_key: string
          content_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action_key?: string
          content_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_action_tracking_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_actions_config: {
        Row: {
          action_key: string
          active: boolean
          created_at: string
          description: string | null
          id: string
          points_creator: number
          points_user: number
          updated_at: string
          value_creator: number
          value_user: number
        }
        Insert: {
          action_key: string
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          points_creator?: number
          points_user?: number
          updated_at?: string
          value_creator?: number
          value_user?: number
        }
        Update: {
          action_key?: string
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          points_creator?: number
          points_user?: number
          updated_at?: string
          value_creator?: number
          value_user?: number
        }
        Relationships: []
      }
      reward_events: {
        Row: {
          action_key: string
          can_withdraw_at: string | null
          content_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          points: number
          related_user_id: string | null
          user_id: string
          value: number
        }
        Insert: {
          action_key: string
          can_withdraw_at?: string | null
          content_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          points?: number
          related_user_id?: string | null
          user_id: string
          value?: number
        }
        Update: {
          action_key?: string
          can_withdraw_at?: string | null
          content_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          points?: number
          related_user_id?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "reward_events_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_contents: {
        Row: {
          content_id: string | null
          course_id: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          content_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_contents_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_contents_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_contents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      studies: {
        Row: {
          created_at: string
          description: string | null
          id: string
          last_activity_at: string
          main_topic: string | null
          plan_at_creation: Database["public"]["Enums"]["plan_type"]
          status: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          last_activity_at?: string
          main_topic?: string | null
          plan_at_creation?: Database["public"]["Enums"]["plan_type"]
          status?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          last_activity_at?: string
          main_topic?: string | null
          plan_at_creation?: Database["public"]["Enums"]["plan_type"]
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      study_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          related_contents: Json | null
          role: string
          study_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          related_contents?: Json | null
          role: string
          study_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          related_contents?: Json | null
          role?: string
          study_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_messages_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      study_notes: {
        Row: {
          content_id: string | null
          created_at: string | null
          id: string
          lesson_id: string | null
          note_text: string
          study_id: string | null
          timestamp_seconds: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content_id?: string | null
          created_at?: string | null
          id?: string
          lesson_id?: string | null
          note_text: string
          study_id?: string | null
          timestamp_seconds?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content_id?: string | null
          created_at?: string | null
          id?: string
          lesson_id?: string | null
          note_text?: string
          study_id?: string | null
          timestamp_seconds?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_notes_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_notes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_notes_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      study_playlists: {
        Row: {
          created_at: string
          id: string
          message_id: string
          study_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          study_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          study_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_playlists_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "study_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_playlists_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_playlists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      study_quizzes: {
        Row: {
          content_id: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          questions: Json
          study_id: string
        }
        Insert: {
          content_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          questions: Json
          study_id: string
        }
        Update: {
          content_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          questions?: Json
          study_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_quizzes_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_quizzes_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          config_key: string
          config_value: Json
          created_at: string | null
          description: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          config_key: string
          config_value: Json
          created_at?: string | null
          description?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          config_key?: string
          config_value?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transcriptions: {
        Row: {
          content_id: string
          created_at: string | null
          id: string
          language: string | null
          text: string
          updated_at: string | null
        }
        Insert: {
          content_id: string
          created_at?: string | null
          id?: string
          language?: string | null
          text: string
          updated_at?: string | null
        }
        Update: {
          content_id?: string
          created_at?: string | null
          id?: string
          language?: string | null
          text?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transcriptions_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: true
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_awards: {
        Row: {
          award_id: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          award_id: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          award_id?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_awards_award_id_fkey"
            columns: ["award_id"]
            isOneToOne: false
            referencedRelation: "awards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_awards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          badge_id: string
          earned_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          badge_id: string
          earned_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          badge_id?: string
          earned_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_levels: {
        Row: {
          created_at: string | null
          current_level: number | null
          id: string
          total_points: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_level?: number | null
          id?: string
          total_points?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_level?: number | null
          id?: string
          total_points?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_levels_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_login_streaks: {
        Row: {
          created_at: string | null
          current_streak: number | null
          id: string
          last_login_date: string | null
          longest_streak: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_streak?: number | null
          id?: string
          last_login_date?: string | null
          longest_streak?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_streak?: number | null
          id?: string
          last_login_date?: string | null
          longest_streak?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_progress: {
        Row: {
          completed: boolean | null
          completed_at: string | null
          content_id: string
          created_at: string
          id: string
          last_position_seconds: number | null
          progress_percent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          completed_at?: string | null
          content_id: string
          created_at?: string
          id?: string
          last_position_seconds?: number | null
          progress_percent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean | null
          completed_at?: string | null
          content_id?: string
          created_at?: string
          id?: string
          last_position_seconds?: number | null
          progress_percent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_progress_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_processing_jobs: {
        Row: {
          completed_at: string | null
          compressed_path: string | null
          compressed_size: number | null
          compression_ratio: number | null
          course_id: string | null
          created_at: string
          error_message: string | null
          file_size: number | null
          id: string
          lesson_id: string | null
          metadata: Json | null
          original_path: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          compressed_path?: string | null
          compressed_size?: number | null
          compression_ratio?: number | null
          course_id?: string | null
          created_at?: string
          error_message?: string | null
          file_size?: number | null
          id?: string
          lesson_id?: string | null
          metadata?: Json | null
          original_path: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          compressed_path?: string | null
          compressed_size?: number | null
          compression_ratio?: number | null
          course_id?: string | null
          created_at?: string
          error_message?: string | null
          file_size?: number | null
          id?: string
          lesson_id?: string | null
          metadata?: Json | null
          original_path?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_processing_jobs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_processing_jobs_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_processing_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          action_id: string | null
          amount: number
          created_at: string
          description: string | null
          id: string
          type: string
          wallet_id: string
        }
        Insert: {
          action_id?: string | null
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          type: string
          wallet_id: string
        }
        Update: {
          action_id?: string | null
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          type?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          total_earned: number
          total_withdrawn: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          total_earned?: number
          total_withdrawn?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          total_earned?: number
          total_withdrawn?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      withdraw_requests: {
        Row: {
          admin_notes: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          pix_key: string
          status: Database["public"]["Enums"]["withdraw_status"]
          user_id: string
          wallet_id: string
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          pix_key: string
          status?: Database["public"]["Enums"]["withdraw_status"]
          user_id: string
          wallet_id: string
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          pix_key?: string
          status?: Database["public"]["Enums"]["withdraw_status"]
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdraw_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdraw_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdraw_requests_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      count_active_studies: { Args: { p_user_id: string }; Returns: number }
      create_or_get_conversation: {
        Args: { p_user1_id: string; p_user2_id: string }
        Returns: string
      }
      delete_conversation_for_user: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: undefined
      }
      get_public_profile: {
        Args: { profile_id: string }
        Returns: {
          avatar_url: string
          bio: string
          cover_image_url: string
          created_at: string
          creator_bio: string
          creator_channel_name: string
          creator_status: Database["public"]["Enums"]["creator_status"]
          display_name: string
          id: string
          updated_at: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_content_view: {
        Args: { p_content_id: string; p_user_id: string }
        Returns: Json
      }
      increment_course_view: {
        Args: { p_course_id: string; p_user_id: string }
        Returns: Json
      }
      is_content_boosted: { Args: { p_content_id: string }; Returns: boolean }
      is_conversation_participant: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: boolean
      }
      respond_message_request: {
        Args: { p_approved: boolean; p_conversation_id: string }
        Returns: undefined
      }
    }
    Enums: {
      action_type:
        | "VIEW"
        | "LIKE"
        | "SAVE"
        | "FAVORITE"
        | "COMMENT"
        | "WATCH_100"
        | "COURSE_COMPLETE"
        | "IA_INTERACTION"
      app_role: "user" | "creator" | "admin"
      audience_type: "automatic" | "segmented"
      boost_objective: "profile" | "content"
      boost_status:
        | "pending_payment"
        | "active"
        | "paused"
        | "completed"
        | "cancelled"
      content_type: "aula" | "short" | "podcast"
      content_visibility: "free" | "pro" | "premium" | "paid"
      creator_status: "none" | "pending" | "approved" | "rejected"
      plan_type: "free" | "pro" | "premium"
      withdraw_status: "pending" | "approved" | "rejected"
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
    Enums: {
      action_type: [
        "VIEW",
        "LIKE",
        "SAVE",
        "FAVORITE",
        "COMMENT",
        "WATCH_100",
        "COURSE_COMPLETE",
        "IA_INTERACTION",
      ],
      app_role: ["user", "creator", "admin"],
      audience_type: ["automatic", "segmented"],
      boost_objective: ["profile", "content"],
      boost_status: [
        "pending_payment",
        "active",
        "paused",
        "completed",
        "cancelled",
      ],
      content_type: ["aula", "short", "podcast"],
      content_visibility: ["free", "pro", "premium", "paid"],
      creator_status: ["none", "pending", "approved", "rejected"],
      plan_type: ["free", "pro", "premium"],
      withdraw_status: ["pending", "approved", "rejected"],
    },
  },
} as const

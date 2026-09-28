import { supabase } from "@/integrations/supabase/client";
export interface OnboardingState {
  journey: "user" | "creator";
  step: number;
  answers: { name?: string; interests?: string[]; bio?: string; goal?: string };
  demo_actions: string[];
  completed_at: string | null;
  bonus_event_id: string | null;
}
// RPC contracts added by the guided onboarding migration.
const client = supabase as unknown as {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
export async function getOnboarding() {
  const { data, error } = await client.rpc("onboarding_state_v1");
  if (error) throw new Error(error.message);
  return data as {
    required: boolean;
    state: OnboardingState | null;
    bonus_points: number;
  };
}
export async function saveOnboarding(
  step: number,
  answers: Record<string, unknown> = {},
  action?: string,
) {
  const { data, error } = await client.rpc("save_onboarding_v1", {
    p_step: step,
    p_answers: answers,
    p_action: action || null,
  });
  if (error) throw new Error(error.message);
  return data as OnboardingState;
}

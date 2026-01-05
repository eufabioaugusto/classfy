import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreatorMilestone {
  id: string;
  milestone_type: string;
  milestone_value: number;
  points_reward: number;
  value_reward: number;
  title: string;
  active: boolean;
}

interface CreatorStats {
  totalContents: number;
  totalFollowers: number;
  totalEarnings: number;
  totalViews: number;
  engagementRate: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { creatorId } = await req.json();

    if (!creatorId) {
      throw new Error("creatorId is required");
    }

    console.log(`Checking milestones for creator: ${creatorId}`);

    // Get creator stats
    const stats = await getCreatorStats(supabase, creatorId);
    console.log("Creator stats:", stats);

    // Get all active milestones
    const { data: milestones, error: milestonesError } = await supabase
      .from("creator_milestones")
      .select("*")
      .eq("active", true)
      .order("order_index");

    if (milestonesError) throw milestonesError;

    // Get existing progress
    const { data: existingProgress, error: progressError } = await supabase
      .from("creator_milestone_progress")
      .select("*")
      .eq("creator_id", creatorId);

    if (progressError) throw progressError;

    const progressMap = new Map(existingProgress?.map(p => [p.milestone_id, p]) || []);
    const newlyCompleted: string[] = [];

    // Check each milestone
    for (const milestone of milestones || []) {
      const currentValue = getCurrentValue(stats, milestone.milestone_type);
      const isCompleted = currentValue >= milestone.milestone_value;
      const existingRecord = progressMap.get(milestone.id);

      if (existingRecord) {
        // Update current value if changed
        if (existingRecord.current_value !== currentValue) {
          await supabase
            .from("creator_milestone_progress")
            .update({
              current_value: currentValue,
              completed_at: isCompleted && !existingRecord.completed_at ? new Date().toISOString() : existingRecord.completed_at,
              updated_at: new Date().toISOString()
            })
            .eq("id", existingRecord.id);

          // Track newly completed
          if (isCompleted && !existingRecord.completed_at) {
            newlyCompleted.push(milestone.id);
            await createNotification(supabase, creatorId, milestone);
          }
        }
      } else {
        // Create new progress record
        const { error: insertError } = await supabase
          .from("creator_milestone_progress")
          .insert({
            creator_id: creatorId,
            milestone_id: milestone.id,
            current_value: currentValue,
            completed_at: isCompleted ? new Date().toISOString() : null,
            claimed: false
          });

        if (insertError) {
          console.error("Error inserting progress:", insertError);
        }

        // Track newly completed
        if (isCompleted) {
          newlyCompleted.push(milestone.id);
          await createNotification(supabase, creatorId, milestone);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        milestonesChecked: milestones?.length || 0,
        newlyCompleted
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error checking milestones:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function getCreatorStats(supabase: any, creatorId: string): Promise<CreatorStats> {
  // Get total approved contents
  const { count: contentsCount } = await supabase
    .from("contents")
    .select("*", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("status", "approved");

  // Get total followers
  const { count: followersCount } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("following_id", creatorId);

  // Get total views
  const { data: contentsData } = await supabase
    .from("contents")
    .select("views_count, likes_count")
    .eq("creator_id", creatorId);

  const totalViews = contentsData?.reduce((sum: number, c: any) => sum + (c.views_count || 0), 0) || 0;
  const totalLikes = contentsData?.reduce((sum: number, c: any) => sum + (c.likes_count || 0), 0) || 0;

  // Get total earnings from wallet
  const { data: walletData } = await supabase
    .from("wallets")
    .select("total_earned")
    .eq("user_id", creatorId)
    .single();

  // Calculate engagement rate
  const engagementRate = totalViews > 0 ? Math.round((totalLikes / totalViews) * 100) : 0;

  return {
    totalContents: contentsCount || 0,
    totalFollowers: followersCount || 0,
    totalEarnings: walletData?.total_earned || 0,
    totalViews,
    engagementRate
  };
}

function getCurrentValue(stats: CreatorStats, milestoneType: string): number {
  switch (milestoneType) {
    case "contents":
      return stats.totalContents;
    case "followers":
      return stats.totalFollowers;
    case "earnings":
      return stats.totalEarnings;
    case "views":
      return stats.totalViews;
    case "engagement":
      return stats.engagementRate;
    default:
      return 0;
  }
}

async function createNotification(supabase: any, creatorId: string, milestone: CreatorMilestone) {
  try {
    await supabase
      .from("notifications")
      .insert({
        user_id: creatorId,
        type: "milestone_completed",
        title: "🎯 Meta Alcançada!",
        message: `Parabéns! Você completou a meta "${milestone.title}". Resgate sua recompensa de ${milestone.points_reward} pontos e R$ ${milestone.value_reward.toFixed(2)}!`,
        is_read: false
      });
  } catch (error) {
    console.error("Error creating notification:", error);
  }
}

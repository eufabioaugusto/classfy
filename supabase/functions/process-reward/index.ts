import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  calculatePointsWithSettings,
  mergeEconomySettings,
  normalizePlan,
} from "../_shared/economy.ts";
import { excludesEconomicRewards } from "../_shared/reward-contract.ts";
import { getVerifiedUserId } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RewardPayload {
  actionKey: string;
  userId: string;
  contentId?: string;
  metadata?: Record<string, unknown>;
}

interface RewardTarget {
  id: string;
  kind: "content" | "course";
  creatorId: string;
  title: string;
  status: string;
  visibility: string;
  contentType?: string;
}

const CLIENT_REWARD_ACTIONS = new Set([
  "DAILY_LOGIN",
  "WEEKLY_STREAK",
  "FIRST_CONTENT_WEEK",
  "LIKE",
  "SAVE",
  "FAVORITE",
  "COMMENT",
  "SHARE",
  "SUBSCRIBE_CREATOR",
  "VIEW_15S",
  "WATCH_50",
  "WATCH_100",
  "COMPLETE_COURSE",
  "PROFILE_COMPLETE",
]);

const CREATOR_ACTIVATION_ACTIONS = new Set([
  "CREATOR_APPROVED",
  "FIRST_UPLOAD",
  "CONTENT_APPROVED",
]);

const CONTENT_INTERACTION_ACTIONS = new Set([
  "FIRST_CONTENT_WEEK",
  "LIKE",
  "SAVE",
  "FAVORITE",
  "COMMENT",
  "SHARE",
  "VIEW_15S",
  "WATCH_50",
  "WATCH_100",
  "COMPLETE_COURSE",
]);

async function resolveRewardTarget(
  supabase: any,
  targetId: string,
): Promise<RewardTarget | null> {
  const { data: content, error: contentError } = await supabase.from("contents")
    .select("id,creator_id,title,status,visibility,content_type")
    .eq("id", targetId).maybeSingle();
  if (contentError) throw contentError;
  if (content) {
    return {
      id: content.id,
      kind: "content",
      creatorId: content.creator_id,
      title: content.title,
      status: content.status,
      visibility: content.visibility,
      contentType: content.content_type,
    };
  }

  const { data: course, error: courseError } = await supabase.from("courses")
    .select("id,creator_id,title,status,visibility")
    .eq("id", targetId).maybeSingle();
  if (courseError) throw courseError;
  return course
    ? {
      id: course.id,
      kind: "course",
      creatorId: course.creator_id,
      title: course.title,
      status: course.status,
      visibility: course.visibility,
    }
    : null;
}

async function hasTargetAccess(
  supabase: any,
  userId: string,
  target: RewardTarget,
) {
  if (target.status !== "approved") return false;
  if (target.creatorId === userId) return true;

  const [{ data: adminRole }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId)
      .eq("role", "admin").maybeSingle(),
    supabase.from("profiles").select("plan").eq("id", userId).single(),
  ]);
  if (adminRole) return true;
  if (target.visibility === "free") return true;

  const rank: Record<string, number> = { free: 0, pro: 1, premium: 2 };
  if (target.visibility === "pro" || target.visibility === "premium") {
    return (rank[profile?.plan ?? "free"] ?? 0) >= rank[target.visibility];
  }
  if (target.visibility !== "paid") return false;

  if (target.kind === "course") {
    const { data } = await supabase.from("course_enrollments").select("id")
      .eq("user_id", userId).eq("course_id", target.id).maybeSingle();
    return !!data;
  }
  const { data } = await supabase.from("purchased_contents").select("id")
    .eq("user_id", userId).eq("content_id", target.id)
    .in("status", ["confirmed", "legacy_confirmed"]).maybeSingle();
  return !!data;
}

async function hasRewardEvidence(
  supabase: any,
  actionKey: string,
  userId: string,
  contentId: string | undefined,
  metadata: Record<string, unknown>,
) {
  const exists = async (table: string, filters: Array<[string, unknown]>) => {
    let query = supabase.from(table).select("id", {
      count: "exact",
      head: true,
    });
    for (const [column, value] of filters) {
      query = query.eq(column, value as any);
    }
    const { count, error } = await query;
    if (error) throw error;
    return (count || 0) > 0;
  };

  let targetColumn: "content_id" | "course_id" = "content_id";
  if (
    contentId &&
    ["LIKE", "SAVE", "FAVORITE", "COMMENT", "SHARE"].includes(actionKey)
  ) {
    const { data: contentTarget, error: targetError } = await supabase
      .from("contents")
      .select("id")
      .eq("id", contentId)
      .maybeSingle();
    if (targetError) throw targetError;
    targetColumn = contentTarget ? "content_id" : "course_id";
  }

  switch (actionKey) {
    case "LIKE":
      return !!contentId &&
        exists("actions", [["user_id", userId], [targetColumn, contentId], [
          "type",
          "LIKE",
        ]]);
    case "SAVE":
      return !!contentId &&
        exists("saved_contents", [["user_id", userId], [
          targetColumn,
          contentId,
        ]]);
    case "FAVORITE":
      return !!contentId &&
        exists("favorites", [["user_id", userId], [targetColumn, contentId]]);
    case "COMMENT":
      return !!contentId &&
        targetColumn === "content_id" &&
        exists("comments", [["user_id", userId], ["content_id", contentId]]);
    case "SHARE":
      return !!contentId &&
        exists("content_shares", [["user_id", userId], [
          targetColumn,
          contentId,
        ]]);
    case "SUBSCRIBE_CREATOR":
      return !!metadata.creatorId &&
        exists("follows", [["follower_id", userId], [
          "following_id",
          metadata.creatorId,
        ]]);
    case "VIEW_15S": {
      if (!contentId) return false;
      const { data, error } = await supabase.from("content_views")
        .select("id").eq("user_id", userId).eq("content_id", contentId)
        .gte("total_watch_time_seconds", 15).limit(1);
      if (error) throw error;
      return !!data?.length;
    }
    case "WATCH_50":
    case "WATCH_100": {
      if (!contentId) return false;
      const threshold = actionKey === "WATCH_50" ? 50 : 100;
      const { data, error } = await supabase.from("user_progress")
        .select("id").eq("user_id", userId).eq("content_id", contentId)
        .gte("progress_percent", threshold).limit(1);
      if (error) throw error;
      return !!data?.length;
    }
    case "COMPLETE_COURSE":
      return !!contentId &&
        exists("course_enrollments", [["user_id", userId], [
          "course_id",
          contentId,
        ], ["progress_percent", 100]]);
    case "PROFILE_COMPLETE": {
      const { data, error } = await supabase.from("profiles")
        .select("display_name,avatar_url,bio").eq("id", userId).single();
      if (error) throw error;
      const profile = data as {
        display_name?: string;
        avatar_url?: string;
        bio?: string;
      } | null;
      return !!profile?.display_name && !!profile?.avatar_url && !!profile?.bio;
    }
    case "DAILY_LOGIN":
      return exists("user_login_streaks", [["user_id", userId], [
        "last_login_date",
        brazilDay(),
      ]]);
    case "WEEKLY_STREAK": {
      const { data, error } = await supabase.from("user_login_streaks")
        .select("current_streak").eq("user_id", userId).single();
      if (error) throw error;
      const streak = data as { current_streak?: number } | null;
      return Number(streak?.current_streak || 0) >= 7;
    }
    case "FIRST_CONTENT_WEEK": {
      if (!contentId) return false;
      const { data, error } = await supabase.from("user_progress")
        .select("id").eq("user_id", userId).eq("content_id", contentId)
        .gte("watched_seconds", 1).limit(1);
      if (error) throw error;
      return !!data?.length;
    }
    default:
      return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const { actionKey, userId, contentId, metadata = {} } = await req
      .json() as RewardPayload;
    if (!actionKey || !userId) {
      return json({ error: "actionKey and userId are required" }, 400);
    }
    let streakState: Record<string, unknown> | null = null;
    const rewardTarget = contentId
      ? await resolveRewardTarget(supabase, contentId)
      : null;

    if (contentId && !rewardTarget) {
      return json({ error: "Reward target not found" }, 404);
    }

    // Shorts sao superficie publica de descoberta. Engajamento continua sendo
    // persistido, mas nenhuma acao ligada a um Short entra no ledger economico.
    if (excludesEconomicRewards(rewardTarget?.contentType)) {
      return json({
        success: true,
        rewardExcluded: true,
        reason: "shorts_do_not_generate_rewards",
        rewards: [],
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const isServiceRequest = authHeader === `Bearer ${serviceKey}`;
    if (!isServiceRequest) {
      if (!CLIENT_REWARD_ACTIONS.has(actionKey)) {
        return json({ error: "Server-only reward action" }, 403);
      }
      const authClient = createClient(supabaseUrl, anonKey);
      const authenticatedUserId = await getVerifiedUserId(
        authClient,
        authHeader,
      );
      if (!authenticatedUserId) return json({ error: "Unauthorized" }, 401);
      if (authenticatedUserId !== userId) {
        return json({ error: "User identity mismatch" }, 403);
      }
      if (
        rewardTarget && !await hasTargetAccess(supabase, userId, rewardTarget)
      ) {
        return json({ error: "Reward target access required" }, 403);
      }
      if (actionKey === "DAILY_LOGIN" || actionKey === "WEEKLY_STREAK") {
        const { data, error: streakError } = await supabase.rpc(
          "record_login_streak_v1",
          {
            p_user_id: userId,
          },
        );
        if (streakError) throw streakError;
        streakState = data as Record<string, unknown>;
      }
      if (
        !await hasRewardEvidence(
          supabase,
          actionKey,
          userId,
          contentId,
          metadata,
        )
      ) {
        return json(
          { error: "Reward action is not backed by server evidence" },
          409,
        );
      }
    }

    const { data: config, error: configError } = await supabase.from(
      "reward_actions_config",
    )
      .select("*").eq("action_key", actionKey).eq("active", true).single();
    if (configError || !config) {
      return json({ error: "Action config not found or inactive" }, 400);
    }

    let resolvedContentId: string | null = null;
    let resolvedCourseId: string | null = null;
    let creatorId: string | null = null;
    let title: string | null = null;
    if (rewardTarget) {
      resolvedContentId = rewardTarget.kind === "content"
        ? rewardTarget.id
        : null;
      resolvedCourseId = rewardTarget.kind === "course"
        ? rewardTarget.id
        : null;
      creatorId = rewardTarget.creatorId;
      title = rewardTarget.title;
    }
    if (
      actionKey === "SUBSCRIBE_CREATOR" &&
      typeof metadata.creatorId === "string"
    ) {
      creatorId = metadata.creatorId;
    }

    const isOwnInteraction = !!creatorId && creatorId === userId &&
      (CONTENT_INTERACTION_ACTIONS.has(actionKey) ||
        actionKey === "SUBSCRIBE_CREATOR");
    if (isOwnInteraction) {
      return json({ success: true, selfInteractionBlocked: true, rewards: [] });
    }

    const trackingKey = createTrackingKey(
      config.dedupe_scope,
      actionKey,
      contentId,
      creatorId,
    );
    if (!trackingKey) {
      return json({ error: "Missing entity required by dedupe scope" }, 400);
    }

    if (config.daily_limit) {
      const { count } = await supabase.from("reward_action_tracking")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).like("action_key", `${actionKey}%`)
        .gte("created_at", brazilDayStartIso());
      if ((count || 0) >= config.daily_limit) {
        return json({
          success: false,
          dailyLimitReached: true,
          limit: config.daily_limit,
        });
      }
    }

    if (
      CREATOR_ACTIVATION_ACTIONS.has(actionKey) &&
      actionKey !== "CONTENT_APPROVED" && config.monthly_creator_limit
    ) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const { count } = await supabase.from("reward_events")
        .select("id", { count: "exact", head: true }).eq("user_id", userId)
        .eq("action_key", actionKey).eq("point_type", "creator")
        .gte("created_at", monthStart.toISOString());
      if ((count || 0) >= config.monthly_creator_limit) {
        return json({
          success: false,
          monthlyLimitReached: true,
          limit: config.monthly_creator_limit,
        });
      }
    }

    const [{ data: profile }, { data: settingsRow }, { data: cycleId }] =
      await Promise.all([
        supabase.from("profiles").select("plan").eq("id", userId).single(),
        supabase.from("platform_settings").select("value").eq(
          "key",
          "economic_v1",
        ).single(),
        supabase.rpc("get_or_create_current_cycle"),
      ]);
    if (!cycleId) throw new Error("Current economic cycle is unavailable");
    const settings = mergeEconomySettings(settingsRow?.value);
    const actorPlan = normalizePlan(profile?.plan);
    const trackingMetadata = {
      ...metadata,
      tracking_key: trackingKey,
      economy_version: 1,
      canonical_name: config.canonical_name,
      course_id: resolvedCourseId,
      title,
    };

    let actorEvent: Record<string, unknown>;
    let creatorEvent: Record<string, unknown> | null = null;
    if (CREATOR_ACTIVATION_ACTIONS.has(actionKey)) {
      const creatorPoints = calculatePointsWithSettings({
        basePoints: Number(config.points_creator || 0),
        pointType: "creator",
        actorPlan,
        settings,
      });
      actorEvent = {
        user_id: userId,
        content_id: resolvedContentId,
        action_key: actionKey,
        points: creatorPoints,
        cycle_points: creatorPoints,
        point_type: "creator",
        metadata: { ...trackingMetadata, activation: true },
      };
    } else {
      const userPoints = calculatePointsWithSettings({
        basePoints: Number(config.points_user || 0),
        pointType: "user",
        actorPlan,
        settings,
      });
      actorEvent = {
        user_id: userId,
        related_user_id: creatorId,
        content_id: resolvedContentId,
        action_key: actionKey,
        points: userPoints,
        cycle_points: userPoints,
        point_type: "user",
        metadata: { ...trackingMetadata, plan: actorPlan },
      };
      if (
        creatorId && creatorId !== userId &&
        Number(config.points_creator || 0) > 0
      ) {
        const creatorPoints = calculatePointsWithSettings({
          basePoints: Number(config.points_creator),
          pointType: "creator",
          actorPlan: "free",
          settings,
        });
        creatorEvent = {
          user_id: creatorId,
          related_user_id: userId,
          content_id: resolvedContentId,
          action_key: actionKey,
          points: creatorPoints,
          cycle_points: creatorPoints,
          point_type: "creator",
          metadata: { ...trackingMetadata, as_creator: true },
        };
      }
    }

    const { data: committed, error: commitError } = await supabase.rpc(
      "commit_reward_award",
      {
        p_tracking_user_id: userId,
        p_tracking_action_key: trackingKey,
        p_tracking_content_id: resolvedContentId,
        p_tracking_metadata: trackingMetadata,
        p_cycle_id: cycleId,
        p_actor_event: actorEvent,
        p_creator_event: creatorEvent,
      },
    );
    if (commitError) throw commitError;
    return json({
      success: !committed?.already_tracked && !committed?.daily_limit_reached,
      alreadyTracked: !!committed?.already_tracked,
      dailyLimitReached: !!committed?.daily_limit_reached,
      limit: committed?.limit,
      currentStreak: streakState?.current_streak,
      rewards: committed?.rewards || [],
    });
  } catch (error) {
    console.error("process-reward V1 error", error);
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

function createTrackingKey(
  scope: string,
  actionKey: string,
  contentId?: string,
  creatorId?: string | null,
) {
  switch (scope) {
    case "daily":
      return `${actionKey}_${brazilDay()}`;
    case "weekly":
      return `${actionKey}_${brazilWeekStart()}`;
    case "lifetime":
      return actionKey;
    case "user_creator":
      return creatorId ? `${actionKey}_${creatorId}` : null;
    case "creator_content":
    case "user_content":
      return contentId ? `${actionKey}_${contentId}` : null;
    default:
      return null;
  }
}

function brazilDay(date = new Date()) {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(
    0,
    10,
  );
}

function brazilDayStartIso() {
  return `${brazilDay()}T03:00:00.000Z`;
}

function brazilWeekStart() {
  const local = new Date(`${brazilDay()}T12:00:00.000Z`);
  const weekday = local.getUTCDay();
  local.setUTCDate(local.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return local.toISOString().slice(0, 10);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

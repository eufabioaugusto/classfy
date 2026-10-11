import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  createMobileSubscriptionService,
  readMobileStoreConfig,
} from "./mobile-subscription.ts";
import { createMobileStoreVerifier } from "./mobile-subscription-store-verifiers.ts";
import { createMobileSubscriptionRepository } from "./mobile-subscription-repository.ts";

export function createMobileSubscriptionRuntime() {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const config = readMobileStoreConfig((name) => Deno.env.get(name));
  const service = createMobileSubscriptionService(
    createMobileStoreVerifier(config),
    createMobileSubscriptionRepository(supabase),
  );
  return {
    service,
    async authenticate(token: string) {
      const { data, error } = await supabase.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
  };
}

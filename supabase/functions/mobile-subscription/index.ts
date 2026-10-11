import { createMobileSubscriptionRuntime } from "../_shared/mobile-subscription-runtime.ts";
import { createMobileSubscriptionHandler } from "../_shared/mobile-subscription-http.ts";
const runtime = createMobileSubscriptionRuntime();
Deno.serve(createMobileSubscriptionHandler({
  authenticate: runtime.authenticate,
  read: runtime.service.read,
}));

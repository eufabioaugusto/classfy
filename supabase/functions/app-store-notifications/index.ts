import { createMobileSubscriptionRuntime } from "../_shared/mobile-subscription-runtime.ts";
import { createMobileNotificationHandler } from "../_shared/mobile-subscription-http.ts";
const { service } = createMobileSubscriptionRuntime();
Deno.serve(
  createMobileNotificationHandler((_authorization, body) =>
    service.appleNotification(body)
  ),
);

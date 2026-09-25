import { Toaster as LegacyToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { useMessageNotifications } from "@/hooks/useMessageNotifications";

/** Keeps both existing notification APIs operational behind one app surface. */
export function AppNotifications() {
  useNotificationToasts();
  useMessageNotifications();
  return (
    <>
      <LegacyToaster />
      <SonnerToaster />
    </>
  );
}

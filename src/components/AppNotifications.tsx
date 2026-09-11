import { Toaster as LegacyToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

/** Keeps both existing notification APIs operational behind one app surface. */
export function AppNotifications() {
  return (
    <>
      <LegacyToaster />
      <SonnerToaster />
    </>
  );
}

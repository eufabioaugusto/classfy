import type { ReactNode } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { Header, type HeaderProps } from "@/components/Header";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ClassfyV2Scope } from "@/components/v2";
import { cn } from "@/lib/utils";

export interface AppShellProps extends HeaderProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  defaultSidebarOpen?: boolean;
  header?: ReactNode | false;
}

/**
 * Shared infrastructure for experiences that use the standard navigation.
 * Visual composition belongs to the page's family template, not to this shell.
 *
 * Immersive routes (Watch, Shorts, Study, Auth and Lives) intentionally own
 * their layout and should not be forced into this shell.
 */
export function AppShell({
  children,
  className,
  contentClassName,
  defaultSidebarOpen = true,
  header,
  ...headerProps
}: AppShellProps) {
  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <ClassfyV2Scope className={cn("cf2-app-shell", className)}>
        <AppSidebar />
        <div className="cf2-app-shell__body">
          {header === false ? null : (header ?? <Header {...headerProps} />)}
          <main className={cn("cf2-app-shell__content", contentClassName)}>{children}</main>
        </div>
      </ClassfyV2Scope>
    </SidebarProvider>
  );
}

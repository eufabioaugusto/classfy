import { ReactNode } from "react";
import { AppShell } from "@/components/layout";

interface AdminLayoutProps {
  children: ReactNode;
  title?: string;
}

export function AdminLayout({ children, title }: AdminLayoutProps) {
  // Compatibility adapter: admin pages now share the official application shell.
  return <AppShell title={title}>{children}</AppShell>;
}

import { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { GlobalSearch } from "@/components/GlobalSearch";

export default function Search() {
  const [isExploreMode, setIsExploreMode] = useState(true);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <main className="flex-1 flex flex-col pb-20 md:pb-0">
          <Header variant="home" />
          
          <div className="flex-1 px-4 py-6">
            <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-foreground mb-6">Buscar</h1>
              <GlobalSearch 
                isExploreMode={isExploreMode} 
                onModeChange={setIsExploreMode}
              />
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

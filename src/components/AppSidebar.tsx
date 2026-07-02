import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useStudies } from "@/hooks/useStudies";
import { useAdminPendingCounts } from "@/hooks/useAdminPendingCounts";
import { toShortTitle } from "@/lib/study/getStudyJourneySummary";
import { supabase } from "@/integrations/supabase/client";
import { BecomeCreatorModal } from "@/components/BecomeCreatorModal";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { CreatorStatsCard } from "@/components/CreatorStatsCard";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo, useState } from "react";
import {
  Home,
  Clock,
  Star,
  Bookmark,
  User,
  LogOut,
  Sparkles,
  Code,
  Megaphone,
  Languages,
  DollarSign,
  Palette,
  Cpu,
  Video,
  BarChart,
  Upload,
  Settings,
  Users,
  CheckSquare,
  BookOpen,
  Plus,
  Trophy,
  ChevronRight,
  FileText,
  TrendingUp,
  AlertTriangle,
  Zap,
  Crown,
  Circle,
  Layers,
  MoreHorizontal,
  Pencil,
  Archive,
  Trash2,
  ExternalLink,
  Link2,
  Copy,
  Pin,
  PinOff,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const mainItems = [
  { title: "Início", url: "/", icon: Home },
  { title: "Shorts", url: "/shorts", icon: Zap },
  { title: "Histórico", url: "/historico", icon: Clock },
  { title: "Favoritos", url: "/favoritos", icon: Star },
  { title: "Salvos", url: "/salvos", icon: Bookmark },
  { title: "Recompensas", url: "/recompensas", icon: Trophy },
  { title: "Carteira", url: "/carteira", icon: DollarSign },
  { title: "Classfy Premium", url: "/planos", icon: Crown, highlight: true },
];

const studioItems = [
  { title: "Dashboard", url: "/studio", icon: BarChart },
  { title: "Analytics", url: "/studio/analytics", icon: TrendingUp },
  { title: "Meus Conteúdos", url: "/studio/contents", icon: Video },
  { title: "Meus Boosts", url: "/studio/boosts", icon: Megaphone },
  // { title: "Publicar Novo", url: "/studio/upload", icon: Upload },
];

const adminItems = [
  { title: "Dashboard", url: "/admin", icon: BarChart, countKey: null },
  { title: "Aprovar Creators", url: "/admin/creators", icon: CheckSquare, countKey: "creators" as const },
  { title: "Aprovar Conteúdos", url: "/admin/contents", icon: Video, countKey: "contents" as const },
  { title: "Transcrições", url: "/admin/transcriptions", icon: FileText, countKey: null },
  { title: "Creators em Destaque", url: "/admin/featured-creators", icon: Users, countKey: null },
  { title: "Recompensas", url: "/admin/rewards", icon: Trophy, countKey: null },
  { title: "Saques", url: "/admin/withdrawals", icon: DollarSign, countKey: "withdrawals" as const },
  { title: "Gerenciar Usuários", url: "/admin/users", icon: Users, countKey: null },
  { title: "Prospecção", url: "/admin/prospects", icon: TrendingUp, countKey: null },
  { title: "Curadoria", url: "/admin/curadoria", icon: Layers, countKey: null },
  { title: "Materiais Afiliados", url: "/admin/marketing", icon: Megaphone, countKey: null },
  { title: "Configurações", url: "/admin/settings", icon: Settings, countKey: null },
];

const PINNED_STUDIES_STORAGE_KEY = "classfy:pinned-studies";

export function AppSidebar() {
  const { state, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, role, profile } = useAuth();
  const {
    activeStudies,
    activeCount,
    limits,
    canCreateMore,
    archiveStudy,
    refetch: refetchStudies,
  } = useStudies();
  const { counts: adminCounts } = useAdminPendingCounts();
  const [studiesOpen, setStudiesOpen] = useState(true);
  const [creatorModalOpen, setCreatorModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [studyTitleDraft, setStudyTitleDraft] = useState("");
  const [selectedStudy, setSelectedStudy] = useState<(typeof activeStudies)[number] | null>(null);
  const [pinnedStudyIds, setPinnedStudyIds] = useState<string[]>([]);
  // No mobile, quando o sidebar abre como Sheet, sempre mostrar expandido
  const collapsed = isMobile ? false : state === "collapsed";
  const limitText = limits.studies === Infinity ? "Ilimitado" : `${activeCount}/${limits.studies}`;
  const collapsedGroupClass = collapsed ? "px-0" : undefined;
  const collapsedMenuClass = collapsed ? "items-center overflow-visible" : undefined;
  const collapsedIconButtonClass = "relative !h-10 !w-10 !p-0 justify-center overflow-visible";
  const collapsedIconLinkClass = `${collapsedIconButtonClass} text-foreground/80 hover:bg-muted hover:text-foreground`;

  // Visibilidade dos itens do menu
  const showBecomeCreator =
    user &&
    role !== "creator" &&
    role !== "admin" &&
    (profile?.creator_status === "none" || profile?.creator_status === "rejected");
  const showPendingCreator =
    user &&
    role !== "creator" &&
    role !== "admin" &&
    profile?.creator_status === "pending";
  const showStudio = user && (role === "creator" || role === "admin");
  const showAdmin = user && role === "admin";

  const isActive = (path: string) => location.pathname === path;
  const studyUrl = (studyId: string) => `${window.location.origin}/c/${studyId}`;

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const rawPinnedStudies = window.localStorage.getItem(PINNED_STUDIES_STORAGE_KEY);
      const parsedPinnedStudies = rawPinnedStudies ? JSON.parse(rawPinnedStudies) : [];
      setPinnedStudyIds(Array.isArray(parsedPinnedStudies) ? parsedPinnedStudies : []);
    } catch {
      setPinnedStudyIds([]);
    }
  }, []);

  const orderedStudies = useMemo(() => {
    const pinnedSet = new Set(pinnedStudyIds);
    const pinned = activeStudies.filter((study) => pinnedSet.has(study.id));
    const regular = activeStudies.filter((study) => !pinnedSet.has(study.id));

    pinned.sort((a, b) => pinnedStudyIds.indexOf(a.id) - pinnedStudyIds.indexOf(b.id));
    return [...pinned, ...regular];
  }, [activeStudies, pinnedStudyIds]);

  const persistPinnedStudyIds = (nextPinnedStudyIds: string[]) => {
    setPinnedStudyIds(nextPinnedStudyIds);
    window.localStorage.setItem(PINNED_STUDIES_STORAGE_KEY, JSON.stringify(nextPinnedStudyIds));
  };

  const handleTogglePinStudy = (studyId: string) => {
    const isPinned = pinnedStudyIds.includes(studyId);
    const nextPinnedStudyIds = isPinned
      ? pinnedStudyIds.filter((id) => id !== studyId)
      : [studyId, ...pinnedStudyIds];

    persistPinnedStudyIds(nextPinnedStudyIds);
    toast.success(isPinned ? "Estudo desafixado." : "Estudo fixado no topo.");
  };

  const handleOpenStudyInNewTab = (studyId: string) => {
    window.open(`/c/${studyId}`, "_blank", "noopener,noreferrer");
  };

  const handleCopyStudyLink = async (studyId: string) => {
    await navigator.clipboard.writeText(studyUrl(studyId));
    toast.success("Link do estudo copiado.");
  };

  const handleCopyStudyTitle = async (title: string) => {
    await navigator.clipboard.writeText(title);
    toast.success("Título do estudo copiado.");
  };

  const handleShareStudy = async (study: (typeof activeStudies)[number]) => {
    const payload = {
      title: study.title,
      text: `Confira este estudo: ${study.title}`,
      url: studyUrl(study.id),
    };

    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch {
        // fallback below
      }
    }

    await navigator.clipboard.writeText(payload.url);
    toast.success("Link do estudo copiado para compartilhar.");
  };

  const handleArchiveStudy = async (studyId: string) => {
    await archiveStudy(studyId);
    persistPinnedStudyIds(pinnedStudyIds.filter((id) => id !== studyId));
    toast.success("Estudo arquivado.");
  };

  const openRenameDialog = (study: (typeof activeStudies)[number]) => {
    setSelectedStudy(study);
    setStudyTitleDraft(study.title);
    setRenameDialogOpen(true);
  };

  const openDeleteDialog = (study: (typeof activeStudies)[number]) => {
    setSelectedStudy(study);
    setDeleteDialogOpen(true);
  };

  const handleRenameStudy = async () => {
    if (!selectedStudy || !studyTitleDraft.trim()) return;

    const { error } = await supabase
      .from("studies")
      .update({ title: studyTitleDraft.trim() })
      .eq("id", selectedStudy.id);

    if (error) {
      toast.error("Erro ao renomear estudo.");
      return;
    }

    setRenameDialogOpen(false);
    setSelectedStudy(null);
    toast.success("Estudo renomeado.");
    await refetchStudies();
  };

  const handleDeleteStudy = async () => {
    if (!selectedStudy) return;

    const { error: messagesError } = await supabase
      .from("study_messages")
      .delete()
      .eq("study_id", selectedStudy.id);

    if (messagesError) {
      toast.error("Erro ao excluir mensagens do estudo.");
      return;
    }

    const { error: studyError } = await supabase
      .from("studies")
      .delete()
      .eq("id", selectedStudy.id);

    if (studyError) {
      toast.error("Erro ao excluir estudo.");
      return;
    }

    persistPinnedStudyIds(pinnedStudyIds.filter((id) => id !== selectedStudy.id));
    setDeleteDialogOpen(false);
    setSelectedStudy(null);
    toast.success("Estudo excluído.");

    if (location.pathname === `/c/${selectedStudy.id}`) {
      navigate("/");
    }

    await refetchStudies();
  };

  return (
    <TooltipProvider delayDuration={0}>
      <Sidebar
        className={`border-r border-border/20 bg-background transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}
        collapsible="icon"
      >
        <SidebarContent>
          {/* Logo/Brand */}
          <div className={`space-y-4 ${collapsed ? "flex flex-col items-center px-0 py-6" : "p-6"}`}>
            <div className={`flex items-center gap-2 cursor-pointer ${collapsed ? "w-full justify-center" : ""}`}>
              {/* Mobile: Show toggle button before logo */}
              {isMobile && <SidebarTrigger className="shrink-0" />}
              <div
                onClick={() => navigate("/")}
                className={`flex items-center ${collapsed ? "h-10 w-10 justify-center" : ""}`}
              >
                {!collapsed && <span className="text-xl font-bold text-foreground">Classfy</span>}
                {collapsed && <span className="text-xl font-bold text-foreground">C</span>}
              </div>
            </div>

            {/* User Profile in Header */}
            {user && !collapsed && (
              <>
                <div
                  className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 hover:bg-muted/60 cursor-pointer transition-colors"
                  onClick={() => navigate("/conta")}
                >
                  <ProfileAvatar size="sm" />
                  <div className="flex flex-col gap-0.5 leading-none flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">{profile?.display_name}</span>
                    <span className="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
                      {profile?.plan === 'free' && <Circle className="h-3 w-3 text-emerald-500 fill-emerald-500" />}
                      {profile?.plan === 'pro' && <Crown className="h-3 w-3 text-amber-500" />}
                      {profile?.plan === 'premium' && <Crown className="h-3 w-3 text-red-500" />}
                      {profile?.plan}
                    </span>
                  </div>
                </div>


                {/* Creator Stats Card */}
                {(role === "creator" || role === "admin") && (
                  <CreatorStatsCard userId={user.id} collapsed={collapsed} />
                )}
              </>
            )}

            {/* Mini avatar when collapsed */}
            {user && collapsed && (
              <div className="flex flex-col items-center gap-2 mt-4">
                <div
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => navigate("/conta")}
                  title={profile?.display_name}
                >
                  <ProfileAvatar size="sm" />
                </div>

                {/* Creator Stats Mini */}
                {(role === "creator" || role === "admin") && <CreatorStatsCard userId={user.id} collapsed={true} />}
              </div>
            )}
          </div>

          <Separator className="bg-border/10" />

          {/* Main Navigation */}
          <SidebarGroup className={collapsedGroupClass}>
            {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Menu</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className={collapsedMenuClass}>
                {mainItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SidebarMenuButton asChild>
                            <NavLink
                              to={item.url}
                              end
                              className={collapsedIconLinkClass}
                              activeClassName="bg-muted text-cinematic-accent font-medium"
                            >
                              <item.icon className={`w-4 h-4 ${'highlight' in item && item.highlight ? 'text-red-500' : ''}`} />
                            </NavLink>
                          </SidebarMenuButton>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>{item.title}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          end
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                          activeClassName="bg-muted text-cinematic-accent font-medium"
                        >
                          <item.icon className={`w-4 h-4 ${'highlight' in item && item.highlight ? 'text-red-500' : ''}`} />
                          <span className={'highlight' in item && item.highlight ? 'font-medium' : ''}>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <Separator className="bg-border my-2" />

          {/* Studies Section */}
          {user && !collapsed && (
            <Collapsible open={studiesOpen} onOpenChange={setStudiesOpen}>
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="flex w-full items-center justify-between hover:bg-muted rounded-md px-2 py-1">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      <span>Estudos</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{limitText}</span>
                      <ChevronRight className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
                    </div>
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {orderedStudies.map((study) => (
                        <SidebarMenuItem key={study.id}>
                          <div className="group/study-item relative z-0">
                            <SidebarMenuButton asChild>
                              <NavLink
                                to={`/c/${study.id}`}
                                className="pr-12 text-foreground/80 hover:bg-muted/80 hover:text-foreground"
                                activeClassName="bg-muted text-cinematic-accent font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                              >
                                <BookOpen className="h-4 w-4 shrink-0" />
                                <span className="truncate max-w-[136px]">{toShortTitle(study.title)}</span>
                                {pinnedStudyIds.includes(study.id) && (
                                  <Pin className="ml-auto h-3.5 w-3.5 shrink-0 text-primary/80" />
                                )}
                              </NavLink>
                            </SidebarMenuButton>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="pointer-events-none absolute right-1.5 top-1/2 z-20 h-7 w-7 -translate-y-1/2 rounded-lg border border-transparent bg-background opacity-0 shadow-sm transition-all hover:border-border/60 hover:bg-background group-hover/study-item:pointer-events-auto group-hover/study-item:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:border-border/60 data-[state=open]:bg-background data-[state=open]:opacity-100"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                sideOffset={10}
                                className="z-[120] w-72 rounded-2xl border border-border/80 bg-popover p-2 text-popover-foreground shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
                              >
                                <DropdownMenuLabel className="px-3 py-2">
                                  <div className="space-y-1">
                                    <p className="truncate text-sm font-semibold text-foreground">{toShortTitle(study.title)}</p>
                                    <p className="text-xs font-normal text-muted-foreground">
                                      {pinnedStudyIds.includes(study.id) ? "Estudo fixado no topo" : "Ações rápidas do estudo"}
                                    </p>
                                  </div>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => navigate(`/c/${study.id}`)}>
                                  <BookOpen className="mr-2 h-4 w-4" />
                                  Abrir estudo
                                  <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOpenStudyInNewTab(study.id)}>
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Abrir em nova aba
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleShareStudy(study)}>
                                  <Link2 className="mr-2 h-4 w-4" />
                                  Compartilhar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleCopyStudyLink(study.id)}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copiar link
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleCopyStudyTitle(study.title)}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copiar título
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleTogglePinStudy(study.id)}>
                                  {pinnedStudyIds.includes(study.id) ? (
                                    <PinOff className="mr-2 h-4 w-4" />
                                  ) : (
                                    <Pin className="mr-2 h-4 w-4" />
                                  )}
                                  {pinnedStudyIds.includes(study.id) ? "Desafixar do topo" : "Fixar no topo"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openRenameDialog(study)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Renomear
                                  <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleArchiveStudy(study.id)}>
                                  <Archive className="mr-2 h-4 w-4" />
                                  Arquivar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => openDeleteDialog(study)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Excluir
                                  <DropdownMenuShortcut>Del</DropdownMenuShortcut>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </SidebarMenuItem>
                      ))}
                      {orderedStudies.length === 0 && (
                        <div className="px-4 py-2 text-sm text-muted-foreground">Nenhum estudo ativo</div>
                      )}
                      {canCreateMore && (
                        <SidebarMenuItem>
                          <SidebarMenuButton onClick={() => navigate("/?mode=focus")}>
                            <Plus className="h-4 w-4" />
                            <span>Novo Estudo</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                      {!canCreateMore && (
                        <div className="px-3 py-3 mx-2 mb-2 rounded-lg border border-red-500/30 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent backdrop-blur-sm">
                          <div className="flex items-start gap-2">
                            <div className="p-1.5 rounded-full bg-red-500/20 shrink-0 mt-0.5">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-xs font-medium text-foreground leading-tight flex items-center gap-1">
                                <Zap className="h-3 w-3 text-red-500" />
                                Limite atingido!
                              </p>
                              <p className="text-xs text-muted-foreground leading-tight">
                                Arquive estudos ou{" "}
                                <button
                                  onClick={() => setUpgradeModalOpen(true)}
                                  className="font-semibold text-red-600 dark:text-red-400 hover:underline underline-offset-2 transition-all hover:text-red-700 dark:hover:text-red-300"
                                >
                                  faça upgrade
                                </button>{" "}
                                para continuar
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          )}

          {/* Studies icon when collapsed */}
          {user && collapsed && (
            <SidebarGroup className={collapsedGroupClass}>
              <SidebarGroupContent>
                <SidebarMenu className={collapsedMenuClass}>
                  <SidebarMenuItem>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton className={collapsedIconButtonClass}>
                          <BookOpen className="h-4 w-4" />
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p>Estudos</p>
                      </TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {/* Become Creator (Users only) */}
          {showBecomeCreator && (
            <>
              <SidebarGroup className={collapsedGroupClass}>
                <SidebarGroupContent>
                  <SidebarMenu className={collapsedMenuClass}>
                    <SidebarMenuItem>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              onClick={() => setCreatorModalOpen(true)}
                              className={collapsedIconLinkClass}
                            >
                              <Sparkles className="w-4 h-4" />
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p>Torne-se Creator</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuButton
                          onClick={() => setCreatorModalOpen(true)}
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>Torne-se Creator</span>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <Separator className="bg-border my-2" />
            </>
          )}

          {/* Pending Creator Status Card */}
          {showPendingCreator && (
            <>
              <SidebarGroup className={collapsedGroupClass}>
                <SidebarGroupContent>
                  {collapsed ? (
                    <div className="flex justify-center py-2 overflow-visible">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60">
                            <Crown className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>Solicitação em análise</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : null}
                </SidebarGroupContent>
              </SidebarGroup>
              <Separator className="bg-border my-2" />
            </>
          )}

          {/* Studio (Creator and Admin only) */}
          {showStudio && (
            <>
              <Separator className="bg-border my-2" />
              <SidebarGroup className={collapsedGroupClass}>
                {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Studio Classfy</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu className={collapsedMenuClass}>
                    {studioItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        {collapsed ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <SidebarMenuButton asChild>
                                <NavLink
                                  to={item.url}
                                  className={collapsedIconLinkClass}
                                  activeClassName="bg-muted text-cinematic-accent font-medium"
                                >
                                  <item.icon className="w-4 h-4" />
                                </NavLink>
                              </SidebarMenuButton>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p>{item.title}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <SidebarMenuButton asChild>
                            <NavLink
                              to={item.url}
                              className="text-foreground/80 hover:bg-muted hover:text-foreground"
                              activeClassName="bg-muted text-cinematic-accent font-medium"
                            >
                              <item.icon className="w-4 h-4" />
                              <span>{item.title}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}

          {/* Admin Panel */}
          {showAdmin && (
            <>
              <Separator className="bg-border my-2" />
              <SidebarGroup className={collapsedGroupClass}>
                {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Administração</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu className={collapsedMenuClass}>
                    {adminItems.map((item) => {
                      const pendingCount = item.countKey ? adminCounts[item.countKey] : 0;
                      return (
                        <SidebarMenuItem key={item.title}>
                          {collapsed ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <SidebarMenuButton asChild>
                                  <NavLink
                                    to={item.url}
                                    className={collapsedIconLinkClass}
                                    activeClassName="bg-muted text-cinematic-accent font-medium"
                                  >
                                    <item.icon className="w-4 h-4" />
                                    {pendingCount > 0 && (
                                      <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] font-bold rounded-full bg-red-500 text-white flex items-center justify-center">
                                        {pendingCount > 99 ? "99+" : pendingCount}
                                      </span>
                                    )}
                                  </NavLink>
                                </SidebarMenuButton>
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                <p>
                                  {item.title}
                                  {pendingCount > 0 && ` (${pendingCount})`}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <SidebarMenuButton asChild>
                              <NavLink
                                to={item.url}
                                className="text-foreground/80 hover:bg-muted hover:text-foreground"
                                activeClassName="bg-muted text-cinematic-accent font-medium"
                              >
                                <item.icon className="w-4 h-4" />
                                <span className="flex-1">{item.title}</span>
                                {pendingCount > 0 && (
                                  <Badge 
                                    variant="destructive" 
                                    className="h-5 min-w-5 px-1.5 text-[10px] font-bold rounded-full"
                                  >
                                    {pendingCount > 99 ? "99+" : pendingCount}
                                  </Badge>
                                )}
                              </NavLink>
                            </SidebarMenuButton>
                          )}
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}

          {/* User Actions */}
          {user && (
            <>
              <div className="mt-auto" />
              
              {/* Cards de Status - próximo ao rodapé */}
              {!collapsed && (
                <div className="px-2 pb-2 space-y-2">
                  {/* Solicitação em análise */}
                  {profile?.creator_status === 'pending' && (
                    <div className="p-3 rounded-xl bg-muted/40 dark:bg-muted/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground">Solicitação em análise</p>
                          <p className="text-[11px] text-muted-foreground">Aguardando aprovação</p>
                        </div>
                        <div className="p-1.5 rounded-full bg-background shrink-0">
                          <Crown className="h-3.5 w-3.5 text-red-500" />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Fazer upgrade */}
                  {profile?.plan && profile.plan !== "premium" && (
                    <button
                      onClick={() => navigate("/planos")}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-semibold text-foreground">Fazer upgrade</p>
                        <p className="text-[11px] text-muted-foreground">Desbloquear benefícios</p>
                      </div>
                      <div className="p-1.5 rounded-full bg-red-100 dark:bg-red-900/50 shrink-0">
                        <Zap className="h-3.5 w-3.5 text-red-500" />
                      </div>
                    </button>
                  )}
                </div>
              )}

              <Separator className="bg-border mb-2" />
              <SidebarGroup className={collapsedGroupClass}>
                <SidebarGroupContent>
                  <SidebarMenu className={collapsedMenuClass}>
                    <SidebarMenuItem>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton asChild>
                              <NavLink
                                to="/conta"
                                className={collapsedIconLinkClass}
                                activeClassName="bg-muted text-cinematic-accent"
                              >
                                <Settings className="w-4 h-4" />
                              </NavLink>
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p>Configurações</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuButton asChild>
                          <NavLink
                            to="/conta"
                            className="text-foreground/80 hover:bg-muted hover:text-foreground"
                            activeClassName="bg-muted text-cinematic-accent"
                          >
                            <Settings className="w-4 h-4" />
                            <span>Configurações</span>
                          </NavLink>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              onClick={signOut}
                              className={collapsedIconLinkClass}
                            >
                              <LogOut className="w-4 h-4" />
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p>Sair</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuButton
                          onClick={signOut}
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Sair</span>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}
        </SidebarContent>

        {/* Become Creator Modal */}
        <BecomeCreatorModal open={creatorModalOpen} onOpenChange={setCreatorModalOpen} />

        {/* Upgrade Modal */}
        <UpgradeModal open={upgradeModalOpen} onOpenChange={setUpgradeModalOpen} requiredPlan="pro" />

        <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Renomear estudo</DialogTitle>
              <DialogDescription>Escolha um novo nome para esse estudo no sidebar.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="sidebar-study-title">Novo nome</Label>
              <Input
                id="sidebar-study-title"
                value={studyTitleDraft}
                onChange={(event) => setStudyTitleDraft(event.target.value)}
                placeholder="Digite o novo nome..."
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleRenameStudy();
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleRenameStudy} disabled={!studyTitleDraft.trim()}>
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir estudo</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir este estudo? Essa ação também remove as mensagens dele e não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteStudy}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Sidebar>
    </TooltipProvider>
  );
}

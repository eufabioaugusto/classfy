import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useBoostContent = () => {
  const [isBoostModalOpen, setIsBoostModalOpen] = useState(false);
  const [selectedContent, setSelectedContent] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const openBoostModal = (contentId: string, contentTitle: string) => {
    setSelectedContent({ id: contentId, title: contentTitle });
    setIsBoostModalOpen(true);
  };

  const closeBoostModal = () => {
    setIsBoostModalOpen(false);
    setSelectedContent(null);
  };

  return {
    isBoostModalOpen,
    selectedContent,
    openBoostModal,
    closeBoostModal,
  };
};
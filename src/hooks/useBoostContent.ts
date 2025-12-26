import { useState } from "react";

export type BoostItemType = 'aula' | 'podcast' | 'short' | 'live' | 'curso';

export const useBoostContent = () => {
  const [isBoostModalOpen, setIsBoostModalOpen] = useState(false);
  const [selectedContent, setSelectedContent] = useState<{
    id: string;
    title: string;
    itemType: BoostItemType;
  } | null>(null);

  const openBoostModal = (contentId: string, contentTitle: string, itemType: BoostItemType = 'aula') => {
    setSelectedContent({ id: contentId, title: contentTitle, itemType });
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

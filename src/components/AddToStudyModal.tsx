import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, BookOpen, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface Study {
  id: string;
  title: string;
  description: string | null;
  last_activity_at: string;
}

interface AddToStudyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  contentTitle: string;
}

export function AddToStudyModal({ open, onOpenChange, contentId, contentTitle }: AddToStudyModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (open && user) {
      loadStudies();
    }
  }, [open, user]);

  const loadStudies = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('studies')
        .select('id, title, description, last_activity_at')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('last_activity_at', { ascending: false });

      if (error) throw error;
      setStudies(data || []);
    } catch (error) {
      console.error('Error loading studies:', error);
      toast.error('Erro ao carregar estudos');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToStudy = async (studyId: string) => {
    if (!user) return;

    try {
      setAdding(studyId);

      // Create a message in the study with the content reference
      const { error } = await supabase
        .from('study_messages')
        .insert({
          study_id: studyId,
          role: 'system',
          content: `Conteúdo adicionado: ${contentTitle}`,
          related_contents: [{ id: contentId, title: contentTitle }]
        });

      if (error) throw error;

      toast.success('Conteúdo adicionado ao estudo!');
      onOpenChange(false);
      
      // Navigate to the study
      navigate(`/c/${studyId}`);
    } catch (error) {
      console.error('Error adding to study:', error);
      toast.error('Erro ao adicionar conteúdo ao estudo');
    } finally {
      setAdding(null);
    }
  };

  const handleCreateNewStudy = () => {
    onOpenChange(false);
    navigate('/c/new', { state: { contentId, contentTitle } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar ao Estudo</DialogTitle>
          <DialogDescription>
            Selecione um estudo existente ou crie um novo para adicionar este conteúdo
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button 
            onClick={handleCreateNewStudy}
            className="w-full"
            variant="outline"
          >
            <Plus className="w-4 h-4 mr-2" />
            Criar Novo Estudo
          </Button>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : studies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Você ainda não tem estudos ativos</p>
              <p className="text-xs mt-1">Crie seu primeiro estudo acima</p>
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-2">
                {studies.map((study) => (
                  <Button
                    key={study.id}
                    onClick={() => handleAddToStudy(study.id)}
                    disabled={adding === study.id}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-3"
                  >
                    {adding === study.id ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin flex-shrink-0" />
                    ) : (
                      <BookOpen className="w-4 h-4 mr-2 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{study.title}</p>
                      {study.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {study.description}
                        </p>
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

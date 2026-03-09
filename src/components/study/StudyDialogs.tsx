import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

interface StudyDialogsProps {
  renameDialogOpen: boolean;
  setRenameDialogOpen: (open: boolean) => void;
  newTitle: string;
  setNewTitle: (title: string) => void;
  onRename: () => void;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
  onDelete: () => void;
  noteDialogOpen: boolean;
  setNoteDialogOpen: (open: boolean) => void;
  noteTimestamp: number;
  noteText: string;
  setNoteText: (text: string) => void;
  onSaveNote: () => void;
}

export function StudyDialogs({
  renameDialogOpen,
  setRenameDialogOpen,
  newTitle,
  setNewTitle,
  onRename,
  deleteDialogOpen,
  setDeleteDialogOpen,
  onDelete,
  noteDialogOpen,
  setNoteDialogOpen,
  noteTimestamp,
  noteText,
  setNoteText,
  onSaveNote,
}: StudyDialogsProps) {
  return (
    <>
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear Estudo</DialogTitle>
            <DialogDescription>Digite o novo nome para este estudo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-title">Novo nome</Label>
            <Input
              id="new-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Digite o novo nome..."
              onKeyDown={(e) => { if (e.key === "Enter") onRename(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>Cancelar</Button>
            <Button onClick={onRename} disabled={!newTitle.trim()}>Renomear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Estudo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este estudo? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Anotação</DialogTitle>
            <DialogDescription>
              Adicione uma anotação {noteTimestamp > 0 ? `no momento ${Math.floor(noteTimestamp / 60)}:${(noteTimestamp % 60).toString().padStart(2, "0")}` : "geral"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="note-text">Anotação</Label>
              <Textarea
                id="note-text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Digite sua anotação..."
                className="min-h-[120px] mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>Cancelar</Button>
            <Button onClick={onSaveNote} disabled={!noteText.trim()}>Salvar Anotação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

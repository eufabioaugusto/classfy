import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlobalLoader } from "@/components/GlobalLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Download, Image } from "lucide-react";

interface Material {
  id: string;
  title: string;
  description: string | null;
  type: string;
  file_url: string | null;
  thumbnail_url: string | null;
  category: string;
  active: boolean;
  created_at: string;
}

const EMPTY: Omit<Material, 'id' | 'created_at'> = {
  title: '', description: '', type: 'text', file_url: '', thumbnail_url: '', category: 'geral', active: true,
};

export default function AdminMarketingMaterials() {
  const { role, loading: authLoading } = useAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (role === 'admin') fetchMaterials();
  }, [role]);

  const fetchMaterials = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('marketing_materials')
      .select('*')
      .order('category', { ascending: true });
    setMaterials(data || []);
    setLoading(false);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setDialogOpen(true);
  };

  const openEdit = (m: Material) => {
    setEditing(m);
    setForm({ title: m.title, description: m.description || '', type: m.type, file_url: m.file_url || '', thumbnail_url: m.thumbnail_url || '', category: m.category, active: m.active });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { toast.error('Título obrigatório'); return; }
    setSaving(true);
    try {
      const payload = { ...form, description: form.description || null, file_url: form.file_url || null, thumbnail_url: form.thumbnail_url || null };
      if (editing) {
        const { error } = await supabase.from('marketing_materials').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Material atualizado!');
      } else {
        const { error } = await supabase.from('marketing_materials').insert(payload);
        if (error) throw error;
        toast.success('Material criado!');
      }
      setDialogOpen(false);
      fetchMaterials();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: Material) => {
    await supabase.from('marketing_materials').update({ active: !m.active }).eq('id', m.id);
    fetchMaterials();
  };

  const deleteMaterial = async (id: string) => {
    if (!confirm('Remover este material?')) return;
    await supabase.from('marketing_materials').delete().eq('id', id);
    fetchMaterials();
  };

  if (!authLoading && role !== 'admin') return <Navigate to="/" replace />;
  if (authLoading || loading) return <GlobalLoader />;

  const TYPE_LABELS: Record<string, string> = { banner: 'Banner', text: 'Texto', post: 'Post', video_template: 'Vídeo' };

  return (
    <AdminLayout title="Materiais de Afiliados">
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-sm">
              {materials.filter(m => m.active).length} materiais ativos · disponíveis para todos os usuários no modal de Indicações
            </p>
          </div>
          <Button onClick={openNew} className="gap-2">
            <Plus className="w-4 h-4" /> Novo Material
          </Button>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Arquivo</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhum material. Clique em "Novo Material" para começar.
                  </TableCell>
                </TableRow>
              ) : (
                materials.map((m) => (
                  <TableRow key={m.id} className={!m.active ? 'opacity-50' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {m.thumbnail_url ? (
                          <img src={m.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                            <Image className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-sm">{m.title}</p>
                          {m.description && <p className="text-xs text-muted-foreground line-clamp-1">{m.description}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABELS[m.type] || m.type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm capitalize text-muted-foreground">{m.category}</TableCell>
                    <TableCell>
                      {m.file_url ? (
                        <a href={m.file_url} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs">
                            <Download className="w-3 h-3" /> Ver
                          </Button>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Sem arquivo</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch checked={m.active} onCheckedChange={() => toggleActive(m)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(m)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteMaterial(m.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar Material' : 'Novo Material'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Título *</label>
                <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ex: Texto para WhatsApp" className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Descrição</label>
                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Breve descrição do material" rows={2} className="mt-1 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Tipo</label>
                  <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Texto pronto</SelectItem>
                      <SelectItem value="banner">Banner</SelectItem>
                      <SelectItem value="post">Post</SelectItem>
                      <SelectItem value="video_template">Vídeo template</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Categoria</label>
                  <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="social, visual..." className="mt-1" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">URL do arquivo (download)</label>
                <Input value={form.file_url} onChange={e => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">URL do thumbnail</label>
                <Input value={form.thumbnail_url} onChange={e => setForm({ ...form, thumbnail_url: e.target.value })} placeholder="https://..." className="mt-1" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
                <label className="text-sm">Visível para usuários</label>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={save} disabled={saving} className="flex-1">{saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar'}</Button>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

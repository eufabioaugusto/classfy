import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, GripVertical } from "lucide-react";
import { GlobalLoader } from "@/components/GlobalLoader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FeaturedCreator {
  id: string;
  creator_id: string;
  background_image_url: string;
  badge_text: string;
  featured_image_url: string;
  description: string;
  link_url: string;
  order_index: number;
  creator_name?: string;
}

interface Creator {
  id: string;
  display_name: string;
  creator_channel_name: string | null;
}

const AdminFeaturedCreators = () => {
  const { user, role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [featuredCreators, setFeaturedCreators] = useState<FeaturedCreator[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<File | null>(null);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    creator_id: "",
    badge_text: "New",
    description: "",
    link_url: "",
  });

  useEffect(() => {
    if (!authLoading && role !== "admin") {
      navigate("/");
    }
  }, [user, role, authLoading, navigate]);

  useEffect(() => {
    if (role === "admin") {
      fetchData();
    }
  }, [role]);

  const fetchData = async () => {
    try {
      // Fetch featured creators
      const { data: featured, error: featuredError } = await supabase
        .from("featured_creators")
        .select(`
          *,
          profiles:creator_id (
            display_name,
            creator_channel_name
          )
        `)
        .order("order_index", { ascending: true });

      if (featuredError) throw featuredError;

      setFeaturedCreators(
        featured.map((f: any) => ({
          ...f,
          creator_name: f.profiles?.creator_channel_name || f.profiles?.display_name || "Creator",
        }))
      );

      // Fetch all approved creators
      const { data: creatorsList, error: creatorsError } = await supabase
        .from("profiles")
        .select("id, display_name, creator_channel_name")
        .eq("creator_status", "approved")
        .order("display_name");

      if (creatorsError) throw creatorsError;
      setCreators(creatorsList || []);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const uploadImage = async (file: File, path: string): Promise<string> => {
    const fileExt = file.name.split(".").pop();
    const fileName = `${path}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError, data } = await supabase.storage
      .from("featured-creators")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from("featured-creators")
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!backgroundImage) {
      toast.error("Adicione a imagem de fundo");
      return;
    }
    
    if (!featuredImage) {
      toast.error("Adicione a imagem em destaque");
      return;
    }

    setSubmitting(true);

    try {
      // Upload images
      const backgroundUrl = await uploadImage(backgroundImage, "background");
      const featuredUrl = await uploadImage(featuredImage, "featured");

      const maxOrder = Math.max(...featuredCreators.map((f) => f.order_index), -1);

      const { error } = await supabase.from("featured_creators").insert({
        ...formData,
        background_image_url: backgroundUrl,
        featured_image_url: featuredUrl,
        order_index: maxOrder + 1,
      });

      if (error) throw error;

      toast.success("Creator em destaque adicionado!");
      setShowForm(false);
      setBackgroundImage(null);
      setFeaturedImage(null);
      setFormData({
        creator_id: "",
        badge_text: "New",
        description: "",
        link_url: "",
      });
      fetchData();
    } catch (error) {
      console.error("Error creating featured creator:", error);
      toast.error("Erro ao adicionar creator");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover este creator em destaque?")) return;

    try {
      const { error } = await supabase.from("featured_creators").delete().eq("id", id);

      if (error) throw error;

      toast.success("Creator removido!");
      fetchData();
    } catch (error) {
      console.error("Error deleting featured creator:", error);
      toast.error("Erro ao remover creator");
    }
  };

  if (authLoading || loading) {
    return <GlobalLoader />;
  }

  if (role !== "admin") {
    return null;
  }

  return (
    <AdminLayout title="Creators em Destaque">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-muted-foreground">
            Gerencie os creators que aparecerão na seção de destaque da home
          </p>
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-2" />
            Adicionar Creator
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>Novo Creator em Destaque</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Creator</Label>
                  <Select
                    value={formData.creator_id}
                    onValueChange={(value) => setFormData({ ...formData, creator_id: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um creator" />
                    </SelectTrigger>
                    <SelectContent>
                      {creators.map((creator) => (
                        <SelectItem key={creator.id} value={creator.id}>
                          {creator.creator_channel_name || creator.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Imagem de Fundo (vertical)</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setBackgroundImage(e.target.files?.[0] || null)}
                    required
                  />
                  {backgroundImage && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {backgroundImage.name}
                    </p>
                  )}
                </div>

                <div>
                  <Label>Imagem em Destaque (logo PNG)</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFeaturedImage(e.target.files?.[0] || null)}
                    required
                  />
                  {featuredImage && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {featuredImage.name}
                    </p>
                  )}
                </div>

                <div>
                  <Label>Texto do Badge</Label>
                  <Input
                    value={formData.badge_text}
                    onChange={(e) => setFormData({ ...formData, badge_text: e.target.value })}
                    placeholder="New, Premium, etc"
                    required
                  />
                </div>

                <div>
                  <Label>Descrição (2 linhas)</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Texto curto descritivo"
                    rows={2}
                    required
                  />
                </div>

                <div>
                  <Label>URL de Destino (perfil ou conteúdo)</Label>
                  <Input
                    value={formData.link_url}
                    onChange={(e) => setFormData({ ...formData, link_url: e.target.value })}
                    placeholder="/perfil/creator-id ou /watch/content-id"
                    required
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Adicionar
                  </Button>
                  <Button type="button" variant="outline" onClick={() => {
                    setShowForm(false);
                    setBackgroundImage(null);
                    setFeaturedImage(null);
                  }}>
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4">
          {featuredCreators.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum creator em destaque ainda
              </CardContent>
            </Card>
          ) : (
            featuredCreators.map((creator) => (
              <Card key={creator.id}>
                <CardContent className="p-6">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <GripVertical className="h-5 w-5 text-muted-foreground" />
                    </div>
                    
                    <div className="flex-shrink-0 w-24 h-32 rounded-lg overflow-hidden bg-muted">
                      <img
                        src={creator.background_image_url}
                        alt={creator.creator_name}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-lg">{creator.creator_name}</h3>
                          <p className="text-sm text-muted-foreground mb-1">Badge: {creator.badge_text}</p>
                        </div>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => handleDelete(creator.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                        {creator.description}
                      </p>
                      
                      <p className="text-xs text-muted-foreground">
                        Link: {creator.link_url}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminFeaturedCreators;

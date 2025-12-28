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
import { Loader2, Plus, Trash2, GripVertical, ExternalLink, Image, X } from "lucide-react";
import { GlobalLoader } from "@/components/GlobalLoader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Skill {
  image_url: string;
  title: string;
  description: string;
}

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
  slug?: string | null;
  short_bio?: string | null;
  total_videos?: number;
  total_duration_seconds?: number;
  commission_link?: string | null;
  skills?: Skill[];
  trailer_url?: string | null;
}

interface Creator {
  id: string;
  display_name: string;
  creator_channel_name: string | null;
}

const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
};

const AdminFeaturedCreators = () => {
  const { user, role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [featuredCreators, setFeaturedCreators] = useState<FeaturedCreator[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<File | null>(null);
  const [heroImage, setHeroImage] = useState<File | null>(null);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [trailerFile, setTrailerFile] = useState<File | null>(null);
  const [skillImages, setSkillImages] = useState<(File | null)[]>([null, null, null, null]);
  
  const [formData, setFormData] = useState({
    creator_id: "",
    badge_text: "New",
    description: "",
    link_url: "",
    short_bio: "",
    total_videos: 0,
    total_duration_seconds: 0,
    commission_link: "",
    skills: [
      { image_url: "", title: "", description: "" },
      { image_url: "", title: "", description: "" },
      { image_url: "", title: "", description: "" },
      { image_url: "", title: "", description: "" },
    ] as Skill[],
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
          skills: Array.isArray(f.skills) ? f.skills : [],
        }))
      );

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

    const { error: uploadError } = await supabase.storage
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

  const uploadVideo = async (file: File, path: string): Promise<string> => {
    const fileExt = file.name.split(".").pop();
    const fileName = `${path}-${Date.now()}.${fileExt}`;
    const filePath = `trailers/${fileName}`;

    const { error: uploadError } = await supabase.storage
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
      
      // Upload hero image if exists
      let heroImageUrl: string | null = null;
      if (heroImage) {
        heroImageUrl = await uploadImage(heroImage, "hero");
      }

      // Upload trailer if exists
      let trailerUrl: string | null = null;
      if (trailerFile) {
        trailerUrl = await uploadVideo(trailerFile, "trailer");
      }

      // Upload skill images
      const uploadedSkills: Skill[] = [];
      for (let i = 0; i < 4; i++) {
        const skill = formData.skills[i];
        if (skill.title) {
          let skillImageUrl = skill.image_url;
          if (skillImages[i]) {
            skillImageUrl = await uploadImage(skillImages[i]!, `skill-${i}`);
          }
          uploadedSkills.push({
            ...skill,
            image_url: skillImageUrl,
          });
        }
      }

      const maxOrder = Math.max(...featuredCreators.map((f) => f.order_index), -1);

      // Get creator name for slug
      const selectedCreator = creators.find(c => c.id === formData.creator_id);
      const creatorName = selectedCreator?.creator_channel_name || selectedCreator?.display_name || "";
      const slug = generateSlug(creatorName) + "-" + (maxOrder + 1);

      const { error } = await supabase.from("featured_creators").insert([{
        creator_id: formData.creator_id,
        badge_text: formData.badge_text,
        description: formData.description,
        link_url: formData.link_url,
        background_image_url: backgroundUrl,
        hero_image_url: heroImageUrl,
        featured_image_url: featuredUrl,
        order_index: maxOrder + 1,
        slug,
        short_bio: formData.short_bio || null,
        total_videos: formData.total_videos || 0,
        total_duration_seconds: formData.total_duration_seconds || 0,
        commission_link: formData.commission_link || null,
        skills: JSON.parse(JSON.stringify(uploadedSkills)),
        trailer_url: trailerUrl,
      }]);

      if (error) throw error;

      toast.success("Creator em destaque adicionado!");
      resetForm();
      fetchData();
    } catch (error) {
      console.error("Error creating featured creator:", error);
      toast.error("Erro ao adicionar creator");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setBackgroundImage(null);
    setHeroImage(null);
    setFeaturedImage(null);
    setTrailerFile(null);
    setSkillImages([null, null, null, null]);
    setFormData({
      creator_id: "",
      badge_text: "New",
      description: "",
      link_url: "",
      short_bio: "",
      total_videos: 0,
      total_duration_seconds: 0,
      commission_link: "",
      skills: [
        { image_url: "", title: "", description: "" },
        { image_url: "", title: "", description: "" },
        { image_url: "", title: "", description: "" },
        { image_url: "", title: "", description: "" },
      ],
    });
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

  const updateSkill = (index: number, field: keyof Skill, value: string) => {
    const newSkills = [...formData.skills];
    newSkills[index] = { ...newSkills[index], [field]: value };
    setFormData({ ...formData, skills: newSkills });
  };

  const handleSkillImageChange = (index: number, file: File | null) => {
    const newSkillImages = [...skillImages];
    newSkillImages[index] = file;
    setSkillImages(newSkillImages);
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    }
    return `${minutes}min`;
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
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="grid md:grid-cols-2 gap-4">
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
                    <Label>Texto do Badge</Label>
                    <Input
                      value={formData.badge_text}
                      onChange={(e) => setFormData({ ...formData, badge_text: e.target.value })}
                      placeholder="New, Premium, etc"
                      required
                    />
                  </div>
                </div>

                {/* Images */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <Label>Imagem Vertical (Carrossel)</Label>
                    <p className="text-xs text-muted-foreground mb-2">Proporção 9:16 para o carrossel</p>
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
                    <Label>Imagem Hero 4:3 (Página Dedicada)</Label>
                    <p className="text-xs text-muted-foreground mb-2">Proporção 4:3 horizontal</p>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setHeroImage(e.target.files?.[0] || null)}
                    />
                    {heroImage && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {heroImage.name}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label>Logo/Destaque (PNG)</Label>
                    <p className="text-xs text-muted-foreground mb-2">Logo ou imagem em destaque</p>
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
                </div>

                {/* Description */}
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

                {/* New Fields */}
                <div className="border-t pt-6">
                  <h3 className="font-semibold mb-4">Informações da Página Dedicada</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <Label>Bio Curta (1 linha)</Label>
                      <Input
                        value={formData.short_bio}
                        onChange={(e) => setFormData({ ...formData, short_bio: e.target.value })}
                        placeholder="Uma linha sobre o creator"
                      />
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <Label>Quantidade de Vídeos</Label>
                        <Input
                          type="number"
                          value={formData.total_videos}
                          onChange={(e) => setFormData({ ...formData, total_videos: parseInt(e.target.value) || 0 })}
                          min={0}
                        />
                      </div>

                      <div>
                        <Label>Tempo Total (segundos)</Label>
                        <Input
                          type="number"
                          value={formData.total_duration_seconds}
                          onChange={(e) => setFormData({ ...formData, total_duration_seconds: parseInt(e.target.value) || 0 })}
                          min={0}
                        />
                        {formData.total_duration_seconds > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            = {formatDuration(formData.total_duration_seconds)}
                          </p>
                        )}
                      </div>

                      <div>
                        <Label>Link de Comissão</Label>
                        <Input
                          value={formData.commission_link}
                          onChange={(e) => setFormData({ ...formData, commission_link: e.target.value })}
                          placeholder="https://..."
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Vídeo Trailer (máx. 1 minuto)</Label>
                      <Input
                        type="file"
                        accept="video/*"
                        onChange={(e) => setTrailerFile(e.target.files?.[0] || null)}
                      />
                      {trailerFile && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {trailerFile.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label>URL de Destino (fallback)</Label>
                      <Input
                        value={formData.link_url}
                        onChange={(e) => setFormData({ ...formData, link_url: e.target.value })}
                        placeholder="/perfil/creator-id ou /watch/content-id"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Skills */}
                <div className="border-t pt-6">
                  <h3 className="font-semibold mb-4">Skills (até 4)</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    {[0, 1, 2, 3].map((index) => (
                      <Card key={index} className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                              {index + 1}
                            </div>
                            <span className="font-medium">Skill {index + 1}</span>
                          </div>

                          <div>
                            <Label className="text-xs">Imagem</Label>
                            <Input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSkillImageChange(index, e.target.files?.[0] || null)}
                              className="text-sm"
                            />
                          </div>

                          <div>
                            <Label className="text-xs">Título</Label>
                            <Input
                              value={formData.skills[index].title}
                              onChange={(e) => updateSkill(index, "title", e.target.value)}
                              placeholder="Nome da skill"
                              className="text-sm"
                            />
                          </div>

                          <div>
                            <Label className="text-xs">Descrição</Label>
                            <Textarea
                              value={formData.skills[index].description}
                              onChange={(e) => updateSkill(index, "description", e.target.value)}
                              placeholder="Descrição curta"
                              rows={2}
                              className="text-sm"
                            />
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Adicionar
                  </Button>
                  <Button type="button" variant="outline" onClick={resetForm}>
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
                          {creator.slug && (
                            <p className="text-xs text-primary">
                              /creators/destaque/{creator.slug}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {creator.slug && (
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => window.open(`/creators/destaque/${creator.slug}`, "_blank")}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="icon"
                            onClick={() => handleDelete(creator.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                        {creator.description}
                      </p>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {creator.total_videos && creator.total_videos > 0 && (
                          <span>{creator.total_videos} vídeos</span>
                        )}
                        {creator.total_duration_seconds && creator.total_duration_seconds > 0 && (
                          <span>{formatDuration(creator.total_duration_seconds)}</span>
                        )}
                        {creator.skills && creator.skills.length > 0 && (
                          <span>{creator.skills.length} skills</span>
                        )}
                        {creator.trailer_url && (
                          <span>Trailer ✓</span>
                        )}
                      </div>
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

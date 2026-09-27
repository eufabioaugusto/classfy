import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlignCenter, AlignLeft, AlignRight, ImagePlus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { HomeHero, type HomeHeroContent } from "@/components/home/HomeHero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { GlobalLoader } from "@/components/GlobalLoader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildEditorialHero, isHeroAlignment, normalizeHeroHref, type HeroAlignment, type HomeHeroSettings } from "@/lib/homeHeroEditorial";
import { HOME_EDITORIAL, isConfiguredHomeHero } from "@/config/home";
import "@/styles/home-v2.css";
import "@/styles/admin-home-hero.css";

type HeroForm = Omit<HomeHeroSettings, "id" | "created_at" | "updated_at">;

const defaultForm: HeroForm = {
  content_id: "",
  is_active: true,
  eyebrow_label: "Em destaque",
  chip_label: null,
  show_chip: true,
  title: null,
  description: null,
  thumbnail_url: null,
  image_position: "center",
  alignment: "left",
  primary_label: "Assistir agora",
  primary_href: null,
  show_secondary: true,
  secondary_label: "Estudar com a Classy",
  secondary_href: null,
};

const contentFields = "id, title, description, thumbnail_url, content_type, duration_minutes, duration_seconds, visibility, profiles:creator_id(display_name, creator_channel_name)";
const alignments: Array<{ value: HeroAlignment; label: string; Icon: typeof AlignLeft }> = [
  { value: "left", label: "Esquerda", Icon: AlignLeft },
  { value: "center", label: "Centro", Icon: AlignCenter },
  { value: "right", label: "Direita", Icon: AlignRight },
];

function creatorName(content: HomeHeroContent) {
  const profile = Array.isArray(content.profiles) ? content.profiles[0] : content.profiles;
  return profile?.display_name || profile?.creator_channel_name || "Creator Classfy";
}

function readableDuration(content: HomeHeroContent) {
  const seconds = content.duration_seconds || (content.duration_minutes || 0) * 60;
  if (!seconds) return "Duração não informada";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes} min`;
}

function cleanOptional(value: string | null) {
  return value?.trim() || null;
}

export default function AdminHomeHero() {
  const { role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<HeroForm>(defaultForm);
  const [selectedContent, setSelectedContent] = useState<HomeHeroContent | null>(null);
  const [options, setOptions] = useState<HomeHeroContent[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasSavedSettings, setHasSavedSettings] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && role !== "admin") navigate("/");
  }, [authLoading, role, navigate]);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;

    void (async () => {
      const { data, error } = await supabase.from("home_hero_settings").select("*").eq("id", 1).maybeSingle();
      if (!active) return;
      if (error) {
        toast.error("Não foi possível carregar a curadoria da Home.");
        setLoading(false);
        return;
      }

      if (data) {
        setHasSavedSettings(true);
        const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...fields } = data;
        setForm(fields);
        const selected = await supabase.from("contents").select(contentFields)
          .eq("id", data.content_id).eq("status", "approved")
          .not("published_at", "is", null).maybeSingle();
        if (active && selected.data) setSelectedContent(selected.data as HomeHeroContent);
      } else {
        const currentQuery = supabase.from("contents").select(contentFields)
          .eq("status", "approved").not("published_at", "is", null);
        const current = HOME_EDITORIAL.heroContentId
          ? await currentQuery.eq("id", HOME_EDITORIAL.heroContentId).maybeSingle()
          : await currentQuery.ilike("title", HOME_EDITORIAL.heroFallbackTitle).limit(1).maybeSingle();
        if (active && current.data) {
          setSelectedContent(current.data as HomeHeroContent);
          setForm((previous) => ({ ...previous, content_id: current.data.id }));
        }
      }
      if (active) setLoading(false);
    })();

    return () => { active = false; };
  }, [role]);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        let query = supabase.from("contents")
          .select(contentFields)
          .eq("status", "approved")
          .not("published_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(30);
        if (search.trim()) query = query.ilike("title", `%${search.trim()}%`);
        const { data, error } = await query;
        if (!active) return;
        setSearching(false);
        if (error) {
          toast.error("Não foi possível buscar conteúdos aprovados.");
          return;
        }
        const contents = (data || []) as HomeHeroContent[];
        setOptions(contents);
        if (!hasSavedSettings && !selectedContent && !search.trim()) {
          const current = contents.find(isConfiguredHomeHero);
          if (current) {
            setSelectedContent(current);
            setForm((previous) => ({ ...previous, content_id: current.id }));
          }
        }
      })();
    }, 250);

    return () => { active = false; window.clearTimeout(timer); };
  }, [role, search, hasSavedSettings, selectedContent]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const preview = useMemo(() => {
    if (!selectedContent) return null;
    const settings = {
      ...form,
      id: 1,
      created_at: "",
      updated_at: "",
      thumbnail_url: imagePreview || form.thumbnail_url,
    } as HomeHeroSettings;
    return buildEditorialHero(selectedContent, settings);
  }, [form, imagePreview, selectedContent]);

  const change = <K extends keyof HeroForm>(key: K, value: HeroForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const selectImage = (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Escolha uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter até 5 MB.");
      return;
    }
    setImageFile(file);
  };

  const save = async () => {
    if (!selectedContent || !form.content_id) {
      toast.error("Escolha uma aula ou vídeo aprovado.");
      return;
    }
    if (!imageFile && !form.thumbnail_url && !selectedContent.thumbnail_url) {
      toast.error("Adicione uma imagem ou escolha um conteúdo com capa.");
      return;
    }
    if (!form.eyebrow_label.trim() || !form.primary_label.trim() || (form.show_secondary && !form.secondary_label.trim())) {
      toast.error("Preencha os textos exibidos nos botões e no topo do banner.");
      return;
    }
    for (const href of [form.primary_href, form.secondary_href]) {
      if (href?.trim() && normalizeHeroHref(href, "") !== href.trim()) {
        toast.error("Use um caminho interno começando com / nos links dos botões.");
        return;
      }
    }
    if (!isHeroAlignment(form.alignment) || !isHeroAlignment(form.image_position)) return;

    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      let thumbnailUrl = cleanOptional(form.thumbnail_url);
      if (imageFile) {
        const extension = imageFile.type === "image/png" ? "png" : imageFile.type === "image/webp" ? "webp" : "jpg";
        uploadedPath = `hero/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("home-hero").upload(uploadedPath, imageFile, {
          cacheControl: "31536000",
          upsert: false,
          contentType: imageFile.type,
        });
        if (uploadError) throw uploadError;
        thumbnailUrl = supabase.storage.from("home-hero").getPublicUrl(uploadedPath).data.publicUrl;
      }

      const { error } = await supabase.from("home_hero_settings").upsert({
        id: 1,
        ...form,
        content_id: selectedContent.id,
        eyebrow_label: form.eyebrow_label.trim(),
        chip_label: cleanOptional(form.chip_label),
        title: cleanOptional(form.title),
        description: cleanOptional(form.description),
        thumbnail_url: thumbnailUrl,
        primary_label: form.primary_label.trim(),
        primary_href: cleanOptional(form.primary_href),
        secondary_label: form.secondary_label.trim(),
        secondary_href: cleanOptional(form.secondary_href),
      });
      if (error) throw error;
      setForm((previous) => ({ ...previous, thumbnail_url: thumbnailUrl }));
      setImageFile(null);
      setHasSavedSettings(true);
      await queryClient.invalidateQueries({ queryKey: ["home-hero-editorial"] });
      toast.success(form.is_active ? "Destaque publicado na Home." : "Curadoria salva. A Home usa a seleção automática.");
    } catch (error) {
      if (uploadedPath) await supabase.storage.from("home-hero").remove([uploadedPath]);
      console.error("Error saving home hero:", error);
      toast.error("Não foi possível salvar o destaque.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (role === "admin" && loading)) return <GlobalLoader />;
  if (role !== "admin") return null;

  return (
    <AdminLayout title="Destaque da Home">
      <div className="hero-admin">
        <header className="hero-admin__header">
          <div>
            <span className="hero-admin__eyebrow">Curadoria · Modo Explorar</span>
            <h1>Destaque da Home</h1>
            <p>Escolha o conteúdo de abertura e ajuste como ele aparece para todo mundo.</p>
          </div>
          <div className="hero-admin__header-actions">
            <span className={`hero-admin__status${form.is_active && hasSavedSettings ? " hero-admin__status--active" : ""}`}>
              {hasSavedSettings && form.is_active ? "Publicado" : "Seleção automática"}
            </span>
            <Button onClick={save} disabled={saving || !selectedContent}>
              {saving ? "Salvando..." : form.is_active ? "Salvar e publicar" : "Salvar sem exibir"}
            </Button>
          </div>
        </header>

        <div className="hero-admin__layout">
          <div className="hero-admin__editor">
            <section className="hero-admin__panel">
              <span className="hero-admin__step">01 · Conteúdo</span>
              <h2>Escolha a aula ou vídeo</h2>
              <p>Creator, formato, duração e acesso são puxados automaticamente.</p>
              <div className="hero-admin__search">
                <Search aria-hidden="true" />
                <Input aria-label="Buscar conteúdo aprovado" placeholder="Buscar conteúdo aprovado" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <div className="hero-admin__results" aria-label="Conteúdos aprovados">
                {searching && <p>Buscando conteúdos...</p>}
                {!searching && options.length === 0 && <p>Nenhum conteúdo encontrado.</p>}
                {!searching && options.map((content) => (
                  <button type="button" key={content.id} className={`hero-admin__result${form.content_id === content.id ? " is-selected" : ""}`} onClick={() => {
                    setSelectedContent(content);
                    setForm((previous) => previous.content_id === content.id ? previous : {
                      ...previous, content_id: content.id, title: null, description: null,
                      thumbnail_url: null, primary_href: null,
                    });
                    setImageFile(null);
                  }}>
                    {content.thumbnail_url ? <img src={content.thumbnail_url} alt="" /> : <span className="hero-admin__result-placeholder"><ImagePlus aria-hidden="true" /></span>}
                    <span><strong>{content.title}</strong><small>{creatorName(content)} · {content.content_type || "Vídeo"} · {readableDuration(content)}</small></span>
                  </button>
                ))}
              </div>
              {selectedContent && <p className="hero-admin__selected">Vinculado: <strong>{selectedContent.title}</strong> · <span>{readableDuration(selectedContent)}</span></p>}
            </section>

            <section className="hero-admin__panel">
              <span className="hero-admin__step">02 · Texto e chips</span>
              <h2>Edite a mensagem</h2>
              <div className="hero-admin__fields hero-admin__fields--two">
                <div><Label htmlFor="hero-eyebrow">Chamada curta</Label><Input id="hero-eyebrow" maxLength={40} value={form.eyebrow_label} onChange={(event) => change("eyebrow_label", event.target.value)} /></div>
                <div><Label htmlFor="hero-chip">Chip de acesso</Label><Input id="hero-chip" maxLength={40} placeholder={selectedContent?.visibility === "pro" ? "Seleção PRO" : "Acesso Free"} value={form.chip_label || ""} onChange={(event) => change("chip_label", event.target.value)} /></div>
              </div>
              <label className="hero-admin__toggle"><span>Mostrar chip de acesso</span><Switch checked={form.show_chip} onCheckedChange={(checked) => change("show_chip", checked)} /></label>
              <div className="hero-admin__fields">
                <div><Label htmlFor="hero-title">Título principal</Label><Input id="hero-title" maxLength={100} placeholder={selectedContent?.title || "Título do conteúdo"} value={form.title || ""} onChange={(event) => change("title", event.target.value)} /><small>Vazio usa o título da aula ou vídeo.</small></div>
                <div><Label htmlFor="hero-description">Descrição</Label><Textarea id="hero-description" maxLength={280} rows={3} placeholder={selectedContent?.description || "Descreva o conteúdo em destaque"} value={form.description || ""} onChange={(event) => change("description", event.target.value)} /><small>Vazio usa a descrição do conteúdo.</small></div>
              </div>
            </section>

            <section className="hero-admin__panel">
              <span className="hero-admin__step">03 · Imagem e posição</span>
              <h2>Enquadre o destaque</h2>
              <div className="hero-admin__upload">
                <ImagePlus aria-hidden="true" />
                <div><strong>{imageFile ? imageFile.name : form.thumbnail_url ? "Imagem personalizada" : "Capa do conteúdo"}</strong><small>JPG, PNG ou WebP · até 5 MB · recomendado 16:9</small></div>
                <label className="hero-admin__upload-button">Carregar imagem<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event.target.files?.[0])} /></label>
              </div>
              {(imageFile || form.thumbnail_url) && <button type="button" className="hero-admin__text-button" onClick={() => { setImageFile(null); change("thumbnail_url", null); }}>Usar a capa do conteúdo</button>}
              <Label>Alinhamento do texto</Label>
              <div className="hero-admin__segmented" role="group" aria-label="Alinhamento do texto">
                {alignments.map(({ value, label, Icon }) => <button type="button" key={value} aria-pressed={form.alignment === value} onClick={() => change("alignment", value)}><Icon aria-hidden="true" />{label}</button>)}
              </div>
              <Label>Posição da imagem</Label>
              <div className="hero-admin__segmented" role="group" aria-label="Posição da imagem">
                {alignments.map(({ value, label, Icon }) => <button type="button" key={value} aria-pressed={form.image_position === value} onClick={() => change("image_position", value)}><Icon aria-hidden="true" />{label}</button>)}
              </div>
            </section>

            <section className="hero-admin__panel">
              <span className="hero-admin__step">04 · Ações</span>
              <h2>Defina os botões</h2>
              <div className="hero-admin__fields hero-admin__fields--two">
                <div><Label htmlFor="hero-primary-label">Botão principal</Label><Input id="hero-primary-label" maxLength={40} value={form.primary_label} onChange={(event) => change("primary_label", event.target.value)} /></div>
                <div><Label htmlFor="hero-primary-link">Destino do botão</Label><Input id="hero-primary-link" placeholder={selectedContent ? `/watch/${selectedContent.id}` : "/watch/..."} value={form.primary_href || ""} onChange={(event) => change("primary_href", event.target.value)} /><small>Vazio abre o conteúdo selecionado. Use caminhos internos como /watch/...</small></div>
              </div>
              <label className="hero-admin__toggle"><span>Mostrar segundo botão</span><Switch checked={form.show_secondary} onCheckedChange={(checked) => change("show_secondary", checked)} /></label>
              {form.show_secondary && <div className="hero-admin__fields hero-admin__fields--two">
                <div><Label htmlFor="hero-secondary-label">Segundo botão</Label><Input id="hero-secondary-label" maxLength={40} value={form.secondary_label} onChange={(event) => change("secondary_label", event.target.value)} /></div>
                <div><Label htmlFor="hero-secondary-link">Destino do segundo botão</Label><Input id="hero-secondary-link" placeholder="/c/new" value={form.secondary_href || ""} onChange={(event) => change("secondary_href", event.target.value)} /><small>Vazio abre um novo estudo sobre o conteúdo.</small></div>
              </div>}
            </section>

            <section className="hero-admin__panel hero-admin__panel--publish">
              <span className="hero-admin__step">05 · Publicação</span>
              <label className="hero-admin__toggle"><span><strong>Exibir esta curadoria na Home</strong><small>Ao desligar, o destaque automático volta a aparecer.</small></span><Switch checked={form.is_active} onCheckedChange={(checked) => change("is_active", checked)} /></label>
              <Button onClick={save} disabled={saving || !selectedContent}>{saving ? "Salvando..." : form.is_active ? "Salvar e publicar" : "Salvar sem exibir"}</Button>
            </section>
          </div>

          <aside className="hero-admin__preview-wrap">
            <div className="hero-admin__preview-heading"><Sparkles aria-hidden="true" /><div><strong>Prévia do destaque</strong><span>Assim ele aparece na Home</span></div></div>
            {preview ? <div className="hero-admin__preview"><HomeHero content={preview} onPlay={() => undefined} onOpenFocus={() => undefined} /></div> : <div className="hero-admin__preview-empty">Escolha um conteúdo para ver a prévia.</div>}
            <p>A prévia mostra o enquadramento e os textos. Salve para aplicar na Home.</p>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}

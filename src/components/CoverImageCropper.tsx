import { useEffect, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { coverTargetSize, getCoverCropRect } from "@/lib/media/coverCrop";

interface CoverImageCropperProps {
  file: File;
  targetAspect: number;
  onConfirm: (file: File) => void | Promise<void>;
  onCancel: () => void;
}

export function CoverImageCropper({
  file,
  targetAspect,
  onConfirm,
  onCancel,
}: CoverImageCropperProps) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [cropPosition, setCropPosition] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  const sourceAspect = dimensions.height
    ? dimensions.width / dimensions.height
    : targetAspect;
  const cropAxis =
    Math.abs(sourceAspect - targetAspect) < 0.01
      ? null
      : sourceAspect < targetAspect
        ? "vertical"
        : "horizontal";
  const objectPosition =
    cropAxis === "vertical"
      ? `50% ${cropPosition}%`
      : cropAxis === "horizontal"
        ? `${cropPosition}% 50%`
        : "50% 50%";

  const exportCover = async () => {
    if (!previewUrl) return;
    setExporting(true);
    setError("");
    try {
      const image = new Image();
      image.src = previewUrl;
      await image.decode();
      const target = coverTargetSize(targetAspect);
      const crop = getCoverCropRect(
        image.naturalWidth,
        image.naturalHeight,
        targetAspect,
        {
          x: cropAxis === "horizontal" ? cropPosition : 50,
          y: cropAxis === "vertical" ? cropPosition : 50,
        },
      );
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível preparar a imagem.");
      context.drawImage(
        image,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        target.width,
        target.height,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("Não foi possível gerar a capa.")),
          "image/jpeg",
          0.92,
        );
      });
      await onConfirm(
        new File([blob], `capa_${Date.now()}.jpg`, { type: "image/jpeg" }),
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Não foi possível preparar esta imagem.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="studio-image-cropper">
      <div className="studio-image-cropper__toolbar">
        <div>
          <strong>Ajuste sua imagem</strong>
          <span>A área visível será exatamente a capa publicada.</span>
        </div>
        <div>
          <button type="button" onClick={onCancel} disabled={exporting}>
            <X /> Cancelar
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void exportCover()}
            disabled={exporting}
          >
            {exporting ? <LoaderCircle className="animate-spin" /> : <Check />}
            {exporting ? "Preparando..." : "Usar imagem"}
          </button>
        </div>
      </div>
      <div
        className="studio-image-cropper__preview"
        style={{ aspectRatio: targetAspect }}
      >
        <img
          src={previewUrl}
          alt="Prévia da imagem escolhida"
          style={{ objectPosition }}
          onLoad={(event) =>
            setDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
        <span>Área da capa</span>
      </div>
      {cropAxis && (
        <label className="studio-image-cropper__position">
          <span>
            Enquadramento {cropAxis === "vertical" ? "vertical" : "horizontal"}
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={cropPosition}
            onChange={(event) => setCropPosition(Number(event.target.value))}
            aria-label={`Ajustar enquadramento ${cropAxis}`}
          />
        </label>
      )}
      {error && <p className="studio-image-cropper__error">{error}</p>}
    </div>
  );
}

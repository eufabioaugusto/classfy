import { useState } from "react";
import { AddressAutofill } from "@mapbox/search-js-react";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface LocationInputMapboxProps {
  value: string[];
  onChange: (locations: string[]) => void;
}

export const LocationInputMapbox = ({ value, onChange }: LocationInputMapboxProps) => {
  const [input, setInput] = useState("");
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;

  const addLocation = (location: string) => {
    if (location.trim() && !value.includes(location)) {
      onChange([...value, location]);
      setInput("");
    }
  };

  const removeLocation = (location: string) => {
    onChange(value.filter(loc => loc !== location));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      addLocation(input.trim());
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      removeLocation(value[value.length - 1]);
    }
  };

  if (!mapboxToken) {
    return (
      <div className="p-4 border border-destructive rounded-md bg-destructive/10">
        <p className="text-sm text-destructive">
          Token do Mapbox não configurado. Configure VITE_MAPBOX_TOKEN nas variáveis de ambiente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((location) => (
          <Badge
            key={location}
            variant="secondary"
            className="px-3 py-1 text-sm flex items-center gap-2"
          >
            {location}
            <button
              onClick={() => removeLocation(location)}
              className="hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      
      <AddressAutofill accessToken={mapboxToken}>
        <Input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite cidade e estado (ex: São Paulo, SP)"
          className="w-full"
          autoComplete="address-level2"
          onBlur={(e) => {
            if (e.target.value.trim()) {
              addLocation(e.target.value.trim());
            }
          }}
        />
      </AddressAutofill>
      
      <p className="text-xs text-muted-foreground">
        Digite e pressione Enter ou clique fora para adicionar. Selecione cidades específicas para segmentação precisa.
      </p>
    </div>
  );
};

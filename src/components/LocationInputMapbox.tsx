import { useState } from "react";
import { AddressAutofill, config } from "@mapbox/search-js-react";
import { Badge } from "@/components/ui/badge";
import { X, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";

interface LocationInputMapboxProps {
  value: string[];
  onChange: (locations: string[]) => void;
}

export const LocationInputMapbox = ({ value, onChange }: LocationInputMapboxProps) => {
  const [input, setInput] = useState("");
  const mapboxToken = "pk.eyJ1IjoidWx0cmF3ZWIiLCJhIjoiY21pYWdzZDIwMHk2czJzb2EzaTFrOWs2MCJ9.ccJqTYdM9PwWRRtXjvgccw";

  // Configure Mapbox Search
  if (mapboxToken) {
    config.accessToken = mapboxToken;
  }

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
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 bg-muted/30 rounded-lg border border-border">
          {value.map((location, index) => (
            <Badge
              key={`${location}-${index}`}
              variant="secondary"
              className="px-3 py-2 text-sm flex items-center gap-2 hover:bg-secondary/80 transition-colors"
            >
              <MapPin className="h-3 w-3" />
              {location}
              <button
                onClick={() => removeLocation(location)}
                className="hover:text-destructive transition-colors ml-1"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      
      <div className="relative">
        <AddressAutofill
          accessToken={mapboxToken}
          options={{
            country: 'BR',
            language: 'pt-BR',
          }}
        >
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite cidade e estado (ex: São Paulo, SP)"
            className="w-full pl-10"
            autoComplete="address-level2"
            onBlur={(e) => {
              if (e.target.value.trim()) {
                addLocation(e.target.value.trim());
              }
            }}
          />
        </AddressAutofill>
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary"></span>
        Digite e pressione <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Enter</kbd> para adicionar múltiplas localizações
      </p>
    </div>
  );
};

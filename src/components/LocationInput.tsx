import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

const ESTADOS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

interface LocationInputProps {
  value: string[];
  onChange: (locations: string[]) => void;
}

export const LocationInput = ({ value, onChange }: LocationInputProps) => {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (input.trim()) {
      const searchTerm = input.toUpperCase();
      const filtered = ESTADOS.filter(estado => 
        estado.includes(searchTerm)
      ).slice(0, 5);
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  }, [input]);

  const addLocation = (location: string) => {
    if (location.trim() && !value.includes(location)) {
      onChange([...value, location]);
      setInput("");
      setSuggestions([]);
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
      
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite o estado (ex: SP, RJ) ou cidade, estado (ex: São Paulo, SP)"
          className="w-full"
        />
        
        {suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-md shadow-lg max-h-60 overflow-auto">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => addLocation(suggestion)}
                className="w-full px-4 py-2 text-left hover:bg-accent transition-colors text-sm"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
      
      <p className="text-xs text-muted-foreground">
        Digite e pressione Enter para adicionar. Use vírgula para cidade, estado (ex: São Paulo, SP)
      </p>
    </div>
  );
};

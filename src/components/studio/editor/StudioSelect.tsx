import { useId } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

type Props = {
  label: string;
  accessibleLabel?: string;
  value: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  disabled?: boolean;
  onChange(value: string): void;
};

export function StudioSelect({ label, accessibleLabel, value, options, disabled, onChange }: Props) {
  const labelId = useId();

  return (
    <div className="se-field">
      <span id={labelId}>{label}</span>
      <Select.Root value={`option:${value}`} disabled={disabled} onValueChange={next => onChange(next.slice('option:'.length))}>
        <Select.Trigger className="se-select-trigger" aria-label={accessibleLabel} aria-labelledby={accessibleLabel ? undefined : labelId}>
          <Select.Value />
          <Select.Icon asChild><ChevronDown size={14} aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="se-select-content" position="popper" align="start" sideOffset={5} collisionPadding={12}>
            <Select.Viewport className="se-select-options">
              {options.map(([key, title]) => (
                <Select.Item className="se-select-option" key={key} value={`option:${key}`}>
                  <Select.ItemText>{title}</Select.ItemText>
                  <Select.ItemIndicator><Check size={14} aria-hidden="true" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

import { cn } from "@/lib/utils/cn";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface OptionListProps<T extends string> {
  name: string;
  options: Option<T>[];
  value?: T;
  onChange: (value: T) => void;
  multiple?: false;
}

export function OptionList<T extends string>({ name, options, value, onChange }: OptionListProps<T>) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-col gap-2">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-center rounded-xl border px-4 py-3.5 text-sm font-medium transition-colors",
              selected ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-foreground hover:bg-surface-muted"
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

import { useId, useState } from "react";
import { X } from "lucide-react";

/** Chips for free-form tags; Enter or comma adds a tag. */
export function TagInput({ value, onChange, suggestions = [], placeholder = "Add a tag" }: { value: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; placeholder?: string }) {
  const [text, setText] = useState("");
  const listId = useId();
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
    setText("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 focus-within:border-primary">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-elevated px-1.5 py-0.5 text-xs">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))} className="text-subtle hover:text-text">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v.slice(0, -1));
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(text)}
        placeholder={value.length ? "" : placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent text-sm focus:outline-none"
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

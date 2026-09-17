import { useEffect, useRef, useState } from "react";

interface ThreadFormProps {
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel?: () => void;
}

/** Write a message in a review thread — the opening comment or a reply. */
export function ThreadForm({ placeholder, submitLabel, onSubmit, onCancel }: ThreadFormProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function submit() {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    const result = await onSubmit(body.trim());
    setSending(false);
    if (result.ok) {
      setBody("");
    } else {
      // Keep what they wrote — losing a message to a network error is worse
      // than the error itself.
      setError(result.error ?? "Couldn't send");
    }
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-background border border-border rounded px-2 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent resize-y"
      />
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => void submit()}
          disabled={!body.trim() || sending}
          className="px-2.5 py-1 text-xs rounded bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {sending ? "Sending…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

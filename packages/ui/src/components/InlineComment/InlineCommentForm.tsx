import { useState, useRef, useEffect } from "react";
import type { ReviewComment } from "../../types";

type CommentType = ReviewComment["type"];

const COMMENT_TYPES: { value: CommentType; label: string }[] = [
  { value: "suggestion", label: "Suggestion" },
  { value: "must_fix", label: "Must Fix" },
  { value: "question", label: "Question" },
  { value: "nitpick", label: "Nitpick" },
];

interface InlineCommentFormProps {
  onSave: (body: string, type: CommentType) => void;
  onCancel: () => void;
  initialBody?: string;
  initialType?: CommentType;
}

export function InlineCommentForm({
  onSave,
  onCancel,
  initialBody = "",
  initialType = "suggestion",
}: InlineCommentFormProps) {
  const [body, setBody] = useState(initialBody);
  const [type, setType] = useState<CommentType>(initialType);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (body.trim()) {
        onSave(body.trim(), type);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="p-3 space-y-2" onKeyDown={handleKeyDown}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a comment..."
        rows={3}
        className="w-full bg-background border border-border rounded px-3 py-2 text-text-primary text-sm placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CommentType)}
          className="bg-background border border-border rounded px-2 py-1.5 text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
        >
          {COMMENT_TYPES.map((ct) => (
            <option key={ct.value} value={ct.value}>
              {ct.label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={() => body.trim() && onSave(body.trim(), type)}
          disabled={!body.trim()}
          className="px-3 py-1.5 text-xs font-medium rounded bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Save
        </button>
      </div>
    </div>
  );
}

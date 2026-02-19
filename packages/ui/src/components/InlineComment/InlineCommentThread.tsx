import { useState } from "react";
import { Pencil, Trash2, Plus } from "lucide-react";
import type { ReviewComment } from "../../types";
import { InlineCommentForm } from "./InlineCommentForm";

const TYPE_STYLES: Record<ReviewComment["type"], string> = {
  must_fix: "bg-red-600/20 text-red-400 border-red-500/30",
  suggestion: "bg-yellow-600/20 text-yellow-400 border-yellow-500/30",
  question: "bg-blue-600/20 text-blue-400 border-blue-500/30",
  nitpick: "bg-gray-600/20 text-gray-400 border-gray-500/30",
};

const TYPE_LABELS: Record<ReviewComment["type"], string> = {
  must_fix: "Must Fix",
  suggestion: "Suggestion",
  question: "Question",
  nitpick: "Nitpick",
};

interface InlineCommentThreadProps {
  comments: { comment: ReviewComment; index: number }[];
  isFormOpen: boolean;
  file: string;
  line: number;
  onAdd: (body: string, type: ReviewComment["type"]) => void;
  onUpdate: (index: number, body: string, type: ReviewComment["type"]) => void;
  onDelete: (index: number) => void;
  onOpenForm: () => void;
  onCloseForm: () => void;
}

export function InlineCommentThread({
  comments,
  isFormOpen,
  file,
  line,
  onAdd,
  onUpdate,
  onDelete,
  onOpenForm,
  onCloseForm,
}: InlineCommentThreadProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  return (
    <div className="border-t border-border bg-surface">
      {comments.map(({ comment, index }) => {
        if (editingIndex === index) {
          return (
            <InlineCommentForm
              key={index}
              initialBody={comment.body}
              initialType={comment.type}
              onSave={(body, type) => {
                onUpdate(index, body, type);
                setEditingIndex(null);
              }}
              onCancel={() => setEditingIndex(null)}
            />
          );
        }

        return (
          <div
            key={index}
            className="px-3 py-2 border-b border-border/50 group/comment"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${TYPE_STYLES[comment.type]}`}
              >
                {TYPE_LABELS[comment.type]}
              </span>
              <span className="text-text-secondary text-[10px] font-mono">
                {file}:{line}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => setEditingIndex(index)}
                className="opacity-0 group-hover/comment:opacity-100 p-0.5 text-text-secondary hover:text-text-primary transition-all cursor-pointer"
                title="Edit comment"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => onDelete(index)}
                className="opacity-0 group-hover/comment:opacity-100 p-0.5 text-text-secondary hover:text-red-400 transition-all cursor-pointer"
                title="Delete comment"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <p className="text-text-primary text-sm whitespace-pre-wrap">
              {comment.body}
            </p>
          </div>
        );
      })}

      {isFormOpen && editingIndex === null && (
        <InlineCommentForm
          onSave={(body, type) => {
            onAdd(body, type);
            onCloseForm();
          }}
          onCancel={onCloseForm}
        />
      )}

      {!isFormOpen && comments.length > 0 && editingIndex === null && (
        <button
          onClick={onOpenForm}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-text-secondary hover:text-accent transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          Add comment
        </button>
      )}
    </div>
  );
}

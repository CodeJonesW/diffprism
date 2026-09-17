import { useEffect } from "react";
import { useReviewStore } from "../store/review";

/**
 * Scroll the focused thread into view once it is on screen.
 *
 * Selecting a thread in the annotation panel can switch files, and the thread
 * only exists in the DOM after the new file's diff renders — so this retries
 * on every change to `rendered` and clears the focus once it has scrolled.
 * Clearing is what lets a second click on the same thread scroll again, and
 * what makes a click within the open file work at all: switching files used
 * to be the only thing that moved the view.
 */
export function useFocusedAnnotationScroll(rendered: unknown): void {
  const focusedAnnotationId = useReviewStore((s) => s.focusedAnnotationId);
  const focusAnnotation = useReviewStore((s) => s.focusAnnotation);

  useEffect(() => {
    if (!focusedAnnotationId) return;
    const thread = document.querySelector(`[data-annotation-id="${focusedAnnotationId}"]`);
    if (!thread) return;
    thread.scrollIntoView({ behavior: "smooth", block: "center" });
    focusAnnotation(null);
  }, [focusedAnnotationId, focusAnnotation, rendered]);
}

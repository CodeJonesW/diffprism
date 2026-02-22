import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useReviewStore } from "./store/review";
import { ReviewView } from "./components/ReviewView";
import type { ReviewResult } from "./types";

export default function App() {
  const { sendResult, connectionStatus } = useWebSocket();
  const { diffSet, metadata, theme, isWatchMode, watchSubmitted, hasUnreviewedChanges, setWatchSubmitted } =
    useReviewStore();
  const [submitted, setSubmitted] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Sync dark class on <html> with store theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  function handleSubmit(result: ReviewResult) {
    sendResult(result);
    if (isWatchMode) {
      setWatchSubmitted(true);
    } else {
      setSubmitted(true);
    }
  }

  const closeWindow = useCallback(() => {
    window.close();
  }, []);

  // Countdown timer for non-watch mode
  useEffect(() => {
    if (!submitted || isWatchMode) return;

    if (countdown <= 0) {
      closeWindow();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [submitted, countdown, closeWindow, isWatchMode]);

  // Non-watch mode: submitted confirmation with countdown
  if (submitted) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-600/20 border border-green-300 dark:border-green-500/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-700 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-text-primary text-xl font-semibold mb-2">
            Review Submitted
          </h1>
          <p className="text-text-secondary text-sm">
            Closing in {countdown}s...
          </p>
        </div>
      </div>
    );
  }

  // Loading / connecting state
  if (!diffSet) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          {connectionStatus === "disconnected" ? (
            <>
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-600/20 border border-red-300 dark:border-red-500/30 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-red-700 dark:text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h1 className="text-text-primary text-lg font-semibold mb-2">
                Connection Lost
              </h1>
              <p className="text-text-secondary text-sm">
                Unable to connect to the DiffPrism server. Please check the
                terminal and try again.
              </p>
            </>
          ) : (
            <>
              <div className="mb-4 flex justify-center">
                <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              </div>
              <h1 className="text-text-primary text-lg font-semibold mb-2">
                {connectionStatus === "connecting"
                  ? "Connecting..."
                  : "Waiting for review data..."}
              </h1>
              <p className="text-text-secondary text-sm">
                {metadata?.title ?? "Loading review..."}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {isWatchMode && (
        <div className="fixed top-2 right-3 z-50 flex items-center gap-1.5 bg-surface/80 backdrop-blur-sm border border-border rounded-full px-2.5 py-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-xs text-text-secondary">Watching</span>
        </div>
      )}
      <ReviewView
        onSubmit={handleSubmit}
        isWatchMode={isWatchMode}
        watchSubmitted={watchSubmitted}
        hasUnreviewedChanges={hasUnreviewedChanges}
      />
    </div>
  );
}

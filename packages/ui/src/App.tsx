import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useNotifications } from "./hooks/useNotifications";
import { useReviewStore } from "./store/review";
import { ReviewView } from "./components/ReviewView";
import { SessionList } from "./components/SessionList";
import type { ReviewResult } from "./types";

export default function App() {
  const { permission: notificationPermission, enabled: notificationsEnabled, toggle: toggleNotifications, notifyNewSession, notifySessionUpdated, notifyDiffUpdated, notifyAnnotationAdded } = useNotifications({ onSessionSelect: handleSelectSession });
  const { sendResult, selectSession: wsSelectSession, closeSession: wsCloseSession, connectionStatus } = useWebSocket({ onSessionAdded: notifyNewSession, onSessionUpdated: notifySessionUpdated, onDiffUpdated: notifyDiffUpdated, onAnnotationAdded: notifyAnnotationAdded });
  const {
    diffSet,
    metadata,
    theme,
    isWatchMode,
    watchSubmitted,
    hasUnreviewedChanges,
    setWatchSubmitted,
    isServerMode,
    sessions,
    activeSessionId,
    selectSession,
    removeSession,
    clearReview,
  } = useReviewStore();
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
    if (isServerMode) {
      clearReview();
    } else if (isWatchMode) {
      setWatchSubmitted(true);
    } else {
      setSubmitted(true);
    }
  }

  function handleDismiss() {
    sendResult({ decision: "dismissed", comments: [] });
    if (isServerMode && activeSessionId) {
      removeSession(activeSessionId);
      wsCloseSession(activeSessionId);
    } else if (isWatchMode) {
      setWatchSubmitted(true);
    } else {
      setSubmitted(true);
    }
  }

  function handleSelectSession(sessionId: string) {
    selectSession(sessionId);
    wsSelectSession(sessionId);
  }

  function handleCloseSession(sessionId: string) {
    removeSession(sessionId);
    wsCloseSession(sessionId);
  }

  const closeWindow = useCallback(() => {
    window.close();
  }, []);

  // Countdown timer for non-watch mode
  useEffect(() => {
    if (!submitted || isWatchMode || isServerMode) return;

    if (countdown <= 0) {
      closeWindow();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [submitted, countdown, closeWindow, isWatchMode, isServerMode]);

  // Non-watch mode: submitted confirmation with countdown
  if (submitted) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-success/15 border border-success/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-success"
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

  // Server mode: show session list when no active review
  if (isServerMode && !diffSet) {
    if (connectionStatus === "disconnected") {
      return (
        <div className="h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-danger/15 border border-danger/30 flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-danger"
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
              Unable to connect to the DiffPrism server.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="h-screen bg-background">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelectSession}
          onClose={handleCloseSession}
          notificationPermission={notificationPermission}
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={toggleNotifications}
        />
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
              <div className="w-12 h-12 rounded-full bg-danger/15 border border-danger/30 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-danger"
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
    <ReviewView
      onSubmit={handleSubmit}
      onDismiss={handleDismiss}
      isWatchMode={isWatchMode || isServerMode}
      watchSubmitted={watchSubmitted}
      hasUnreviewedChanges={hasUnreviewedChanges}
    />
  );
}

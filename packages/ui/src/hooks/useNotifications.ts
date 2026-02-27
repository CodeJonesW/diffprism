import { useState, useEffect, useRef, useCallback } from "react";
import type { SessionSummary, Annotation } from "../types.js";

export type NotificationPermission = "default" | "granted" | "denied";

const STORAGE_KEY = "diffprism-notifications";

function getStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "disabled";
  } catch {
    return true;
  }
}

function setStoredPreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "enabled" : "disabled");
  } catch {
    // localStorage unavailable
  }
}

interface UseNotificationsOptions {
  onSessionSelect?: (sessionId: string) => void;
}

interface UseNotificationsReturn {
  permission: NotificationPermission;
  enabled: boolean;
  toggle: () => void;
  notifyNewSession: (session: SessionSummary) => void;
  notifySessionUpdated: (session: SessionSummary) => void;
  notifyDiffUpdated: (fileCount: number) => void;
  notifyAnnotationAdded: (annotation: Annotation) => void;
}

export function useNotifications(options?: UseNotificationsOptions): UseNotificationsReturn {
  const onSessionSelectRef = useRef(options?.onSessionSelect);
  useEffect(() => {
    onSessionSelectRef.current = options?.onSessionSelect;
  }, [options?.onSessionSelect]);

  const hasNotificationApi = typeof globalThis.Notification !== "undefined";

  const [permission, setPermission] = useState<NotificationPermission>(() =>
    hasNotificationApi ? (Notification.permission as NotificationPermission) : "denied",
  );
  const [enabled, setEnabled] = useState(getStoredPreference);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!hasNotificationApi) return "denied";
    const result = await Notification.requestPermission();
    const perm = result as NotificationPermission;
    setPermission(perm);
    return perm;
  }, [hasNotificationApi]);

  const toggle = useCallback(async () => {
    if (!hasNotificationApi) return;

    if (permission === "denied") return;

    if (permission === "default") {
      const result = await requestPermission();
      if (result === "granted") {
        setEnabled(true);
        setStoredPreference(true);
      }
      return;
    }

    // permission === "granted" — toggle preference
    const next = !enabled;
    setEnabled(next);
    setStoredPreference(next);
  }, [hasNotificationApi, permission, enabled, requestPermission]);

  const sendNotification = useCallback(
    async (title: string, body: string, tag?: string, onClick?: () => void) => {
      if (!hasNotificationApi) return;
      if (document.visibilityState !== "hidden") return;
      if (!enabled) return;

      let currentPermission = permission;
      if (currentPermission === "default") {
        currentPermission = await requestPermission();
      }
      if (currentPermission !== "granted") return;

      const notification = new Notification(title, {
        body,
        icon: "/favicon.svg",
        tag,
      });

      notification.onclick = () => {
        window.focus();
        onClick?.();
        notification.close();
      };
    },
    [hasNotificationApi, enabled, permission, requestPermission],
  );

  const notifyNewSession = useCallback(
    async (session: SessionSummary) => {
      const title = session.title || "New Review Ready";
      const parts: string[] = [];
      if (session.branch) parts.push(session.branch);
      parts.push(
        `${session.fileCount} file${session.fileCount !== 1 ? "s" : ""}, +${session.additions} -${session.deletions}`,
      );

      await sendNotification(title, parts.join(" · "), session.id, () => {
        onSessionSelectRef.current?.(session.id);
      });
    },
    [sendNotification],
  );

  const notifySessionUpdated = useCallback(
    async (session: SessionSummary) => {
      if (session.status !== "submitted") return;

      await sendNotification(
        "Review Submitted",
        session.title || `${session.fileCount} files reviewed`,
        `submitted-${session.id}`,
        () => { onSessionSelectRef.current?.(session.id); },
      );
    },
    [sendNotification],
  );

  const notifyDiffUpdated = useCallback(
    async (fileCount: number) => {
      await sendNotification(
        "Diff Updated",
        `${fileCount} file${fileCount !== 1 ? "s" : ""} changed`,
        "diff-update",
      );
    },
    [sendNotification],
  );

  const notifyAnnotationAdded = useCallback(
    async (annotation: Annotation) => {
      await sendNotification(
        `Annotation from ${annotation.source.agent}`,
        `${annotation.file}:${annotation.line} — ${annotation.body.slice(0, 100)}`,
        `annotation-${annotation.id}`,
      );
    },
    [sendNotification],
  );

  return { permission, enabled, toggle, notifyNewSession, notifySessionUpdated, notifyDiffUpdated, notifyAnnotationAdded };
}

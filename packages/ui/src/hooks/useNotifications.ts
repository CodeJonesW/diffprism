import { useState, useEffect, useRef, useCallback } from "react";
import type { SessionSummary } from "../types.js";

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

  const notifyNewSession = useCallback(
    async (session: SessionSummary) => {
      if (!hasNotificationApi) return;
      if (document.visibilityState !== "hidden") return;
      if (!enabled) return;

      let currentPermission = permission;
      if (currentPermission === "default") {
        currentPermission = await requestPermission();
      }
      if (currentPermission !== "granted") return;

      const title = session.title || "New Review Ready";
      const parts: string[] = [];
      if (session.branch) parts.push(session.branch);
      parts.push(
        `${session.fileCount} file${session.fileCount !== 1 ? "s" : ""}, +${session.additions} -${session.deletions}`,
      );
      const body = parts.join(" · ");

      const notification = new Notification(title, {
        body,
        icon: "/favicon.svg",
        tag: session.id,
      });

      notification.onclick = () => {
        window.focus();
        onSessionSelectRef.current?.(session.id);
        notification.close();
      };
    },
    [hasNotificationApi, enabled, permission, requestPermission],
  );

  return { permission, enabled, toggle, notifyNewSession };
}

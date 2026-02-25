import { Bell, BellOff } from "lucide-react";
import type { NotificationPermission } from "../../hooks/useNotifications.js";

interface NotificationToggleProps {
  permission: NotificationPermission;
  enabled: boolean;
  onToggle: () => void;
}

export function NotificationToggle({ permission, enabled, onToggle }: NotificationToggleProps) {
  const isDenied = permission === "denied";
  const isActive = permission === "granted" && enabled;

  const title = isDenied
    ? "Notifications blocked by browser"
    : isActive
      ? "Notifications on"
      : "Enable notifications";

  return (
    <button
      onClick={onToggle}
      disabled={isDenied}
      className={`p-1.5 rounded transition-colors cursor-pointer ${
        isDenied
          ? "text-text-secondary/50 cursor-not-allowed"
          : isActive
            ? "text-accent hover:text-accent/80"
            : "text-text-secondary hover:text-text-primary"
      }`}
      title={title}
    >
      {isActive ? (
        <Bell className="w-4 h-4" />
      ) : (
        <BellOff className="w-4 h-4" />
      )}
    </button>
  );
}

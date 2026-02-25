// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../hooks/useNotifications.js";
import type { SessionSummary } from "../types.js";

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-abc",
    projectPath: "/test/project",
    branch: "feature-branch",
    title: "Test review",
    fileCount: 3,
    additions: 10,
    deletions: 5,
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

// Store created Notification instances for inspection
let notificationInstances: Array<{
  title: string;
  options: NotificationOptions;
  onclick: ((this: Notification, ev: Event) => unknown) | null;
  close: ReturnType<typeof vi.fn>;
}>;

function setupNotificationMock(permission: NotificationPermission = "default") {
  notificationInstances = [];

  const MockNotification = vi.fn((title: string, options: NotificationOptions) => {
    const instance = {
      title,
      options,
      onclick: null as ((this: Notification, ev: Event) => unknown) | null,
      close: vi.fn(),
    };
    notificationInstances.push(instance);
    return instance;
  }) as unknown as typeof Notification;

  Object.defineProperty(MockNotification, "permission", {
    get: () => permission,
    configurable: true,
  });

  MockNotification.requestPermission = vi.fn(async () => {
    permission = "granted";
    Object.defineProperty(MockNotification, "permission", {
      get: () => permission,
      configurable: true,
    });
    return "granted" as NotificationPermission;
  });

  Object.defineProperty(globalThis, "Notification", {
    value: MockNotification,
    writable: true,
    configurable: true,
  });

  return MockNotification;
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
}

describe("useNotifications", () => {
  beforeEach(() => {
    localStorage.clear();
    notificationInstances = [];
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("feature detection", () => {
    it("returns denied permission and no-op functions when Notification API is unavailable", () => {
      // Remove Notification from globalThis
      const original = globalThis.Notification;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).Notification;

      const { result } = renderHook(() => useNotifications());

      expect(result.current.permission).toBe("denied");
      expect(result.current.enabled).toBe(true); // preference is still read from localStorage

      // Should not throw
      act(() => {
        result.current.notifyNewSession(makeSession());
      });

      // Restore
      globalThis.Notification = original;
    });
  });

  describe("tab focused", () => {
    it("does not show notification when tab is visible", async () => {
      setupNotificationMock("granted");
      setVisibilityState("visible");

      const { result } = renderHook(() => useNotifications());

      await act(async () => {
        result.current.notifyNewSession(makeSession());
      });

      expect(notificationInstances).toHaveLength(0);
    });
  });

  describe("tab hidden + granted", () => {
    it("creates notification with correct content", async () => {
      setupNotificationMock("granted");
      setVisibilityState("hidden");

      const { result } = renderHook(() => useNotifications());

      await act(async () => {
        result.current.notifyNewSession(makeSession());
      });

      expect(notificationInstances).toHaveLength(1);
      expect(notificationInstances[0].title).toBe("Test review");
      expect(notificationInstances[0].options.body).toBe(
        "feature-branch · 3 files, +10 -5",
      );
      expect(notificationInstances[0].options.icon).toBe("/favicon.svg");
      expect(notificationInstances[0].options.tag).toBe("session-abc");
    });

    it("uses fallback title when session has no title", async () => {
      setupNotificationMock("granted");
      setVisibilityState("hidden");

      const { result } = renderHook(() => useNotifications());

      await act(async () => {
        result.current.notifyNewSession(makeSession({ title: undefined }));
      });

      expect(notificationInstances).toHaveLength(1);
      expect(notificationInstances[0].title).toBe("New Review Ready");
    });

    it("handles session without branch", async () => {
      setupNotificationMock("granted");
      setVisibilityState("hidden");

      const { result } = renderHook(() => useNotifications());

      await act(async () => {
        result.current.notifyNewSession(makeSession({ branch: undefined }));
      });

      expect(notificationInstances).toHaveLength(1);
      expect(notificationInstances[0].options.body).toBe("3 files, +10 -5");
    });
  });

  describe("permission denied", () => {
    it("does not create notification", async () => {
      setupNotificationMock("denied");
      setVisibilityState("hidden");

      const { result } = renderHook(() => useNotifications());

      await act(async () => {
        result.current.notifyNewSession(makeSession());
      });

      expect(notificationInstances).toHaveLength(0);
    });
  });

  describe("permission default", () => {
    it("auto-requests permission and notifies if granted", async () => {
      const mock = setupNotificationMock("default");
      setVisibilityState("hidden");

      const { result } = renderHook(() => useNotifications());

      expect(result.current.permission).toBe("default");

      await act(async () => {
        result.current.notifyNewSession(makeSession());
      });

      expect(mock.requestPermission).toHaveBeenCalled();
      expect(notificationInstances).toHaveLength(1);
    });

    it("does not notify if permission request is denied", async () => {
      const mock = setupNotificationMock("default");
      // Override requestPermission to deny
      mock.requestPermission = vi.fn(async () => {
        Object.defineProperty(mock, "permission", {
          get: () => "denied" as NotificationPermission,
          configurable: true,
        });
        return "denied" as NotificationPermission;
      });
      setVisibilityState("hidden");

      const { result } = renderHook(() => useNotifications());

      await act(async () => {
        result.current.notifyNewSession(makeSession());
      });

      expect(mock.requestPermission).toHaveBeenCalled();
      expect(notificationInstances).toHaveLength(0);
    });
  });

  describe("localStorage preference", () => {
    it("suppresses notification when disabled even if granted", async () => {
      setupNotificationMock("granted");
      setVisibilityState("hidden");
      localStorage.setItem("diffprism-notifications", "disabled");

      const { result } = renderHook(() => useNotifications());

      expect(result.current.enabled).toBe(false);

      await act(async () => {
        result.current.notifyNewSession(makeSession());
      });

      expect(notificationInstances).toHaveLength(0);
    });

    it("toggle flips from enabled to disabled", () => {
      setupNotificationMock("granted");

      const { result } = renderHook(() => useNotifications());

      expect(result.current.enabled).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.enabled).toBe(false);
      expect(localStorage.getItem("diffprism-notifications")).toBe("disabled");
    });

    it("toggle flips from disabled to enabled", () => {
      setupNotificationMock("granted");
      localStorage.setItem("diffprism-notifications", "disabled");

      const { result } = renderHook(() => useNotifications());

      expect(result.current.enabled).toBe(false);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.enabled).toBe(true);
      expect(localStorage.getItem("diffprism-notifications")).toBe("enabled");
    });
  });

  describe("notification click", () => {
    it("calls window.focus, onSessionSelect, and closes notification", async () => {
      setupNotificationMock("granted");
      setVisibilityState("hidden");

      const onSessionSelect = vi.fn();
      const focusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});

      const { result } = renderHook(() =>
        useNotifications({ onSessionSelect }),
      );

      await act(async () => {
        result.current.notifyNewSession(makeSession({ id: "click-test" }));
      });

      expect(notificationInstances).toHaveLength(1);

      // Simulate click
      const instance = notificationInstances[0];
      expect(instance.onclick).toBeTypeOf("function");
      instance.onclick!.call(null as unknown as Notification, new Event("click"));

      expect(focusSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(onSessionSelect).toHaveBeenCalledWith("click-test");
      expect(instance.close).toHaveBeenCalled();
    });
  });
});

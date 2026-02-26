import { useCallback, useMemo } from "react";
import type { GitRefsPayload } from "../types";

export function useHttpApi() {
  const httpPort = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("httpPort");
  }, []);

  const isAvailable = httpPort !== null;

  const fetchRefs = useCallback(
    async (sessionId: string): Promise<GitRefsPayload | null> => {
      if (!httpPort) return null;
      try {
        const response = await fetch(
          `http://localhost:${httpPort}/api/reviews/${sessionId}/refs`,
        );
        if (!response.ok) return null;
        return (await response.json()) as GitRefsPayload;
      } catch {
        return null;
      }
    },
    [httpPort],
  );

  const compareAgainst = useCallback(
    async (sessionId: string, ref: string): Promise<boolean> => {
      if (!httpPort) return false;
      try {
        const response = await fetch(
          `http://localhost:${httpPort}/api/reviews/${sessionId}/compare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ref }),
          },
        );
        return response.ok;
      } catch {
        return false;
      }
    },
    [httpPort],
  );

  return { isAvailable, fetchRefs, compareAgainst };
}

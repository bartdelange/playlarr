"use client";

import { useEffect, useState } from "react";

export function TidalAuthStatus({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState("Waiting for approval…");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch("/api/settings/auth/tidal", {
          cache: "no-store",
        });
        const result = (await response.json()) as {
          status?: string;
          error?: string;
        };
        if (!active) return;
        if (result.status === "completed") {
          window.location.assign(
            "/settings?message=TIDAL%20connection%20successful",
          );
          return;
        }
        if (result.status === "failed" || result.status === "missing") {
          setStatus(result.error || "Authentication failed; try again.");
          return;
        }
      } catch {
        if (active) setStatus("Could not check TIDAL authentication status.");
        return;
      }
      timeout = setTimeout(poll, 1000);
    };

    void poll();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [enabled]);

  return <p aria-live="polite">{status}</p>;
}

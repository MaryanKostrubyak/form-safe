import type { Settings } from "../../types";

export const ALL_SITES_PATTERN = "*://*/*";

interface PermissionRequest {
  origins: string[];
}

export interface HostPermissionApi {
  contains(permissions: PermissionRequest): Promise<boolean>;
  request(permissions: PermissionRequest): Promise<boolean>;
}

export type HostAccessResult =
  | { granted: true; reason: "already-granted" | "granted" }
  | { granted: false; reason: "denied" }
  | { granted: false; reason: "error"; error: string };

export function hostPatternsForMode(
  mode: Settings["hostAccessMode"],
  origin: string,
): string[] {
  if (mode === "all") return [ALL_SITES_PATTERN];
  const pattern = toHostPattern(origin);
  return pattern ? [pattern] : [];
}

export async function ensureHostAccess(
  permissions: HostPermissionApi,
  origins: string[],
): Promise<HostAccessResult> {
  if (origins.length === 0) return { granted: false, reason: "denied" };

  const request = { origins };
  try {
    if (await permissions.contains(request)) {
      return { granted: true, reason: "already-granted" };
    }

    const accepted = await permissions.request(request);
    if (accepted || (await permissions.contains(request))) {
      return { granted: true, reason: "granted" };
    }
    return { granted: false, reason: "denied" };
  } catch (error) {
    return {
      granted: false,
      reason: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function toHostPattern(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

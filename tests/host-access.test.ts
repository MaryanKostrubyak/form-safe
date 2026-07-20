import { describe, expect, it, vi } from "vitest";
import {
  ALL_SITES_PATTERN,
  ensureHostAccess,
  hostPatternsForMode,
} from "../src/lib/v2/host-access";

describe("host access onboarding", () => {
  it("uses one Chrome match pattern for all HTTP and HTTPS sites", () => {
    expect(hostPatternsForMode("all", "")).toEqual([ALL_SITES_PATTERN]);
    expect(ALL_SITES_PATTERN).toBe("*://*/*");
  });

  it("limits selected access to a valid HTTP or HTTPS hostname", () => {
    expect(hostPatternsForMode("selected", "https://example.com:8443/form")).toEqual([
      "https://example.com/*",
    ]);
    expect(hostPatternsForMode("selected", "chrome://settings")).toEqual([]);
    expect(hostPatternsForMode("selected", "not a url")).toEqual([]);
  });

  it("does not call Chrome for an empty origin selection", async () => {
    const permissions = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(false),
    };

    await expect(ensureHostAccess(permissions, [])).resolves.toEqual({
      granted: false,
      reason: "denied",
    });
    expect(permissions.contains).not.toHaveBeenCalled();
  });

  it("accepts access Chrome already granted without opening another prompt", async () => {
    const permissions = {
      contains: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue(false),
    };

    await expect(ensureHostAccess(permissions, [ALL_SITES_PATTERN])).resolves.toEqual({
      granted: true,
      reason: "already-granted",
    });
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it("rechecks permissions after Chrome closes the prompt", async () => {
    const permissions = {
      contains: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      request: vi.fn().mockResolvedValue(false),
    };

    await expect(ensureHostAccess(permissions, [ALL_SITES_PATTERN])).resolves.toEqual({
      granted: true,
      reason: "granted",
    });
  });

  it("accepts Chrome's direct confirmation without an extra contains call", async () => {
    const permissions = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(true),
    };

    await expect(ensureHostAccess(permissions, [ALL_SITES_PATTERN])).resolves.toEqual({
      granted: true,
      reason: "granted",
    });
    expect(permissions.contains).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a remembered denial from an API error", async () => {
    const denied = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(false),
    };
    const failed = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockRejectedValue(new Error("User gesture required")),
    };
    const unexpectedFailure = {
      contains: vi.fn().mockRejectedValue("Permission API unavailable"),
      request: vi.fn().mockResolvedValue(false),
    };

    await expect(ensureHostAccess(denied, [ALL_SITES_PATTERN])).resolves.toEqual({
      granted: false,
      reason: "denied",
    });
    await expect(ensureHostAccess(failed, [ALL_SITES_PATTERN])).resolves.toEqual({
      granted: false,
      reason: "error",
      error: "User gesture required",
    });
    await expect(
      ensureHostAccess(unexpectedFailure, [ALL_SITES_PATTERN]),
    ).resolves.toEqual({
      granted: false,
      reason: "error",
      error: "Permission API unavailable",
    });
  });
});

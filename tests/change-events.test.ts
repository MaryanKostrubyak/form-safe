import { describe, expect, it } from "vitest";
import { shouldReloadContentSettings } from "../src/lib/v2/change-events";

describe("live data-change events", () => {
  it("does not rebuild content-script tracking after a session write", () => {
    expect(shouldReloadContentSettings("sessions")).toBe(false);
  });

  it.each(["settings", "access"] as const)(
    "reloads content settings after a %s change",
    (scope) => expect(shouldReloadContentSettings(scope)).toBe(true),
  );

  it("reloads legacy unscoped events for backward compatibility", () => {
    expect(shouldReloadContentSettings(undefined)).toBe(true);
  });
});

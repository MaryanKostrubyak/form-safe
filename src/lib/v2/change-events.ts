export type DataChangeScope =
  | "sessions"
  | "settings"
  | "security"
  | "access";

export function shouldReloadContentSettings(
  scope: DataChangeScope | undefined,
): boolean {
  return scope === undefined || scope === "settings" || scope === "access";
}

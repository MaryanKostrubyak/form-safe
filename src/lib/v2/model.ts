import type {
  Draft,
  DraftVersion,
  FieldSnapshot,
  FormDraftSession,
  SessionCapture,
  VersionReason,
} from '../../types';

export const MAX_SESSION_VERSIONS = 10;
export const DEFAULT_MAX_SESSIONS = 2_000;
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export function createSessionFromCapture(capture: SessionCapture, now: number): FormDraftSession {
  const session: FormDraftSession = {
    ...capture,
    schemaVersion: 2,
    fields: cloneFields(capture.fields),
    versions: [],
    createdAt: now,
    updatedAt: now,
    lastSavedAt: now,
    restoreCount: 0,
    status: 'active',
    isFavorite: false,
    approximateBytes: 0,
  };
  session.approximateBytes = estimateSessionBytes(session);
  return session;
}

interface SnapshotOptions {
  now: number;
  reason: 'autosave' | VersionReason;
}

export function migrateLegacyDrafts(drafts: Draft[]): FormDraftSession[] {
  const groups = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const key = [draft.origin, draft.pathname, draft.selectorInfo.formSignature].join('|');
    const group = groups.get(key) ?? [];
    group.push(draft);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort((a, b) => a.updatedAt - b.updatedAt);
    const fields = ordered.map(legacyFieldToSnapshot);
    const createdAt = Math.min(...ordered.map((draft) => draft.createdAt));
    const updatedAt = Math.max(...ordered.map((draft) => draft.updatedAt));
    const first = ordered[0]!;
    const session: FormDraftSession = {
      id: `session_${hashString(key)}`,
      schemaVersion: 2,
      origin: first.origin,
      url: ordered.at(-1)?.url ?? first.url,
      pathname: first.pathname,
      pageTitle: ordered.at(-1)?.pageTitle ?? first.pageTitle,
      formSignature: first.selectorInfo.formSignature,
      frameUrl: ordered.at(-1)?.url ?? first.url,
      fields,
      versions: [createVersion(fields, updatedAt, 'migration')],
      createdAt,
      updatedAt,
      lastSavedAt: Math.max(...ordered.map((draft) => draft.lastSavedAt)),
      restoreCount: ordered.reduce((total, draft) => total + draft.restoreCount, 0),
      status: ordered.every((draft) => draft.isArchived) ? 'archived' : 'active',
      isFavorite: ordered.some((draft) => draft.isFavorite),
      approximateBytes: 0,
    };
    session.approximateBytes = estimateSessionBytes(session);
    return session;
  });
}

export function applySessionSnapshot(
  session: FormDraftSession,
  fields: FieldSnapshot[],
  options: SnapshotOptions,
): FormDraftSession {
  const nextFields = cloneFields(fields);
  let versions = [...session.versions];
  const nextById = new Map(nextFields.map((field) => [field.id, field]));
  const clearedMeaningfulField = session.fields.some((field) => {
    const nextField = nextById.get(field.id);
    return hasFieldContent(field) && nextField !== undefined && !hasFieldContent(nextField);
  });
  const checkpointReason = options.reason === 'autosave'
    ? clearedMeaningfulField
      ? 'clear'
      : undefined
    : options.reason;

  if (checkpointReason === 'clear') {
    versions = appendVersion(versions, createVersion(session.fields, options.now, checkpointReason));
  } else if (checkpointReason) {
    versions = appendVersion(versions, createVersion(nextFields, options.now, checkpointReason));
  }

  const next: FormDraftSession = {
    ...session,
    fields: nextFields,
    updatedAt: options.now,
    lastSavedAt: options.now,
    status: session.status === 'submit-pending' && options.reason !== 'submit' ? 'active' : session.status,
  };
  if (options.reason === 'submit') {
    next.status = 'submit-pending';
    next.pendingSubmitAt = options.now;
  }
  next.versions = versions;
  next.approximateBytes = estimateSessionBytes(next);
  return next;
}

export function markSessionCompleted(session: FormDraftSession, now = Date.now()): FormDraftSession {
  const next = { ...session, status: 'completed' as const, completedAt: now, updatedAt: now };
  next.approximateBytes = estimateSessionBytes(next);
  return next;
}

export function pruneSessions(
  sessions: FormDraftSession[],
  limits: { maxSessions?: number; maxBytes?: number } = {},
): { kept: FormDraftSession[]; removed: FormDraftSession[] } {
  const maxSessions = limits.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const kept = [...sessions];
  const removed: FormDraftSession[] = [];
  const removable = kept
    .filter((session) => !session.isFavorite)
    .sort((a, b) => removalPriority(a) - removalPriority(b) || a.updatedAt - b.updatedAt);

  const totalBytes = () => kept.reduce((total, session) => total + session.approximateBytes, 0);
  while ((kept.length > maxSessions || totalBytes() > maxBytes) && removable.length > 0) {
    const candidate = removable.shift();
    if (!candidate) break;
    const index = kept.findIndex((session) => session.id === candidate.id);
    if (index >= 0) {
      removed.push(...kept.splice(index, 1));
    }
  }
  return { kept, removed };
}

export function estimateSessionBytes(session: FormDraftSession): number {
  return new TextEncoder().encode(JSON.stringify(session)).byteLength;
}

export function fieldHasContent(field: FieldSnapshot): boolean {
  return hasFieldContent(field);
}

function legacyFieldToSnapshot(draft: Draft): FieldSnapshot {
  return {
    id: `field_${hashString(draft.selectorInfo.fieldSignature || draft.id)}`,
    label: draft.fieldLabel,
    type: draft.fieldType,
    value: draft.value,
    selectorInfo: { ...draft.selectorInfo },
  };
}

function createVersion(fields: FieldSnapshot[], createdAt: number, reason: VersionReason): DraftVersion {
  return {
    id: `version_${createdAt}_${hashString(snapshotFingerprint(fields))}`,
    createdAt,
    reason,
    fields: cloneFields(fields),
  };
}

function appendVersion(versions: DraftVersion[], version: DraftVersion): DraftVersion[] {
  const last = versions.at(-1);
  if (last && snapshotFingerprint(last.fields) === snapshotFingerprint(version.fields)) return versions;
  return [...versions, version].slice(-MAX_SESSION_VERSIONS);
}

function cloneFields(fields: FieldSnapshot[]): FieldSnapshot[] {
  return fields.map((field) => ({
    ...field,
    value: Array.isArray(field.value) ? [...field.value] : field.value,
    selectorInfo: { ...field.selectorInfo },
  }));
}

function snapshotFingerprint(fields: FieldSnapshot[]): string {
  return JSON.stringify(fields.map((field) => [field.id, field.value]));
}

function hasFieldContent(field: FieldSnapshot): boolean {
  if (typeof field.value === 'boolean') return field.value;
  if (Array.isArray(field.value)) return field.value.length > 0;
  return field.value.trim().length > 0;
}

function removalPriority(session: FormDraftSession): number {
  if (session.status === 'archived') return 0;
  if (session.status === 'completed') return 1;
  if (session.status === 'submit-pending') return 2;
  return 3;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

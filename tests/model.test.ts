import { describe, expect, it } from 'vitest';
import type { Draft, FormDraftSession } from '../src/types';
import {
  applySessionSnapshot,
  migrateLegacyDrafts,
  pruneSessions,
} from '../src/lib/v2/model';

const now = 1_700_000_000_000;

function legacyDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'legacy-1',
    origin: 'https://example.com',
    url: 'https://example.com/form',
    pathname: '/form',
    pageTitle: 'Application',
    fieldLabel: 'About you',
    fieldType: 'textarea',
    selectorInfo: {
      selector: 'textarea[name="about"]',
      fallbackSelector: 'form > textarea',
      formSignature: 'id:application',
      fieldSignature: 'textarea|name:about',
      fieldName: 'about',
    },
    value: 'A useful saved answer',
    createdAt: now - 1_000,
    updatedAt: now,
    lastSavedAt: now,
    restoreCount: 0,
    isArchived: false,
    isFavorite: false,
    ...overrides,
  };
}

describe('v1 migration', () => {
  it('groups fields from the same form into one session and preserves metadata', () => {
    const sessions = migrateLegacyDrafts([
      legacyDraft(),
      legacyDraft({
        id: 'legacy-2',
        fieldLabel: 'Role',
        fieldType: 'text',
        value: 'Engineer',
        isFavorite: true,
        selectorInfo: {
          selector: 'input[name="role"]',
          fallbackSelector: 'form > input',
          formSignature: 'id:application',
          fieldSignature: 'input|name:role',
          fieldName: 'role',
        },
      }),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.fields).toHaveLength(2);
    expect(sessions[0]!.isFavorite).toBe(true);
    expect(sessions[0]!.versions[0]!.reason).toBe('migration');
  });
});

describe('session history', () => {
  it('keeps the last good value when a field is accidentally cleared', () => {
    const session = migrateLegacyDrafts([legacyDraft()])[0]!;
    const result = applySessionSnapshot(
      session,
      [{ ...session.fields[0]!, value: '' }],
      { now: now + 2_000, reason: 'autosave' },
    );

    expect(result.fields[0]!.value).toBe('');
    expect(result.versions.at(-1)?.fields[0]!.value).toBe('A useful saved answer');
  });

  it('checkpoints one cleared field even when another field still has content', () => {
    const migrated = migrateLegacyDrafts([
      legacyDraft(),
      legacyDraft({
        id: 'legacy-2',
        fieldLabel: 'Role',
        value: 'Engineer',
        selectorInfo: { selector: '#role', fallbackSelector: '#role', formSignature: 'id:application', fieldSignature: 'role' },
      }),
    ])[0]!;
    const session = { ...migrated, versions: [] };
    const fields = session.fields.map((field, index) => index === 0 ? { ...field, value: '' } : field);
    const result = applySessionSnapshot(session, fields, { now: now + 2_000, reason: 'autosave' });
    expect(result.versions.at(-1)?.reason).toBe('clear');
    expect(result.versions.at(-1)?.fields[0]!.value).toBe('A useful saved answer');
  });

  it('deduplicates versions and caps meaningful history at ten', () => {
    let session = migrateLegacyDrafts([legacyDraft()])[0]!;
    for (let index = 0; index < 15; index += 1) {
      session = applySessionSnapshot(
        session,
        [{ ...session.fields[0]!, value: `Version ${index} with meaningful content` }],
        { now: now + (index + 1) * 600_000, reason: 'idle' },
      );
    }
    expect(session.versions).toHaveLength(10);
  });
});

describe('storage pruning', () => {
  it('removes old completed sessions before active sessions and never removes favorites', () => {
    const makeSession = (id: string, status: FormDraftSession['status'], favorite = false): FormDraftSession => ({
      ...migrateLegacyDrafts([legacyDraft({ id, updatedAt: now - Number(id) * 1000 })])[0]!,
      id,
      status,
      isFavorite: favorite,
      approximateBytes: 30,
    });
    const result = pruneSessions([
      makeSession('1', 'active'),
      makeSession('2', 'completed'),
      makeSession('3', 'archived'),
      makeSession('4', 'archived', true),
    ], { maxSessions: 2, maxBytes: 10_000 });

    expect(result.kept.map((session) => session.id).sort()).toEqual(['1', '4']);
    expect(result.removed.map((session) => session.id).sort()).toEqual(['2', '3']);
  });
});

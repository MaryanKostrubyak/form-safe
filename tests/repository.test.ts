import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { DraftRepository, FORM_SAFE_DB_NAME } from '../src/lib/v2/repository';
import { migrateLegacyDrafts } from '../src/lib/v2/model';
import type { Draft } from '../src/types';

function session(id: string, updatedAt: number, origin = 'https://example.com') {
  const legacy: Draft = {
    id,
    origin,
    url: `${origin}/form`,
    pathname: '/form',
    pageTitle: `Page ${id}`,
    fieldLabel: 'Message',
    fieldType: 'textarea',
    selectorInfo: { selector: `#${id}`, fallbackSelector: `#${id}`, formSignature: id, fieldSignature: id },
    value: `Value ${id}`,
    createdAt: updatedAt,
    updatedAt,
    lastSavedAt: updatedAt,
    restoreCount: 0,
    isArchived: false,
    isFavorite: false,
  };
  return { ...migrateLegacyDrafts([legacy])[0]!, id, updatedAt };
}

let repository: DraftRepository;

beforeEach(() => {
  repository = new DraftRepository();
});

afterEach(async () => {
  await repository.close();
  await deleteDB(FORM_SAFE_DB_NAME);
});

describe('DraftRepository', () => {
  it('serializes concurrent writes without losing sessions', async () => {
    await Promise.all([repository.put(session('a', 1)), repository.put(session('b', 2))]);
    expect((await repository.query({ limit: 50 })).items.map((item) => item.id).sort()).toEqual(['a', 'b']);
  });

  it('queries newest first with filters and cursors', async () => {
    await repository.put(session('a', 1));
    await repository.put(session('b', 2));
    await repository.put(session('c', 3, 'https://other.test'));
    const first = await repository.query({ origin: 'https://example.com', limit: 1 });
    const second = await repository.query({ origin: 'https://example.com', limit: 1, cursor: first.nextCursor });
    expect(first.items[0]!.id).toBe('b');
    expect(second.items[0]!.id).toBe('a');
    await repository.put({ ...session('favorite', 4), isFavorite: true, status: 'archived' });
    expect((await repository.query({ favoritesOnly: true, status: 'archived', query: 'value favorite', limit: 10 })).items).toHaveLength(1);
    expect((await repository.query({ pathname: '/missing', limit: 10 })).total).toBe(0);
    expect((await repository.query({ status: 'all', cursor: 'invalid', limit: 999 })).items.length).toBeGreaterThan(0);
  });

  it('returns storage statistics', async () => {
    await repository.put(session('a', 1));
    const stats = await repository.stats();
    expect(stats.sessions).toBe(1);
    expect(stats.versions).toBe(1);
    expect(stats.approximateBytes).toBeGreaterThan(0);
  });

  it('verifies a new codec before atomically replacing records', async () => {
    const original = session('atomic', 1);
    await repository.put(original);

    await expect(repository.replaceWithCodec([original], {
      encrypted: true,
      async encode(value) { return { wrapped: value }; },
      async decode() { throw new Error('verification failed'); },
    })).rejects.toThrow('verification failed');

    await expect(repository.get('atomic')).resolves.toEqual(original);
  });

  it('supports bulk replacement, deletion, clearing and pruning', async () => {
    const a = { ...session('a', 1), approximateBytes: 30 * 1024 * 1024, status: 'completed' as const };
    const b = { ...session('b', 2), approximateBytes: 30 * 1024 * 1024, status: 'archived' as const };
    const favorite = { ...session('favorite', 3), approximateBytes: 30 * 1024 * 1024, isFavorite: true };
    await repository.putMany([a, b, favorite]);
    expect((await repository.prune()).sort()).toEqual(['a', 'b']);
    expect((await repository.all()).map((item) => item.id)).toEqual(['favorite']);
    await expect(repository.delete('missing')).resolves.toBe(false);
    await expect(repository.delete('favorite')).resolves.toBe(true);
    await expect(repository.get('favorite')).resolves.toBeUndefined();
    await repository.put(a);
    await repository.clear();
    await expect(repository.all()).resolves.toEqual([]);
  });

  it('commits a verified codec replacement', async () => {
    const original = session('encoded', 1);
    await repository.put(original);
    const codec = {
      encrypted: true,
      async encode(value: ReturnType<typeof session>) { return { value }; },
      async decode(payload: unknown) { return (payload as { value: ReturnType<typeof session> }).value; },
    };
    await repository.replaceWithCodec([original], codec);
    await expect(repository.get('encoded')).resolves.toEqual(original);
  });
});

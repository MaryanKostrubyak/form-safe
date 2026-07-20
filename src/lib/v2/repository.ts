import { openDB, type IDBPDatabase } from 'idb';
import type { FormDraftSession, SessionPage, SessionQuery, StorageStats } from '../../types';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_SESSIONS, pruneSessions } from './model';

export const FORM_SAFE_DB_NAME = 'formsafe-v2';
const STORE = 'sessions';

export interface StoredSessionRecord {
  id: string;
  updatedAt: number;
  approximateBytes: number;
  encrypted: boolean;
  payload: unknown;
}

export interface SessionCodec {
  encrypted: boolean;
  encode(session: FormDraftSession): Promise<unknown>;
  decode(payload: unknown): Promise<FormDraftSession>;
}

const plainCodec: SessionCodec = {
  encrypted: false,
  async encode(session) { return session; },
  async decode(payload) { return payload as FormDraftSession; },
};

export class DraftRepository {
  private database?: Promise<IDBPDatabase>;
  private writeQueue = Promise.resolve();

  constructor(private codec: SessionCodec = plainCodec) {}

  setCodec(codec: SessionCodec): void {
    this.codec = codec;
  }

  async get(id: string): Promise<FormDraftSession | undefined> {
    const record = await (await this.db()).get(STORE, id) as StoredSessionRecord | undefined;
    return record ? this.codec.decode(record.payload) : undefined;
  }

  async put(session: FormDraftSession): Promise<FormDraftSession> {
    return this.queueWrite(async () => {
      await (await this.db()).put(STORE, await this.toRecord(session));
      return session;
    });
  }

  async putMany(sessions: FormDraftSession[]): Promise<void> {
    await this.queueWrite(async () => {
      const transaction = (await this.db()).transaction(STORE, 'readwrite');
      for (const session of sessions) await transaction.store.put(await this.toRecord(session));
      await transaction.done;
    });
  }

  async replaceWithCodec(sessions: FormDraftSession[], codec: SessionCodec): Promise<void> {
    const records = await Promise.all(sessions.map(async (session) => ({
      id: session.id,
      updatedAt: session.updatedAt,
      approximateBytes: session.approximateBytes,
      encrypted: codec.encrypted,
      payload: await codec.encode(session),
    } satisfies StoredSessionRecord)));
    const verified = await Promise.all(records.map((record) => codec.decode(record.payload)));
    if (verified.length !== sessions.length || verified.some((session, index) => session.id !== sessions[index]?.id)) {
      throw new Error('Storage transformation verification failed.');
    }
    await this.queueWrite(async () => {
      const transaction = (await this.db()).transaction(STORE, 'readwrite');
      await transaction.store.clear();
      for (const record of records) await transaction.store.put(record);
      await transaction.done;
    });
    this.codec = codec;
  }

  async delete(id: string): Promise<boolean> {
    return this.queueWrite(async () => {
      const database = await this.db();
      const exists = await database.getKey(STORE, id);
      if (exists === undefined) return false;
      await database.delete(STORE, id);
      return true;
    });
  }

  async clear(): Promise<void> {
    await this.queueWrite(async () => (await this.db()).clear(STORE));
  }

  async all(): Promise<FormDraftSession[]> {
    const records = await (await this.db()).getAll(STORE) as StoredSessionRecord[];
    return Promise.all(records.map((record) => this.codec.decode(record.payload)));
  }

  async query(query: SessionQuery): Promise<SessionPage> {
    const normalizedQuery = query.query?.trim().toLowerCase() ?? '';
    const filtered = (await this.all())
      .filter((session) => !query.origin || session.origin === query.origin)
      .filter((session) => !query.pathname || session.pathname === query.pathname)
      .filter((session) => !query.status || query.status === 'all' || session.status === query.status)
      .filter((session) => !query.favoritesOnly || session.isFavorite)
      .filter((session) => {
        if (!normalizedQuery) return true;
        return [session.origin, session.pageTitle, ...session.fields.flatMap((field) => [field.label, String(field.value)])]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return { items, total: filtered.length, nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined };
  }

  async stats(): Promise<StorageStats> {
    const sessions = await this.all();
    return {
      sessions: sessions.length,
      versions: sessions.reduce((total, session) => total + session.versions.length, 0),
      approximateBytes: sessions.reduce((total, session) => total + session.approximateBytes, 0),
      maxBytes: DEFAULT_MAX_BYTES,
      maxSessions: DEFAULT_MAX_SESSIONS,
    };
  }

  async prune(): Promise<string[]> {
    const { kept, removed } = pruneSessions(await this.all());
    if (removed.length === 0) return [];
    await this.queueWrite(async () => {
      const transaction = (await this.db()).transaction(STORE, 'readwrite');
      await transaction.store.clear();
      for (const session of kept) await transaction.store.put(await this.toRecord(session));
      await transaction.done;
    });
    return removed.map((session) => session.id);
  }

  async close(): Promise<void> {
    if (!this.database) return;
    (await this.database).close();
    this.database = undefined;
  }

  private db(): Promise<IDBPDatabase> {
    this.database ??= openDB(FORM_SAFE_DB_NAME, 1, {
      upgrade(database) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('origin', 'origin');
        store.createIndex('status', 'status');
      },
    });
    return this.database;
  }

  private async toRecord(session: FormDraftSession): Promise<StoredSessionRecord> {
    return {
      id: session.id,
      updatedAt: session.updatedAt,
      approximateBytes: session.approximateBytes,
      encrypted: this.codec.encrypted,
      payload: await this.codec.encode(session),
    };
  }

  private queueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(operation);
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}

import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export const after = seconds => new Date(Date.now() + seconds * 1000).toISOString();
export function document(values) { const id = randomUUID(); return { _id: id, id, ...values }; }

class View {
  constructor(db, session) { this.db = db; this.options = session ? { session } : {}; }
  all(name, query = {}, sort = {}, limit = 10000) { return this.db.collection(name).find(query, this.options).sort(sort).limit(limit).toArray(); }
  one(name, query) { return this.db.collection(name).findOne(typeof query === 'string' ? { _id: query } : query, this.options); }
  async add(name, values) { const row = document(values); await this.db.collection(name).insertOne(row, this.options); return row; }
  async set(name, id, fields) { await this.db.collection(name).updateOne({ _id: id }, { $set: fields }, this.options); }
  async setting(key, value) { await this.db.collection('settings').updateOne({ _id: key }, { $set: { value } }, { ...this.options, upsert: true }); }
}

export class Store extends View {
  static async connect(uri) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db();
    const store = new Store(db);
    store.client = client;
    // Transactions are required. A standalone MongoDB cannot safely run this scheduler.
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') { await client.close(); throw new Error('MongoDB must be a replica set or sharded cluster; use npm run dev'); }
    for (const name of ['tasks','workers','attempts','decisions','metrics','events','settings','artifacts','locks','experiments']) {
      if (!(await db.listCollections({ name }).toArray()).length) await db.createCollection(name);
    }
    await db.collection('workers').createIndex({ name: 1 }, { unique: true });
    await db.collection('workers').createIndex({ token_hash: 1 }, { unique: true });
    await db.collection('attempts').createIndex({ task_id: 1, number: 1 }, { unique: true });
    await db.collection('attempts').createIndex({ worker_id: 1, status: 1 });
    await db.collection('tasks').createIndex({ status: 1, created_at: -1 });
    await db.collection('metrics').createIndex({ worker_id: 1, timestamp: -1 });
    await db.collection('decisions').createIndex({ task_id: 1, created_at: -1 });
    await db.collection('experiments').createIndex({ status:1,created_at:-1 });
    await db.collection('locks').updateOne({ _id: 'dispatch' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    return store;
  }

  async transaction(fn) {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(async () => {
        // Concurrent writers conflict on this document; the driver retries the complete
        // transaction against a fresh snapshot before calculating reservations.
        await this.db.collection('locks').updateOne({ _id: 'dispatch' }, { $inc: { revision: 1 } }, { session });
        return fn(new View(this.db, session));
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000 });
    } finally { await session.endSession(); }
  }
  close() { return this.client.close(); }
}

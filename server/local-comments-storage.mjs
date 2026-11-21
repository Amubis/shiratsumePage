import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const locks = new Map();
const clone = value => structuredClone(value);
const empty = () => ({ schemaVersion: 2, comments: [], rates: {} });

function visibleComments(comments, inbox) {
  const parents = new Map(comments.filter(comment => comment.status === 'approved' && !comment.parentId).map(comment => [comment.id, comment]));
  return comment => {
    if (comment.status !== 'approved' || inbox && comment.verified) return false;
    if (!comment.parentId) return true;
    const parent = parents.get(comment.parentId);
    return Boolean(parent && parent.targetType === comment.targetType && parent.targetId === comment.targetId);
  };
}

/** Comments and rate limits live independently of content and survive local editor restarts. */
export function createLocalCommentsStore(dataDir) {
  const directory = resolve(dataDir), path = resolve(directory, 'comments.json');
  const read = async () => {
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (![1, 2].includes(state.schemaVersion) || !Array.isArray(state.comments) || !state.rates || typeof state.rates !== 'object') throw new Error('Invalid comments state file.');
      if (state.schemaVersion === 1) {
        // Repair legacy review times once. New published comments start unread.
        for (const comment of state.comments) if (comment.readAt == null && comment.status !== 'pending') comment.readAt = comment.updatedAt || comment.createdAt;
        state.schemaVersion = 2;
      }
      return state;
    } catch (error) { if (error.code === 'ENOENT') return empty(); throw error; }
  };
  const mutate = operation => {
    const previous = locks.get(path) || Promise.resolve();
    const result = previous.then(async () => {
      const state = await read();
      const result = await operation(state);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = resolve(directory, `.comments-${crypto.randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return clone(result);
    });
    const pending = result.catch(() => {});
    locks.set(path, pending);
    pending.finally(() => { if (locks.get(path) === pending) locks.delete(path); });
    return result;
  };
  return {
    async list({ status, unread, targetType, targetId, publicOnly = false, inbox = false, limit = 200, before } = {}) {
      const { comments } = await read();
      const visible = publicOnly || inbox ? visibleComments(comments, inbox) : null;
      const direction = inbox ? -1 : 1;
      return clone(comments.filter(comment => {
        if (!visible && status && comment.status !== status || unread === true && comment.readAt !== null || unread === false && comment.readAt === null || targetType && comment.targetType !== targetType || targetId && comment.targetId !== targetId || before && comment.createdAt >= before) return false;
        return !visible || visible(comment);
      }).sort((a, b) => direction * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))).slice(0, Math.min(500, limit)));
    },
    async get(id) { return clone((await read()).comments.find(comment => comment.id === id) || null); },
    insert: comment => mutate(state => {
      if (state.comments.some(item => item.id === comment.id)) throw new Error('Duplicate comment ID.');
      state.comments.push(clone(comment));
      return comment;
    }),
    moderate: (id, { status, read: markRead }, updatedAt) => mutate(state => {
      const comment = state.comments.find(item => item.id === id);
      if (!comment) return null;
      if (status) comment.status = status;
      if ((markRead || status && status !== 'pending') && !comment.readAt) comment.readAt = updatedAt;
      comment.updatedAt = updatedAt;
      return comment;
    }),
    markRead: ({ ids, all, inbox = false } = {}) => mutate(state => {
      const selected = new Set(ids || []), timestamp = new Date().toISOString();
      const visible = inbox ? visibleComments(state.comments, true) : null;
      let count = 0;
      for (const comment of state.comments) if (comment.readAt === null && (all || selected.has(comment.id)) && (!visible || visible(comment))) { comment.readAt = timestamp; comment.updatedAt = timestamp; count++; }
      return count;
    }),
    async unreadCount({ inbox = false } = {}) {
      const { comments } = await read();
      const visible = inbox ? visibleComments(comments, true) : null;
      return comments.filter(comment => comment.readAt === null && (!visible || visible(comment))).length;
    },
    async pendingCount() { return (await read()).comments.filter(comment => comment.status === 'pending').length; },
    consumeRateLimit: (key, nowMs, { windowMs, max }) => mutate(state => {
      for (const [id, entry] of Object.entries(state.rates)) if (entry.resetAt <= nowMs) delete state.rates[id];
      const entry = state.rates[key] ||= { count: 0, resetAt: nowMs + windowMs };
      entry.count++;
      return { allowed: entry.count <= max, retryAfter: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000)) };
    }),
  };
}

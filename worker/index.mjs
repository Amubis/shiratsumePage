import seed from '../data/garden.json' with { type: 'json' };
import { createAdminApi } from '../server/admin-api.mjs';
import { createR2Storage } from './r2-storage.mjs';
import { createD1CommentsStore } from './comments-storage.mjs';
import { createD1PhotoLikesStore } from './photo-likes-storage.mjs';
import { createCommentEmailNotifier } from './comment-email.mjs';

let cached;

export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    if (path === '/api/content' || path === '/api/comments' || path === '/api/photo-likes' || path.startsWith('/api/admin/') || path.startsWith('/media/')) {
      if (!env.BUCKET) return Response.json({ error: 'Bind a private R2 bucket as BUCKET before using the editor.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      if (!cached || cached.bucket !== env.BUCKET || cached.db !== env.DB || cached.username !== env.ADMIN_USERNAME || cached.password !== env.ADMIN_PASSWORD || cached.secret !== env.SESSION_SECRET || cached.base !== env.MEDIA_BASE_URL || cached.origins !== env.PUBLIC_SITE_ORIGINS || cached.email !== env.COMMENT_EMAIL) {
        const onNewComment = createCommentEmailNotifier(env.COMMENT_EMAIL, error => console.error('Comment email delivery failed:', error?.code || error?.name || 'unknown'));
        cached = { bucket: env.BUCKET, db: env.DB, username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET, base: env.MEDIA_BASE_URL, origins: env.PUBLIC_SITE_ORIGINS, email: env.COMMENT_EMAIL, handle: createAdminApi({ storage: createR2Storage(env.BUCKET), commentsStore: env.DB ? createD1CommentsStore(env.DB) : null, photoLikesStore: env.DB ? createD1PhotoLikesStore(env.DB) : null, seed, mode: 'cloud', adminUsername: env.ADMIN_USERNAME ?? 'Amubis', adminPassword: env.ADMIN_PASSWORD, sessionSecret: env.SESSION_SECRET, mediaBaseUrl: env.MEDIA_BASE_URL, publicSiteOrigins: env.PUBLIC_SITE_ORIGINS, onNewComment, onError: error => console.error('Garden storage request failed:', error.name) }) };
      }
      return await cached.handle(request, context);
    }
    if (!env.ASSETS) return new Response('Static ASSETS binding is missing.', { status: 503 });
    return env.ASSETS.fetch(request);
  },
};

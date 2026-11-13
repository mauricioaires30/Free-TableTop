import { ROOM_ID_RE } from '@ftt/shared';
import type { Room } from './room';

export { Room } from './room';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS?: string;
}

function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return true; // clientes fora do navegador (testes)
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  const list = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return list.length === 0 || list.includes(origin);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('Free TableTop relay: ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const m = /^\/room\/([a-z0-9]+)$/.exec(url.pathname);
    if (!m || !ROOM_ID_RE.test(m[1])) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Esperado WebSocket', { status: 426 });
    }
    if (!originAllowed(req.headers.get('Origin'), env)) return new Response('Origem não permitida', { status: 403 });

    // Cada sala é um Durable Object próprio: salas nunca compartilham estado.
    const stub = env.ROOM.get(env.ROOM.idFromName(m[1]));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;

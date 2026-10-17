import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
}

export async function requireUser(req: Request): Promise<{ id: string }> {
  const client = userClient(req);
  const result = await client.auth.getUser();
  if (result.error || !result.data.user) {
    throw new Response(JSON.stringify({ error: 'Sign in required.' }), { status: 401 });
  }
  return { id: result.data.user.id };
}

export function requireServiceRole(req: Request): void {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) throw new Response(JSON.stringify({ error: 'Service role required.' }), { status: 403 });
  const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
  if (claims.role !== 'service_role') {
    throw new Response(JSON.stringify({ error: 'Service role required.' }), { status: 403 });
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function sendExpoPush(messages: { to: string; title: string; body: string }[]): Promise<string[]> {
  if (messages.length === 0) return [];
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    throw new Error(`Expo push failed with ${response.status}`);
  }
  const payload = await response.json() as {
    data?: { details?: { error?: string } }[];
  };
  return (payload.data ?? []).flatMap((ticket, index) =>
    ticket.details?.error === 'DeviceNotRegistered' ? [messages[index].to] : []
  );
}

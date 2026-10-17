import { adminClient, json, requireServiceRole, requireUser, sendExpoPush, userClient } from '../_shared/supabase.ts';

/**
 * Sends Expo pushes directly. With `{ kind: "confirm-order", orderId }` a signed-in
 * member notifies the group that a draft is ready to confirm. With no body, the
 * service-role schedule notifies members about purchases expiring in exactly two
 * days. Nothing is written to a notifications table. Invalid Expo tokens are deleted.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);
    const body = await req.json().catch(() => ({})) as { kind?: string; orderId?: string };
    if (body.kind === 'confirm-order') {
      if (!body.orderId) return json({ error: 'orderId is required.' }, 400);
      await requireUser(req);
      const caller = userClient(req);
      const order = await caller.from('orders').select('id, group_id').eq('id', body.orderId).maybeSingle();
      if (order.error || !order.data) return json({ error: 'Order not found.' }, 404);
      const supabase = adminClient();
      const members = await supabase.from('group_members').select('user_id').eq('group_id', order.data.group_id);
      const tokens = await supabase
        .from('push_tokens')
        .select('token')
        .in('user_id', (members.data ?? []).map((member) => member.user_id));
      const invalid = await sendExpoPush((tokens.data ?? []).map((row) => ({
        to: row.token,
        title: 'Confirm your grocery order',
        body: 'A draft order is ready. The payer needs to confirm it before it is placed.',
      })));
      if (invalid.length > 0) await supabase.from('push_tokens').delete().in('token', invalid);
      return json({ sent: tokens.data?.length ?? 0 });
    }

    requireServiceRole(req);
    const supabase = adminClient();
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + 2);
    const expiresOn = target.toISOString().slice(0, 10);
    const purchases = await supabase.from('purchases').select('group_id').eq('expires_on', expiresOn);
    const groupIds = [...new Set((purchases.data ?? []).map((row) => row.group_id))];
    if (groupIds.length === 0) return json({ sent: 0 });
    const members = await supabase.from('group_members').select('user_id').in('group_id', groupIds);
    const tokens = await supabase
      .from('push_tokens')
      .select('id, token')
      .in('user_id', [...new Set((members.data ?? []).map((member) => member.user_id))]);
    const messages = (tokens.data ?? []).map((row) => ({
      to: row.token,
      title: 'Food expires in two days',
      body: 'Something your group bought expires in two days.',
    }));
    const invalid = await sendExpoPush(messages);
    if (invalid.length > 0) {
      await supabase.from('push_tokens').delete().in('token', invalid);
    }
    return json({ sent: messages.length });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Reminder send failed.' }, 500);
  }
});


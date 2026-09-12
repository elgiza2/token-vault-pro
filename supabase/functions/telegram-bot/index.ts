import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildNotification, totalVariants, type NotificationTopic } from "../_shared/notification-texts.ts";

const APP_URL = "https://t.me/Noveaibot/App";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN_HELLO') || Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN_HELLO or TELEGRAM_BOT_TOKEN not configured');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

    const body = await req.json();

    // Scheduled broadcast (every 4 hours) — hosted here so it shares this
    // function's deployment. Telegram updates never contain a `task` field.
    if (body?.task === 'auto_notify') {
      const result = await runAutoNotifications(supabase, BASE_URL);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Scheduled crash-game highlights (every few hours).
    if (body?.task === 'crash_notify') {
      const result = await runCrashNotifications(supabase, BASE_URL, Number(body?.limit ?? 3000));
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // AI-personalised purchase offer, hosted here for the same reason.
    if (body?.task === 'smart_offer') {
      const result = await buildSmartOffer(
        supabase,
        Number(body?.telegram_id),
        String(body?.surface ?? 'general'),
      );
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body?.task === 'send_apex_staking_offer') {
      const result = await sendApexStakingOffer(supabase, BASE_URL);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- Admin tasks ----
    const requireAdmin = async (tgId: number) => {
      const { data } = await supabase.rpc('is_telegram_admin', { _telegram_id: tgId });
      return data === true;
    };

    // Stores a base64 image in the public bucket so Telegram can serve it.
    if (body?.task === 'store_image') {
      if (!(await requireAdmin(Number(body?.admin_telegram_id)))) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const bytes = Uint8Array.from(atob(String(body?.data_base64 ?? '')), (c) => c.charCodeAt(0));
      const path = String(body?.name ?? `nova/${Date.now()}.jpg`);
      const { error: upErr } = await supabase.storage
        .from('user-images')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (upErr) {
        return new Response(JSON.stringify({ error: upErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: pub } = supabase.storage.from('user-images').getPublicUrl(path);
      return new Response(JSON.stringify({ ok: true, url: pub.publicUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The prize campaign is permanently disabled: every prize task is inert
    // and no player ever receives a prize message again.
    if (
      body?.task === 'prize_preview' ||
      body?.task === 'prize_broadcast' ||
      body?.task === 'prize_broadcast_all' ||
      body?.task === 'prize_broadcast_send'
    ) {
      return new Response(JSON.stringify({ ok: false, disabled: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }






    const tg = async (method: string, payload: Record<string, unknown>) => {
      const r = await fetch(`${BASE_URL}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    };

    // Telegram Stars are credited to the bot that issues the invoice, so all
    // payment traffic (invoices, pre-checkout, receipts) goes through the
    // dedicated stars bot when its token is configured.
    const STARS_BOT_TOKEN = Deno.env.get('TELEGRAM_STARS_BOT_TOKEN') || TELEGRAM_BOT_TOKEN;
    const STARS_BASE_URL = `https://api.telegram.org/bot${STARS_BOT_TOKEN}`;
    const starsTg = async (method: string, payload: Record<string, unknown>) => {
      const r = await fetch(`${STARS_BASE_URL}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    };

    // Registers the stars bot webhook on this function so payment updates
    // (pre_checkout_query / successful_payment) reach us. Setup-only helper.
    if (body?.task === 'stars_setup') {
      const me = await starsTg('getMe', {});
      const hook = await starsTg('setWebhook', {
        url: `${SUPABASE_URL}/functions/v1/telegram-bot`,
        allowed_updates: ['message', 'pre_checkout_query', 'callback_query'],
      });
      const info = await starsTg('getWebhookInfo', {});
      return new Response(JSON.stringify({ me: me?.result, hook, info: info?.result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }



    const isAdminUser = async (tgId: number) => {
      try {
        const { data } = await supabase.rpc('is_telegram_admin', { _telegram_id: tgId });
        return data === true;
      } catch {
        return false;
      }
    };

    const adminStats = async () => {
      const [users, tasks, tx] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('type', 'withdrawal').eq('status', 'pending'),
      ]);
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: newUsers } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);
      return {
        users: users.count ?? 0,
        newUsers: newUsers ?? 0,
        tasks: tasks.count ?? 0,
        pendingWithdrawals: tx.count ?? 0,
      };
    };

    // ---- Admin draft state (button-driven task builder) ----
    const getDraft = async (tgId: number) => {
      const { data } = await supabase
        .from('telegram_task_drafts')
        .select('draft')
        .eq('telegram_id', tgId)
        .limit(1);
      return (data?.[0]?.draft ?? null) as any;
    };
    const setDraft = async (tgId: number, value: any) => {
      const { error } = await supabase
        .from('telegram_task_drafts')
        .upsert({ telegram_id: tgId, draft: value }, { onConflict: 'telegram_id' });
      if (error) console.error('setDraft failed:', error.message);
    };
    const clearDraft = async (tgId: number) => {
      await supabase.from('telegram_task_drafts').delete().eq('telegram_id', tgId);
    };


    const adminPanelText = async () => {
      const s = await adminStats();
      return (
        `<b>Nova Admin Panel</b>\n\n` +
        `Total users: ${s.users}\n` +
        `New users (24h): ${s.newUsers}\n` +
        `Active Nova tasks: ${s.tasks}\n` +
        `Pending withdrawals: ${s.pendingWithdrawals}\n\n` +
        `Use the buttons below to manage Nova tasks.`
      );
    };

    const adminKeyboard = {
      inline_keyboard: [
        [{ text: 'Add Nova task', callback_data: 'adm_add' }],
        [{ text: 'Nova tasks', callback_data: 'adm_tasks' }],
        [{ text: 'Refresh stats', callback_data: 'adm_stats' }],
      ],
    };

    const listTasks = async () => {
      const { data } = await supabase
        .from('tasks')
        .select('id, title, reward_amount, reward_type, is_active')
        .order('created_at', { ascending: true });
      const rows = data ?? [];
      if (rows.length === 0) {
        return {
          text: '<b>Nova Tasks</b>\n\nNo tasks yet.',
          markup: { inline_keyboard: [[{ text: 'Add Nova task', callback_data: 'adm_add' }]] },
        };
      }
      const text = rows
        .map((t: any, i: number) => `${i + 1}. ${t.title} - ${t.reward_amount} ${String(t.reward_type).toUpperCase()}${t.is_active ? '' : ' (inactive)'}`)
        .join('\n');
      const markup = {
        inline_keyboard: [
          ...rows.slice(0, 20).map((t: any, i: number) => [
            { text: `Delete ${i + 1}`, callback_data: `adm_del:${t.id}` },
          ]),
          [{ text: 'Add Nova task', callback_data: 'adm_add' }],
        ],
      };
      return { text: `<b>Nova Tasks</b>\n\n${text}`, markup };
    };

    const cancelRow = [{ text: 'Cancel', callback_data: 'adm_cancel' }];

    const draftSummary = (d: any) =>
      `<b>New Nova Task</b>\n\n` +
      `Title: ${d.title || '-'}\n` +
      `Link: ${d.link || 'none'}\n` +
      `Reward: ${d.reward ?? '-'} ${(d.rewardType || '').toUpperCase()}`;

    const askStep = async (chat: number, d: any) => {
      if (d.step === 'title') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nSend the task title as a message.`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [cancelRow] },
        });
      }
      if (d.step === 'link') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nSend the task link, or tap "No link".`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: 'No link', callback_data: 'adm_link_none' }], cancelRow] },
        });
      }
      if (d.step === 'type') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nChoose the reward currency.`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '$NOVA', callback_data: 'adm_type:siri' },
                { text: 'TON', callback_data: 'adm_type:ton' },
                { text: 'USDT', callback_data: 'adm_type:usdt' },
              ],
              cancelRow,
            ],
          },
        });
      }
      if (d.step === 'reward') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nChoose the reward amount, or send a custom number.`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '0.1', callback_data: 'adm_rew:0.1' },
                { text: '0.5', callback_data: 'adm_rew:0.5' },
                { text: '1', callback_data: 'adm_rew:1' },
              ],
              [
                { text: '5', callback_data: 'adm_rew:5' },
                { text: '10', callback_data: 'adm_rew:10' },
                { text: '100', callback_data: 'adm_rew:100' },
              ],
              cancelRow,
            ],
          },
        });
      }
      return tg('sendMessage', {
        chat_id: chat,
        text: `${draftSummary(d)}\n\nSave this Nova task?`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Save task', callback_data: 'adm_save' }], cancelRow],
        },
      });
    };

    const saveDraft = async (chat: number, tgId: number, d: any) => {
      const { error } = await supabase.from('tasks').insert({
        title: d.title,
        link: d.link || null,
        reward_amount: Number(d.reward) || 0,
        reward_type: d.rewardType || 'siri',
        task_type: d.link ? 'link' : 'custom',
        verification_type: 'auto',
        is_active: true,
      });
      await clearDraft(tgId);
      await tg('sendMessage', {
        chat_id: chat,
        text: error ? `Failed: ${error.message}` : `Nova task added: ${d.title} - ${d.reward} ${String(d.rewardType).toUpperCase()}`,
        reply_markup: adminKeyboard,
      });
    };

    // Admin inline buttons
    if (body.callback_query) {
      const cq = body.callback_query;
      const cqChat = cq.message?.chat?.id;
      const cqUser = cq.from?.id;
      const data: string = cq.data || '';
      if (cqChat && cqUser && (await isAdminUser(cqUser))) {
        if (data === 'adm_stats') {
          await tg('sendMessage', { chat_id: cqChat, text: await adminPanelText(), parse_mode: 'HTML', reply_markup: adminKeyboard });
        } else if (data === 'adm_tasks') {
          const l = await listTasks();
          await tg('sendMessage', { chat_id: cqChat, text: l.text, parse_mode: 'HTML', reply_markup: l.markup });
        } else if (data === 'adm_add') {
          const d = { step: 'title', title: '', link: '', rewardType: '', reward: null };
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data === 'adm_cancel') {
          await clearDraft(cqUser);
          await tg('sendMessage', { chat_id: cqChat, text: 'Cancelled.', reply_markup: adminKeyboard });
        } else if (data === 'adm_link_none') {
          const d = (await getDraft(cqUser)) || {};
          d.link = '';
          d.step = 'type';
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data.startsWith('adm_type:')) {
          const d = (await getDraft(cqUser)) || {};
          d.rewardType = data.slice(9);
          d.step = 'reward';
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data.startsWith('adm_rew:')) {
          const d = (await getDraft(cqUser)) || {};
          d.reward = Number(data.slice(8));
          d.step = 'confirm';
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data === 'adm_save') {
          const d = await getDraft(cqUser);
          if (d?.title) await saveDraft(cqChat, cqUser, d);
          else await tg('sendMessage', { chat_id: cqChat, text: 'Draft expired.', reply_markup: adminKeyboard });
        } else if (data.startsWith('adm_del:')) {
          const id = data.slice(8);
          const { error } = await supabase.from('tasks').delete().eq('id', id);
          await tg('sendMessage', { chat_id: cqChat, text: error ? `Delete failed: ${error.message}` : 'Nova task deleted.', reply_markup: adminKeyboard });
        }
      }
      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---- Telegram Stars payments ----
    const STARS_PRODUCTS: Record<string, { id: string; title: string; description: string; stars: number; usdt: number; aiPro?: boolean }> = {
      ai_pro: { id: 'ai_pro', title: 'Nova AI Pro — 30 days', description: 'Unlimited chat, images and videos for 30 days.', stars: 667, usdt: 0, aiPro: true },
      usdt_5: { id: 'usdt_5', title: '5 USDT top-up', description: 'Add 5 USDT to your in-game balance.', stars: 334, usdt: 5 },
      usdt_10: { id: 'usdt_10', title: '10 USDT top-up', description: 'Add 10 USDT to your in-game balance.', stars: 667, usdt: 10 },
      usdt_25: { id: 'usdt_25', title: '25 USDT top-up', description: 'Add 25 USDT to your in-game balance.', stars: 1667, usdt: 25 },
    };
    const starsForTon = (priceTon: number) => Math.max(1, Math.round((priceTon * 3.5) / 0.015));

    if (body.pre_checkout_query) {
      await starsTg('answerPreCheckoutQuery', { pre_checkout_query_id: body.pre_checkout_query.id, ok: true });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const successfulPayment = body.message?.successful_payment;
    if (successfulPayment) {
      const payload = String(successfulPayment.invoice_payload ?? '');
      const { data: rows } = await supabase.from('star_payments').select('*').eq('payload', payload).limit(1);
      const row = rows?.[0];

      if (row && row.status !== 'paid') {
        if (String(row.product).startsWith('server:')) {
          const serverId = String(row.product).slice('server:'.length);
          const { data: server } = await supabase.from('servers').select('price_ton').eq('id', serverId).maybeSingle();
          await supabase.rpc('purchase_server_for_telegram', {
            _telegram_id: row.telegram_id,
            _server_id: serverId,
            _ton_paid: Number(server?.price_ton ?? 0),
            _wallet_address: null,
            _tx_hash: successfulPayment.telegram_payment_charge_id ?? null,
          });
        }

        const product = STARS_PRODUCTS[row.product];
        if (product?.aiPro) {
          await supabase.rpc('ai_activate_plan', { _profile_id: row.profile_id, _plan: 'unlimited', _price: 0 });
        }
        if (product && product.usdt > 0) {
          const { data: profile } = await supabase.from('profiles').select('usdt_balance').eq('id', row.profile_id).maybeSingle();
          await supabase
            .from('profiles')
            .update({ usdt_balance: Number(profile?.usdt_balance ?? 0) + product.usdt })
            .eq('id', row.profile_id);
        }

        await supabase
          .from('star_payments')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            charge_id: successfulPayment.telegram_payment_charge_id ?? null,
            meta: successfulPayment,
          })
          .eq('id', row.id);

        await starsTg('sendMessage', {
          chat_id: body.message.chat.id,
          text: `✅ Payment received — ${product?.title ?? row.product} is now active.`,
        });

        const { data: admins } = await supabase.from('bot_admins').select('telegram_id');
        const adminText =
          `<b>New Telegram Stars payment</b>\n` +
          `Amount: <b>${Number(successfulPayment.total_amount ?? 0)} Stars</b>\n` +
          `Product: <b>${String(product?.title ?? row.product).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</b>\n` +
          `User: <code>${row.telegram_id}</code>\n` +
          `Charge: <code>${String(successfulPayment.telegram_payment_charge_id ?? '')}</code>`;
        await Promise.allSettled((admins ?? []).map((admin: { telegram_id: number }) => tg('sendMessage', {
          chat_id: admin.telegram_id,
          text: adminText,
          parse_mode: 'HTML',
        })));
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'starsInvoice') {
      const profileId = typeof body.profileId === 'string' ? body.profileId : null;
      const telegramId = Number(body.telegramId) || null;
      if (!profileId) {
        return new Response(JSON.stringify({ error: 'Missing profile' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const requested = String(body.product ?? '');
      let product = STARS_PRODUCTS[requested];

      if (!product && requested === 'server') {
        const serverId = String(body.serverId ?? '');
        const { data: server } = serverId
          ? await supabase.from('servers').select('id, name, price_ton, is_active').eq('id', serverId).maybeSingle()
          : { data: null as any };
        if (!server || !server.is_active) {
          return new Response(JSON.stringify({ error: 'Server not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        product = {
          id: `server:${server.id}`,
          title: `${server.name} — mining server`,
          description: `Unlock the ${server.name} mining server.`,
          stars: starsForTon(Number(server.price_ton)),
          usdt: 0,
        };
      }

      if (!product) {
        return new Response(JSON.stringify({ error: 'Unknown product' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Apply the player's tier discount to Stars purchases too. The percentage
      // is always recomputed here so the client can never inflate it.
      if (telegramId && (requested === 'server' || requested === 'ai_pro')) {
        const { data: discountRow } = await supabase.rpc('get_payment_discount_for_telegram', {
          _telegram_id: telegramId,
        });
        const pct = Math.min(Number((discountRow as Record<string, unknown> | null)?.discount_pct ?? 0) || 0, 50);
        if (pct > 0) {
          product = { ...product, stars: Math.max(1, Math.round(product.stars * (1 - pct / 100))) };
        }
      }


      const payload = `${product.id}:${crypto.randomUUID()}`;
      const { error: insErr } = await supabase.from('star_payments').insert({
        profile_id: profileId,
        telegram_id: telegramId,
        product: product.id,
        stars: product.stars,
        payload,
        status: 'pending',
      });
      if (insErr) {
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const invoice = await starsTg('createInvoiceLink', {
        title: product.title.slice(0, 32),
        description: product.description.slice(0, 255),
        payload,
        currency: 'XTR',
        prices: [{ label: product.title.slice(0, 32), amount: product.stars }],
      });

      if (!invoice?.ok) {
        return new Response(JSON.stringify({ error: invoice?.description ?? 'Could not create invoice' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ url: invoice.result, payload, stars: product.stars }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.update_id) {

      const message = body.message;
      if (!message) {
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const chatId = message.chat?.id;
      const userId = message.from?.id;
      const firstName = message.from?.first_name || 'Player';

      if (!chatId || !userId) {
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const text: string = message.text || '';

      // Admin panel entry
      if (/^\/101\b/.test(text)) {
        if (!(await isAdminUser(userId))) {
          await tg('sendMessage', { chat_id: chatId, text: 'Access denied.' });
        } else {
          await clearDraft(userId);
          await tg('sendMessage', { chat_id: chatId, text: await adminPanelText(), parse_mode: 'HTML', reply_markup: adminKeyboard });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Button-driven task builder: capture free text for the active draft step
      if (text && !text.startsWith('/') && (await isAdminUser(userId))) {
        const d = await getDraft(userId);
        if (d) {
          if (d.step === 'title') {
            d.title = text.trim();
            d.step = 'link';
          } else if (d.step === 'link') {
            d.link = text.trim();
            d.step = 'type';
          } else if (d.step === 'reward') {
            const n = Number(text.trim());
            if (!Number.isFinite(n)) {
              await tg('sendMessage', { chat_id: chatId, text: 'Send a valid number.' });
              return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            d.reward = n;
            d.step = 'confirm';
          }
          await setDraft(userId, d);
          await askStep(chatId, d);
          return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }



      if (message.text?.startsWith('/start')) {
        const lastName = message.from?.last_name || '';
        const username = message.from?.username || '';
        const parts = message.text.split(' ');
        const referralCode = parts.length > 1 ? parts[1] : null;

        // Register user - always try, handle duplicates gracefully
        try {
          const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('telegram_id', userId)
            .limit(1);

          if (!existing || existing.length === 0) {
            const newReferralCode = `SIRI${userId}${Date.now().toString(36)}`.toUpperCase();
            
            // Build deterministic UUID from telegram ID
            const hex = Math.abs(Math.trunc(userId)).toString(16).padStart(32, '0').slice(-32);
            const scopedUserId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
            
            let referredBy = null;
            if (referralCode) {
              const { data: referrer } = await supabase
                .from('profiles')
                .select('id')
                .eq('referral_code', referralCode)
                .limit(1);
              if (referrer && referrer.length > 0) referredBy = referrer[0].id;
            }

            const { error: insertError } = await supabase.from('profiles').insert({
              telegram_id: userId,
              first_name: firstName,
              last_name: lastName,
              username: username,
              referral_code: newReferralCode,
              referred_by: referredBy,
              user_id: scopedUserId,
            });

            if (insertError && insertError.code !== '23505') {
              console.error("Profile insert error:", insertError);
            }
          }
        } catch (regError) {
          console.error("Registration error:", regError);
          // Don't block the welcome message
        }

        // Get welcome image from admin config (falls back to default Nova banner)
        const DEFAULT_WELCOME_IMAGE = 'https://project--c73d4246-57f5-4613-a5ff-86a529d241dd.lovable.app/images/nova-icon.jpg';
        let welcomeImageUrl = DEFAULT_WELCOME_IMAGE;
        try {
          const { data: adminConfig } = await supabase
            .from('telegram_admins')
            .select('welcome_image_url')
            .not('welcome_image_url', 'is', null)
            .neq('welcome_image_url', '')
            .limit(1);
          welcomeImageUrl = adminConfig?.[0]?.welcome_image_url || DEFAULT_WELCOME_IMAGE;
        } catch (e) {
          console.error("Failed to get welcome image:", e);
        }

        const welcomeText = `<b>Welcome to Nova</b>\n\nMine $NOVA, TON, and USDT every eight hours. Upgrade your mining capacity. Invite friends. Earn more. Simple. Powerful. Rewarding. Start today .`;


        const welcomeMarkup = {
          inline_keyboard: [
            [{ text: 'Open Nova AI', url: APP_URL }],
            [{ text: 'Join Community', url: 'https://t.me/noveall' }],
          ]
        };


        try {
          if (welcomeImageUrl) {
            await fetch(`${BASE_URL}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                photo: welcomeImageUrl,
                caption: welcomeText,
                parse_mode: 'HTML',
                reply_markup: welcomeMarkup,
              }),
            });
          } else {
            await fetch(`${BASE_URL}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: welcomeText,
                parse_mode: 'HTML',
                reply_markup: welcomeMarkup,
              }),
            });
          }
        } catch (sendError) {
          console.error("Failed to send welcome:", sendError);
        }

        // The prize campaign is removed: nothing is granted on signup.

        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      }
    }

    const { action, chat_id, text, parse_mode } = body;

    let result;
    switch (action) {
      case 'sendMessage': {
        const response = await fetch(`${BASE_URL}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, parse_mode: parse_mode || 'HTML' }),
        });
        result = await response.json();
        break;
      }
      case 'setWebhook': {
        const webhookUrl = body.webhook_url;
        const response = await fetch(`${BASE_URL}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          }),
        });
        result = await response.json();
        break;
      }
      case 'getWebhookInfo': {
        const response = await fetch(`${BASE_URL}/getWebhookInfo`);
        result = await response.json();
        break;
      }
      case 'getMe': {
        const response = await fetch(`${BASE_URL}/getMe`);
        result = await response.json();
        break;
      }
      // NOTE: the legacy amount-only 'verifyTonTransaction' case was removed.
      // All TON payments are verified by the `verify-ton-transaction` function,
      // which matches the unique per-payment memo and marks the intent as used.

      case 'prizeBroadcast': {
        // Disabled permanently: no prize message is ever sent to players.
        result = { ok: false, disabled: true };
        break;
      }
      default:
        result = { ok: false, error: 'Unknown action' };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Telegram bot error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── Automated 4-hour notifications ──────────────────────────────────────────
const COOLDOWN_HOURS = 4;
async function runAutoNotifications(supabase: any, BASE_URL: string) {
  const nowIso = new Date().toISOString();
  const cooldownIso = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString();

  const { data: active } = await supabase
    .from("mining_sessions")
    .select("user_id")
    .gt("ends_at", nowIso);
  const mining = new Set((active || []).map((r: any) => r.user_id));

  const { data: recent } = await supabase
    .from("auto_notification_log")
    .select("profile_id")
    .gt("last_sent_at", cooldownIso);
  const recentlySent = new Set((recent || []).map((r: any) => r.profile_id));

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, telegram_id, first_name")
    .eq("is_banned", false)
    .limit(5000);
  if (error) return { ok: false, error: error.message };

  const targets = (profiles || []).filter((p: any) => p.telegram_id && !recentlySent.has(p.id));

  let sent = 0;
  let failed = 0;
  const CHUNK = 25;

  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const okRows: { profile_id: string; topic: string; last_sent_at: string }[] = [];

    await Promise.all(chunk.map(async (p: any) => {
      const topic: NotificationTopic = mining.has(p.id) ? "crash" : Math.random() < 0.6 ? "mining" : "crash";
      const text = buildNotification(topic, p.first_name);
      const buttonText = topic === "mining" ? "Start Mining" : "Play Crash";
      const url = APP_URL;
      try {
        const res = await fetch(`${BASE_URL}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: p.telegram_id,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: [[{ text: buttonText, url }]] },
          }),
        });
        const json = await res.json();
        if (json.ok) okRows.push({ profile_id: p.id, topic, last_sent_at: new Date().toISOString() });
        else failed++;
      } catch {
        failed++;
      }
    }));

    if (okRows.length) {
      await supabase.from("auto_notification_log").upsert(
        okRows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "profile_id" },
      );
      sent += okRows.length;
    }
    if (i + CHUNK < targets.length) await new Promise((r) => setTimeout(r, 1100));
  }

  return { ok: true, candidates: targets.length, sent, failed, variants: totalVariants() };
}

// The prize message builder and sender were removed with the prize campaign.

const APEX_STAKING_IMAGE_URL =
  'https://project--10a457f9-1071-441f-805e-a0a86ff9071a-dev.lovable.app/__l5e/assets-v1/79127678-f1c6-4ae8-9b44-e7966ab5f2c3/apex-double-stake-bot.jpg';

async function sendApexStakingOffer(supabase: any, baseUrl: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, telegram_id, first_name')
    .ilike('username', 'ApexPredator88')
    .maybeSingle();

  if (!profile?.id || !profile?.telegram_id) return { ok: false, error: 'profile_not_found' };

  const { data: offer } = await supabase
    .from('staking_personal_offers')
    .select('id, expires_at, message_sent_at')
    .eq('profile_id', profile.id)
    .eq('currency', 'ton')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!offer?.id) return { ok: false, error: 'active_offer_not_found' };
  if (offer.message_sent_at) return { ok: true, skipped: 'already_sent' };

  const safeName = String(profile.first_name || 'Apex').replace(/[<>&]/g, '');
  const caption =
    `<b>${safeName}, a private 2X Gram staking offer is active for you.</b>\n\n` +
    `For the next 24 hours, every Gram amount you stake is invested at double value.\n\n` +
    `<b>Pay 1,000 Gram → Invest 2,000 Gram</b>\n` +
    `Only the amount you enter is deducted from your balance. Your investment value and yield are calculated on twice that amount.\n\n` +
    `This offer is linked only to your account and ends automatically when the timer reaches zero.`;

  const response = await fetch(`${baseUrl}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: Number(profile.telegram_id),
      photo: APEX_STAKING_IMAGE_URL,
      caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Open staking', url: APP_URL }]] },
    }),
  });
  const result = await response.json().catch(() => ({ ok: false }));
  if (!result?.ok) return { ok: false, error: result?.description || 'telegram_send_failed' };

  await supabase
    .from('staking_personal_offers')
    .update({ message_sent_at: new Date().toISOString() })
    .eq('id', offer.id);

  return { ok: true, sent: true };
}

// The prize broadcast helpers were removed with the prize campaign.

// ── Automated crash-game notifications ──────────────────────────────────────
const CRASH_COOLDOWN_HOURS = 6;
async function runCrashNotifications(supabase: any, BASE_URL: string, limit: number) {
  const cooldownIso = new Date(Date.now() - CRASH_COOLDOWN_HOURS * 3600_000).toISOString();

  const { data: rounds } = await supabase
    .from('game_crash_rounds')
    .select('round_id, crash_multiplier')
    .order('round_id', { ascending: false })
    .limit(20);

  const list = rounds ?? [];
  if (list.length === 0) return { ok: true, skipped: 'no_rounds' };

  const best = list.reduce(
    (a: any, b: any) => (Number(b.crash_multiplier) > Number(a.crash_multiplier) ? b : a),
    list[0],
  );
  const history = list
    .slice(0, 8)
    .map((r: any) => `${Number(r.crash_multiplier).toFixed(2)}x`)
    .join('  •  ');

  const { data: recent } = await supabase
    .from('crash_notification_log')
    .select('profile_id')
    .gt('last_sent_at', cooldownIso);
  const recentlySent = new Set((recent || []).map((r: any) => r.profile_id));

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, telegram_id, first_name')
    .eq('is_banned', false)
    .limit(Math.min(Math.max(limit, 1), 5000));

  const targets = (profiles || []).filter((p: any) => p.telegram_id && !recentlySent.has(p.id));

  let sent = 0;
  let failed = 0;
  const CHUNK = 25;

  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const okRows: { profile_id: string; last_sent_at: string; updated_at: string }[] = [];

    await Promise.all(
      chunk.map(async (p: any) => {
        const safe = String(p.first_name || 'Player').replace(/[<>&]/g, '').slice(0, 32);
        const text =
          `<b>${safe}, the Crash table is hot right now.</b>\n\n` +
          `<b>Top multiplier: ${Number(best.crash_multiplier).toFixed(2)}x</b>\n` +
          `<b>Last rounds: ${history}</b>\n\n` +
          `<b>Place a TON bet, watch the curve and cash out before it crashes.</b>`;
        try {
          const res = await fetch(`${BASE_URL}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: p.telegram_id,
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: { inline_keyboard: [[{ text: 'Play Crash', url: APP_URL }]] },
            }),
          });
          const json = await res.json();
          if (json.ok) {
            okRows.push({
              profile_id: p.id,
              last_sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } else failed++;
        } catch {
          failed++;
        }
      }),
    );

    if (okRows.length) {
      await supabase.from('crash_notification_log').upsert(okRows, { onConflict: 'profile_id' });
      sent += okRows.length;
    }
    if (i + CHUNK < targets.length) await new Promise((r) => setTimeout(r, 1100));
  }

  return { ok: true, candidates: targets.length, sent, failed, best: best.crash_multiplier };
}

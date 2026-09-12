DROP TRIGGER IF EXISTS trg_ensure_monthly_prize ON public.profiles;

CREATE OR REPLACE FUNCTION public.grant_welcome_prize(_telegram_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT jsonb_build_object('granted', false, 'disabled', true) $$;

CREATE OR REPLACE FUNCTION public.grant_prize_to_all()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT jsonb_build_object('granted', 0, 'disabled', true) $$;

CREATE OR REPLACE FUNCTION public.admin_activate_reward_for_telegram(_telegram_id bigint, _reward_amount numeric)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT jsonb_build_object('updated', 0, 'disabled', true) $$;

CREATE OR REPLACE FUNCTION public.next_prize_broadcast_targets(_limit integer)
RETURNS TABLE(id uuid, telegram_id bigint, first_name text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT NULL::uuid, NULL::bigint, NULL::text WHERE false $$;

CREATE OR REPLACE FUNCTION public.all_prize_broadcast_targets(_limit integer DEFAULT 500, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, telegram_id bigint, first_name text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT NULL::uuid, NULL::bigint, NULL::text WHERE false $$;

UPDATE public.profiles SET reward_balance = 0, reward_expires_at = NULL
WHERE COALESCE(reward_balance, 0) <> 0 OR reward_expires_at IS NOT NULL;
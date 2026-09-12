ALTER TABLE public.mining_sessions
  ADD COLUMN IF NOT EXISTS siri_reward numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ton_reward numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdt_reward numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.next_prize_broadcast_targets(_limit integer)
 RETURNS TABLE(id uuid, telegram_id bigint, first_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.telegram_id, p.first_name
  FROM public.profiles p
  LEFT JOIN public.prize_broadcast_log l ON l.profile_id = p.id
  WHERE l.profile_id IS NULL
    AND p.telegram_id IS NOT NULL
    AND p.created_at < now() - interval '3 minutes'
  ORDER BY p.created_at DESC
  LIMIT greatest(1, least(_limit, 2000));
$function$;

CREATE TABLE IF NOT EXISTS public.crash_notification_log (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.crash_notification_log TO service_role;
ALTER TABLE public.crash_notification_log ENABLE ROW LEVEL SECURITY;
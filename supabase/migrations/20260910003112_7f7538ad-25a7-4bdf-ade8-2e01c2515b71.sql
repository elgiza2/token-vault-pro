CREATE TABLE public.staking_personal_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'ton',
  multiplier numeric NOT NULL DEFAULT 2,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  message_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.staking_personal_offers TO service_role;
ALTER TABLE public.staking_personal_offers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_staking_personal_offers_profile_active
  ON public.staking_personal_offers(profile_id, expires_at DESC)
  WHERE is_active;
CREATE TRIGGER trg_staking_personal_offers_updated_at
  BEFORE UPDATE ON public.staking_personal_offers
  FOR EACH ROW EXECUTE FUNCTION public.game_touch_updated_at();

ALTER TABLE public.stakes
  ADD COLUMN funded_amount numeric;
UPDATE public.stakes SET funded_amount = amount WHERE funded_amount IS NULL;
ALTER TABLE public.stakes ALTER COLUMN funded_amount SET NOT NULL;

CREATE OR REPLACE FUNCTION public.staking_get_overview_for_telegram(_telegram_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
  _offer jsonb;
BEGIN
  SELECT id INTO _pid FROM public.profiles WHERE telegram_id = _telegram_id;

  SELECT jsonb_build_object(
    'active', true,
    'multiplier', o.multiplier,
    'starts_at', o.starts_at,
    'expires_at', o.expires_at,
    'currency', o.currency
  ) INTO _offer
  FROM public.staking_personal_offers o
  WHERE o.profile_id = _pid
    AND o.currency = 'ton'
    AND o.is_active
    AND now() >= o.starts_at
    AND now() < o.expires_at
  ORDER BY o.expires_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'plans', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort_order)
      FROM public.staking_plans p WHERE p.is_active
    ), '[]'::jsonb),
    'stakes', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'pending_yield', public.staking_pending_yield(s),
        'plan_name', pl.name
      ) ORDER BY s.created_at DESC)
      FROM public.stakes s
      JOIN public.staking_plans pl ON pl.id = s.plan_id
      WHERE s.profile_id = _pid
    ), '[]'::jsonb),
    'balances', (
      SELECT jsonb_build_object('ton', COALESCE(ton_balance,0), 'siri', COALESCE(siri_balance,0))
      FROM public.profiles WHERE id = _pid
    ),
    'personal_offer', _offer
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staking_create_for_telegram(_telegram_id bigint, _plan_id uuid, _amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
  _plan public.staking_plans;
  _bal numeric;
  _stake_id uuid;
  _multiplier numeric := 1;
  _credited_amount numeric;
BEGIN
  SELECT id INTO _pid FROM public.profiles WHERE telegram_id = _telegram_id;
  IF _pid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'profile_not_found'); END IF;

  SELECT * INTO _plan FROM public.staking_plans WHERE id = _plan_id AND is_active;
  IF _plan.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'plan_not_found'); END IF;

  IF _amount IS NULL OR _amount <= 0 OR _amount < _plan.min_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_too_low');
  END IF;
  IF _plan.max_amount IS NOT NULL AND _amount > _plan.max_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_too_high');
  END IF;

  IF _plan.currency = 'ton' THEN
    SELECT COALESCE(ton_balance,0) INTO _bal FROM public.profiles WHERE id = _pid FOR UPDATE;
  ELSE
    SELECT COALESCE(siri_balance,0) INTO _bal FROM public.profiles WHERE id = _pid FOR UPDATE;
  END IF;

  IF _bal < _amount THEN RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance'); END IF;

  IF _plan.currency = 'ton' THEN
    SELECT COALESCE(o.multiplier, 1) INTO _multiplier
    FROM public.staking_personal_offers o
    WHERE o.profile_id = _pid
      AND o.currency = 'ton'
      AND o.is_active
      AND now() >= o.starts_at
      AND now() < o.expires_at
    ORDER BY o.expires_at DESC
    LIMIT 1;
    _multiplier := COALESCE(_multiplier, 1);
  END IF;

  _credited_amount := _amount * _multiplier;

  IF _plan.currency = 'ton' THEN
    UPDATE public.profiles SET ton_balance = COALESCE(ton_balance,0) - _amount WHERE id = _pid;
  ELSE
    UPDATE public.profiles SET siri_balance = COALESCE(siri_balance,0) - _amount WHERE id = _pid;
  END IF;

  INSERT INTO public.stakes (profile_id, plan_id, currency, amount, funded_amount, apr, duration_days, early_exit_fee_pct, ends_at)
  VALUES (_pid, _plan.id, _plan.currency, _credited_amount, _amount, _plan.apr, _plan.duration_days, _plan.early_exit_fee_pct,
          now() + (_plan.duration_days || ' days')::interval)
  RETURNING id INTO _stake_id;

  RETURN jsonb_build_object(
    'success', true,
    'stake_id', _stake_id,
    'funded_amount', _amount,
    'credited_amount', _credited_amount,
    'multiplier', _multiplier
  );
END;
$$;
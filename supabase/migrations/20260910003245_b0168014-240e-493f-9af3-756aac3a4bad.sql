CREATE OR REPLACE FUNCTION public.staking_unstake_for_telegram(_telegram_id bigint, _stake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
  _stake public.stakes;
  _yield numeric;
  _fee numeric := 0;
  _payout numeric;
  _principal numeric;
  _early boolean;
BEGIN
  SELECT id INTO _pid FROM public.profiles WHERE telegram_id = _telegram_id;
  IF _pid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'profile_not_found'); END IF;

  SELECT * INTO _stake FROM public.stakes WHERE id = _stake_id AND profile_id = _pid AND status = 'active' FOR UPDATE;
  IF _stake.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'stake_not_found'); END IF;

  _early := now() < _stake.ends_at;
  _yield := public.staking_pending_yield(_stake);
  _principal := CASE WHEN _early THEN _stake.funded_amount ELSE _stake.amount END;

  IF _early THEN
    _yield := 0;
    _fee := _principal * (_stake.early_exit_fee_pct / 100.0);
  END IF;

  _payout := _principal - _fee + _yield;

  IF _stake.currency = 'ton' THEN
    UPDATE public.profiles SET ton_balance = COALESCE(ton_balance,0) + _payout WHERE id = _pid;
  ELSE
    UPDATE public.profiles SET siri_balance = COALESCE(siri_balance,0) + _payout WHERE id = _pid;
  END IF;

  UPDATE public.stakes
  SET status = CASE WHEN _early THEN 'early_closed' ELSE 'closed' END,
      closed_at = now(),
      last_claim_at = LEAST(now(), ends_at),
      claimed_yield = claimed_yield + _yield
  WHERE id = _stake.id;

  RETURN jsonb_build_object('success', true, 'payout', _payout, 'fee', _fee, 'yield', _yield,
                            'early', _early, 'currency', _stake.currency);
END;
$$;
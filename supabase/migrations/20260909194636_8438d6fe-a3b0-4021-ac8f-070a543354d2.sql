CREATE OR REPLACE FUNCTION public.game_crash_pick(_u double precision, _v double precision)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE _c numeric;
BEGIN
  -- ~60% of rounds bust early (loss zone), ~40% run higher, hard cap 500x.
  IF _u < 0.06 THEN
    RETURN 1.00;
  ELSIF _u < 0.62 THEN
    RETURN round((1.01 + _v * 0.54)::numeric, 2);
  END IF;
  _c := (0.97 / GREATEST(1.0 - _v, 0.0019))::numeric;
  RETURN round(LEAST(500, GREATEST(1.56, _c)), 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.game_crash_round_result(_round_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _crash numeric;
  _u double precision;
  _v double precision;
BEGIN
  SELECT crash_multiplier INTO _crash FROM public.game_crash_rounds WHERE round_id = _round_id;
  IF _crash IS NOT NULL THEN RETURN _crash; END IF;

  _u := ('x' || substr(md5(_round_id::text || '-nova-crash-v2'), 1, 13))::bit(52)::bigint::double precision / 4503599627370496.0;
  _v := ('x' || substr(md5(_round_id::text || '-nova-crash-v2-b'), 1, 13))::bit(52)::bigint::double precision / 4503599627370496.0;
  _crash := public.game_crash_pick(_u, _v);

  INSERT INTO public.game_crash_rounds (round_id, crash_multiplier)
  VALUES (_round_id, _crash)
  ON CONFLICT (round_id) DO NOTHING;

  SELECT crash_multiplier INTO _crash FROM public.game_crash_rounds WHERE round_id = _round_id;
  RETURN _crash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.game_crash_start(_telegram_id bigint, _stake numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _bal numeric;
  _bet_id uuid;
  _crash numeric;
BEGIN
  IF _stake IS NULL OR _stake <= 0 OR _stake > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_stake');
  END IF;

  SELECT ton_balance INTO _bal FROM profiles WHERE telegram_id = _telegram_id FOR UPDATE;
  IF _bal IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_profile'); END IF;
  IF _bal < _stake THEN RETURN jsonb_build_object('success', false, 'error', 'insufficient_funds'); END IF;

  _crash := public.game_crash_pick(random(), random());

  UPDATE profiles SET ton_balance = ton_balance - _stake WHERE telegram_id = _telegram_id;

  INSERT INTO game_bets (telegram_id, game_slug, stake, meta, status)
  VALUES (_telegram_id, 'crash', _stake, jsonb_build_object('crash', _crash), 'open')
  RETURNING id INTO _bet_id;

  SELECT ton_balance INTO _bal FROM profiles WHERE telegram_id = _telegram_id;
  RETURN jsonb_build_object('success', true, 'bet_id', _bet_id, 'balance', _bal);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.game_crash_pick(double precision, double precision) TO anon, authenticated, service_role;
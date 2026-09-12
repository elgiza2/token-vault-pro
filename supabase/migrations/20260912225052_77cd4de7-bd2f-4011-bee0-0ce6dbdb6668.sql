CREATE OR REPLACE FUNCTION public.purchase_server_with_balance(_telegram_id bigint, _server_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_price numeric; v_bal numeric; v_tx uuid; v_ref numeric := 0;
BEGIN
  v_uid := public.game_profile_id(_telegram_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'profile_not_found'); END IF;

  SELECT price_ton INTO v_price FROM public.servers WHERE id = _server_id AND is_active = true;
  IF v_price IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'server_not_found'); END IF;

  SELECT COALESCE(ton_balance, 0) INTO v_bal FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_bal < v_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance');
  END IF;

  UPDATE public.profiles SET ton_balance = COALESCE(ton_balance, 0) - v_price, updated_at = now() WHERE id = v_uid;

  INSERT INTO public.user_servers (user_id, server_id, ton_paid) VALUES (v_uid, _server_id, v_price);
  INSERT INTO public.transactions (user_id, type, amount, currency, status, metadata)
  VALUES (v_uid, 'server_purchase', v_price, 'ton', 'completed',
          jsonb_build_object('server_id', _server_id, 'paid_with', 'balance'))
  RETURNING id INTO v_tx;

  UPDATE public.characters SET ton_pool = ton_pool + round(v_price * 0.25, 6) WHERE is_active = true;
  v_ref := public.game_credit_referral(v_uid, v_price, 'server_purchase');

  RETURN jsonb_build_object('success', true, 'transactionId', v_tx, 'referralReward', v_ref, 'price', v_price);
END; $function$;

CREATE OR REPLACE FUNCTION public.purchase_battle_item_with_balance(_telegram_id bigint, _category text, _package_key text, _package_name text, _quantity integer, _price numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_bal numeric; v_tx uuid; v_ref numeric := 0;
BEGIN
  v_uid := public.game_profile_id(_telegram_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'profile_not_found'); END IF;
  IF _price IS NULL OR _price <= 0 OR _quantity IS NULL OR _quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  SELECT COALESCE(ton_balance, 0) INTO v_bal FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_bal < _price THEN RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance'); END IF;

  UPDATE public.profiles SET ton_balance = COALESCE(ton_balance, 0) - _price, updated_at = now() WHERE id = v_uid;

  INSERT INTO public.battle_inventory (user_id, category, package_key, package_name, quantity, total_purchased)
  VALUES (v_uid, _category, _package_key, _package_name, _quantity, _quantity)
  ON CONFLICT (user_id, package_key) DO UPDATE
    SET quantity = public.battle_inventory.quantity + EXCLUDED.quantity,
        total_purchased = public.battle_inventory.total_purchased + EXCLUDED.quantity,
        package_name = EXCLUDED.package_name,
        category = EXCLUDED.category;

  INSERT INTO public.transactions (user_id, type, amount, currency, status, metadata)
  VALUES (v_uid, 'battle_purchase', _price, 'ton', 'completed',
          jsonb_build_object('package_key', _package_key, 'quantity', _quantity, 'paid_with', 'balance'))
  RETURNING id INTO v_tx;

  UPDATE public.characters SET ton_pool = ton_pool + round(_price * 0.25, 6) WHERE is_active = true;
  v_ref := public.game_credit_referral(v_uid, _price, 'battle_purchase');

  RETURN jsonb_build_object('success', true, 'transactionId', v_tx, 'referralReward', v_ref,
    'inventory', public.get_battle_inventory_for_telegram(_telegram_id));
END; $function$;

GRANT EXECUTE ON FUNCTION public.purchase_server_with_balance(bigint, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_battle_item_with_balance(bigint, text, text, text, integer, numeric) TO anon, authenticated, service_role;
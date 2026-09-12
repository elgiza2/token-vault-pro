CREATE OR REPLACE FUNCTION public.purchase_battle_item_with_balance(
  _telegram_id bigint,
  _category text,
  _package_key text,
  _package_name text,
  _quantity integer,
  _price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _balance numeric;
  _tx_id uuid;
BEGIN
  SELECT id, ton_balance INTO _user_id, _balance FROM public.profiles WHERE telegram_id = _telegram_id;
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  IF _balance < _price THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance');
  END IF;

  UPDATE public.profiles SET ton_balance = ton_balance - _price, updated_at = now() WHERE id = _user_id;

  INSERT INTO public.battle_inventory (user_id, category, package_key, package_name, quantity, total_purchased)
  VALUES (_user_id, _category, _package_key, _package_name, _quantity, _quantity)
  ON CONFLICT (user_id, category, package_key) DO UPDATE
    SET quantity = battle_inventory.quantity + EXCLUDED.quantity,
        total_purchased = battle_inventory.total_purchased + EXCLUDED.total_purchased;

  INSERT INTO public.transactions (user_id, type, amount, status, metadata)
  VALUES (_user_id, 'battle_purchase', _price, 'completed',
          jsonb_build_object('paid_with', 'balance', 'package_key', _package_key, 'package_name', _package_name, 'quantity', _quantity))
  RETURNING id INTO _tx_id;

  RETURN jsonb_build_object('success', true, 'transactionId', _tx_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_battle_item_with_balance(bigint, text, text, text, integer, numeric) TO anon, authenticated, service_role;
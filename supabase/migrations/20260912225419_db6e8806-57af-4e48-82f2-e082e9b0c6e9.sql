DELETE FROM public.battle_inventory a
USING public.battle_inventory b
WHERE a.user_id = b.user_id
  AND a.package_key = b.package_key
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS battle_inventory_user_package_key
  ON public.battle_inventory (user_id, package_key);
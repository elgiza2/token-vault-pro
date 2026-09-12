CREATE POLICY "No direct client access to personal staking offers"
ON public.staking_personal_offers
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
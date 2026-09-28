-- Preserve the existing account deletion cascade for captured referral claims.
ALTER TABLE public.referral_signup_claims DROP CONSTRAINT referral_signup_claims_referral_code_fkey;
ALTER TABLE public.referral_signup_claims ADD CONSTRAINT referral_signup_claims_referral_code_fkey
  FOREIGN KEY(referral_code) REFERENCES public.referral_links(referral_code) ON DELETE CASCADE;

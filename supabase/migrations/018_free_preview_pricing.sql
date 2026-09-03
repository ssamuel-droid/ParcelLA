-- Make new free accounts durable redacted previews instead of time-limited full access.
-- Paid single-property entitlements are recorded from verified Stripe Checkout
-- events in subscription_events, so no additional purchase table is required.

UPDATE public.profiles
SET subscription_status = 'inactive',
    trial_ends_at = NULL,
    updated_at = NOW()
WHERE COALESCE(plan, 'free') = 'free';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    name,
    plan,
    subscription_status,
    trial_ends_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
    'free',
    'inactive',
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, public.profiles.name),
      plan = COALESCE(public.profiles.plan, 'free'),
      subscription_status = CASE
        WHEN COALESCE(public.profiles.plan, 'free') = 'free' THEN 'inactive'
        ELSE public.profiles.subscription_status
      END,
      trial_ends_at = CASE
        WHEN COALESCE(public.profiles.plan, 'free') = 'free' THEN NULL
        ELSE public.profiles.trial_ends_at
      END,
      updated_at = NOW();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auth, trial access, and Stripe subscription support.
-- Safe to run on an existing database: it only creates missing tables/columns
-- and refreshes the app policies used by the API.

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  company TEXT,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT DEFAULT 'inactive',
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free','pro','enterprise'));

CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON profiles(stripe_customer_id);

CREATE TABLE IF NOT EXISTS saved_sites (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  notes TEXT,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGSERIAL PRIMARY KEY,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  stripe_data JSONB NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  frequency TEXT DEFAULT 'daily',
  active BOOLEAN DEFAULT TRUE,
  last_run TIMESTAMPTZ,
  hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_frequency_check;
ALTER TABLE alerts
  ADD CONSTRAINT alerts_frequency_check
  CHECK (frequency IN ('instant','daily','weekly'));

CREATE INDEX IF NOT EXISTS alerts_user_idx ON alerts(user_id);

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, profiles.name),
      updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();
  END IF;
END $$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own profile" ON profiles;
CREATE POLICY "Own profile" ON profiles
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Own saved sites" ON saved_sites;
CREATE POLICY "Own saved sites" ON saved_sites
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own alerts" ON alerts;
CREATE POLICY "Own alerts" ON alerts
  USING (auth.uid() = user_id);

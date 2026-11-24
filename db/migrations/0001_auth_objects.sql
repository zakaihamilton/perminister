CREATE TABLE IF NOT EXISTS perminister_objects (
  object_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS perminister_objects_updated_at_idx
  ON perminister_objects (updated_at);

CREATE INDEX IF NOT EXISTS perminister_objects_key_pattern_idx
  ON perminister_objects (object_key text_pattern_ops);

CREATE TABLE IF NOT EXISTS perminister_rate_limits (
  namespace text NOT NULL,
  digest char(64) NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  reset_at timestamptz NOT NULL,
  PRIMARY KEY (namespace, digest)
);

CREATE INDEX IF NOT EXISTS perminister_rate_limits_reset_at_idx
  ON perminister_rate_limits (reset_at);

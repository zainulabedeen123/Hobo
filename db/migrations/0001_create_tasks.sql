CREATE TABLE IF NOT EXISTS tasks (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  text VARCHAR(240) NOT NULL CHECK (length(btrim(text)) > 0),
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  tag TEXT NOT NULL DEFAULT '' CHECK (tag IN ('', 'urgent', 'work', 'personal')),
  timer_ends_at BIGINT,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at BIGINT NOT NULL CHECK (created_at >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS tasks_user_order_idx ON tasks (user_id, position);

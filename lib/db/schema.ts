// Schema is applied idempotently (CREATE ... IF NOT EXISTS) on every boot.
// Run lifecycle: a row is inserted as `running`, then transitioned once to a
// terminal status (passed/failed/cancelled). run_logs cascade-deletes with its
// run, so keep-last-N pruning cleans both tables.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  workflow     TEXT NOT NULL,
  job          TEXT,
  event        TEXT NOT NULL,
  status       TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  duration_ms  INTEGER,
  params       TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_status     ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);

CREATE TABLE IF NOT EXISTS run_logs (
  run_id   TEXT NOT NULL,
  seq      INTEGER NOT NULL,
  job      TEXT,
  step     TEXT,
  level    TEXT,
  message  TEXT NOT NULL,
  ts       TEXT NOT NULL,
  PRIMARY KEY (run_id, seq),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
`;

CREATE TABLE IF NOT EXISTS owner_google_identity (
    owner_id integer PRIMARY KEY REFERENCES dashboard_owner(id),
    project_id text NOT NULL,
    uid text NOT NULL,
    bound_at timestamptz NOT NULL
);

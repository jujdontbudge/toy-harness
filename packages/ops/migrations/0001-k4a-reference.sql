CREATE TABLE k4a_reference_marker (
  reference_id TEXT PRIMARY KEY NOT NULL CHECK (reference_id = 'R0.K4a'),
  owner TEXT NOT NULL CHECK (owner = 'ops')
) STRICT;

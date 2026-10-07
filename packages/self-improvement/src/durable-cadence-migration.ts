export const durableCadenceMigration = `DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='toy_si_durable_owner') THEN
    CREATE ROLE toy_si_durable_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='toy_si_obligations_reader') THEN
    CREATE ROLE toy_si_obligations_reader NOLOGIN;
  END IF;
END;
$roles$;

CREATE TABLE toy_si.run (
  id uuid PRIMARY KEY,
  principal_id uuid NOT NULL,
  parent_run_id uuid,
  root_run_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile = 'toy'),
  surface text NOT NULL CHECK (length(surface) BETWEEN 1 AND 120),
  admission_key text NOT NULL CHECK (length(admission_key) BETWEEN 1 AND 240),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 240),
  task_id text,
  turn_id text,
  scheduled_slot_at timestamptz NOT NULL,
  contract_id uuid NOT NULL,
  contract_version integer NOT NULL CHECK (contract_version >= 0),
  generation bigint NOT NULL CHECK (generation >= 0),
  release_hash text NOT NULL CHECK (release_hash ~ '^[a-f0-9]{64}$'),
  budget_group_id uuid NOT NULL,
  state text NOT NULL CHECK (state = 'admitted'),
  lease_epoch bigint NOT NULL CHECK (lease_epoch >= 0),
  last_event_seq bigint NOT NULL CHECK (last_event_seq >= 0),
  admitted_at timestamptz NOT NULL,
  UNIQUE (profile, surface, admission_key)
);

CREATE TABLE toy_si.review (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES toy_si.run(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt > 0),
  contract_id uuid NOT NULL,
  contract_version integer NOT NULL CHECK (contract_version >= 0),
  generation bigint NOT NULL CHECK (generation >= 0),
  evidence_high_water bigint NOT NULL CHECK (evidence_high_water >= 0),
  verdict text NOT NULL CHECK (verdict IN ('complete', 'continue', 'waiting', 'blocked', 'failed')),
  reason text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  rubric_hash text NOT NULL CHECK (rubric_hash ~ '^[a-f0-9]{64}$'),
  judge_prompt_hash text NOT NULL CHECK (judge_prompt_hash ~ '^[a-f0-9]{64}$'),
  inventory_id uuid NOT NULL,
  release_hash text NOT NULL CHECK (release_hash ~ '^[a-f0-9]{64}$'),
  judge_call_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (run_id, attempt)
);

CREATE TABLE toy_si.review_work (
  run_id uuid PRIMARY KEY REFERENCES toy_si.run(id) ON DELETE RESTRICT,
  processing_state text NOT NULL CHECK (processing_state IN ('pending', 'running', 'reviewed')),
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_epoch bigint NOT NULL CHECK (lease_epoch >= 0),
  lease_expires_at timestamptz,
  last_error_code text,
  latest_review_id uuid REFERENCES toy_si.review(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL
);

DO $trial_constraint$
DECLARE old_constraint text;
BEGIN
  SELECT conname INTO STRICT old_constraint
  FROM pg_constraint
  WHERE conrelid='toy_si.cadence_slot'::regclass
    AND contype='c'
    AND conkey @> ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid='toy_si.cadence_slot'::regclass AND attname='arm_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid='toy_si.cadence_slot'::regclass AND attname='run_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid='toy_si.cadence_slot'::regclass AND attname='review_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid='toy_si.cadence_slot'::regclass AND attname='started_at'),
      (SELECT attnum FROM pg_attribute WHERE attrelid='toy_si.cadence_slot'::regclass AND attname='inference_done_at'),
      (SELECT attnum FROM pg_attribute WHERE attrelid='toy_si.cadence_slot'::regclass AND attname='reviewed_at'),
      (SELECT attnum FROM pg_attribute WHERE attrelid='toy_si.cadence_slot'::regclass AND attname='state')
    ]::smallint[];
  EXECUTE format('ALTER TABLE toy_si.cadence_slot DROP CONSTRAINT %I', old_constraint);
END;
$trial_constraint$;

ALTER TABLE toy_si.cadence_slot
  ADD CONSTRAINT cadence_slot_trial_outcome_check CHECK (
    (arm_id IS NULL) OR (
      run_id IS NULL AND review_id IS NULL AND started_at IS NULL AND inference_done_at IS NULL AND reviewed_at IS NULL
      AND state IN ('scheduled', 'swept', 'deferred_quota', 'deferred_auth', 'deferred_network', 'deferred_busy', 'failed', 'missed')
    )
  ),
  ADD CONSTRAINT cadence_slot_run_fk FOREIGN KEY (run_id) REFERENCES toy_si.run(id) ON DELETE RESTRICT,
  ADD CONSTRAINT cadence_slot_review_fk FOREIGN KEY (review_id) REFERENCES toy_si.review(id) ON DELETE RESTRICT,
  ADD CONSTRAINT cadence_slot_running_shape CHECK (state <> 'running' OR (run_id IS NOT NULL AND started_at IS NOT NULL)),
  ADD CONSTRAINT cadence_slot_reviewed_shape CHECK (state <> 'reviewed' OR (run_id IS NOT NULL AND review_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  ADD CONSTRAINT cadence_slot_swept_shape CHECK (state <> 'swept' OR (run_id IS NULL AND review_id IS NULL AND inference_done_at IS NULL AND reviewed_at IS NULL));

CREATE FUNCTION toy_si.validate_experimental_trial_sweep() RETURNS trigger LANGUAGE plpgsql AS $sweep$
DECLARE
  arm_manifest jsonb;
  ai_every_seconds integer;
BEGIN
  IF NEW.state <> 'swept' THEN
    RETURN NEW;
  END IF;
  IF NEW.arm_id IS NULL OR NEW.run_id IS NOT NULL OR NEW.review_id IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.inference_done_at IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
    RAISE EXCEPTION 'CADENCE_SWEEP_POLICY_UNBOUND';
  END IF;
  SELECT manifest INTO arm_manifest FROM toy_si.capacity_trial_arm WHERE id=NEW.arm_id;
  IF arm_manifest IS NULL OR arm_manifest->>'designation' IS DISTINCT FROM 'experimental' THEN
    RAISE EXCEPTION 'CADENCE_SWEEP_NOT_EXPERIMENTAL';
  END IF;
  ai_every_seconds := (arm_manifest->>'aiEverySeconds')::integer;
  IF ai_every_seconds IS NULL OR ai_every_seconds NOT IN (180, 900) OR (arm_manifest->>'clock') IS DISTINCT FROM 'fake_model' OR NEW.trial_slot_index % (ai_every_seconds / 180) = 0 THEN
    RAISE EXCEPTION 'CADENCE_SWEEP_AI_REQUIRED';
  END IF;
  RETURN NEW;
END;
$sweep$;
CREATE TRIGGER cadence_trial_sweep_policy BEFORE INSERT OR UPDATE ON toy_si.cadence_slot FOR EACH ROW EXECUTE FUNCTION toy_si.validate_experimental_trial_sweep();

CREATE FUNCTION toy_si.protect_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $review$
BEGIN
  RAISE EXCEPTION 'TURN_REVIEW_IMMUTABLE';
END;
$review$;
CREATE TRIGGER turn_review_immutable BEFORE UPDATE OR DELETE ON toy_si.review FOR EACH ROW EXECUTE FUNCTION toy_si.protect_review_immutable();

CREATE VIEW toy_si.obligations_cadence_projection AS
  SELECT job_key AS "jobKey", slot_at AS "slotAt", state, run_id AS "runId", review_id AS "reviewId", reason,
    started_at AS "startedAt", inference_done_at AS "inferenceDoneAt", reviewed_at AS "reviewedAt", updated_at AS "updatedAt"
  FROM toy_si.cadence_slot;

REVOKE ALL ON SCHEMA toy_si FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA toy_si FROM PUBLIC;
REVOKE ALL ON FUNCTION toy_si.validate_experimental_trial_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION toy_si.protect_review_immutable() FROM PUBLIC;
GRANT USAGE ON SCHEMA toy_si TO toy_si_durable_owner, toy_si_obligations_reader;
GRANT SELECT, INSERT, UPDATE ON toy_si.cadence_slot TO toy_si_durable_owner;
GRANT SELECT, INSERT ON toy_si.capacity_trial_arm TO toy_si_durable_owner;
GRANT SELECT, INSERT ON toy_si.run TO toy_si_durable_owner;
GRANT SELECT, INSERT ON toy_si.review TO toy_si_durable_owner;
GRANT SELECT, INSERT, UPDATE ON toy_si.review_work TO toy_si_durable_owner;
GRANT SELECT ON toy_si.obligations_cadence_projection TO toy_si_obligations_reader;
`;

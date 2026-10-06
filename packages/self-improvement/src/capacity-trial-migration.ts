import { cadenceSlotStateSchema } from "@toy/contracts";

const states = cadenceSlotStateSchema.options.map(state => "'" + state + "'").join(", ");
export const capacityTrialMigration = `CREATE TABLE toy_si.capacity_trial_arm (
  id uuid PRIMARY KEY,
  request_id uuid UNIQUE NOT NULL,
  job_key text NOT NULL CHECK (job_key = 'capacity.full-review'),
  anchor timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at = anchor + interval '168 hours'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  CHECK (manifest->>'armId' = id::text AND manifest->>'requestId' = request_id::text),
  CHECK (manifest->>'clock' = 'fake_model'),
  CHECK (manifest->>'designation' IN ('original', 'experimental')),
  CHECK (manifest->>'designation' <> 'original' OR manifest->>'aiEverySeconds' = '180')
);

CREATE TABLE toy_si.cadence_slot (
  job_key text NOT NULL,
  slot_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN (${states})),
  run_id uuid,
  review_id uuid,
  reason text,
  started_at timestamptz,
  inference_done_at timestamptz,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL,
  arm_id uuid REFERENCES toy_si.capacity_trial_arm(id),
  trial_slot_index integer CHECK (trial_slot_index BETWEEN 0 AND 3359),
  PRIMARY KEY (job_key, slot_at),
  UNIQUE (arm_id, trial_slot_index),
  CHECK ((arm_id IS NULL) = (trial_slot_index IS NULL)),
  CHECK (arm_id IS NULL OR (run_id IS NULL AND review_id IS NULL AND started_at IS NULL AND inference_done_at IS NULL AND reviewed_at IS NULL AND state IN ('scheduled', 'deferred_quota', 'deferred_auth', 'deferred_network', 'deferred_busy', 'failed', 'missed')))
);

CREATE FUNCTION toy_si.protect_capacity_trial() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'CAPACITY_TRIAL_BINDING_IMMUTABLE';
END;
$function$;
CREATE TRIGGER capacity_trial_binding_guard BEFORE UPDATE OR DELETE ON toy_si.capacity_trial_arm FOR EACH ROW EXECUTE FUNCTION toy_si.protect_capacity_trial();

CREATE FUNCTION toy_si.protect_trial_slot() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD.arm_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CAPACITY_TRIAL_SLOT_DELETE_REFUSED';
  END IF;
  IF (NEW.job_key, NEW.slot_at, NEW.arm_id, NEW.trial_slot_index) IS DISTINCT FROM (OLD.job_key, OLD.slot_at, OLD.arm_id, OLD.trial_slot_index) THEN
    RAISE EXCEPTION 'CAPACITY_TRIAL_SLOT_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.state <> 'scheduled' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'CAPACITY_TRIAL_OUTCOME_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER capacity_trial_slot_guard BEFORE UPDATE OR DELETE ON toy_si.cadence_slot FOR EACH ROW EXECUTE FUNCTION toy_si.protect_trial_slot();
`;

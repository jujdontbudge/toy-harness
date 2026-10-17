import { modelAdmissionWorkSchema } from "@toy/contracts";

const workClasses = modelAdmissionWorkSchema.options.flatMap<string>(option => "options" in option.shape.class
  ? option.shape.class.options : [...option.shape.class.values]);
const sqlClasses = workClasses.map(value => "'" + value.replaceAll("'", "''") + "'").join(", ");

export const modelAdmissionMigration = `BEGIN;

CREATE SCHEMA IF NOT EXISTS toy_si;

CREATE TABLE toy_si.budget_group (
  id uuid PRIMARY KEY,
  root_contract_id uuid NOT NULL,
  account_ref text NOT NULL CHECK (length(account_ref) BETWEEN 1 AND 200),
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  slice_number integer NOT NULL DEFAULT 0 CHECK (slice_number >= 0),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'restored_unreconciled')),
  started_at timestamptz,
  active_ms bigint NOT NULL DEFAULT 0 CHECK (active_ms >= 0),
  goal_turns integer NOT NULL DEFAULT 0 CHECK (goal_turns >= 0),
  model_iterations integer NOT NULL DEFAULT 0 CHECK (model_iterations >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens bigint CHECK (reasoning_tokens >= 0),
  reported_total_tokens bigint NOT NULL DEFAULT 0 CHECK (reported_total_tokens >= 0),
  unreported_calls integer NOT NULL DEFAULT 0 CHECK (unreported_calls >= 0),
  updated_at timestamptz NOT NULL,
  UNIQUE (id, account_ref, policy_hash)
);

CREATE TABLE toy_si.quota_snapshot (
  id uuid PRIMARY KEY,
  observation_seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  provider text NOT NULL CHECK (provider = 'siwc_responses'),
  account_ref text NOT NULL CHECK (length(account_ref) BETWEEN 1 AND 200),
  reported_at timestamptz NOT NULL,
  reset_at timestamptz,
  unit text NOT NULL CHECK (unit = 'named-window-percent'),
  remaining numeric CHECK (remaining BETWEEN 0 AND 100),
  body_ref text NOT NULL CHECK (length(body_ref) BETWEEN 1 AND 500),
  confidence text NOT NULL CHECK (confidence IN ('authorized', 'unavailable')),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  CHECK (observation->>'id' = id::text),
  CHECK (observation->>'accountRef' = account_ref),
  CHECK (observation ?& ARRAY['id', 'provider', 'accountRef', 'reportedAt', 'sourceAuthorized', 'schemaValid', 'status', 'windows', 'bodyRef']),
  CHECK (observation - ARRAY['id', 'provider', 'accountRef', 'reportedAt', 'sourceAuthorized', 'schemaValid', 'status', 'windows', 'bodyRef'] = '{}'::jsonb)
);

CREATE TABLE toy_si.model_call (
  id uuid PRIMARY KEY,
  run_id uuid,
  budget_group_id uuid NOT NULL,
  call_key text UNIQUE NOT NULL CHECK (length(call_key) BETWEEN 1 AND 240),
  parent_call_id uuid REFERENCES toy_si.model_call(id),
  purpose text NOT NULL CHECK (purpose IN (${sqlClasses})),
  requested_route jsonb NOT NULL CHECK (jsonb_typeof(requested_route) = 'object'),
  reported_model text,
  attempt integer NOT NULL CHECK (attempt > 0),
  state text NOT NULL CHECK (state IN ('reserved', 'sending', 'denied', 'uncertain', 'settled')),
  reserved_input bigint NOT NULL CHECK (reserved_input >= 0),
  reserved_output bigint NOT NULL CHECK (reserved_output = 4096),
  actual_input bigint CHECK (actual_input >= 0),
  actual_output bigint CHECK (actual_output >= 0),
  actual_reasoning bigint CHECK (actual_reasoning >= 0),
  actual_total bigint CHECK (actual_total >= 0),
  quota_snapshot_id uuid REFERENCES toy_si.quota_snapshot(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  account_ref text NOT NULL,
  policy_hash text NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 0),
  utc_day date NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  work jsonb NOT NULL CHECK (jsonb_typeof(work) = 'object'),
  decision jsonb NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
  reservation_charged boolean NOT NULL,
  send_lease_active boolean NOT NULL,
  native_send_count integer NOT NULL DEFAULT 0 CHECK (native_send_count BETWEEN 0 AND 1),
  native_terminal_acknowledged boolean NOT NULL DEFAULT false,
  expected_five_hour_upper_percent numeric CHECK (expected_five_hour_upper_percent >= 0),
  expected_weekly_upper_percent numeric CHECK (expected_weekly_upper_percent >= 0),
  reflected_at_snapshot_id uuid REFERENCES toy_si.quota_snapshot(id),
  settlement_hash text CHECK (settlement_hash ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY (budget_group_id, account_ref, policy_hash) REFERENCES toy_si.budget_group(id, account_ref, policy_hash),
  CHECK (requested_route ?& ARRAY['provider', 'policyDigest', 'paidFallbackPermitted']),
  CHECK (requested_route->>'provider' = 'siwc_responses'),
  CHECK (requested_route->>'policyDigest' = policy_hash),
  CHECK (requested_route->'paidFallbackPermitted' = 'false'::jsonb),
  CHECK (work->>'class' = purpose),
  CHECK (decision ? 'providerSendPermitIssued' AND decision->'providerSendPermitIssued' = 'false'::jsonb),
  CHECK (NOT send_lease_active OR reservation_charged),
  CHECK (native_send_count = 0 OR reservation_charged),
  CHECK (native_send_count = 0 OR send_lease_active OR native_terminal_acknowledged),
  CHECK (state <> 'reserved' OR (send_lease_active AND native_send_count = 0)),
  CHECK (state <> 'denied' OR (NOT send_lease_active AND native_send_count = 0)),
  CHECK (state <> 'sending' OR (send_lease_active AND native_send_count = 1)),
  CHECK (state <> 'settled' OR (NOT send_lease_active AND actual_input IS NOT NULL AND actual_output IS NOT NULL AND actual_total IS NOT NULL AND ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX model_call_single_provider_lane ON toy_si.model_call ((true)) WHERE send_lease_active;
CREATE INDEX model_call_daily_charge ON toy_si.model_call (account_ref, utc_day) WHERE reservation_charged;
CREATE INDEX model_call_budget_idx ON toy_si.model_call (budget_group_id, started_at);
CREATE INDEX quota_snapshot_account_time ON toy_si.quota_snapshot (account_ref, reported_at DESC);

CREATE FUNCTION toy_si.protect_model_accounting() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MODEL_CALL_DELETE_REFUSED';
  END IF;
  IF OLD.state = 'settled' THEN
    RAISE EXCEPTION 'MODEL_CALL_SETTLED_IMMUTABLE';
  END IF;
  IF OLD.reservation_charged AND NOT NEW.reservation_charged THEN
    RAISE EXCEPTION 'MODEL_CALL_CHARGE_IMMUTABLE';
  END IF;
  IF NEW.native_send_count < OLD.native_send_count THEN
    RAISE EXCEPTION 'MODEL_CALL_SEND_COUNT_IMMUTABLE';
  END IF;
  IF NEW.utc_day <> OLD.utc_day THEN
    RAISE EXCEPTION 'MODEL_CALL_CHARGE_DAY_IMMUTABLE';
  END IF;
  IF OLD.native_terminal_acknowledged AND NOT NEW.native_terminal_acknowledged THEN
    RAISE EXCEPTION 'MODEL_CALL_TERMINAL_ACK_IMMUTABLE';
  END IF;
  IF OLD.actual_input IS NOT NULL AND ROW(NEW.actual_input, NEW.actual_output, NEW.actual_reasoning, NEW.actual_total)
    IS DISTINCT FROM ROW(OLD.actual_input, OLD.actual_output, OLD.actual_reasoning, OLD.actual_total) THEN
    RAISE EXCEPTION 'MODEL_CALL_USAGE_IMMUTABLE';
  END IF;
  IF ROW(NEW.id, NEW.run_id, NEW.budget_group_id, NEW.call_key, NEW.parent_call_id, NEW.purpose, NEW.requested_route, NEW.attempt, NEW.reserved_input, NEW.reserved_output, NEW.started_at, NEW.account_ref, NEW.policy_hash, NEW.generation, NEW.request_hash, NEW.work, NEW.expected_five_hour_upper_percent, NEW.expected_weekly_upper_percent)
    IS DISTINCT FROM ROW(OLD.id, OLD.run_id, OLD.budget_group_id, OLD.call_key, OLD.parent_call_id, OLD.purpose, OLD.requested_route, OLD.attempt, OLD.reserved_input, OLD.reserved_output, OLD.started_at, OLD.account_ref, OLD.policy_hash, OLD.generation, OLD.request_hash, OLD.work, OLD.expected_five_hour_upper_percent, OLD.expected_weekly_upper_percent) THEN
    RAISE EXCEPTION 'MODEL_CALL_BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER model_call_accounting_guard BEFORE UPDATE OR DELETE ON toy_si.model_call FOR EACH ROW EXECUTE FUNCTION toy_si.protect_model_accounting();

CREATE FUNCTION toy_si.protect_quota_snapshot() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'QUOTA_SNAPSHOT_IMMUTABLE';
END;
$function$;

CREATE TRIGGER quota_snapshot_guard BEFORE UPDATE OR DELETE ON toy_si.quota_snapshot FOR EACH ROW EXECUTE FUNCTION toy_si.protect_quota_snapshot();
REVOKE ALL ON SCHEMA toy_si FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA toy_si FROM PUBLIC;
REVOKE ALL ON FUNCTION toy_si.protect_model_accounting() FROM PUBLIC;
REVOKE ALL ON FUNCTION toy_si.protect_quota_snapshot() FROM PUBLIC;

COMMIT;
`;

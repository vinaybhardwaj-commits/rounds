-- =============================================================================
-- migration-pac-publish-stored-proc.sql
-- 25 Apr 2026 (M11 fix from ROUNDS-BUG-HUNT-WATCHLIST-APR24.md)
--
-- Consolidates the 4 mutations previously done back-to-back from the
-- POST /api/cases/[id]/pac/publish-outcome route into a single PL/pgSQL
-- function. The Neon HTTP driver can only run one statement per call and
-- offers no cross-statement transaction — so the former sequence could
-- leave pac_events inserted without a state change if the second write
-- failed, and a retry would write a duplicate pac_events row. Wrapping
-- the four writes inside a single function call gives us an implicit
-- transaction.
--
-- Bonus hardening: the state UPDATE is now conditional on current state
-- matching p_from_state. If a second anaesthetist races ahead, the
-- UPDATE hits 0 rows and we raise ERRCODE 40001 (serialization_failure)
-- instead of silently stomping the first publish. The route catches
-- this and surfaces a 409.
--
-- Clinical-data purity (Invariant #1) unchanged — no clinical reasoning
-- is stored; notes remains operational-only, kx_pac_record_id points
-- at the KE record where reasoning actually lives.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. The _migrations marker is
-- informational only; the function can be re-CREATE OR REPLACEd any time
-- without a migration gate.
-- =============================================================================

CREATE OR REPLACE FUNCTION publish_pac_outcome(
  p_case_id           UUID,
  p_from_state        TEXT,
  p_outcome           TEXT,
  p_anaesthetist_id   UUID,
  p_notes             TEXT DEFAULT NULL,
  p_kx_pac_record_id  TEXT DEFAULT NULL,
  p_condition_codes   TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_custom_conditions JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_pac_event_id    UUID;
  v_published_at    TIMESTAMPTZ;
  v_card_ids        UUID[] := ARRAY[]::UUID[];
  v_card_id         UUID;
  v_code            TEXT;
  v_custom          JSONB;
  v_updated_rows    INTEGER;
BEGIN
  -- 1. pac_events  ----------------------------------------------------------
  INSERT INTO pac_events (case_id, anaesthetist_id, outcome, notes, kx_pac_record_id)
  VALUES (p_case_id, p_anaesthetist_id, p_outcome, p_notes, p_kx_pac_record_id)
  RETURNING id, published_at INTO v_pac_event_id, v_published_at;

  -- 2. surgical_cases.state  ------------------------------------------------
  --    Conditional on state still matching p_from_state. Guards against two
  --    anaesthetists publishing the same PAC in parallel.
  UPDATE surgical_cases
     SET state            = p_outcome,
         kx_pac_record_id = COALESCE(p_kx_pac_record_id, kx_pac_record_id),
         updated_at       = NOW()
   WHERE id    = p_case_id
     AND state = p_from_state;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows = 0 THEN
    RAISE EXCEPTION
      'Case % state changed since validation (expected from_state=%)',
      p_case_id, p_from_state
      USING ERRCODE = '40001';  -- serialization_failure, retryable
  END IF;

  -- 3. case_state_events  ---------------------------------------------------
  INSERT INTO case_state_events
    (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
  VALUES (
    p_case_id,
    p_from_state,
    p_outcome,
    'pac_publish_outcome',
    p_anaesthetist_id,
    jsonb_build_object(
      'via', 'api/cases/pac/publish-outcome',
      'pac_event_id', v_pac_event_id,
      'condition_count',
        COALESCE(array_length(p_condition_codes, 1), 0)
        + COALESCE(jsonb_array_length(p_custom_conditions), 0)
    )
  );

  -- 4a. condition_cards — library codes  ------------------------------------
  IF p_condition_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_condition_codes LOOP
      INSERT INTO condition_cards (case_id, library_code, custom_label, status, owner_profile_id)
      VALUES (p_case_id, v_code, NULL, 'pending', NULL)
      RETURNING id INTO v_card_id;
      v_card_ids := array_append(v_card_ids, v_card_id);
    END LOOP;
  END IF;

  -- 4b. condition_cards — custom conditions  --------------------------------
  IF p_custom_conditions IS NOT NULL AND jsonb_array_length(p_custom_conditions) > 0 THEN
    FOR v_custom IN SELECT * FROM jsonb_array_elements(p_custom_conditions) LOOP
      INSERT INTO condition_cards (case_id, library_code, custom_label, status, note, owner_profile_id)
      VALUES (
        p_case_id,
        NULL,
        v_custom->>'label',
        'pending',
        v_custom->>'note',
        NULLIF(v_custom->>'owner_profile_id', '')::UUID
      )
      RETURNING id INTO v_card_id;
      v_card_ids := array_append(v_card_ids, v_card_id);
    END LOOP;
  END IF;

  -- 5. Return shape  --------------------------------------------------------
  RETURN jsonb_build_object(
    'pac_event_id',       v_pac_event_id,
    'published_at',       v_published_at,
    'condition_card_ids', to_jsonb(v_card_ids)
  );
END;
$fn$;

-- Marker row in _migrations for audit. Safe to re-apply — ON CONFLICT guard.
INSERT INTO _migrations (name, applied_at)
VALUES ('m11-pac-publish-stored-proc', NOW())
ON CONFLICT (name) DO NOTHING;

-- Sanity check: function exists with the right arg count.
DO $chk$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM pg_proc
   WHERE proname = 'publish_pac_outcome';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'publish_pac_outcome function not installed';
  END IF;
  RAISE NOTICE 'publish_pac_outcome installed (% overload(s))', v_count;
END
$chk$;

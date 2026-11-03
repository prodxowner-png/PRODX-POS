-- PRODX POS post-load reconciliation. Run as an operator with cross-tenant read access.
-- Expected result: every query returns zero rows (or zero counts).

-- 1) Sales total must equal the sum of immutable sale lines including tax.
SELECT s.tenant_id, s.sale_id, s.total_minor,
       COALESCE(SUM(sl.quantity::numeric * sl.unit_price_minor + sl.tax_minor),0) AS lines_total_minor
FROM sales s
LEFT JOIN sale_lines sl ON sl.tenant_id=s.tenant_id AND sl.sale_id=s.sale_id
GROUP BY s.tenant_id,s.sale_id,s.total_minor
HAVING s.total_minor <> COALESCE(SUM(sl.quantity::numeric * sl.unit_price_minor + sl.tax_minor),0);

-- 2) Inventory balance must equal the sum of all immutable inventory deltas.
WITH ledger AS (
  SELECT tenant_id,product_id,SUM(quantity_delta::bigint) AS ledger_qty
  FROM inventory_ledger GROUP BY tenant_id,product_id
), keys AS (
  SELECT tenant_id,product_id FROM ledger
  UNION SELECT tenant_id,product_id FROM inventory_balances
)
SELECT k.tenant_id,k.product_id,COALESCE(l.ledger_qty,0) AS ledger_qty,
       COALESCE(b.quantity,0) AS balance_qty
FROM keys k
LEFT JOIN ledger l USING (tenant_id,product_id)
LEFT JOIN inventory_balances b USING (tenant_id,product_id)
WHERE COALESCE(l.ledger_qty,0) <> COALESCE(b.quantity,0);


-- 2b) Each sale/product has exactly one POS_SALE inventory delta, and it equals
-- the negative sum of sold quantities (duplicate ledger writes are not allowed).
WITH expected AS (
  SELECT tenant_id,sale_id,product_id,-SUM(quantity::bigint) AS expected_delta
  FROM sale_lines GROUP BY tenant_id,sale_id,product_id
), actual AS (
  SELECT tenant_id,sale_id,product_id,reason,COUNT(*) AS row_count,
         SUM(quantity_delta::bigint) AS actual_delta
  FROM inventory_ledger WHERE reason='POS_SALE'
  GROUP BY tenant_id,sale_id,product_id,reason
)
SELECT e.tenant_id,e.sale_id,e.product_id,e.expected_delta,
       COALESCE(a.actual_delta,0) AS actual_delta,COALESCE(a.row_count,0) AS ledger_rows
FROM expected e FULL OUTER JOIN actual a USING (tenant_id,sale_id,product_id)
WHERE e.expected_delta IS NULL OR a.actual_delta IS NULL
   OR e.expected_delta <> a.actual_delta OR COALESCE(a.row_count,0) <> 1;

-- 3) Detect duplicated idempotency keys or sales (constraints should make this empty).
SELECT tenant_id,idempotency_key,COUNT(*) AS copies
FROM pos_idempotency GROUP BY tenant_id,idempotency_key HAVING COUNT(*) > 1;
SELECT tenant_id,sale_id,COUNT(*) AS copies
FROM sales GROUP BY tenant_id,sale_id HAVING COUNT(*) > 1;

-- 4) No committed sale should have missing/duplicate line references; no PROCESSING
-- idempotency row should survive a committed transaction.
SELECT tenant_id,idempotency_key,status FROM pos_idempotency WHERE status <> 'COMMITTED';
SELECT i.tenant_id,i.sale_id FROM sales i
LEFT JOIN sale_lines l ON l.tenant_id=i.tenant_id AND l.sale_id=i.sale_id
GROUP BY i.tenant_id,i.sale_id HAVING COUNT(l.id)=0;

-- 5) Check the transactional terminal checkpoint matches committed sales.
WITH distinct_sequences AS (
  SELECT DISTINCT tenant_id,terminal_id,terminal_seq_no FROM sales
), ranked_sequences AS (
  SELECT tenant_id,terminal_id,terminal_seq_no,
         ROW_NUMBER() OVER (PARTITION BY tenant_id,terminal_id ORDER BY terminal_seq_no) AS ordinal
  FROM distinct_sequences
), sales_contiguous AS (
  SELECT tenant_id,terminal_id,
         COALESCE(MAX(terminal_seq_no) FILTER (WHERE terminal_seq_no=ordinal),0) AS last_contiguous_seq_no
  FROM ranked_sequences GROUP BY tenant_id,terminal_id
)
SELECT COALESCE(st.tenant_id,sc.tenant_id) AS tenant_id,
       COALESCE(st.terminal_id,sc.terminal_id) AS terminal_id,
       COALESCE(st.last_committed_seq_no,0) AS last_committed_seq_no,
       COALESCE(sc.last_contiguous_seq_no,0) AS sales_last_contiguous_seq_no
FROM terminal_sync_state st
FULL OUTER JOIN sales_contiguous sc USING (tenant_id,terminal_id)
WHERE COALESCE(st.last_committed_seq_no,0) <> COALESCE(sc.last_contiguous_seq_no,0);

-- 5b) Find terminal sequence gaps in committed PostgreSQL sales (sequence starts at 1).
WITH ordered AS (
  SELECT tenant_id,terminal_id,terminal_seq_no,
         LAG(terminal_seq_no,1,0) OVER (
           PARTITION BY tenant_id,terminal_id ORDER BY terminal_seq_no
         ) AS previous_seq
  FROM sales
)
SELECT tenant_id,terminal_id,previous_seq+1 AS gap_from,
       terminal_seq_no-1 AS gap_to,terminal_seq_no
FROM ordered WHERE terminal_seq_no > previous_seq+1;

-- 6) Import a trusted operator export of DO-local outbox/gap state into this temp table
-- before running the following checks. Export must be obtained through an authenticated
-- operator-only diagnostic path; never expose arbitrary tenant DO state to POS clients.
CREATE TEMP TABLE IF NOT EXISTS edge_outbox_snapshot (
  tenant_id uuid NOT NULL, terminal_id uuid NOT NULL, idempotency_key text NOT NULL,
  state text NOT NULL, failure_code text, terminal_seq_no bigint,
  last_hlc_physical_ms bigint, last_hlc_logical bigint,
  gap_from_seq_no bigint, gap_to_seq_no bigint, updated_at timestamptz
) ON COMMIT PRESERVE ROWS;
-- Example after creating the table in an interactive psql session:
\copy edge_outbox_snapshot FROM 'do-outbox-export.csv' WITH (FORMAT csv, HEADER true)
SELECT tenant_id,terminal_id,idempotency_key,state,failure_code,updated_at
FROM edge_outbox_snapshot
WHERE state IN ('ENQUEUE_PENDING','FAILED') OR (state='QUEUED' AND updated_at < now()-interval '10 minutes');
SELECT tenant_id,terminal_id,gap_from_seq_no,gap_to_seq_no
FROM edge_outbox_snapshot WHERE gap_from_seq_no IS NOT NULL OR gap_to_seq_no IS NOT NULL;

-- 7) Edge accepted and PostgreSQL committed checkpoints should converge after
-- Queue/DLQ processing is complete. A difference is pending or lost work.
SELECT e.tenant_id,e.terminal_id,e.terminal_seq_no AS edge_last_contiguous,
       COALESCE(st.last_committed_seq_no,0) AS postgres_last_committed,
       e.last_hlc_physical_ms AS edge_hlc_physical_ms,
       e.last_hlc_logical AS edge_hlc_logical,
       COALESCE(st.last_hlc_physical_ms,0) AS postgres_hlc_physical_ms,
       COALESCE(st.last_hlc_logical,0) AS postgres_hlc_logical
FROM edge_outbox_snapshot e
LEFT JOIN terminal_sync_state st ON st.tenant_id=e.tenant_id AND st.terminal_id=e.terminal_id
WHERE e.state='CHECKPOINT'
  AND (e.terminal_seq_no <> COALESCE(st.last_committed_seq_no,0)
    OR e.last_hlc_physical_ms <> COALESCE(st.last_hlc_physical_ms,0)
    OR e.last_hlc_logical <> COALESCE(st.last_hlc_logical,0));

-- CI/staging hard gate: any financial, inventory, idempotency, sequence or
-- imported Edge outbox anomaly fails psql with a non-zero exit status.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales s
    LEFT JOIN sale_lines sl ON sl.tenant_id=s.tenant_id AND sl.sale_id=s.sale_id
    GROUP BY s.tenant_id,s.sale_id,s.total_minor
    HAVING s.total_minor <> COALESCE(SUM(sl.quantity::numeric * sl.unit_price_minor + sl.tax_minor),0)
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: sales_total_mismatch'; END IF;

  IF EXISTS (
    WITH ledger AS (
      SELECT tenant_id,product_id,SUM(quantity_delta::bigint) AS ledger_qty
      FROM inventory_ledger GROUP BY tenant_id,product_id
    ), keys AS (
      SELECT tenant_id,product_id FROM ledger
      UNION SELECT tenant_id,product_id FROM inventory_balances
    )
    SELECT 1 FROM keys k
    LEFT JOIN ledger l USING (tenant_id,product_id)
    LEFT JOIN inventory_balances b USING (tenant_id,product_id)
    WHERE COALESCE(l.ledger_qty,0) <> COALESCE(b.quantity,0)
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: inventory_balance_mismatch'; END IF;

  IF EXISTS (
    WITH expected AS (
      SELECT tenant_id,sale_id,product_id,-SUM(quantity::bigint) AS expected_delta
      FROM sale_lines GROUP BY tenant_id,sale_id,product_id
    ), actual AS (
      SELECT tenant_id,sale_id,product_id,COUNT(*) AS row_count,SUM(quantity_delta::bigint) AS actual_delta
      FROM inventory_ledger WHERE reason='POS_SALE'
      GROUP BY tenant_id,sale_id,product_id
    )
    SELECT 1 FROM expected e FULL OUTER JOIN actual a USING (tenant_id,sale_id,product_id)
    WHERE e.expected_delta IS NULL OR a.actual_delta IS NULL
       OR e.expected_delta <> a.actual_delta OR a.row_count <> 1
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: sale_inventory_ledger_mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM pos_idempotency WHERE status <> 'COMMITTED'
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: uncommitted_idempotency_rows'; END IF;

  IF EXISTS (
    SELECT 1 FROM sales s LEFT JOIN sale_lines l
      ON l.tenant_id=s.tenant_id AND l.sale_id=s.sale_id
    GROUP BY s.tenant_id,s.sale_id HAVING COUNT(l.id)=0
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: sale_without_lines'; END IF;

  IF EXISTS (
    WITH distinct_sequences AS (
      SELECT DISTINCT tenant_id,terminal_id,terminal_seq_no FROM sales
    ), ranked_sequences AS (
      SELECT tenant_id,terminal_id,terminal_seq_no,
        ROW_NUMBER() OVER (PARTITION BY tenant_id,terminal_id ORDER BY terminal_seq_no) AS ordinal
      FROM distinct_sequences
    ), sales_contiguous AS (
      SELECT tenant_id,terminal_id,
        COALESCE(MAX(terminal_seq_no) FILTER (WHERE terminal_seq_no=ordinal),0) AS last_contiguous_seq_no
      FROM ranked_sequences GROUP BY tenant_id,terminal_id
    )
    SELECT 1 FROM terminal_sync_state st
    FULL OUTER JOIN sales_contiguous sc USING (tenant_id,terminal_id)
    WHERE COALESCE(st.last_committed_seq_no,0) <> COALESCE(sc.last_contiguous_seq_no,0)
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: terminal_checkpoint_mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT tenant_id,terminal_id,terminal_seq_no,
        LAG(terminal_seq_no,1,0) OVER (PARTITION BY tenant_id,terminal_id ORDER BY terminal_seq_no) AS previous_seq
      FROM sales
    ) q WHERE terminal_seq_no > previous_seq + 1
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: committed_sequence_gap'; END IF;

  IF EXISTS (
    SELECT 1 FROM edge_outbox_snapshot
    WHERE state IN ('ENQUEUE_PENDING','FAILED')
       OR (state='QUEUED' AND updated_at < now()-interval '10 minutes')
       OR gap_from_seq_no IS NOT NULL OR gap_to_seq_no IS NOT NULL
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: edge_outbox_or_sequence_anomaly'; END IF;

  IF EXISTS (
    SELECT 1 FROM edge_outbox_snapshot e
    LEFT JOIN terminal_sync_state st ON st.tenant_id=e.tenant_id AND st.terminal_id=e.terminal_id
    WHERE e.state='CHECKPOINT'
      AND (e.terminal_seq_no <> COALESCE(st.last_committed_seq_no,0)
        OR e.last_hlc_physical_ms <> COALESCE(st.last_hlc_physical_ms,0)
        OR e.last_hlc_logical <> COALESCE(st.last_hlc_logical,0))
  ) THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: edge_origin_checkpoint_mismatch'; END IF;
END $$;

SELECT 'RECONCILIATION_PASS' AS result, 0 AS anomalies;

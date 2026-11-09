-- Complete the canonical backend permission catalog used by production RBAC.
-- Keep the IDs deterministic; 0004 and later catalog migrations use this reserved range.
INSERT INTO prodx_permissions (id, permission_key, description)
VALUES
  ('10000000-0000-4000-8000-000000000021', 'branch.manage', 'Manage organization branches'),
  ('10000000-0000-4000-8000-000000000022', 'customer.read', 'View customer records'),
  ('10000000-0000-4000-8000-000000000023', 'customer.write', 'Create and update customer records'),
  ('10000000-0000-4000-8000-000000000024', 'org.manage', 'Manage organization settings and users'),
  ('10000000-0000-4000-8000-000000000025', 'org.read', 'View organization information'),
  ('10000000-0000-4000-8000-000000000026', 'pos.discount', 'Apply discretionary discounts'),
  ('10000000-0000-4000-8000-000000000027', 'pos.price_override', 'Override product prices'),
  ('10000000-0000-4000-8000-000000000028', 'report.read', 'View operational reports'),
  ('10000000-0000-4000-8000-000000000029', 'settings.manage', 'Manage application and store settings'),
  ('10000000-0000-4000-8000-000000000030', 'terminal.manage', 'Manage POS terminals')
ON CONFLICT (permission_key) DO NOTHING;

-- Existing owners receive the full new catalog, matching first-tenant bootstrap.
INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM prodx_roles r
  JOIN prodx_permissions p ON p.permission_key IN (
    'branch.manage', 'customer.read', 'customer.write', 'org.manage', 'org.read',
    'pos.discount', 'pos.price_override', 'report.read', 'settings.manage', 'terminal.manage'
  )
 WHERE r.role_key IN ('owner', 'admin') AND r.active = TRUE
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

-- Managers receive operational discount, price, customer, reporting and settings rights.
INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM prodx_roles r
  JOIN prodx_permissions p ON p.permission_key IN (
    'customer.read', 'customer.write', 'org.read', 'pos.discount',
    'pos.price_override', 'report.read', 'settings.manage'
  )
 WHERE r.role_key = 'manager' AND r.active = TRUE
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

-- Cashiers retain customer lookup/edit rights; discretionary discount remains fail-closed
-- until the server-side supervisor-threshold authorization flow is implemented.
INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM prodx_roles r
  JOIN prodx_permissions p ON p.permission_key IN ('customer.read', 'customer.write')
 WHERE r.role_key = 'cashier' AND r.active = TRUE
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0054_m9_complete_permission_catalog')
ON CONFLICT (version) DO NOTHING;

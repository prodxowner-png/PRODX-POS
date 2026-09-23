-- PRODX POS AI provider boundary
-- Register the authenticated AI capability used by the Gemini-only production route.

INSERT INTO prodx_permissions (id, permission_key, description)
VALUES (
  '10000000-0000-4000-8000-000000000016',
  'ai:use',
  'Use the authenticated Gemini AI assistant'
)
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO prodx_schema_migrations (version)
VALUES ('0018_ai_gemini_provider')
ON CONFLICT (version) DO NOTHING;

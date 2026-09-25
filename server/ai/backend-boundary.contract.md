# AI Backend Boundary Contract

- Caller: authenticated production backend request.
- Principal source: verified backend authentication/session context.
- Required scope: user, organization, and store.
- Required permission: ai:use.
- Authorization completes before Gemini provider execution.
- Provider credentials remain server-side.
- Browser-supplied principal fields are not trusted as authentication evidence.
- Production HTTP route: POST /api/v1/ai/chat.
- Production provider: Gemini only.

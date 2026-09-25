# Backend AI Boundary

This is the production application-service boundary behind the authenticated HTTP route.

The production authentication backend validates the session first, derives the verified user/organization/store principal, enforces ai:use, and only then invokes the AI gateway/provider.

Current production route: POST /api/v1/ai/chat.

Current production provider: Gemini only.

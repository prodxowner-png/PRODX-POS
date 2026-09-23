# AI Integration Final — Runtime Boundary

The production HTTP adapter is implemented at POST /api/v1/ai/chat and constructs the verified principal from server authentication context before invoking the AI gateway.

The browser supplies request content and the current session bearer; it does not supply authoritative identity, permissions, provider credentials, or tenant scope.

Current production provider: Gemini only.

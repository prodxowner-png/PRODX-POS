# M2 Authentication Lockout Policy

Status: approved for implementation by the product owner on 2026-09-14.

Implementation status: enforced by the authentication service and persisted by PostgreSQL security-audit events; fresh exact-head auth-security CI is passing.

- Five consecutive failed password attempts trigger lockout.
- Lockout lasts 15 minutes from the fifth failed attempt.
- Scope is the user's password credential identity.
- Attempts received during active lockout are rejected without changing the counter or extending the lockout.
- A successful authentication resets the failed-attempt counter and clears the lockout timestamp.
- Lockout is recorded as AUTH_LOCKOUT with tenant/user identity and lockout metadata.
- A successful authentication that clears failed-attempt state is recorded as AUTH_LOCKOUT_RESET with the prior state.
- Security-event writes are performed in the same PostgreSQL statement as the credential state transition so an audit write cannot silently diverge from the authentication state change.
- The security-event table is tenant-scoped, append-oriented, and indexed by organization/time and user/time.
- The server remains authoritative; clients cannot clear or bypass lockout state.

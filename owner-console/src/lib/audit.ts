export interface OwnerAuditEvent {
  event_id: string;
  occurred_at: string;
  event_type: string;
  actor_user_id: string | null;
  outcome: "denied" | "success" | null;
  reason_code: string | null;
  source: "supabase_auth" | "server_verified" | "trusted_admin";
}

interface OwnerAuditClient {
  functions: {
    invoke(
      name: string,
      options: {
        method: "GET";
        headers: Record<string, string>;
      },
    ): Promise<{
      data: { events?: unknown } | null;
      error: unknown;
    }>;
  };
}

export async function fetchOwnerAuditEvents(
  client: OwnerAuditClient,
  accessToken: string,
): Promise<OwnerAuditEvent[]> {
  if (!accessToken.trim()) throw new Error("unauthorized");

  const { data, error } = await client.functions.invoke("owner-audit", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error || !data || !Array.isArray(data.events)) {
    throw new Error("audit_unavailable");
  }
  return data.events as OwnerAuditEvent[];
}

# Security & Data Handling Policy

DRAFT — requires review. Forms part of the DPA.

## Access
- Every system uses individual named accounts. No shared logins.
- MFA is mandatory on Retell, Supabase, n8n, GHL, Google Workspace, ManyChat, and the domain registrar.
- Client credentials live in a password manager, never in plaintext, never in chat, never in a workflow
  node, never in a repository.
- Access is least-privilege and reviewed quarterly. Access is revoked within 24 hours of a person
  leaving or a client terminating.

## Data storage
- Postgres (Supabase) in the EU (Frankfurt). Encrypted at rest.
- All transport over TLS.
- Row-level security enforces tenant isolation. No query path may read across tenants. This is tested,
  not assumed.
- Call recordings held by Retell under its retention setting, deleted at 90 days.

## Secrets
- Configuration and secrets separated. Secrets in environment variables or the platform's secret store.
- Repository contains `.env.example` only. A real credential committed to the repository is treated as
  a breach: rotate first, investigate second.
- Webhook endpoints authenticate the caller. An unauthenticated booking webhook is an open door to
  anyone who finds the URL.

## Retention
As per the DPA Section 7. Deletion jobs run monthly and are logged. A deletion request executes across
Postgres, GHL, Retell, ManyChat, and Google Calendar — all five, or it has not happened.

## Breach response
1. Contain — revoke credentials, disable the affected path.
2. Assess — what data, how many people, over what period.
3. Notify the client within 24 hours of becoming aware.
4. Support the client's notification to the FDPIC where the breach is likely to result in high risk.
5. Write it up. What failed, why, what changed.

## Sub-processor changes
30 days' notice to clients before adding or replacing a sub-processor.

## Known gaps
Recorded honestly, to be closed before the first client goes live:
- Transfer basis for US-hosted sub-processors not yet confirmed per provider (see DPA Section 5).
- Penetration testing not yet performed.
- No formal business continuity plan for loss of the n8n cloud instance.

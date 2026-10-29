# Data Ownership, Deployment and Service-Level Agreement

## 1. Purpose and status

This document records the proposed ownership, access, hosting, support, and backup arrangements for the cafe POS system. It is intended for review and signature by the restaurant business owner (the **Client**) and the software provider (the **Service Provider**).

Commercial figures below are planning amounts, not provider quotations or a substitute for a signed commercial agreement. Provider plan prices, taxes, exchange rates, usage, and the agreed maintenance retainer must be confirmed before production deployment.

## 2. Ownership and access

### Business data

The Client, as the restaurant business owner, retains **100% full legal ownership and control** of all business data created, collected, stored, or processed by the system. This includes sales, bills, inventory, employee information, customer records, reports, audit logs, backups, and the database itself.

The Client has the right to access, export, correct, retain, and delete its data, subject to applicable law and the Client's record-retention obligations. The Service Provider receives no ownership interest in this data. Any access by the Service Provider is limited to work authorized by the Client and must be kept confidential.

### Accounts, assets, and responsibilities

| Asset or access | Owner / account holder | Client responsibility | Service Provider responsibility |
|---|---|---|---|
| Application source code and project-specific deliverables | Client, upon completion of the agreed transfer/payment terms | Retain the repository and grant only necessary access | Transfer the source repository and deployment instructions; disclose third-party and open-source components and their applicable licenses |
| Domain name and DNS | Client, registered in the Client's legal/business name and controlled email | Pay renewal fees; retain registrar and DNS administrator access | Configure DNS when authorized; do not register or hold the domain in a personal account |
| Cloud hosting (for example, Netlify) | Client-owned provider account | Own billing and administrator access; approve plan changes | Deploy and maintain the application under delegated, least-privilege access |
| PostgreSQL service (for example, Neon) | Client-owned provider account | Own billing, database project, administrator access, and recovery access | Configure the application connection and database under delegated access |
| Database credentials, API keys, and deployment secrets | Client controls the accounts and secrets | Store credentials securely; authorize users; rotate credentials when access changes | Use secrets only for authorized operations; never commit them to source control or include them in reports |
| Backups and exports | Client | Maintain access to the backup destination and retention policy | Perform or assist with backups and restore tests as agreed below |

The Client must be able to access the production provider consoles and retrieve the production database without depending on the Service Provider. At handover, the parties should verify the Client's administrator access, recovery email/phone, billing contact, repository access, and a tested database export.

## 3. Monthly fees and billing

The following is an **illustrative planning budget in Sri Lankan Rupees (LKR)** based on the assumption that the project remains within provider free-tier limits. It is not a guaranteed price. Provider charges are variable and may change without notice.

| Category | Service / item | Monthly planning amount (LKR) | Billing and assumptions |
|---|---|---:|---|
| Cloud hosting | Netlify application hosting | 0 | Assumes an eligible free tier and usage within its limits. Paid features, bandwidth, build, or usage charges are additional at the provider's actual rate. |
| Cloud hosting | Neon PostgreSQL database | 0 | Assumes an eligible free tier and usage within its limits. Compute, storage, backup retention, and other paid usage are additional at the provider's actual rate. |
| Cloud hosting | Domain registration and renewal | To be confirmed | Registrar charges are normally billed annually. The Client pays the registrar directly; any monthly equivalent depends on the selected domain and registrar. |
| Cloud hosting | Taxes, currency conversion, and provider overages | At actual cost | Billed by the relevant provider or payment provider; not included in the free-tier assumptions. |
| Software support and maintenance | Proposed monthly support retainer | 15,000 | Proposed LKR/month, subject to written Client approval and a signed support scope. Excludes provider fees, new features, major redesigns, and out-of-scope work unless separately agreed. |
| Software support and maintenance | Out-of-scope work | By written estimate | Work begins only after the Client approves the estimate and schedule. |

Cloud hosting fees and software support/maintenance fees are separate. Provider accounts should be billed directly to the Client wherever available. The Service Provider must not mark up, combine, or represent provider charges as maintenance fees without prior written agreement.

### Proposed support service levels

Support is provided during mutually agreed business hours, excluding Sri Lankan public holidays unless otherwise agreed. Response time means acknowledgement and initial triage, not guaranteed resolution.

| Priority | Example | Target initial response |
|---|---|---|
| P1 — Critical | Production POS unavailable for all users; suspected data loss or security incident | Within 4 business hours |
| P2 — High | Major function unavailable with no reasonable workaround | Within 1 business day |
| P3 — Normal | Limited defect with a workaround, or routine operational question | Within 3 business days |
| P4 — Request | Enhancement, training, or change request | Acknowledgement within 5 business days; delivery date by separate agreement |

The Client should report the issue, time observed, affected users, and any relevant error message through the agreed support channel. The Service Provider will provide status updates for P1/P2 incidents during active handling. These targets do not guarantee uninterrupted service; cloud provider availability and Internet connectivity are outside the Service Provider's direct control.

## 4. Backup and recovery guidelines

### Schedule and handling

1. **Daily database snapshot/export:** Create a database backup at least once every 24 hours. Use the database provider's automated point-in-time/snapshot feature where enabled, and create a logical export (for example, `pg_dump`) to a Client-controlled, access-restricted storage location.
2. **Retention:** Retain daily backups for at least 30 days, subject to provider capabilities, legal obligations, and the Client's approved storage policy. Retain any longer-term archive according to the Client's accounting and records-retention requirements.
3. **Protection:** Encrypt backups in transit and at rest. Restrict access to named authorized personnel, keep backup credentials separate from application credentials, and record backup dates and outcomes. Do not store production credentials in the backup itself.
4. **Verification:** Confirm the backup job completed and the backup is non-empty/readable. Perform a restore test at least quarterly in a non-production environment, and after material database or hosting changes.
5. **Application and configuration:** Keep source code in the Client-owned repository. Document required environment variables and deployment steps without including secret values. A `db.json` local fallback file is not a substitute for a production PostgreSQL backup.
6. **Recovery targets:** Proposed targets, to be approved by the Client: Recovery Point Objective (RPO) of 24 hours and Recovery Time Objective (RTO) of 1 business day after a valid backup and required provider access are available. Provider incidents, data corruption discovered late, and missing credentials can extend recovery time.

Daily backups must be configured and monitored in the selected production provider account before go-live. If the chosen provider plan does not include daily snapshots or the needed retention, the Client must approve an appropriate paid plan or the parties must implement an alternative export destination. The free-tier budget above does not guarantee backup or point-in-time-recovery features.

### Restore responsibility matrix

| Activity | Client | Service Provider |
|---|---|---|
| Own the database and backup storage accounts; maintain billing and recovery contacts | Accountable | No ownership |
| Approve backup frequency, retention, recovery targets, and any paid provider plan | Accountable | Advise on configuration and cost |
| Configure application-level scheduled exports and monitoring, if included in the approved deployment scope | Provide account access and approve storage | Responsible for setup and documenting the job |
| Monitor backup completion and report failures | Ensure an authorized contact reviews alerts | Review configured alerts and investigate failures within the agreed support scope |
| Request a restore and identify the required recovery point | Responsible for authorization and business-impact confirmation | Coordinate and execute the restore when authorized and access is available |
| Approve production restore, downtime window, and post-restore business validation | Accountable; verify bills, inventory, and reports | Provide technical assistance and document restore outcome |
| Restore when the Service Provider is unavailable or the support agreement has ended | Responsible, using transferred access and documented procedure; may appoint another provider | Transfer documentation and credentials under the handover agreement |
| Pay third-party recovery, storage, or emergency-service fees | Responsible for approval and payment | Obtain approval before incurring discretionary charges |

No production restore that may overwrite newer data should be performed without the Client's authorization, except where an emergency action has been explicitly pre-authorized in writing.

## 5. Handover checklist

- [ ] Client confirms legal/business ownership of source repository and project deliverables under the agreed transfer terms.
- [ ] Domain is registered to the Client and Client administrator access is tested.
- [ ] Netlify/hosting and Neon/database accounts, billing contacts, and administrator access are controlled by the Client.
- [ ] Production secrets are transferred through a secure channel, not in this document or source control; credentials are rotated after handover where appropriate.
- [ ] Database export is delivered and its readability is verified.
- [ ] Daily backup schedule, storage location, retention, and alert recipient are documented and tested.
- [ ] A restore test is completed and its result is recorded.
- [ ] Monthly provider costs and the software support retainer are confirmed in writing.
- [ ] Support contact, business hours, and escalation contacts are agreed.

## 6. Approval

The undersigned acknowledge the ownership, responsibilities, backup guidelines, and proposed commercial terms above. The planning amounts and proposed support targets become binding only when confirmed in a signed agreement.

|  | Client / Restaurant Owner | Service Provider |
|---|---|---|
| Name |  |  |
| Signature |  |  |
| Date |  |  |

//! Atomic application service for unauthenticated public booking requests.
//!
//! The public HTTP boundary is responsible for rate limiting, canonical request
//! hashing, keyed idempotency/phone digests, and deriving the opaque management
//! credential. This module accepts only those digests and commits the command
//! receipt, normalized operational state, append-only consent, domain event,
//! and redacted outbox row in one writer transaction.

use airhop_core::{BookingStatus, PublicBookingPurpose, StableLessonReference};
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::booking::{
    get_booking_by_id, reserve_booking, BookingRecord, BookingVisitKind, NewBooking,
};
use super::{
    append_domain_event, commit_command, enqueue_outbox, insert_pending_command, ActorKind,
    AirhopActor, CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent,
    NewOutboxMessage, PrivacyClass,
};
use crate::{Db, DbError, Result};

const COMMAND_TYPE: &str = "CreatePublicBooking";
const EVENT_TYPE: &str = "airhop.booking.requested.v1";
const OUTBOX_DESTINATION: &str = "airhop.booking.requested";

/// Contact route selected by the public applicant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreferredContactChannel {
    /// Contact through Telegram.
    Telegram,
    /// Contact through MAX.
    Max,
    /// Contact through WhatsApp.
    Whatsapp,
    /// Contact by phone.
    Phone,
    /// No preferred route was selected.
    None,
}

impl PreferredContactChannel {
    pub(super) const fn as_db_str(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::Max => "max",
            Self::Whatsapp => "whatsapp",
            Self::Phone => "phone",
            Self::None => "none",
        }
    }
}

/// Public surface that accepted the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicBookingSurface {
    /// Standalone center booking page.
    Standalone,
    /// Booking widget embedded into another page.
    Embedded,
}

impl PublicBookingSurface {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Standalone => "standalone",
            Self::Embedded => "embedded",
        }
    }
}

/// Applicant fields accepted by the public booking boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicBookingApplicant {
    /// Parent or other representative display name.
    pub parent_name: String,
    /// E.164 phone number used for exact matching after keyed digest lookup.
    pub phone_normalized: String,
    /// Phone formatting shown by the applicant at submission time.
    pub phone_display: String,
    /// Child display name.
    pub child_name: String,
    /// Child date of birth.
    pub child_birth_date: NaiveDate,
    /// Preferred route for operational follow-up.
    pub preferred_contact_channel: PreferredContactChannel,
    /// Version of the public-booking policy explicitly accepted by the applicant.
    pub consent_policy_version: String,
}

/// Server-authenticated envelope plus public booking data.
#[derive(Debug, Clone, PartialEq)]
pub struct CreatePublicBookingInput {
    /// Stable occurrence identity selected from server-provided availability.
    pub lesson_ref: StableLessonReference,
    /// Applicant identity fields.
    pub applicant: PublicBookingApplicant,
    /// Public surface that accepted the request.
    pub surface: PublicBookingSurface,
    /// Optional active branch used for source attribution.
    pub attribution_branch_id: Option<Uuid>,
    /// Keyed digest of the caller idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Keyed digest used to locate exact phone matches without indexing raw PII.
    pub phone_match_digest: [u8; 32],
    /// Tenant-scoped keyed digest of the canonical request body.
    pub request_hash: [u8; 32],
    /// Keyed digest of the opaque management credential returned by the route.
    pub management_token_digest: [u8; 32],
    /// Secret-key version used for the management credential digest.
    pub management_key_version: i16,
    /// Structured consent evidence retained only in the consent ledger.
    pub consent_evidence: Value,
}

/// Whether this call created state or replayed a committed command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicBookingDisposition {
    /// This call created the booking and its accompanying evidence.
    Created,
    /// An identical idempotent command had already committed.
    Replayed,
}

/// Deterministic application result for a public booking command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatePublicBookingOutcome {
    /// Whether the transaction created state or returned a prior result.
    pub disposition: PublicBookingDisposition,
    /// Authoritative booking row.
    pub booking: BookingRecord,
    /// Key version the route must use to reproduce the opaque management credential.
    pub management_key_version: i16,
}

#[derive(Debug)]
struct OrganizationClock {
    id: Uuid,
    current_date: NaiveDate,
    current_instant: DateTime<Utc>,
    purpose: PublicBookingPurpose,
}

#[derive(Debug)]
struct NormalizedApplicant {
    parent_name: String,
    phone_normalized: String,
    phone_display: String,
    child_name: String,
    normalized_child_name: String,
    child_birth_date: NaiveDate,
    preferred_contact_channel: PreferredContactChannel,
    consent_policy_version: String,
}

#[derive(Debug)]
struct RepresentativeCandidate {
    id: Uuid,
    family_id: Uuid,
    active: bool,
}

#[derive(Debug)]
struct ResolvedIdentity {
    family_id: Uuid,
    representative_id: Uuid,
    child_id: Uuid,
    consent_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCommandResult {
    booking_id: Uuid,
    management_key_version: i16,
}

impl Db {
    /// Creates or idempotently replays one public booking transaction.
    ///
    /// Organization scope is derived only from `tenant`. An untrusted caller
    /// cannot provide either `community_id` or `organization_id`. Identity
    /// matching is serialized per keyed phone digest, and the occurrence row
    /// is locked before the final policy, age, and capacity checks.
    pub async fn create_public_booking(
        &self,
        tenant: &TenantContext,
        input: &CreatePublicBookingInput,
    ) -> Result<CreatePublicBookingOutcome> {
        validate_envelope(input)?;
        let mut transaction = self.pool.begin().await?;
        let organization = resolve_organization(&mut transaction, tenant).await?;
        let actor = public_actor();
        let command_input = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id: organization.id,
            command_type: COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command_input).await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_existing_command(transaction, tenant, organization.id, command)
                    .await;
            }
        };

        let applicant = normalize_applicant(&input.applicant, organization.current_date)?;
        validate_attribution_branch(
            &mut transaction,
            tenant,
            organization.id,
            input.attribution_branch_id,
        )
        .await?;
        acquire_identity_lock(
            &mut transaction,
            tenant,
            organization.id,
            &input.phone_match_digest,
            &applicant.phone_normalized,
        )
        .await?;
        let identity = resolve_identity(
            &mut transaction,
            tenant,
            organization.id,
            &applicant,
            input,
            organization.current_instant,
        )
        .await?;

        let booking_id = Uuid::new_v4();
        let visit_kind = visit_kind(organization.purpose);
        let booking = reserve_booking(
            &mut transaction,
            tenant,
            &NewBooking {
                id: booking_id,
                organization_id: organization.id,
                family_id: identity.family_id,
                representative_id: identity.representative_id,
                child_id: identity.child_id,
                consent_id: identity.consent_id,
                lesson_ref: input.lesson_ref,
                command_id: command.id,
                applicant_snapshot: applicant_snapshot(&applicant, organization.current_instant),
                visit_kind,
                status: BookingStatus::PendingConfirmation,
                management_token_digest: input.management_token_digest,
                management_key_version: input.management_key_version,
                source: booking_source(
                    input.surface,
                    input.attribution_branch_id,
                    organization.purpose,
                ),
                actor: actor.clone(),
                created_by: "public-booking".to_owned(),
                internal_comment: None,
            },
        )
        .await?;

        let event_id = Uuid::new_v4();
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: event_id,
                organization_id: organization.id,
                stream_type: "booking".to_owned(),
                stream_id: booking.id,
                stream_version: 1,
                event_type: EVENT_TYPE.to_owned(),
                schema_version: 1,
                occurred_at: organization.current_instant,
                actor,
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "bookingId": booking.id,
                    "familyId": booking.family_id,
                    "representativeId": booking.representative_id,
                    "childId": booking.child_id,
                    "recurrenceRuleId": booking.lesson_ref.recurrence_rule_id,
                    "originalDate": booking.lesson_ref.original_date,
                    "visitKind": visit_kind.as_db_str(),
                    "status": "pending_confirmation"
                }),
                privacy_class: PrivacyClass::SensitiveChild,
            },
        )
        .await?;
        enqueue_outbox(
            &mut transaction,
            tenant,
            &NewOutboxMessage {
                id: Uuid::new_v4(),
                organization_id: organization.id,
                event_id,
                destination: OUTBOX_DESTINATION.to_owned(),
                redacted_payload: json!({
                    "bookingId": booking.id,
                    "recurrenceRuleId": booking.lesson_ref.recurrence_rule_id,
                    "originalDate": booking.lesson_ref.original_date,
                    "visitKind": visit_kind.as_db_str(),
                    "status": "pending_confirmation"
                }),
                not_before: organization.current_instant,
            },
        )
        .await?;
        let stored_result = serde_json::to_value(StoredCommandResult {
            booking_id: booking.id,
            management_key_version: input.management_key_version,
        })?;
        commit_command(
            &mut transaction,
            tenant,
            organization.id,
            command.id,
            &stored_result,
        )
        .await?;
        transaction.commit().await?;
        Ok(CreatePublicBookingOutcome {
            disposition: PublicBookingDisposition::Created,
            booking,
            management_key_version: input.management_key_version,
        })
    }
}

async fn resolve_organization(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
) -> Result<OrganizationClock> {
    let row = sqlx::query(
        "SELECT id, public_booking_purpose, \
                (now() AT TIME ZONE time_zone)::date AS current_date, \
                now() AS current_instant \
         FROM airhop_organizations \
         WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
    let purpose = match row.try_get::<&str, _>("public_booking_purpose")? {
        "trial" => PublicBookingPurpose::Trial,
        "lesson" => PublicBookingPurpose::Lesson,
        other => {
            return Err(DbError::InvalidData(format!(
                "unknown AirHub public booking purpose {other:?}"
            )))
        }
    };
    Ok(OrganizationClock {
        id: row.try_get("id")?,
        current_date: row.try_get("current_date")?,
        current_instant: row.try_get("current_instant")?,
        purpose,
    })
}

async fn replay_existing_command(
    mut transaction: Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    command: super::AirhopCommand,
) -> Result<CreatePublicBookingOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredCommandResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            let booking =
                get_booking_by_id(&mut transaction, tenant, organization_id, stored.booking_id)
                    .await?
                    .ok_or_else(|| DbError::NotFound("committed AirHub booking".to_owned()))?;
            transaction.commit().await?;
            Ok(CreatePublicBookingOutcome {
                disposition: PublicBookingDisposition::Replayed,
                booking,
                management_key_version: stored.management_key_version,
            })
        }
    }
}

fn validate_envelope(input: &CreatePublicBookingInput) -> Result<()> {
    if input.lesson_ref.recurrence_rule_id.is_nil() {
        return Err(DbError::InvalidData(
            "AirHub recurrence rule id cannot be nil".to_owned(),
        ));
    }
    if input.management_key_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub management key version must be positive".to_owned(),
        ));
    }
    if input.attribution_branch_id.is_some_and(|id| id.is_nil()) {
        return Err(DbError::InvalidData(
            "AirHub attribution branch id cannot be nil".to_owned(),
        ));
    }
    if !input.consent_evidence.is_object() {
        return Err(DbError::InvalidData(
            "AirHub consent evidence must be an object".to_owned(),
        ));
    }
    if serde_json::to_vec(&input.consent_evidence)?.len() > 16_384 {
        return Err(DbError::InvalidData(
            "AirHub consent evidence is too large".to_owned(),
        ));
    }
    Ok(())
}

fn normalize_applicant(
    input: &PublicBookingApplicant,
    organization_date: NaiveDate,
) -> Result<NormalizedApplicant> {
    let parent_name = bounded_text(&input.parent_name, 160, "representative name")?;
    let child_name = bounded_text(&input.child_name, 160, "child name")?;
    let phone_display = bounded_text(&input.phone_display, 80, "phone display")?;
    let consent_policy_version =
        bounded_text(&input.consent_policy_version, 80, "consent policy version")?;
    let phone_normalized = input.phone_normalized.trim().to_owned();
    validate_e164(&phone_normalized)?;
    if input.child_birth_date > organization_date {
        return Err(DbError::InvalidData(
            "AirHub child birth date cannot be in the future".to_owned(),
        ));
    }
    Ok(NormalizedApplicant {
        parent_name,
        phone_normalized,
        phone_display,
        normalized_child_name: normalize_name(&child_name),
        child_name,
        child_birth_date: input.child_birth_date,
        preferred_contact_channel: input.preferred_contact_channel,
        consent_policy_version,
    })
}

fn bounded_text(value: &str, maximum_chars: usize, label: &str) -> Result<String> {
    let normalized = collapse_whitespace(value);
    if normalized.is_empty() || normalized.chars().count() > maximum_chars {
        return Err(DbError::InvalidData(format!("AirHub {label} is invalid")));
    }
    Ok(normalized)
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_name(value: &str) -> String {
    collapse_whitespace(value).to_lowercase()
}

fn validate_e164(value: &str) -> Result<()> {
    let digits = value.strip_prefix('+').ok_or_else(|| {
        DbError::InvalidData("AirHub phone number must use E.164 format".to_owned())
    })?;
    if !(10..=15).contains(&digits.len())
        || digits.starts_with('0')
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(DbError::InvalidData(
            "AirHub phone number must use E.164 format".to_owned(),
        ));
    }
    Ok(())
}

async fn validate_attribution_branch(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    branch_id: Option<Uuid>,
) -> Result<()> {
    let Some(branch_id) = branch_id else {
        return Ok(());
    };
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS ( \
             SELECT 1 FROM airhop_branches \
             WHERE community_id = $1 AND organization_id = $2 \
               AND id = $3 AND status = 'active' \
         )",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(branch_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !exists {
        return Err(DbError::InvalidData(
            "AirHub attribution branch is unavailable".to_owned(),
        ));
    }
    Ok(())
}

async fn acquire_identity_lock(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    phone_match_digest: &[u8; 32],
    phone_normalized: &str,
) -> Result<()> {
    let identity_key = format!(
        "{}:{organization_id}:{}:{phone_normalized}",
        tenant.community(),
        hex::encode(phone_match_digest)
    );
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(identity_key)
        .fetch_one(&mut **transaction)
        .await?;
    Ok(())
}

async fn resolve_identity(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    applicant: &NormalizedApplicant,
    input: &CreatePublicBookingInput,
    occurred_at: DateTime<Utc>,
) -> Result<ResolvedIdentity> {
    let representative_rows = sqlx::query(
        "SELECT representative.id, representative.family_id, \
                representative.status = 'active' AND family.status = 'active' AS active \
         FROM airhop_representatives representative \
         JOIN airhop_families family \
           ON family.community_id = representative.community_id \
          AND family.organization_id = representative.organization_id \
          AND family.id = representative.family_id \
         WHERE representative.community_id = $1 \
           AND representative.organization_id = $2 \
           AND representative.phone_match_digest = $3 \
           AND representative.phone_normalized = $4 \
         ORDER BY representative.id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.phone_match_digest.as_slice())
    .bind(&applicant.phone_normalized)
    .fetch_all(&mut **transaction)
    .await?;
    let candidates = representative_rows
        .into_iter()
        .map(|row| {
            Ok(RepresentativeCandidate {
                id: row.try_get("id")?,
                family_id: row.try_get("family_id")?,
                active: row.try_get("active")?,
            })
        })
        .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?;

    let (family_id, representative_id, created_representative) =
        if let Some(candidate) = unique_active_representative(&candidates) {
            (candidate.family_id, candidate.id, false)
        } else {
            let family_id = Uuid::new_v4();
            let representative_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO airhop_families ( \
                     community_id, organization_id, id, display_name, primary_representative_id \
                 ) VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(family_id)
            .bind(format!("Семья {}", applicant.parent_name))
            .bind(representative_id)
            .execute(&mut **transaction)
            .await?;
            sqlx::query(
                "INSERT INTO airhop_representatives ( \
                     community_id, organization_id, id, family_id, display_name, \
                     phone_normalized, phone_display, phone_match_digest, \
                     preferred_contact_channel \
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(representative_id)
            .bind(family_id)
            .bind(&applicant.parent_name)
            .bind(&applicant.phone_normalized)
            .bind(&applicant.phone_display)
            .bind(input.phone_match_digest.as_slice())
            .bind(applicant.preferred_contact_channel.as_db_str())
            .execute(&mut **transaction)
            .await?;
            for existing in &candidates {
                insert_duplicate_candidate(
                    transaction,
                    tenant,
                    organization_id,
                    "representative",
                    representative_id,
                    "representative",
                    existing.id,
                    "phone",
                )
                .await?;
            }
            (family_id, representative_id, true)
        };

    let child_id = if created_representative {
        insert_child(transaction, tenant, organization_id, family_id, applicant).await?
    } else {
        resolve_child(transaction, tenant, organization_id, family_id, applicant).await?
    };
    let consent_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO airhop_consents ( \
             community_id, organization_id, id, representative_id, purpose, channel, \
             policy_version, status, effective_at, evidence \
         ) VALUES ($1, $2, $3, $4, 'public_booking', 'web', $5, 'granted', $6, $7)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(consent_id)
    .bind(representative_id)
    .bind(&applicant.consent_policy_version)
    .bind(occurred_at)
    .bind(&input.consent_evidence)
    .execute(&mut **transaction)
    .await?;
    Ok(ResolvedIdentity {
        family_id,
        representative_id,
        child_id,
        consent_id,
    })
}

fn unique_active_representative(
    candidates: &[RepresentativeCandidate],
) -> Option<&RepresentativeCandidate> {
    let mut active = candidates.iter().filter(|candidate| candidate.active);
    let result = active.next()?;
    active.next().is_none().then_some(result)
}

async fn resolve_child(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    family_id: Uuid,
    applicant: &NormalizedApplicant,
) -> Result<Uuid> {
    let rows = sqlx::query(
        "SELECT id, display_name, birth_date, status \
         FROM airhop_children \
         WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 \
         ORDER BY id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(family_id)
    .fetch_all(&mut **transaction)
    .await?;
    let mut matching = Vec::new();
    let mut active_matching = Vec::new();
    for row in rows {
        let id: Uuid = row.try_get("id")?;
        let display_name: String = row.try_get("display_name")?;
        let birth_date: NaiveDate = row.try_get("birth_date")?;
        if normalize_name(&display_name) == applicant.normalized_child_name
            && birth_date == applicant.child_birth_date
        {
            matching.push(id);
            if row.try_get::<&str, _>("status")? == "active" {
                active_matching.push(id);
            }
        }
    }
    if active_matching.len() == 1 {
        return Ok(active_matching[0]);
    }
    let child_id = insert_child(transaction, tenant, organization_id, family_id, applicant).await?;
    for existing_id in matching {
        insert_duplicate_candidate(
            transaction,
            tenant,
            organization_id,
            "child",
            child_id,
            "child",
            existing_id,
            "name_and_birth_date",
        )
        .await?;
    }
    Ok(child_id)
}

async fn insert_child(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    family_id: Uuid,
    applicant: &NormalizedApplicant,
) -> Result<Uuid> {
    let child_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO airhop_children ( \
             community_id, organization_id, id, family_id, display_name, birth_date \
         ) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(child_id)
    .bind(family_id)
    .bind(&applicant.child_name)
    .bind(applicant.child_birth_date)
    .execute(&mut **transaction)
    .await?;
    Ok(child_id)
}

#[allow(clippy::too_many_arguments)]
async fn insert_duplicate_candidate(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    new_entity_type: &str,
    new_entity_id: Uuid,
    existing_entity_type: &str,
    existing_entity_id: Uuid,
    signal: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO airhop_duplicate_candidates ( \
             community_id, organization_id, id, new_entity_type, new_entity_id, \
             existing_entity_type, existing_entity_id, signals \
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT (community_id, organization_id, new_entity_type, new_entity_id, \
                      existing_entity_type, existing_entity_id) DO NOTHING",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(Uuid::new_v4())
    .bind(new_entity_type)
    .bind(new_entity_id)
    .bind(existing_entity_type)
    .bind(existing_entity_id)
    .bind(vec![signal.to_owned()])
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn applicant_snapshot(applicant: &NormalizedApplicant, accepted_at: DateTime<Utc>) -> Value {
    json!({
        "parentName": applicant.parent_name,
        "phoneNormalized": applicant.phone_normalized,
        "phoneDisplay": applicant.phone_display,
        "childName": applicant.child_name,
        "childBirthDate": applicant.child_birth_date,
        "preferredContactChannel": applicant.preferred_contact_channel.as_db_str(),
        "consentPolicyVersion": applicant.consent_policy_version,
        "consentAcceptedAt": accepted_at
    })
}

fn booking_source(
    surface: PublicBookingSurface,
    attribution_branch_id: Option<Uuid>,
    purpose: PublicBookingPurpose,
) -> Value {
    json!({
        "surface": surface.as_str(),
        "attributionBranchId": attribution_branch_id,
        "purpose": purpose_str(purpose),
        "channel": "website",
        "workflow": "request"
    })
}

const fn purpose_str(purpose: PublicBookingPurpose) -> &'static str {
    match purpose {
        PublicBookingPurpose::Trial => "trial",
        PublicBookingPurpose::Lesson => "lesson",
    }
}

const fn visit_kind(purpose: PublicBookingPurpose) -> BookingVisitKind {
    match purpose {
        PublicBookingPurpose::Trial => BookingVisitKind::Trial,
        PublicBookingPurpose::Lesson => BookingVisitKind::Single,
    }
}

const fn public_actor() -> AirhopActor {
    AirhopActor {
        kind: ActorKind::Public,
        pubkey: None,
        on_behalf_of_pubkey: None,
        agent_pubkey: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::airhop::booking_decision::{
        BindMessengerAccountInput, BookingDecision, DecideBookingInput, DeliveryAckState,
        DeliveryCompletion, ParentNotificationRoute,
    };
    use crate::airhop::public_management::{
        PublicManagementAction, PublicManagementCommand, PublicManagementCredential,
    };
    use crate::airhop::public_read::PublicBookingOccurrenceFilters;
    use buzz_core::CommunityId;
    use chrono::{Days, NaiveTime};

    use crate::DbConfig;

    #[test]
    fn whitespace_and_case_normalization_is_stable() {
        assert_eq!(collapse_whitespace("  Мария\n  Иванова "), "Мария Иванова");
        assert_eq!(normalize_name("  МаРиЯ\tИванова "), "мария иванова");
    }

    #[test]
    fn phone_validation_requires_strict_e164() {
        assert!(validate_e164("+79991234567").is_ok());
        for invalid in [
            "79991234567",
            "+09991234567",
            "+7999 1234567",
            "+123456789",
            "+1234567890123456",
        ] {
            assert!(validate_e164(invalid).is_err(), "accepted {invalid:?}");
        }
    }

    #[test]
    fn representative_is_reused_only_for_one_active_match() {
        let one = vec![RepresentativeCandidate {
            id: Uuid::from_u128(1),
            family_id: Uuid::from_u128(2),
            active: true,
        }];
        assert_eq!(
            unique_active_representative(&one).map(|candidate| candidate.id),
            Some(Uuid::from_u128(1))
        );
        let ambiguous = vec![
            RepresentativeCandidate {
                id: Uuid::from_u128(1),
                family_id: Uuid::from_u128(2),
                active: true,
            },
            RepresentativeCandidate {
                id: Uuid::from_u128(3),
                family_id: Uuid::from_u128(4),
                active: true,
            },
        ];
        assert!(unique_active_representative(&ambiguous).is_none());
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn public_booking_is_atomic_idempotent_and_reuses_exact_identity() {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
        let config = DbConfig {
            database_url,
            max_connections: 5,
            min_connections: 0,
            ..DbConfig::default()
        };
        let db = Db::new(&config).await.expect("connect test database");
        let community_id = Uuid::new_v4();
        let organization_id = Uuid::new_v4();
        let branch_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        let recurrence_rule_id = Uuid::new_v4();
        let first_date = Utc::now()
            .date_naive()
            .checked_add_days(Days::new(1))
            .expect("future date");
        let second_date = first_date
            .checked_add_days(Days::new(1))
            .expect("second future date");
        let tenant = TenantContext::resolved(
            CommunityId::from_uuid(community_id),
            format!("booking-{}.test", community_id.simple()),
        );

        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(tenant.host())
            .execute(&db.pool)
            .await
            .expect("insert community");
        sqlx::query(
            "INSERT INTO airhop_organizations ( \
                 community_id, id, name, locale, time_zone, default_trial_policy \
             ) VALUES ($1, $2, 'Test Center', 'ru-RU', 'UTC', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(json!({"mode": "free"}))
        .execute(&db.pool)
        .await
        .expect("insert organization");
        sqlx::query(
            "INSERT INTO airhop_branches (community_id, organization_id, id, name, address) \
             VALUES ($1, $2, $3, 'Sokol', 'Test address')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(branch_id)
        .execute(&db.pool)
        .await
        .expect("insert branch");
        sqlx::query(
            "INSERT INTO airhop_groups ( \
                 community_id, organization_id, id, branch_id, name, capacity \
             ) VALUES ($1, $2, $3, $4, 'Football 6-7', 1)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(group_id)
        .bind(branch_id)
        .execute(&db.pool)
        .await
        .expect("insert group");
        sqlx::query(
            "INSERT INTO airhop_recurrence_rules ( \
                 community_id, organization_id, id, group_id, starts_on, ends_on, \
                 start_time, end_time \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(recurrence_rule_id)
        .bind(group_id)
        .bind(first_date)
        .bind(second_date)
        .bind(NaiveTime::from_hms_opt(10, 0, 0).expect("valid start time"))
        .bind(NaiveTime::from_hms_opt(11, 0, 0).expect("valid end time"))
        .execute(&db.pool)
        .await
        .expect("insert recurrence rule");
        for original_date in [first_date, second_date] {
            let starts_at = original_date
                .and_hms_opt(10, 0, 0)
                .expect("valid start instant")
                .and_utc();
            let ends_at = original_date
                .and_hms_opt(11, 0, 0)
                .expect("valid end instant")
                .and_utc();
            sqlx::query(
                "INSERT INTO airhop_lesson_occurrences ( \
                     community_id, organization_id, id, recurrence_rule_id, original_date, \
                     group_id, branch_id, original_start_time, original_end_time, \
                     effective_date, start_time, end_time, starts_at, ends_at, time_zone, \
                     capacity, trial_policy, allow_single_visits, track_attendance, status, \
                     source_rule_version \
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $5, $8, $9, $10, $11, \
                           'UTC', 1, $12, FALSE, TRUE, 'scheduled', 1)",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(Uuid::new_v4())
            .bind(recurrence_rule_id)
            .bind(original_date)
            .bind(group_id)
            .bind(branch_id)
            .bind(NaiveTime::from_hms_opt(10, 0, 0).expect("valid start time"))
            .bind(NaiveTime::from_hms_opt(11, 0, 0).expect("valid end time"))
            .bind(starts_at)
            .bind(ends_at)
            .bind(json!({"mode": "free"}))
            .execute(&db.pool)
            .await
            .expect("insert occurrence");
        }

        let base = CreatePublicBookingInput {
            lesson_ref: StableLessonReference {
                recurrence_rule_id,
                original_date: first_date,
            },
            applicant: PublicBookingApplicant {
                parent_name: " Мария   Иванова ".to_owned(),
                phone_normalized: "+79991234567".to_owned(),
                phone_display: "+7 999 123-45-67".to_owned(),
                child_name: " Анна ".to_owned(),
                child_birth_date: NaiveDate::from_ymd_opt(2019, 5, 20).expect("valid birth date"),
                preferred_contact_channel: PreferredContactChannel::Telegram,
                consent_policy_version: "booking-v1".to_owned(),
            },
            surface: PublicBookingSurface::Standalone,
            attribution_branch_id: Some(branch_id),
            idempotency_digest: [1; 32],
            phone_match_digest: [2; 32],
            request_hash: [3; 32],
            management_token_digest: [4; 32],
            management_key_version: 1,
            consent_evidence: json!({"accepted": true}),
        };
        let created = db
            .create_public_booking(&tenant, &base)
            .await
            .expect("create booking");
        let replayed = db
            .create_public_booking(&tenant, &base)
            .await
            .expect("replay booking");
        assert_eq!(created.disposition, PublicBookingDisposition::Created);
        assert_eq!(replayed.disposition, PublicBookingDisposition::Replayed);
        assert_eq!(created.booking, replayed.booking);

        let mut second = base.clone();
        second.lesson_ref.original_date = second_date;
        second.idempotency_digest = [5; 32];
        second.request_hash = [6; 32];
        second.management_token_digest = [7; 32];
        let second_booking = db
            .create_public_booking(&tenant, &second)
            .await
            .expect("create second booking");
        assert_eq!(
            second_booking.disposition,
            PublicBookingDisposition::Created
        );
        assert_eq!(created.booking.family_id, second_booking.booking.family_id);
        assert_eq!(created.booking.child_id, second_booking.booking.child_id);

        let mut capacity_rejected = base.clone();
        capacity_rejected.applicant.parent_name = "Ольга Петрова".to_owned();
        capacity_rejected.applicant.phone_normalized = "+79997654321".to_owned();
        capacity_rejected.applicant.phone_display = "+7 999 765-43-21".to_owned();
        capacity_rejected.applicant.child_name = "Пётр".to_owned();
        capacity_rejected.idempotency_digest = [8; 32];
        capacity_rejected.phone_match_digest = [9; 32];
        capacity_rejected.request_hash = [10; 32];
        capacity_rejected.management_token_digest = [11; 32];
        let error = db
            .create_public_booking(&tenant, &capacity_rejected)
            .await
            .expect_err("full occurrence must reject another child");
        assert!(matches!(error, DbError::AirhopCapacityFull));

        let counts = sqlx::query(
            "SELECT \
                 (SELECT COUNT(*)::BIGINT FROM airhop_commands \
                  WHERE community_id = $1) AS commands, \
                 (SELECT COUNT(*)::BIGINT FROM airhop_bookings \
                  WHERE community_id = $1) AS bookings, \
                 (SELECT COUNT(*)::BIGINT FROM airhop_families \
                  WHERE community_id = $1) AS families, \
                 (SELECT COUNT(*)::BIGINT FROM airhop_representatives \
                  WHERE community_id = $1) AS representatives, \
                 (SELECT COUNT(*)::BIGINT FROM airhop_children \
                  WHERE community_id = $1) AS children, \
                 (SELECT COUNT(*)::BIGINT FROM airhop_consents \
                  WHERE community_id = $1) AS consents, \
                 (SELECT COUNT(*)::BIGINT FROM airhop_domain_events \
                  WHERE community_id = $1) AS events, \
                 (SELECT COUNT(*)::BIGINT FROM airhop_outbox \
                  WHERE community_id = $1) AS outbox",
        )
        .bind(community_id)
        .fetch_one(&db.pool)
        .await
        .expect("count fixture rows");
        for (column, expected) in [
            ("commands", 2_i64),
            ("bookings", 2),
            ("families", 1),
            ("representatives", 1),
            ("children", 1),
            ("consents", 2),
            ("events", 2),
            ("outbox", 2),
        ] {
            assert_eq!(
                counts.try_get::<i64, _>(column).expect("read row count"),
                expected,
                "unexpected row count for {column}"
            );
        }

        let catalog = db
            .get_public_booking_catalog(&tenant)
            .await
            .expect("load tenant public catalog");
        assert_eq!(catalog.organization_id, organization_id);
        assert_eq!(catalog.branches.len(), 1);
        assert_eq!(catalog.branches[0].id, branch_id);

        let occurrences = db
            .find_public_booking_occurrences(
                &tenant,
                PublicBookingOccurrenceFilters {
                    branch_id: Some(branch_id),
                    group_id: Some(group_id),
                    purpose: PublicBookingPurpose::Trial,
                    age: None,
                },
            )
            .await
            .expect("load authoritative public occurrences");
        assert_eq!(occurrences.len(), 2);
        assert!(occurrences
            .iter()
            .all(|occurrence| occurrence.occupied == 1));
        assert!(occurrences.iter().all(|occurrence| !occurrence.available));

        let credential = PublicManagementCredential {
            key_version: 1,
            token_digest: [4; 32],
        };
        let initial_card = db
            .get_public_management_card(&tenant, credential)
            .await
            .expect("load management card")
            .expect("known credential");
        assert_eq!(initial_card.child_name, "Анна");
        assert!(initial_card.can_cancel);

        let connector_pubkey = [21_u8; 32];
        let staff_pubkey = [22_u8; 32];
        let binding = db
            .bind_airhop_booking_messenger_account(
                &tenant,
                &BindMessengerAccountInput {
                    booking_id: created.booking.id,
                    channel: "telegram".to_owned(),
                    external_user_id: "telegram-user-42".to_owned(),
                    external_user_digest: [18; 32],
                    display_handle: Some("@maria".to_owned()),
                    idempotency_digest: [19; 32],
                    request_hash: [20; 32],
                    actor: AirhopActor {
                        kind: ActorKind::Bot,
                        pubkey: Some(connector_pubkey),
                        on_behalf_of_pubkey: None,
                        agent_pubkey: Some(connector_pubkey),
                    },
                },
            )
            .await
            .expect("bind verified Telegram account");
        assert_eq!(binding.channel, "telegram");

        let confirm_input = DecideBookingInput {
            booking_id: created.booking.id,
            decision: BookingDecision::Confirm,
            idempotency_digest: [23; 32],
            request_hash: [24; 32],
            actor: AirhopActor {
                kind: ActorKind::Staff,
                pubkey: Some(staff_pubkey),
                on_behalf_of_pubkey: None,
                agent_pubkey: None,
            },
        };
        let confirmed = db
            .decide_airhop_booking(&tenant, &confirm_input)
            .await
            .expect("confirm booking");
        assert_eq!(confirmed.status, BookingStatus::Confirmed);
        assert_eq!(
            confirmed.notification_route,
            ParentNotificationRoute::Messenger {
                channel: "telegram".to_owned()
            }
        );
        let replayed_confirmation = db
            .decide_airhop_booking(&tenant, &confirm_input)
            .await
            .expect("replay confirmation");
        assert!(replayed_confirmation.replayed);

        let jobs = db
            .claim_airhop_parent_notifications(&tenant, connector_pubkey, 10, 60)
            .await
            .expect("claim parent notification");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].external_user_id, "telegram-user-42");
        assert_eq!(jobs[0].template_key, "booking_confirmed_v1");
        let delivered = db
            .complete_airhop_parent_notification(
                &tenant,
                connector_pubkey,
                jobs[0].outbox_id,
                jobs[0].lease_token,
                &DeliveryCompletion::Delivered {
                    provider_message_id: Some("telegram-message-1".to_owned()),
                },
            )
            .await
            .expect("ack delivered notification");
        assert_eq!(delivered, DeliveryAckState::Delivered);
        assert_eq!(
            db.complete_airhop_parent_notification(
                &tenant,
                connector_pubkey,
                jobs[0].outbox_id,
                jobs[0].lease_token,
                &DeliveryCompletion::Delivered {
                    provider_message_id: Some("telegram-message-1".to_owned()),
                },
            )
            .await
            .expect("replay delivery ack"),
            DeliveryAckState::Delivered
        );

        let confirmation_event_id: Uuid = sqlx::query(
            "SELECT id FROM airhop_domain_events \
             WHERE community_id = $1 AND organization_id = $2 \
               AND stream_type = 'booking' AND stream_id = $3 \
               AND event_type = 'airhop.booking.confirmed.v1'",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(created.booking.id)
        .fetch_one(&db.pool)
        .await
        .expect("load confirmation event")
        .try_get("id")
        .expect("read confirmation event id");
        sqlx::query(
            "INSERT INTO airhop_outbox (\
                 community_id, organization_id, event_id, destination, redacted_payload\
             ) VALUES ($1, $2, $3, 'airhop.parent.booking-decision.telegram.retry-test', $4)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(confirmation_event_id)
        .bind(json!({
            "bookingId": created.booking.id,
            "messengerAccountId": binding.messenger_account_id,
            "status": "confirmed",
            "templateKey": "booking_confirmed_v1"
        }))
        .execute(&db.pool)
        .await
        .expect("insert retry fixture outbox");
        for attempt in 1..=5 {
            let retry_jobs = db
                .claim_airhop_parent_notifications(&tenant, connector_pubkey, 10, 60)
                .await
                .expect("claim retry fixture");
            assert_eq!(retry_jobs.len(), 1);
            let state = db
                .complete_airhop_parent_notification(
                    &tenant,
                    connector_pubkey,
                    retry_jobs[0].outbox_id,
                    retry_jobs[0].lease_token,
                    &DeliveryCompletion::Failed {
                        error_code: "provider_unavailable".to_owned(),
                        retry_after_seconds: 30,
                    },
                )
                .await
                .expect("record provider failure");
            let expected = if attempt < 5 {
                DeliveryAckState::RetryScheduled
            } else {
                DeliveryAckState::FailedOverToStaff
            };
            assert_eq!(state, expected);
            if attempt < 5 {
                sqlx::query(
                    "UPDATE airhop_outbox SET not_before = now() \
                     WHERE community_id = $1 AND id = $2",
                )
                .bind(community_id)
                .bind(retry_jobs[0].outbox_id)
                .execute(&db.pool)
                .await
                .expect("advance retry fixture clock");
            }
        }
        let fallback_count: i64 = sqlx::query(
            "SELECT COUNT(*)::BIGINT AS count FROM airhop_outbox \
             WHERE community_id = $1 AND organization_id = $2 AND event_id = $3 \
               AND destination = 'airhop.staff.call-parent'",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(confirmation_event_id)
        .fetch_one(&db.pool)
        .await
        .expect("count delivery fallback")
        .try_get("count")
        .expect("read fallback count");
        assert_eq!(fallback_count, 1);

        let contact_card = db
            .apply_public_management_action(
                &tenant,
                credential,
                PublicManagementCommand {
                    idempotency_digest: [12; 32],
                    request_hash: [13; 32],
                },
                PublicManagementAction::SetPreferredContactChannel {
                    channel: PreferredContactChannel::Phone,
                },
            )
            .await
            .expect("change contact channel");
        assert_eq!(
            contact_card.preferred_contact_channel,
            PreferredContactChannel::Phone
        );

        let rejected = db
            .decide_airhop_booking(
                &tenant,
                &DecideBookingInput {
                    booking_id: second_booking.booking.id,
                    decision: BookingDecision::Reject,
                    idempotency_digest: [25; 32],
                    request_hash: [26; 32],
                    actor: AirhopActor {
                        kind: ActorKind::Staff,
                        pubkey: Some(staff_pubkey),
                        on_behalf_of_pubkey: None,
                        agent_pubkey: None,
                    },
                },
            )
            .await
            .expect("reject second booking");
        assert_eq!(rejected.status, BookingStatus::Rejected);
        assert_eq!(
            rejected.notification_route,
            ParentNotificationRoute::StaffCall
        );

        let transfer_command = PublicManagementCommand {
            idempotency_digest: [14; 32],
            request_hash: [15; 32],
        };
        let transfer_card = db
            .apply_public_management_action(
                &tenant,
                credential,
                transfer_command,
                PublicManagementAction::RequestTransfer {
                    comment: Some("Нужен вечер".to_owned()),
                },
            )
            .await
            .expect("request transfer");
        assert_eq!(
            transfer_card
                .transfer_request
                .as_ref()
                .and_then(|request| request.comment.as_deref()),
            Some("Нужен вечер")
        );
        let replayed_transfer = db
            .apply_public_management_action(
                &tenant,
                credential,
                transfer_command,
                PublicManagementAction::RequestTransfer {
                    comment: Some("Нужен вечер".to_owned()),
                },
            )
            .await
            .expect("replay transfer");
        assert_eq!(replayed_transfer, transfer_card);

        let cancelled = db
            .apply_public_management_action(
                &tenant,
                credential,
                PublicManagementCommand {
                    idempotency_digest: [16; 32],
                    request_hash: [17; 32],
                },
                PublicManagementAction::CancelByParent,
            )
            .await
            .expect("cancel booking");
        assert_eq!(cancelled.status, BookingStatus::CancelledByParent);
        assert!(cancelled.transfer_request.is_none());
        assert!(!cancelled.can_cancel);
    }
}

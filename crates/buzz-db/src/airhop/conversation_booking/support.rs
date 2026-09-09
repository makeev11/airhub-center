use super::*;

pub(super) struct Scope {
    pub organization_id: Uuid,
    pub conversation_id: Uuid,
    pub family_id: Option<Uuid>,
    pub representative_id: Option<Uuid>,
    pub source_event_id: Vec<u8>,
    pub source_content: String,
    pub provider: String,
    pub chat_id: String,
    pub chat_digest: Vec<u8>,
    pub connector_pubkey: Vec<u8>,
    pub locale: String,
    pub current_date: NaiveDate,
    pub current_instant: DateTime<Utc>,
    pub auto_confirm: bool,
}

pub(super) async fn lock_scope(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    lease: &ValidateParentAgentTurnLeaseInput,
) -> Result<Scope> {
    // Deployment -> connection -> conversation -> turn. Ingest/takeover and
    // gateway binding serialize on the same conversation row before any writes.
    let deployment = sqlx::query("SELECT d.auto_confirm_online_bookings,o.locale,now() AS current_instant,(now() AT TIME ZONE o.time_zone)::date AS current_date
        FROM airhop_agent_deployments d JOIN airhop_organizations o ON o.community_id=d.community_id AND o.id=d.organization_id
        WHERE d.community_id=$1 AND d.organization_id=$2 AND d.id=$3 AND d.version=$4 AND d.agent_pubkey=$5
        AND d.role='parent_administrator' AND d.enabled AND NOT d.paused AND d.manage_bookings AND o.status='active' FOR SHARE OF d")
        .bind(tenant.community().as_uuid()).bind(lease.organization_id).bind(lease.deployment_id)
        .bind(lease.deployment_version).bind(lease.agent_pubkey.as_slice()).fetch_optional(&mut **tx).await?
        .ok_or_else(|| DbError::AccessDenied("Hermes booking permission is disabled or changed".into()))?;
    let route = sqlx::query("SELECT r.conversation_id,r.provider_chat_id,r.provider_chat_digest,c.provider,c.connector_pubkey
        FROM airhop_hermes_turn_receipts t JOIN airhop_external_conversation_routes r
          ON r.community_id=t.community_id AND r.organization_id=t.organization_id AND r.conversation_id=t.conversation_id
        JOIN airhop_channel_connections c ON c.community_id=r.community_id AND c.organization_id=r.organization_id AND c.id=r.connection_id
        WHERE t.community_id=$1 AND t.id=$2 AND t.organization_id=$3 AND c.status='active' AND c.hermes_enabled
          AND r.status='active' AND c.provider IN ('telegram','whatsapp_cloud') FOR SHARE OF c,r")
        .bind(tenant.community().as_uuid()).bind(lease.turn_id).bind(lease.organization_id).fetch_optional(&mut **tx).await?
        .ok_or_else(|| DbError::AccessDenied("Active messenger connection required".into()))?;
    let conversation_id: Uuid = route.try_get("conversation_id")?;
    let conversation = sqlx::query("SELECT * FROM airhop_external_conversations WHERE community_id=$1 AND id=$2 AND organization_id=$3 AND status='active' AND owner='hermes' AND NOT hermes_paused FOR UPDATE")
        .bind(tenant.community().as_uuid()).bind(conversation_id).bind(lease.organization_id).fetch_optional(&mut **tx).await?
        .ok_or_else(|| DbError::AccessDenied("Conversation is no longer owned by Hermes".into()))?;
    let turn = sqlx::query("SELECT t.*,e.content FROM airhop_hermes_turn_receipts t JOIN events e ON e.community_id=t.community_id AND e.id=t.source_message_id
        WHERE t.community_id=$1 AND t.id=$2 AND t.organization_id=$3 AND t.deployment_id=$4 AND t.lease_token=$5
          AND t.agent_pubkey=$6 AND t.status='leased' AND t.lease_expires_at>now() AND t.cycle_id=$7
          AND e.deleted_at IS NULL AND e.pubkey=$8 AND e.channel_id=t.channel_id AND e.kind=9
        FOR SHARE OF t")
        .bind(tenant.community().as_uuid()).bind(lease.turn_id).bind(lease.organization_id).bind(lease.deployment_id)
        .bind(lease.lease_token).bind(lease.agent_pubkey.as_slice()).bind(conversation.try_get::<Uuid,_>("current_cycle_id")?)
        .bind(conversation.try_get::<Vec<u8>,_>("parent_pubkey")?).fetch_optional(&mut **tx).await?
        .ok_or_else(|| DbError::AccessDenied("Booking requires a current parent turn, not a staff command".into()))?;
    Ok(Scope {
        organization_id: lease.organization_id,
        conversation_id,
        family_id: turn.try_get("family_id")?,
        representative_id: turn.try_get("representative_id")?,
        source_event_id: turn.try_get("source_message_id")?,
        source_content: turn.try_get("content")?,
        provider: if route.try_get::<&str, _>("provider")? == "telegram" {
            "telegram"
        } else {
            "whatsapp"
        }
        .into(),
        chat_id: route.try_get("provider_chat_id")?,
        chat_digest: route.try_get("provider_chat_digest")?,
        connector_pubkey: route.try_get("connector_pubkey")?,
        locale: deployment.try_get("locale")?,
        current_date: deployment.try_get("current_date")?,
        current_instant: deployment.try_get("current_instant")?,
        auto_confirm: deployment.try_get("auto_confirm_online_bookings")?,
    })
}

pub(super) async fn lock_draft(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    conversation: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>> {
    Ok(sqlx::query("SELECT * FROM airhop_conversation_booking_drafts WHERE community_id=$1 AND conversation_id=$2 FOR UPDATE")
        .bind(tenant.community().as_uuid()).bind(conversation).fetch_optional(&mut **tx).await?)
}

pub(super) fn draft_from_row(row: &sqlx::postgres::PgRow) -> Result<ConversationBookingDraft> {
    Ok(ConversationBookingDraft {
        version: row.try_get("version")?,
        state: row.try_get("state")?,
        data: serde_json::from_value(row.try_get("data")?)?,
        preview: row.try_get("preview")?,
        booking_id: row.try_get("booking_id")?,
    })
}

pub(super) fn require_version(row: Option<&sqlx::postgres::PgRow>, expected: i64) -> Result<()> {
    let current = row
        .map(|r| r.try_get::<i64, _>("version"))
        .transpose()?
        .unwrap_or(0);
    if expected < 0 || expected == i64::MAX || current != expected {
        return Err(DbError::AirhopVersionConflict);
    }
    Ok(())
}

pub(super) fn validate_fields(data: &ConversationBookingData) -> Result<()> {
    for text in [
        &data.parent_name,
        &data.child_name,
        &data.phone,
        &data.original_date,
        &data.child_birth_date,
        &data.purpose,
    ]
    .into_iter()
    .flatten()
    {
        if text.trim().is_empty()
            || text.chars().count() > 160
            || text.chars().any(char::is_control)
        {
            return Err(DbError::InvalidData(
                "Draft fields must be short, nonempty plain text".into(),
            ));
        }
    }
    if data.child_id.is_some_and(|id| id.is_nil())
        || data.recurrence_rule_id.is_some_and(|id| id.is_nil())
    {
        return Err(DbError::InvalidData(
            "Invalid booking draft identifier".into(),
        ));
    }
    for date in [&data.original_date, &data.child_birth_date]
        .into_iter()
        .flatten()
    {
        parse_date(date)?;
    }
    if data.purpose.is_some() {
        visit_kind(data)?;
    }
    Ok(())
}

fn parse_date(text: &str) -> Result<NaiveDate> {
    text.parse()
        .map_err(|_| DbError::InvalidData("Use the actual date in YYYY-MM-DD format".into()))
}

pub(super) fn lesson_ref(data: &ConversationBookingData) -> Result<StableLessonReference> {
    Ok(StableLessonReference {
        recurrence_rule_id: data
            .recurrence_rule_id
            .ok_or_else(|| DbError::InvalidData("Select a lesson first".into()))?,
        original_date: parse_date(data.original_date.as_deref().unwrap_or(""))?,
    })
}

pub(super) fn visit_kind(data: &ConversationBookingData) -> Result<BookingVisitKind> {
    match data.purpose.as_deref() {
        Some("trial") => Ok(BookingVisitKind::Trial),
        Some("lesson") => Ok(BookingVisitKind::Single),
        _ => Err(DbError::InvalidData(
            "Choose purpose trial or lesson".into(),
        )),
    }
}

pub(super) fn applicant(data: &ConversationBookingData) -> Result<PublicBookingApplicant> {
    Ok(PublicBookingApplicant {
        parent_name: data.parent_name.clone().unwrap_or_default(),
        parent_first_name: None,
        parent_last_name: None,
        phone_normalized: data.phone.clone().unwrap_or_default(),
        phone_display: data.phone.clone().unwrap_or_default(),
        child_name: data.child_name.clone().unwrap_or_default(),
        child_first_name: None,
        child_last_name: None,
        child_birth_date: parse_date(data.child_birth_date.as_deref().unwrap_or(""))?,
        preferred_contact_channel: PreferredContactChannel::Telegram,
        consent_policy_version: "conversation-booking-v1".into(),
    })
}

pub(super) async fn fill_verified_fields(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    scope: &Scope,
    data: &mut ConversationBookingData,
) -> Result<()> {
    if let (Some(family), Some(representative)) = (scope.family_id, scope.representative_id) {
        let row=sqlx::query("SELECT p.display_name,p.phone_normalized FROM airhop_representatives p JOIN airhop_families f ON f.community_id=p.community_id AND f.organization_id=p.organization_id AND f.id=p.family_id WHERE p.community_id=$1 AND p.organization_id=$2 AND p.family_id=$3 AND p.id=$4 AND p.status='active' AND f.status='active' FOR SHARE OF p,f")
            .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(family).bind(representative).fetch_optional(&mut **tx).await?.ok_or(DbError::AirhopIdentityMismatch)?;
        data.parent_name = Some(row.try_get("display_name")?);
        data.phone = Some(row.try_get("phone_normalized")?);
        if let Some(child) = data.child_id {
            let row=sqlx::query("SELECT display_name,birth_date FROM airhop_children WHERE community_id=$1 AND organization_id=$2 AND family_id=$3 AND id=$4 AND status='active' FOR SHARE")
                .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(family).bind(child).fetch_optional(&mut **tx).await?.ok_or(DbError::AirhopIdentityMismatch)?;
            data.child_name = Some(row.try_get("display_name")?);
            data.child_birth_date = Some(row.try_get::<NaiveDate, _>("birth_date")?.to_string());
        }
    } else if data.child_id.is_some() {
        return Err(DbError::AirhopIdentityMismatch);
    }
    Ok(())
}

pub(super) async fn quote_for_data(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    scope: &Scope,
    data: &ConversationBookingData,
) -> Result<Option<Value>> {
    if data.recurrence_rule_id.is_none()
        || [
            &data.original_date,
            &data.purpose,
            &data.parent_name,
            &data.phone,
            &data.child_name,
            &data.child_birth_date,
        ]
        .iter()
        .any(|v| v.is_none())
    {
        return Ok(None);
    }
    let applicant = normalize_applicant(&applicant(data)?, scope.current_date)?;
    let reference = lesson_ref(data)?;
    let row=sqlx::query("SELECT o.effective_date,o.start_time,o.end_time,o.time_zone,o.trial_policy,o.allow_single_visits,
        g.name AS group_name,b.name AS branch_name,b.address,g.min_age_months,g.max_age_months
        FROM airhop_lesson_occurrences o JOIN airhop_groups g ON g.community_id=o.community_id AND g.organization_id=o.organization_id AND g.id=o.group_id
        JOIN airhop_branches b ON b.community_id=o.community_id AND b.organization_id=o.organization_id AND b.id=o.branch_id
        WHERE o.community_id=$1 AND o.organization_id=$2 AND o.recurrence_rule_id=$3 AND o.original_date=$4
        AND o.starts_at>now() AND o.status<>'cancelled' AND g.status='active' AND b.status='active' FOR UPDATE OF o FOR SHARE OF g,b")
        .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(reference.recurrence_rule_id).bind(reference.original_date)
        .fetch_optional(&mut **tx).await?.ok_or(DbError::AirhopOccurrenceUnavailable)?;
    let policy: airhop_core::TrialPolicy = serde_json::from_value(row.try_get("trial_policy")?)?;
    if (visit_kind(data)? == BookingVisitKind::Trial
        && matches!(policy, airhop_core::TrialPolicy::Disabled))
        || (visit_kind(data)? == BookingVisitKind::Single
            && !row.try_get::<bool, _>("allow_single_visits")?)
    {
        return Err(DbError::AirhopOccurrenceUnavailable);
    }
    let min: Option<i32> = row.try_get("min_age_months")?;
    let max: Option<i32> = row.try_get("max_age_months")?;
    let limits = airhop_core::AgeLimits::new(min.map(|v| v as u32), max.map(|v| v as u32))
        .map_err(|e| DbError::InvalidData(e.to_string()))?;
    let date: NaiveDate = row.try_get("effective_date")?;
    if !limits.contains_birth_date(applicant.child_birth_date, date) {
        return Err(DbError::AirhopAgeMismatch);
    }
    Ok(Some(
        json!({"date":date,"startTime":row.try_get::<chrono::NaiveTime,_>("start_time")?.format("%H:%M").to_string(),
        "endTime":row.try_get::<chrono::NaiveTime,_>("end_time")?.format("%H:%M").to_string(),"timeZone":row.try_get::<String,_>("time_zone")?,
        "groupName":row.try_get::<String,_>("group_name")?,"branchName":row.try_get::<String,_>("branch_name")?,"address":row.try_get::<String,_>("address")?,"trialPolicy":policy}),
    ))
}

pub(super) fn make_preview(locale: &str, data: &ConversationBookingData, quote: &Value) -> String {
    let value = |name| quote.get(name).and_then(Value::as_str).unwrap_or("");
    let (free, unknown, trial, single) = match locale {
        "ru-RU" => (
            "бесплатно",
            "стоимость уточнит сотрудник",
            "Пробное занятие",
            "Разовое занятие",
        ),
        "pt-BR" => (
            "grátis",
            "preço a confirmar pela equipe",
            "Aula experimental",
            "Aula avulsa",
        ),
        "tr-TR" => (
            "ücretsiz",
            "ücreti personel onaylayacak",
            "Deneme dersi",
            "Tek ders",
        ),
        _ => (
            "free",
            "price to be confirmed by staff",
            "Trial lesson",
            "Single lesson",
        ),
    };
    let is_trial = data.purpose.as_deref() == Some("trial");
    let price = match (
        is_trial,
        quote.pointer("/trialPolicy/mode").and_then(Value::as_str),
    ) {
        (true, Some("free")) => free.into(),
        (true, Some("paid")) => {
            let minor = quote
                .pointer("/trialPolicy/price/amountMinor")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let amount = if minor % 100 == 0 {
                (minor / 100).to_string()
            } else {
                format!("{}.{:02}", minor / 100, minor % 100)
            };
            format!(
                "{} {}",
                amount,
                quote
                    .pointer("/trialPolicy/price/currency")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            )
        }
        _ => unknown.into(),
    };
    let facts = format!(
        "{}\n{} ({})\n{} · {}\n{} · {} {}–{} ({})\n{} · {}\n{}",
        if is_trial { trial } else { single },
        data.child_name.as_deref().unwrap_or(""),
        data.child_birth_date.as_deref().unwrap_or(""),
        data.parent_name.as_deref().unwrap_or(""),
        data.phone.as_deref().unwrap_or(""),
        value("groupName"),
        value("date"),
        value("startTime"),
        value("endTime"),
        value("timeZone"),
        value("branchName"),
        value("address"),
        price
    );
    match locale {
        "ru-RU"=>format!("Проверьте запись:\n{facts}\n\nОтветьте «Подтверждаю запись», если всё верно и вы согласны использовать эти данные для оформления записи и связи по ней. Пока место не забронировано."),
        "pt-BR"=>format!("Confira a reserva:\n{facts}\n\nResponda «Confirmo a reserva» se os dados estão corretos e autoriza seu uso para a reserva e contato. A vaga ainda não está reservada."),
        "tr-TR"=>format!("Kaydı kontrol edin:\n{facts}\n\nBilgiler doğruysa ve kayıt ve iletişim için kullanımına izin veriyorsanız «Onaylıyorum» yazın. Henüz yer ayrılmadı."),
        _=>format!("Please check your booking:\n{facts}\n\nReply “Confirm booking” if these details are correct and you agree to their use for this booking and related contact. No place is reserved yet."),
    }
}

pub(super) async fn validate_confirmation(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    scope: &Scope,
    draft: &sqlx::postgres::PgRow,
) -> Result<Vec<u8>> {
    let summary:Option<Vec<u8>>=sqlx::query_scalar("SELECT preview.buzz_event_id FROM events source
        JOIN airhop_gateway_inbound_receipts gateway ON gateway.community_id=source.community_id AND gateway.buzz_event_id=source.id AND gateway.conversation_id=$2
        JOIN airhop_external_message_outbox preview ON preview.community_id=source.community_id AND preview.conversation_id=$2
        WHERE source.community_id=$1 AND source.id=$3 AND preview.actor_kind='hermes' AND preview.status='delivered'
          AND preview.event_json->>'content'=$4 AND preview.created_at>=$5 AND preview.delivered_at<source.received_at
          AND source.received_at<$5 + interval '24 hours'
          AND clock_timestamp()<$5 + interval '24 hours'
          AND NOT EXISTS(SELECT 1 FROM events intervening WHERE intervening.community_id=source.community_id
              AND EXISTS(SELECT 1 FROM airhop_gateway_inbound_receipts ir WHERE ir.community_id=intervening.community_id AND ir.buzz_event_id=intervening.id AND ir.conversation_id=$2) AND intervening.pubkey=source.pubkey
              AND intervening.kind=9 AND intervening.deleted_at IS NULL
              AND intervening.received_at>preview.delivered_at AND intervening.received_at<source.received_at)
          AND NOT EXISTS(SELECT 1 FROM airhop_external_message_outbox later_reply
              WHERE later_reply.community_id=preview.community_id AND later_reply.conversation_id=preview.conversation_id
              AND later_reply.status='delivered' AND later_reply.buzz_event_id<>preview.buzz_event_id
              AND later_reply.delivered_at>=preview.delivered_at AND later_reply.delivered_at<source.received_at)
          AND NOT EXISTS(SELECT 1 FROM events newer WHERE newer.community_id=source.community_id AND newer.channel_id=source.channel_id
              AND EXISTS(SELECT 1 FROM airhop_gateway_inbound_receipts nr WHERE nr.community_id=newer.community_id AND nr.buzz_event_id=newer.id AND nr.conversation_id=$2) AND newer.pubkey=source.pubkey AND newer.kind=9 AND newer.deleted_at IS NULL AND newer.received_at>source.received_at)
          ORDER BY preview.delivered_at DESC LIMIT 1")
        .bind(tenant.community().as_uuid()).bind(scope.conversation_id).bind(&scope.source_event_id)
        .bind(draft.try_get::<Option<String>,_>("preview")?).bind(draft.try_get::<DateTime<Utc>,_>("updated_at")?)
        .fetch_optional(&mut **tx).await?;
    summary.ok_or_else(|| DbError::InvalidData("A direct parent confirmation of the latest delivered summary is required within 24 hours. Send draft.preview unchanged as the last message, then wait for the parent reply; intervening conversation requires showing it again.".into()))
}

pub(super) async fn has_identity_review(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    identity: &ResolvedIdentity,
) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_duplicate_candidates WHERE community_id=$1 AND status='pending' AND
        ((new_entity_type='representative' AND new_entity_id=$2) OR (existing_entity_type='representative' AND existing_entity_id=$2)
         OR (new_entity_type='child' AND new_entity_id=$3) OR (existing_entity_type='child' AND existing_entity_id=$3)))")
        .bind(tenant.community().as_uuid()).bind(identity.representative_id).bind(identity.child_id).fetch_one(&mut **tx).await?)
}

pub(super) async fn bind_new_identity(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    scope: &Scope,
    identity: &ResolvedIdentity,
    command: &super::super::AirhopCommand,
    actor: &AirhopActor,
) -> Result<()> {
    // A new Family belongs to the proven provider chat. A typed matching phone
    // never grants access to an existing Family; review cases remain unbound.
    let account:Option<Uuid>=sqlx::query_scalar("INSERT INTO airhop_messenger_accounts(community_id,organization_id,representative_id,channel,external_user_id,external_user_digest,verified_at,verified_by_pubkey,last_inbound_at)
        VALUES($1,$2,$3,$4,$5,$6,now(),$7,now()) ON CONFLICT(community_id,organization_id,channel,external_user_digest)
        DO UPDATE SET last_inbound_at=now() WHERE airhop_messenger_accounts.representative_id=EXCLUDED.representative_id RETURNING id")
        .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(identity.representative_id).bind(&scope.provider)
        .bind(&scope.chat_id).bind(&scope.chat_digest).bind(&scope.connector_pubkey).fetch_optional(&mut **tx).await?;
    let account = account.ok_or(DbError::AirhopIdentityMismatch)?;
    sqlx::query("UPDATE airhop_external_conversations SET family_id=$3,representative_id=$4,updated_at=now() WHERE community_id=$1 AND id=$2 AND family_id IS NULL")
        .bind(tenant.community().as_uuid()).bind(scope.conversation_id).bind(identity.family_id).bind(identity.representative_id).execute(&mut **tx).await?;
    let representative_version:i64=sqlx::query_scalar("UPDATE airhop_representatives SET version=version+1,updated_at=now() WHERE community_id=$1 AND organization_id=$2 AND id=$3 RETURNING version")
        .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(identity.representative_id).fetch_one(&mut **tx).await?;
    append_domain_event(tx,tenant,&NewDomainEvent {id:Uuid::new_v4(),organization_id:scope.organization_id,stream_type:"representative".into(),stream_id:identity.representative_id,
        stream_version:representative_version,event_type:"airhop.representative.messenger-bound.v1".into(),schema_version:1,occurred_at:Utc::now(),actor:actor.clone(),causation_id:command.id,correlation_id:command.correlation_id,
        payload:json!({"conversationId":scope.conversation_id,"messengerAccountId":account,"verificationMethod":"conversation_booking","channel":scope.provider}),privacy_class:PrivacyClass::Pii}).await?;
    let names=sqlx::query("SELECT f.display_name AS family_name,p.display_name AS parent_name,c.display_name AS child_name FROM airhop_families f JOIN airhop_representatives p ON p.community_id=f.community_id AND p.family_id=f.id JOIN airhop_children c ON c.community_id=f.community_id AND c.family_id=f.id WHERE f.community_id=$1 AND f.id=$2 AND p.id=$3 AND c.id=$4")
        .bind(tenant.community().as_uuid()).bind(identity.family_id).bind(identity.representative_id).bind(identity.child_id).fetch_one(&mut **tx).await?;
    let title = format!(
        "{} · {} · {} · {}",
        names.try_get::<String, _>("family_name")?,
        names.try_get::<String, _>("parent_name")?,
        names.try_get::<String, _>("child_name")?,
        if scope.provider == "telegram" {
            "Telegram"
        } else {
            "WhatsApp"
        }
    );
    sqlx::query("UPDATE airhop_external_conversations SET title=$3,version=version+1,updated_at=now() WHERE community_id=$1 AND id=$2")
        .bind(tenant.community().as_uuid())
        .bind(scope.conversation_id)
        .bind(title.chars().take(200).collect::<String>())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub(super) async fn booking_result(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    org: Uuid,
    id: Uuid,
    replayed: bool,
) -> Result<ConversationBookingResult> {
    let booking = get_booking_by_id(tx, tenant, org, id)
        .await?
        .ok_or_else(|| DbError::NotFound("created booking".into()))?;
    Ok(ConversationBookingResult {
        booking_id: id,
        status: booking.status,
        replayed,
        requires_staff: booking.status == BookingStatus::PendingConfirmation,
    })
}

pub(super) async fn record_booking_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    command: &super::super::AirhopCommand,
    booking_id: Uuid,
    version: i64,
    event: &str,
    actor: &AirhopActor,
) -> Result<()> {
    let id = Uuid::new_v4();
    let status = if event == "confirmed" {
        "confirmed"
    } else {
        "pending_confirmation"
    };
    let booking = get_booking_by_id(tx, tenant, command.organization_id, booking_id)
        .await?
        .ok_or_else(|| DbError::NotFound("created booking".into()))?;
    let payload = json!({"bookingId":booking_id,"familyId":booking.family_id,
        "representativeId":booking.representative_id,"childId":booking.child_id,
        "recurrenceRuleId":booking.lesson_ref.recurrence_rule_id,"originalDate":booking.lesson_ref.original_date,
        "visitKind":booking.visit_kind.as_db_str(),"status":status});
    append_domain_event(
        tx,
        tenant,
        &NewDomainEvent {
            id,
            organization_id: command.organization_id,
            stream_type: "booking".into(),
            stream_id: booking_id,
            stream_version: version,
            event_type: format!("airhop.booking.{event}.v1"),
            schema_version: 1,
            occurred_at: Utc::now(),
            actor: actor.clone(),
            causation_id: command.id,
            correlation_id: command.correlation_id,
            payload: payload.clone(),
            privacy_class: PrivacyClass::SensitiveChild,
        },
    )
    .await?;
    enqueue_outbox(
        tx,
        tenant,
        &NewOutboxMessage {
            id: Uuid::new_v4(),
            organization_id: command.organization_id,
            event_id: id,
            destination: format!("airhop.booking.{event}"),
            redacted_payload: json!({"bookingId":booking_id,"status":status,
                "recurrenceRuleId":booking.lesson_ref.recurrence_rule_id,"originalDate":booking.lesson_ref.original_date,
                "visitKind":booking.visit_kind.as_db_str()}),
            not_before: Utc::now(),
        },
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_does_not_substitute_trial_price_for_single_visits() {
        let quote =
            json!({"trialPolicy":{"mode":"paid","price":{"amountMinor":90005,"currency":"RUB"}}});
        let mut data = ConversationBookingData {
            purpose: Some("trial".into()),
            ..Default::default()
        };
        assert!(make_preview("ru-RU", &data, &quote).contains("900.05 RUB"));
        data.purpose = Some("lesson".into());
        let preview = make_preview("ru-RU", &data, &quote);
        assert!(!preview.contains("900.05"));
        assert!(preview.contains("стоимость уточнит сотрудник"));
        assert!(preview.contains("Разовое занятие"));
    }

    #[test]
    fn draft_fields_reject_invented_types_and_malformed_values() {
        for data in [
            ConversationBookingData {
                purpose: Some("subscription".into()),
                ..Default::default()
            },
            ConversationBookingData {
                child_birth_date: Some("5 years old".into()),
                ..Default::default()
            },
            ConversationBookingData {
                child_name: Some("A\nB".into()),
                ..Default::default()
            },
            ConversationBookingData {
                parent_name: Some("a".repeat(161)),
                ..Default::default()
            },
        ] {
            assert!(validate_fields(&data).is_err());
        }
        assert!(validate_fields(&ConversationBookingData::default()).is_ok());
    }
}

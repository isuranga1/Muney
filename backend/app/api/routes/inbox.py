"""Bank SMS forwarding — the phone-facing endpoint and the inbox behind it.

POST /ingest/sms is the one route that takes a shared secret instead of a JWT:
an iOS Shortcut can't sign in. It answers immediately and reads the message in
the background, so a slow LLM call never makes the Shortcut time out.
"""

import secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.models import TransactionMessage
from app.schemas.finance import (
    IngestResult,
    MessageRead,
    ParsedSms,
    ReprocessResult,
    SmsIngest,
)
from app.services import ingest, ledger

router = APIRouter(tags=["inbox"])


def _check_token(token: str | None) -> None:
    if not settings.ingest_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMS ingest is disabled — set INGEST_TOKEN on the server",
        )
    if not token or not secrets.compare_digest(token, settings.ingest_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad ingest token")


@router.post("/ingest/sms", response_model=IngestResult, status_code=status.HTTP_202_ACCEPTED)
def ingest_sms(
    payload: SmsIngest,
    background: BackgroundTasks,
    db: DbSession,
    x_ingest_token: Annotated[str | None, Header()] = None,
) -> IngestResult:
    _check_token(x_ingest_token)
    message, duplicate = ingest.ingest(db, payload)
    if not duplicate:
        background.add_task(ingest.process_by_id, message.id)
    return IngestResult(id=message.id, status=message.status, duplicate=duplicate)


def _get(db: DbSession, message_id: int) -> TransactionMessage:
    message = db.get(TransactionMessage, message_id)
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return message


@router.get("/messages", response_model=list[MessageRead])
def list_messages(
    db: DbSession,
    current_user: CurrentUser,
    status_filter: list[str] | None = Query(default=None, alias="status"),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[TransactionMessage]:
    stmt = select(TransactionMessage).order_by(TransactionMessage.received_at.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(TransactionMessage.status.in_(status_filter))
    return list(db.scalars(stmt).all())


@router.post("/messages/reprocess", response_model=ReprocessResult)
def reprocess(db: DbSession, current_user: CurrentUser) -> ReprocessResult:
    """Try every unread message again — after adding a parser or turning on the LLM."""
    checked, processed = ingest.reprocess(db)
    return ReprocessResult(checked=checked, processed=processed)


@router.post("/messages/{message_id}/record", response_model=MessageRead)
def record_by_hand(
    message_id: int, payload: ParsedSms, db: DbSession, current_user: CurrentUser
) -> TransactionMessage:
    message = _get(db, message_id)
    try:
        ingest.record(db, message, payload, "manual")
    except (ingest.IngestError, ledger.LedgerError) as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(message)
    return message


@router.post("/messages/{message_id}/ignore", response_model=MessageRead)
def ignore(message_id: int, db: DbSession, current_user: CurrentUser) -> TransactionMessage:
    message = _get(db, message_id)
    if message.status == "processed":
        raise HTTPException(status_code=409, detail="Already recorded — delete the transaction instead")
    message.status = "ignored"
    db.commit()
    db.refresh(message)
    return message


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(message_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Removes the raw SMS only; a transaction it produced is kept."""
    db.delete(_get(db, message_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

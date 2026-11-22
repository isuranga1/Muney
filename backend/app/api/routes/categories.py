from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.models import BudgetBucket, Category
from app.schemas.finance import CategoryCreate, CategoryRead, CategoryUpdate

router = APIRouter(tags=["categories"])


def _get(db: DbSession, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return category


def _check_bucket(db: DbSession, bucket_id: int | None) -> None:
    if bucket_id is not None and db.get(BudgetBucket, bucket_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget bucket not found")


def _commit(db: DbSession, name: str | None) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A category named {name!r} already exists",
        ) from exc


@router.get("/categories", response_model=list[CategoryRead])
def list_categories(
    db: DbSession,
    current_user: CurrentUser,
    kind: str | None = None,
    include_archived: bool = False,
) -> list[Category]:
    stmt = select(Category).order_by(Category.kind, Category.sort_order, Category.name)
    if kind:
        stmt = stmt.where(Category.kind == kind)
    if not include_archived:
        stmt = stmt.where(Category.is_archived.is_(False))
    return list(db.scalars(stmt).all())


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: DbSession, current_user: CurrentUser) -> Category:
    _check_bucket(db, payload.bucket_id)
    category = Category(**payload.model_dump(), origin="user")
    db.add(category)
    _commit(db, payload.name)
    db.refresh(category)
    return category


@router.patch("/categories/{category_id}", response_model=CategoryRead)
def update_category(
    category_id: int, payload: CategoryUpdate, db: DbSession, current_user: CurrentUser
) -> Category:
    category = _get(db, category_id)
    data = payload.model_dump(exclude_unset=True)
    _check_bucket(db, data.get("bucket_id"))
    for field, value in data.items():
        setattr(category, field, value)
    _commit(db, data.get("name", category.name))
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Transactions in it become uncategorised; learned merchant rules for it go."""
    db.delete(_get(db, category_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

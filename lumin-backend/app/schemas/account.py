from pydantic import BaseModel, Field


class DeletionCheck(BaseModel):
    can_delete: bool
    # Plain-language reasons it can't be done yet (empty when it can).
    reasons: list[str] = []
    # False for a Google-only account, which confirms by typing DELETE alone.
    has_password: bool


class AccountDelete(BaseModel):
    # Must be the word DELETE (any case): a deliberate step, not a stray tap.
    confirm: str = Field(max_length=20)
    # Required when the account has a password.
    password: str | None = Field(default=None, max_length=200)


class DataExportRequest(BaseModel):
    # Required when the account has a password.
    password: str | None = Field(default=None, max_length=200)

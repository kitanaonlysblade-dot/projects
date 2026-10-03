import uuid

from pydantic import BaseModel, ConfigDict


class MerchantAccountBase(BaseModel):
    business_name: str
    category: str
    description: str = ""


class MerchantAccountCreate(MerchantAccountBase):
    pass


class MerchantAccountUpdate(BaseModel):
    """PATCH /merchant/account — every field optional, applied with
    exclude_unset (same convention as UserUpdate). No dashboard UI edits
    any of these yet, so nothing currently calls this route at all — kept
    in place for when one exists, rather than removed and rebuilt later.
    Shipping settings deliberately aren't here: pricing delivery is
    DeliveryCompany's job (models/delivery.py), not something a merchant
    account has ever been able to configure.
    """

    business_name: str | None = None
    category: str | None = None
    description: str | None = None


class MerchantAccountRead(MerchantAccountBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    # All null until POST /merchant/payout succeeds. account_name is
    # resolved from Paystack, not typed in — see the model's own comment
    # on why. paystack_recipient_code itself is deliberately NOT exposed
    # here (internal-only, nothing on the frontend needs the raw code);
    # payout_ready is what a "add your payout details" UI should actually
    # check instead.
    bank_code: str | None = None
    account_number: str | None = None
    account_name: str | None = None
    payout_ready: bool = False


class MerchantPayoutCreate(BaseModel):
    """POST /merchant/payout. Just enough to resolve+verify the account
    and create a Paystack transfer recipient from it — see
    create_transfer_recipient in app/paystack.py for what actually
    happens with these two fields.
    """

    bank_code: str
    account_number: str


class BankRead(BaseModel):
    """GET /merchant/banks — just enough for a picker UI. Paystack's own
    /bank response has more fields than this; everything else gets
    dropped automatically by using this as the response_model rather
    than passed through raw.
    """

    name: str
    code: str

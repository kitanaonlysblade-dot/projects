import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app import screening
from app import account_deletion, blocking, data_export, storage
from app.auth import get_current_active_user, get_current_user, get_optional_user
from app.auth.security import verify_password
from app.rate_limit import limiter
from app.database import get_db
from app.models import Appeal, AppealStatus, Notification, NotificationType, User, UserBlock, UserRole
from app.schemas import AccountDelete, DataExportRequest, DeletionCheck
from app.schemas import AppealCreate, AppealRead, PersonResult, ShippingAddress, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/{user_id}", response_model=PersonResult)
def get_user_public_profile(
    user_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Resolves a bare user id into the same public-safe shape
    search.py's people section already returns (see PersonResult's own
    comment) — no email, shipping address, or settings toggles. The one
    caller today is NotificationsScreen.tsx tapping a follow/birthday
    notification: those only carry a target_id (see Notification's own
    comment), so the frontend needs a way to turn that back into a
    name/avatar for PosterProfileScreen. No auth required, same as
    search itself — a profile's name/avatar/username aren't private.
    """
    person = db.get(User, user_id)
    if person is None or (blocking.applies_to(current_user) and blocking.is_blocked_between(db, current_user.id, person.id)):
        raise HTTPException(status_code=404, detail="User not found")
    return person


@router.get("/{user_id}/followers", response_model=list[PersonResult])
def list_followers(
    user_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Who follows this account — tapping the "Followers" label on
    ProfileScreen.tsx (your own) or PosterProfileScreen.tsx (someone
    else's) opens this same list either way, since it's public
    information on any profile (same reasoning as get_user_public_profile
    just above: no auth required, PersonResult's public-safe shape) —
    UNLESS the account has set private_follow_lists, in which case only
    the account itself gets the real list back; everyone else gets a 403
    (get_optional_user rather than get_current_active_user here
    specifically so an anonymous viewer still gets a clean 403, not a
    401 that'd read as "log in and you'll see it" — logging in doesn't
    change anything unless it's *their own* account).
    `person.followers` is the `follows`-table-backed relationship on the
    User model, so this is always exactly what following_count counts —
    never a separate, driftable list."""
    person = db.get(User, user_id)
    if person is None:
        raise HTTPException(status_code=404, detail="User not found")
    if person.private_follow_lists and (current_user is None or current_user.id != person.id):
        raise HTTPException(status_code=403, detail="This account's followers list is private.")
    return person.followers


@router.get("/{user_id}/following", response_model=list[PersonResult])
def list_following(
    user_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Who this account follows — the "Following" label's counterpart to
    list_followers just above. Same public-unless-private-and-not-you
    gate, same reasoning."""
    person = db.get(User, user_id)
    if person is None:
        raise HTTPException(status_code=404, detail="User not found")
    if person.private_follow_lists and (current_user is None or current_user.id != person.id):
        raise HTTPException(status_code=403, detail="This account's following list is private.")
    return person.following


@router.get("/{user_id}/mutual-followers", response_model=list[PersonResult])
def list_mutual_followers(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """People who follow both the signed-in viewer and this account —
    the "X mutual followers" row PosterProfileScreen.tsx shows under
    someone else's bio, tappable into the same FollowListScreen used for
    followers/following/likes. Auth required (get_current_active_user,
    not get_optional_user like list_followers/list_following above)
    since there's no "mutual" to compute without knowing who's asking.

    Gated by BOTH private_follow_lists and hide_mutual_followers on the
    account being viewed — private_follow_lists because this is
    literally a filtered view into that same followers list (hiding the
    full list but leaving a derived slice of it open would defeat the
    point), hide_mutual_followers for someone who's fine with their
    followers list being visible but doesn't want the mutual-friends-
    style comparison shown. Only the target's settings apply, not the
    viewer's own — same "it's the profile owner's call what's shown
    about them" reasoning as private_follow_lists itself; the viewer's
    own lists aren't exposed by this endpoint, only who they have in
    common with the target."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == current_user.id:
        # No meaningful "mutual followers with yourself" — the frontend
        # never surfaces this row on your own profile, but return an
        # empty list rather than erroring if it's ever hit directly.
        return []
    if target.private_follow_lists or target.hide_mutual_followers:
        raise HTTPException(status_code=403, detail="Mutual followers are hidden for this account.")
    target_follower_ids = {u.id for u in target.followers}
    return [u for u in current_user.followers if u.id in target_follower_ids]


@router.patch("/me", response_model=UserRead)
def update_current_user(
    payload: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to ProfileScreen.tsx's Edit profile form (display name + bio),
    SettingsScreen.tsx's autoplay/mute toggles, and checkout's "remember
    this address for next time" write (see payments.py). exclude_unset
    means a field the client never sent is left alone entirely, not reset
    to a default.

    shipping_address needs its own handling below rather than the plain
    setattr loop every other field gets: it's not a real column (see
    ShippingAddressMixin), and it's a *partial* address here
    (ShippingAddressUpdate) that has to be merged onto whatever's already
    saved — {"shipping_address": {"line2": "Apt 4B"}} should only change
    line2, not wipe out the rest of a previously-saved address.
    """
    data = payload.model_dump(exclude_unset=True)
    if "username" in data and data["username"] != current_user.username:
        if db.query(User).filter(User.username == data["username"]).first() is not None:
            raise HTTPException(status_code=400, detail="Username already taken")

    address_update = data.pop("shipping_address", None)
    flags = []
    for field in ("username", "display_name", "bio"):
        if field in data and data[field] != getattr(current_user, field):
            word = screening.enforce_text(db, data[field])
            if word:
                flags.append((field, word, data[field]))
    for field, value in data.items():
        setattr(current_user, field, value)
    for field, word, value in flags:
        screening.flag_text(db, "user", current_user.id, current_user.id, field, word, value)
    if "avatar_url" in data and data["avatar_url"]:
        screening.request_media_check(db, "user", current_user.id)
    if address_update is not None:
        merged = {
            **(current_user.shipping_address or {}),
            **{k: v for k, v in address_update.items() if v is not None},
        }
        try:
            # Validated against the *complete* shape (ShippingAddress,
            # not the partial ShippingAddressUpdate this endpoint
            # accepted) — catches a merge that's still missing a
            # required field (e.g. the very first PATCH only ever sent
            # {"line2": "..."} with nothing saved yet to merge onto) as
            # a clean 400 instead of a KeyError inside set_shipping_address.
            validated = ShippingAddress.model_validate(merged)
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail="Incomplete shipping address") from exc
        current_user.set_shipping_address(validated.model_dump())

    db.commit()
    db.refresh(current_user)
    return current_user


# No request/response body needed for any of these three — the caller is
# always "me" (from the token) acting on a target id in the path, and the
# only thing worth telling the frontend is a yes/no. Same shape as
# video_posts.py's watchlist routes: POST/DELETE to add/remove rather
# than one endpoint that flips state, so the client always knows which
# way it just went instead of tracking it itself; GET to answer "have I
# already done this" for whatever the frontend needs to render an
# initial button state from (VideoStage's Follow button, in this case —
# there's no bulk "which of these posters do I follow" route, since
# nothing on the frontend currently needs more than one at a time).


@router.get("/me/blocks", response_model=list[PersonResult])
def list_my_blocks(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Accounts the signed-in person has blocked (Settings > Blocked accounts), newest first."""
    return (
        db.query(User)
        .join(UserBlock, UserBlock.blocked_id == User.id)
        .filter(UserBlock.blocker_id == current_user.id)
        .order_by(UserBlock.created_at.desc())
        .all()
    )


@router.post("/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def block_user(
    request: Request,
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Block an account: you and they stop seeing each other's videos, comments, products and profile, and any
    follow between you ends. Safe to repeat."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't block yourself.")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role == UserRole.admin:
        raise HTTPException(status_code=400, detail="This account can't be blocked.")
    blocking.add_block(db, current_user, target)


@router.delete("/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
def unblock_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    blocking.remove_block(db, current_user, user_id)


@router.get("/{user_id}/follow", response_model=bool)
def get_follow_status(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    return target in current_user.following


@router.post("/{user_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def follow_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Can't follow yourself")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if blocking.is_blocked_between(db, current_user.id, target.id):
        raise HTTPException(status_code=403, detail="You can't follow this account.")
    if target not in current_user.following:
        current_user.following.append(target)
        db.add(
            Notification(
                user_id=target.id,
                body=f"{current_user.display_name} started following you.",
                type=NotificationType.follow,
                target_id=current_user.id,
            )
        )
        db.commit()


@router.delete("/{user_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target in current_user.following:
        current_user.following.remove(target)
        db.commit()


# Deliberately get_current_user, not get_current_active_user, for both
# of these — a banned account is exactly who needs to reach them. See
# get_current_active_user's own comment in auth/dependencies.py for why
# a banned session can still authenticate at all rather than being
# rejected outright.


@router.post("/me/appeal", response_model=AppealRead, status_code=status.HTTP_201_CREATED)
def file_appeal(
    payload: AppealCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The suspension screen's "appeal this" form. Refused for an
    account that isn't actually banned (nothing to appeal), and refused
    while a previous appeal from this same account is still pending —
    not a database constraint (a denied appeal doesn't block filing
    another one later, only a pending one does), so this check is the
    only place that rule is enforced.
    """
    if current_user.is_active:
        raise HTTPException(status_code=400, detail="Your account isn't suspended")
    existing = (
        db.query(Appeal)
        .filter(Appeal.user_id == current_user.id, Appeal.status == AppealStatus.pending)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=400, detail="You already have an appeal pending review")

    appeal = Appeal(user_id=current_user.id, message=payload.message)
    db.add(appeal)
    db.commit()
    db.refresh(appeal)
    return appeal


@router.get("/me/appeals", response_model=list[AppealRead])
def list_my_appeals(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """So the suspension screen can show "your appeal is under review" /
    the admin's response, rather than just a bare "file an appeal" form
    with no memory of one already sent.
    """
    return (
        db.query(Appeal)
        .filter(Appeal.user_id == current_user.id)
        .order_by(Appeal.created_at.desc())
        .all()
    )


@router.get("/me/deletion-check", response_model=DeletionCheck)
def deletion_check(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Can this account be deleted right now, and if not, why not. The app asks before it
    shows the final confirmation, so nobody types a password only to be refused."""
    reasons = account_deletion.blockers(db, current_user)
    if current_user.role == UserRole.admin:
        reasons.insert(0, "Admin accounts can't be deleted from the app.")
    return DeletionCheck(can_delete=not reasons, reasons=reasons, has_password=current_user.hashed_password is not None)


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
def delete_my_account(
    request: Request,
    payload: AccountDelete,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Permanently delete the caller's account (see app/account_deletion.py for what goes and
    what stays). Needs the word DELETE, plus the password when the account has one."""
    if payload.confirm.strip().upper() != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm.")
    if current_user.hashed_password is not None and not (
        payload.password and verify_password(payload.password, current_user.hashed_password)
    ):
        raise HTTPException(status_code=403, detail="That password isn't right.")
    if current_user.role == UserRole.admin:
        raise HTTPException(status_code=403, detail="Admin accounts can't be deleted from the app.")
    reasons = account_deletion.blockers(db, current_user)
    if reasons:
        raise HTTPException(status_code=409, detail="You can't delete your account yet. " + " ".join(reasons))
    urls = account_deletion.delete_account(db, current_user)
    storage.delete_view_urls(urls)  # after the commit: a storage hiccup can't undo the deletion
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/me/export")
@limiter.limit("3/hour")
def export_my_data(
    request: Request,
    payload: DataExportRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Download everything we hold about the caller as one JSON file (app/data_export.py). Asks for the password when
    the account has one, because the file holds addresses, orders and messages: a borrowed phone should not be
    enough to walk away with it. POST so the file is never a cached or logged URL."""
    if current_user.hashed_password is not None and not (
        payload.password and verify_password(payload.password, current_user.hashed_password)
    ):
        raise HTTPException(status_code=403, detail="That password isn't right.")
    body = json.dumps(data_export.build_export(db, current_user), indent=2, ensure_ascii=False)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="lumin-my-data.json"',
            "Cache-Control": "no-store",
        },
    )

"""
Every model needs to be imported somewhere before Base.metadata is used
(by Alembic's autogenerate, or by Base.metadata.create_all) — otherwise
SQLAlchemy doesn't know a table exists yet. Centralizing that here means
the rest of the app (and alembic/env.py) only needs one import:

    from app.models import Base

and every table below comes along with it.
"""

from .base import Base
from .catalog import Category, CategoryBanner, Deal, Product, ProductImage
from .commerce import CartItem, Order, OrderStatus, Payment, PaymentMode, PayoutStatus, PaymentStatus
from .delivery import DeliveryCompany
from .discount import DiscountCode, DiscountKind, DiscountRedemption
from .merchant import MerchantAccount
from .moderation import Appeal, AppealStatus, Report, ReportReason, ReportStatus, ReportTargetType
from .notification import Notification, NotificationType
from .password_reset import PasswordResetToken
from .return_claim import ReturnClaim, ReturnClaimStatus
from .traffic import TrafficSource
from .twin_search import MomentEvidence, TwinSearch, TwinSearchStatus, VideoMomentProduct, WantedOffer
from .user import User, UserRole, follows
from .video import (
    Comment,
    Interest,
    VideoFeed,
    TwinRequest,
    TwinRequestStatus,
    TwinReviewStatus,
    VideoPost,
    VideoPostTwin,
    VideoView,
    REACTION_TYPES,
    comment_likes,
    comment_reactions,
    post_likes,
    post_shares,
    video_post_interests,
    video_post_products,
    retwin_twins,
    twin_request_supporters,
    watchlist_items,
)

__all__ = [
    "Base",
    "Category",
    "CategoryBanner",
    "Deal",
    "Product",
    "ProductImage",
    "CartItem",
    "Order",
    "OrderStatus",
    "Payment",
    "PaymentMode",
    "PayoutStatus",
    "PaymentStatus",
    "DeliveryCompany",
    "DiscountCode",
    "DiscountKind",
    "DiscountRedemption",
    "MerchantAccount",
    "Appeal",
    "AppealStatus",
    "Report",
    "ReportReason",
    "ReportStatus",
    "ReportTargetType",
    "Notification",
    "NotificationType",
    "PasswordResetToken",
    "ReturnClaim",
    "ReturnClaimStatus",
    "TrafficSource",
    "TwinSearch",
    "TwinSearchStatus",
    "MomentEvidence",
    "VideoMomentProduct",
    "WantedOffer",
    "User",
    "UserRole",
    "follows",
    "Comment",
    "Interest",
    "VideoFeed",
    "TwinRequest",
    "TwinRequestStatus",
    "TwinReviewStatus",
    "retwin_twins",
    "twin_request_supporters",
    "VideoPost",
    "VideoPostTwin",
    "VideoView",
    "comment_likes",
    "comment_reactions",
    "REACTION_TYPES",
    "post_likes",
    "post_shares",
    "video_post_interests",
    "video_post_products",
    "watchlist_items",
]

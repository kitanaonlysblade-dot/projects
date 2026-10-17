"""Scoring for twin search: how well does a catalog product answer "what is this?".

Deliberately free of database imports so it is cheap to unit-test and reuse.
The database side (candidate lookup, results, waitlist) is in
app/twin_search_service.py.

Two numbers per product:

* ``base``  - how well the product's *content* matches the description, 0..1.
  This alone decides whether it counts as a match at all.
* ``rank``  - ``base`` plus a small listing-quality bonus (several photos, a real
  description). Quality only reorders products that already match; it can never
  turn a non-match into a match. That is the SEO effect for merchants: the better
  the listing is written and photographed, the higher it ranks among equals.

Matching is text-only and runs entirely here: no clip, frame or photo is sent to any
outside model or service.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Protocol, Sequence

_STOPWORDS = frozenset(
    """
    a an the of for with and or in on to is it its this that these those what whats which
    where who how can could would should do does did find get buy need want show some any
    i me my you your we our they them please looks look like similar wearing wears wear
    there here one ones thing things item items product video clip moment
    """.split()
)

_WORD = re.compile(r"[^\W_]+", re.UNICODE)

# Where in a product a query word was found, best first.
_W_NAME = 1.0
_W_ATTR = 0.8  # colour, category or banner
_W_NAME_PREFIX = 0.7
_W_DESC = 0.6

_MAX_QUALITY_BONUS = 0.12


def _stem(word: str) -> str:
    """Tiny plural stripper so "shoes"/"shoe" and "bags"/"bag" meet. Applied to
    both sides, so it only has to be consistent, not linguistically right."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("sses"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def tokens(text: str | None) -> list[str]:
    """Lower-cased, de-pluralised words with filler removed, in order, no repeats."""
    if not text:
        return []
    seen: dict[str, None] = {}
    for raw in _WORD.findall(text.lower()):
        if raw in _STOPWORDS or len(raw) < 2:
            continue
        seen.setdefault(_stem(raw), None)
    return list(seen)


def normalize_query(text: str) -> str:
    """Order-insensitive key for counting the same demand once: "red leather bag"
    and "Leather bag, red" collapse to the same keyword."""
    return " ".join(sorted(tokens(text)))[:120]


class _ProductLike(Protocol):
    name: str
    description: str | None
    colors: Sequence[str] | None
    images: Sequence[object]


@dataclass(frozen=True)
class Match:
    base: float
    rank: float


def score_product(
    query_tokens: Sequence[str],
    product: _ProductLike,
    extra_attrs: Iterable[str] = (),
) -> Match:
    """Score one product against already-tokenised query words. ``extra_attrs`` is
    for context the product row doesn't hold itself (its category name, banner)."""
    if not query_tokens:
        return Match(0.0, 0.0)

    name_t = set(tokens(product.name))
    desc_t = set(tokens(product.description))
    attr_t = set(tokens(" ".join([*(product.colors or []), *extra_attrs])))

    total = 0.0
    for q in query_tokens:
        if q in name_t:
            total += _W_NAME
        elif q in attr_t:
            total += _W_ATTR
        elif len(q) >= 4 and any(n.startswith(q) or q.startswith(n) for n in name_t if len(n) >= 4):
            total += _W_NAME_PREFIX
        elif q in desc_t:
            total += _W_DESC
    base = total / len(query_tokens)

    quality = 0.0
    if base > 0:
        quality += min(len(product.images or []), 4) * 0.02  # up to 0.08
        if len(product.description or "") >= 80:
            quality += 0.04
    # rank may exceed 1.0 on purpose: it only orders results, so a cap would tie them.
    return Match(base=base, rank=base + min(quality, _MAX_QUALITY_BONUS))

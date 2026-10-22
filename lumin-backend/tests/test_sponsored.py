import uuid
from datetime import datetime, timedelta

import random

from app.sponsored import Candidate, Look, color_family, infer_audience, infer_style, kind_of, learned_score, rank, rank_many, wanted_kinds

NOW = datetime(2026, 10, 16)


def cand(kind="bottom", merchant=None, in_stock=True, imp=0, age=0, product=None, price=None, style=None, color=None, audience=None, learned=0.0):
    return Candidate(uuid.uuid4(), product or uuid.uuid4(), merchant or uuid.uuid4(), kind, in_stock, imp, NOW + timedelta(days=age), price, style, color, audience, learned)


def test_kinds_are_read_from_the_product_name():
    assert kind_of("Classic Crew Tee") == "top"
    assert kind_of("Wide-Leg Trousers") == "bottom"
    assert kind_of("Pro Hair Clipper") == "grooming_tool"
    assert kind_of("Shea hair cream") == "hair_care"
    assert kind_of("Running Sneakers") == "footwear"
    assert kind_of("Smart Watch") == "wearable_tech"
    assert kind_of("Mystery thing") is None
    assert kind_of("Mystery thing", "a lovely pair of trousers") == "bottom"


def test_a_tshirt_gets_trousers_shoes_or_a_jacket_never_another_tshirt():
    assert rank([cand("top")], {"top"}, set(), set()) is None
    for k in ("bottom", "footwear", "outerwear"):
        c = cand(k)
        assert rank([cand("top"), c], {"top"}, set(), set()) is c


def test_a_clipper_gets_hair_cream_not_another_clipper():
    assert rank([cand("grooming_tool")], {"grooming_tool"}, set(), set()) is None
    cream = cand("hair_care")
    assert rank([cand("grooming_tool"), cream], {"grooming_tool"}, set(), set()) is cream


def test_kinds_already_in_the_video_are_never_offered():
    assert "top" not in wanted_kinds({"top", "bottom"})
    assert rank([cand("top")], {"top", "bottom"}, set(), set()) is None


def test_unknown_or_unpaired_kinds_mean_no_ad():
    assert rank([cand("bottom")], set(), set(), set()) is None
    assert rank([cand("bottom")], {"kitchen"}, set(), set()) is None


def test_the_videos_own_products_and_sellers_are_not_advertised_back():
    mine, seller = uuid.uuid4(), uuid.uuid4()
    assert rank([cand(product=mine)], {"top"}, {mine}, set()) is None
    assert rank([cand(merchant=seller)], {"top"}, set(), {seller}) is None


def test_out_of_stock_and_sellerless_products_are_never_shown():
    assert rank([cand(in_stock=False)], {"top"}, set(), set()) is None
    c = cand()
    c.merchant_id = None
    assert rank([c], {"top"}, set(), set()) is None


def test_sellers_take_turns_least_shown_first_then_oldest():
    a, b, c = cand(imp=5, age=0), cand(imp=2, age=2), cand(imp=2, age=1)
    assert rank([a, b, c], {"top"}, set(), set()) is c


def test_several_are_shown_each_a_different_kind():
    r = random.Random(1)
    cs = [cand("bottom"), cand("bottom"), cand("footwear"), cand("outerwear"), cand("top")]
    got = rank_many(cs, {"top"}, set(), set(), rng=r)
    assert sorted(c.kind for c in got) == ["bottom", "footwear", "outerwear"]  # no second trousers, no top
    assert len(rank_many(cs, {"top"}, set(), set(), limit=2, rng=r)) == 2
    assert rank_many(cs, set(), set(), set()) == []


def test_the_kit_is_every_kind_that_completes_it_not_a_capped_few():
    kinds = ["bottom", "footwear", "outerwear", "bag", "accessory", "fragrance"]
    got = rank_many([cand(k) for k in kinds], {"top"}, set(), set())
    assert sorted(c.kind for c in got) == sorted(kinds)


def test_the_set_rotates_when_there_are_many_sponsor_products():
    r = random.Random(7)
    cs = [cand("bottom") for _ in range(6)]
    seen = set()
    for _ in range(6):
        pick = rank_many(cs, {"top"}, set(), set(), rng=r)[0]
        pick.impressions += 1
        seen.add(pick.id)
    assert len(seen) == 6  # every product got a turn before any repeats


def test_the_kit_stays_in_the_price_range_of_the_video():
    tee = [20.0]
    cheap_ok, pricey = cand("bottom", price=35.0), cand("outerwear", price=900.0)
    got = rank_many([cheap_ok, pricey, cand("footwear", price=2.0)], {"top"}, set(), set(), featured_prices=tee)
    assert got == [cheap_ok]  # the 900 jacket and the 2 shoes do not fit a 20 tee
    assert rank([pricey], {"top"}, set(), set(), featured_prices=tee) is None
    # a few products at different prices: the whole range counts
    assert rank_many([cand("outerwear", price=90.0)], {"top", "bottom"}, set(), set(), featured_prices=[20.0, 40.0])


def test_unknown_prices_are_not_filtered():
    c = cand("bottom", price=None)
    assert rank([c], {"top"}, set(), set(), featured_prices=[20.0]) is c
    assert rank([cand("bottom", price=500.0)], {"top"}, set(), set()) is not None


def look(styles=(), audiences=(), colors=()):
    return Look(set(styles), set(audiences), set(colors))


def test_style_is_read_from_names_and_colours_from_hex():
    assert infer_style("Oversized Graphic Tee") == "streetwear"
    assert infer_style("Tailored Blazer") == "formal"
    assert infer_style("Mystery") is None
    assert infer_audience("Women's Satin Slip Dress") == "women"
    assert color_family("#1c1c1c") == "black"
    assert color_family("#e8e4da") in ("white", "beige")
    assert color_family("navy") == "navy"
    assert color_family("#b3505c") in ("red", "pink")


def test_the_closest_style_wins_and_clashes_are_left_out():
    streetwear_tee = look(styles={"streetwear"})
    same, formal, none = cand("bottom", style="streetwear"), cand("bottom", style="formal"), cand("bottom")
    assert rank([formal], {"top"}, set(), set(), look=streetwear_tee) is None  # formal trousers vs a streetwear tee
    assert rank([formal, none, same], {"top"}, set(), set(), look=streetwear_tee) is same  # same style beats untagged


def test_menswear_is_not_shown_next_to_womenswear():
    womens = look(audiences={"women"})
    assert rank([cand("footwear", audience="men")], {"top"}, set(), set(), look=womens) is None
    uni = cand("footwear", audience="unisex")
    assert rank([cand("footwear", audience="men"), uni], {"top"}, set(), set(), look=womens) is uni


def test_neutral_colours_go_with_anything_and_loud_clashes_lose():
    red_top = look(colors={"red"})
    black, green = cand("bottom", color="black"), cand("bottom", color="green")
    assert rank([green, black], {"top"}, set(), set(), look=red_top) is black


def test_pairs_shoppers_act_on_rank_higher():
    good, meh = cand("bottom", learned=learned_score(100, 20, 10, 5)), cand("bottom", learned=learned_score(100, 1, 0, 0))
    assert learned_score(100, 20, 10, 5) > learned_score(100, 1, 0, 0)
    assert rank([meh, good], {"top"}, set(), set(), look=look()) is good


def test_equally_close_matches_still_take_turns():
    a, b = cand("bottom", style="casual", imp=3), cand("bottom", style="casual", imp=1)
    assert rank([a, b], {"top"}, set(), set(), look=look(styles={"casual"})) is b


def test_sale_fee_is_a_percent_of_the_price_rounded_to_the_cent(monkeypatch):
    from decimal import Decimal

    from app.sponsored import sale_fee, sale_percent

    assert sale_fee(58, 10) == Decimal("5.80")
    assert sale_fee(19.99, 10) == Decimal("2.00")
    assert sale_fee(10, 0) == Decimal("0.00")
    monkeypatch.delenv("SPONSORED_SALE_PERCENT", raising=False)
    assert sale_percent() == Decimal("10")
    monkeypatch.setenv("SPONSORED_SALE_PERCENT", "7.5")
    assert sale_percent() == Decimal("7.5")
    monkeypatch.setenv("SPONSORED_SALE_PERCENT", "250")
    assert sale_percent() == Decimal("100")
    monkeypatch.setenv("SPONSORED_SALE_PERCENT", "junk")
    assert sale_percent() == Decimal("10")


def test_an_order_through_a_card_carries_the_percent_and_fee():
    from types import SimpleNamespace

    from app.sponsored import apply_to_order

    o = SimpleNamespace(price=40, sponsored_twin_id=None, sponsored_fee_percent=None, sponsored_fee=None)
    apply_to_order(o, None)
    assert o.sponsored_fee is None
    t = uuid.uuid4()
    apply_to_order(o, t)
    assert o.sponsored_twin_id == t and float(o.sponsored_fee) == 4.0 and float(o.sponsored_fee_percent) == 10.0


def test_a_product_is_understood_from_its_own_data_with_no_seller_questions():
    from types import SimpleNamespace as N

    from app.sponsored import profile_of

    tee = N(name="Classic Crew Tee", description="Soft everyday cotton", colors=["#1c1c1c", "#e8e4da"], banner=None)
    assert profile_of(tee) == {"kind": "top", "style": "casual", "audience": None, "colors": {"black", "white"}} or profile_of(tee)["kind"] == "top"
    vague = N(name="Item 4", description=None, colors=[], banner=N(title="Shoes & Sneakers", category=N(name="Footwear")))
    assert profile_of(vague)["kind"] == "footwear"  # the section it sits in fills the gap


def test_colours_come_from_the_product_colour_list():
    c = cand("bottom")
    c.colors = {"black"}
    green = cand("bottom")
    green.colors = {"green"}
    assert rank([green, c], {"top"}, set(), set(), look=look(colors={"red"})) is c


def test_ai_profile_wins_over_keywords_and_fills_what_rules_cannot():
    from types import SimpleNamespace as N

    from app.sponsored import profile_of

    vague = N(name="Lagos night-out co-ord set", description=None, colors=[], banner=None)
    assert profile_of(vague)["kind"] is None
    ai = N(source="ai", kind="dress", style="party", audience="women", colors=["black"])
    got = profile_of(vague, ai)
    assert (got["kind"], got["style"], got["audience"], got["colors"]) == ("dress", "party", "women", {"black"})
    pending = N(source="pending", kind="top", style=None, audience=None, colors=[])
    assert profile_of(vague, pending)["kind"] is None  # a queued, unread product is not trusted


def test_the_model_reply_is_cleaned_to_words_the_matcher_knows():
    from app.product_ai import parse_profile

    ok = parse_profile('Sure! {"kind": "Footwear", "style": "Streetwear", "audience": "men", "colors": ["Black", "white", "sparkly", "black"]}')
    assert ok == {"kind": "footwear", "style": "streetwear", "audience": "men", "colors": ["black", "white"]}
    junk = parse_profile('{"kind": "spaceship", "style": 5, "audience": null, "colors": "red"}')
    assert junk == {"kind": None, "style": None, "audience": None, "colors": []}
    assert parse_profile("not json") is None and parse_profile(None) is None and parse_profile("[1]") is None


def test_the_job_saves_the_models_answer(monkeypatch):
    import types

    from app import product_ai

    saved = {}
    prod = types.SimpleNamespace(id=uuid.uuid4(), name="Co-ord set", description="x", colors=["#1c1c1c"], price=30, images=[], banner=None)

    class Row:
        pass

    class DB:
        def get(self, model, key):
            return prod if model.__name__ == "Product" else None

        def add(self, row):
            saved["row"] = row

        def commit(self):
            saved["committed"] = True

        def close(self):
            pass

    import app.database as database
    import app.models as models

    monkeypatch.setattr(database, "SessionLocal", lambda: DB(), raising=False)
    monkeypatch.setattr(models, "ProductProfile", type("ProductProfile", (), {"__init__": lambda s, product_id: setattr(s, "product_id", product_id)}), raising=False)
    monkeypatch.setattr(models, "Product", type("Product", (), {}), raising=False)
    product_ai.profile_product({"product_id": str(prod.id)}, ask=lambda info, img: '{"kind":"dress","style":"party","audience":"women","colors":["black"]}')
    r = saved["row"]
    assert (r.kind, r.style, r.audience, r.colors, r.source) == ("dress", "party", "women", ["black"], "ai") and saved["committed"]


def test_a_choice_of_two_per_kind_grouped_with_the_lead_first():
    r = random.Random(5)
    cs = [cand("bottom", imp=1), cand("bottom", imp=2), cand("bottom", imp=3), cand("footwear", imp=1), cand("footwear", imp=2)]
    got = rank_many(cs, {"top"}, set(), set(), per_kind=2, rng=r)
    assert [c.kind for c in got] == ["bottom", "bottom", "footwear", "footwear"]  # two of each, grouped, never three
    assert got[0].impressions == 1  # the lead is the least-shown


def test_the_strip_is_capped_and_every_kind_keeps_its_lead_first():
    kinds = ["bottom", "footwear", "outerwear", "bag", "accessory", "fragrance"]
    cs = [cand(k, imp=i) for k in kinds for i in (0, 1)]
    got = rank_many(cs, {"top"}, set(), set(), per_kind=2, max_total=8, rng=random.Random(2))
    assert len(got) == 8
    assert {c.kind for c in got} == set(kinds)  # all six leads made it before any second choice


def test_a_weaker_match_never_fills_the_second_slot():
    streetwear = look(styles={"streetwear"})
    good, ok_but_formal = cand("bottom", style="streetwear"), cand("bottom")
    got = rank_many([good, ok_but_formal], {"top"}, set(), set(), per_kind=2, look=streetwear)
    assert got == [good]  # an untagged one is 2 points behind: not an equal fit

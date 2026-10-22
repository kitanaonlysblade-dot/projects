"""Pure parts of the seal bags: the code format, hashing, the one-way status map and the print sheet."""
from app import seals


def test_code_is_20_unambiguous_characters_and_round_trips_from_the_qr_and_the_typed_form():
    c = seals.new_code()
    assert len(c) == 20 and all(ch in seals.ALPHABET for ch in c)
    assert seals.normalize(seals.qr_text(c)) == c
    assert seals.normalize(seals.pretty(c).lower()) == c
    assert seals.normalize(" " + seals.pretty(c) + " ") == c


def test_things_that_are_not_codes_are_rejected():
    assert seals.normalize("") is None
    assert seals.normalize("abc") is None
    assert seals.normalize(seals.new_code()[:-1] + "0") is None  # 0 is never in a code


def test_only_a_hash_is_kept_and_it_is_stable():
    c = seals.new_code()
    assert seals.hash_code(c) == seals.hash_code(c) and len(seals.hash_code(c)) == 64 and c not in seals.hash_code(c)
    assert seals.hash_code(c) != seals.hash_code(seals.new_code())


def test_status_only_moves_forward():
    f = seals.FORWARD
    assert f["unused"] == {"preview_used", "void"}
    assert f["preview_used"] == {"in_transit", "void"}
    assert f["in_transit"] == {"delivered", "void"}
    assert f["delivered"] == set() and f["void"] == set()  # nothing leaves these: a delivered bag is never reusable
    assert "unused" not in set().union(*f.values())  # nothing goes back to unused


def test_print_sheet_is_a_pdf_and_grows_with_more_labels():
    rows = [(f"LB-{i:07d}", seals.new_code()) for i in range(1, 30)]
    pdf = seals.print_sheet(rows, "t")
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > len(seals.print_sheet(rows[:3], "t"))

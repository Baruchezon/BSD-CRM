"""Independently parse the actual BSD contact file downloaded from production."""
from urllib.request import Request, urlopen
import vobject

URL = "https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/public-digital-card?short=ezon&format=vcard"
request = Request(URL, headers={"User-Agent": "BSD-VCF-Validation/1.0"})
with urlopen(request, timeout=20) as response:
    content_type = response.headers.get("Content-Type", "")
    filename = response.headers.get("Content-Disposition", "")
    blob = response.read()

assert content_type.lower().startswith(("text/x-vcard", "text/vcard")), content_type
assert filename.find("BSD_ezon.vcf") >= 0, filename
assert blob[:11] == b"BEGIN:VCARD", blob[:12].hex()
assert not blob.startswith(b"\xef\xbb\xbf"), "Unexpected UTF-8 BOM"
assert b"\r\n" in blob
text = blob.decode("utf-8", errors="strict")
assert text.endswith("END:VCARD\r\n")
cards = list(vobject.readComponents(text))
assert len(cards) == 1, f"Expected one contact, found {len(cards)}"
card = cards[0]
assert card.name == "VCARD"
assert card.version.value == "3.0"
assert card.fn.value == "ברוך איזון", card.fn.value
assert card.n.value.family == "איזון", card.n.value
assert card.n.value.given == "ברוך", card.n.value
phones = [v.value for v in card.tel_list]
assert "054-2424999" in phones, phones
assert "077-4446707" in phones, phones
assert card.email.value == "baruch@bsd-bbi.co.il", card.email.value
assert len(blob) > 100
print(f"PASS external vobject parser: {len(blob)} bytes, correct UTF-8 Hebrew, N/FN, phones and email")

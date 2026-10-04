import re
from typing import Dict
from bs4 import BeautifulSoup
from ethiobank_receipts.download import session as http_session


def extract_tele_receipt_data(url_or_id: str) -> Dict[str, str]:
    """
    Extract essential Telebirr receipt details:
    payer_name, payer_number, credited_party, credited_party_number, status, total_paid.

    Accepts either a full URL or just an ID.
    """
    if not url_or_id:
        raise ValueError("Telebirr receipt id or URL is required")

    url = url_or_id if url_or_id.startswith(
        "http") else f"https://transactioninfo.ethiotelecom.et/receipt/{url_or_id}"

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    resp = http_session.get(url, headers=headers)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    data: Dict[str, str] = {}

    def _clean(val: str) -> str:
        return re.sub(r"^[:\-\s]+|[:\-\s]+$", "", (val or "")).strip()

    # 1. Row-by-row table inspection (handles <tr><td>Label</td><td>Value</td></tr> and <th>)
    for row in soup.find_all("tr"):
        cells = row.find_all(["td", "th"])
        if len(cells) >= 2:
            col0 = cells[0].get_text(" ", strip=True)
            col1 = cells[1].get_text(" ", strip=True)
            if not col0 or not col1:
                continue

            if re.search(r"Payer\s*Name|የከፋይ\s*ስም", col0, re.I) and "payer_name" not in data:
                data["payer_name"] = _clean(col1)
            elif re.search(r"Payer\s*telebirr|የከፋይ\s*ቴሌብር", col0, re.I) and "payer_number" not in data:
                data["payer_number"] = _clean(col1)
            elif re.search(r"Credited\s*Party\s*name|የገንዘብ\s*ተቀባይ\s*ስም", col0, re.I) and "credited_party" not in data:
                data["credited_party"] = _clean(col1)
            elif re.search(r"Credited\s*party\s*account|የገንዘብ\s*ተቀባይ\s*(?:ቴሌብር|አካውንት)", col0, re.I) and "credited_party_number" not in data:
                data["credited_party_number"] = _clean(col1)
            elif re.search(r"transaction\s*status|የክፍያው\s*ሁኔታ", col0, re.I) and "status" not in data:
                data["status"] = _clean(col1)
            elif re.search(r"Total\s*Paid\s*Amount|የተከፈለው\s*ጠቅላላ|Settled\s*Amount", col0, re.I) and "total_paid" not in data:
                data["total_paid"] = _clean(col1)

    # 2. Body-text regex fallback if table inspection missed any field
    body_text = re.sub(r"\s+", " ", soup.get_text())

    if not data.get("payer_name"):
        m = re.search(
            r"(?:የከፋይ\s*ስም[/\s]*Payer\s*Name|Payer\s*Name)\s*[:\-]?\s*([A-Za-z\u1200-\u137F\s.]+?)(?=\s*(?:የከፋይ\s*ቴሌብር|Payer\s*telebirr|የከፋይ\s*አካውንት|Payer\s*Account|$))",
            body_text, re.I
        )
        if m:
            data["payer_name"] = _clean(m.group(1))

    if not data.get("payer_number"):
        m = re.search(
            r"(?:የከፋይ\s*ቴሌብር\s*(?:ቁ\.?|ቁጥር)[/\s]*Payer\s*telebirr\s*no\.?|Payer\s*telebirr\s*no\.?)\s*[:\-]?\s*([0-9*]{9,15})",
            body_text, re.I
        )
        if m:
            data["payer_number"] = _clean(m.group(1))

    if not data.get("credited_party"):
        m = re.search(
            r"(?:የገንዘብ\s*ተቀባይ\s*ስም[/\s]*Credited\s*Party\s*name|Credited\s*Party\s*name)\s*[:\-]?\s*([A-Za-z\u1200-\u137F\s.]+?)(?=\s*(?:የገንዘብ\s*ተቀባይ\s*(?:ቴሌብር|አካውንት)|Credited\s*party\s*account|$))",
            body_text, re.I
        )
        if m:
            data["credited_party"] = _clean(m.group(1))

    if not data.get("credited_party_number"):
        m = re.search(
            r"(?:የገንዘብ\s*ተቀባይ\s*(?:ቴሌብር|አካውንት)\s*(?:ቁ\.?|ቁጥር)?[/\s]*Credited\s*party\s*account\s*no\.?|Credited\s*party\s*account\s*no\.?)\s*[:\-]?\s*([0-9*]{9,15})",
            body_text, re.I
        )
        if m:
            data["credited_party_number"] = _clean(m.group(1))

    if not data.get("status"):
        m = re.search(
            r"(?:የክፍያው\s*ሁኔታ[/\s]*transaction\s*status|transaction\s*status)\s*[:\-]?\s*([A-Za-z\u1200-\u137F]+)",
            body_text, re.I
        )
        if m:
            data["status"] = _clean(m.group(1))

    if not data.get("total_paid"):
        m = re.search(
            r"(?:Total\s*Paid\s*Amount|የተከፈለው\s*ጠቅላላ\s*ገንዘብ)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]{1,2})?)",
            body_text, re.I
        )
        if m:
            data["total_paid"] = _clean(m.group(1))

    return data

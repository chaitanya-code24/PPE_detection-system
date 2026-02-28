from __future__ import annotations

import base64
import json
import os
import smtplib
from typing import Any
from email.message import EmailMessage
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def send_twilio_sms(from_number: str, to_number: str, body: str) -> tuple[bool, str, dict[str, Any]]:
    sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()

    if not sid or not token:
        return False, "Twilio credentials are not configured", {}

    if not from_number.strip() or not to_number.strip() or not body.strip():
        return False, "Sender, receiver, and body are required", {}

    endpoint = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    payload = urlencode(
        {
            "From": from_number.strip(),
            "To": to_number.strip(),
            "Body": body.strip(),
        }
    ).encode("utf-8")

    req = Request(endpoint, data=payload, method="POST")
    token_raw = f"{sid}:{token}".encode("utf-8")
    token_b64 = base64.b64encode(token_raw).decode("ascii")
    req.add_header("Authorization", f"Basic {token_b64}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urlopen(req, timeout=10) as resp:
            status = int(getattr(resp, "status", 200))
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            if 200 <= status < 300:
                return True, "SMS sent", data
            return False, f"Twilio returned status {status}", data
    except HTTPError as exc:
        raw = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {}
        msg = parsed.get("message") or str(exc)
        return False, f"Twilio HTTP {exc.code}: {msg}", parsed
    except URLError as exc:
        return False, f"Network error sending SMS: {exc.reason}", {}
    except Exception as exc:
        return False, f"SMS send failed: {type(exc).__name__}: {exc}", {}


def send_smtp_email(
    from_email: str,
    to_email: str,
    subject: str,
    body: str,
) -> tuple[bool, str, dict[str, Any]]:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587").strip() or "587")
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASS", "").strip()
    use_tls = os.getenv("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes"}

    if not host:
        return False, "SMTP host is not configured", {}
    if not from_email.strip() or not to_email.strip():
        return False, "Sender and receiver email are required", {}

    msg = EmailMessage()
    msg["From"] = from_email.strip()
    msg["To"] = to_email.strip()
    msg["Subject"] = subject.strip()
    msg.set_content(body.strip())

    try:
        with smtplib.SMTP(host=host, port=port, timeout=15) as server:
            server.ehlo()
            if use_tls:
                server.starttls()
                server.ehlo()
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        return True, "Email sent", {}
    except smtplib.SMTPException as exc:
        return False, f"SMTP error: {exc}", {}
    except Exception as exc:
        return False, f"Email send failed: {type(exc).__name__}: {exc}", {}

"""Restricted, inspectable Meta utility templates for staff-approved replies."""

from __future__ import annotations
import re
from typing import Any


def normalize_template(value: Any) -> dict | None:
    if (
        not isinstance(value, dict)
        or value.get("status") != "APPROVED"
        or value.get("category") != "UTILITY"
    ):
        return None
    name, language = value.get("name"), value.get("language")
    if (
        not isinstance(name, str)
        or not re.fullmatch(r"[a-z0-9_]{1,512}", name)
        or not isinstance(language, str)
        or not re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", language)
    ):
        return None
    parts = value.get("components")
    if not isinstance(parts, list) or not 1 <= len(parts) <= 3:
        return None
    texts = {}
    for part in parts:
        if not isinstance(part, dict):
            return None
        kind, text = part.get("type"), part.get("text")
        if (
            kind not in {"BODY", "HEADER", "FOOTER"}
            or kind in texts
            or not isinstance(text, str)
            or not text.strip()
            or len(text) > 4096
        ):
            return None
        if kind == "HEADER" and part.get("format") != "TEXT":
            return None
        if kind != "BODY" and ("{" in text or "}" in text):
            return None
        texts[kind] = text
    if "BODY" not in texts:
        return None
    body = texts["BODY"]
    slots = {int(i) for i in re.findall(r"\{\{([1-9][0-9]?)\}\}", body)}
    if (
        len(slots) > 10
        or slots != set(range(1, len(slots) + 1))
        or re.search(r"[{}]", re.sub(r"\{\{[1-9][0-9]?\}\}", "", body))
    ):
        return None
    return {
        "name": name,
        "language": language,
        "body": body,
        "header": texts.get("HEADER", ""),
        "footer": texts.get("FOOTER", ""),
        "parameterCount": len(slots),
    }


def render_template(template: dict, parameters: Any) -> str:
    if (
        not isinstance(parameters, list)
        or len(parameters) != template["parameterCount"]
        or any(
            not isinstance(v, str)
            or not v.strip()
            or len(v) > 500
            or any(c in v for c in "\n\r\t{}")
            for v in parameters
        )
    ):
        raise ValueError("invalid WhatsApp template parameters")
    body = re.sub(
        r"\{\{([1-9][0-9]?)\}\}", lambda m: parameters[int(m[1]) - 1], template["body"]
    )
    rendered = "\n".join(
        part for part in (template["header"], body, template["footer"]) if part
    )
    if len(rendered) > 4096:
        raise ValueError("WhatsApp template message too long")
    return rendered

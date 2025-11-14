from __future__ import annotations

from typing import Any, Final

import frappe
from frappe.utils import cstr

DEFAULT_CALENDAR_CONFIG: Final[dict[str, str]] = {
	"LICENSE_KEY": "CC-Attribution-NonCommercial-NoDerivatives",
	"DEFAULT_VIEW": "resourceTimeGridDay",
	"SLOT_DURATION": "00:15:00",
	"SLOT_MIN_TIME": "08:00:00",
	"SLOT_MAX_TIME": "20:00:00",
	"SLOT_LABEL_INTERVAL": "01:00:00",
	"RESOURCE_AREA_WIDTH": "75px",
	"SLOT_HEIGHT": "1rem",
}

DEFAULT_ACTION_MENU_ITEMS: Final[list[dict[str, str]]] = []

CONFIG_FIELD_MAP: Final[dict[str, str]] = {
	"scheduler_license_key": "LICENSE_KEY",
	"default_calendar_view": "DEFAULT_VIEW",
	"slot_duration": "SLOT_DURATION",
	"slot_min_time": "SLOT_MIN_TIME",
	"slot_max_time": "SLOT_MAX_TIME",
	"slot_label_interval": "SLOT_LABEL_INTERVAL",
	"resource_area_width": "RESOURCE_AREA_WIDTH",
	"slot_height": "SLOT_HEIGHT",
}


def _get_settings() -> frappe._dict | None:
	if not frappe.db.exists("DocType", "Do Health Settings"):
		return None

	try:
		return frappe.get_single("Do Health Settings")
	except frappe.DoesNotExistError:
		return None


def _coerce_value(value: Any) -> str | None:
	if value in (None, ""):
		return None
	return cstr(value).strip() or None


def _get_config(settings: frappe._dict | None) -> dict[str, str]:
	config = DEFAULT_CALENDAR_CONFIG.copy()

	if not settings:
		return config

	for fieldname, config_key in CONFIG_FIELD_MAP.items():
		value = _coerce_value(settings.get(fieldname))
		if value:
			config[config_key] = value

	return config


def _serialize_action_items(settings: frappe._dict | None) -> list[dict[str, str]]:
	if not settings:
		return DEFAULT_ACTION_MENU_ITEMS.copy()

	rows = settings.get("appointment_action_menu") or []
	enabled = []

	for row in rows:
		if not row or not row.get("is_enabled", 1):
			continue
		if not row.get("action") or not row.get("label"):
			continue

		enabled.append(
			{
				"action": cstr(row.get("action")).strip(),
				"label": row.get("label"),
				"icon": _coerce_value(row.get("icon")) or "fa-cog",
				"sequence": row.get("sequence") or 0,
			}
		)

	if not enabled:
		return DEFAULT_ACTION_MENU_ITEMS.copy()

	enabled.sort(key=lambda item: (item.get("sequence") or 0, item.get("label") or ""))
	return [{"action": item["action"], "label": item["label"], "icon": item["icon"]} for item in enabled]


def get_calendar_preferences(user: str | None = None) -> dict[str, Any]:
	"""Return Do Health calendar configuration and action menu metadata."""

	if user is None:
		user = frappe.session.user

	if user == "Guest":
		return {"config": DEFAULT_CALENDAR_CONFIG.copy(), "action_menu_items": DEFAULT_ACTION_MENU_ITEMS.copy()}

	settings = _get_settings()
	return {
		"config": _get_config(settings),
		"action_menu_items": _serialize_action_items(settings),
	}

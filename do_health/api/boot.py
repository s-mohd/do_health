from __future__ import annotations

import frappe

from do_health.api.sidebar import get_health_sidebar_config


def boot_session(bootinfo: dict[str, object]) -> None:
	"""Attach health sidebar configuration to the Desk boot payload."""

	if frappe.session.user == "Guest":
		return

	bootinfo["health_sidebar_config"] = get_health_sidebar_config()

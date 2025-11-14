from __future__ import annotations

import typing

import frappe
from frappe import _

DEFAULT_ITEMS: typing.Final[list[dict[str, typing.Any]]] = [
	{
		"section": "Primary Nav",
		"label": _("Dashboard"),
		"icon": "es-dashboard",
		"route_type": "Workspace",
		"route_value": "health-dashboard",
		"sequence": 10,
	},
	{
		"section": "Primary Nav",
		"label": _("Inbox"),
		"icon": "es-mail",
		"route_type": "Page",
		"route_value": "health-inbox",
		"sequence": 20,
	},
	{
		"section": "Primary Nav",
		"label": _("Patients"),
		"icon": "es-users",
		"route_type": "Workspace",
		"route_value": "patients",
		"sequence": 30,
	},
	{
		"section": "Patient Actions",
		"label": _("Overview"),
		"icon": "es-layout",
		"route_type": "Form",
		"route_value": "Patient",
		"requires_patient": 1,
		"sequence": 10,
	},
	{
		"section": "Patient Actions",
		"label": _("Documents"),
		"icon": "es-file",
		"route_type": "Page",
		"route_value": "patient-documents",
		"requires_patient": 1,
		"sequence": 20,
	},
	{
		"section": "Patient Actions",
		"label": _("Encounter"),
		"icon": "es-stethoscope",
		"route_type": "Form",
		"route_value": "Patient Encounter",
		"requires_patient": 1,
		"sequence": 30,
	},
]


def _serialize_item(doc: dict[str, typing.Any]) -> dict[str, typing.Any]:
	return {
		"name": doc.get("name"),
		"section": doc.get("section"),
		"label": doc.get("label"),
		"description": doc.get("description"),
		"icon": doc.get("icon"),
		"route_type": doc.get("route_type") or "Workspace",
		"route_value": doc.get("route_value"),
		"route_params": doc.get("route_params"),
		"requires_patient": int(doc.get("requires_patient") or 0),
		"sequence": doc.get("sequence") or 0,
		"badge_method": doc.get("badge_method"),
		"css_class": doc.get("css_class"),
	}


def _group_items(items: list[dict[str, typing.Any]]) -> dict[str, list[dict[str, typing.Any]]]:
	grouped = {"primary_nav": [], "patient_actions": []}
	for item in items:
		key = "primary_nav" if item.get("section") == "Primary Nav" else "patient_actions"
		grouped[key].append(item)

	grouped["primary_nav"].sort(key=lambda d: (d.get("sequence") or 0, d.get("label")))
	grouped["patient_actions"].sort(key=lambda d: (d.get("sequence") or 0, d.get("label")))
	return grouped


def _get_items_for_roles(roles: set[str]) -> list[dict[str, typing.Any]]:
	filters = {"is_active": 1}
	docs = frappe.get_all(
		"Health Sidebar Item",
		fields=[
			"name",
			"section",
			"label",
			"description",
			"icon",
			"route_type",
			"route_value",
			"route_params",
			"requires_patient",
			"sequence",
			"badge_method",
			"css_class",
		],
		filters=filters,
		order_by="sequence asc, label asc",
	)

	if not docs:
		return [_serialize_item(item) for item in DEFAULT_ITEMS]

	names = [doc.name for doc in docs]
	role_rows = frappe.get_all(
		"Role Multitable",
		fields=["parent", "role"],
		filters={"parenttype": "Health Sidebar Item", "parent": ["in", names]},
	)

	role_map: dict[str, set[str]] = {}
	for row in role_rows:
		role_map.setdefault(row.parent, set()).add(row.role)

	visible: list[dict[str, typing.Any]] = []
	for doc in docs:
		allowed = role_map.get(doc.name)
		if allowed and not roles.intersection(allowed):
			continue
		visible.append(_serialize_item(doc))
	return visible


@frappe.whitelist()
def get_health_sidebar_config(user: str | None = None) -> dict[str, list[dict[str, typing.Any]]]:
	"""Return role-filtered health sidebar items grouped by section."""

	user = user or frappe.session.user
	if not user or user == "Guest":
		return {"primary_nav": [], "patient_actions": []}

	roles = set(frappe.get_roles(user))
	items = _get_items_for_roles(roles)
	return _group_items(items)

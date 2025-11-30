import frappe
from frappe import _


@frappe.whitelist()
def make_consent_form_from_procedure(procedure_name: str, template_name: str | None = None):
	"""Return a new (unsaved) Consent Form document mapped from a Clinical Procedure."""
	if not procedure_name:
		frappe.throw(_("Clinical Procedure is required"))

	procedure = frappe.get_doc("Clinical Procedure", procedure_name)
	template_name = template_name or get_template_for_procedure(procedure.procedure_template)

	consent = frappe.new_doc("Consent Form")
	consent.patient = procedure.patient
	consent.encounter = getattr(procedure, "encounter", None)
	consent.company = procedure.company
	consent.clinical_procedure = procedure.name
	consent.procedure_template = procedure.procedure_template
	consent.consent_form_template = template_name

	if template_name:
		consent.render_template()

	return consent


@frappe.whitelist()
def get_consent_options(procedure_name: str):
	"""Return available templates and existing consents for a clinical procedure."""
	if not procedure_name:
		frappe.throw(_("Clinical Procedure is required"))

	procedure = frappe.get_doc("Clinical Procedure", procedure_name)
	templates = frappe.get_all(
		"Consent Form Template",
		fields=["name", "title", "procedure_template"],
		filters={"procedure_template": ["in", [procedure.procedure_template, "", None]]},
		order_by="modified desc",
	)

	consents = frappe.get_all(
		"Consent Form",
		fields=["name", "consent_form_template", "signed_by", "status", "docstatus"],
		filters={"clinical_procedure": procedure_name},
		order_by="creation desc",
	)

	return {"templates": templates, "consents": consents}


def get_default_template_for_procedure(procedure_template: str | None):
	if not procedure_template:
		return None

	template = frappe.db.get_value(
		"Consent Form Template",
		{"procedure_template": procedure_template, "is_default": 1},
		"name",
	)
	if not template:
		template = frappe.db.get_value(
			"Consent Form Template",
			{"procedure_template": procedure_template},
			"name",
		)

	return template


def get_template_for_procedure(procedure_template: str | None):
	"""Return preferred consent template with custom field override support."""
	if not procedure_template:
		return None

	meta = frappe.get_meta("Clinical Procedure Template")
	if meta.has_field("custom_consent_form_template"):
		preferred = frappe.db.get_value(
			"Clinical Procedure Template", procedure_template, "custom_consent_form_template"
		)
		if preferred:
			return preferred

	return get_default_template_for_procedure(procedure_template)

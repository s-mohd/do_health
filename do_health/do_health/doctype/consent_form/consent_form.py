# Copyright (c) 2024, Sayed Mohamed and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class ConsentForm(Document):
	def before_insert(self):
		if not self.rendered_html and self.consent_form_template:
			self.render_template()

	def validate(self):
		self.status = "Draft" if self.docstatus == 0 else self.status
		if self.signature and self.status == "Draft":
			self.status = "Signed"

		if self.docstatus == 1 or self.status == "Signed":
			self._validate_signature_fields()

	def before_submit(self):
		self._validate_signature_fields()
		self.status = "Signed"
		if not self.signed_on:
			self.signed_on = now_datetime()
		if not self.signed_by_user:
			self.signed_by_user = frappe.session.user

		# Link back to the procedure for quick access
		if self.clinical_procedure:
			cp_meta = frappe.get_meta("Clinical Procedure")
			if cp_meta.has_field("consent_form"):
				frappe.db.set_value(
					"Clinical Procedure", self.clinical_procedure, "consent_form", self.name
				)

	def render_template(self):
		if not self.consent_form_template:
			return

		template = frappe.get_doc("Consent Form Template", self.consent_form_template)
		context = self._get_render_context()
		self.rendered_html = frappe.render_template(template.template_html or "", context)
		self.procedure_template = self.procedure_template or template.procedure_template

	def _get_render_context(self):
		patient = frappe._dict()
		if self.patient:
			patient_doc = frappe.get_cached_doc("Patient", self.patient)
			patient = patient_doc.as_dict()

		procedure_template = self.procedure_template
		if self.clinical_procedure and not procedure_template:
			procedure_template = frappe.db.get_value(
				"Clinical Procedure", self.clinical_procedure, "procedure_template"
			)

		return {
			"patient": patient,
			"patient_name": patient.get("patient_name") if patient else None,
			"procedure_name": procedure_template,
			"procedure": procedure_template,
			"date": now_datetime(),
			"company": self.company,
		}

	def _validate_signature_fields(self):
		missing = []
		if not self.signature:
			missing.append(_("Signature"))
		if not self.signed_by:
			missing.append(_("Signed By"))
		if missing:
			frappe.throw(
				_("Missing required fields: {0}").format(", ".join(missing)),
				title=_("Consent Form Incomplete"),
			)

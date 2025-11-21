import frappe
from frappe.model.document import Document


class HealthSidebarItem(Document):
	"""Simple container used to drive the configurable health sidebar."""
	pass
	# def validate(self):
	# 	# Ensure that patient-only links live inside the patient actions section.
	# 	if self.requires_patient and self.section != "Patient Actions":
	# 		frappe.throw(frappe._("Only patient actions can require a selected patient."))

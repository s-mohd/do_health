import frappe
from frappe import _
from frappe.model.document import Document

RELATION_INVERSE_MAP = {
	"father": "Child",
	"mother": "Child",
	"parent": "Child",
	"child": "Parent",
	"son": "Parent",
	"daughter": "Parent",
	"husband": "Wife",
	"wife": "Husband",
	"spouse": "Spouse",
	"partner": "Partner",
	"sibling": "Sibling",
	"brother": "Sibling",
	"sister": "Sibling",
	"guardian": "Ward",
	"ward": "Guardian",
	"other": "Other",
}


class PatientRelationship(Document):
	def validate(self):
		self._normalize_fields()
		self._guard_self_reference()
		self._guard_duplicates()
		self._set_inverse_relation()

	def on_update(self):
		self._sync_inverse_record()

	def after_insert(self):
		self._sync_inverse_record()

	def on_trash(self):
		self._delete_inverse_record()

	def _normalize_fields(self):
		for field in ("relation", "inverse_relation"):
			if getattr(self, field):
				setattr(self, field, str(getattr(self, field)).strip())

	def _guard_self_reference(self):
		if self.patient and self.related_patient and self.patient == self.related_patient:
			frappe.throw(_("You cannot relate a patient to themselves."))

	def _guard_duplicates(self):
		if not (self.patient and self.related_patient):
			return

		existing = frappe.db.exists(
			"Patient Relationship",
			{
				"patient": self.patient,
				"related_patient": self.related_patient,
				"name": ["!=", self.name or ""],
			},
		)
		if existing:
			frappe.throw(
				_(
					"A relationship between {0} and {1} already exists (record: {2})."
				).format(self.patient, self.related_patient, existing)
			)

	def _set_inverse_relation(self):
		if not self.relation:
			return
		self.inverse_relation = _get_inverse_label(self.relation)

	def _sync_inverse_record(self):
		"""
		Ensure the reciprocal row exists and stays in sync.
		"""
		if frappe.flags.in_patient_relation_sync:
			return

		if not (self.patient and self.related_patient and self.relation):
			return

		frappe.flags.in_patient_relation_sync = True
		try:
			target_relation = _get_inverse_label(self.relation)

			existing = frappe.get_all(
				"Patient Relationship",
				filters={
					"patient": self.related_patient,
					"related_patient": self.patient,
				},
				limit=1,
				fields=["name", "relation", "inverse_relation"],
			)

			if not existing:
				doc = frappe.new_doc("Patient Relationship")
				doc.patient = self.related_patient
				doc.related_patient = self.patient
				doc.relation = target_relation
				doc.inverse_relation = self.relation
				doc.notes = self.notes
				doc.insert(ignore_permissions=True)
			else:
				row = existing[0]
				if row.relation != target_relation or row.inverse_relation != self.relation:
					frappe.db.set_value(
						"Patient Relationship",
						row.name,
						{"relation": target_relation, "inverse_relation": self.relation},
					)
		finally:
			frappe.flags.in_patient_relation_sync = False

	def _delete_inverse_record(self):
		if frappe.flags.in_patient_relation_sync:
			return

		if not (self.patient and self.related_patient):
			return

		frappe.flags.in_patient_relation_sync = True
		try:
			name = frappe.db.exists(
				"Patient Relationship",
				{"patient": self.related_patient, "related_patient": self.patient},
			)
			if name:
				frappe.delete_doc("Patient Relationship", name, ignore_permissions=True)
		finally:
			frappe.flags.in_patient_relation_sync = False


def _get_inverse_label(relation: str) -> str:
	if not relation:
		return ""
	label = relation.strip()
	lookup = RELATION_INVERSE_MAP.get(label.lower())
	return lookup or label


import frappe
from frappe import _
from frappe.utils import cint
from healthcare.healthcare.doctype.clinical_procedure.clinical_procedure import ClinicalProcedure
from healthcare.healthcare.doctype.lab_test.lab_test import create_sample_doc
from do_health.api.consent import get_template_for_procedure

class CustomClinicalProcedure(ClinicalProcedure):
    def validate(self):
        super().validate()
        # Only enforce consent when the document is being submitted;
        # drafts should be allowed so the consent form can be collected.
        if getattr(self, "_action", None) == "submit":
            self._validate_consent_requirement()

    def after_insert(self):
        if self.appointment:
            appointment = frappe.get_doc('Patient Appointment', self.appointment)
            appointment.custom_visit_status = "In Room"
            if self.procedure_template:
                procedure_template = frappe.get_doc('Clinical Procedure Template', self.procedure_template)
                appointment.append('custom_billing_items',{
                    "item_code": procedure_template.item_code,
                    "quantity": 1,
                })
            appointment.save()

        if self.procedure_template:
            template = frappe.get_doc("Clinical Procedure Template", self.procedure_template)
            if template.sample:
                patient = frappe.get_doc("Patient", self.patient)
                sample_collection = create_sample_doc(template, patient, None, self.company)
                self.db_set("sample", sample_collection.name)

        self.reload()

    def on_submit(self):
        self._validate_consent_requirement(skip_if_draft=False)
        super().on_submit()

    @frappe.whitelist()
    def start_procedure(self):
        self._validate_consent_requirement(skip_if_draft=False)
        return super().start_procedure()

    def _validate_consent_requirement(self, skip_if_draft=True):
        if skip_if_draft and self.docstatus == 0 and getattr(self, "_action", None) != "submit":
            return

        requirement = self._get_consent_requirement()
        if not requirement.get("requires_consent"):
            return

        if self._has_signed_consent():
            return

        template_hint = requirement.get("consent_form_template") or get_template_for_procedure(
            self.procedure_template
        )

        frappe.throw(
            _("A signed consent form is required before continuing. {0}").format(
                _("Create one from the Consent Form button{0}.").format(
                    f" (suggested template: {template_hint})" if template_hint else ""
                )
            ),
            title=_("Consent Required"),
        )

    def _get_consent_requirement(self):
        meta = frappe.get_meta("Clinical Procedure Template")
        requires_field = "custom_requires_consent" if meta.has_field("custom_requires_consent") else None
        template_field = "custom_consent_form_template" if meta.has_field("custom_consent_form_template") else None

        if not requires_field:
            return {"requires_consent": False, "consent_form_template": None}

        data = frappe.db.get_value(
            "Clinical Procedure Template",
            self.procedure_template,
            [requires_field, template_field] if template_field else [requires_field],
            as_dict=True,
        ) or {}

        return {
            "requires_consent": cint(data.get(requires_field)),
            "consent_form_template": data.get(template_field) if template_field else None,
        }

    def _has_signed_consent(self):
        if not self.name:
            return False

        return bool(
            frappe.db.exists(
                "Consent Form",
                {
                    "clinical_procedure": self.name,
                    "docstatus": 1,
                },
            )
        )

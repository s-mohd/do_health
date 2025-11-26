import frappe
from frappe import _
import datetime
import frappe.query_builder
import frappe.query_builder.functions
from frappe.utils import (
	nowdate,
	add_to_date,
	get_datetime,
	get_datetime_str,
	flt,
	format_date,
	format_datetime,
	format_time,
	fmt_money,
	get_link_to_form,
	get_time,
	getdate,
	cint,
	cstr,
)
from frappe.utils.file_manager import save_file
from frappe.desk.form.save import cancel
# from healthcare.healthcare.doctype.patient_appointment.patient_appointment import update_status
from frappe.utils.pdf import get_pdf
import os
import base64
import re
from collections import defaultdict
import json
from do_health.do_health.doctype.patient_relationship.patient_relationship import _get_inverse_label
from healthcare.healthcare.doctype.patient_insurance_policy.patient_insurance_policy import (
	get_insurance_price_lists,
	is_insurance_policy_valid,
)
from healthcare.healthcare.doctype.item_insurance_eligibility.item_insurance_eligibility import (
	get_insurance_eligibility,
)
from healthcare.healthcare.doctype.patient_insurance_coverage.patient_insurance_coverage import (
	make_insurance_coverage,
)
from frappe.desk.form.linked_with import get as get_linked_documents


VITAL_READING_FIELDS = [
	"temperature",
	"pulse",
	"respiratory_rate",
	"bp_systolic",
	"bp_diastolic",
	"weight",
	"height",
	"bmi",
	"bp",
]

DRUG_PRESCRIPTION_FIELDS = [
	"drug_code",
	"drug_name",
	"dosage",
	"dosage_form",
	"period",
	"interval",
	"interval_uom",
	"number_of_repeats_allowed",
	"comment",
	"medication",
	"medication_request",
]

LAB_PRESCRIPTION_FIELDS = [
	"lab_test_code",
	"lab_test_name",
	"lab_test_comment",
	"intent",
	"priority",
	"patient_care_type",
	"service_request",
	"observation_template",
]

PROCEDURE_PRESCRIPTION_FIELDS = [
	"procedure",
	"procedure_name",
	"department",
	"practitioner",
	"date",
	"intent",
	"priority",
	"service_request",
	"no_of_sessions",
	"interval",
	"patient_care_type",
]

THERAPY_FIELDS = [
	"therapy_type",
	"no_of_sessions",
	"sessions_completed",
	"intent",
	"priority",
	"service_request",
	"patient_care_type",
	"interval",
]

CODIFICATION_FIELDS = ["code_system", "code_value", "display", "definition"]


@frappe.whitelist()
def get_encounter_summary(encounter: str):
	if not encounter:
		frappe.throw(_("Encounter is required"))

	encounter_doc = frappe.get_doc("Patient Encounter", encounter)

	return {
		"encounter": _build_encounter_header(encounter_doc),
		"appointment": _build_appointment_summary(encounter_doc.appointment),
		"vitals": _build_vital_records(encounter_doc),
		"symptoms": _build_child_rows(encounter_doc.symptoms, ["complaint"]),
		"diagnoses": _build_child_rows(encounter_doc.diagnosis, ["diagnosis"]),
		"differential_diagnosis": _build_child_rows(
			encounter_doc.get("custom_differential_diagnosis") or [], ["diagnosis"]
		),
		"codification": _build_child_rows(encounter_doc.codification_table, CODIFICATION_FIELDS),
		"drug_prescriptions": _build_child_rows(encounter_doc.drug_prescription, DRUG_PRESCRIPTION_FIELDS),
		"lab_prescriptions": _build_child_rows(encounter_doc.lab_test_prescription, LAB_PRESCRIPTION_FIELDS),
		"procedure_prescriptions": _build_child_rows(encounter_doc.procedure_prescription, PROCEDURE_PRESCRIPTION_FIELDS),
		"therapies": _build_child_rows(encounter_doc.therapies, THERAPY_FIELDS),
		"service_requests": _get_service_requests(encounter_doc.name),
		"medication_requests": _get_medication_requests(encounter_doc.name),
		"clinical_procedures": _get_clinical_procedures(encounter_doc.name),
		"annotations": _build_child_rows(encounter_doc.get("custom_annotations") or [], ["annotation", "type"]),
		"attachments": _build_child_rows(encounter_doc.get("custom_attachments") or [], ["attachment_name", "attachment"]),
		"notes": {
			"symptom_duration": encounter_doc.get("custom_symptom_duration"),
			"symptoms_notes": encounter_doc.get("custom_symptoms_notes"),
			"illness_progression": encounter_doc.get("custom_illness_progression"),
			"physical_examination": encounter_doc.get("custom_physical_examination"),
			"other_examination": encounter_doc.get("custom_other_examination"),
			"diagnosis_note": encounter_doc.get("custom_diagnosis_note"),
			"encounter_comment": encounter_doc.get("encounter_comment"),
		},
	}


@frappe.whitelist()
def get_appointment_visit_summary(appointment: str):
	if not appointment:
		frappe.throw(_("Patient Appointment is required"))
	fields = [
		"name",
		"patient",
		"patient_name",
		"appointment_date",
		"appointment_time",
		"duration",
		"practitioner",
		"practitioner_name",
		"department",
		"service_unit",
		"status",
		"custom_visit_status",
		"custom_visit_reason",
		"notes",
		"custom_appointment_category",
		"appointment_type",
	]
	appointment_doc = frappe.db.get_value("Patient Appointment", appointment, fields, as_dict=1)
	if not appointment_doc:
		frappe.throw(_("Appointment {0} not found").format(appointment))

	encounter_name = frappe.db.get_value(
		"Patient Encounter",
		{"appointment": appointment},
		"name",
		order_by="creation desc",
	)
	encounter_summary = None
	if encounter_name:
		encounter_summary = get_encounter_summary(encounter_name)

	vitals = []
	procedures = []
	clinical = []
	if encounter_summary:
		vitals = encounter_summary.get("vitals") or []
		procedures = encounter_summary.get("procedure_prescriptions") or []
		clinical = encounter_summary.get("clinical_procedures") or []
	else:
		vitals = _build_vitals_for_appointment(appointment)
		clinical = _get_clinical_procedures_for_appointment(appointment)

	return {
		"appointment": appointment_doc,
		"encounter_name": encounter_name,
		"encounter_summary": encounter_summary,
		"procedures": procedures,
		"clinical_procedures": clinical,
		"vitals": vitals,
	}


def _build_encounter_header(encounter_doc):
	return {
		"name": encounter_doc.name,
		"status": encounter_doc.status,
		"company": encounter_doc.company,
		"appointment_type": encounter_doc.appointment_type,
		"medical_department": encounter_doc.medical_department,
		"practitioner": encounter_doc.practitioner,
		"practitioner_name": encounter_doc.practitioner_name,
		"appointment_category": encounter_doc.get("custom_appointment_category"),
		"source": encounter_doc.source,
		"encounter_date": encounter_doc.encounter_date,
		"encounter_date_label": _format_date(encounter_doc.encounter_date),
		"encounter_time": encounter_doc.encounter_time,
		"encounter_time_label": _format_time(encounter_doc.encounter_time),
	}


def _build_appointment_summary(appointment_name):
	if not appointment_name:
		return None
	fields = [
		"name",
		"status",
		"custom_visit_status",
		"appointment_type",
		"appointment_date",
		"appointment_time",
		"duration",
		"practitioner",
		"practitioner_name",
		"department",
		"service_unit",
		"custom_visit_reason",
		"notes",
		"custom_appointment_category",
	]
	appointment = frappe.db.get_value("Patient Appointment", appointment_name, fields, as_dict=1)
	if not appointment:
		return None
	appointment["appointment_date_label"] = _format_date(appointment.get("appointment_date"))
	appointment["appointment_time_label"] = _format_time(appointment.get("appointment_time"))
	return appointment


def _build_vital_records(encounter_doc):
	vitals = _fetch_vitals([["docstatus", "<", 2], ["encounter", "=", encounter_doc.name]])
	if not vitals and encounter_doc.appointment:
		vitals = _fetch_vitals([["docstatus", "<", 2], ["appointment", "=", encounter_doc.appointment]])
	return vitals


def _build_vitals_for_appointment(appointment_name):
	if not appointment_name:
		return []
	return _fetch_vitals([["docstatus", "<", 2], ["appointment", "=", appointment_name]])


def _fetch_vitals(filter_conditions, limit=3):
	if not filter_conditions:
		return []
	vital_fields = [
		"name",
		"signs_date",
		"signs_time",
		"vital_signs_note",
		"nutrition_note",
	] + VITAL_READING_FIELDS
	vitals = frappe.get_all(
		"Vital Signs",
		filters=filter_conditions,
		fields=vital_fields,
		order_by="signs_date desc, signs_time desc, creation desc",
		limit_page_length=limit or 3,
	)
	for vital in vitals:
		vital["signs_date_label"] = _format_date(vital.get("signs_date"))
		vital["signs_time_label"] = _format_time(vital.get("signs_time"))
		vital["readings"] = {
			field: vital.get(field)
			for field in VITAL_READING_FIELDS
			if vital.get(field) not in (None, "")
		}
	return vitals


def _get_service_requests(encounter_name):
	filters = [["docstatus", "<", 2]]
	or_filters = [["order_group", "=", encounter_name], ["order_reference_name", "=", encounter_name]]
	fields = [
		"name",
		"order_date",
		"order_time",
		"expected_date",
		"status",
		"intent",
		"priority",
		"order_description",
		"patient_care_type",
		"order_group",
		"order_reference_doctype",
		"order_reference_name",
		"staff_role",
	]
	records = frappe.get_all(
		"Service Request",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by="order_date desc, creation desc",
	)
	for record in records:
		record["order_date_label"] = _format_date(record.get("order_date"))
		record["order_time_label"] = _format_time(record.get("order_time"))
		record["expected_date_label"] = _format_date(record.get("expected_date"))
	return records


def _get_medication_requests(encounter_name):
	filters = [["docstatus", "<", 2], ["order_group", "=", encounter_name]]
	fields = [
		"name",
		"medication",
		"medication_item",
		"order_date",
		"order_time",
		"expected_date",
		"status",
		"intent",
		"priority",
		"dosage",
		"dosage_form",
		"period",
		"quantity",
		"comment",
		"order_description",
	]
	records = frappe.get_all(
		"Medication Request",
		filters=filters,
		fields=fields,
		order_by="order_date desc, creation desc",
	)
	for record in records:
		record["order_date_label"] = _format_date(record.get("order_date"))
		record["order_time_label"] = _format_time(record.get("order_time"))
		record["expected_date_label"] = _format_date(record.get("expected_date"))
	return records


def _get_clinical_procedures(encounter_name):
	filters = [["docstatus", "<", 2], ["custom_patient_encounter", "=", encounter_name]]
	fields = [
		"name",
		"procedure_template",
		"status",
		"practitioner",
		"practitioner_name",
		"medical_department",
		"start_date",
		"start_time",
		"service_request",
		"notes",
		"custom_pre_operative_diagnosis",
		"custom_post_operative_diagnosis",
	]
	records = frappe.get_all(
		"Clinical Procedure",
		filters=filters,
		fields=fields,
		order_by="start_date desc, creation desc",
	)
	for record in records:
		record["start_date_label"] = _format_date(record.get("start_date"))
		record["start_time_label"] = _format_time(record.get("start_time"))
	return records


def _get_clinical_procedures_for_appointment(appointment_name):
	filters = [["docstatus", "<", 2], ["appointment", "=", appointment_name]]
	fields = [
		"name",
		"procedure_template",
		"status",
		"practitioner",
		"practitioner_name",
		"medical_department",
		"start_date",
		"start_time",
		"service_request",
		"notes",
		"custom_pre_operative_diagnosis",
		"custom_post_operative_diagnosis",
	]
	records = frappe.get_all(
		"Clinical Procedure",
		filters=filters,
		fields=fields,
		order_by="start_date desc, creation desc",
	)
	for record in records:
		record["start_date_label"] = _format_date(record.get("start_date"))
		record["start_time_label"] = _format_time(record.get("start_time"))
	return records


def _build_child_rows(rows, fieldnames):
	data = []
	if not rows:
		return data
	for row in rows:
		source = row.as_dict() if hasattr(row, "as_dict") else row
		entry = {"name": source.get("name")}
		for field in fieldnames:
			value = source.get(field)
			if value not in (None, ""):
				entry[field] = _format_value(value)
		if len(entry) > 1:
			data.append(entry)
	return data


def _format_value(value):
	if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
		return _format_date(value)
	if isinstance(value, datetime.datetime):
		return format_datetime(value)
	if isinstance(value, datetime.time):
		return _format_time(value)
	return value


def _format_date(value):
	if not value:
		return ""
	return format_date(value)


def _format_time(value):
	if not value:
		return ""
	try:
		return format_time(value, 'HH:mm')
	except Exception:
		try:
			time_value = get_time(value)
			return time_value.strftime("%H:%M")
		except Exception:
			return cstr(value)


@frappe.whitelist()
def get_patient_overview(patient: str, appointment: str | None = None):
	if not patient:
		frappe.throw(_("Patient is required"))

	patient_doc = frappe.get_doc("Patient", patient)

	return {
		"patient": _build_patient_overview_header(patient_doc),
		"contact": _build_patient_contact(patient_doc),
		"emergency_contact": _build_emergency_contact(patient_doc),
		"upcoming_appointment": _get_upcoming_appointment(patient_doc.name, appointment),
		"last_encounter": _get_last_encounter(patient_doc.name),
		"vitals": _fetch_vitals([["docstatus", "<", 2], ["patient", "=", patient_doc.name]], limit=1),
		"counts": {
			"appointments": frappe.db.count("Patient Appointment", {"patient": patient_doc.name}),
			"encounters": frappe.db.count("Patient Encounter", {"patient": patient_doc.name}),
		},
		"relations": _get_patient_relations(patient_doc),
	}


def _calculate_age_years(dob):
	if not dob:
		return None
	dob_date = getdate(dob)
	today = getdate(nowdate())
	return today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day))


def _build_patient_overview_header(patient_doc):
	return {
		"name": patient_doc.name,
		"patient_name": patient_doc.patient_name or patient_doc.name,
		"patient_image": patient_doc.get("image"),
		"gender": patient_doc.get("sex"),
		"age": _calculate_age_years(patient_doc.get("dob")),
		"dob": patient_doc.get("dob"),
		"file_number": patient_doc.get("custom_file_number"),
		"cpr": patient_doc.get("custom_cpr"),
		"blood_group": patient_doc.get("blood_group"),
		"customer": patient_doc.get("customer"),
	}


def _build_patient_contact(patient_doc):
	primary_phone = patient_doc.get("mobile") or patient_doc.get("phone")
	secondary_phone = patient_doc.get("phone") if primary_phone != patient_doc.get("phone") else None
	return {
		"email": patient_doc.get("email"),
		"phone": primary_phone,
		"secondary_phone": secondary_phone,
		"address": patient_doc.get("primary_address") or patient_doc.get("custom_address"),
		"language": patient_doc.get("preferred_language"),
	}


def _build_emergency_contact(patient_doc):
	return {
		"name": patient_doc.get("custom_emergency_contact_name")
		or patient_doc.get("emergency_contact_name")
		or patient_doc.get("next_of_kin_name"),
		"relation": patient_doc.get("custom_emergency_contact_relation")
		or patient_doc.get("emergency_contact_relation")
		or patient_doc.get("next_of_kin_relation"),
		"phone": patient_doc.get("custom_emergency_contact_phone")
		or patient_doc.get("emergency_contact_number")
		or patient_doc.get("mobile"),
		"email": patient_doc.get("custom_emergency_contact_email") or patient_doc.get("emergency_email"),
	}


def _get_patient_relations(patient_doc):
	relations = _fetch_relationships(patient_doc.name)
	if relations:
		return relations

	# Fallback to legacy child table on Patient
	return _build_relations_from_child_table(patient_doc)


def _fetch_relationships(patient_name: str) -> list[dict]:
	fields = ["name", "patient", "related_patient", "relation", "inverse_relation", "notes"]
	forward = frappe.get_all(
		"Patient Relationship",
		filters={"patient": patient_name},
		fields=fields,
	)
	reverse = frappe.get_all(
		"Patient Relationship",
		filters={"related_patient": patient_name},
		fields=fields,
	)

	if not forward and not reverse:
		return []

	def _collect(rows, swap=False):
		items = []
		for row in rows:
			other_id = row.related_patient if not swap else row.patient
			if not other_id:
				continue
			label = row.relation if not swap else (row.inverse_relation or _get_inverse_label(row.relation))
			items.append(
				{
					"source": row.patient if not swap else row.related_patient,
					"patient": other_id,
					"relation": label,
					"description": row.notes,
				}
			)
		return items

	combined = _collect(forward) + _collect(reverse, swap=True)

	# Deduplicate on patient + relation
	seen = set()
	unique = []
	for row in combined:
		key = (row["patient"], row.get("relation") or "")
		if key in seen:
			continue
		seen.add(key)
		unique.append(row)

	details = {}
	if unique:
		ids = [row["patient"] for row in unique]
		details = {
			row.name: row
			for row in frappe.get_all(
				"Patient",
				fields=[
					"name",
					"patient_name",
					"sex",
					"dob",
					"image",
					"custom_file_number",
					"custom_cpr",
				],
				filters={"name": ["in", ids]},
			)
		}

	for row in unique:
		patient_detail = details.get(row["patient"], {})
		row.update(
			{
				"patient_name": patient_detail.get("patient_name") or row["patient"],
				"gender": patient_detail.get("sex"),
				"dob": patient_detail.get("dob"),
				"age": _calculate_age_years(patient_detail.get("dob")),
				"patient_image": patient_detail.get("image"),
				"file_number": patient_detail.get("custom_file_number"),
				"cpr": patient_detail.get("custom_cpr"),
			}
		)

	return unique


def _build_relations_from_child_table(patient_doc):
	relations = patient_doc.get("patient_relation") or []
	if not relations:
		return []

	patient_ids = [row.patient for row in relations if row.patient]
	patient_details = {}

	if patient_ids:
		patient_details = {
			row.name: row
			for row in frappe.get_all(
				"Patient",
				fields=[
					"name",
					"patient_name",
					"sex",
					"gender",
					"dob",
					"image",
					"custom_file_number",
					"custom_cpr",
				],
				filters={"name": ["in", patient_ids]},
			)
		}

	output = []
	for row in relations:
		if not row.patient:
			continue

		details = patient_details.get(row.patient, {})
		output.append(
			{
				"patient": row.patient,
				"relation": row.relation,
				"description": row.description,
				"patient_name": details.get("patient_name") or row.patient,
				"gender": details.get("sex"),
				"dob": details.get("dob"),
				"age": _calculate_age_years(details.get("dob")),
				"patient_image": details.get("image"),
				"file_number": details.get("custom_file_number"),
				"cpr": details.get("custom_cpr"),
			}
		)

	return output


@frappe.whitelist()
def create_patient_relationship(patient: str, related_patient: str, relation: str, notes: str | None = None):
	if not patient or not related_patient:
		frappe.throw(_("Patient and related patient are required"))

	if patient == related_patient:
		frappe.throw(_("You cannot relate a patient to themselves."))

	relation_value = (relation or "").strip()
	if not relation_value:
		frappe.throw(_("Relation is required"))

	doc = frappe.new_doc("Patient Relationship")
	doc.patient = patient
	doc.related_patient = related_patient
	doc.relation = relation_value
	doc.notes = notes
	doc.insert()

	return {"name": doc.name}


def _get_upcoming_appointment(patient_name, appointment_name=None):
	fields = [
		"name",
		"status",
		"custom_visit_status",
		"appointment_type",
		"appointment_date",
		"appointment_time",
		"duration",
		"practitioner",
		"practitioner_name",
		"department",
		"service_unit",
		"custom_visit_reason",
		"notes",
		"custom_appointment_category",
	]

	def _enrich(record):
		if not record:
			return None
		record["appointment_date_label"] = _format_date(record.get("appointment_date"))
		record["appointment_time_label"] = _format_time(record.get("appointment_time"))
		return record

	if appointment_name:
		appointment_doc = frappe.db.get_value("Patient Appointment", appointment_name, fields, as_dict=1)
		if appointment_doc:
			return _enrich(appointment_doc)

	upcoming = frappe.get_all(
		"Patient Appointment",
		filters={"docstatus": ["<", 2], "patient": patient_name, "appointment_date": [">=", nowdate()]},
		fields=fields,
		order_by="appointment_date asc, appointment_time asc, creation asc",
		limit_page_length=1,
	)

	if upcoming:
		return _enrich(upcoming[0])

	latest = frappe.get_all(
		"Patient Appointment",
		filters={"docstatus": ["<", 2], "patient": patient_name},
		fields=fields,
		order_by="appointment_date desc, appointment_time desc, creation desc",
		limit_page_length=1,
	)
	if latest:
		return _enrich(latest[0])

	return None


def _get_last_encounter(patient_name):
	fields = [
		"name",
		"status",
		"encounter_date",
		"encounter_time",
		"practitioner",
		"practitioner_name",
		"medical_department",
		"appointment",
		"appointment_type",
		"source",
	]
	encounter = frappe.get_all(
		"Patient Encounter",
		filters={"docstatus": ["<", 2], "patient": patient_name},
		fields=fields,
		order_by="encounter_date desc, encounter_time desc, creation desc",
		limit_page_length=1,
	)
	if not encounter:
		return None
	record = encounter[0]
	record["encounter_date_label"] = _format_date(record.get("encounter_date"))
	record["encounter_time_label"] = _format_time(record.get("encounter_time"))
	return record


@frappe.whitelist()
def get_visit_log(appointment_id):
	if not appointment_id:
		frappe.throw(_('Patient Appointment is required'))

	appointment = frappe.get_doc('Patient Appointment', appointment_id)
	entries = []
	financial_totals = {}

	def get_user_display(user):
		if not user:
			return None
		full_name = frappe.db.get_value('User', user, 'full_name')
		return full_name or user

	def add_entry(entry_type, timestamp, title, description=None, *, badge=None, doc=None, reference=None, user=None, extra=None, tag=None):
		if not timestamp:
			timestamp = appointment.creation

		datetime_value = get_datetime(timestamp)
		entry = frappe._dict({
			"type": entry_type,
			"_sort_ts": datetime_value,
			"timestamp": get_datetime_str(datetime_value),
			"date": format_date(datetime_value),
			"time": format_datetime(datetime_value, "HH:mm"),
			"title": title,
		})

		if description:
			entry["description"] = description
		if badge:
			entry["badge"] = badge
		if doc:
			entry["doc"] = doc
		if reference:
			entry["reference"] = reference
		if extra:
			entry["extra"] = extra
		if tag:
			entry["tag"] = tag
		if user:
			entry["user"] = get_user_display(user)

		entries.append(entry)

	# Status timeline
	status_logs = frappe.get_all(
		'Appointment Time Logs',
		filters={'parent': appointment_id},
		fields=['status', 'time', 'owner', 'modified_by', 'modified', 'creation'],
		order_by='time asc, creation asc'
	)

	for log in status_logs:
		user_id = log.modified_by or log.owner
		add_entry(
			'status',
			log.time or log.modified or log.creation,
			_('Status updated to {0}').format(log.status),
			badge=log.status,
			user=user_id
		)

	if not status_logs:
		user_id = appointment.modified_by or appointment.owner
		current_status = appointment.get('custom_visit_status') or appointment.status or _('Unknown')
		add_entry(
			'status',
			appointment.modified or appointment.creation,
			_('Current status: {0}').format(current_status),
			badge=current_status,
			user=user_id
		)

	# Billing & payments timeline
	invoice_context = {}
	if appointment.ref_sales_invoice:
		invoice_context[appointment.ref_sales_invoice] = {
			'label': _('Patient Invoice'),
			'kind': 'patient'
		}
	if appointment.custom_insurance_sales_invoice:
		invoice_context.setdefault(appointment.custom_insurance_sales_invoice, {
			'label': _('Insurance Invoice'),
			'kind': 'insurance'
		})

	invoice_names = list(invoice_context.keys())
	invoice_map = {}

	if invoice_names:
		invoice_docs = frappe.get_all(
			'Sales Invoice',
			filters={'name': ('in', invoice_names)},
			fields=[
				'name', 'posting_date', 'posting_time', 'status', 'grand_total',
				'outstanding_amount', 'paid_amount', 'currency', 'customer',
				'docstatus', 'owner', 'creation', 'modified'
			]
		)

		for invoice in invoice_docs:
			invoice = frappe._dict(invoice)
			invoice_map[invoice.name] = invoice
			context = invoice_context.get(invoice.name, {})
			label = context.get('label') or _('Invoice')

			if invoice.posting_date:
				posting_time = invoice.posting_time or '00:00:00'
				timestamp_candidate = f"{invoice.posting_date} {posting_time}"
			else:
				timestamp_candidate = invoice.creation

			amount_label = fmt_money(invoice.grand_total or 0, currency=invoice.currency)
			description_parts = [_('Total {0}').format(amount_label)]
			if flt(invoice.paid_amount):
				description_parts.append(_('Paid {0}').format(fmt_money(invoice.paid_amount, currency=invoice.currency)))
			if flt(invoice.outstanding_amount):
				description_parts.append(_('Outstanding {0}').format(fmt_money(invoice.outstanding_amount, currency=invoice.currency)))

			extra = []
			# if invoice.customer:
			# 	extra.append({'label': _('Customer'), 'value': invoice.customer})

			add_entry(
				'billing',
				timestamp_candidate,
				_('{0} {1}').format(label, invoice.name),
				description=' | '.join(description_parts),
				badge=invoice.status,
				doc={'doctype': 'Sales Invoice', 'name': invoice.name, 'label': invoice.name},
				user=invoice.owner,
				extra=extra,
				tag=label
			)

			totals = financial_totals.setdefault(
				invoice.currency or '',
				{'currency': invoice.currency, 'total_billed': 0.0, 'total_paid': 0.0, 'total_outstanding': 0.0}
			)
			totals['total_billed'] += flt(invoice.grand_total or 0)
			totals['total_paid'] += flt(invoice.paid_amount or 0)
			totals['total_outstanding'] += flt(invoice.outstanding_amount or 0)

		payment_refs = frappe.get_all(
			'Payment Entry Reference',
			filters={
				'reference_doctype': 'Sales Invoice',
				'reference_name': ('in', invoice_names)
			},
			fields=['parent', 'reference_name', 'allocated_amount', 'creation']
		)

		payment_entry_names = list({ref.parent for ref in payment_refs})
		payment_map = {}

		if payment_entry_names:
			payment_docs = frappe.get_all(
				'Payment Entry',
				filters={'name': ('in', payment_entry_names)},
				fields=[
					'name', 'posting_date', 'posting_time', 'mode_of_payment', 'payment_type',
					'paid_amount', 'received_amount', 'status', 'docstatus', 'party',
					'party_type', 'owner', 'reference_no', 'reference_date', 'creation', 'modified'
				]
			)
			for payment in payment_docs:
				payment_map[payment.name] = frappe._dict(payment)

		default_currency = None
		if appointment.company:
			default_currency = frappe.db.get_value('Company', appointment.company, 'default_currency')

		for ref in payment_refs:
			payment_entry = payment_map.get(ref.parent)
			if not payment_entry:
				continue

			invoice = invoice_map.get(ref.reference_name)
			currency = invoice.currency if invoice else default_currency or frappe.defaults.get_global_default('currency')

			if payment_entry.posting_date:
				post_time = payment_entry.posting_time or '00:00:00'
				pe_timestamp = f"{payment_entry.posting_date} {post_time}"
			else:
				pe_timestamp = payment_entry.creation or ref.creation

			amount_label = fmt_money(ref.allocated_amount or 0, currency=currency)
			description = _('Applied {0} to {1}').format(amount_label, ref.reference_name)

			extra = []
			context = invoice_context.get(ref.reference_name)
			if context and context.get('label'):
				extra.append({'label': _('Invoice Type'), 'value': context['label']})
			if payment_entry.mode_of_payment:
				extra.append({'label': _('Mode'), 'value': payment_entry.mode_of_payment})
			if payment_entry.reference_no:
				extra.append({'label': _('Reference No.'), 'value': payment_entry.reference_no})

			add_entry(
				'payment',
				pe_timestamp,
				_('Payment Entry {0}').format(payment_entry.name),
				description=description,
				badge=payment_entry.status,
				doc={'doctype': 'Payment Entry', 'name': payment_entry.name, 'label': payment_entry.name},
				reference={'doctype': 'Sales Invoice', 'name': ref.reference_name, 'label': ref.reference_name},
				user=payment_entry.owner,
				extra=extra
			)

	entries.sort(key=lambda entry: entry["_sort_ts"])
	for entry in entries:
		entry.pop('_sort_ts', None)

	return {
		'entries': entries,
		'financial_summary': list(financial_totals.values()),
		'latest_status': appointment.get('custom_visit_status') or appointment.status,
	}

@frappe.whitelist()
def change_status(docname, status):
	doc = frappe.get_doc('Patient Appointment', docname)
	doc.custom_visit_status = status
	# doc.append("custom_appointment_time_logs", {
	# 	"status": status,
	# 	"time": datetime.datetime.now()
	# })
	doc.save()


def mark_no_show_appointments():
    # mark appointmens as no-show if the appointment time has passed 15 minutes
	appointments = frappe.db.sql("""
		SELECT name FROM `tabPatient Appointment`
		WHERE custom_visit_status = 'Scheduled'
		AND TIMESTAMP(appointment_date, appointment_time) BETWEEN CURDATE() AND (NOW() - INTERVAL 15 MINUTE)
	""", as_dict=True)

	# Loop through appointments and mark as no-show
	for appointment in appointments:
		change_status(appointment.name, 'No Show')
 
@frappe.whitelist()
def get_events_full_calendar(start, end, filters=None,field_map=None):
	field_map = json.loads(field_map)
	patient_appointment = frappe.qb.DocType('Patient Appointment')
	# healthcare_practitioner = frappe.qb.DocType('Healthcare Practitioner')
	# patient = frappe.qb.DocType('Patient')
	# from frappe.query_builder.functions import TimestampAdd, Concat

	# appointments = (
	# 	frappe.qb.from_(patient_appointment)
	# 	.left_join(healthcare_practitioner).on(patient_appointment.practitioner == healthcare_practitioner.name)
	# 	.left_join(patient).on(patient_appointment.patient == patient.name)
	# 	.select(
	# 		patient_appointment.name,
	# 		(patient_appointment.practitioner).as_('resource'),
	# 		patient_appointment.creation,
	# 		patient_appointment.patient_name,
	# 		patient_appointment.owner,
	# 		patient_appointment.modified_by,
	# 		patient_appointment.status,
	# 		patient_appointment.notes,
	# 		patient_appointment.modified,
	# 		patient_appointment.patient_name.as_('customer'),
	# 		Concat(patient_appointment.appointment_date, ' ', patient_appointment.appointment_time).as_('starts_at'),
	# 		Concat(patient_appointment.appointment_date, ' ', TimestampAdd('minute', patient_appointment.duration, patient_appointment.appointment_time)).as_('ends_at'),
	# 		"null as 'room'",
	# 		"0 as 'allDay'",
	# 		"null as 'procedure_name'",
	# 		healthcare_practitioner.background_color.as_('bgc'),
	# 		healthcare_practitioner.text_color.as_('font'),
	# 		patient.image,
	# 		patient.file_number,
	# 		patient.patient_name.as_('full_name'),
	# 		patient.mobile,
	# 		patient.dob.as_('birthdate'),
	# 		patient.cpr,
	# 		"(SELECT atl.`time` FROM `tabAppointment Time Logs` atl WHERE atl.status = 'Arrived' AND atl.parent = `tabPatient Appointment`.name ORDER BY atl.`time` DESC LIMIT 1) as 'arrival_time'",
	# 	)
	# 	.where(
	# 		(patient_appointment.appointment_date >= start)
	# 		& (patient_appointment.appointment_date <= end)
	# 	)
	# )
 
	# if field_map['showcancelled']:
	# 	appointments = appointments.where(patient_appointment.status != 'Cancelled')
 
	sqlcommand = """SELECT
	appo.name 						as name,
	appo.practitioner 				as resource,
	appo.practitioner_name 			as practitioner_name,
	appo.creation 					as creation,
	appo.patient_name 				as patient_name,
	appo.patient					as patient,
	appo.owner 						as owner,
	appo.modified_by 				as modified_by,
	appo.custom_visit_status 		as status,
	appo.status				 		as booking_type,
	appo.notes 						as note,
	appo.custom_payment_type		as payment_type,
	appo.custom_billing_status		as billing_status,
	appo.ref_sales_invoice			as sales_invoice,
	appo.custom_insurance_sales_invoice as insurance_invoice,
	appo.custom_insurance_status	as insurance_status,
	appo.invoiced					as invoiced,
	(SELECT atl.`time` FROM `tabAppointment Time Logs` atl WHERE atl.status = 'Arrived' AND atl.parent = appo.name ORDER BY atl.`time` DESC LIMIT 1) as arrival_time,
	appo.modified 					as modified,
	appo.patient_name 				as customer,
	appo.appointment_datetime 		as starts_at,
	appo.appointment_type 			as appointment_type,
	appo.custom_visit_reason 		as visit_reason,
	appo.custom_past_appointment	as custom_past_appointment,
	appo.custom_confirmed	 		as confirmed,
	appo.reminded	 				as reminded,
	TIMESTAMPADD(minute,appo.duration,appo.appointment_datetime) 	as ends_at,
	appo.service_unit 				as room_id,
	COALESCE(su.healthcare_service_unit_name, appo.service_unit) as room,
	su.healthcare_service_unit_name			as room_name,
	0	 							as allDay,
	null 							as procedure_name,
	prov.custom_background_color 	as background_color,
	prov.custom_text_color 			as text_color,
	pat.image 						as image,
	pat.custom_file_number 			as file_number,
	pat.patient_name 				as full_name,
	pat.mobile 						as mobile,
	pat.dob 						as birthdate,
	pat.custom_cpr 					as cpr,
	pat.sex 						as gender
	from `tabPatient Appointment` 	as appo
	LEFT JOIN `tabPatient` 	as pat ON pat.name = appo.patient
	LEFT JOIN `tabHealthcare Practitioner` as prov ON prov.name = appo.practitioner
	LEFT JOIN `tabHealthcare Service Unit` as su ON su.name = appo.service_unit
	WHERE appo.appointment_datetime >= "{start}" and appo.appointment_datetime < "{end}"  {condition}
	"""
	condition = ''
	if field_map['showcancelled']:
		condition = ' and ifnull(appo.status, "") != "Cancelled" '
	sqlcommand = sqlcommand.format(start = start , end = end , condition=condition)
	data = frappe.db.sql(sqlcommand,as_dict=True, update={"allDay": 0})
	for id,d in enumerate(data):
		if d['status'] in[ "Done", "Completed"]:
			data[id]['background_color'] = '#008000'	## this is done color green
			# data[id]['bgc'] = '#177245'
	return data

@frappe.whitelist()
def get_availability_data(date, practitioner, appointment):
	"""
	Get availability data of 'practitioner' on 'date'
	:param date: Date to check in schedule
	:param practitioner: Name of the practitioner
	:return: dict containing a list of available slots, list of appointments and time of appointments
	"""

	date = getdate(date)
	weekday = date.strftime("%A")

	practitioner_doc = frappe.get_doc("Healthcare Practitioner", practitioner)

	check_employee_wise_availability(date, practitioner_doc)

	available_slotes = []
	if isinstance(appointment, str):
		appointment = frappe.get_doc(json.loads(appointment))

	if frappe.db.exists(
		"Practitioner Availability",
		{
			"type": "Available",
			"scope": practitioner_doc.name,
			"status": "Active",
			"start_date": ["<=", date],
			"end_date": [">=", date],
			"docstatus": 1,
		},
	):
		available_slotes = get_availability_slots(practitioner_doc, date, appointment.duration)

	if practitioner_doc.practitioner_schedules:
		slot_details = get_available_slots(practitioner_doc, date)
	elif not len(available_slotes):
		frappe.throw(
			_(
				"{0} does not have a Healthcare Practitioner Schedule / Availability. Add it in Healthcare Practitioner master / Practitioner Availability"
			).format(practitioner),
			title=_("Practitioner Schedule Not Found"),
		)

	if available_slotes and len(available_slotes):
		slot_details += available_slotes
	# if not slot_details:
	# 	# TODO: return available slots in nearby dates
	# 	frappe.throw(
	# 		_("Healthcare Practitioner not available on {0}").format(weekday), title=_("Not Available")
	# 	)

	fee_validity = "Disabled"
	free_follow_ups = False

	settings_enabled = frappe.db.get_single_value("Healthcare Settings", "enable_free_follow_ups")
	pract_enabled = frappe.db.get_value(
		"Healthcare Practitioner", practitioner, "enable_free_follow_ups"
	)

	if practitioner and (pract_enabled or settings_enabled):
		free_follow_ups = True

	if free_follow_ups:
		fee_validity = check_fee_validity(appointment, date, practitioner)
		if not fee_validity and not appointment.get("__islocal"):
			validity_details = get_fee_validity(appointment.get("name"), date, ignore_status=True)
			if validity_details:
				fee_validity = validity_details[0]

	if appointment.invoiced:
		fee_validity = "Disabled"

	return {"slot_details": slot_details, "fee_validity": fee_validity}

def check_employee_wise_availability(date, practitioner_doc):
	employee = None
	if practitioner_doc.employee:
		employee = practitioner_doc.employee
	elif practitioner_doc.user_id:
		employee = frappe.db.get_value("Employee", {"user_id": practitioner_doc.user_id}, "name")

	if employee:
		# check holiday
		if is_holiday(employee, date):
			frappe.throw(_("{0} is a holiday".format(date)), title=_("Not Available"))

		# check leave status
		if "hrms" in frappe.get_installed_apps():
			leave_record = frappe.db.sql(
				"""select half_day from `tabLeave Application`
				where employee = %s and %s between from_date and to_date
				and docstatus = 1""",
				(employee, date),
				as_dict=True,
			)
			if leave_record:
				if leave_record[0].half_day:
					frappe.throw(
						_("{0} is on a Half day Leave on {1}").format(practitioner_doc.name, date),
						title=_("Not Available"),
					)
				else:
					frappe.throw(
						_("{0} is on Leave on {1}").format(practitioner_doc.name, date), title=_("Not Available")
					)

def get_available_slots(practitioner_doc, date):
	available_slots = slot_details = []
	weekday = date.strftime("%A")
	practitioner = practitioner_doc.name

	for schedule_entry in practitioner_doc.practitioner_schedules:
		validate_practitioner_schedules(schedule_entry, practitioner)
		practitioner_schedule = frappe.get_doc("Practitioner Schedule", schedule_entry.schedule)

		if practitioner_schedule and not practitioner_schedule.disabled:
			available_slots = []
			for time_slot in practitioner_schedule.time_slots:
				if weekday == time_slot.day:
					available_slots.append(time_slot)

			if available_slots:
				appointments = []
				allow_overlap = 0
				service_unit_capacity = 0
				# fetch all appointments to practitioner by service unit
				filters = {
					"practitioner": practitioner,
					"service_unit": schedule_entry.service_unit,
					"appointment_date": date,
					"status": ["not in", ["Cancelled"]],
				}

				if schedule_entry.service_unit:
					slot_name = f"{schedule_entry.schedule}"
					allow_overlap, service_unit_capacity = frappe.get_value(
						"Healthcare Service Unit",
						schedule_entry.service_unit,
						["overlap_appointments", "service_unit_capacity"],
					)
					if not allow_overlap:
						# fetch all appointments to service unit
						filters.pop("practitioner")
				else:
					slot_name = schedule_entry.schedule
					# fetch all appointments to practitioner without service unit
					filters["practitioner"] = practitioner
					filters.pop("service_unit")

				appointments = frappe.get_all(
					"Patient Appointment",
					filters=filters,
					fields=["name", "appointment_time", "duration", "status", "appointment_date"],
				)

				practitioner_availability = get_practitioner_unavailability(
					date, practitioner, practitioner_doc.department, schedule_entry.service_unit
				)
				appointments.extend(
					practitioner_availability
				)  # consider practitioner_availability as booked appointments

				slot_details.append(
					{
						"slot_name": slot_name,
						"service_unit": schedule_entry.service_unit,
						"avail_slot": available_slots,
						"appointments": appointments,
						"allow_overlap": allow_overlap,
						"service_unit_capacity": service_unit_capacity,
						"tele_conf": practitioner_schedule.allow_video_conferencing,
					}
				)
	return slot_details

def get_availability_slots(practitioner_doc, date, duration):
	availability_details = frappe.db.get_all(
		"Practitioner Availability",
		filters={
			"type": "Available",
			"scope": practitioner_doc.name,
			"status": "Active",
			"start_date": ["<=", date],
			"end_date": [">=", date],
			"docstatus": 1,
		},
		pluck="name",
	)

	if not len(availability_details):
		return []

	available_slotes = []
	for availability in availability_details:
		data = build_availability_data(availability, duration, date, practitioner_doc)
		if data:
			available_slotes.append(data)

	return available_slotes

def build_availability_data(availability, duration, date, practitioner_doc):
	available_slots = []
	availability_doc = frappe.get_doc("Practitioner Availability", availability)

	allow_overlap = service_unit_capacity = 0
	if availability_doc.service_unit:
		allow_overlap, service_unit_capacity = frappe.db.get_value(
			"Healthcare Service Unit",
			availability_doc.service_unit,
			["allow_appointments", "service_unit_capacity"],
		)

	weekday = date.strftime("%A").lower()
	if availability_doc.repeat == "Weekly" and not getattr(availability_doc, weekday, 0):
		return {}
	elif (
		availability_doc.repeat == "Monthly" and getdate(date).day != availability_doc.start_date.day
	):
		return {}
	elif availability_doc.repeat == "Never" and not (
		getdate(date) >= availability_doc.start_date and getdate(date) <= availability_doc.end_date
	):
		return {}

	start_time = (
		datetime.datetime.combine(date, datetime.time()) + availability_doc.start_time
	).time()
	end_time = (datetime.datetime.combine(date, datetime.time()) + availability_doc.end_time).time()

	current = datetime.datetime.combine(date, start_time)
	end = datetime.datetime.combine(date, end_time)

	while current + datetime.timedelta(minutes=duration) <= end:
		slot_start = current.time().strftime("%H:%M:%S")
		slot_end = (
			(current + datetime.timedelta(minutes=duration)).time().strftime("%H:%M:%S")
		)
		available_slots.append({"from_time": slot_start, "to_time": slot_end})
		current += datetime.timedelta(minutes=duration)

	filters = {
		"practitioner": practitioner_doc.name,
		"appointment_date": date,
		"status": ["not in", ["Cancelled"]],
	}
	appointments = frappe.get_all(
		"Patient Appointment",
		filters=filters,
		fields=["name", "appointment_time", "duration", "status", "appointment_date"],
	)

	practitioner_availability = get_practitioner_unavailability(
		date,
		practitioner_doc.name,
		practitioner_doc.department,
	)
	appointments.extend(practitioner_availability)

	return (
		{
			"slot_name": "Practitioner Availability",
			"display": availability_doc.display,
			"service_unit": availability_doc.service_unit or None,
			"avail_slot": available_slots,
			"appointments": appointments,
			"allow_overlap": allow_overlap or 0,
			"service_unit_capacity": service_unit_capacity or 0,
			"tele_conf": 0,
		}
		if available_slots
		else None
	)

def get_practitioner_unavailability(date, practitioner=None, department=None, service_unit=None):
	scopes = (practitioner, department, service_unit)
	date = getdate(date)

	return frappe.get_all(
		"Practitioner Availability",
		fields=[
			"name",
			"start_date as appointment_date",
			"start_time as appointment_time",
			"duration",
			"type",
			"reason",
			"note",
		],
		filters={
			"type": "Unavailable",
			"docstatus": 1,
			"start_date": ("<=", date),
			"end_date": (">=", date),
			"scope": ["in", scopes],
		},
		order_by="start_time",
	)

def validate_practitioner_schedules(schedule_entry, practitioner):
	if not schedule_entry.schedule:
		frappe.throw(
			_("Practitioner {0} does not have a Practitioner Schedule assigned.").format(
				get_link_to_form("Healthcare Practitioner", practitioner)
			),
			title=_("Practitioner Schedule Not Found"),
		)

@frappe.whitelist()
def get_waiting_list():
	return frappe.db.sql("""
		SELECT 
			pa.name,
			pa.appointment_type,
			pa.patient_name,
			pa.patient,
			p.mobile,
			p.dob,
			p.custom_cpr,
			p.custom_file_number,
			p.image AS patient_image,
			p.sex AS gender,
			pa.practitioner,
			pa.practitioner_name,
			pa.custom_visit_status,
			pa.custom_appointment_category,
			pa.custom_past_appointment,
			at.arrival_time,
			pa.appointment_time,
			pa.appointment_date
		FROM `tabPatient Appointment` pa
		LEFT JOIN (
			SELECT parent, MAX(time) AS arrival_time
			FROM `tabAppointment Time Logs`
			WHERE status = 'Arrived'
			GROUP BY parent
		) at ON pa.name = at.parent
		LEFT JOIN `tabPatient` p 
			ON pa.patient = p.name
		WHERE pa.custom_visit_status = 'Arrived' 
		AND pa.appointment_date = CURDATE()
		ORDER BY pa.practitioner_name, at.arrival_time ASC
		LIMIT 5;

	""", as_dict=True)

@frappe.whitelist()
def add_item_to_appointment(appointment, item_code, qty: int = 1):
	appt = frappe.get_doc("Patient Appointment", appointment)
	row = appt.append("custom_billing_items", {
		"item_code": item_code,
		"qty": flt(qty or 1),
	})
	appt.save(ignore_permissions=True)
	frappe.db.commit()
	return row.name

@frappe.whitelist()
def remove_item_from_appointment(rowname):
	# rowname is the child row name in Appointment Billing Items table
	child = frappe.get_doc("Appointment Billing Items", rowname)
	parent = child.parent
	child.delete()
	frappe.db.commit()
	return parent

@frappe.whitelist()
def update_item_qty_in_appointment(rowname, qty: int):
	child = frappe.get_doc("Appointment Billing Items", rowname)
	child.qty = flt(qty or 1)
	child.save(ignore_permissions=True)
	frappe.db.commit()
	return child.parent

@frappe.whitelist()
def update_item_override(rowname, rate: float = None, reason: str = None):
	"""Set or clear a per-row override rate."""
	allowed_roles = _get_billing_override_roles()
	user_roles = set(frappe.get_roles(frappe.session.user))
	if not (user_roles & set(allowed_roles)):
		frappe.throw(_("You are not allowed to override billing rates."))

	child = frappe.get_doc("Appointment Billing Items", rowname)
	value = flt(rate or 0)
	child.override_rate = value
	child.override_reason = reason or None
	child.override_by = frappe.session.user if value > 0 else None
	child.save(ignore_permissions=True)
	frappe.db.commit()
	return child.parent

def _get_default_price_list():
	"""Return a valid selling price list or raise if none are configured."""
	candidates = [
		frappe.db.get_single_value("Selling Settings", "selling_price_list"),
		"Standard Selling",
	]
	for price_list in candidates:
		if price_list and frappe.db.exists("Price List", price_list):
			return price_list
	frappe.throw(_("No selling price list configured. Please create one in Selling Settings."))

def _get_active_insurance_policy(patient_name, company=None, on_date=None):
	"""Return the active Patient Insurance Policy for the given patient."""
	if not frappe.db.exists("DocType", "Patient Insurance Policy"):
		return None

	active_on = getdate(on_date) if on_date else getdate()
	policies = frappe.get_all(
		"Patient Insurance Policy",
		filters={
			"patient": patient_name,
			"docstatus": 1,
			"policy_expiry_date": (">=", active_on),
		},
		fields=["name", "insurance_plan", "insurance_payor", "policy_expiry_date", "policy_number"],
		order_by="policy_expiry_date asc",
	)

	for policy in policies:
		if is_insurance_policy_valid(policy.name, on_date=active_on, company=company):
			return policy

	return None

def sync_patient_billing_status(doc, method):
	"""Already implemented — keep as is."""

def sync_insurance_claim_status(doc, method):
	"""Sync insurance claim status to Patient Appointment when a claim is updated."""
	if not doc.patient or not frappe.db.exists("DocType", "Patient Appointment"):
		return

	appts = frappe.get_all(
		"Patient Appointment",
		filters={"patient": doc.patient, "custom_insurance_sales_invoice": ["!=", ""]},
		fields=["name", "custom_insurance_sales_invoice"],
	)

	for appt in appts:
		# link claim to appointment if invoice matches
		if appt.custom_insurance_sales_invoice and appt.custom_insurance_sales_invoice in (doc.sales_invoice or ""):
			status = doc.status or "Draft"
			frappe.db.set_value("Patient Appointment", appt.name, "custom_insurance_status", status)
			
@frappe.whitelist()
def get_active_insurance_policy_summary(patient, company=None, on_date=None):
	"""Return active insurance policy details for UI consumption."""
	if not patient or not frappe.db.exists("DocType", "Patient Insurance Policy"):
		return {}

	policy = _get_active_insurance_policy(patient, company=company, on_date=on_date)
	if not policy:
		return {}

	return {
		"name": policy.name,
		"insurance_payor": policy.insurance_payor,
		"insurance_plan": policy.insurance_plan,
		"policy_number": policy.get("policy_number"),
		"policy_expiry_date": policy.policy_expiry_date,
	}

@frappe.whitelist()
def list_patient_insurance_policies(patient):
	if not patient or not frappe.db.exists("DocType", "Patient Insurance Policy"):
		return []

	policies = frappe.get_all(
		"Patient Insurance Policy",
		filters={"patient": patient},
		fields=[
			"name",
			"policy_number",
			"insurance_payor",
			"insurance_plan",
			"policy_expiry_date",
			"docstatus",
		],
		order_by="policy_expiry_date desc",
	)
	return policies

@frappe.whitelist()
def create_patient_insurance_policy(patient, insurance_payor, policy_number, policy_expiry_date, insurance_plan=None):
	if not frappe.db.exists("DocType", "Patient Insurance Policy"):
		frappe.throw(_("Patient Insurance Policy doctype is not available on this site."))

	doc = frappe.new_doc("Patient Insurance Policy")
	doc.patient = patient
	doc.insurance_payor = insurance_payor
	doc.policy_number = policy_number
	doc.policy_expiry_date = policy_expiry_date
	doc.insurance_plan = insurance_plan or None
	doc.insert(ignore_permissions=True)
	if doc.meta.is_submittable:
		doc.submit()
	return doc.as_dict()

@frappe.whitelist()
def update_patient_insurance_policy(policy_name, insurance_payor=None, insurance_plan=None, policy_number=None, policy_expiry_date=None):
	if not frappe.db.exists("DocType", "Patient Insurance Policy"):
		frappe.throw(_("Patient Insurance Policy doctype is not available on this site."))

	doc = frappe.get_doc("Patient Insurance Policy", policy_name)
	updates = {}
	if insurance_payor is not None:
		updates["insurance_payor"] = insurance_payor
	if insurance_plan is not None:
		updates["insurance_plan"] = insurance_plan or None
	if policy_number is not None:
		updates["policy_number"] = policy_number
	if policy_expiry_date is not None:
		updates["policy_expiry_date"] = policy_expiry_date

	if updates:
		doc.flags.ignore_validate_update_after_submit = True
		doc.flags.ignore_permissions = True
		doc.update(updates)
		doc.save(ignore_permissions=True)
	return doc.as_dict()

@frappe.whitelist()
def record_sales_invoice_payment(invoice, payments=None, mode_of_payment=None, amount=None, reference_no=None, posting_date=None, submit_invoice: int = 1):
	"""Record payment directly on a Sales Invoice (POS style)."""
	if not invoice or not frappe.db.exists("Sales Invoice", invoice):
		frappe.throw(_("Sales Invoice {0} not found.").format(invoice or ""))

	def _ensure_list(value):
		if value is None or value == "":
			return []
		if isinstance(value, (list, tuple)):
			return list(value)
		if isinstance(value, str):
			try:
				parsed = frappe.parse_json(value)
			except Exception:
				return [value]
			else:
				if isinstance(parsed, list):
					return parsed
				return [parsed]
		return [value]

	def _coerce_rows(primary=None, amounts=None, references=None):
		rows = _ensure_list(primary)
		if rows and isinstance(rows[0], dict):
			refs = _ensure_list(references)
			coerced = []
			for idx, row in enumerate(rows):
				coerced.append({
					"mode_of_payment": row.get("mode_of_payment"),
					"amount": flt(row.get("amount") or 0),
					"reference_no": row.get("reference_no") or (refs[idx] if idx < len(refs) else ""),
				})
			return coerced

		mops = rows
		amount_list = _ensure_list(amounts)
		ref_list = _ensure_list(references)

		coerced = []
		for idx, mop in enumerate(mops):
			if mop in (None, ""):
				continue
			coerced.append({
				"mode_of_payment": mop,
				"amount": flt(amount_list[idx] if idx < len(amount_list) else 0),
				"reference_no": ref_list[idx] if idx < len(ref_list) else "",
			})
		return coerced

	payment_rows = _coerce_rows(payments, amounts=amount, references=reference_no) or _coerce_rows(mode_of_payment, amounts=amount, references=reference_no)
	if not payment_rows:
		payment_rows = [{
			"mode_of_payment": mode_of_payment,
			"amount": flt(amount or 0),
			"reference_no": reference_no or "",
		}]

	total_amount = sum(flt(row.get("amount") or 0) for row in payment_rows)
	if not total_amount:
		frappe.throw(_("Payment amount must be greater than zero."))

	inv = frappe.get_doc("Sales Invoice", invoice)
	if inv.docstatus == 1:
		frappe.throw(_("Sales Invoice {0} is already submitted. Please amend it or create a Payment Entry.").format(inv.name))

	inv.is_pos = 1
	if posting_date:
		inv.posting_date = posting_date
		inv.due_date = posting_date
	elif not inv.due_date:
		inv.due_date = inv.posting_date

	inv.set("payments", [])

	default_mop = 'Cash'
	outstanding = inv.outstanding_amount if inv.docstatus == 1 else inv.grand_total

	if not payment_rows:
		payment_rows = [{
			"mode_of_payment": default_mop or "",
			"amount": outstanding,
			"reference_no": reference_no or "",
		}]

	for idx, row in enumerate(payment_rows):
		mop = row.get("mode_of_payment") or default_mop
		row_amount = flt(row.get("amount") or 0)
		if not mop:
			frappe.throw(_("Mode of Payment is required for payment row {0}.").format(idx + 1))
		if row_amount <= 0:
			continue

		inv.append("payments", {
			"mode_of_payment": mop,
			"amount": row_amount,
			"base_amount": row_amount,
			"default": 1 if idx == 0 else 0,
			"reference_no": row.get("reference_no") or reference_no or "",
		})

	inv.set_missing_values()
	inv.calculate_taxes_and_totals()
	inv.save(ignore_permissions=True)

	if cint(submit_invoice):
		inv.submit()

	return {
		"invoice": inv.name,
		"submitted": inv.docstatus == 1,
		"outstanding": inv.outstanding_amount,
		"total_paid": sum(p.amount for p in inv.payments),
	}

def _resolve_price_list(appt, patient_doc):
	payment_type = (appt.get("custom_payment_type") or "").lower()
	default_price_list = _get_default_price_list()
	if "insur" in payment_type:
		active_on = getattr(appt, "appointment_date", None) or getattr(appt, "posting_date", None) or nowdate()
		company = getattr(appt, "company", None) or frappe.get_single("Global Defaults").default_company
		policy = _get_active_insurance_policy(patient_doc.name, company=company, on_date=active_on)
		if policy:
			price_lists = get_insurance_price_lists(policy.name, company)
			preferred_price_list = (
				price_lists.get("plan_price_list")
				or price_lists.get("default_price_list")
				or default_price_list
			)
			if preferred_price_list and frappe.db.exists("Price List", preferred_price_list):
				return preferred_price_list, True
			return default_price_list, True

	# fallback: default selling price list
	return default_price_list, False

def _get_item_rate(item_code, price_list, currency=None):
	# Pull rate from Item Price
	rate = frappe.db.get_value("Item Price",
		{"item_code": item_code, "price_list": price_list},
		"price_list_rate")
	if not rate:
		rate = 0
	if currency:
		# you can add currency conversion here if needed
		pass
	return flt(rate, 2)

def _get_row_rate(row, price_list, currency=None):
	"""Return the effective rate for a billing row, honoring overrides."""
	override = flt(getattr(row, "override_rate", 0) or 0)
	if override > 0:
		return override
	return _get_item_rate(row.item_code, price_list, currency)

def _get_billing_override_roles():
	defaults = {"Can Override Billing Rate", "System Manager", "Healthcare Practitioner"}
	try:
		settings = frappe.get_cached_doc("Do Health Settings")
		custom_roles = {r.role for r in getattr(settings, "billing_override_roles", []) if getattr(r, "role", None)}
		return custom_roles or defaults
	except Exception:
		return defaults

def _coverage_split(patient_name, item_code, unit_rate, qty, appointment_date=None, company=None):
	"""Split total between patient and insurance using active Patient Insurance Policy."""
	total = flt(unit_rate) * flt(qty)

	# Defaults (no subscription): patient pays all
	patient_share = total
	insurance_share = 0
	if not frappe.db.exists("DocType", "Patient Insurance Policy"):
		return flt(patient_share, 2), flt(insurance_share, 2)

	policy = _get_active_insurance_policy(patient_name, company=company, on_date=appointment_date)
	
	eligibility_plan = frappe.db.get_value('Insurance Payor Eligibility Plan',
		policy.get("insurance_plan"),
		['custom_default_discount_percentage', 'custom_coverage_type', 'custom_default_coverage_percentage', 'custom_default_fixed_amount'],
		as_dict=True
	)
	discount_percentage = flt(eligibility_plan["custom_default_discount_percentage"] or 0)
	discounted_total = total - (total * discount_percentage * 0.01)
	if eligibility_plan["custom_coverage_type"] == "Fixed Amount":
		fixed_amount = flt(eligibility_plan["custom_default_fixed_amount"] or 0)
		insurance_share = min(fixed_amount, discounted_total)
	elif eligibility_plan["custom_coverage_type"] == "Percentage":
		coverage_percentage = flt(eligibility_plan["custom_default_coverage_percentage"] or 0)
		insurance_share = flt(discounted_total * coverage_percentage * 0.01, 2)

	eligibility = get_insurance_eligibility(
		item_code=item_code,
		on_date=appointment_date or nowdate(),
		insurance_plan=policy.get("insurance_plan"),
	)
	if eligibility:
		discount_pct = flt(eligibility.get("discount") or 0)
		discounted_total = total - (total * discount_pct * 0.01)
		eligibility_more_data = frappe.db.get_value('Item Insurance Eligibility',
			eligibility.get("name"),
			['custom_coverage_type', 'custom_default_fixed_amount'],
			as_dict=True
		)
		if eligibility_more_data["custom_coverage_type"] == "Fixed Amount":
			fixed_amount = flt(eligibility_more_data["custom_default_fixed_amount"] or 0)
			insurance_share = min(fixed_amount, discounted_total)
		elif eligibility_more_data["custom_coverage_type"] == "Percentage":
			coverage_pct = flt(eligibility.get("coverage") or 0)
			insurance_share = flt(discounted_total * coverage_pct * 0.01, 2)
	
	patient_share = flt(discounted_total - insurance_share, 2)
	return flt(patient_share, 2), flt(insurance_share, 2)

@frappe.whitelist()
def get_appointment_items_snapshot(appointment_id):
	"""Return a snapshot: rows with computed rate, shares, and total blocks."""
	appt = frappe.get_doc("Patient Appointment", appointment_id)
	patient = frappe.get_doc("Patient", appt.patient)
	currency = frappe.db.get_default("currency") or "BHD"

	price_list, is_insurance = _resolve_price_list(appt, patient)

	rows = []
	totals_patient = 0.0
	totals_insurance = 0.0
	appt_date = getattr(appt, "appointment_date", None) or getattr(appt, "posting_date", None) or nowdate()
	company = getattr(appt, "company", None)

	for r in appt.get("custom_billing_items") or []:
		base_rate = _get_item_rate(r.item_code, price_list, currency)
		unit_rate = _get_row_rate(r, price_list, currency)
		qty = flt(r.qty or 1)

		if is_insurance:
			patient_share, insurance_share = _coverage_split(
				patient.name,
				r.item_code,
				unit_rate,
				qty,
				appointment_date=appt_date,
				company=company,
			)
		else:
			patient_share = unit_rate * qty
			insurance_share = 0.0

		rows.append({
			"name": r.name,
			"item_code": r.item_code,
			"item_name": r.item_name or frappe.db.get_value("Item", r.item_code, "item_name"),
			"qty": qty,
			"rate": unit_rate,
			"base_rate": base_rate,
			"override_rate": r.override_rate,
			"override_reason": r.override_reason,
			"override_by": r.override_by,
			"patient_share": patient_share,
			"insurance_share": insurance_share,
			"amount": flt(patient_share + insurance_share, 2),
		})
		totals_patient += patient_share
		totals_insurance += insurance_share

	return {
		"rows": rows,
		"currency": currency,
		"totals": {
			"patient": flt(totals_patient, 2),
			"insurance": flt(totals_insurance, 2),
			"grand": flt(totals_patient + totals_insurance, 2),
		}
	}

def _make_invoice(customer, items, posting_date=None, company=None, currency=None, patient=None, selling_price_list=None):
	inv = frappe.new_doc("Sales Invoice")
	inv.customer = customer
	inv.posting_date = posting_date or nowdate()
	if company: inv.company = company
	if currency: inv.currency = currency
	if patient: inv.patient = patient
	if selling_price_list: inv.selling_price_list = selling_price_list

	for it in items:
		inv.append("items", {
			"item_code": it["item_code"],
			"qty": flt(it.get("qty", 1)),
			"rate": flt(it.get("rate", 0)),
			"description": it.get("description") or "",
		})

	inv.insert(ignore_permissions=True)
	return inv

def _overwrite_invoice(invoice_doc, items, selling_price_list=None, submit_invoice=False):
	invoice_doc.set("items", [])
	for it in items:
		invoice_doc.append("items", {
			"item_code": it["item_code"],
			"qty": flt(it.get("qty", 1)),
			"rate": flt(it.get("rate", 0)),
			"description": it.get("description") or "",
		})

	if selling_price_list:
		invoice_doc.selling_price_list = selling_price_list

	invoice_doc.posting_date = nowdate()
	if hasattr(invoice_doc, "due_date"):
		invoice_doc.due_date = invoice_doc.posting_date

	invoice_doc.set_missing_values()
	invoice_doc.calculate_taxes_and_totals()
	invoice_doc.save(ignore_permissions=True)

	if submit_invoice and invoice_doc.docstatus == 0:
		invoice_doc.submit()

	return invoice_doc

def _update_patient_billing_status(appt, patient_invoice=None):
	if not patient_invoice or not frappe.db.exists("Sales Invoice", patient_invoice):
		appt.db_set("custom_billing_status", "Not Billed")
		return

	inv = frappe.get_doc("Sales Invoice", patient_invoice)

	if inv.docstatus == 2:
		appt.db_set("custom_billing_status", "Cancelled")
	elif inv.docstatus == 1 and inv.outstanding_amount == 0:
		appt.db_set("custom_billing_status", "Paid")
	elif inv.docstatus == 1 and 0 < inv.outstanding_amount < inv.grand_total:
		appt.db_set("custom_billing_status", "Partially Paid")
	else:
		appt.db_set("custom_billing_status", "Not Paid")

@frappe.whitelist()
def create_invoices_for_appointment(appointment_id, submit_invoice: int = 0):
	"""Two invoices model (Patient + Insurance)."""
	appt = frappe.get_doc("Patient Appointment", appointment_id)
	if not appt.get("custom_billing_items"):
		frappe.throw("Please add at least one item to bill.")

	patient = frappe.get_doc("Patient", appt.patient)
	company = appt.company or frappe.get_single("Global Defaults").default_company
	currency = frappe.db.get_default("currency") or "BHD"

	price_list, is_insurance = _resolve_price_list(appt, patient)

	patient_items, insurance_items = [], []
	appt_date = getattr(appt, "appointment_date", None) or getattr(appt, "posting_date", None) or nowdate()

	for r in appt.custom_billing_items:
		qty = flt(r.qty or 1)
		unit_rate = _get_row_rate(r, price_list, currency)

		if is_insurance:
			patient_share, insurance_share = _coverage_split(
				patient.name,
				r.item_code,
				unit_rate,
				qty,
				appointment_date=appt_date,
				company=company,
			)
			if patient_share > 0:
				per_unit_patient_rate = flt(patient_share / qty, 6)
				patient_items.append({
					"item_code": r.item_code,
					"qty": qty,
					"rate": per_unit_patient_rate,
				})
			if insurance_share > 0:
				per_unit_insurance_rate = flt(insurance_share / qty, 6)
				insurance_items.append({
					"item_code": r.item_code,
					"qty": qty,
					"rate": per_unit_insurance_rate,
				})
		else:
			patient_items.append({"item_code": r.item_code, "qty": qty, "rate": unit_rate})

	created = {
		"patient_invoice": None,
		"insurance_invoice": None,
		"patient_invoice_updated": False,
		"insurance_invoice_updated": False,
	}

	submit_flag = bool(cint(submit_invoice))
	existing_patient_invoice = (
		appt.ref_sales_invoice
		if appt.ref_sales_invoice and frappe.db.exists("Sales Invoice", appt.ref_sales_invoice)
		else None
	)
	existing_insurance_invoice = (
		appt.custom_insurance_sales_invoice
		if appt.custom_insurance_sales_invoice and frappe.db.exists("Sales Invoice", appt.custom_insurance_sales_invoice)
		else None
	)

	# Patient invoice
	if patient_items:
		cust = frappe.db.get_value("Patient", appt.patient, "customer")
		if not cust:
			frappe.throw(_("Patient is not linked to a Customer."))

		if existing_patient_invoice:
			inv = frappe.get_doc("Sales Invoice", existing_patient_invoice)
			if inv.docstatus == 1:
				frappe.throw(
					_("Sales Invoice {0} is submitted. Cancel or amend it before regenerating billing.").format(inv.name)
				)
			inv.customer = cust
			inv.patient = appt.patient
			inv.company = company
			inv.currency = currency
			inv = _overwrite_invoice(inv, patient_items, selling_price_list=price_list, submit_invoice=submit_flag)
			created["patient_invoice_updated"] = True
		else:
			inv = _make_invoice(
				cust,
				patient_items,
				company=company,
				currency=currency,
				patient=appt.patient,
				selling_price_list=price_list,
			)
			inv.is_pos = 0
			inv.due_date = inv.posting_date
			inv.save(ignore_permissions=True)
			if submit_flag:
				inv.submit()

		created["patient_invoice"] = inv.name
		appt.db_set("ref_sales_invoice", inv.name)
	elif existing_patient_invoice:
		created["patient_invoice"] = existing_patient_invoice

	# Insurance invoice
	if insurance_items:
		policy = _get_active_insurance_policy(appt.patient, company=company, on_date=appt_date)
		if not policy:
			frappe.throw(_("Cannot create insurance invoice without an active Patient Insurance Policy."))

		ins_cust = frappe.db.get_value("Insurance Payor", policy.insurance_payor, "customer")
		if not ins_cust:
			frappe.throw(
				_("Insurance Payor {0} is missing a linked Customer. Please update the payor record.").format(
					policy.insurance_payor
				)
			)

		if existing_insurance_invoice:
			inv_ins = frappe.get_doc("Sales Invoice", existing_insurance_invoice)
			if inv_ins.docstatus == 1:
				frappe.throw(
					_("Insurance Sales Invoice {0} is submitted. Cancel or amend it before regenerating billing.").format(
						inv_ins.name
					)
				)
			inv_ins.customer = ins_cust
			inv_ins.patient = appt.patient
			inv_ins.company = company
			inv_ins.currency = currency
			inv_ins.is_pos = 0
			inv_ins = _overwrite_invoice(inv_ins, insurance_items, selling_price_list=price_list, submit_invoice=submit_flag)
			created["insurance_invoice_updated"] = True
		else:
			inv_ins = _make_invoice(
				ins_cust,
				insurance_items,
				company=company,
				currency=currency,
				patient=appt.patient,
				selling_price_list=price_list,
			)
			inv_ins.is_pos = 0
			inv_ins.due_date = inv_ins.posting_date
			inv_ins.save(ignore_permissions=True)
			if submit_flag:
				inv_ins.submit()

		created["insurance_invoice"] = inv_ins.name
		appt.db_set("custom_insurance_sales_invoice", inv_ins.name)
	elif existing_insurance_invoice:
		created["insurance_invoice"] = existing_insurance_invoice

	# Billing status
	_update_patient_billing_status(appt, created.get("patient_invoice"))

	frappe.db.commit()
	return created

def sync_patient_billing_status(doc, method):
	"""Auto-sync appointment billing_status whenever a Sales Invoice changes."""
	if not doc.patient:
		return

	# find linked appointment(s)
	appts = frappe.get_all("Patient Appointment",
		filters={"ref_sales_invoice": doc.name},
		pluck="name")
	for appt_name in appts:
		appt = frappe.get_doc("Patient Appointment", appt_name)
		_update_patient_billing_status(appt, doc.name)

@frappe.whitelist()
def create_or_update_insurance_claim(appointment, invoice):
	appt = frappe.get_doc("Patient Appointment", appointment)
	if not frappe.db.exists("DocType", "Insurance Claim"):
		frappe.throw(_("Insurance Claim DocType is not available in this site."))

	company = appt.company or frappe.get_single("Global Defaults").default_company
	appt_date = getattr(appt, "appointment_date", None) or nowdate()
	policy = _get_active_insurance_policy(appt.patient, company=company, on_date=appt_date)
	if not policy:
		frappe.throw(_("Cannot create an insurance claim because the patient has no active insurance policy."))

	payor_customer = frappe.db.get_value("Insurance Payor", policy.insurance_payor, "customer")
	if not payor_customer:
		frappe.throw(
			_("Insurance Payor {0} is missing a linked Customer and cannot be used for claims.").format(
				policy.insurance_payor
			)
		)

	invoice_doc = frappe.get_doc("Sales Invoice", invoice)
	if invoice_doc.docstatus == 0:
		invoice_doc.submit()
		invoice_doc.reload()
	elif invoice_doc.docstatus != 1:
		frappe.throw(_("Sales Invoice {0} must be submitted before creating an insurance claim.").format(invoice_doc.name))

	existing_claim_name = frappe.db.get_value("Insurance Claim Coverage", {"sales_invoice": invoice}, "parent")
	if existing_claim_name:
		appt.db_set("custom_insurance_status", "Claimed")
		return existing_claim_name

	coverage_rows = []
	patient_doc = frappe.get_doc("Patient", appt.patient)

	for item in invoice_doc.items:
		eligibility = get_insurance_eligibility(
			item_code=item.item_code,
			on_date=invoice_doc.posting_date,
			insurance_plan=policy.insurance_plan,
		)
		template_dt = eligibility.get("template_dt") if eligibility else None
		template_dn = eligibility.get("template_dn") if eligibility else None
		if not template_dt and appt.appointment_type:
			template_dt = "Appointment Type"
			template_dn = appt.appointment_type

		coverage_info = make_insurance_coverage(
			patient=appt.patient,
			policy=policy.name,
			company=company,
			template_dt=template_dt,
			template_dn=template_dn,
			item_code=item.item_code,
			qty=item.qty,
			rate=item.rate,
		)
		coverage_name = coverage_info.get("coverage") if coverage_info else None
		if not coverage_name:
			continue

		coverage_doc = frappe.get_doc("Patient Insurance Coverage", coverage_name)
		coverage_doc.update_invoice_details(flt(item.qty or 1), coverage_doc.coverage_amount or 0)
		coverage_doc.reload()
		coverage_rows.append((coverage_doc, item))

	if not coverage_rows:
		frappe.throw(_("Unable to create insurance coverage for the invoice items. Please verify insurance eligibility setup."))

	claim = frappe.new_doc("Insurance Claim")
	claim.patient = appt.patient
	claim.company = company
	claim.insurance_payor = policy.insurance_payor
	claim.customer = payor_customer
	claim.insurance_policy = policy.name
	claim.insurance_plan = policy.insurance_plan
	claim.policy_number = policy.get("policy_number")
	claim.posting_date = nowdate()
	claim.from_date = getdate(appt_date)
	claim.to_date = getdate(appt_date)
	claim.posting_date_based_on = "Sales Invoice"
	claim.status = "Draft"

	for coverage_doc, item in coverage_rows:
		claim.append("coverages", {
			"insurance_coverage": coverage_doc.name,
			"insurance_coverage_posting_date": coverage_doc.posting_date,
			"mode_of_approval": coverage_doc.mode_of_approval,
			"policy_number": policy.get("policy_number"),
			"policy_expiry_date": policy.policy_expiry_date,
			"insurance_plan": policy.insurance_plan,
			"patient": coverage_doc.patient,
			"patient_name": coverage_doc.patient_name,
			"gender": patient_doc.sex,
			"birth_date": patient_doc.dob,
			"sales_invoice": invoice_doc.name,
			"sales_invoice_posting_date": invoice_doc.posting_date,
			"item_code": item.item_code,
			"sales_invoice_item_amount": item.amount,
			"claim_coverage": coverage_doc.coverage,
			"claim_amount": coverage_doc.coverage_amount,
			"invoice_discount": coverage_doc.discount,
			"invoice_discount_amount": coverage_doc.discount_amount,
			"coverage": coverage_doc.coverage,
			"coverage_amount": coverage_doc.coverage_amount,
			"discount": coverage_doc.discount,
			"discount_amount": coverage_doc.discount_amount,
			"template_dt": coverage_doc.template_dt,
			"template_dn": coverage_doc.template_dn,
		})

	claim.insert(ignore_permissions=True)
	claim.add_comment("Comment", text=_("Linked from Sales Invoice {0}").format(invoice))
	appt.db_set("custom_insurance_status", "Claimed")
	return claim.name


@frappe.whitelist()
def get_patient_documents(patient):
	if not patient:
		return {"documents": [], "total_files": 0}

	frappe.has_permission("Patient", doc=patient, throw=True)

	documents_by_doctype = defaultdict(set)
	documents_by_doctype["Patient"].add(patient)

	linked_docs = get_linked_documents("Patient", patient) or {}
	for linked_doctype, items in linked_docs.items():
		for item in items or []:
			docname = item.get("name")
			if docname:
				documents_by_doctype[linked_doctype].add(docname)

	meta_cache = {}
	doc_details = {}

	for doctype, names in documents_by_doctype.items():
		if not names:
			continue

		meta = meta_cache.setdefault(doctype, frappe.get_meta(doctype))
		title_field = meta.get("title_field") or getattr(meta, "title_field", None)

		candidate_fields = []
		if title_field and title_field not in ("", "name"):
			candidate_fields.append(title_field)

		for fallback in ("title", "subject", "patient_name", "appointment_type", "procedure", "procedure_template"):
			if fallback not in candidate_fields and meta.get_field(fallback):
				candidate_fields.append(fallback)

		fields = ["name"]
		fields.extend(candidate_fields)

		rows = frappe.get_all(doctype, filters={"name": ["in", list(names)]}, fields=fields, limit=None)

		doctype_label = _(doctype)
		for row in rows:
			title = None
			for fieldname in candidate_fields:
				if row.get(fieldname):
					title = row[fieldname]
					break

			if not title:
				title = row.get("name")

			doc_details[(doctype, row["name"])] = {
				"doctype": doctype,
				"doctype_label": doctype_label,
				"docname": row["name"],
				"title": title,
				"route": f"#Form/{doctype}/{row['name']}",
				"files": [],
			}

	if not doc_details:
		return {"documents": [], "total_files": 0}

	conditions = []
	values = []
	for doctype, names in documents_by_doctype.items():
		if not names:
			continue
		name_list = list(names)
		placeholders = ", ".join(["%s"] * len(name_list))
		conditions.append(f"(attached_to_doctype=%s AND attached_to_name IN ({placeholders}))")
		values.append(doctype)
		values.extend(name_list)

	if not conditions:
		return {"documents": [], "total_files": 0}

	query = f"""
		SELECT
			name,
			file_name,
			file_url,
			file_size,
			attached_to_doctype,
			attached_to_name,
			attached_to_field,
			is_private,
			creation,
			modified,
			content_hash,
			owner
		FROM `tabFile`
		WHERE is_folder = 0 AND ({' OR '.join(conditions)})
		ORDER BY creation DESC
	"""

	files = frappe.db.sql(query, values, as_dict=True)

	total_files = 0
	for file_doc in files:
		key = (file_doc.attached_to_doctype, file_doc.attached_to_name)
		doc_info = doc_details.get(key)
		if not doc_info:
			continue

		doc_info["files"].append(
			{
				"name": file_doc.name,
				"file_name": file_doc.file_name,
				"file_url": file_doc.file_url,
				"file_size": file_doc.file_size,
				"attached_to_field": file_doc.attached_to_field,
				"is_private": file_doc.is_private,
				"creation": file_doc.creation,
				"modified": file_doc.modified,
				"content_hash": file_doc.content_hash,
				"owner": file_doc.owner,
			}
		)
		total_files += 1

	documents = []
	for doc in doc_details.values():
		if not doc["files"]:
			continue
		doc["files"].sort(key=lambda x: x["creation"], reverse=True)
		doc["files_count"] = len(doc["files"])
		latest = doc["files"][0]["creation"]
		doc["latest_file"] = latest
		documents.append(doc)

	documents.sort(key=lambda x: x["latest_file"], reverse=True)

	return {"documents": documents, "total_files": total_files}


@frappe.whitelist()
def get_appointment_counts_for_month(start_date, end_date):
	"""
	Get the count of appointments for each day in the given date range
	:param start_date: Start date of the range (YYYY-MM-DD)
	:param end_date: End date of the range (YYYY-MM-DD)
	:return: dict with date as key and count as value
	"""
	from collections import defaultdict
	
	appointments = frappe.db.sql("""
		SELECT 
			DATE(appointment_datetime) as appointment_date,
			COUNT(*) as count
		FROM `tabPatient Appointment`
		WHERE appointment_datetime >= %(start)s 
			AND appointment_datetime < %(end)s
			AND ifnull(status, '') != 'Cancelled'
		GROUP BY DATE(appointment_datetime)
	""", {
		'start': start_date,
		'end': end_date
	}, as_dict=True)
	
	# Convert to a simple dict for easy lookup
	counts = {}
	for appt in appointments:
		date_str = appt.appointment_date.strftime('%Y-%m-%d')
		counts[date_str] = appt.count
	
	return counts

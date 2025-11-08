import frappe
from frappe import _
import datetime
import frappe.query_builder
import frappe.query_builder.functions
from frappe.utils import nowdate, add_to_date, get_datetime, get_datetime_str, flt, format_date, format_datetime, fmt_money, get_link_to_form, get_time, getdate, cint
from frappe.utils.file_manager import save_file
from frappe.desk.form.save import cancel
# from healthcare.healthcare.doctype.patient_appointment.patient_appointment import update_status
from frappe.utils.pdf import get_pdf
import os
import base64
import re
from collections import defaultdict
import json
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

# App Resources
@frappe.whitelist()
def fetch_resources():
	user = frappe.get_doc('User', frappe.session.user)
	user_practitioner = frappe.db.get_value('Healthcare Practitioner', {'user_id': user.name}, ['name', 'practitioner_name', 'image', 'department'])
	branch = frappe.db.get_value('Employee', {'user_id': frappe.session.user}, ['branch'])
	return {
		'user': {'name': user.full_name, 
		   'user': user.name, 
		   'image': user.user_image, 
		   'branch': branch,
		   'practitioner': user_practitioner[0] if user_practitioner is not None else None, 
		   'practitioner_name': user_practitioner[1] if user_practitioner is not None else None, 
		   'practitioner_image': user_practitioner[2] if user_practitioner is not None else None, 
		   'practitioner_department': user_practitioner[3] if user_practitioner is not None else None, 
		   'roles': user.roles
		},
		'siteName': frappe.local.site
	}

# Appointments And Nurse Pages
@frappe.whitelist()
def get_tabs_count(filters):
	total_count = {'Scheduled': 0, 'Arrived': 0, 'Ready': 0, 'In Room': 0, 'Completed': 0, 'No Show': 0, 'Cancelled': 0}
	for key, value in total_count.items():
		count_filter = dict(filters)
		count_filter['custom_visit_status'] = key
		total_count[key] = frappe.db.count('Patient Appointment', count_filter)

	return total_count

@frappe.whitelist()
def fetch_patient_appointments(filters=None, or_filters=None, start=0, limit=50):
	dic = {}
	total_count = {'Scheduled': 0, 'Arrived': 0, 'Ready': 0, 'In Room': 0, 'Completed': 0, 'No Show': 0, 'Cancelled': 0}
	for key, value in total_count.items():
		count_filter = dict(filters)
		count_filter['custom_visit_status'] = key
		total_count[key] = frappe.db.count('Patient Appointment', count_filter)
	dic['total_count'] = total_count

	appointments = frappe.get_list(
		'Patient Appointment',
		filters=filters,
		or_filters=or_filters,
		fields=[
			'name', 'patient_name', 'status', 'custom_visit_status', 'custom_appointment_category',
			'appointment_type', 'appointment_for', 'practitioner_name', 'practitioner', 'appointment_datetime',
			'department', 'service_unit', 'duration', 'notes', 'appointment_date', 'appointment_time',
			'custom_payment_type', 'patient_age', 'patient', 'custom_confirmed', 'custom_customer', 
			'custom_invoice_tax_template', 'custom_apply_discount_on', 'custom_invoice_discount_percentage', 'custom_invoice_discount_amount'
		],
		order_by='appointment_date asc, appointment_time asc',
		start=start,
		page_length=limit
	)
	for appointment in appointments:
		appointment = get_appointment_details(appointment)
	dic['appointments'] = appointments

	return dic

@frappe.whitelist()
def check_availability(**args):
	appointments = frappe.get_list(
		'Patient Appointment',
		filters=args['filters'],
		fields=[
			'name', 'patient_name', 'status', 'custom_visit_status', 'custom_appointment_category',
			'appointment_type', 'appointment_for', 'practitioner_name', 'practitioner', 'appointment_datetime',
			'department', 'service_unit', 'duration', 'notes', 'appointment_date', 'appointment_time',
			'custom_payment_type', 'patient_age', 'patient', 'custom_confirmed', 'custom_customer'
		],
		order_by='appointment_date desc, appointment_time desc',
	)
	for appointment in appointments:
		appointment = get_appointment_details(appointment)
	return appointments

@frappe.whitelist()
def get_past_appointments(patient):
	appointments = frappe.get_list(
		'Patient Appointment',
		filters={'patient': patient},
		fields=[
			'name', 'patient_name', 'status', 'custom_visit_status', 'custom_appointment_category',
			'practitioner_name', 'duration', 'appointment_date', 'appointment_time', 'custom_confirmed'
		],
		order_by='appointment_date desc, appointment_time desc',
		page_length=10
	)
	for appointment in appointments:
		appointment.procedure_templates = frappe.get_all('Procedure Template Multi-select',
			filters={'parent': appointment.name},
			fields=['name', 'template']
		)
	return appointments

@frappe.whitelist()
def get_checklist_form(name):
	form = frappe.db.get_list('Checklist Form', filters={'name': name}, fields=['doctype', 'name', 'form_template', 'appointment'], )[0]
	form['children'] = {'checklist_items': get_checklist_form_items(name)}
	return form

@frappe.whitelist()
def get_checklist_form_items(template):
	return frappe.get_all('Checklist Form Items', fields=['label', 'for', 'type', 'options', 'value', 'idx'], filters={'parent': template}, order_by='idx')

@frappe.whitelist()
def reschedule_appointment(form, children={}):
	appointment = frappe.get_doc('Patient Appointment', form['name'])
	appointment.status = 'Rescheduled'
	appointment.save()

	form['name'] = ''
	new_doc = frappe.get_doc(form)
	new_doc.status = 'Rescheduled'
	
	if children:
		for key, items in children.items():
			for item in items:
				new_doc.append(key, item)

	new_doc.insert()

@frappe.whitelist()
def get_item_taxes(item):
	taxes = []
	item_taxes = frappe.get_all('Item Tax', filters={'parent': item}, pluck='item_tax_template')
	for template in item_taxes:
		taxes.append(frappe.get_all('Item Tax Template Detail', filters={'parent': template}, fields=['tax_type', 'tax_rate']))
	return taxes

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
def transferToPractitioner(app, practitioner):
	doc = frappe.get_doc('Patient Appointment', app)
	doc.practitioner = practitioner
	doc.custom_visit_status = 'Transferred'
	doc.save()

@frappe.whitelist()
def change_status(docname, status):
	doc = frappe.get_doc('Patient Appointment', docname)
	doc.custom_visit_status = status
	# doc.append("custom_appointment_time_logs", {
	# 	"status": status,
	# 	"time": datetime.datetime.now()
	# })
	doc.save()

@frappe.whitelist()
def fetch_nurse_records():
	users = frappe.db.get_all('User', filters={'status': 'Active'}, fields=['name', 'full_name'],)
	return users

# Patient Encounter Page
@frappe.whitelist()
def patient_encounter_name(appointment_id):
	if(frappe.db.exists('Patient Appointment', appointment_id)):
		appointment = frappe.get_doc('Patient Appointment', appointment_id)
		if frappe.db.exists('Patient Encounter', {"appointment": appointment_id}):
			return frappe.db.get_list('Patient Encounter', filters={"appointment": appointment_id}, pluck='name')[-1]
		else:
			patient = frappe.get_doc('Patient', appointment.patient)
			new_encounter = frappe.new_doc('Patient Encounter')
			new_encounter.appointment = appointment_id
			new_encounter.encounter_date = frappe.utils.nowdate()
			new_encounter.encounter_time = frappe.utils.nowtime()
			new_encounter.custom_encounter_start_time = frappe.utils.now()

			new_encounter.medical_department = appointment.department
			new_encounter.appointment_type = appointment.appointment_type
			new_encounter.custom_appointment_category = appointment.custom_appointment_category
			if appointment.custom_appointment_category == 'First Time' or (appointment.custom_appointment_category == 'Procedure' and len(appointment.custom_procedure_templates) == 0):
				new_encounter.custom_encounter_state = 'Consultation'
			else:
				new_encounter.custom_encounter_state = appointment.custom_appointment_category
			new_encounter.patient = patient.name
			new_encounter.patient_name = patient.patient_name
			new_encounter.patient_sex = patient.sex
			if patient.dob:
				new_encounter.patient_age = calculate_age(patient.dob)
			loggedin_practitioner = frappe.db.get_value('Healthcare Practitioner', {'user_id': frappe.session.user}, ['name', 'practitioner_name'])
			if loggedin_practitioner is not None:
				new_encounter.practitioner = loggedin_practitioner[0]
				new_encounter.practitioner_name = loggedin_practitioner[1]
			else:
				new_encounter.practitioner = appointment.practitioner
				new_encounter.practitioner_name = appointment.practitioner_name
			new_encounter.insert()
		
			# assign default values for the procedure
			if appointment.custom_appointment_category == 'Procedure':
				for prd in appointment.custom_procedure_templates:
					procedure = frappe.new_doc('Clinical Procedure')
					procedure.procedure_template = prd.template
					procedure.custom_patient_encounter = new_encounter.name
					procedure.patient = new_encounter.patient
					procedure.patient_name = new_encounter.patient_name
					procedure.patient_sex = new_encounter.patient_sex
					procedure.patient_age = new_encounter.patient_age
					procedure.practitioner = new_encounter.practitioner
					procedure.practitioner_name = new_encounter.practitioner_name
					procedure.medical_department = new_encounter.medical_department
					procedure.service_unit = appointment.service_unit
					procedure.insert()
			return new_encounter.name
@frappe.whitelist()
def patient_encounter_records(encounter_id):
	if(frappe.db.exists('Patient Encounter', encounter_id)):
		current_encounter = frappe.get_doc('Patient Encounter', encounter_id)
		appointment = None
		if current_encounter.appointment:
			appointment = frappe.get_doc('Patient Appointment', current_encounter.appointment)
		patient = frappe.get_doc('Patient', current_encounter.patient)
		practitioner = frappe.get_doc('Healthcare Practitioner', current_encounter.practitioner)
		procedures = []
		if frappe.db.exists('Clinical Procedure', {"custom_patient_encounter": current_encounter.name}):
			procedures_list = frappe.db.get_list('Clinical Procedure', filters={"custom_patient_encounter": current_encounter.name}, pluck='name')
			for procedure in procedures_list:
				procedures.append(frappe.get_doc('Clinical Procedure', procedure))

		vital_signs = frappe.db.get_list('Vital Signs',
			filters={'patient': current_encounter.patient},
			fields=[
				'signs_date', 'signs_time', 'temperature', 'pulse', 'respiratory_rate', 'tongue', 'abdomen', 'name', 'appointment',
				'reflexes', 'bp_systolic', 'bp_diastolic', 'vital_signs_note', 'height', 'weight', 'bmi', 'nutrition_note', 'custom_saturation_rate'
			],
			order_by='signs_date desc, signs_time desc',
		)
		services = frappe.db.get_list('Service Request',
			filters={'patient': current_encounter.patient}, 
			fields=[
				'status', 'order_date', 'order_time', 'practitioner', 'practitioner_email', 'medical_department', 'referred_to_practitioner', 
				'source_doc', 'order_group', 'sequence', 'staff_role', 'patient_care_type', 'intent', 'priority', 'quantity', 'dosage_form', 
				'as_needed', 'dosage', 'occurrence_date', 'occurrence_time', 'healthcare_service_unit_type', 'order_description', 
				'patient_instructions', 'template_dt', 'template_dn', 'sample_collection_required', 'qty_invoiced', 'billing_status'
			],
			order_by='order_date desc, order_time desc',
		)
		for service in services:
			practitioner = frappe.get_doc('Healthcare Practitioner', service.practitioner)
			status = frappe.get_doc('Code Value', service.status)
			service.practitioner = practitioner.practitioner_name
			service.status = status.display
		encounters = frappe.db.get_list('Patient Encounter', filters={"status": ['!=', 'Cancelled'], 'patient': patient.name}, pluck='name')
		encounter_docs = []
		pdf_extensions = ['pdf']
		word_extensions = ['doc', 'docx', 'dot', 'dotx']
		image_extensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp']
		attachments = []
		for encounter in encounters:
			doc = frappe.get_doc('Patient Encounter', encounter)
			for attachment in doc.custom_attachments:
				obj = {}
				obj = attachment.__dict__
				url = obj['attachment']
				if url:
					if url.split('.')[-1] in pdf_extensions:
						obj['type'] = 'pdf'
					elif url.split('.')[-1] in word_extensions:
						obj['type'] = 'word'
					elif url.split('.')[-1] in image_extensions:
						obj['type'] = 'image'
					else:
						obj['type'] = 'unknown'
					attachments.append(obj)
			doc = doc.as_dict()
			doc['procedures'] = frappe.get_list('Clinical Procedure', filters={'custom_patient_encounter': doc['name']}, pluck='procedure_template')
			encounter_docs.append(doc)
			if encounter == current_encounter.name:
				encounters.remove(encounter)
		return {
			'appointment': appointment, 
			'vitalSigns': vital_signs,
			'encounters': encounter_docs, 
			'patient': patient, 
			'practitioner': practitioner, 
			'attachments': attachments,
			'services': services,
			'current_encounter': current_encounter,
			'procedures': procedures
		}

@frappe.whitelist()
def cancel_encounter(encounter):
	cancel('Patient Encounter', encounter)
	doc = frappe.get_doc('Patient Encounter', encounter)
	# doc.docstatus = 0
	doc.save()
	# procedures = frappe.get_list('Clinical Procedure', filters={'custom_patient_encounter': encounter}, pluck='name')
	# for procedure in procedures:
		# cancel('Clinical Procedure', procedure)
		# procedure_doc = frappe.get_doc('Clinical Procedure', procedure)
		# # procedure_doc.cancel()
		# # procedure_doc.amend()
		# procedure_doc.docstatus = 0  # Draft state
		# procedure_doc.status = 'Draft'
		# procedure_doc.save()
	return doc

@frappe.whitelist()
def submit_encounter(encounter):
	doc = frappe.get_doc('Patient Encounter', encounter)
	doc.submit()
	procedures = frappe.get_list('Clinical Procedure', filters={'custom_patient_encounter': encounter}, pluck='name')
	for procedure in procedures:
		procedure_doc = frappe.get_doc('Clinical Procedure', procedure)
		procedure_doc.status = 'Completed'
		procedure_doc.submit()
	return doc

@frappe.whitelist()
def get_annotation_history(patient):
	encounter_records = frappe.get_all('Patient Encounter', filters={'patient': patient}, fields=['name'])
	procedure_records = frappe.get_all('Clinical Procedure', filters={'patient': patient}, fields=['name'])

	child_records = []
	for encounter in encounter_records:
		if frappe.db.exists('Patient Encounter', encounter['name']):
			child_records += frappe.get_all('Health Annotation Table', filters={'parent': encounter['name']}, fields=['annotation'])
	for procedure in procedure_records:	
		if frappe.db.exists('Clinical Procedure', procedure['name']):
			child_records += frappe.get_all('Health Annotation Table', filters={'parent': procedure['name']},fields=['annotation'])

	annotations = []
	for record in child_records:
		annotations += frappe.get_all('Health Annotation', 
								filters={'name': record['annotation']}, 
								fields=['name', 'annotation_template', 'image', 'json', 'creation'], 
								order_by='creation')
	return annotations
# Pharmacy Page
@frappe.whitelist()
def get_medication_requests():
	medications = frappe.db.get_list('Medication Request', filters={'status': 'active-Medication Request Status'}, fields=['*'])

	# Group by 'order_group'
	grouped_data = defaultdict(list)

	for item in medications:
		item.status_title = item.status.split('-Medication Request Status')[0].capitalize()
		grouped_data[item['order_group']].append(item)

	output_list = [
		{
			"encounter": key,
			"practitioner_name": value[0]['practitioner_name'],
			"patient_name": value[0]['patient_name'],
			"order_date": value[0]['order_date'],
			"order_time": value[0]['order_time'],
			"items": value
		} 
		for key, value in grouped_data.items()
	]

	return output_list

@frappe.whitelist()
def get_print_html(doctype, docname, print_format=None):
	return frappe.get_print(doctype, docname, print_format=print_format)

@frappe.whitelist()
def upload_signature(docname, doctype, file_data=None):
	if not file_data:
		frappe.throw("File data is missing")

	# Parse the data URL to get the file type and the Base64 data
	if file_data.startswith('data:image'):
		header, base64_data = file_data.split(',', 1)
		# Extract the file extension from the header
		extension = header.split('/')[1].split(';')[0]
		file_name = f"signature.{extension}"
	else:
		frappe.throw("Invalid file data")

	# Decode the Base64 string
	file_content = base64.b64decode(base64_data)

	# Save the file
	file_doc = save_file(
		file_name, file_content, doctype, docname, is_private=1
	)

	# Update the doctype with the file URL
	doc = frappe.get_doc(doctype, docname)
	doc.custom_patient_consent_signature = file_doc.file_url
	doc.save()

	return {"file_url": file_doc.file_url}

@frappe.whitelist()
def upload_annotation(docname, doctype, annotation_template, encounter_type='', file_data=None, jsonText='', annotation_type='Free Drawing'):
	if not file_data:
		frappe.throw("File data is missing")

	health_annotation = frappe.new_doc('Health Annotation')
	health_annotation.annotation_type = annotation_type
	health_annotation.annotation_template = annotation_template
	health_annotation.json = jsonText
	health_annotation.insert()
	# Parse the data URL to get the file type and the Base64 data
	if file_data.startswith('data:image'):
		header, base64_data = file_data.split(',', 1)
		# Extract the file extension from the header
		extension = header.split('/')[1].split(';')[0]
		file_name = f"annotation.{extension}"
	else:
		frappe.throw("Invalid file data")

	# Decode the Base64 string
	file_content = base64.b64decode(base64_data)

	# Save the file
	file_doc = save_file(file_name, file_content, health_annotation.doctype, health_annotation.name, is_private=1)

	# Update the doctype with the file URL
	health_annotation.image = file_doc.file_url
	health_annotation.save()
	
	doc = frappe.get_doc(doctype, docname)
	doc.append("custom_annotations", {
		"annotation": health_annotation.name,
		"type": encounter_type,
	})
	doc.save()

	return {"file_url": file_doc.file_url}

@frappe.whitelist()
def annotations_records():
	templates = frappe.db.get_list('Annotation Template', fields= ['label', 'gender', 'kid', 'image', 'name'], order_by='creation asc',)
	treatments = frappe.db.get_list('Annotation Treatment', fields= ['treatment', 'name', 'color'])
	for treatment in treatments:
		treatment.variables = frappe.db.get_all('Treatment Variables Table', fields=['variable_name', 'type', 'options'], filters={'parent': treatment.name})
	return {'templates': templates, 'treatments': treatments}

@frappe.whitelist()
def vital_signs_list(patient):
	if patient:
		return frappe.db.get_list('Vital Signs', 
			fields=['signs_date', 'signs_time', 'patient_name', 'name', 'appointment', 'modified', 'modified_by', 'patient'],
			filters={'patient': patient}, 
			order_by='signs_date desc, signs_time desc',
		)

@frappe.whitelist()
def save_patient_history(patient='', 
	allergies=None , 
	infected_diseases=None, 
	surgical_history=None, 
	medicaitons=None, 
	habits=None, 
	risk_factors=None,
	family_history=None,
	chronic_diseases='',
	genetic_diseases=''):
	doc = frappe.get_doc('Patient', patient)
	if allergies:
		doc.custom_allergies_table = []
		for item in allergies:
			del item['name']
			doc.append("custom_allergies_table", item)
	if infected_diseases:
		doc.custom_infected_diseases = []
		for item in infected_diseases:
			if 'creation' in item:
				del item['name']
			doc.append("custom_infected_diseases", item)
	if family_history:
		doc.custom_family_history = []
		for item in family_history:
			if 'creation' in item:
				del item['name']
			doc.append("custom_family_history", item)
	if surgical_history:
		doc.custom_surgical_history_table = []
		for item in surgical_history:
			if 'creation' in item:
				del item['name']
			doc.append("custom_surgical_history_table", item)
	if medicaitons:
		doc.custom_medications = []
		for item in medicaitons:
			if 'creation' in item:
				del item['name']
			doc.append("custom_medications", item)
	if habits:
		doc.custom_habits__social = []
		for item in habits:
			if 'creation' in item:
				del item['name']
			doc.append("custom_habits__social", item)
	if risk_factors:
		doc.custom_risk_factors_table = []
		for item in risk_factors:
			if 'creation' in item:
				del item['name']
			doc.append("custom_risk_factors_table", item)
	doc.custom_chronic_diseases = chronic_diseases
	doc.custom_genetic_conditions = genetic_diseases
	doc.custom_medical_history_last_updated = frappe.utils.now()
	doc.save()

@frappe.whitelist()
def patient(patient=''):
	doc = frappe.get_doc('Patient', patient).as_dict()
	children = {}
	children['custom_allergies_table'] = doc.pop('custom_allergies_table')
	children['custom_habits__social'] = doc.pop('custom_habits__social')
	children['custom_infected_diseases'] = doc.pop('custom_infected_diseases')
	children['custom_medications'] = doc.pop('custom_medications')
	children['custom_risk_factors_table'] = doc.pop('custom_risk_factors_table')
	children['custom_surgical_history_table'] = doc.pop('custom_surgical_history_table')
	children['patient_relation'] = doc.pop('patient_relation')
	return {'doc': doc, 'children': children}

@frappe.whitelist()
def invoices(**args):
	invoices_list = frappe.get_list('Sales Invoice', filters=args['filters'], fields=['name', 'posting_date', 'grand_total', 'paid_amount', 'status'], order_by='posting_date desc')
	for invoice in invoices_list:
		items = frappe.get_all('Sales Invoice Item', filters={'parent': invoice.name}, pluck='item_name')
		invoice['services'] = ", ".join(items)
	return invoices_list

@frappe.whitelist()
def pos_payment_method(pos_profile):
	return frappe.get_all('POS Payment Method',
        fields=['default', 'mode_of_payment'],
        filters={'parent': pos_profile}
	)

@frappe.whitelist()
def create_invoice(appointment, profile, payment_methods):
	appointment_doc = frappe.get_doc('Patient Appointment', appointment)
	patient = frappe.get_doc('Patient', appointment_doc.patient)
	branches = frappe.db.get_all('Branch', order_by='creation', pluck='name')
	branch = branches[0] if branches else ''
	customer_invoice_row = False
	insurance_invoice_row = False
	patient_invoice = None
	insurance_invoice = None
	insurance_price_list = 'Insurance Price' if frappe.db.exists('Price List', 'Insurance Price') else 'Standard Selling'
	for invoice_item in appointment_doc.custom_invoice_items:
		customer_amount = flt(invoice_item.customer_amount)
		insurance_amount = flt(getattr(invoice_item, "insurance_amount", 0))
		if not invoice_item.customer_invoice and customer_amount > 0:
			customer_invoice_row = True
		if not invoice_item.insurance_invoice and insurance_amount > 0:
			insurance_invoice_row = True

	if appointment_doc.custom_payment_type == 'Self Payment' and customer_invoice_row:
		invoice = frappe.new_doc('Sales Invoice')
		invoice.patient = patient.name
		invoice.patient_name = patient.patient_name
		invoice.is_pos = 1
		invoice.pos_profile = profile
		invoice.customer = patient.customer
		invoice.posting_date = frappe.utils.now()
		invoice.due_date = frappe.utils.now()
		invoice.service_unit = appointment_doc.service_unit
		invoice.taxes_and_charges = appointment_doc.custom_invoice_tax_template
		invoice.apply_discount_on = appointment_doc.custom_apply_discount_on
		invoice.additional_discount_percentage = appointment_doc.custom_invoice_discount_percentage
		invoice.discount_amount = appointment_doc.custom_invoice_discount_amount
		invoice.branch = appointment_doc.custom_branch or branch or ''
		invoice.selling_price_list = 'Standard Selling'
		for invoice_item in appointment_doc.custom_invoice_items:
			if not invoice_item.customer_invoice:
				qty = flt(invoice_item.quantity) or 1
				invoice.append('items', {
					'item_code': invoice_item.item,
					'item_name': invoice_item.item_name,
					'qty': qty,
					'discount_percentage': invoice_item.discount_percentage,
					'discount_amount': invoice_item.discount_amount,
				})
		for method in payment_methods:
			invoice.append('payments', {
				'default': method.get('default', 0),
				'mode_of_payment': method.get('mode_of_payment', ''),
				'amount': method.get('amount', 0),
				'reference_no': method.get('reference_no', '')
			})
		invoice.save()
		invoice.submit()
		for invoice_item in appointment_doc.custom_invoice_items:
			if not invoice_item.customer_invoice:
				invoice_item.customer_invoice = invoice.name
		appointment_doc.save()
		return {'customer_invoice': invoice.name}
	elif appointment_doc.custom_payment_type == 'Insurance' and (customer_invoice_row or insurance_invoice_row):
		if customer_invoice_row:
			patient_invoice = frappe.new_doc('Sales Invoice')
			patient_invoice.patient = patient.name
			patient_invoice.patient_name = patient.patient_name
			patient_invoice.is_pos = 1
			patient_invoice.pos_profile = profile
			patient_invoice.customer = patient.customer
			patient_invoice.posting_date = frappe.utils.now()
			patient_invoice.due_date = frappe.utils.now()
			patient_invoice.service_unit = appointment_doc.service_unit
			patient_invoice.branch = appointment_doc.custom_branch or branch or ''
			patient_invoice.taxes_and_charges = appointment_doc.custom_invoice_tax_template
			patient_invoice.apply_discount_on = appointment_doc.custom_apply_discount_on
			patient_invoice.additional_discount_percentage = appointment_doc.custom_invoice_discount_percentage
			patient_invoice.discount_amount = appointment_doc.custom_invoice_discount_amount
			patient_invoice.selling_price_list = insurance_price_list
			for invoice_item in appointment_doc.custom_invoice_items:
				if not invoice_item.customer_invoice:
					qty = flt(invoice_item.quantity) or 1
					customer_amount = flt(invoice_item.customer_amount)
					patient_invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'qty': qty,
						'discount_percentage': invoice_item.discount_percentage,
						'discount_amount': invoice_item.discount_amount,
						'rate': customer_amount / qty,
						'amount': customer_amount,
					})
			for method in payment_methods:
				patient_invoice.append('payments', {
					'default': method.get('default', 0),
					'mode_of_payment': method.get('mode_of_payment', ''),
					'amount': method.get('amount', 0),
					'reference_no': method.get('reference_no', '')
				})
			patient_invoice.save()
			patient_invoice.submit()

		if insurance_invoice_row:
			insurance_invoice = frappe.new_doc('Sales Invoice')
			insurance_invoice.patient = patient.name
			insurance_invoice.patient_name = patient.patient_name
			insurance_invoice.is_pos = 0
			insurance_invoice.customer = patient.custom_insurance_company_name
			insurance_invoice.posting_date = frappe.utils.now()
			insurance_invoice.due_date = frappe.utils.now()
			insurance_invoice.service_unit = appointment_doc.service_unit
			insurance_invoice.branch = appointment_doc.custom_branch or branch or ''
			insurance_invoice.taxes_and_charges = appointment_doc.custom_invoice_tax_template
			insurance_invoice.selling_price_list = insurance_price_list
			for invoice_item in appointment_doc.custom_invoice_items:
				if not invoice_item.insurance_invoice:
					qty = flt(invoice_item.quantity) or 1
					insurance_amount = flt(getattr(invoice_item, "insurance_amount", 0))
					insurance_invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'uom': invoice_item.item_uom,
						'qty': qty,
						'rate': insurance_amount / qty if qty else 0,
						'amount': insurance_amount,
					})
			insurance_invoice.save()
			insurance_invoice.submit()

		for invoice_item in appointment_doc.custom_invoice_items:
			if patient_invoice and not invoice_item.customer_invoice:
				invoice_item.customer_invoice = patient_invoice.name
				
			if insurance_invoice and not invoice_item.insurance_invoice:
				invoice_item.insurance_invoice = insurance_invoice.name
				
		appointment_doc.save()
		return {
			'insurance_invoice': insurance_invoice.name if insurance_invoice else None,
			'customer_invoice': patient_invoice.name if patient_invoice else None
		}

@frappe.whitelist()
def create_mock_invoice(appointment):
	appointment_doc = frappe.get_doc('Patient Appointment', appointment)
	patient = frappe.get_doc('Patient', appointment_doc.patient)
	branches = frappe.db.get_all('Branch', order_by='creation', pluck='name')
	branch = branches[0] if branches else ''
	insurance_price_list = 'Insurance Price' if frappe.db.exists('Price List', 'Insurance Price') else 'Standard Selling'
	customer_invoice_row = False
	for invoice_item in appointment_doc.custom_invoice_items:
		if not invoice_item.customer_invoice and flt(invoice_item.customer_amount) > 0:
			customer_invoice_row = True
	if customer_invoice_row:
		invoice = frappe.new_doc('Sales Invoice')
		invoice.patient = patient.name
		invoice.patient_name = patient.patient_name
		invoice.is_pos = 0
		invoice.customer = patient.customer
		invoice.posting_date = frappe.utils.now()
		invoice.due_date = frappe.utils.now()
		invoice.service_unit = appointment_doc.service_unit
		invoice.taxes_and_charges = appointment_doc.custom_invoice_tax_template
		invoice.apply_discount_on = appointment_doc.custom_apply_discount_on
		invoice.additional_discount_percentage = appointment_doc.custom_invoice_discount_percentage
		invoice.discount_amount = appointment_doc.custom_invoice_discount_amount
		invoice.branch = appointment_doc.custom_branch or branch or ''
		if appointment_doc.custom_payment_type == 'Insurance':
			invoice.selling_price_list = 'Standard Selling'
			for invoice_item in appointment_doc.custom_invoice_items:
				if not invoice_item.customer_invoice:
					qty = flt(invoice_item.quantity) or 1
					invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'qty': qty,
						'discount_percentage': invoice_item.discount_percentage,
						'discount_amount': invoice_item.discount_amount,
					})
		else:
			invoice.selling_price_list = insurance_price_list
			for invoice_item in appointment_doc.custom_invoice_items:
				if not invoice_item.customer_invoice:
					qty = flt(invoice_item.quantity) or 1
					customer_amount = flt(invoice_item.customer_amount)
					invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'qty': qty,
						'discount_percentage': invoice_item.discount_percentage,
						'discount_amount': invoice_item.discount_amount,
						'rate': customer_amount / qty,
						'amount': customer_amount,
					})
		invoice.set_missing_values()
		invoice.calculate_taxes_and_totals()
		return invoice

@frappe.whitelist()
def make_payment(appointment, invoices, profile, payment_methods):
	for invoice in invoices:
		invoice_doc = frappe.get_doc('Sales Invoice', invoice)
		invoice_doc.pos_profile = profile
		for method in payment_methods:
			invoice_doc.append('payments', {
				'default': method.get('default', 0),
				'mode_of_payment': method.get('mode_of_payment', ''),
				'amount': method.get('amount', 0),
				'reference_no': method.get('reference_no', '')
			})
		invoice_doc.save()
		invoice_doc.submit()
	appointment_doc = frappe.get_doc('Patient Appointment', appointment)
	for invoice_item in appointment_doc.custom_invoice_items:
		invoice_item.paid = frappe.db.get_value('Sales Invoice', invoice_item.customer_invoice, 'status')
	appointment_doc.save()

@frappe.whitelist()
def get_invoice_items(**args):
	items = frappe.get_list(args['doctype'], fields=args['fields'], filters=args['filters'], or_filters=args['or_filters'], order_by=args['order_by'], limit=args['limit'])
	for item in items:
		item.item_price = frappe.get_list('Item Price', fields=['price_list', 'price_list_rate'], filters={'item_code': item.name})
	return items

@frappe.whitelist()
def edit_doc(form, children={}, submit=False):
	# Fetch the document using the doctype and name
	doc = frappe.get_doc(form['doctype'], form['name'])

	# Remove the 'doctype' and 'name' from the form data
	form.pop('doctype', None)
	form.pop('name', None)

	# Assign form values to the document fields
	for key, value in form.items():
		# Only set fields that exist in the document's schema
		if hasattr(doc, key):
			setattr(doc, key, value)

	if children:
		for key, items in children.items():
			setattr(doc, key, [])
			for item in items:
				doc.append(key, item)

	# Save the changes to the existing document
	doc.save()

	# Optionally submit the document
	if submit:
		doc.submit()

	return doc

@frappe.whitelist()
def new_doc(form, children={}, submit=False):
	doc = frappe.get_doc(form)
	if children:
		for key, items in children.items():
			for item in items:
				doc.append(key, item)
	doc.insert()
	if(submit):
		doc.submit()

	if form.get('parenttype') == 'Patient Appointment':
		parent = frappe.get_doc('Patient Appointment', form['parent'])
		frappe.publish_realtime(
			event="patient_appointments_updated",
			message=get_appointment_details(parent.as_dict()),
			after_commit=True
		)

	return doc

def get_age(delta_st):
	# Regular expression to extract years, months, and days
	pattern = r"years=\+?(\d+), months=\+?(\d+), days=\+?(\d+)"

	# Search for the pattern in the string
	match = re.search(pattern, delta_st)

	if match:
		years = int(match.group(1))
		months = int(match.group(2))
		days = int(match.group(3))

		# Format the output string
		return f"{years} Year(s) {months} Month(s) {days} Day(s)"
	else:
		print("Invalid relativedelta string")

def get_pdf_url(doctype, docname, print_format=None):
	# Get the HTML of the document using the specified print format
	html = frappe.get_print(doctype, docname, print_format=print_format)

	# Generate PDF from the HTML
	pdf_content = get_pdf(html)

	# Define the path to save the PDF
	file_name = f"{docname}.pdf"
	file_path = os.path.join(frappe.get_site_path(), "public", "files", file_name)

	# Write the PDF content to a file
	with open(file_path, "wb") as f:
		f.write(pdf_content)

	# Return the URL to access the PDF
	base_url = frappe.utils.get_url()
	pdf_url = f"{base_url}/files/{file_name}"
	return html

def get_updated_encounter(doc, method):
	frappe.publish_realtime("patient_encounter", doc)
	return doc

def get_services(doc=None, method=None):
	services = frappe.db.get_list('Service Request',
		fields=[
			'status', 'order_date', 'order_time', 'practitioner', 'practitioner_email', 'medical_department', 'referred_to_practitioner', 
			'source_doc', 'order_group', 'sequence', 'staff_role', 'patient_care_type', 'intent', 'priority', 'quantity', 'dosage_form', 
			'as_needed', 'dosage', 'occurrence_date', 'occurrence_time', 'healthcare_service_unit_type', 'order_description', 'patient',
			'patient_instructions', 'template_dt', 'template_dn', 'sample_collection_required', 'qty_invoiced', 'billing_status'
		],
		order_by='order_date asc, order_time asc',
	)
	for service in services:
		practitioner = frappe.get_doc('Healthcare Practitioner', service.practitioner)
		status = frappe.get_doc('Code Value', service.status)
		service.practitioner = practitioner.practitioner_name
		service.status = status.display
	frappe.publish_realtime("services", services)
	return services

def get_appointments(doc=None, method=None):
	if doc:  # Check if the appointment document exists
		appointment = get_appointment_details(doc.as_dict())
		frappe.publish_realtime(
			event="patient_appointments_updated",
			message=appointment,
			after_commit=True
		)

def get_appointment_details(appointment):
	# Get patient details
	patient_details = frappe.get_doc('Patient', appointment['patient'])
	appointment['patient_details'] = {
		'id': patient_details.name,
		'image': patient_details.image,
		'mobile': patient_details.mobile,
		'gender': patient_details.sex,
		'age': appointment['patient_age'],
		'cpr': patient_details.custom_cpr,
		'date_of_birth': patient_details.dob,
		'file_number': patient_details.custom_file_number
	}

	# Get latest vital signs for the patient
	vital_signs = frappe.get_list('Vital Signs', 
		filters={
			'patient': appointment['patient']
		},
		fields=['height', 'weight', 'bmi', 'nutrition_note'],
		order_by='signs_date desc',
		limit=1
	)
	if vital_signs:
		appointment.update(vital_signs[0])

	# Get the last visit date
	last_visit = frappe.get_list('Patient Encounter', 
		filters={
			'patient': appointment['patient']
		},
		fields=['encounter_date'],
		order_by='encounter_date desc',
		limit=1
	)
	if last_visit:
		appointment['last_visit'] = last_visit[0]['encounter_date']

	# Get procedure templates
	procedure_templates = frappe.get_all('Procedure Template Multi-select',
		filters={'parent': appointment['name']},
		fields=['name', 'template']
	)
	for procedure in procedure_templates:
		procedure.value = procedure.template
	appointment['procedure_templates'] = procedure_templates

	# Get visit notes
	from_options = ['', frappe.session.user, frappe.session.full_name]
	visit_notes = frappe.get_all('Appointment Note Table',
		filters={'parent': appointment['name']},
		fields=['name', 'for', 'note', 'time', 'read', 'from'],
		order_by='time desc'
	)
	for note in visit_notes:

		note['names'] = []
		if note['for'] == 'Users':
			users = frappe.get_all('User Multitable', filters={'parent': note.name}, fields=['user'])
			if not (note['from'] in from_options or any(user['user'] == frappe.session.user for user in users) or len(users) == 0):
				continue
			note['users'] = users
			if len(users) == 0:
				note['names'] = ''
			for user in note['users']:
				note['names'].append(frappe.db.get_value('User', user.user, 'full_name'))
		else:
			roles = frappe.get_all('Role Multitable', filters={'parent': note.name}, fields=['role'])
			if not (note['from'] in from_options or any(role['role'] in frappe.get_roles(frappe.session.user) for role in roles) or len(roles) == 0):
				continue
			note['roles'] = roles
			if len(roles) == 0:
				note['names'] = ''
			for role in note['roles']:
				note['names'].append(frappe.db.get_value('Role', role.role, 'role_name'))

		note['names'] = ', '.join(note['names'])

	appointment['visit_notes'] = [note for note in visit_notes if note['names'] != []]

	# Get status log
	status_log = frappe.get_all('Appointment Time Logs',
		filters={'parent': appointment['name']},
		fields=['status', 'time'],
		order_by='time'
	)
	appointment['status_log'] = status_log

	# Get invoice items
	invoice_items = frappe.get_all('Healthcare Invoice Item', 
		filters={'parent': appointment['name']},
		fields=['*']
	)
	paid_amount = 0
	for item in invoice_items:
		if item.customer_invoice:
			paid_amount += frappe.db.get_value('Sales Invoice', item.customer_invoice, 'paid_amount')
	appointment['invoice_items'] = invoice_items
	appointment['paid_amount'] = paid_amount

	# Get practitioner image
	practitioner = frappe.get_doc('Healthcare Practitioner', appointment['practitioner'])
	appointment['practitioner_image'] = practitioner.image if practitioner else None
	return appointment

def calculate_age(dob):
	today = datetime.datetime.today()
	age_years = today.year - dob.year
	age_months = today.month - dob.month
	age_days = today.day - dob.day

	# Adjust for cases where the current day/month is less than the birth day/month
	if age_days < 0:
		age_months -= 1
		last_month = today.month - 1 if today.month > 1 else 12
		last_month_year = today.year if today.month > 1 else today.year - 1
		days_in_last_month = (datetime.datetime(last_month_year, last_month + 1, 1) - datetime.datetime(last_month_year, last_month, 1)).days
		age_days += days_in_last_month

	if age_months < 0:
		age_years -= 1
		age_months += 12

	return f"{age_years} Year(s) {age_months} Month(s) {age_days} Day(s)"

def check_app_permission():
	# if frappe.session.user == "Administrator":
	# 	return True

	# roles = frappe.get_roles()
	# if any(role in ["System Manager", "Sales User", "Sales Manager", "Sales Master Manager"] for role in roles):
	# 	return True

	return True

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

def on_logout(): 
	frappe.publish_realtime("session_logout")
 
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
	appo.creation 					as creation,
	appo.patient_name 				as patient_name,
	appo.patient					as patient,
	appo.owner 						as owner,
	appo.modified_by 				as modified_by,
	appo.custom_visit_status 		as status,
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
	appo.custom_confirmed	 		as confirmed,
	appo.reminded	 				as reminded,
	TIMESTAMPADD(minute,appo.duration,appo.appointment_datetime) 	as ends_at,
	appo.service_unit 				as room,
	0	 							as allDay,
	null 							as procedure_name,
	prov.custom_background_color 	as background_color,
	prov.custom_text_color 			as text_color,
	pat.image 						as image,
	pat.custom_file_number 			as file_number,
	pat.patient_name 				as full_name,
	pat.mobile 						as mobile,
	pat.dob 						as birthdate,
	pat.custom_cpr 					as cpr
	from `tabPatient Appointment` 	as appo
	LEFT JOIN `tabPatient` 	as pat ON pat.name = appo.patient
	LEFT JOIN `tabHealthcare Practitioner` as prov ON prov.name = appo.practitioner
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
			pa.patient_name,
			pa.patient,
			p.image AS patient_image,
			pa.practitioner,
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
		ORDER BY at.arrival_time DESC
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
		unit_rate = _get_item_rate(r.item_code, price_list, currency)
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
		unit_rate = _get_item_rate(r.item_code, price_list, currency)

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

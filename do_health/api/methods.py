import frappe
from frappe import _
import datetime
import frappe.query_builder
import frappe.query_builder.functions
from frappe.utils import add_to_date, get_datetime, get_datetime_str, flt, format_date, get_link_to_form, get_time, getdate
from frappe.utils.file_manager import save_file
from frappe.desk.form.save import cancel
# from healthcare.healthcare.doctype.patient_appointment.patient_appointment import update_status
from frappe.utils.pdf import get_pdf
import os
import base64
import re
from collections import defaultdict
import json

from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	check_employee_wise_availability,
	get_available_slots
)

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
	for invoice_item in appointment_doc.custom_invoice_items:
		if not invoice_item.customer_invoice and float(invoice_item.customer_amount) > 0:
			customer_invoice_row = True
		if not invoice_item.insurance_invoice and float(invoice_item.customer_amount) > 0:
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
				invoice.append('items', {
					'item_code': invoice_item.item,
					'item_name': invoice_item.item_name,
					'qty': invoice_item.quantity,
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
			patient_invoice.selling_price_list = 'Insurance Price' or 'Standard Selling'
			for invoice_item in appointment_doc.custom_invoice_items:
				if not invoice_item.customer_invoice:
					patient_invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'qty': invoice_item.quantity,
						'discount_percentage': invoice_item.discount_percentage,
						'discount_amount': invoice_item.discount_amount,
						'rate': float(invoice_item.customer_amount) / float(invoice_item.quantity),
						'amount': invoice_item.customer_amount,
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
			insurance_invoice.selling_price_list = 'Insurance Price' or 'Standard Selling'
			for invoice_item in appointment_doc.custom_invoice_items:
				if not invoice_item.insurance_invoice:
					insurance_invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'uom': invoice_item.item_uom,
						'qty': invoice_item.quantity,
						'rate': float(invoice_item.insurance_amount) / float(invoice_item.quantity),
						'amount': invoice_item.insurance_amount,
					})
			insurance_invoice.save()
			insurance_invoice.submit()

		for invoice_item in appointment_doc.custom_invoice_items:
			if not invoice_item.customer_invoice:
				invoice_item.customer_invoice = patient_invoice.name
				
			if not invoice_item.insurance_invoice:
				invoice_item.insurance_invoice = insurance_invoice.name
				
		appointment_doc.save()
		return {'insurance_invoice': insurance_invoice.name, 'customer_invoice': patient_invoice.name}

@frappe.whitelist()
def create_mock_invoice(appointment):
	appointment_doc = frappe.get_doc('Patient Appointment', appointment)
	patient = frappe.get_doc('Patient', appointment_doc.patient)
	branches = frappe.db.get_all('Branch', order_by='creation', pluck='name')
	branch = branches[0] if branches else ''
	customer_invoice_row = False
	for invoice_item in appointment_doc.custom_invoice_items:
		if not invoice_item.customer_invoice and float(invoice_item.customer_amount) > 0:
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
					invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'qty': invoice_item.quantity,
						'discount_percentage': invoice_item.discount_percentage,
						'discount_amount': invoice_item.discount_amount,
					})
		else:
			invoice.selling_price_list = 'Insurance Price' or 'Standard Selling'
			for invoice_item in appointment_doc.custom_invoice_items:
				if not invoice_item.customer_invoice:
					invoice.append('items', {
						'item_code': invoice_item.item,
						'item_name': invoice_item.item_name,
						'qty': invoice_item.quantity,
						'discount_percentage': invoice_item.discount_percentage,
						'discount_amount': invoice_item.discount_amount,
						'rate': float(invoice_item.customer_amount) / float(invoice_item.quantity),
						'amount': invoice_item.customer_amount,
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
	appo.owner 						as owner,
	appo.modified_by 				as modified_by,
	appo.custom_visit_status 		as status,
	appo.notes 						as note,
	appo.custom_payment_type		as payment_type,
	(SELECT atl.`time` FROM `tabAppointment Time Logs` atl WHERE atl.status = 'Arrived' AND atl.parent = appo.name ORDER BY atl.`time` DESC LIMIT 1) as arrival_time,
	appo.modified 					as modified,
	appo.patient_name 				as customer,
	appo.appointment_datetime 		as starts_at,
	appo.appointment_type 			as appointment_type,
	appo.custom_visit_reason 		as visit_reason,	
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

	if practitioner_doc.practitioner_schedules:
		slot_details = get_available_slots(practitioner_doc, date)
	else:
		frappe.throw(
			_(
				"{0} does not have a Healthcare Practitioner Schedule. Add it in Healthcare Practitioner master"
			).format(practitioner),
			title=_("Practitioner Schedule Not Found"),
		)

	if not slot_details:
		# TODO: return available slots in nearby dates
		frappe.throw(
			_("Healthcare Practitioner not available on {0}").format(weekday), title=_("Not Available")
		)

	return {"slot_details": slot_details, "fee_validity": 'Disabled'}

@frappe.whitelist()
def get_waiting_list():
	# Get the waiting list
	return frappe.db.sql("""
		SELECT pa.name, pa.patient_name, pa.patient, pa.practitioner, at.time as arrival_time, pa.appointment_time, pa.appointment_date
		FROM `tabPatient Appointment` pa
		LEFT JOIN `tabAppointment Time Logs` at ON pa.name = at.parent AND at.status = 'Arrived'
		WHERE pa.custom_visit_status = 'Arrived' AND pa.appointment_date = CURDATE()
		ORDER BY at.time DESC
	""", as_dict=True)

@frappe.whitelist()
def determine_service_price_for_service(appt, service_name):
	"""
	Like determine_service_price(), but handles one service for a given appointment.
	"""
	service = frappe.get_doc("Healthcare Service Template", service_name)

	default_self_price = flt(service.get("base_price", 0))
	default_insurance_price = flt(service.get("default_insurance_price", 0))
	currency = service.get("currency") or frappe.db.get_default("currency") or "BHD"

	practitioner_price = None
	price_source = "service_template"

	if appt.practitioner:
		practitioner = frappe.get_doc("Healthcare Practitioner", appt.practitioner)
		for r in practitioner.get("custom_service_prices") or []:
			if r.get("service_name") == service_name:
				if appt.custom_payment_type and appt.custom_payment_type.lower().startswith("insur"):
					practitioner_price = flt(r.get("insurance_price", 0))
				else:
					practitioner_price = flt(r.get("self_price", 0))
				price_source = "practitioner"
				break

	if appt.custom_payment_type and appt.custom_payment_type.lower().startswith("insur"):
		price = practitioner_price or default_insurance_price or default_self_price
	else:
		price = practitioner_price or default_self_price

	return {"price": flt(price, 2), "price_source": price_source, "currency": currency}

def make_invoice(customer, items, posting_date=None, company=None, currency=None, patient=None):
	"""
	Create a Sales Invoice (Draft) with provided item lines.
	'items' should be a list of dicts in the form:
		[{ "item_code": "ITEM-001", "qty": 1, "rate": 25.0, "description": "...", "income_account": "...", "cost_center": "..." }, ...]

	Returns inserted Sales Invoice doc.
	"""
	if not customer:
		frappe.throw("customer required for invoice")

	inv = frappe.new_doc("Sales Invoice")
	inv.customer = customer

	if posting_date:
		inv.posting_date = posting_date
	else:
		inv.posting_date = nowdate()

	if company:
		inv.company = company

	if currency:
		inv.currency = currency

	if patient:
		inv.patient = patient

	for it in items:
		row = {
			"item_code": it.get("item_code"),
			"qty": flt(it.get("qty", 1)),
			"rate": flt(it.get("rate", 0.0)),
			"description": it.get("description") or "",
		}
		# optionally include account/cost center if supplied
		if it.get("income_account"):
			row["income_account"] = it.get("income_account")
		if it.get("cost_center"):
			row["cost_center"] = it.get("cost_center")

		inv.append("items", row)

	# Insert as draft (docstatus = 0)
	inv.insert(ignore_permissions=True)
	# Do not submit; leave as draft for review/payment
	return inv


@frappe.whitelist()
def create_appointment_invoices_multi_service(appointment_id, submit_invoice=False):
	"""
	Creates invoice(s) for a Patient Appointment that has multiple service templates.

	Supports:
		- Practitioner-specific prices
		- Self payment or Insurance split (coverage % + deductible)
		- Generates 1 invoice (Self) or 2 invoices (Patient + Insurance)
	"""
	appt = frappe.get_doc("Patient Appointment", appointment_id)
	if not appt.custom_services:
		frappe.throw("Please select at least one service for this appointment.")

	services = appt.service_templates

	created = {"patient_invoice": None, "insurance_invoice": None}

	company = appt.company or frappe.get_single("Global Defaults").default_company
	currency = frappe.db.get_default("currency") or "BHD"

	patient_items = []
	insurance_items = []

	for service_name in services.service:
		if not frappe.db.exists("Healthcare Service Template", service_name):
			frappe.log_error(f"Service template not found: {service_name}", "Appointment Billing")
			continue

		service = frappe.get_doc("Healthcare Service Template", service_name)
		patient = frappe.get_doc("Patient", appt.patient)
		item_code = service.get("item")
		if not item_code:
			frappe.throw(f"Service template {service_name} must have an item_code")

		# Determine price for each service
		price_info = determine_service_price_for_service(appt, service_name)
		price = flt(price_info.get("price", 0.0))
		currency = price_info.get("currency") or currency

		if (appt.custom_payment_type or "").lower().startswith("insur"):
			if not patient.custom_active:
				frappe.throw("Appointment payment_type is Insurance but patient insurance is inactive")
			if not patient.custom_insurance_company_name:
				frappe.throw("Appointment payment_type is Insurance but patient has no insurance_company set")

			if patient.custom_copay_type == 'Amount':
				insurance_share = flt(price - (patient.custom_copay_amount or 0))
				patient_share = flt(patient.custom_copay_amount or 0)
			elif patient.custom_copay_type == 'Percent':
				insurance_share = flt(price * ((100 - patient.custom_copay_percent) / 100.0))
				patient_share = flt(price * (patient.custom_copay_percent / 100.0))

			if patient_share > 0:
				patient_items.append({
					"item_code": item_code,
					"qty": 1,
					"rate": patient_share,
					"description": f"{service.service_name} (Co-pay / Deductible)"
				})

			if insurance_share > 0:
				insurance_items.append({
					"item_code": item_code,
					"qty": 1,
					"rate": insurance_share,
					"description": f"{service.service_name} (Insurance Coverage - {flt(100 - patient.custom_copay_percent)}%)"
				})
		else:
			# Self payment
			patient_items.append({
				"item_code": item_code,
				"qty": 1,
				"rate": price,
				"description": service.service_name
			})

	# --- Create Invoices ---
	if patient_items:
		inv = make_invoice(patient.customer, patient_items, posting_date=nowdate(), company=company, currency=currency, patient=appt.patient)
		created["patient_invoice"] = inv.name
		appt.db_set("sales_invoice_patient", inv.name)
		if submit_invoice:
			inv.submit()

	if insurance_items:
		inv_ins = make_invoice(patient.custom_insurance_company_name, insurance_items, posting_date=nowdate(), company=company, currency=currency, patient=appt.patient)
		created["insurance_invoice"] = inv_ins.name
		appt.db_set("sales_invoice_insurance", inv_ins.name)

	# Set billing status
	if insurance_items and patient_items:
		appt.db_set("billing_status", "Partially Billed")
	elif insurance_items:
		appt.db_set("billing_status", "Insurance Billed")
	elif patient_items:
		appt.db_set("billing_status", "Fully Billed")

	frappe.db.commit()
	return created
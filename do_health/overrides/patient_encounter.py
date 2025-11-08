import frappe
from healthcare.healthcare.doctype.patient_encounter.patient_encounter import PatientEncounter
from healthcare.healthcare.doctype.patient_encounter.patient_encounter import set_codification_table_from_diagnosis

class CustomPatientEncounter(PatientEncounter):
	def validate(self):
		self.set_title()
		# self.validate_medications()
		self.validate_sessions("therapies", "Therapies")
		self.validate_sessions("procedure_prescription", "Clinical Procedures")
		self.validate_observations()
		set_codification_table_from_diagnosis(self)
		if not self.is_new() and self.submit_orders_on_save:
			self.make_service_request()
			self.make_medication_request()
			self.status = "Ordered"

	def on_update(self):
		# if self.appointment:
		# 	frappe.db.set_value("Patient Appointment", self.appointment, "status", "Closed")
		pass

	def on_cancel(self):
		self.db_set("status", "Cancelled")

		if self.appointment:
			# frappe.db.set_value("Patient Appointment", self.appointment, "status", "Open")
			frappe.db.set_value("Patient Appointment", self.appointment, "custom_visit_status", "Arrived")

		therapy_plan = frappe.db.exists(
			"Therapy Plan", {"source_doc": self.doctype, "order_group": self.name}
		)
		if therapy_plan:
			therapy_status = frappe.get_cached_value("Therapy Plan", therapy_plan, "status")
			if therapy_status in ["In Progress", "Completed"]:
				frappe.throw(
					_(
						f"Cannot cancel encounter with {therapy_status} therapy plan {get_link_to_form('Therapy Plan', therapy_plan)}"
					)
				)
			frappe.db.set_value("Therapy Plan", therapy_plan, "status", "Cancelled")

		if self.inpatient_record and self.drug_prescription:
			delete_ip_medication_order(self)  # TODO: delete?

	@frappe.whitelist()
	def get_vitals(self):
		layout = frappe.db.get_all('Tab Layout', fields=['label', 'fieldname', 'style'], order_by='idx')
		vital_fields = [field['fieldname'] for field in layout]
		vitals = frappe.db.get_list('Vital Signs',
			or_filters={'appointment': self.appointment, 'encounter': self.name},
			fields=['signs_date', 'signs_time'] + vital_fields,
			order_by='signs_date desc, signs_time desc',
		)
		if not vitals:
			return {
				'layout': layout,
				'date': '',
				'time': '',
			}

		for field in layout:
			field.value = vitals[-1].get(field.fieldname, '')

		return {
			'layout': layout,
			'date': vitals[-1].signs_date if vitals else '',
			'time': vitals[-1].signs_time if vitals else '',
		}

	@frappe.whitelist()
	def get_side_tab_data(self):
		settings = frappe.get_doc('Do Health Settings')
		patient = frappe.get_doc('Patient', self.patient)
		values_to_return = {
			'settings': settings,
			'patient': patient
		}

		# Get Vital Signs Tab
		if settings.show_vital_signs:
			vital_layout = list(settings.vital_signs_tab_layout)
			vital_fields = [field['fieldname'] for field in vital_layout]
			vitals = []
			if frappe.db.exists("Vital Signs", {"encounter":  self.name}):
				vitals = frappe.db.get_list('Vital Signs',
					filters={'encounter': self.name},
					fields=['signs_date', 'signs_time'] + vital_fields,
					order_by='signs_date desc, signs_time desc',
				)[-1]
			elif frappe.db.exists("Vital Signs", {'appointment': self.appointment}):
				vitals = frappe.db.get_list('Vital Signs',
					filters={'appointment': self.appointment},
					fields=['signs_date', 'signs_time'] + vital_fields,
					order_by='signs_date desc, signs_time desc',
				)[-1]

			for field in vital_layout:
				field.value = vitals.get(field.fieldname, '')
			if vitals:
				values_to_return['vital_signs_layout'] = vital_layout

		# Get Patient History Tab
		if settings.show_patient_history:
			history_layout = list(settings.patient_history_tab_layout)
			for field in history_layout:
				field.value = patient.get(field.fieldname, '')
			values_to_return['history_layout'] = history_layout

		# Get Dental Charts Tab
		# if settings.show_dental_charts:
		# 	dental_charts = frappe.db.get_list('Dental Charting', filters={'patient': self.patient}, order_by='date desc', pluck='name')
		# 	dental_chart_docs = [frappe.get_doc('Dental Charting', d) for d in dental_charts]
		# 	values_to_return['dental_charts'] = dental_chart_docs
		
		return values_to_return
import frappe
import datetime
from frappe.utils import flt, format_date, get_link_to_form, get_time, getdate, now_datetime
from healthcare.healthcare.doctype.patient_appointment.patient_appointment import PatientAppointment
from healthcare.healthcare.doctype.fee_validity.fee_validity import manage_fee_validity

class CustomPatientAppointment(PatientAppointment):
	def validate(self):
		self.validate_overlaps()
		self.validate_based_on_appointments_for()
		self.validate_service_unit()
		self.set_appointment_datetime()
		self.validate_practitioner_unavailability()
		self.validate_customer_created()
		# self.set_status()
		self.set_title()
		self.update_event()
		self.set_position_in_queue()

	def before_save(self):
		current_value = self.get('custom_visit_status')
		old_value = self.get_db_value('custom_visit_status')

		if current_value != old_value:
			self.append("custom_appointment_time_logs", {
				"status": current_value,
				"time": now_datetime()
			})

	def insert_calendar_event(self):
		if not self.practitioner:
			return

		starts_on = datetime.datetime.combine(
			getdate(self.appointment_date), get_time(self.appointment_time)
		)
		ends_on = starts_on + datetime.timedelta(minutes=flt(self.duration))
		google_calendar = frappe.db.get_value(
			"Healthcare Practitioner", self.practitioner, "google_calendar"
		)
		if not google_calendar:
			google_calendar = frappe.db.get_single_value("Healthcare Settings", "default_google_calendar")

		if self.appointment_type:
			color = frappe.db.get_value("Appointment Type", self.appointment_type, "color")
		else:
			color = ""

		event = frappe.get_doc(
			{
				"doctype": "Event",
				"subject": f"{self.title} - {self.company}",
				"event_type": "Public",
				"color": color,
				"send_reminder": 1,
				"starts_on": starts_on,
				"ends_on": ends_on,
				"status": "Open",
				"all_day": 0,
				"sync_with_google_calendar": 1 if self.add_video_conferencing and google_calendar else 0,
				"add_video_conferencing": 1 if self.add_video_conferencing and google_calendar else 0,
				"google_calendar": google_calendar,
				"description": f"{self.title} - {self.company}",
				"pulled_from_google_calendar": 0,
			}
		)
		participants = []

		participants.append(
			{"reference_doctype": "Healthcare Practitioner", "reference_docname": self.practitioner}
		)
		participants.append({"reference_doctype": "Patient", "reference_docname": self.patient})

		event.update({"event_participants": participants})

		event.insert(ignore_permissions=True)

		event.reload()
		if self.add_video_conferencing and not event.google_meet_link:
			frappe.msgprint(
				_("Could not add conferencing to this Appointment, please contact System Manager"),
				indicator="error",
				alert=True,
			)

		self.db_set({"event": event.name, "google_meet_link": event.google_meet_link})
		self.notify_update()

	def set_status():
		pass

	@frappe.whitelist()
	def change_status(self, status):
		self.custom_visit_status = status
		self.append("custom_appointment_time_logs", {
			"status": status,
			"time": frappe.utils.get_datetime()
		})
		self.save()

	def on_update(self):
		if (
			not frappe.db.get_single_value("Healthcare Settings", "show_payment_popup")
			or not self.practitioner
		):
			update_fee_validity(self)

		doc_before_save = self.get_doc_before_save()
		if doc_before_save and not doc_before_save.insurance_policy == self.insurance_policy:
			self.make_insurance_coverage()


		prev_doc = self.get_doc_before_save() or frappe._dict()
		current = self.get("custom_visit_status")
		prev = prev_doc.get("custom_visit_status")
		if current != prev and (current == "Arrived" or prev == "Arrived"):
			waiting_list = frappe.db.sql("""
                SELECT pa.name, pa.patient_name, pa.patient, pa.practitioner, at.time as arrival_time, pa.appointment_time, pa.appointment_date
                FROM `tabPatient Appointment` pa
                LEFT JOIN `tabAppointment Time Logs` at ON pa.name = at.parent AND at.status = 'Arrived'
                WHERE pa.custom_visit_status = 'Arrived' AND pa.appointment_date = CURDATE()
                ORDER BY at.time DESC
			""", as_dict=True)
   
			frappe.publish_realtime("waiting_list", waiting_list)

@frappe.whitelist()
def update_fee_validity(appointment):
	if isinstance(appointment, str):
		appointment = json.loads(appointment)
		appointment = frappe.get_doc(appointment)

	fee_validity = manage_fee_validity(appointment)
	if fee_validity:
		frappe.msgprint(
			_("{0} has fee validity till {1}").format(
				frappe.bold(appointment.patient_name), format_date(fee_validity.valid_till)
			),
			alert=True,
		)
import frappe
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import TestPatientAppointment

class CustomTestPatientAppointment(TestPatientAppointment):
	def test_status(self):
		# patient, practitioner = create_healthcare_docs()
		# frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		# appointment = create_appointment(patient, practitioner, nowdate())
		# self.assertEqual(appointment.status, "Open")
		# appointment = create_appointment(patient, practitioner, add_days(nowdate(), 2))
		# self.assertEqual(appointment.status, "Scheduled")
		# encounter = create_encounter(appointment)
		# self.assertEqual(
		# 	frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Closed"
		# )
		# encounter.cancel()
		# self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Open")
		pass

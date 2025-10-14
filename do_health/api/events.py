import frappe
import datetime

def patient_update(doc, method=None):
    frappe.publish_realtime("patient_updated", doc)

def medication_request_update(doc, method=None):
    frappe.publish_realtime("medication_request_updated", doc)

def patient_appointment_inserted(doc, method=None):
    if doc.status == 'Walked In':
        doc.custom_visit_status = 'Arrived'
        doc.append("custom_appointment_time_logs", {
            "status": 'Arrived',
            "time": datetime.datetime.now()
        })
        doc.save()
        # frappe.db.set_value("Patient Appointment", doc.appointment, "custom_visit_status", "Arrived")

def patient_encounter_inserted(doc, method=None):
    if doc.appointment:
        # appointment = frappe.get_doc('Patient Appointment', doc.appointment)
        # appointment.custom_visit_status = 'In Room'
        # appointment.append("custom_appointment_time_logs", {
        #     "status": 'In Room',
        #     "time": datetime.datetime.now()
        # })
        # appointment.save()
        frappe.db.set_value("Patient Appointment", doc.appointment, "custom_visit_status", "In Room")

def patient_encounter_update(doc, method=None):
    frappe.publish_realtime("patient_encounter_updated", doc)

def patient_encounter_submit(doc, method=None):
    if doc.appointment:
        # appointment = frappe.get_doc('Patient Appointment', doc.appointment)
        # appointment.custom_visit_status = 'Completed'
        # appointment.append("custom_appointment_time_logs", {
        #     "status": 'Completed',
        #     "time": datetime.datetime.now()
        # })
        # appointment.save()
        frappe.db.set_value("Patient Appointment", doc.appointment, "custom_visit_status", "Completed")
    frappe.publish_realtime("patient_encounter_updated", doc)

def clinical_procedure_update(doc, method=None):
    frappe.publish_realtime("clinical_procedure_updated", doc)
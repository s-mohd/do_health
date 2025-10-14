frappe.listview_settings['Patient Appointment'] = {
	hide_name_column: true,
	add_fields: ["patient_name", "appointment_date", "appointment_time", "practitioner", "custom_visit_status"],
	get_indicator: function(doc) {
		var colors = {
			"Scheduled": "grey",
			"No Show": "pink",
			"Arrived": "orange",
			"Ready": "lightgreen",
			"In Room": "yellow",
			"Transfered": "blue",
			"Completed": "green",
			"Cancelled": "red"
		};
		return [__(doc.custom_visit_status), colors[doc.custom_visit_status], "custom_visit_status,=," + doc.custom_visit_status];
	}
};
// Copyright (c) 2016, ESS LLP and contributors
// For license information, please see license.txt
frappe.provide('erpnext.queries');
frappe.ui.form.on('Patient Appointment', {
	setup: function (frm) {
		frm.custom_make_buttons = {
			'Vital Signs': 'Vital Signs',
			'Patient Encounter': 'Patient Encounter'
		};
	},

	onload: function (frm) {
		if (frm.is_new()) {
			// frm.set_value('appointment_time', null);
			frm.disable_save();
			if (frm.doc.appointment_timeo) {
				frm.set_value('appointment_time', frm.doc.appointment_timeo);
			}
		}
	},

	refresh: function (frm) {
		frm.set_query('patient', function () {
			return {
				filters: { 'status': 'Active' }
			};
		});

		// frm.set_query('practitioner', function () {
		// 	if (frm.doc.department) {
		// 		return {
		// 			filters: {
		// 				'department': frm.doc.department
		// 			}
		// 		};
		// 	}
		// });

		frm.set_query('service_unit', function () {
			return {
				query: 'healthcare.controllers.queries.get_healthcare_service_units',
				filters: {
					company: frm.doc.company,
					inpatient_record: frm.doc.inpatient_record,
					allow_appointments: 1,
				}
			};
		});

		frm.set_query('therapy_plan', function () {
			return {
				filters: {
					'patient': frm.doc.patient
				}
			};
		});

		frm.set_query('service_request', function () {
			return {
				filters: {
					'patient': frm.doc.patient,
					'status': 'Active',
					'docstatus': 1,
					'template_dt': ['in', ['Clinical Procedure', 'Therapy Type']]
				}
			};
		});

		frm.trigger('set_therapy_type_filter');

		if (frm.is_new()) {
			frm.page.clear_primary_action();
			if (frm.doc.appointment_for) {
				frm.trigger('appointment_for');
			}
		} else {
			frm.page.set_primary_action(__('Save'), () => frm.save());

			let status = ['Scheduled', 'No Show', 'Arrived', 'Ready', 'In Room', 'Transferred', 'Completed', 'Cancelled'];
			for (let i = 0; i < status.length; i++) {
				if (frm.doc.custom_visit_status != status[i]) {
					frm.add_custom_button(__(status[i]), function () {
						frm.call({
							method: 'change_status',
							doc: frm.doc,
							freeze: true,
							freeze_message: __('Updating Status...'),
							args: { status: status[i] },
							callback: function (r) {
								frm.refresh();
							}
						});
					}, __('Set Status'));
				}
			}
		}

		// if (frm.doc.patient) {
		// 	frm.add_custom_button(__('Appointments'), function () {
		// 		frappe.call({
		// 			method: 'frappe.client.get_list',
		// 			args: {
		// 				doctype: 'Patient Appointment',
		// 				filters: { 'patient': frm.doc.patient },
		// 				fields: ['name', 'notes', 'appointment_date', 'practitioner', 'status', 'appointment_time'],
		// 				order_by: 'appointment_date desc, appointment_time desc',
		// 				limit_page_length: 0
		// 			},
		// 			callback: function (r) {
		// 				if (r.message) {
		// 					var content = $(`
		// 						<div>
		// 							<table id="history-appts" class="table table-hover table-condensed">
		// 							<thead>
		// 								<tr>
		// 								<th class="small">Provider</th>
		// 								<th class="small">Date</th>
		// 								<th class="small">Time</th>
		// 								<th class="small">Note</th>
		// 								<th class="small"></th>
		// 								<th class="small">
		// 									<button class="btn btn-primary btn-xs" id="new-appt">new</button>
		// 								</th>
		// 								</tr>
		// 							</thead>
		// 							</table>
		// 						</div>
		// 					`);

		// 					var rows = '';
		// 					$.each(r.message, function (i, d) {
		// 						rows += `
		// 						<tr style="${moment(d.appointment_date).isAfter(moment(), 'day') ? 'background-color: rgba(0, 110, 255, 0.05);'
		// 								: moment(d.appointment_date).isSame(moment(), 'day') ? 'background-color: rgba(255, 255, 0, 0.05);' : ''}">
		// 							<td class="small" style="white-space: nowrap;">
		// 								${d.practitioner}
		// 							</td>
		// 							<td class="small" style="${moment(d.appointment_date).isAfter(moment(), 'day') ? 'color:blue;' : ''} white-space: nowrap;">
		// 								<span class="">${moment(d.appointment_date).isSame(moment(), 'day') ?
		// 								'Today' : moment(d.appointment_date).lang("en").format('ddd Do MMM YYYY').replace(/(\d)(st|nd|rd|th)/g, '$1<sup>$2</sup>')}</span>
		// 							</td>
		// 							<td class="small">
		// 								${moment(d.appointment_time, 'HH:mm:ss').lang("en").format('h:mma')}
		// 							</td>
		// 							<td class="small">
		// 								${d.notes}
		// 							</td>
		// 							<td class="small" style="white-space: nowrap;">
		// 								<span class="small">${d.status}</span>
		// 							</td>
		// 							<td class="small"><button class="btn btn-primary btn-xs"
		// 								onclick="frappe.set_route('Form', 'Patient Appointment', '${d.name}');cur_dialog.cancel();">view</button></td>
		// 						</tr>
		// 						`;

		// 					});
		// 					content.find('#history-appts').append(`<tbody>${rows}</tbody>`);
		// 					frappe.msgprint(content.html(), `Appointments History`);

		// 					$('.modal-dialog').width(850);
		// 					$('.modal-content').css('min-width', 850);
		// 					$('#new-appt').on('click', function () {
		// 						sessionStorage.selected_appt = JSON.stringify({
		// 							customer: frm.doc.customer,
		// 							new: 1
		// 						});
		// 						cur_dialog.cancel();
		// 						frappe.set_route('List', 'Patint Appointment', 'Calendar');
		// 					});

		// 				} else {
		// 					frappe.msgprint('No appointments found for this patient')
		// 				}

		// 			}
		// 		});
		// 	}, __('View History'));

		// 	frm.add_custom_button(__('Prescriptions'), function () {
		// 		frappe.call({
		// 			method: "temr.api.get_prescription_appointment",
		// 			args: {
		// 				patient: frm.doc.patient
		// 			},
		// 			callback: function (r) {
		// 				if (r.message) {
		// 					console.log('ok1')
		// 					var content = $(`
		// 									<div>
		// 										<table id="history-prescriptions" class="table table-hover table-condensed">
		// 										<thead>
		// 										 <tr>
		// 										   <th class="small">Date</th>
		// 										   <th class="small">Prescription</th>
		// 										   <th class="small">Status</th>
		// 										   <th class="small">Medications</th>
		// 										 </tr>
		// 										</thead>
		// 										</table>
		// 									</div>
		// 					`);
		// 					console.log('ok2')

		// 					var rows = '';
		// 					r.message.sort(function (a, b) {
		// 						var medicine = ""
		// 						console.log(b)
		// 						for (var count = 0; count < b.items.length; count++) {
		// 							medicine += b.items[count].medicine + "<br>"

		// 						}
		// 						var date_a = moment(a.date);
		// 						var date_b = moment(b.date);

		// 						if (date_a.isSame(date_b, 'day')) { return 0 }
		// 						if (date_a.isBefore(date_b, 'day')) { return 1 }
		// 						if (date_a.isAfter(date_b, 'day')) { return -1 }

		// 					});
		// 					console.log('ok3')
		// 					$.each(r.message, function (i, d) {
		// 						var medicine = ""
		// 						for (var count = 0; count < d.items.length; count++) {
		// 							medicine += d.items[count].medicine + "<br>"

		// 						}
		// 						rows += `
		// 						<tr>
		// 							<td class="small" style="white-space: nowrap;">
		// 							<span class="">${moment(d.date).isSame(moment(), 'day') ?
		// 								'Today' : moment(d.date).lang("en").format('ddd Do MMM YYYY').replace(/(\d)(st|nd|rd|th)/g, '$1<sup>$2</sup>')}</span>
		// 							</td>
		// 							<td class="small" style="white-space: nowrap;">
		// 								${d.name}
		// 							</td>
		// 							<td class="small">
		// 								${d.dispensed ? d.dispensed : ''}
		// 							</td>
		// 							<td class="small" id="${d.name}-list">
		// 							${medicine}
		// 							</td>
		// 							<td class="small"><button class="btn btn-primary btn-xs"
		// 								onclick="frappe.set_route('Form', 'Prescription', '${d.name}');cur_dialog.cancel();">view</button>
		// 							</td>
		// 						</tr>
		// 						`;

		// 					});
		// 					console.log('ok4')
		// 					content.find('#history-prescriptions').append(`<tbody>${rows}</tbody>`);
		// 					frappe.msgprint(content.html(), `Prescriptions History`);
		// 					$('#new-prescription').on('click', function () {
		// 						var prescription = frappe.model.get_new_doc("Prescription");
		// 						prescription.patient = frm.doc.customer;
		// 						prescription.pharmacy = 'Derma One Pharmacy';

		// 						frappe.run_serially([
		// 							() => frappe.set_route('Form', 'Prescription', prescription.name),
		// 							() => $('.grid-add-row').click(),
		// 							() => $('[data-fieldname="medication"].bold').click().focus(),
		// 						]);
		// 					});
		// 					console.log('ok5')
		// 					$('.modal-dialog').width(850);


		// 				} else {
		// 					frappe.msgprint('No prescriptions found for this patient')
		// 				}
		// 			}
		// 		});
		// 	}, __('View History'));
		// 	//-----------------------------
		// }

		// if (!(frappe.user.full_name() == 'Dr Sadiq Abdulla' || frappe.user.full_name() == 'Dr Nedhal Khalifa' || frappe.user.full_name() == 'Dr Amani Gamaledeen' || frappe.user.full_name() == 'Administrator')) {
		// 	frm.add_custom_button(__('Appointment cancellation'), function () {
		// 		var number = frm.doc.mobile.replace('+', '').replace(' ', '');
		// 		// var patient = frm.doc.customer;
		// 		var patient = frm.doc.patient_name
		// 		//patient = patient.charAt(0).toUpperCase() + patient.substr(1).toLowerCase();
		// 		var date = moment(frm.doc.date).lang("en").format('Do MMMM');
		// 		var time = moment(frm.doc.from_time, 'HH:mm:ss').lang("en").format('h:mma');
		// 		var message = `Dear ${patient}, your appointment with Derma One on ${date} was unfortunately cancelled.  Kindly, call us on 17240042 to rebook.`;
		// 		frappe.prompt(
		// 			[{
		// 				'fieldname': 'message', 'fieldtype': 'Data', 'label': 'SMS Message', 'reqd': 1,
		// 				'default': message
		// 			}],
		// 			function (values) {
		// 				frappe.call({
		// 					method: 'frappe.core.doctype.sms_settings.sms_settings.send_sms',
		// 					args: {
		// 						receiver_list: [number],
		// 						msg: values.message,

		// 					},
		// 					callback: function (r) {
		// 						if (r.exc) {
		// 							frappe.msgprint(r.exc);
		// 							return;
		// 						}
		// 						// frm.set_value('status', 'Cancelled');
		// 						// frm.set_value('sms_nofitication', 'SMS Canelled');
		// 						frappe.db.set_value(frm.doc.doctype, frm.doc.name, 'status', 'Cancelled')
		// 						frappe.db.set_value(frm.doc.doctype, frm.doc.name, 'sms_nofitication', 'SMS Canelled')
		// 						frm.timeline.insert_comment('Updated', `Sent SMS: ${values.message}`);
		// 					}
		// 				});
		// 			},
		// 			`Send custome message to ${patient}`,
		// 			'Send'
		// 		);
		// 	}, __('Send SMS'));
		// 	frm.add_custom_button(__('Google Maps location'), function () {
		// 		var number = frm.doc.mobile.replace('+', '').replace(' ', '');
		// 		// var patient = frm.doc.customer;
		// 		var patient = frm.doc.patient_name
		// 		//patient = patient.charAt(0).toUpperCase() + patient.substr(1).toLowerCase();
		// 		var date = moment(frm.doc.date).lang("en").format('Do MMMM');
		// 		var time = moment(frm.doc.from_time, 'HH:mm:ss').lang("en").format('h:mma');
		// 		var message = `Derma One Location: https://goo.gl/maps/AegrDtxxJsS2. Or call us 17240042.`;
		// 		frappe.prompt(
		// 			[{
		// 				'fieldname': 'message', 'fieldtype': 'Data', 'label': 'SMS Message', 'reqd': 1,
		// 				'default': message
		// 			}],
		// 			function (values) {
		// 				frappe.call({
		// 					method: 'frappe.core.doctype.sms_settings.sms_settings.send_sms',
		// 					args: {
		// 						receiver_list: [number],
		// 						msg: values.message,
		// 					},
		// 					callback: function (r) {
		// 						if (r.exc) {
		// 							frappe.msgprint(r.exc);
		// 							return;
		// 						}
		// 						frm.timeline.insert_comment('Updated', `Sent SMS: ${values.message}`);
		// 					}
		// 				});
		// 			},
		// 			`Send custome message to ${patient}`,
		// 			'Send'
		// 		);
		// 	}, __('Send SMS'));

		// 	frm.add_custom_button(__('Custom message'), function () {
		// 		var number = frm.doc.mobile.replace('+', '').replace(' ', '');
		// 		// var patient = frm.doc.customer.split(' ')[0];
		// 		// patient = patient.charAt(0).toUpperCase() + patient.substr(1).toLowerCase();
		// 		var patient = frm.doc.patient_name
		// 		var date = moment(frm.doc.date).lang("en").format('Do MMMM');
		// 		var time = moment(frm.doc.from_time, 'HH:mm:ss').lang("en").format('h:mma');
		// 		var message = `Dear ${patient}, your appointment with Derma One on ${date} is at ${time}.  Kindly, call us on 17240042 to confirm.`;
		// 		frappe.prompt(
		// 			[{
		// 				'fieldname': 'message', 'fieldtype': 'Data', 'label': 'SMS Message', 'reqd': 1,
		// 				'default': message
		// 			}],
		// 			function (values) {
		// 				frappe.call({
		// 					method: 'frappe.core.doctype.sms_settings.sms_settings.send_sms',
		// 					args: {
		// 						receiver_list: [number],
		// 						msg: values.message,

		// 					},
		// 					callback: function (r) {
		// 						if (r.exc) {
		// 							frappe.msgprint(r.exc);
		// 							return;
		// 						}
		// 						// frm.set_value('status', 'SMS Reminder');
		// 						frappe.db.set_value(frm.doc.doctype, frm.doc.name, 'status', 'SMS Reminder')
		// 						frm.timeline.insert_comment('Updated', `Sent SMS: ${values.message}`);
		// 					}
		// 				});
		// 			},
		// 			`Send custome message to ${patient}`,
		// 			'Send'
		// 		);
		// 	}, __('Send SMS'));

		// 	frm.page.set_inner_btn_group_as_primary(__('Send SMS'));

		// 	frm.add_custom_button(__('Payment'), function () {
		// 		frappe.run_serially([
		// 			() => frappe.route_options = {},
		// 			() => frappe.set_route('Form', 'sales-invoice', { customer: frm.doc.customer_id, practitioner: frm.doc.practitioner, patient: frm.doc.patient }), // loay change
		// 		]);
		// 	});

		// }

		// if (frappe.user.full_name() == 'Dr Sadiq Abdulla' || frappe.user.full_name() == 'Dr Nedhal Khalifa' || frappe.user.full_name() == 'Dr Amani Gamaledeen' || frappe.user.full_name() == 'Administrator') {
		// 	frm.add_custom_button(__('Prescription'), function () {
		// 		var prescription = frappe.model.get_new_doc("Prescription");
		// 		prescription.patient = frm.doc.patient;
		// 		prescription.letter_head = 'DermaOne Letter Head';
		// 		if (frm.doc.provider == 'Walk-in SC') {
		// 			prescription.provider = 'Dr Sadiq'
		// 		} else if (frm.doc.provider == 'Walk-in DO') {
		// 			prescription.provider = 'Dr Nedhal'
		// 		} else {
		// 			prescription.provider = frm.doc.provider;
		// 		}
		// 		prescription.pharmacy = 'Derma One Pharmacy';
		// 		if (frappe.user.full_name() == 'Dr Sadiq Abdulla' || frappe.user.full_name() == 'Dr Amani Gamaledeen') {
		// 			prescription.letter_head = 'Standard SurgiCare';
		// 		}
		// 		// console.log ("------ result ---- ");
		// 		frappe.run_serially([
		// 			() => frappe.set_route('Form', 'Prescription', prescription.name),
		// 			() => $('.grid-add-row').click(),
		// 			() => $('[data-fieldname="medication"].bold').click().focus(),
		// 			// () => $('input[data-fieldname="customer"]').val(frappe.route_options.customer).focus(),
		// 		]);
		// 	});
		// }

		// if (!(["Cancelled", "Completed"].includes(frm.doc.custom_visit_status)) || (frm.doc.custom_visit_status == 'Scheduled' && !frm.doc.__islocal)) {
		// 	frm.add_custom_button(__('Reschedule'), function () {
		// 		check_and_set_availability(frm);
		// 	});

		// 	if (frm.doc.procedure_template) {
		// 		frm.add_custom_button(__('Clinical Procedure'), function () {
		// 			frappe.model.open_mapped_doc({
		// 				method: 'healthcare.healthcare.doctype.clinical_procedure.clinical_procedure.make_procedure',
		// 				frm: frm,
		// 			});
		// 		}, __('Create'));
		// 	} else if (frm.doc.therapy_type) {
		// 		frm.add_custom_button(__('Therapy Session'), function () {
		// 			frappe.model.open_mapped_doc({
		// 				method: 'healthcare.healthcare.doctype.therapy_session.therapy_session.create_therapy_session',
		// 				frm: frm,
		// 			})
		// 		}, 'Create');
		// 	} else {
		// 		frm.add_custom_button(__('Patient Encounter'), function () {
		// 			frappe.model.open_mapped_doc({
		// 				method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.make_encounter',
		// 				frm: frm,
		// 			});
		// 		}, __('Create'));
		// 	}

		// 	frm.add_custom_button(__('Vital Signs'), function () {
		// 		create_vital_signs(frm);
		// 	}, __('Create'));
		// }

		// frm.trigger("make_invoice_button");

	},

	after_save: function (frm, cdt, cdn) {
		var not_iPad = navigator.userAgent.match(/iPad/i) == null;
		if (not_iPad && frm.doc.date) {
			// console.log("not ipad ");
			sessionStorage.selected_date = moment(frm.doc.date + ' ' + frm.doc.from_time);
			if (!moment(sessionStorage.selected_date).isValid()) {
				sessionStorage.selected_date = moment();
			}

		}
		if (frappe.user.full_name() == 'Dr Sadiq Abdulla' || frappe.user.full_name() == 'Dr Nedhal Khalifa' || frappe.user.full_name() == 'Administrator') {
			// console.log(" full name " + frappe.user.full_name());
		} else {
			sessionStorage.selected_appt = '';
			frappe.set_route('List/Patient Appointment/Calendar');
			// console.log("go to calendar ");
		}

	},
	resource: function (frm, cdt, cdn) {
		var appointment = frappe.model.get_doc(cdt, cdn);
		frappe.call({
			method: 'frappe.client.get',
			args: {
				doctype: 'Healthcare Practitioner',
				name: appointment.resource
			},
			callback: function (res) {
				frappe.model.set_value(cdt, cdn, 'color', res.message.color);
				frappe.model.set_value(cdt, cdn, 'font', res.message.font);
			}

		});
	},
	customer: function (frm, cdt, cdn) {
		var appointment = frappe.model.get_doc(cdt, cdn);
		if (appointment.customer) {
			frappe.call({
				method: 'frappe.client.get',
				args: {
					doctype: 'Customer',
					name: appointment.customer
				},
				callback: function (res) {
					frappe.model.set_value(cdt, cdn, 'image', res.message.image);
				}
			});
		}
	},
	appointment_status: function (frm, cdt, cdn) {
		var appointment = frappe.model.get_doc(cdt, cdn);
		if (appointment.appointment_status == 'Completed') {
			frappe.model.set_value(cdt, cdn, 'status', 'Done');
		}
	}
});

check_and_set_availability = function (frm) {
	let selected_slot = null;
	let service_unit = null;
	let duration = null;
	let add_video_conferencing = null;
	let overlap_appointments = null;
	let appointment_based_on_check_in = false;

	show_availability();

	function show_empty_state(practitioner, appointment_date) {
		frappe.msgprint({
			title: __('Not Available'),
			message: __('Healthcare Practitioner {0} not available on {1}', [practitioner.bold(), appointment_date.bold()]),
			indicator: 'red'
		});
	}

	function show_availability() {
		let selected_practitioner = '';
		let d = new frappe.ui.Dialog({
			title: __('Available slots'),
			fields: [
				{ fieldtype: 'Link', options: 'Healthcare Practitioner', reqd: 1, fieldname: 'practitioner', label: 'Healthcare Practitioner' },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Date', reqd: 1, fieldname: 'appointment_date', label: 'Date', min_date: new Date(frappe.datetime.get_today()) },
				{ fieldtype: 'Section Break' },
				{ fieldtype: 'HTML', fieldname: 'available_slots' },
			],
			primary_action_label: __('Book'),
			primary_action: async function () {
				frm.set_value('appointment_time', selected_slot);
				add_video_conferencing = add_video_conferencing && !d.$wrapper.find(".opt-out-check").is(":checked")
					&& !overlap_appointments

				frm.set_value('add_video_conferencing', add_video_conferencing);
				if (!frm.doc.duration) {
					frm.set_value('duration', duration);
				}
				let practitioner = frm.doc.practitioner;

				frm.set_value('practitioner', d.get_value('practitioner'));
				frm.set_value('appointment_date', d.get_value('appointment_date'));
				frm.set_value('appointment_based_on_check_in', appointment_based_on_check_in)

				if (service_unit) {
					frm.set_value('service_unit', service_unit);
				}

				d.hide();
				frm.enable_save();
				await frm.save();
				if (!frm.is_new() && (!practitioner || practitioner == d.get_value('practitioner'))) {
					await frappe.db.get_single_value("Healthcare Settings", "show_payment_popup").then(val => {
						frappe.call({
							method: "healthcare.healthcare.doctype.fee_validity.fee_validity.check_fee_validity",
							args: { "appointment": frm.doc },
							callback: (r) => {
								if (val && !r.message && !frm.doc.invoiced) {
									make_payment(frm, val);
								} else {
									frappe.call({
										method: "healthcare.healthcare.doctype.patient_appointment.patient_appointment.update_fee_validity",
										args: { "appointment": frm.doc }
									});
								}
							}
						});
					});
				}
				d.get_primary_btn().attr('disabled', true);
			}
		});

		d.set_values({
			'practitioner': frm.doc.practitioner,
			'appointment_date': frm.doc.appointment_date,
		});

		// disable dialog action initially
		d.get_primary_btn().attr('disabled', true);

		// Field Change Handler

		let fd = d.fields_dict;

		d.fields_dict['appointment_date'].df.onchange = () => {
			show_slots(d, fd);
		};
		d.fields_dict['practitioner'].df.onchange = () => {
			if (d.get_value('practitioner') && d.get_value('practitioner') != selected_practitioner) {
				selected_practitioner = d.get_value('practitioner');
				show_slots(d, fd);
			}
		};

		d.show();
	}

	function show_slots(d, fd) {
		if (d.get_value('appointment_date') && d.get_value('practitioner')) {
			fd.available_slots.html('');
			frappe.call({
				method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.get_availability_data',
				args: {
					practitioner: d.get_value('practitioner'),
					date: d.get_value('appointment_date'),
					appointment: frm.doc
				},
				callback: (r) => {
					let data = r.message;
					if (data.slot_details.length > 0) {
						let $wrapper = d.fields_dict.available_slots.$wrapper;

						// make buttons for each slot
						let slot_html = get_slots(data.slot_details, data.fee_validity, d.get_value('appointment_date'));

						$wrapper
							.css('margin-bottom', 0)
							.addClass('text-center')
							.html(slot_html);

						// highlight button when clicked
						$wrapper.on('click', 'button', function () {
							let $btn = $(this);
							$wrapper.find('button').removeClass('btn-outline-primary');
							$btn.addClass('btn-outline-primary');
							selected_slot = $btn.attr('data-name');
							service_unit = $btn.attr('data-service-unit');
							appointment_based_on_check_in = $btn.attr('data-day-appointment');
							duration = $btn.attr('data-duration');
							add_video_conferencing = parseInt($btn.attr('data-tele-conf'));
							overlap_appointments = parseInt($btn.attr('data-overlap-appointments'));
							// show option to opt out of tele conferencing
							if ($btn.attr('data-tele-conf') == 1) {
								if (d.$wrapper.find(".opt-out-conf-div").length) {
									d.$wrapper.find(".opt-out-conf-div").show();
								} else {
									overlap_appointments ?
										d.footer.prepend(
											`<div class="opt-out-conf-div ellipsis text-muted" style="vertical-align:text-bottom;">
												<label>
													<span class="label-area">
													${__("Video Conferencing disabled for group consultations")}
													</span>
												</label>
											</div>`
										)
										:
										d.footer.prepend(
											`<div class="opt-out-conf-div ellipsis" style="vertical-align:text-bottom;">
											<label>
												<input type="checkbox" class="opt-out-check"/>
												<span class="label-area">
												${__("Do not add Video Conferencing")}
												</span>
											</label>
										</div>`
										);
								}
							} else {
								d.$wrapper.find(".opt-out-conf-div").hide();
							}

							// enable primary action 'Book'
							d.get_primary_btn().attr('disabled', null);
						});

					} else {
						//	fd.available_slots.html('Please select a valid date.'.bold())
						show_empty_state(d.get_value('practitioner'), d.get_value('appointment_date'));
					}
				},
				freeze: true,
				freeze_message: __('Fetching Schedule...')
			});
		} else {
			fd.available_slots.html(__('Appointment date and Healthcare Practitioner are Mandatory').bold());
		}
	}

	function get_slots(slot_details, fee_validity, appointment_date) {
		let slot_html = '';
		let appointment_count = 0;
		let disabled = false;
		let start_str, slot_start_time, slot_end_time, interval, count, count_class, tool_tip, available_slots;

		slot_details.forEach((slot_info) => {
			slot_html += `<div class="slot-info">`;
			if (fee_validity && fee_validity != 'Disabled') {
				slot_html += `
					<span style="color:green">
					${__('Patient has fee validity till')} <b>${moment(fee_validity.valid_till).format('DD-MM-YYYY')}</b>
					</span><br>`;
			} else if (fee_validity != 'Disabled') {
				slot_html += `
					<span style="color:red">
					${__('Patient has no fee validity')}
					</span><br>`;
			}

			slot_html += `
				<span><b>
				${__('Practitioner Schedule: ')} </b> ${slot_info.slot_name}
					${slot_info.tele_conf && !slot_info.allow_overlap ? '<i class="fa fa-video-camera fa-1x" aria-hidden="true"></i>' : ''}
				</span><br>
				<span><b> ${__('Service Unit: ')} </b> ${slot_info.service_unit}</span>`;
			if (slot_info.service_unit_capacity) {
				slot_html += `<br><span> <b> ${__('Maximum Capacity:')} </b> ${slot_info.service_unit_capacity} </span>`;
			}

			slot_html += '</div><br>';

			slot_html += slot_info.avail_slot.map(slot => {
				appointment_count = 0;
				disabled = false;
				count_class = tool_tip = '';
				start_str = slot.from_time;
				slot_start_time = moment(slot.from_time, 'HH:mm:ss');
				slot_end_time = moment(slot.to_time, 'HH:mm:ss');
				interval = (slot_end_time - slot_start_time) / 60000 | 0;

				// restrict past slots based on the current time.
				let now = moment();
				let booked_moment = ""
				if ((now.format("YYYY-MM-DD") == appointment_date) && (slot_start_time.isBefore(now) && !slot.maximum_appointments)) {
					disabled = true;
				} else {
					// iterate in all booked appointments, update the start time and duration
					slot_info.appointments.forEach((booked) => {
						booked_moment = moment(booked.appointment_time, 'HH:mm:ss');
						let end_time = booked_moment.clone().add(booked.duration, 'minutes');

						// to get apointment count for all day appointments
						if (slot.maximum_appointments) {
							if (booked.appointment_date == appointment_date) {
								appointment_count++;
							}
						}
						// Deal with 0 duration appointments
						if (booked_moment.isSame(slot_start_time) || booked_moment.isBetween(slot_start_time, slot_end_time)) {
							if (booked.duration == 0) {
								disabled = true;
								return false;
							}
						}

						// Check for overlaps considering appointment duration
						if (slot_info.allow_overlap != 1) {
							if (slot_start_time.isBefore(end_time) && slot_end_time.isAfter(booked_moment)) {
								// There is an overlap
								disabled = true;
								return false;
							}
						} else {
							if (slot_start_time.isBefore(end_time) && slot_end_time.isAfter(booked_moment)) {
								appointment_count++;
							}
							if (appointment_count >= slot_info.service_unit_capacity) {
								// There is an overlap
								disabled = true;
								return false;
							}
						}
					});
				}
				if (slot_info.allow_overlap == 1 && slot_info.service_unit_capacity > 1) {
					available_slots = slot_info.service_unit_capacity - appointment_count;
					count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
					count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
					tool_tip = `${available_slots} ${__('slots available for booking')}`;
				}

				if (slot.maximum_appointments) {
					if (appointment_count >= slot.maximum_appointments) {
						disabled = true;
					}
					else {
						disabled = false;
					}
					available_slots = slot.maximum_appointments - appointment_count;
					count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
					count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
					return `<button class="btn btn-secondary" data-name=${start_str}
								data-service-unit="${slot_info.service_unit || ''}"
								data-day-appointment=${1}
								data-duration=${slot.duration}
								${disabled ? 'disabled="disabled"' : ""}>${slot.from_time} -
								${slot.to_time} ${slot.maximum_appointments ?
							`<br><span class='badge ${count_class}'>${count} </span>` : ''}</button>`
				} else {

					return `
							<button class="btn btn-secondary" data-name=${start_str}
								data-duration=${interval}
								data-service-unit="${slot_info.service_unit || ''}"
								data-tele-conf="${slot_info.tele_conf || 0}"
								data-overlap-appointments="${slot_info.service_unit_capacity || 0}"
								style="margin: 0 10px 10px 0; width: auto;" ${disabled ? 'disabled="disabled"' : ""}
								data-toggle="tooltip" title="${tool_tip || ''}">
								${start_str.substring(0, start_str.length - 3)}
								${slot_info.service_unit_capacity ? `<br><span class='badge ${count_class}'> ${count} </span>` : ''}
							</button>`;

				}
			}).join("");

			if (slot_info.service_unit_capacity) {
				slot_html += `<br/><small>${__('Each slot indicates the capacity currently available for booking')}</small>`;
			}
			slot_html += `<br/><br/>`;

		});

		return slot_html;
	}
};

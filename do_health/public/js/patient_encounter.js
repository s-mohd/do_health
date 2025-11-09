frappe.provide('do_health.encounter_sidebar');

do_health.encounter_sidebar = {
	_render_lock: {},

	async init(frm) {
		const doctype = frm.doctype;
		const name = frm.doc.name;
		const key = `${doctype}-${name}`;

		// Cancel any pending render for this form
		if (this._render_lock?.[key]) {
			clearTimeout(this._render_lock[key]);
		} else if (!this._render_lock) {
			this._render_lock = {};
		}

		// Debounce rendering to prevent race conditions
		this._render_lock[key] = setTimeout(async () => {
			const $wrapper = $(frm.$wrapper);
			$wrapper.find('.offcanvas-wrapper').remove();

			if (!frm.doc.patient) return;
			if (frm._sidebar_initialized) return;
			frm._sidebar_initialized = true;

			frappe.dom.freeze('Loading sidebar...');
			try {
				const settings = await frappe.db.get_doc('Do Health Settings');
				frappe.dom.unfreeze();
				this.build_sidebar(frm, $wrapper, settings);
			} catch (e) {
				frappe.dom.unfreeze();
				frappe.msgprint(__('Failed to load Do Health Settings: ') + e.message);
			}
		}, 200);
	},

	build_sidebar(frm, $wrapper, settings) {
		const html = `
            <div class="offcanvas-wrapper">
                <div class="vertical-tabs-container"></div>
                <div class="custom-offcanvas">
                    <div class="offcanvas-overlay"></div>
                    <div class="offcanvas-sidebar">
                        <div class="offcanvas-header">
                            <h5 class="offcanvas-title"></h5>
                            <button type="button" class="btn-edit btn btn-default icon-btn">Edit</button>
                            <button type="button" class="btn-close"><i class="fa fa-times"></i></button>
                        </div>
                        <div class="offcanvas-body"></div>
                    </div>
                </div>
            </div>`;
		const $offcanvasWrapper = $(html).appendTo($wrapper);

		const tabs = [];

		// --- Vital Signs Tab
		if (settings.show_vital_signs) {
			tabs.push({
				label: 'Vital Signs',
				icon: 'fa fa-heartbeat',
				layout: settings.vital_signs_tab_layout || [],
				content: async () => {
					const vital = await this.get_latest_vital_signs(frm.doc.appointment);
					return this.render_tab_layout(settings.vital_signs_tab_layout, vital);
				},
				doctype: 'Vital Signs'
			});
		}

		// --- Patient History Tab
		if (settings.show_patient_history) {
			tabs.push({
				label: 'Patient History',
				icon: 'fa fa-history',
				layout: settings.patient_history_tab_layout || [],
				content: async () => {
					const patient = await frappe.db.get_doc('Patient', frm.doc.patient);
					return this.render_tab_layout(settings.patient_history_tab_layout, patient);
				},
				doctype: 'Patient'
			});
		}

		// --- Dental Chart Tab
		if (settings.show_dental_charts) {
			tabs.push({
				label: 'Dental Chart',
				svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M186.1 52.1C169.3 39.1 148.7 32 127.5 32C74.7 32 32 74.7 32 127.5l0 6.2c0 15.8 3.7 31.3 10.7 45.5l23.5 47.1c4.5 8.9 7.6 18.4 9.4 28.2l36.7 205.8c2 11.2 11.6 19.4 22.9 19.8s21.4-7.4 24-18.4l28.9-121.3C192.2 323.7 207 312 224 312s31.8 11.7 35.8 28.3l28.9 121.3c2.6 11.1 12.7 18.8 24 18.4s20.9-8.6 22.9-19.8l36.7-205.8c1.8-9.8 4.9-19.3 9.4-28.2l23.5-47.1c7.1-14.1 10.7-29.7 10.7-45.5l0-2.1c0-55-44.6-99.6-99.6-99.6c-24.1 0-47.4 8.8-65.6 24.6l-3.2 2.8 19.5 15.2c7 5.4 8.2 15.5 2.8 22.5s-15.5 8.2-22.5 2.8l-24.4-19-37-28.8z"/></svg>',
				content: () => this.get_dental_chart_content(frm),
				doctype: 'Dental Chart'
			});
		}

		// --- Render tabs
		const $tabsContainer = $offcanvasWrapper.find('.vertical-tabs-container');
		tabs.forEach(tab => {
			const $tab = $(`
                <button class="vertical-tab" data-tab="${tab.label}">
                    ${tab.icon ? `<i class="${tab.icon}"></i>` : tab.svg}
                    <span>${tab.label}</span>
                </button>`);
			$tab.appendTo($tabsContainer).on('click', async () => {
				const content = await tab.content();
				$offcanvasWrapper.data('active-tab', tab);
				this.show_offcanvas($offcanvasWrapper, tab.label, content);
			});
		});

		// --- Events
		$offcanvasWrapper.on('click', '.btn-close, .offcanvas-overlay', () => this.hide_offcanvas($offcanvasWrapper));
		$offcanvasWrapper.on('keydown', (e) => { if (e.key === 'Escape') this.hide_offcanvas($offcanvasWrapper); });

		// --- Edit button logic
		$offcanvasWrapper.on('click', '.btn-edit', async () => {
			const active = $offcanvasWrapper.data('active-tab');
			if (!active) return;

			if (active.doctype === 'Patient') {
				const patient = await frappe.db.get_doc('Patient', frm.doc.patient);
				await this.open_edit_dialog('Patient', patient, active.layout, async (values) => {
					await frappe.call({
						method: 'frappe.client.set_value',
						args: { doctype: 'Patient', name: patient.name, fieldname: values }
					});
					frappe.show_alert({ message: __('Patient details updated'), indicator: 'green' });
					const refreshed = await frappe.db.get_doc('Patient', patient.name);
					const html = this.render_tab_layout(active.layout, refreshed);
					this.show_offcanvas($offcanvasWrapper, active.label, html);
				});
			} else if (active.doctype === 'Vital Signs') {
				const vital = await this.get_or_create_vital_sign(frm);
				await this.open_edit_dialog('Vital Signs', vital, active.layout, async (values) => {
					await frappe.call({
						method: 'frappe.client.set_value',
						args: { doctype: 'Vital Signs', name: vital.name, fieldname: values }
					});
					frappe.show_alert({ message: __('Vital Signs updated'), indicator: 'green' });
					const refreshed = await frappe.db.get_doc('Vital Signs', vital.name);
					const html = this.render_tab_layout(active.layout, refreshed);
					this.show_offcanvas($offcanvasWrapper, active.label, html);
				});
			}
		});
	},

	async get_meta_safe(doctype) {
		return new Promise((resolve, reject) => {
			frappe.model.with_doctype(doctype, () => {
				const meta = frappe.get_meta(doctype);
				if (meta && meta.fields?.length) {
					resolve(meta);
				} else {
					reject(new Error(`Unable to load metadata for ${doctype}`));
				}
			});
		});
	},

	async open_edit_dialog(doctype, doc, layout, onSave) {
		const meta = await this.get_meta_safe(doctype);

		const fields = layout
			.filter(f => f.fieldname)
			.map(f => {
				const meta_field = meta.fields.find(m => m.fieldname === f.fieldname);
				return {
					label: f.label || (meta_field?.label ?? f.fieldname),
					fieldname: f.fieldname,
					fieldtype: meta_field?.fieldtype || 'Data',
					options: meta_field?.options || undefined,
					default: doc[f.fieldname] || '',
					reqd: meta_field?.reqd || 0
				};
			});

		if (!fields.length) {
			frappe.msgprint(__('No editable fields defined in layout.'));
			return;
		}

		const d = new frappe.ui.Dialog({
			title: __('Edit {0}', [doctype]),
			fields,
			primary_action_label: __('Save'),
			primary_action(values) {
				onSave(values);
				d.hide();
			}
		});
		d.show();
	},

	// --- Fetch latest Vital Signs or return null
	async get_latest_vital_signs(appointment) {
		if (!appointment) return {};
		const res = await frappe.db.get_list('Vital Signs', {
			filters: { appointment },
			fields: ['name', 'temperature', 'pulse', 'bp_systolic', 'bp_diastolic', 'weight', 'signs_date', 'signs_time'],
			order_by: 'creation desc',
			limit: 1
		});
		return res.length ? res[0] : {};
	},

	// --- Get or create Vital Signs record for editing
	async get_or_create_vital_sign(frm) {
		const res = await frappe.db.get_list('Vital Signs', {
			filters: { appointment: frm.doc.appointment },
			fields: ['name'],
			limit: 1
		});
		if (res.length) {
			return await frappe.db.get_doc('Vital Signs', res[0].name);
		}
		// Create a new one if missing
		const new_doc = await frappe.call({
			method: 'frappe.client.insert',
			args: {
				doc: {
					doctype: 'Vital Signs',
					appointment: frm.doc.appointment,
					patient: frm.doc.patient,
					signs_date: frappe.datetime.nowdate(),
					signs_time: frappe.datetime.now_time()
				}
			}
		});
		return new_doc.message;
	},

	// --- Layout Renderer
	render_tab_layout(layout = [], doc = null) {
		if (!layout.length) return `<div class="p-3 text-center text-muted">No layout defined</div>`;
		let html = '';
		layout.forEach(field => {
			const color = this.get_color(field.color);
			const value = doc ? (doc[field.fieldname] || '') : '';
			const is_empty = !value || value.toString().trim() === '';
			if (is_empty && !field.show_if_empty) return;

			if (field.style === 'Card') {
				html += `
                    <div class="card mb-3" style="background-color: ${color.bg}; border-color: ${color.border}; border-width: 1.5px; border-style: solid;">
                        <div class="card-body text-center">
                            <h6 class="fw-bold mb-2" style="color:${color.border}">${field.label}</h6>
                            <div class="value fw-semibold" style="color:${color.border}">
                                ${value || '<span class="text-muted small">Not recorded</span>'}
                            </div>
                        </div>
                    </div>`;
			} else if (field.style === 'Text') {
				html += `
                    <div class="mb-3" style="border-left: 3px solid ${color.border}; padding-left: 8px;">
                        <h6 class="fw-bold mb-1" style="color:${color.border}">${field.label}</h6>
                        <p class="text-muted small">${value || '<span class="text-muted small">Not recorded</span>'}</p>
                    </div>`;
			} else if (field.style === 'HTML') {
				html += `<div class="mt-3">${field.html || ''}</div>`;
			}
		});
		return html || `<div class="p-3 text-center text-muted">No data available</div>`;
	},

	get_color(name) {
		const map = {
			'Blue': { bg: '#e1f5fe', border: '#03a9f4' },
			'Green': { bg: '#e8f5e9', border: '#4caf50' },
			'Purple': { bg: '#f3e5f5', border: '#9c27b0' },
			'Red': { bg: '#fce4ec', border: '#e91e63' },
			'Blue Green': { bg: '#e0f2f1', border: '#009688' },
			'Brown': { bg: '#efebe9', border: '#795548' },
			'Orange': { bg: '#fbe9e7', border: '#ff5722' }
		};
		return map[name] || { bg: '#f8f9fa', border: '#ced4da' };
	},

	show_offcanvas($wrapper, title, content) {
		$wrapper.find('.offcanvas-title').text(title);
		$wrapper.find('.offcanvas-body').html(content);
		$wrapper.addClass('show');
		$('body').addClass('offcanvas-open');
		setTimeout(() => {
			$wrapper.find(`.vertical-tab[data-tab="${title}"]`).addClass('active').siblings().removeClass('active');
		}, 50);
	},

	hide_offcanvas($wrapper) {
		$wrapper.removeClass('show');
		$('body').removeClass('offcanvas-open');
		setTimeout(() => {
			$wrapper.find('.vertical-tab').removeClass('active');
		}, 300);
	},

	// --- Dental chart loader
	get_dental_chart_content(frm) {
		const $container = $('<div class="p-3"></div>');
		frappe.require([
			'/assets/do_dental/js/dental_chart.js',
			'/assets/do_dental/css/dental_chart.css'
		], () => {
			frappe.db.get_list('Dental Chart', { fields: ['name', 'title'] }).then(charts => {
				if (!charts.length) {
					$container.html(`<div class="text-center text-muted">No dental chart available.</div>`);
					return;
				}
				const chart = charts.find(d => d.name === frm.doc.custom_dental_chart) || charts[0];
				try {
					new dental.DentalChart({ parent: $container, doc: chart });
				} catch (e) {
					$container.html(`<div class="alert alert-danger">Error loading chart: ${e.message}</div>`);
				}
			});
		});
		return $container;
	}
};

let lastBannerCreatedAt = 0;
const BANNER_CREATE_COOLDOWN = 800;

function clearPatientContext() {
	localStorage.removeItem(ACTIVE_PATIENT_STORAGE_KEY);
	$(".active-waiting-patient").removeClass("active-waiting-patient");
	disableSidebarActions();
}

// --- Patient Info Banner
function createPatientInfoBanner(patient) {
	const now = Date.now();

	// Prevent duplicate or rapid re-render
	if (now - lastBannerCreatedAt < BANNER_CREATE_COOLDOWN) {
		console.log("Skipped duplicate banner render");
		return;
	}
	lastBannerCreatedAt = now;

	// Remove any previous banner before creating a new one
	$(".do-health-patient-banner").remove();

	if (!patient || !patient.patient || !patient.appointment) return;

	// Continue as before...
	frappe.db.get_doc("Patient", patient.patient).then(patientData => {
		Promise.all([
			frappe.db.get_doc("Patient Appointment", patient.appointment),
			frappe.db.get_list("Patient Encounter", {
				filters: { patient: patient.patient, docstatus: 1 },
				fields: ["encounter_date"],
				order_by: "encounter_date desc",
				limit: 1
			}),
			frappe.db.get_list("Vital Signs", {
				filters: { appointment: patient.appointment, docstatus: ['<', 2] },
				fields: ["name", "temperature", "pulse", "bp_systolic", "bp_diastolic", "weight"],
				order_by: "creation desc",
				limit: 1
			})
		]).then(([appointmentData, lastVisits, vitalSigns]) => {
			const vitals = vitalSigns.length > 0 ? vitalSigns[0] : {
				temperature: appointmentData.custom_temperature,
				pulse: appointmentData.custom_pulse,
				bp_systolic: appointmentData.custom_bp_systolic,
				bp_diastolic: appointmentData.custom_bp_diastolic,
				weight: appointmentData.custom_weight
			};
			renderBanner(patientData, appointmentData, lastVisits[0]?.encounter_date, vitals);
		});
	});
}


function renderBanner(patient, appointment, lastVisit, vitals) {
	const age = patient.dob ? Math.floor((Date.now() - new Date(patient.dob)) / 31557600000) : "";

	// Calculate top position: navbar + page-head
	const navbarHeight = $(".navbar").outerHeight() || 0;
	const pageHeadHeight = $(".page-head").outerHeight() || 0;
	const topPosition = navbarHeight + pageHeadHeight;

	const $banner = $("<div>", {
		class: "do-health-patient-banner",
		style: `background: linear-gradient(to right, #ffffff 0%, #f8f9fa 100%); border-bottom: 2px solid #e3e8ef; padding: 16px 28px; position: sticky; top: ${topPosition}px; z-index: 5; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin: 0; width: 100%;`
	});

	const $row = $("<div>", {
		style: "display: flex; align-items: center; gap: 20px;"
	});

	// Avatar with gradient border
	const initial = patient.patient_name?.charAt(0).toUpperCase() || "?";
	const $avatarWrapper = $("<div>", {
		style: "position: relative; flex-shrink: 0;"
	});

	const $avatar = patient.image
		? $("<img>", {
			src: patient.image,
			style: "width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 3px solid #fff; box-shadow: 0 2px 12px rgba(102, 126, 234, 0.3);"
		})
		: $("<div>", {
			style: "width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 22px; font-weight: 700; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); border: 3px solid #fff;",
			text: initial
		});

	$avatarWrapper.append($avatar);

	// Patient info section with enhanced typography
	const $info = $("<div>", { style: "flex: 1; min-width: 200px;" });

	const $nameWrapper = $("<div>", {
		style: "display: flex; align-items: center; gap: 8px; margin-bottom: 6px;"
	});

	const $name = $("<span>", {
		style: "font-size: 19px; font-weight: 700; color: #2c3e50; letter-spacing: -0.3px;",
		text: patient.patient_name
	});

	$nameWrapper.append($name);

	if (patient.sex) {
		const genderColor = patient.sex === "Male" ? "#3498db" : patient.sex === "Female" ? "#e91e63" : "#95a5a6";
		const $genderBadge = $("<span>", {
			style: `background: ${genderColor}; color: white; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px;`,
			text: patient.sex
		});
		$nameWrapper.append($genderBadge);
	}

	const details = [];
	if (patient.custom_cpr || patient.name) {
		details.push(`<span style="font-weight: 600; color: #495057;">CPR:</span> <span style="color: #6c757d;">${patient.custom_cpr || patient.name}</span>`);
	}
	if (patient.dob) {
		details.push(`<span style="font-weight: 600; color: #495057;">DOB:</span> <span style="color: #6c757d;">${frappe.datetime.str_to_user(patient.dob)} (${age}y)</span>`);
	}

	const $details = $("<div>", {
		style: "font-size: 13px; line-height: 1.6;",
		html: details.join(" <span style='color: #dee2e6; margin: 0 6px;'>|</span> ")
	});

	// Add last visit as clickable element
	if (lastVisit) {
		if (details.length > 0) {
			$details.append($("<span>", {
				style: "color: #dee2e6; margin: 0 6px;",
				text: "|"
			}));
		}

		const $lastVisitLabel = $("<span>", {
			style: "font-weight: 600; color: #495057;",
			text: "Last Visit: "
		});

		const $lastVisitValue = $("<span>", {
			style: "color: #6c757d; cursor: pointer; text-decoration: underline; text-decoration-style: dotted;",
			text: frappe.datetime.str_to_user(lastVisit)
		});

		$lastVisitValue.on("click", function (e) {
			e.stopPropagation();

			// Find the encounter with this date
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Patient Encounter",
					filters: {
						patient: patient.name,
						encounter_date: lastVisit,
						docstatus: 1
					},
					fields: ["name"],
					order_by: "creation desc",
					limit: 1
				},
				callback: function (r) {
					if (r.message && r.message.length > 0) {
						const encounterName = r.message[0].name;

						// Open encounter in a dialog
						frappe.call({
							method: "frappe.client.get",
							args: {
								doctype: "Patient Encounter",
								name: encounterName
							},
							callback: function (encounterData) {
								if (encounterData.message) {
									const encounter = encounterData.message;

									// Create dialog to show encounter details
									const dialog = new frappe.ui.Dialog({
										title: `Encounter: ${encounter.name}`,
										size: 'large',
										fields: [
											{
												fieldtype: 'HTML',
												fieldname: 'encounter_details'
											}
										]
									});

									// Build encounter details HTML
									let html = `
                                            <div style="padding: 16px;">
                                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                                                    <div>
                                                        <div style="font-size: 11px; color: #6c757d; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Encounter Date</div>
                                                        <div style="font-size: 14px; font-weight: 600;">${frappe.datetime.str_to_user(encounter.encounter_date)}</div>
                                                    </div>
                                                    <div>
                                                        <div style="font-size: 11px; color: #6c757d; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Practitioner</div>
                                                        <div style="font-size: 14px; font-weight: 600;">${encounter.practitioner_name || encounter.practitioner || 'N/A'}</div>
                                                    </div>
                                                </div>
                                        `;

									// Add symptoms if available
									if (encounter.symptoms) {
										html += `
                                                <div style="margin-bottom: 20px;">
                                                    <div style="font-size: 12px; color: #495057; font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #e3e8ef;">Symptoms</div>
                                                    <div style="font-size: 13px; color: #6c757d; white-space: pre-wrap;">${encounter.symptoms}</div>
                                                </div>
                                            `;
									}

									// Add diagnosis if available
									if (encounter.diagnosis) {
										html += `
                                                <div style="margin-bottom: 20px;">
                                                    <div style="font-size: 12px; color: #495057; font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #e3e8ef;">Diagnosis</div>
                                                    <div style="font-size: 13px; color: #6c757d; white-space: pre-wrap;">${encounter.diagnosis}</div>
                                                </div>
                                            `;
									}

									// Add notes if available
									if (encounter.encounter_comment) {
										html += `
                                                <div style="margin-bottom: 20px;">
                                                    <div style="font-size: 12px; color: #495057; font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #e3e8ef;">Notes</div>
                                                    <div style="font-size: 13px; color: #6c757d; white-space: pre-wrap;">${encounter.encounter_comment}</div>
                                                </div>
                                            `;
									}

									// Add button to open full encounter
									html += `
                                                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e3e8ef;">
                                                    <button class="btn btn-primary btn-sm" onclick="frappe.set_route('Form', 'Patient Encounter', '${encounter.name}'); cur_dialog.hide();">
                                                        <i class="fa fa-external-link-alt"></i> Open Full Encounter
                                                    </button>
                                                </div>
                                            </div>
                                        `;

									dialog.fields_dict.encounter_details.$wrapper.html(html);
									dialog.show();
								}
							}
						});
					} else {
						frappe.msgprint(__('Encounter not found'));
					}
				}
			});
		});

		$details.append($lastVisitLabel, $lastVisitValue);
	}

	$info.append($nameWrapper, $details);

	// Vitals section with cards
	const vitalsList = [];
	if (vitals.temperature) {
		vitalsList.push({ icon: "fa-thermometer-half", label: "Temp", value: `${vitals.temperature}°C`, color: "#ff6b6b", bg: "#ffe5e5" });
	}
	if (vitals.pulse) {
		vitalsList.push({ icon: "fa-heartbeat", label: "Pulse", value: `${vitals.pulse}`, unit: "bpm", color: "#ee5a6f", bg: "#ffe5eb" });
	}
	if (vitals.bp_systolic && vitals.bp_diastolic) {
		vitalsList.push({ icon: "fa-stethoscope", label: "BP", value: `${vitals.bp_systolic}/${vitals.bp_diastolic}`, color: "#4ecdc4", bg: "#e0f7f6" });
	}
	if (vitals.weight) {
		vitalsList.push({ icon: "fa-weight", label: "Weight", value: `${vitals.weight}`, unit: "kg", color: "#95e1d3", bg: "#e8f8f5" });
	}

	let $vitals = null;

	if (vitalsList.length > 0) {
		$vitals = $("<div>", {
			style: "display: flex; gap: 12px; padding-left: 20px; margin-left: 20px; border-left: 2px solid #e3e8ef;"
		});

		vitalsList.forEach(v => {
			const $card = $("<div>", {
				style: `background: ${v.bg}; padding: 10px 14px; border-radius: 10px; text-align: center; min-width: 75px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); border: 1px solid ${v.color}20;`
			});

			$card.append(
				$("<div>", {
					style: `color: ${v.color}; font-size: 16px; margin-bottom: 4px;`,
					html: `<i class="fa ${v.icon}"></i>`
				}),
				$("<div>", {
					style: "font-size: 9px; color: #6c757d; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 3px;",
					text: v.label
				}),
				$("<div>", {
					style: `font-size: 15px; font-weight: 800; color: ${v.color};`,
					html: v.value + (v.unit ? `<span style="font-size: 10px; font-weight: 600; margin-left: 2px;">${v.unit}</span>` : "")
				})
			);

			$vitals.append($card);
		});
	} else {
		// No vitals available - show button to enter them
		$vitals = $("<div>", {
			style: "display: flex; align-items: center; padding-left: 20px; margin-left: 20px; border-left: 2px solid #e3e8ef;"
		});

		const $addVitalsBtn = $("<button>", {
			class: "btn btn-sm",
			style: "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);",
			html: '<i class="fa fa-plus-circle"></i> Vital Signs'
		});

		$addVitalsBtn.on("click", function () {
			// Open dialog to enter vitals
			const dialog = new frappe.ui.Dialog({
				title: 'Vital Signs',
				fields: [
					{
						label: 'Temperature (°C)',
						fieldname: 'custom_temperature',
						fieldtype: 'Float'
					},
					{
						label: 'Pulse (bpm)',
						fieldname: 'custom_pulse',
						fieldtype: 'Int'
					},
					{
						label: 'BP Systolic',
						fieldname: 'custom_bp_systolic',
						fieldtype: 'Int'
					},
					{
						label: 'BP Diastolic',
						fieldname: 'custom_bp_diastolic',
						fieldtype: 'Int'
					},
					{
						label: 'Weight (kg)',
						fieldname: 'custom_weight',
						fieldtype: 'Float'
					}
				],
				primary_action_label: 'Save',
				primary_action(values) {
					// First check if Vital Signs already exist for this appointment (draft or submitted, not cancelled)
					frappe.call({
						method: 'frappe.client.get_list',
						args: {
							doctype: 'Vital Signs',
							filters: {
								appointment: appointment.name,
								docstatus: ['<', 2]  // 0 = draft, 1 = submitted, 2 = cancelled
							},
							fields: ['name'],
							limit: 1
						},
						callback: function (existingCheck) {
							if (existingCheck.message && existingCheck.message.length > 0) {
								// Update existing Vital Signs
								const vitalSignsName = existingCheck.message[0].name;
								frappe.call({
									method: 'frappe.client.set_value',
									args: {
										doctype: 'Vital Signs',
										name: vitalSignsName,
										fieldname: {
											temperature: values.custom_temperature,
											pulse: values.custom_pulse,
											bp_systolic: values.custom_bp_systolic,
											bp_diastolic: values.custom_bp_diastolic,
											weight: values.custom_weight
										}
									},
									callback: function (r) {
										if (!r.exc) {
											updateAppointmentAndRefresh(values, dialog);
										}
									}
								});
							} else {
								// Create new Vital Signs document
								const vitalSignsDoc = {
									doctype: 'Vital Signs',
									patient: appointment.patient,
									patient_name: appointment.patient_name,
									appointment: appointment.name,
									signs_date: frappe.datetime.nowdate(),
									signs_time: frappe.datetime.now_time(),
									temperature: values.custom_temperature,
									pulse: values.custom_pulse,
									bp_systolic: values.custom_bp_systolic,
									bp_diastolic: values.custom_bp_diastolic,
									weight: values.custom_weight
								};

								frappe.call({
									method: 'frappe.client.insert',
									args: {
										doc: vitalSignsDoc
									},
									callback: function (r) {
										if (!r.exc) {
											updateAppointmentAndRefresh(values, dialog);
										}
									}
								});
							}
						}
					});

					function updateAppointmentAndRefresh(values, dialog) {
						// Update appointment with vitals
						frappe.call({
							method: 'frappe.client.set_value',
							args: {
								doctype: 'Patient Appointment',
								name: appointment.name,
								fieldname: {
									custom_temperature: values.custom_temperature,
									custom_pulse: values.custom_pulse,
									custom_bp_systolic: values.custom_bp_systolic,
									custom_bp_diastolic: values.custom_bp_diastolic,
									custom_weight: values.custom_weight
								}
							},
							callback: function () {
								frappe.show_alert({
									message: __('Vital Signs saved successfully'),
									indicator: 'green'
								});
								dialog.hide();
								// Refresh banner
								const saved = getSavedPatientContext();
								if (saved) {
									$(".do-health-patient-banner").remove();
									createPatientInfoBanner(saved);
								}
							}
						});
					}
				}
			});

			dialog.show();
		});

		$vitals.append($addVitalsBtn);
	}

	// Insurance badge with premium design
	let $insurance = null;
	if (appointment.insurance_company || appointment.insurance) {
		$insurance = $("<div>", {
			style: "padding: 10px 18px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3); margin-left: 12px;",
			html: `<i class="fa fa-shield-alt" style="color: #fff; font-size: 16px;"></i><div style="color: #fff;"><div style="font-size: 9px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; opacity: 0.9;">Insurance</div><div style="font-size: 13px; font-weight: 700;">${appointment.insurance_company || appointment.insurance}</div></div>`
		});
	}

	// Assemble
	$row.append($avatarWrapper, $info);
	if ($vitals) $row.append($vitals);
	if ($insurance) $row.append($insurance);

	$banner.append($row);

	// Insert right below page-head (breadcrumb area) without gap
	const $pageHead = $('[data-page-route="Patient Encounter"] .page-head');
	if ($pageHead.length) {
		$pageHead.after($banner);
	} else {
		const $layoutMain = $("[data-page-route='Patient Encounter'] .layout-main-section");
		if ($layoutMain.length) {
			$layoutMain.prepend($banner);
		} else {
			$("[data-page-route='Patient Encounter'] .page-container").prepend($banner);
		}
	}

	// Adjust form elements to account for sticky banner
	const bannerHeight = $banner.outerHeight() || 0;
	const stickyOffset = navbarHeight + pageHeadHeight + bannerHeight;

	// Fix form-message and form-tabs-list sticky positioning
	setTimeout(() => {
		const $formMessage = $(".form-message");
		const $formTabsList = $(".form-tabs-list");

		if ($formMessage.length && $formMessage.css("position") === "sticky") {
			$formMessage.css("top", `${stickyOffset}px`);
		}

		if ($formTabsList.length && $formTabsList.css("position") === "sticky") {
			$formTabsList.css("top", `${stickyOffset}px`);
		}
	}, 50);

	// Hide form's patient info only (keep page title)
	setTimeout(() => {
		$(".form-patient-info, .patient-details-section").hide();
	}, 100);
}

// --- Bind to Patient Encounter ---
frappe.ui.form.on('Patient Encounter', {
	onload(frm) {
		function refreshBannerAndFields(patientCtx) {
			if (!patientCtx) return;

			// 1️⃣ Update Encounter fields if patient/appointment differ
			const currentPatient = frm.doc.patient;
			const currentAppointment = frm.doc.appointment;

			// Only update if different (avoid recursion/dirty state)
			if (patientCtx.patient && patientCtx.patient !== currentPatient) {
				frm.set_value("patient", patientCtx.patient);
			}
			if (patientCtx.appointment && patientCtx.appointment !== currentAppointment) {
				frm.set_value("appointment", patientCtx.appointment);
			}

			// 2️⃣ Recreate banner with fade transition for smooth UX
			const $oldBanner = $(".do-health-patient-banner");
			if ($oldBanner.length) {
				$oldBanner.fadeOut(150, function () {
					$(this).remove();
					createPatientInfoBanner(patientCtx);
				});
			} else {
				createPatientInfoBanner(patientCtx);
			}

			// 3️⃣ Rebuild sidebar context if the patient changed
			if (frm._sidebar_initialized) {
				frm._sidebar_initialized = false;
				do_health.encounter_sidebar.init(frm);
			}
		}

		// Subscribe to patientWatcher (fires when sidebar patient changes)
		if (window.do_health?.patientWatcher) {
			window.do_health.patientWatcher.subscribe(refreshBannerAndFields);
		}

		// Initial banner if already stored
		const current = window.do_health?.patientWatcher?.read();
		if (current) refreshBannerAndFields(current);
	},
	refresh(frm) {
		do_health.encounter_sidebar.init(frm);
	},
	patient(frm) {
		if (frm.doc.patient) {
			frm._sidebar_initialized = false;
			do_health.encounter_sidebar.init(frm);
		}
	}
});

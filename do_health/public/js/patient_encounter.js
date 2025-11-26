frappe.provide('do_health.encounter_sidebar');

do_health.encounter_sidebar = {
	_render_lock: {},
	PANEL_COLLAPSE_KEY: 'do_health_encounter_panel_collapsed',

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

	},

	build_sidebar(frm, $wrapper, settings) {
		const $panel = this.ensure_side_panel(frm, $wrapper);
		if (!$panel?.length) return;
		const $layout = $wrapper.find('.encounter-layout');
		const collapsed = this.read_panel_collapsed();
		this.apply_panel_state($layout, collapsed);

		const html = `
            <div class="encounter-side-wrapper encounter-surface">
                <div class="encounter-tab-buttons"></div>
                <div class="encounter-tab-body">
                    <div class="encounter-tab-header">
                        <h5 class="encounter-tab-title"></h5>
                        <button type="button" class="btn-edit btn btn-default btn-sm icon-btn">
                            <i class="fa fa-edit"></i> ${__('Edit')}
                        </button>
                    </div>
                    <div class="encounter-tab-content"></div>
                </div>
            </div>`;
		const $sideWrapper = $(html).appendTo($panel.empty());

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
					if (frm.doc.patient) {
						const patient = await frappe.db.get_doc('Patient', frm.doc.patient);
						return this.render_tab_layout(settings.patient_history_tab_layout, patient);
					}
					else {
						return '';
					}
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

		// --- Patient Visits Tab
		tabs.push({
			label: 'Patient Visits',
			icon: 'fa fa-notes-medical',
			content: () => this.get_patient_visits_content(frm),
			doctype: 'Patient Encounter'
		});

		// --- Render tabs
		const $tabsContainer = $sideWrapper.find('.encounter-tab-buttons');
		tabs.forEach(tab => {
			const $tab = $(`
                <button class="encounter-tab-button" data-tab="${tab.label}">
                    ${tab.icon ? `<i class="${tab.icon}"></i>` : tab.svg}
                    <span>${tab.label}</span>
                </button>`);
			$tab.appendTo($tabsContainer).on('click', async () => {
				const content = await tab.content();
				$panel.data('active-tab', tab);
				this.show_offcanvas($panel, tab.label, content);
			});
		});

		$panel.off('.encounterSide');
		$panel.closest('.encounter-layout').off('.encounterSide');
		$panel.on('click.encounterSide', '.patient-visit-card', (event) => {
			const appointmentName = $(event.currentTarget).data('appointment');
			if (appointmentName) {
				this.show_appointment_summary(appointmentName);
			}
		});
		$panel.on('click.encounterSide', '[data-open-patient-visit-list]', (event) => {
			const patientId = $(event.currentTarget).data('openPatientVisitList');
			if (patientId) {
				frappe.set_route('List', 'Patient Appointment', { patient: patientId });
			}
		});

		$panel.on('click.encounterSide', '.btn-edit', async () => {
			const active = $panel.data('active-tab');
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
					this.show_offcanvas($panel, active.label, html);
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
					this.show_offcanvas($panel, active.label, html);
				});
			}
		});

		const $layoutRef = $panel.closest('.encounter-layout');
		this.update_toggle_labels(collapsed);
		this.setup_responsive_drawers(frm, $layoutRef, $panel);

		// Respect persisted open/closed state; default to closed to reduce crowding
		this.set_panel_open($panel, !collapsed, { skipPersist: true });

		if (tabs.length) {
			(async () => {
				const first = tabs[0];
				const content = await first.content();
				$panel.data('active-tab', first);
				this.show_offcanvas($panel, first.label, content);
			})();
		}
	},

	apply_panel_state($layout, collapsed) {
		$layout.toggleClass('panel-collapsed', !!collapsed);
		this.update_toggle_labels(collapsed);
	},

	update_toggle_labels(collapsed) {
		const label = collapsed ? __('Show Panel') : __('Hide Panel');
		const icon = collapsed ? 'fa fa-chevron-left' : 'fa fa-chevron-right';
		$('.encounter-panel-toggle-banner').html(`<i class="${icon}"></i> ${label}`);
	},

	read_panel_collapsed() {
		try {
			return localStorage.getItem(this.PANEL_COLLAPSE_KEY) === '1';
		} catch (_) {
			return false;
		}
	},

	is_past_visit(tab) {
		try {
			if (tab?.doctype === 'Patient Encounter') return true; // past visits in the sidebar
		} catch (_) {
			return false;
		}
		return false;
	},

	persist_panel_collapsed(collapsed) {
		try {
			localStorage.setItem(this.PANEL_COLLAPSE_KEY, collapsed ? '1' : '0');
		} catch (_) {
			/* ignore */
		}
	},

	ensure_side_panel(frm) {
		const $wrapper = $(frm.$wrapper);
		let $layout = $wrapper.find('.encounter-layout');
		const $layoutMain = $wrapper.find('.layout-main-section');
		if (!$layout.length && $layoutMain.length) {
			if (!$layoutMain.parent().hasClass('encounter-form-area')) {
				$layoutMain.wrap('<div class="encounter-form-area"></div>');
			}
			const $formArea = $layoutMain.parent();
			$formArea.wrap('<div class="encounter-layout"></div>');
			$layout = $wrapper.find('.encounter-layout');
		}
		if (!$layout.length) return null;
		let $panel = $layout.find('.encounter-side-panel');
		if (!$panel.length) {
			$panel = $('<div class="encounter-side-panel"></div>').appendTo($layout);
		}
		return $panel;
	},

	set_panel_open($panel, open, opts = {}) {
		if (!$panel?.length) return;
		const $layout = $panel.closest('.encounter-layout');
		const $overlay = $('.encounter-mobile-overlay');
		const $timeline = $('.layout-side-section');
		const isMobile = window.matchMedia('(max-width: 1280px)').matches;

		$panel.toggleClass('is-open-floating', !!open);
		$panel.toggleClass('is-open-mobile', !!open && isMobile);
		$layout.toggleClass('panel-collapsed', !open);
		if (!opts.skipPersist) {
			this.persist_panel_collapsed(!open);
		}
		this.update_toggle_labels(!open);

		// Close timeline when opening panel
		if (open) {
			$timeline.removeClass('is-open-mobile');
		}

		const showOverlay = !!open || $timeline.hasClass('is-open-mobile');
		$overlay.toggleClass('show', showOverlay);
		$('body').toggleClass('encounter-overlay-open', showOverlay);
	},

	setup_responsive_drawers(frm, $layout, $panel) {
		if (!$layout?.length || !$panel?.length) return;

		const $wrapper = $(frm.$wrapper);
		const $timeline = $wrapper.find('.layout-side-section');
		const $layoutRef = $panel.closest('.encounter-layout');

		$('body').removeClass('encounter-overlay-open');

		const hasTimeline = $timeline.length > 0;
		const $overlay = $('<div class="encounter-mobile-overlay"></div>').appendTo($wrapper);

		const updateOverlay = () => {
			const open = $panel.hasClass('is-open-mobile') || $panel.hasClass('is-open-floating') || (hasTimeline && $timeline.hasClass('is-open-mobile'));
			$overlay.toggleClass('show', open);
			$('body').toggleClass('encounter-overlay-open', open);
		};

		const closeAll = () => {
			this.set_panel_open($panel, false, { skipPersist: true });
			if (hasTimeline) $timeline.removeClass('is-open-mobile');
			updateOverlay();
		};

		$overlay.on('click', closeAll);

		const handleResize = () => {
			if (window.matchMedia('(min-width: 1281px)').matches) {
				closeAll();
			}
		};

		handleResize();
		$(window).off('resize.encounterResponsive')
			.on('resize.encounterResponsive', (frappe.utils?.debounce || ((fn) => fn))(handleResize, 150));
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

	async get_patient_visits_content(frm) {
		const visits = await this.fetch_patient_visits(frm.doc.patient);
		return this.render_patient_visits(visits, frm.doc.patient);
	},

	async fetch_patient_visits(patient) {
		if (!patient) return [];
		const filters = {
			patient,
			docstatus: ['<', 2]
		};
		const today = frappe.datetime?.nowdate ? frappe.datetime.nowdate() : null;
		if (today) {
			filters.appointment_date = ['<=', today];
		}
		try {
			const visits = await frappe.db.get_list('Patient Appointment', {
				filters,
				fields: [
					'name',
					'appointment_date',
					'appointment_time',
					'practitioner',
					'practitioner_name',
					'status',
					'custom_visit_status',
					'custom_visit_reason',
					'notes',
					'appointment_type',
					'custom_appointment_category',
					'department',
					'duration'
				],
				limit: 15,
				order_by: 'appointment_date desc, appointment_time desc'
			});
			return visits || [];
		} catch (error) {
			console.error('[do_health] Failed to fetch patient appointments', error);
			return [];
		}
	},

	render_patient_visits(visits = [], patientId = null) {
		if (!visits.length) {
			const linkBtn = patientId ?
				`<button type="button" class="btn btn-sm btn-default" data-open-patient-visit-list="${this.escape_html(patientId)}">
				<i class="fa-regular fa-arrow-up-right-from-square"></i>
			</button>`
				: '';
			return `
				<div class="patient-visits-tab">
					<div class="patient-visits-empty">
						<div class="patient-visits-title">${__('No past visits yet')}</div>
						<p>${__('Schedule and complete appointments to build the visit history.')}</p>
						${linkBtn}
					</div>
				</div>`;
		}

		const cards = visits.map((visit) => {
			const visitDate = visit.appointment_date
				? frappe.datetime.str_to_user(visit.appointment_date)
				: __('Not set');
			const visitTime = visit.appointment_time
				? visit.appointment_time.split(':')[0] + ':' + visit.appointment_time.split(':')[1]
				: '';
			const practitioner = visit.practitioner_name || visit.practitioner || '';
			const summary = visit.custom_visit_reason || visit.notes || '';
			const badge = visit.custom_visit_status || visit.status || '';
			const chips = [];
			if (visit.appointment_type) chips.push(visit.appointment_type);
			if (visit.custom_appointment_category) chips.push(visit.custom_appointment_category);
			if (visit.medical_department) chips.push(visit.medical_department);

			return `
			<button type="button" class="patient-visit-card" data-appointment="${this.escape_html(visit.name)}">
				<div class="patient-visit-card__top">
					<div>
						<div class="patient-visit-card__title">${visitDate}${visitTime ? ` · ${visitTime}` : ''}</div>
						<div class="patient-visit-card__meta">
							${practitioner ? `<span><i class="fa fa-user-md"></i> ${this.escape_html(practitioner)}</span>` : ''}
						</div>
						${chips.length ? `<div class="patient-visit-card__chips">${chips.map(chip => `<span class="patient-visit-card__chip">${this.escape_html(chip)}</span>`).join('')}</div>` : ''}
					</div>
					${badge ? `<span class="patient-visit-card__status">${this.escape_html(badge)}</span>` : ''}
				</div>
				<div class="patient-visit-card__body">
					${summary ? `<p>${this.escape_html(this.truncate_text(summary, 220))}</p>` : ''}
				</div>
			</button>`;
		}).join('');

		const header = `
			<div class="patient-visits-header">
				<div>
					<div class="patient-visits-title">${__('Past Visits')}</div>
					<div class="patient-visits-subtitle">${__('Showing {0} recent visits', [visits.length])}</div>
				</div>
				${patientId ? `
					<button type="button" class="btn btn-sm btn-default" data-open-patient-visit-list="${this.escape_html(patientId)}">
						<i class="fa-regular fa-arrow-up-right-from-square"></i>
					</button>` : ''
			}
			</div>`;

		return `
			<div class="patient-visits-tab">
				${header}
				<div class="patient-visits-list-container">
					<div class="patient-visits-list">
						${cards}
					</div>
				</div>
			</div>`;
	},

	truncate_text(text, limit = 180) {
		if (!text) return '';
		const trimmed = text.toString().trim();
		if (trimmed.length <= limit) return trimmed;
		return `${trimmed.slice(0, limit)}…`;
	},

	escape_html(value) {
		if (value === undefined || value === null) return '';
		if (frappe.utils?.escape_html) {
			return frappe.utils.escape_html(String(value));
		}
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	},

	async show_appointment_summary(appointmentName) {
		if (!appointmentName) return;
		try {
			const response = await frappe.call({
				method: 'do_health.api.methods.get_appointment_visit_summary',
				args: { appointment: appointmentName }
			});
			const summary = response.message;
			if (!summary) {
				frappe.msgprint(__('Visit not found'));
				return;
			}
			const title = this.get_visit_dialog_title(summary) || __('Patient Visit');
			const dialog = new frappe.ui.Dialog({
				title,
				size: 'large',
				fields: [{ fieldtype: 'HTML', fieldname: 'visit_summary' }]
			});
			dialog.fields_dict.visit_summary.$wrapper.html(this.build_visit_dialog_content(summary));
			dialog.show();
		} catch (error) {
			console.error('[do_health] Failed to load visit summary', error);
			frappe.msgprint(__('Unable to load visit. Please try again.'));
		}
	},

	get_visit_dialog_title(summary) {
		const appt = summary?.appointment || {};
		const parts = [];
		if (appt.appointment_date) {
			parts.push(frappe.datetime.str_to_user(appt.appointment_date));
		}
		if (appt.appointment_time) {
			parts.push(appt.appointment_time.split(':')[0] + ':' + appt.appointment_time.split(':')[1]);
		}
		const label = __('Visit');
		return parts.length ? `${label}: ${parts.join(' · ')}` : `${label} ${appt.name || ''}`.trim();
	},

	build_visit_dialog_content(summary) {
		const header = this.render_visit_header(summary.appointment);
		const procedures = this.render_visit_procedures(summary);
		const encounter = this.render_visit_encounter(summary);
		const vitals = this.render_visit_vitals(summary);
		const sections = [];
		sections.push(this.build_visit_section(__('Procedures'), procedures, true));
		sections.push(this.build_visit_section(__('Encounter'), encounter));
		sections.push(this.build_visit_section(__('Vital Signs'), vitals));
		return `
			<div class="visit-summary">
				${header}
				<div class="visit-summary__sections">
					${sections.join('')}
				</div>
			</div>`;
	},

	render_visit_header(appointment = {}) {
		if (!appointment || !appointment.name) return '';
		const slot = [];
		if (appointment.appointment_date) slot.push(frappe.datetime.str_to_user(appointment.appointment_date));
		if (appointment.appointment_time) slot.push(appointment.appointment_time.split(':')[0] + ':' + appointment.appointment_time.split(':')[1]);
		if (appointment.duration) slot.push(`${appointment.duration} ${__('mins')}`);
		const details = [appointment.practitioner_name || appointment.practitioner, appointment.medical_department, appointment.service_unit]
			.filter(Boolean)
			.map(value => `<span>${this.escape_html(value)}</span>`)
			.join(' · ');
		const chips = [];
		if (appointment.status) chips.push(appointment.status);
		if (appointment.custom_visit_status && appointment.custom_visit_status !== appointment.status) chips.push(appointment.custom_visit_status);
		if (appointment.appointment_type) chips.push(appointment.appointment_type);
		if (appointment.custom_appointment_category) chips.push(appointment.custom_appointment_category);
		return `
			<div class="visit-summary__header">
				<div>
					<div class="visit-summary__title">${this.escape_html(appointment.name)}</div>
					${slot.length ? `<div class="visit-summary__slot">${this.escape_html(slot.join(' · '))}</div>` : ''}
					${details ? `<div class="visit-summary__meta">${details}</div>` : ''}
				</div>
				${chips.length ? `<div class="visit-summary__chips">${chips.map(chip => this.render_chip(chip)).join('')}</div>` : ''}
				${appointment.custom_visit_reason ? `<div class="visit-summary__reason"><strong>${__('Reason')}:</strong> ${this.escape_html(appointment.custom_visit_reason)}</div>` : ''}
				${appointment.notes ? `<div class="visit-summary__notes">${this.format_text_block(appointment.notes)}</div>` : ''}
			</div>`;
	},

	build_visit_section(title, body, expanded = false) {
		const safeBody = body && body.trim() ? body : `<div class="visit-empty">${__('No data recorded for this section.')}</div>`;
		return `
			<div class="visit-section ${expanded ? 'is-open' : ''}">
				<button type="button" class="visit-section__header">
					<span>${title}</span>
					<i class="fa fa-chevron-down"></i>
				</button>
				<div class="visit-section__body">${safeBody}</div>
			</div>`;
	},

	render_visit_procedures(summary) {
		const clusters = [];
		const prescriptions = this.render_order_group(__('Prescriptions'), summary.procedures || [], row => this.render_procedure_card(row));
		if (prescriptions) clusters.push(prescriptions);
		const clinical = this.render_order_group(__('Completed Procedures'), summary.clinical_procedures || [], row => this.render_clinical_procedure_card(row));
		if (clinical) clusters.push(clinical);
		return clusters.join('');
	},

	render_visit_encounter(summary) {
		if (summary.encounter_summary) {
			return this.build_encounter_summary_html(summary.encounter_summary, summary.encounter_name);
		}
		return `<div class="visit-empty">${__('No encounter has been submitted for this appointment yet.')}</div>`;
	},

	render_visit_vitals(summary) {
		const html = this.render_vitals_section(summary.vitals || [], '');
		return html || `<div class="visit-empty">${__('No vital signs recorded for this visit.')}</div>`;
	},

	async show_encounter_summary(encounterName, opts = {}) {
		if (!encounterName) return;
		try {
			const response = await frappe.call({
				method: 'do_health.api.methods.get_encounter_summary',
				args: { encounter: encounterName }
			});
			const summary = response.message;
			if (!summary) {
				frappe.msgprint(__('Encounter not found'));
				return;
			}
			const dialog = new frappe.ui.Dialog({
				title: opts.title || `Encounter: ${summary.encounter?.name || encounterName}`,
				size: 'large',
				fields: [{ fieldtype: 'HTML', fieldname: 'encounter_details' }]
			});
			dialog.fields_dict.encounter_details.$wrapper.html(this.build_encounter_summary_html(summary, encounterName));
			dialog.show();
		} catch (error) {
			console.error('[do_health] Failed to load encounter summary', error);
			frappe.msgprint(__('Unable to load encounter. Please try again.'));
		}
	},

	build_encounter_summary_html(summary, fallbackName) {
		if (!summary || !summary.encounter) {
			return `<div class="p-4 text-muted text-center">${__('No encounter data available')}</div>`;
		}
		const encounter = summary.encounter;
		const stats = this.render_summary_stats([
			{ label: __('Encounter Date'), value: encounter.encounter_date_label },
			{ label: __('Encounter Time'), value: encounter.encounter_time_label },
			{ label: __('Practitioner'), value: encounter.practitioner_name || encounter.practitioner },
			{ label: __('Department'), value: encounter.medical_department },
			{ label: __('Status'), value: encounter.status },
			{ label: __('Appointment Type'), value: encounter.appointment_type },
			{ label: __('Appointment Category'), value: encounter.appointment_category },
			{ label: __('Source'), value: encounter.source }
		]);

		const sections = [];
		if (stats) sections.push(stats);
		if (summary.appointment) sections.push(this.render_appointment_card(summary.appointment));
		if ((summary.vitals || []).length) sections.push(this.render_vitals_section(summary.vitals));
		const symptomsSection = this.render_symptoms_section(summary);
		if (symptomsSection) sections.push(symptomsSection);
		const diagnosisSection = this.render_diagnosis_section(summary);
		if (diagnosisSection) sections.push(diagnosisSection);
		const ordersSection = this.render_orders_section(summary);
		if (ordersSection) sections.push(ordersSection);
		const notesSection = this.render_notes_section(summary.notes);
		if (notesSection) sections.push(notesSection);
		const supporting = this.render_supporting_files(summary.attachments, summary.annotations);
		if (supporting) sections.push(supporting);

		const encounterName = encounter.name || fallbackName;
		const footer = `
			<div class="encounter-summary__footer">
				<button class="btn btn-primary btn-sm" onclick="frappe.set_route('Form', 'Patient Encounter', '${this.escape_html(encounterName)}'); cur_dialog.hide();">
					<i class="fa fa-external-link-alt"></i> ${__('Open Full Encounter')}
				</button>
			</div>`;

		return `<div class="encounter-summary">${sections.join('')}${footer}</div>`;
	},

	render_summary_stats(items = []) {
		const cards = items
			.filter(item => item && item.value)
			.map(item => {
				const value = this.escape_html(item.value);
				return `
					<div class="encounter-stat-card">
						<div class="encounter-summary__label">${item.label}</div>
						<div class="encounter-summary__value">${value}</div>
					</div>`;
			})
			.join('');
		return cards ? `<div class="encounter-summary__grid">${cards}</div>` : '';
	},

	render_section(title, body, subtitle = '') {
		if (!body) return '';
		return `
			<div class="encounter-section">
				<div class="encounter-section__title">${title}</div>
				${subtitle ? `<div class="encounter-section__subtitle">${subtitle}</div>` : ''}
				${body}
			</div>`;
	},

	render_appointment_card(appointment) {
		const chips = [];
		if (appointment.status) chips.push(`${__('Status')}: ${appointment.status}`);
		if (appointment.custom_visit_status) chips.push(`${__('Visit Status')}: ${appointment.custom_visit_status}`);
		if (appointment.custom_appointment_category) chips.push(`${__('Category')}: ${appointment.custom_appointment_category}`);
		const slotParts = [];
		if (appointment.appointment_date_label) slotParts.push(appointment.appointment_date_label);
		if (appointment.appointment_time_label) slotParts.push(appointment.appointment_time_label);
		if (appointment.duration) slotParts.push(`${appointment.duration} ${__('mins')}`);
		const reason = appointment.custom_visit_reason
			? `<div class="encounter-note"><strong>${__('Reason')}:</strong> ${this.escape_html(appointment.custom_visit_reason)}</div>`
			: '';
		const notes = appointment.notes
			? `<div class="encounter-note">${this.format_text_block(appointment.notes)}</div>`
			: '';
		const meta = [
			appointment.practitioner_name || appointment.practitioner,
			appointment.medical_department,
			appointment.service_unit
		].filter(Boolean).map(value => `<span>${this.escape_html(value)}</span>`).join(' · ');

		const body = `
			<div class="encounter-card">
				<div class="encounter-card__title">${__('Patient Appointment')}</div>
				${slotParts.length ? `<div class="encounter-card__meta">${this.escape_html(slotParts.join(' · '))}</div>` : ''}
				${meta ? `<div class="encounter-card__meta encounter-card__meta--muted">${meta}</div>` : ''}
				${chips.length ? `<div class="encounter-order-card__chips">${chips.map(chip => this.render_chip(chip)).join('')}</div>` : ''}
				${reason}
				${notes}
			</div>`;

		return this.render_section(__('Patient Appointment'), body);
	},

	render_vitals_section(records = [], heading = __('Vital Signs')) {
		if (!records.length) return '';
		const cards = records.map(record => {
			const when = [record.signs_date_label, record.signs_time_label]
				.filter(Boolean)
				.join(' • ');
			const chips = Object.entries(record.readings || {}).map(([field, value]) => {
				const meta = this.get_vital_meta(field, value, record);
				return meta ? this.render_chip(meta) : '';
			}).join('');
			const noteBlocks = [];
			if (record.vital_signs_note) {
				noteBlocks.push(`<div class="encounter-note">${this.format_text_block(record.vital_signs_note)}</div>`);
			}
			if (record.nutrition_note) {
				noteBlocks.push(`<div class="encounter-note">${this.format_text_block(record.nutrition_note)}</div>`);
			}
			return `
				<div class="encounter-vitals__card">
					<div class="encounter-vitals__header">
						<div>${when || __('Not recorded')}</div>
						${record.name ? `<small>${this.escape_html(record.name)}</small>` : ''}
					</div>
					${chips ? `<div class="encounter-vitals__chips">${chips}</div>` : ''}
					${noteBlocks.join('')}
				</div>`;
		}).join('');
		const body = `<div class="encounter-vitals">${cards}</div>`;
		return heading
			? this.render_section(heading, body)
			: body;
	},

	get_vital_meta(field, value, record) {
		if (value === undefined || value === null || value === '') return null;
		const labels = {
			temperature: { label: __('Temperature'), suffix: '°C' },
			pulse: { label: __('Pulse'), suffix: __('bpm') },
			respiratory_rate: { label: __('Respiratory Rate'), suffix: __('breaths/min') },
			bp_systolic: { label: __('Systolic'), suffix: __('mmHg') },
			bp_diastolic: { label: __('Diastolic'), suffix: __('mmHg') },
			bp: { label: __('Blood Pressure') },
			weight: { label: __('Weight'), suffix: __('kg') },
			height: { label: __('Height'), suffix: __('cm') },
			bmi: { label: __('BMI') }
		};
		const readings = (record && record.readings) || {};
		let label = (labels[field] && labels[field].label) || (frappe.model?.unscrub ? frappe.model.unscrub(field) : field);
		let suffix = (labels[field] && labels[field].suffix) || '';
		let output = value;
		if (field === 'bp_systolic' && readings.bp_diastolic && !readings.bp) {
			label = __('Blood Pressure');
			output = `${value}/${readings.bp_diastolic}`;
			suffix = __('mmHg');
		}
		return `${label}: ${this.escape_html(output)}${suffix ? ` ${suffix}` : ''}`;
	},

	render_symptoms_section(summary) {
		const notes = summary.notes || {};
		const items = (summary.symptoms || []).map(row => `<li>${this.escape_html(row.complaint)}</li>`).join('');
		const blocks = [];
		if (items) {
			blocks.push(`<ul class="encounter-list">${items}</ul>`);
		}
		if (notes.symptom_duration) {
			blocks.push(`<div class="encounter-note"><strong>${__('Duration')}:</strong> ${this.escape_html(notes.symptom_duration)}</div>`);
		}
		if (notes.symptoms_notes) {
			blocks.push(`<div class="encounter-note">${this.format_text_block(notes.symptoms_notes)}</div>`);
		}
		return blocks.length ? this.render_section(__('Symptoms & History'), blocks.join('')) : '';
	},

	render_diagnosis_section(summary) {
		const parts = [];
		const diagnosisList = (summary.diagnoses || []).map(row => `<li>${this.escape_html(row.diagnosis)}</li>`).join('');
		if (diagnosisList) {
			parts.push(`
				<div class="encounter-sublist">
					<div class="encounter-section__subtitle">${__('Primary Diagnosis')}</div>
					<ul class="encounter-list">${diagnosisList}</ul>
				</div>`);
		}
		const diffList = (summary.differential_diagnosis || []).map(row => `<li>${this.escape_html(row.diagnosis)}</li>`).join('');
		if (diffList) {
			parts.push(`
				<div class="encounter-sublist">
					<div class="encounter-section__subtitle">${__('Differential')}</div>
					<ul class="encounter-list">${diffList}</ul>
				</div>`);
		}
		if ((summary.codification || []).length) {
			const rows = summary.codification
				.map(row => `<li>${this.escape_html(row.code_value || row.code || '')}${row.display ? ` — ${this.escape_html(row.display)}` : ''}</li>`)
				.join('');
			parts.push(`
				<div class="encounter-sublist">
					<div class="encounter-section__subtitle">${__('Coding')}</div>
					<ul class="encounter-list">${rows}</ul>
				</div>`);
		}
		return parts.length ? this.render_section(__('Diagnoses & Coding'), parts.join('')) : '';
	},

	render_orders_section(summary) {
		const clusters = [];
		clusters.push(this.render_order_group(__('Medication Prescriptions'), summary.drug_prescriptions, row => this.render_medication_card(row)));
		clusters.push(this.render_order_group(__('Lab Tests'), summary.lab_prescriptions, row => this.render_lab_card(row)));
		clusters.push(this.render_order_group(__('Procedure Prescriptions'), summary.procedure_prescriptions, row => this.render_procedure_card(row)));
		clusters.push(this.render_order_group(__('Therapies'), summary.therapies, row => this.render_therapy_card(row)));
		clusters.push(this.render_order_group(__('Service Requests'), summary.service_requests, row => this.render_service_request_card(row)));
		clusters.push(this.render_order_group(__('Medication Requests'), summary.medication_requests, row => this.render_medication_request_card(row)));
		clusters.push(this.render_order_group(__('Completed Procedures'), summary.clinical_procedures, row => this.render_clinical_procedure_card(row)));
		const body = clusters.filter(Boolean).join('');
		return body ? this.render_section(__('Orders & Prescriptions'), body) : '';
	},

	render_order_group(title, items = [], renderer) {
		if (!items.length || typeof renderer !== 'function') return '';
		const cards = items.map(item => renderer.call(this, item)).filter(Boolean).join('');
		if (!cards) return '';
		return `
			<div class="encounter-order-cluster">
				<div class="encounter-section__subtitle">${title}</div>
				<div class="encounter-order-group">${cards}</div>
			</div>`;
	},

	render_medication_card(row) {
		const title = row.drug_name || row.drug_code || row.medication || __('Medication');
		const chips = [];
		if (row.dosage) chips.push(`${__('Dosage')}: ${row.dosage}`);
		if (row.dosage_form) chips.push(`${__('Form')}: ${row.dosage_form}`);
		if (row.period) chips.push(`${__('Period')}: ${row.period}`);
		if (row.interval && row.interval_uom) chips.push(`${__('Interval')}: ${row.interval} ${row.interval_uom}`);
		if (row.number_of_repeats_allowed) chips.push(`${__('Repeats')}: ${row.number_of_repeats_allowed}`);
		const lines = [];
		if (row.comment) lines.push(row.comment);
		if (row.medication_request) lines.push(`${__('Request')}: ${row.medication_request}`);
		return this.render_order_card(title, { chips, lines });
	},

	render_lab_card(row) {
		const title = row.lab_test_name || row.lab_test_code || __('Lab Test');
		const chips = [];
		if (row.intent) chips.push(`${__('Intent')}: ${row.intent}`);
		if (row.priority) chips.push(`${__('Priority')}: ${row.priority}`);
		if (row.patient_care_type) chips.push(`${__('Care Type')}: ${row.patient_care_type}`);
		const lines = [];
		if (row.lab_test_comment) lines.push(row.lab_test_comment);
		if (row.observation_template) lines.push(`${__('Template')}: ${row.observation_template}`);
		if (row.service_request) lines.push(`${__('Service Request')}: ${row.service_request}`);
		return this.render_order_card(title, { chips, lines });
	},

	render_procedure_card(row) {
		const title = row.procedure_name || row.procedure || __('Procedure');
		const chips = [];
		if (row.intent) chips.push(`${__('Intent')}: ${row.intent}`);
		if (row.priority) chips.push(`${__('Priority')}: ${row.priority}`);
		if (row.patient_care_type) chips.push(`${__('Care Type')}: ${row.patient_care_type}`);
		if (row.date) chips.push(`${__('Planned')}: ${frappe.datetime.str_to_user(row.date)}`);
		if (row.no_of_sessions) chips.push(`${__('Sessions')}: ${row.no_of_sessions}`);
		const lines = [];
		if (row.practitioner) lines.push(`${__('Practitioner')}: ${row.practitioner}`);
		if (row.department) lines.push(`${__('Department')}: ${row.department}`);
		if (row.service_request) lines.push(`${__('Service Request')}: ${row.service_request}`);
		return this.render_order_card(title, { chips, lines });
	},

	render_therapy_card(row) {
		const title = row.therapy_type || __('Therapy Plan');
		const chips = [];
		if (row.intent) chips.push(`${__('Intent')}: ${row.intent}`);
		if (row.priority) chips.push(`${__('Priority')}: ${row.priority}`);
		if (row.no_of_sessions) chips.push(`${__('Sessions')}: ${row.no_of_sessions}`);
		if (row.sessions_completed) chips.push(`${__('Completed')}: ${row.sessions_completed}`);
		const lines = [];
		if (row.patient_care_type) lines.push(`${__('Care Type')}: ${row.patient_care_type}`);
		if (row.service_request) lines.push(`${__('Service Request')}: ${row.service_request}`);
		return this.render_order_card(title, { chips, lines });
	},

	render_service_request_card(row) {
		const title = row.name || __('Service Request');
		const chips = [];
		if (row.status) chips.push(`${__('Status')}: ${row.status}`);
		if (row.intent) chips.push(`${__('Intent')}: ${row.intent}`);
		if (row.priority) chips.push(`${__('Priority')}: ${row.priority}`);
		const lines = [];
		if (row.order_description) lines.push(row.order_description);
		if (row.patient_care_type) lines.push(`${__('Care Type')}: ${row.patient_care_type}`);
		if (row.staff_role) lines.push(`${__('Staff Role')}: ${row.staff_role}`);
		if (row.expected_date_label) lines.push(`${__('Expected')}: ${row.expected_date_label}`);
		return this.render_order_card(title, {
			chips,
			lines,
			subtitle: [row.order_date_label, row.order_time_label].filter(Boolean).join(' • ')
		});
	},

	render_medication_request_card(row) {
		const title = row.medication || row.medication_item || row.name;
		const chips = [];
		if (row.status) chips.push(`${__('Status')}: ${row.status}`);
		if (row.intent) chips.push(`${__('Intent')}: ${row.intent}`);
		if (row.priority) chips.push(`${__('Priority')}: ${row.priority}`);
		const lines = [];
		if (row.dosage) lines.push(`${__('Dosage')}: ${row.dosage}`);
		if (row.dosage_form) lines.push(`${__('Form')}: ${row.dosage_form}`);
		if (row.quantity) lines.push(`${__('Quantity')}: ${row.quantity}`);
		if (row.period) lines.push(`${__('Period')}: ${row.period}`);
		if (row.comment) lines.push(row.comment);
		if (row.order_description) lines.push(row.order_description);
		if (row.expected_date_label) lines.push(`${__('Expected')}: ${row.expected_date_label}`);
		return this.render_order_card(title || __('Medication Request'), {
			chips,
			lines,
			subtitle: [row.order_date_label, row.order_time_label].filter(Boolean).join(' • ')
		});
	},

	render_clinical_procedure_card(row) {
		const title = row.procedure_template || row.name || __('Clinical Procedure');
		const chips = [];
		if (row.status) chips.push(`${__('Status')}: ${row.status}`);
		if (row.service_request) chips.push(`${__('Service Request')}: ${row.service_request}`);
		const lines = [];
		if (row.practitioner_name || row.practitioner) lines.push(`${__('Practitioner')}: ${row.practitioner_name || row.practitioner}`);
		if (row.medical_department) lines.push(`${__('Department')}: ${row.medical_department}`);
		if (row.custom_pre_operative_diagnosis) lines.push(`${__('Pre-op')} — ${row.custom_pre_operative_diagnosis}`);
		if (row.custom_post_operative_diagnosis) lines.push(`${__('Post-op')} — ${row.custom_post_operative_diagnosis}`);
		if (row.notes) lines.push(row.notes);
		return this.render_order_card(title, {
			chips,
			lines,
			subtitle: [row.start_date_label, row.start_time_label].filter(Boolean).join(' • ')
		});
	},

	render_order_card(title, options = {}) {
		const safeTitle = this.escape_html(title || __('Order'));
		const chips = (options.chips || [])
			.filter(Boolean)
			.map(text => this.render_chip(text))
			.join('');
		const lines = (options.lines || [])
			.filter(Boolean)
			.map(line => `<li>${this.escape_html(line)}</li>`)
			.join('');
		return `
			<div class="encounter-order-card">
				<div class="encounter-order-card__title">${safeTitle}</div>
				${options.subtitle ? `<div class="encounter-order-card__subtitle">${this.escape_html(options.subtitle)}</div>` : ''}
				${chips ? `<div class="encounter-order-card__chips">${chips}</div>` : ''}
				${lines ? `<ul class="encounter-bullet-list">${lines}</ul>` : ''}
			</div>`;
	},

	render_chip(text) {
		return `<span class="encounter-pill">${this.escape_html(text)}</span>`;
	},

	render_notes_section(notes = {}) {
		const entries = [];
		if (notes.illness_progression) entries.push({ label: __('Illness Progression'), value: notes.illness_progression });
		if (notes.physical_examination) entries.push({ label: __('Physical Examination'), value: notes.physical_examination });
		if (notes.other_examination) entries.push({ label: __('Other Examination'), value: notes.other_examination });
		if (notes.diagnosis_note) entries.push({ label: __('Diagnosis Notes'), value: notes.diagnosis_note });
		if (notes.encounter_comment) entries.push({ label: __('Encounter Notes'), value: notes.encounter_comment });
		if (!entries.length) return '';
		const body = entries.map(entry => `
			<div class="encounter-note-block">
				<div class="encounter-note-block__label">${entry.label}</div>
				<div class="encounter-note-block__body">${this.format_text_block(entry.value)}</div>
			</div>`).join('');
		return this.render_section(__('Clinical Notes'), body);
	},

	render_supporting_files(attachments = [], annotations = []) {
		const sections = [];
		if (attachments.length) {
			const list = attachments
				.filter(item => item.attachment)
				.map(item => {
					const label = item.attachment_name || item.attachment.split('/').pop();
					const href = encodeURI(item.attachment);
					return `<li><a href="${href}" target="_blank" rel="noopener">${this.escape_html(label)}</a></li>`;
				})
				.join('');
			if (list) {
				sections.push(`
					<div class="encounter-sublist">
						<div class="encounter-section__subtitle">${__('Attachments')}</div>
						<ul class="encounter-list">${list}</ul>
					</div>`);
			}
		}
		if (annotations.length) {
			const list = annotations
				.map(item => {
					const label = [item.annotation, item.type].filter(Boolean).join(' • ');
					return `<li>${this.escape_html(label)}</li>`;
				})
				.join('');
			if (list) {
				sections.push(`
					<div class="encounter-sublist">
						<div class="encounter-section__subtitle">${__('Annotations')}</div>
						<ul class="encounter-list">${list}</ul>
					</div>`);
			}
		}
		return sections.length ? this.render_section(__('Supporting Files'), sections.join('')) : '';
	},

	format_text_block(text) {
		const safe = this.escape_html(text || '');
		return safe.replace(/\n/g, '<br>');
	},

	async find_encounter_by_date(patientId, encounterDate) {
		if (!patientId || !encounterDate) return null;
		try {
			const response = await frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Patient Encounter',
					filters: {
						patient: patientId,
						encounter_date: encounterDate,
						docstatus: 1
					},
					fields: ['name'],
					order_by: 'creation desc',
					limit: 1
				}
			});
			return response.message?.length ? response.message[0].name : null;
		} catch (error) {
			console.error('[do_health] Failed to locate encounter by date', error);
			return null;
		}
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
		$wrapper.find('.encounter-tab-title').text(title);
		$wrapper.find('.encounter-tab-content').html(content);
		const activeTab = $wrapper.data('active-tab');
		$wrapper.find('.btn-edit').toggle(!this.is_past_visit(activeTab));
		$wrapper.find(`.encounter-tab-button[data-tab="${title}"]`).addClass('active').siblings().removeClass('active');
	},

	hide_offcanvas($wrapper) {
		$wrapper.find('.encounter-tab-content').empty();
		$wrapper.find('.encounter-tab-title').text('');
		$wrapper.find('.encounter-tab-button').removeClass('active');
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

$(document).on('click', '.visit-section__header', (event) => {
	const $section = $(event.currentTarget).closest('.visit-section');
	$section.toggleClass('is-open');
});

$(document).on('click', '.encounter-panel-toggle-banner', () => {
	const $layout = $('.encounter-layout').first();
	if (!$layout.length) return;
	const $panel = $layout.find('.encounter-side-panel');
	if ($panel.length) {
		const open = $panel.hasClass('is-open-floating') || $panel.hasClass('is-open-mobile');
		do_health.encounter_sidebar.set_panel_open($panel, !open);
	}
});

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
		class: "do-health-patient-banner encounter-surface"
	}).css('--patient-banner-top', `${topPosition}px`);

	const $row = $("<div>", {
		class: "banner-row"
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
		class: "banner-details",
		html: details.join(" <span style='color: #dee2e6; margin: 0 6px;'>|</span> ")
	});

	const $actions = $("<div>", { class: "banner-actions" });
	const isPanelCollapsed = !$('.encounter-layout').first().hasClass('panel-collapsed');
	const $toggle = $("<button>", {
		class: "btn btn-default btn-sm encounter-panel-toggle-banner",
		type: 'button',
		text: isPanelCollapsed ? __('Show Panel') : __('Hide Panel')
	});
	$actions.append($toggle);

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

			do_health.encounter_sidebar.find_encounter_by_date(patient.name, lastVisit)
				.then(encounterName => {
					if (encounterName) {
						do_health.encounter_sidebar.show_encounter_summary(encounterName);
					} else {
						frappe.msgprint(__('Encounter not found'));
					}
				})
				.catch(error => {
					console.error('[do_health] Failed to open encounter summary', error);
					frappe.msgprint(__('Unable to open encounter. Please try again.'));
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
			style: "display: flex; gap: 12px; padding-left: 20px; border-left: 2px solid #e3e8ef;"
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
			style: "display: flex; align-items: center; padding-left: 20px; border-left: 2px solid #e3e8ef;"
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
	$row.append($avatarWrapper, $info, $actions);
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

	// // Adjust form elements to account for sticky banner
	// const bannerHeight = $banner.outerHeight() || 0;
	// const stickyOffset = navbarHeight + pageHeadHeight + bannerHeight;

	// const $formMessage = $(".form-message");
	// const $formTabsList = $(".form-tabs-list");

	// if ($formMessage.length && $formMessage.css("position") === "sticky") {
	// 	$formMessage.css("top", `${stickyOffset}px`);
	// }

	// if ($formTabsList.length && $formTabsList.css("position") === "sticky") {
	// 	$formTabsList.css("top", `${stickyOffset}px`);
	// }

	$(".form-patient-info, .patient-details-section").hide();
}

// --- Bind to Patient Encounter ---
frappe.ui.form.on('Patient Encounter', {
	onload_post_render(frm) {
		function refreshBannerAndFields(patientCtx, updateFields) {
			if (!patientCtx) {
				frappe.new_doc("Patient Encounter");
			};

			// 1️⃣ Update Encounter fields if patient/appointment differ
			if (updateFields) {
				const currentPatient = frm.doc.patient;
				const currentAppointment = frm.doc.appointment;

				// Only update if different (avoid recursion/dirty state)
				if (patientCtx.patient && patientCtx.patient !== currentPatient) {
					frm.set_value("patient", patientCtx.patient);
				}
				if (patientCtx.appointment && patientCtx.appointment !== currentAppointment) {
					frm.set_value("appointment", patientCtx.appointment);
				}
			}


			// 2️⃣ Recreate banner with fade transition for smooth UX
			const $oldBanner = $(".do-health-patient-banner");
			if ($oldBanner.length && frm.doc.patient) {
				$oldBanner.fadeOut(150, function () {
					$(this).remove();
					createPatientInfoBanner(patientCtx);
				});
			} else if (frm.doc.patient) {
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
			window.do_health.patientWatcher.subscribe(refreshBannerAndFields, true);
		}

		// Initial banner if already stored
		const current = window.do_health?.patientWatcher?.read();
		if (current) refreshBannerAndFields(current, false);
	},
	refresh(frm) {
		$(".do-health-patient-banner").remove();
		$(".encounter-side-panel").remove();
		$('body').removeClass('encounter-overlay-open');
		do_health.encounter_sidebar.init(frm);
	},
	patient(frm) {
		if (frm.doc.patient) {
			frm._sidebar_initialized = false;
			do_health.encounter_sidebar.init(frm);
		}
		else {
			$(".do-health-patient-banner").remove();
			$(".encounter-side-panel").remove();
			$('body').removeClass('encounter-overlay-open');
		}
	}
});

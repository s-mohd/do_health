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

// --- Bind to Patient Encounter ---
frappe.ui.form.on('Patient Encounter', {
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

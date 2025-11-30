frappe.ui.form.on('Clinical Procedure', {
	refresh(frm) {
		if (frm.is_new()) return;
		if (!frm.doc.patient) return;

		const label = frm.doc.consent_form ? __('View Consent Form') : __('Consent Form');
		frm.add_custom_button(label, () => open_consent_form_dialog(frm), __('Actions'));
	},
});

async function open_consent_form_dialog(frm) {
	if (frm.is_dirty()) {
		await frm.save();
	}

	try {
		const { message: options } = await frappe.call({
			method: 'do_health.api.consent.get_consent_options',
			args: { procedure_name: frm.doc.name },
		});

		show_consent_dialog(frm, options);
	} catch (error) {
		frappe.msgprint({
			title: __('Consent Form'),
			message: error.message || error,
			indicator: 'red',
		});
	}
}

function show_consent_dialog(frm, options) {
	const templates = options?.templates || [];
	const consents = options?.consents || [];

	const template_options = templates.map(t => ({
		label: t.title || t.name,
		value: t.name,
	}));

	const d = new frappe.ui.Dialog({
		title: __('Consent Form'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'signed_list',
				depends_on: 'eval:true',
				options: render_signed_list(consents),
			},
			{
				label: __('Consent Template'),
				fieldname: 'consent_form_template',
				fieldtype: 'Select',
				options: template_options,
				reqd: 1,
			},
			{
				fieldtype: 'HTML',
				fieldname: 'rendered_html',
				options: '<div class="consent-html" style="max-height:360px; overflow:auto; padding:12px; border:1px solid #d1d8dd; border-radius:4px; margin-top:8px;"></div>',
			},
			{ fieldtype: 'Section Break' },
			{
				label: __('Signed By'),
				fieldname: 'signed_by',
				fieldtype: 'Data',
				reqd: 1,
				default: frm.doc.patient_name || frm.doc.patient,
			},
			{
				label: __('Relationship to Patient'),
				fieldname: 'relationship',
				fieldtype: 'Data',
			},
			{
				label: __('Signature'),
				fieldname: 'signature',
				fieldtype: 'Signature',
				reqd: 1,
			},
		],
		primary_action_label: __('Save & Submit'),
		async primary_action(values) {
			try {
				if (!d._consent_doc) {
					frappe.throw(__('Please select a consent template to continue.'));
				}
				await save_and_submit_consent(d._consent_doc, values);
				d.hide();
				frappe.show_alert({ message: __('Consent form signed'), indicator: 'green' });
				await frm.reload_doc();
			} catch (err) {
				frappe.msgprint({
					title: __('Consent Form'),
					message: err.message || err,
					indicator: 'red',
				});
			}
		},
	});

	const render_target = d.get_field('rendered_html').$wrapper.find('.consent-html');

	const signedByField = d.get_field('signed_by');
	const relationshipField = d.get_field('relationship');

	// wire existing consent links
	d.$wrapper.on('click', '[data-consent]', e => {
		e.preventDefault();
		const name = $(e.currentTarget).data('consent');
		if (name) {
			frappe.set_route('Form', 'Consent Form', name);
		}
	});

	const updatePreview = () => {
		const preview = render_target.find('.consent-signer-preview');
		if (!preview.length) {
			render_target.append(`
				<div class="consent-signer-preview" style="margin-top:12px; padding-top:8px; border-top:1px dashed #d1d8dd;">
					<p><strong>${__('Signed By')}:</strong> <span class="signed-by-text"></span></p>
					<p><strong>${__('Relationship')}:</strong> <span class="relationship-text"></span></p>
				</div>
			`);
		}
		render_target.find('.signed-by-text').text(signedByField.get_value() || '');
		render_target.find('.relationship-text').text(relationshipField.get_value() || '');
	};

	const load_template = async template_name => {
		if (!template_name) return;
		const { message } = await frappe.call({
			method: 'do_health.api.consent.make_consent_form_from_procedure',
			args: { procedure_name: frm.doc.name, template_name },
		});
		if (!message) return;
		show_rendered_html(render_target, message.rendered_html || '');
		d._consent_doc = message;
		updatePreview();
	};

	const templateField = d.get_field('consent_form_template');
	templateField.$input && templateField.$input.on('change', () => {
		load_template(d.get_value('consent_form_template'));
	});

	signedByField.$input && signedByField.$input.on('input', updatePreview);
	relationshipField.$input && relationshipField.$input.on('input', updatePreview);

	// initial load
	if (template_options.length) {
		d.set_value('consent_form_template', template_options[0].value);
		load_template(template_options[0].value);
	}

	d.show();
}

async function save_and_submit_consent(consent, values) {
	const doc = {
		...consent,
		...values,
		doctype: 'Consent Form',
	};

	const insert_res = await frappe.call({
		method: 'frappe.client.insert',
		args: { doc },
	});
	const inserted = insert_res.message;

	await frappe.call({
		method: 'frappe.client.submit',
		// Use the freshly inserted doc to avoid stale modified timestamps
		args: { doc: inserted },
	});
}

function decode_html(html) {
	// Convert escaped HTML (&lt;h3&gt;) back to real markup for display
	const textarea = document.createElement('textarea');
	textarea.innerHTML = html || '';
	return textarea.value;
}

function show_rendered_html(target, html) {
	const decoded_html = decode_html(html);
	target.html(decoded_html);
}

function render_signed_list(consents) {
	if (!consents || !consents.length) {
		return `<div class="text-muted" style="margin-bottom:8px;">${__('No consent forms on record for this procedure yet.')}</div>`;
	}

	const items = consents
		.map(
			c =>
				`<li>
					<strong>${frappe.utils.escape_html(c.consent_form_template || c.name)}</strong>
					- ${__(c.status || '')}
					${c.signed_by ? ` (${__('Signed By')}: ${frappe.utils.escape_html(c.signed_by)})` : ''}
					<a href="#" data-consent="${c.name}">${__('Open')}</a>
				</li>`
		)
		.join('');

	return `
		<div style="margin-bottom:8px;">
			<div style="margin-bottom:4px; font-weight:600;">${__('Existing Consents')}:</div>
			<ul style="padding-left:18px;">${items}</ul>
		</div>`;
}

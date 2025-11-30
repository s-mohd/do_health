// Copyright (c) 2025, Sayed Mohamed and contributors
// For license information, please see license.txt

frappe.ui.form.on('Consent Form', {
	refresh(frm) {
		render_consent_html(frm);
	},
	rendered_html(frm) {
		render_consent_html(frm);
	},
});

function render_consent_html(frm) {
	const field = frm.get_field('rendered_html');
	if (!field || !frm.doc.rendered_html) return;

	const decoded_html = decode_html(frm.doc.rendered_html);
	let preview = field.$wrapper.find('.consent-html-preview');
	if (!preview.length) {
		preview = $(`
			<div class="consent-html-preview"
				style="margin-top:8px; padding:12px; border:1px solid #d1d8dd; border-radius:4px;">
			</div>`);
		field.$wrapper.append(preview);
	}
	preview.html(decoded_html);
}

function decode_html(html) {
	const textarea = document.createElement('textarea');
	textarea.innerHTML = html || '';
	return textarea.value;
}

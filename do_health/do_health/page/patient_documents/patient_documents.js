frappe.pages['patient-documents'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Documents',
		single_column: true
	});
}
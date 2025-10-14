frappe.ui.form.on('Healthcare Service Unit', {
    refresh: function(frm) {
        frm.toggle_display(['address_html', 'contact_html'], !frm.is_new());

        if (!frm.is_new()) {
            frappe.contacts.render_address_and_contact(frm);
            frappe.dynamic_link = {doc: frm.doc, fieldname: 'name', doctype: 'Healthcare Service Unit'};
        } else {
            frappe.contacts.clear_address_and_contact(frm);
        }

        // frm.trigger('set_root_readonly');
        
        frm.set_df_property('service_unit_type', 'reqd', 1);
        frm.add_custom_button(__('Healthcare Service Unit Tree'), function() {
            frappe.set_route('Tree', 'Healthcare Service Unit');
        });

        frm.set_query('warehouse', function() {
            return {
                filters: {
                    'company': frm.doc.company
                }
            };
        });
    }
});
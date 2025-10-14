import frappe
from frappe.desk.search import search_link

@frappe.whitelist()
def link(doctype, filters, limit_page_length=10):
    params = {
        "doctype": doctype,
        "page_length": limit_page_length
    }
    params = {**params, **filters}
    return search_link(**params)

@frappe.whitelist()
def add_child_entry(parent_doctype, parent_doc_name, child_table_fieldname, child_data):
    """
    Adds an entry to a child table of a Frappe DocType.

    :param parent_doctype: Name of the parent DocType.
    :param parent_doc_name: Name of the parent document.
    :param child_table_fieldname: The fieldname of the child table in the parent DocType.
    :param child_data: A dictionary of field values for the child table.
    :return: The newly created child entry.
    """
    # Load the parent document
    parent_doc = frappe.get_doc(parent_doctype, parent_doc_name)

    # Append a new row to the child table
    child_entry = parent_doc.append(child_table_fieldname, child_data)

    # Save the parent document
    parent_doc.save()

    return child_entry

@frappe.whitelist()
def modify_child_entry(parent_doctype, parent_doc_name, child_table_fieldname, filters, update_data):
    """
    Modifies an entry in a child table of a Frappe DocType.
    
    :param parent_doctype: Name of the parent DocType.
    :param parent_doc_name: Name of the parent document.
    :param child_table_fieldname: The fieldname of the child table in the parent DocType.
    :param filters: A dictionary to find the specific child entry (e.g., {'fieldname': 'value'}).
    :param update_data: A dictionary of field values to update in the found child entry.
    :return: The modified child entry, or None if not found.
    """
    # Load the parent document
    parent_doc = frappe.get_doc(parent_doctype, parent_doc_name)
    
    # Access the child table
    child_table = parent_doc.get(child_table_fieldname)
    
    # Find the specific child entry to modify
    for child_entry in child_table:
        match = all(getattr(child_entry, key) == value for key, value in filters.items())
        if match:
            # Update the fields
            for key, value in update_data.items():
                setattr(child_entry, key, value)
            
            # Save the parent document
            parent_doc.save()
            
            return child_entry
    
    return None  # Return None if no matching child entry is found

@frappe.whitelist()
def delete_child_entry(parent_doctype, parent_doc_name, child_table_fieldname, filters):
    """
    Deletes an entry in a child table of a Frappe DocType.
    
    :param parent_doctype: Name of the parent DocType.
    :param parent_doc_name: Name of the parent document.
    :param child_table_fieldname: The fieldname of the child table in the parent DocType.
    :param filters: A dictionary to find the specific child entry to delete (e.g., {'fieldname': 'value'}).
    :return: True if the child entry was deleted, False otherwise.
    """
    # Load the parent document
    parent_doc = frappe.get_doc(parent_doctype, parent_doc_name)
    
    # Access the child table
    child_table = parent_doc.get(child_table_fieldname)
    
    # Filter out the child entry to delete
    updated_child_table = [child for child in child_table if not all(getattr(child, key) == value for key, value in filters.items())]
    
    if len(updated_child_table) < len(child_table):
        # Update the child table
        parent_doc.set(child_table_fieldname, updated_child_table)
        
        # Save the parent document
        parent_doc.save()
        
        return True
    
    return False  # Return False if no matching child entry was found
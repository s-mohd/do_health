from . import __version__ as app_version

app_name = "do_health"
app_title = "Do Health"
app_publisher = "Sayed Mohamed"
app_description = "an extention for the frappe healthcare app"
app_email = "sayed10998@gmail.com"
app_license = "mit"
app_version = "1.0.0"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "do_health",
# 		"logo": "/assets/do_health/logo.png",
# 		"title": "Do Health",
# 		"route": "/do_health",
# 		"has_permission": "do_health.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
app_include_css = [
    "/assets/do_health/css/jquery-ui.min.css",
    "/assets/do_health/css/bootstrap-popover-x.min.css",
    "/assets/frappe/node_modules/air-datepicker/dist/css/datepicker.min.css",
    "/assets/do_health/css/patient_encounter.css",
]
app_include_js = [
    "/assets/do_health/js/apps_switcher.js",
    "/assets/do_health/js/health_sidebar.js",
	"/assets/do_health/js/calendar.js",
	"/assets/do_health/js/lib/imagemapster/jquery.imagemapster.min.js",
	"/assets/do_health/js/lib/p5/p5.min.js",
	"/assets/do_health/js/humanize-duration.js",
	"/assets/do_health/js/jquery-ui.min.js",
	"/assets/do_health/js/bootstrap-popover-x.min.js",
	"/assets/do_health/js/humanize-duration.js",
	"/assets/do_health/js/customscript.js",
	"/assets/frappe/node_modules/air-datepicker/dist/js/datepicker.min.js",
	"/assets/frappe/node_modules/air-datepicker/dist/js/i18n/datepicker.en.js",
	# "/assets/do_health/js/lib/fullcalendar/fullcalendar.min.js"
	# "/assets/do_health/js/patient_appointment.js"
]

# include js, css files in header of web template
# web_include_css = "/assets/do_health/css/do_health.css"
# web_include_js = "/assets/do_health/js/do_health.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "do_health/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
page_js = {"appointment-calendar" : "/assets/frappe/node_modules/air-datepicker/dist/js/datepicker.min.js"}
page_js = {"appointment-calendar" : "/assets/frappe/node_modules/air-datepicker/dist/js/i18n/datepicker.en.js"}
page_js = {"appointment-calendar" : "/assets/frappe/js/frappe/views/calendar/calendar.js"}

# include js in doctype views
doctype_js = {
	# "Patient" : "public/js/patient.js",
	"Patient Appointment" : "public/js/patient_appointment.js",
	"Patient Encounter" : "public/js/patient_encounter.js",
 	# "Clinical Procedure" : "public/js/clinical_procedure.js"
}
doctype_list_js = {
	"Patient Appointment" : "public/js/patient_appointment_list.js"
}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
doctype_calendar_js = {
	"Patient Appointment" : [
		"public/js/patient_appointment_calendar.js",
		"/assets/do_health/js/humanize-duration.js"
	]
}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "do_health/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "do_health.utils.jinja_methods",
# 	"filters": "do_health.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "do_health.install.before_install"
# after_install = "do_health.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "do_health.uninstall.before_uninstall"
# after_uninstall = "do_health.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "do_health.utils.before_app_install"
# after_app_install = "do_health.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "do_health.utils.before_app_uninstall"
# after_app_uninstall = "do_health.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "do_health.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

override_doctype_class = {
    "Patient Appointment": "do_health.overrides.patient_appointment.CustomPatientAppointment",
    "Test Patient Appointment": "do_health.overrides.test_patient_appointment.CustomTestPatientAppointment",
    "Patient Encounter": "do_health.overrides.patient_encounter.CustomPatientEncounter"
}

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
#       "*": {
#               "on_update": "method",
#               "on_cancel": "method",
#               "on_trash": "method"
#       }
    'Patient':{
        "on_update": "do_health.api.events.patient_update"
    },
    'Patient Appointment':{
        "after_insert": "do_health.api.events.patient_appointment_inserted",
        "on_update": "do_health.api.methods.get_appointments"
    },
    'Patient Encounter':{
        "after_insert": "do_health.api.events.patient_encounter_inserted",
        "on_update": "do_health.api.events.patient_encounter_update",
        "on_submit": "do_health.api.events.patient_encounter_submit"
    },
    'Clinical Procedure':{
        "on_update": "do_health.api.events.clinical_procedure_update",
    },
    'Service Request':{
        "on_update": "do_health.api.methods.get_services"
    },
    'Medication Request':{
        "on_update": "do_health.api.events.medication_request_update",
        "on_submit": "do_health.api.events.medication_request_update"
    },
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"do_health.tasks.all"
# 	],
# 	"daily": [
# 		"do_health.tasks.daily"
# 	],
# 	"hourly": [
# 		"do_health.tasks.hourly"
# 	],
# 	"weekly": [
# 		"do_health.tasks.weekly"
# 	],
# 	"monthly": [
# 		"do_health.tasks.monthly"
# 	],
# }

scheduler_events = {
    "all": [
        "do_health.api.methods.mark_no_show_appointments"
    ],
}

# Testing
# -------

# before_tests = "do_health.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "do_health.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "do_health.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["do_health.utils.before_request"]
# after_request = ["do_health.utils.after_request"]

# Job Events
# ----------
# before_job = ["do_health.utils.before_job"]
# after_job = ["do_health.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"do_health.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

fixtures = [
    {"dt": "Custom Field", "filters": {"module": "Do Health"}},
	{"dt": "Property Setter", "filters": {"module": "Do Health"}},
]
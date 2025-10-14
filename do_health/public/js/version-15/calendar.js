// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
// MIT License. See license.txt

frappe.provide("frappe.views.calendar");
frappe.provide("frappe.views.calendars");

frappe.views.CalendarView = class CalendarView extends frappe.views.ListView {
	static load_last_view() {
		const route = frappe.get_route();
		if (route.length === 3) {
			const doctype = route[1];
			const user_settings = frappe.get_user_settings(doctype)['Calendar'] || {};
			route.push(user_settings.last_calendar || 'default');
			frappe.set_route(route);
			return true;
		} else {
			return false;
		}
	}

	toggle_result_area() { }

	get view_name() {
		return 'Calendar';
	}

	setup_defaults() {
		return super.setup_defaults()
			.then(() => {
				this.page_title = __('{0} Calendar', [this.page_title]);
				this.calendar_settings = frappe.views.calendar[this.doctype] || {};
				this.calendar_name = frappe.get_route()[3];
			});
	}

	setup_page() {
		this.hide_page_form = true;
		super.setup_page();
	}

	setup_view() {

	}

	before_render() {
		super.before_render();
		this.save_view_user_settings({
			last_calendar: this.calendar_name
		});
	}

	render() {
		if (this.calendar) {
			this.calendar.refresh();
			return;
		}

		this.load_lib
			.then(() => this.get_calendar_preferences())
			.then(options => {
				this.calendar = new frappe.views.Calendar(options);
			});
	}

	get_calendar_preferences() {
		const options = {
			doctype: this.doctype,
			parent: this.$result,
			page: this.page,
			list_view: this
		};
		const calendar_name = this.calendar_name;

		return new Promise(resolve => {
			if (calendar_name === 'default') {
				Object.assign(options, frappe.views.calendar[this.doctype]);
				resolve(options);
			} else {
				frappe.model.with_doc('Calendar View', calendar_name, () => {
					const doc = frappe.get_doc('Calendar View', calendar_name);
					if (!doc) {
						frappe.show_alert(__("{0} is not a valid Calendar. Redirecting to default Calendar.", [calendar_name.bold()]));
						frappe.set_route("List", this.doctype, "Calendar", "default");
						return;
					}
					Object.assign(options, {
						field_map: {
							id: "name",
							start: doc.start_date_field,
							end: doc.end_date_field,
							title: doc.subject_field,
							allDay: doc.all_day ? 1 : 0
						}
					});
					resolve(options);
				});
			}
		});
	}

	get required_libs() {
		let assets = [
			'assets/do_health/js/lib/fullcalendar/fullcalendar.min.css',
			'assets/do_health/js/lib/fullcalendar/scheduler.min.css',
			'assets/do_health/js/lib/fullcalendar/fullcalendar.min.js',
			'assets/do_health/js/lib/fullcalendar/scheduler.min.js',
			'assets/do_health/js/lib/fullcalendar/locale-all.js',
		];
		// let user_language = frappe.boot.user.language;
		// if (user_language && user_language !== 'en') {
		// 	assets.push('assets/frappe/js/lib/fullcalendar/locale-all.js');
		// }
		return assets;
	}
};

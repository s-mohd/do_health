frappe.after_ajax(() => {
    frappe.ui.AppsSwitcher.prototype.set_current_app = function (app) {

        const saved = localStorage.getItem("do_health_sidebar_mode");
        // Switch sidebar and refresh page
        if (app === "do_health") {
            if (saved !== 'health') {
                localStorage.setItem("do_health_sidebar_mode", 'health');
                document.body.classList.add("do-health-sidebar-active");
                // window.location.reload();
            }
            return;
        }

        if (!app) {
            console.warn("set_current_app: app not defined");
            return;
        }
        let app_data = frappe.boot.app_data_map[app] || frappe.boot.app_data_map["frappe"];

        this.sidebar_wrapper
            .find(".app-switcher-dropdown .sidebar-item-icon img")
            .attr("src", app_data.app_logo_url);
        this.sidebar_wrapper
            .find(".app-switcher-dropdown .sidebar-item-label")
            .html(app_data.app_title);

        frappe.frappe_toolbar.set_app_logo(app_data.app_logo_url);

        if (frappe.current_app === app) return;
        frappe.current_app = app;

        // re-render the sidebar
        frappe.app.sidebar.make_sidebar();
    };
});

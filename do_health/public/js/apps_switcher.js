frappe.after_ajax(() => {
    let manual_switch = false;

    // Intercept clicks on the app switcher menu
    $(document).on("click", ".app-switcher-menu .app-item", () => {
        manual_switch = true;
    });

    const orig_set_current_app = frappe.ui.AppsSwitcher.prototype.set_current_app;

    frappe.ui.AppsSwitcher.prototype.set_current_app = function (app) {
        const saved = localStorage.getItem("last_chosen_app") || "do_health";

        if (manual_switch) {
            // user explicitly clicked another app
            localStorage.setItem("last_chosen_app", app);
            
            // Refresh page when navigating to do_health to avoid bugs and lags
            if (app === "do_health") {
                window.location.reload();
                return;
            }
            
            manual_switch = false; // reset flag
        } else {
            // auto-switch (route change etc.) → ignore and stick to saved app
            app = saved;
        }

        const app_data = frappe.boot.app_data_map[app] || frappe.boot.app_data_map["frappe"];

        this.sidebar_wrapper
            .find(".app-switcher-dropdown .sidebar-item-icon img")
            .attr("src", app_data.app_logo_url);
        this.sidebar_wrapper
            .find(".app-switcher-dropdown .sidebar-item-label")
            .html(app_data.app_title);

        frappe.frappe_toolbar.set_app_logo(app_data.app_logo_url);

        frappe.current_app = app;

        frappe.app.sidebar.make_sidebar();
    };

    // Also patch set_default_app so reload respects saved
    frappe.ui.Sidebar.prototype.set_default_app = function () {
        const saved = localStorage.getItem("last_chosen_app") || "do_health";
        if (frappe.boot.app_data_map?.[saved]) {
            frappe.current_app = saved;
            frappe.frappe_toolbar.set_app_logo(frappe.boot.app_data_map[saved].app_logo_url);
        } else {
            frappe.current_app = "do_health"; // fallback
        }
    };
});

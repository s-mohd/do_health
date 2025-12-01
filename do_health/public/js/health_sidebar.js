(() => {
    const SIDEBAR_CONFIG = frappe.boot?.health_sidebar_config || {
        primary_nav: [],
        patient_actions: []
    };

    const STORAGE_KEYS = {
        patient: "do_health_active_patient",
        mode: "do_health_sidebar_mode",
        secondary: "do_health_secondary_collapsed"
    };

    const SELECTORS = {
        shell: "#do-health-sidebar",
        nav: "#do-health-primary-nav",
        selected: "#do-health-selected",
        waitingList: "#do-health-waiting-list",
        waitingCount: "#do-health-waiting-count",
        restoreButton: ".do-health-sidebar__restore",
        secondary: "#do-health-secondary",
        secondaryToggle: "[data-secondary-toggle]",
        refreshWaiting: "[data-refresh-waiting]",
        brandBadge: ".do-health-sidebar__brand-badge"
    };

    const state = {
        waiting: [],
        mode: loadSidebarMode(),
        selectedPatient: null,
        initialized: false,
        realtimeRegistered: false,
        secondaryCollapsed: loadSecondaryCollapsed()
    };

    const OVERVIEW_DRAWER_ID = "do-health-patient-overview";
    const overviewState = {
        $overlay: null,
        currentPatient: null,
        watcherUnsub: null,
        isOpen: false
    };

    const translate = (...args) => (typeof __ === "function" ? __(...args) : args[0]);

    const isValidDate = (value) => value && !Number.isNaN(new Date(value).getTime());

    let appSwitcherListenerRegistered = false;

    function loadSidebarMode() {
        return localStorage.getItem(STORAGE_KEYS.mode) || "health";
    }

    function saveSidebarMode(mode) {
        state.mode = mode;
        localStorage.setItem(STORAGE_KEYS.mode, mode);
        applySidebarMode(mode);
    }

    function loadSecondaryCollapsed() {
        return localStorage.getItem(STORAGE_KEYS.secondary) === "1";
    }

    function saveSecondaryCollapsed(collapsed) {
        localStorage.setItem(STORAGE_KEYS.secondary, collapsed ? "1" : "0");
    }

    function applySidebarMode(mode) {
        if (mode === "health") {
            document.body.classList.add("do-health-sidebar-active");
        } else {
            document.body.classList.remove("do-health-sidebar-active");
        }
    }

    function applySecondaryCollapsed(collapsed) {
        const $shell = $(SELECTORS.shell);
        if (!$shell.length) return;
        $shell.attr("data-secondary-collapsed", collapsed ? "true" : "false");

        const $toggle = $(SELECTORS.secondaryToggle);
        if ($toggle.length) {
            $toggle
                .attr(
                    "aria-label",
                    collapsed ? translate("Show Patient Panel") : translate("Hide Patient Panel")
                )
                .toggleClass("is-collapsed", collapsed);
        }
    }

    function setSecondaryCollapsed(collapsed) {
        state.secondaryCollapsed = !!collapsed;
        saveSecondaryCollapsed(state.secondaryCollapsed);
        applySecondaryCollapsed(state.secondaryCollapsed);
    }

    function normalizePatient(patient = {}) {
        const patientId = patient.patient || patient.name;
        if (!patientId) return null;

        return {
            patient: patientId,
            patient_name: patient.patient_name || patientId,
            appointment: patient.name || null,
            ...patient
        };
    }

    function getSavedPatientContext() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.patient);
            if (!raw) return null;
            return normalizePatient(JSON.parse(raw));
        } catch (error) {
            console.warn("[do_health] Failed to parse patient context", error);
            return null;
        }
    }

    function savePatientContext(patient) {
        if (!patient) return;
        localStorage.setItem(STORAGE_KEYS.patient, JSON.stringify(patient));
        window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.patient }));
    }

    function clearPatientContext() {
        localStorage.removeItem(STORAGE_KEYS.patient);
        state.selectedPatient = null;
        $(".do-health-waiting-item.active").removeClass("active");
        renderSelectedPatient(null);
    }

    function formatMinutesSince(arrivalTime) {
        if (!isValidDate(arrivalTime)) return "";
        const arrival = new Date(arrivalTime).getTime();
        const diffMinutes = Math.max(Math.floor((Date.now() - arrival) / 60000), 0);
        if (diffMinutes < 1) return "<1m";
        if (diffMinutes >= 60) {
            const hours = Math.floor(diffMinutes / 60);
            const mins = diffMinutes % 60;
            return `${hours}h ${mins}m`;
        }
        return `${diffMinutes}m`;
    }

    function iconMarkup(name, size = "md") {
        // if (frappe?.utils?.icon) {
        //     return frappe.utils.icon(name, size);
        // }
        // const symbolId = name?.startsWith("es-") ? name : `icon-${name || "circle"}`;
        // return `<svg class="icon icon-${size}"><use href="#${symbolId}"></use></svg>`;
        return `<i class="${name}"></i>`;
    }

    let sidebarMountAttempts = 0;
    const MAX_SIDEBAR_MOUNT_ATTEMPTS = 40;

    function getBrandLogoMarkup() {
        frappe.db.get_single_value('Global Defaults', 'default_company').then(default_company => {
            if (default_company) {
                frappe.db.get_value("Company", default_company, ['abbr', 'company_logo']).then(r => {
                    if (r.message.company_logo) {
                        $('.do-health-sidebar__brand-badge').html(`<img src="${r.message.company_logo}" alt="Do Health" />`);
                        return `<img src="${r.message.company_logo}" alt="Do Health" />`;
                    }
                    $('.do-health-sidebar__brand-badge').html(`<span>${r.message.abbr}</span>`);
                    return `<span>${r.message.abbr}</span>`;
                });
            }
            $('.do-health-sidebar__brand-badge').html(`<span>DH</span>`);
            return `<span>DH</span>`;
        });
    }

    function mountSidebarShell() {
        const $bodyContainer = $(".body-container").length
            ? $(".body-container")
            : $("body");

        if (!$bodyContainer.length) {
            if (sidebarMountAttempts < MAX_SIDEBAR_MOUNT_ATTEMPTS) {
                sidebarMountAttempts += 1;
                setTimeout(mountSidebarShell, 200);
            } else {
                console.warn("[do_health] Unable to locate .body-container for custom shell.");
            }
            return false;
        }

        if ($(SELECTORS.shell).length) {
            return true;
        }

        const sidebar = $(`
            <div id="do-health-sidebar" data-secondary-collapsed="false">
                <div class="do-health-primary-rail">
                    <button class="do-health-sidebar__brand-badge" type="button"></button>
                    <div class="do-health-primary-nav" id="do-health-primary-nav"></div>
                </div>
                <div class="do-health-secondary-wrapper">
                    <div class="do-health-sidebar__secondary" id="do-health-secondary">
                        <div class="do-health-selected" id="do-health-selected"></div>
                        <div class="do-health-secondary__section do-health-secondary__waiting">
                            <div class="do-health-section__header">
                                <span>${translate("Waiting List")}</span>
                                <div class="do-health-section__actions">
                                    <div class="do-health-chip do-health-chip--time" id="do-health-waiting-count">0</div>
                                    <button class="do-health-section__refresh" type="button" data-refresh-waiting>
                                        ${translate("Refresh")}
                                    </button>
                                </div>
                            </div>
                            <div class="do-health-scroll do-health-waiting__scroll">
                                <div class="do-health-waiting__list" id="do-health-waiting-list"></div>
                            </div>
                        </div>
                    </div>
                    <button class="do-health-secondary-toggle" type="button" data-secondary-toggle aria-label="${translate(
            "Hide Patient Panel"
        )}">
                        <span class="chevron"></span>
                    </button>
                </div>
            </div>
        `);

        getBrandLogoMarkup();

        const restoreButton = $(`
            <button type="button" class="btn btn-sm btn-default do-health-sidebar__restore">
                ${translate("Health Sidebar")}
            </button>
        `);

        sidebar.find(SELECTORS.refreshWaiting).on("click", () => fetchWaitingPatients());
        sidebar.find(SELECTORS.secondaryToggle).on("click", () => {
            setSecondaryCollapsed(!state.secondaryCollapsed);
        });
        sidebar.find(SELECTORS.brandBadge).on("click", (event) => {
            event.preventDefault();
            openAppSwitcher();
        });

        $bodyContainer.prepend(sidebar);
        $("body").append(restoreButton);
        applySecondaryCollapsed(state.secondaryCollapsed);
        return true;
    }

    function openAppSwitcher() {
        const $badge = $(SELECTORS.brandBadge);
        if (!$badge.length) return;

        const $nativeToggle =
            $(".app-switcher-dropdown .drop-icon button, .app-switcher-dropdown .drop-icon").first() ||
            $(".navbar .app-switcher button, .navbar .app-logo").first();

        const closeOverlay = () => {
            $("#do-health-appswitcher-overlay").fadeOut(150, function () {
                $(this).remove();
            });
            $("#do-health-appswitcher-clone").fadeOut(150, function () {
                $(this).remove();
            });
        };

        const positionClone = ($clone) => {
            const badgeOffset = $badge.offset();
            const badgeHeight = $badge.outerHeight();
            const dropdownWidth = $clone.outerWidth();
            const viewportWidth = $(window).width();

            const left = Math.min(
                Math.max(12, (badgeOffset?.left || 0) - dropdownWidth / 2 + $badge.outerWidth() / 2),
                viewportWidth - dropdownWidth - 12
            );

            $clone.css({
                position: "absolute",
                top: (badgeOffset?.top || 0) + badgeHeight + 8,
                left,
                zIndex: 1051,
                borderRadius: "12px",
                boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
                backdropFilter: "blur(10px)",
            });
        };

        const attachOverlay = () => {
            if ($("#do-health-appswitcher-overlay").length) return;
            $("<div>", {
                id: "do-health-appswitcher-overlay",
                css: {
                    position: "fixed",
                    inset: 0,
                    zIndex: 1050,
                    background: "rgba(0,0,0,0.35)",
                    backdropFilter: "blur(4px)",
                },
            })
                .appendTo("body")
                .on("click", closeOverlay)
                .hide()
                .fadeIn(120);
        };

        const wireLinks = ($menu) => {
            $menu.find("a").each((_, link) => {
                $(link).on("click", function () {
                    const label = ($(this).text() || "").toLowerCase();
                    const currentMode = localStorage.getItem("do_health_sidebar_mode");
                    if (label.trim() !== "do health" && currentMode === "health") {
                        saveSidebarMode("standard");
                    }
                    closeOverlay();
                });
            });
        };

        const attemptClone = () => {
            let $menu = $(".app-switcher-menu").first();
            const menuHidden = !$menu.is(":visible");

            if (!$menu.length && $nativeToggle.length) {
                $nativeToggle.trigger("click");
                $menu = $(".app-switcher-menu").first();
            }
            if (!$menu.length) return false;

            if (menuHidden && $nativeToggle.length) $nativeToggle.trigger("click");

            const $clone = $menu.clone(true, true).attr("id", "do-health-appswitcher-clone");

            $("body").append($clone);
            positionClone($clone);
            wireLinks($clone);
            attachOverlay();

            $clone.hide().fadeIn(120);
            return true;
        };

        if (attemptClone()) return;

        // fallback list
        const apps = (frappe.boot?.apps || []).filter(Boolean);
        if (!apps.length) {
            frappe.msgprint(translate("No apps available."));
            return;
        }

        const overlay = $("<div>", {
            id: "do-health-appswitcher-overlay",
            class: "do-health-appswitcher-overlay",
        }).css({
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(5px)",
            zIndex: 1050,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        });

        const list = $("<div>", { class: "do-health-appswitcher" }).css({
            display: "flex",
            flexDirection: "column",
            background: "rgba(15,23,42,0.98)",
            padding: "1rem",
            borderRadius: "14px",
            minWidth: "240px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        });

        apps.forEach((app) => {
            $("<button>", {
                text: app.app_title || app.app_name,
                class: "do-health-appswitcher__item",
            })
                .css({
                    background: "transparent",
                    border: "none",
                    color: "#e5e7eb",
                    fontSize: "13px",
                    fontWeight: 600,
                    padding: "0.6rem 0.8rem",
                    borderRadius: "8px",
                    textAlign: "left",
                    transition: "all 0.2s",
                })
                .hover(
                    function () {
                        $(this).css({ background: "#16a34a", color: "#fff" });
                    },
                    function () {
                        $(this).css({ background: "transparent", color: "#e5e7eb" });
                    }
                )
                .on("click", () => {
                    overlay.fadeOut(150, () => overlay.remove());
                    if (app.app_name !== "do_health") saveSidebarMode("standard");
                    frappe.set_route(app.route || `/app/${app.app_name.replace(/_/g, "-")}`);
                })
                .appendTo(list);
        });

        overlay.append(list).on("click", (e) => {
            if (e.target === overlay[0]) overlay.fadeOut(150, () => overlay.remove());
        });

        $("body").append(overlay.hide().fadeIn(150));
    }

    function renderPrimaryNav() {
        const $nav = $(SELECTORS.nav);
        if (!$nav.length) return;

        const items = SIDEBAR_CONFIG.primary_nav || [];
        if (!items.length) {
            $nav.html(
                `<div class="do-health-empty">${translate(
                    "Add Health Sidebar Items (Section: Primary Nav) to populate this area."
                )}</div>`
            );
            return;
        }

        $nav.empty();
        items.forEach((item) => {
            const button = $("<button>", {
                type: "button",
                class: "do-health-nav-button",
                "data-item": item.name || item.label || ""
            })
                .append(
                    $("<span>", { class: "do-health-nav-icon" }).html(
                        iconMarkup(item.icon || "es-workspace", "md")
                    ),
                    $("<span>", { text: item.label || item.route_value })
                )
                .on("click", () => {
                    navigateToItem(item, state.selectedPatient);
                    setActiveNav(item);
                });

            $nav.append(button);
        });

        syncActiveNavWithRoute();
    }

    function setActiveNav(item) {
        const identifier = item.name || item.route_value || item.label;
        state.activeNav = identifier;
        updateActiveNavHighlight();
    }

    function updateActiveNavHighlight() {
        const current = state.activeNav;
        const $buttons = $(SELECTORS.nav).find("button");

        $buttons.each((_, el) => {
            const $button = $(el);
            $button.toggleClass("active", $button.data("item") === current);
        });
    }

    function syncActiveNavWithRoute() {
        const route = frappe.get_route();
        if (!route) return;
        const items = SIDEBAR_CONFIG.primary_nav || [];
        const active = items.find((item) => {
            const type = (item.route_type || "Workspace").toLowerCase();
            if (type === "workspace") {
                return route[0] === "Workspaces" && route[1] === item.route_value;
            }
            if (type === "page") {
                return route[0] === item.route_value;
            }
            if (type === "form") {
                return route[0] === "Form" && route[1] === item.route_value;
            }
            if (type === "report") {
                return route[0] === "query-report" && route[1] === item.route_value;
            }
            return false;
        });

        state.activeNav = active ? active.name || active.route_value || active.label : null;
        updateActiveNavHighlight();
    }

    function renderSelectedPatient(patient) {
        const $container = $(SELECTORS.selected);
        if (!$container.length) return;

        $container.empty();

        if (!patient) {
            $container.append(
                $("<div>", { class: "do-health-selected__empty" }).text(
                    translate("Select a patient from the calendar or waiting list to see details.")
                )
            );
            return;
        }

        const initials = (patient.patient_name || patient.patient)
            .split(" ")
            .map((word) => word[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

        const headerMetaParts = [];
        if (patient.dob) {
            headerMetaParts.push(`${__('Age')}: ${moment().diff(patient.dob, 'years')}`);
        }
        if (patient.custom_file_number) {
            headerMetaParts.push(`${__('File')}: ${patient.custom_file_number}`);
        }
        if (patient.custom_cpr) {
            headerMetaParts.push(`${__('CPR')}: ${patient.custom_cpr}`);
        }
        if (patient.mobile) {
            headerMetaParts.push(patient.mobile);
        }
        const headerMeta = headerMetaParts.join(' | ');

        const header = $("<div>", { class: "do-health-selected__header" }).append(
            $("<div>", { class: "do-health-selected__avatar", text: patient.patient_image ? '' : initials }).append(
                patient.patient_image ? $("<img>", { src: patient.patient_image, alt: "Patient Avatar" }) : null
            ),
            $("<div>", { class: "do-health-selected__info" }).append(
                $("<div>", { class: "do-health-selected__name", text: patient.patient_name }),
                $("<div>", {
                    class: "do-health-selected__meta",
                    text: `${headerMetaParts}`
                })
            ),
            $("<button>", {
                class: "do-health-selected__clear",
                type: "button",
                "aria-label": translate("Clear selection")
            })
                .html("&times;")
                .on("click", clearPatientContext)
        );

        const $actions = $("<div>", { class: "do-health-selected-actions" });
        renderPatientActions(patient, $actions);

        const $footer = $("<div>", { class: "do-health-selected-footer" });
        const footerItems = SIDEBAR_CONFIG.patient_actions.filter(item => !!item.is_footer_action) || [];
        footerItems.forEach((item) => {
            let $action = $("<button>", {
                class: `do-health-footer-btn ${item.label == 'Encounter' ? 'btn-success' : item.label == 'Procedure' ? 'btn-warning' : item.label == 'Chart' ? 'btn-info' : ''}`,
                type: "button",
                text: translate(item.label)
            })

            if (item.label == 'Notes') {
                $action = $("<button>", {
                    class: "do-health-footer-btn ghost",
                    type: "button",
                }).append($('<i class="fa-regular fa-message-lines fa-lg"></i>'))
            }

            if (item.label == 'Encounter') {
                $action.on("click", () => navigateToEncounter(patient))
            }
            else if (item.label == 'Procedure') {
                $action.on("click", () => navigateToProcedure(patient))
            }
            else if (item.label == 'Chart') {
                $action.on("click", () => frappe.set_route("chart"))
            }

            $footer.append($action);
        });

        $container.append(header, $actions, $footer);
    }

    function renderPatientActions(patient, $container) {
        if (!$container?.length) return;
        const items = SIDEBAR_CONFIG.patient_actions.filter(item => !item.is_footer_action || item.is_footer_action == 0) || [];
        $container.empty();

        if (!items.length) {
            $container.append(
                $("<div>", { class: "do-health-empty" }).text(
                    translate("Add Health Sidebar Items (Section: Patient Actions) to display actions here.")
                )
            );
            return;
        }

        items.forEach((item) => {
            const requiresPatient = !!item.requires_patient;
            const disabled = requiresPatient && !patient;

            const $action = $("<button>", {
                class: `do-health-selected-action ${disabled ? "disabled" : ""}`,
                type: "button",
                "data-action": item.name || item.label
            }).append(
                $("<span>", { class: "do-health-selected-action__icon" }).html(
                    iconMarkup(item.icon || "es-list", "md")
                ),
                $("<span>", { class: "do-health-selected-action__label", text: item.label }),
                $("<span>", { class: "do-health-selected-action__chevron" })
            );

            const $badge = $("<div>", { class: "do-health-chip do-health-chip--time d-none" });

            if (item.badge_method && (!requiresPatient || patient)) {
                fetchActionBadge(item, patient).then((value) => {
                    if (!value && value !== 0) return;
                    $badge.text(value).removeClass("d-none");
                });
            }

            $action.append($badge);

            if (!disabled) {
                const isOverview = (item.route_value || "").toLowerCase() === "patient-overview";
                const isBilling = (item.label || "").toLowerCase() === "billing";
                if (isOverview) {
                    $action.on("click", () => openPatientOverviewDrawer(patient));
                } else if (isBilling) {
                    $action.on("click", () => openBillingForPatient(patient));
                } else {
                    $action.on("click", () => navigateToItem(item, patient));
                }
            } else {
                $action.attr("title", translate("Select a patient first"));
            }

            $container.append($action);
        });

        // const $interactive = $container
        //     .children(".do-health-selected-action")
        //     .filter((_, el) => !$(el).hasClass("disabled"));
        // $interactive.first().addClass("active");
    }

    async function openPatientOverviewDrawer(patient) {
        const normalized = normalizePatient(patient) || patient;
        if (!normalized?.patient) {
            frappe.msgprint(translate("Select a patient first."));
            return;
        }

        ensureOverviewDrawerShell();
        overviewState.isOpen = true;
        overviewState.currentPatient = normalized.patient;

        overviewState.$overlay.addClass("is-open");
        showOverviewLoading(translate("Loading patient overview..."));
        attachOverviewWatcher();

        await loadPatientOverview(normalized);
    }

    async function loadPatientOverview(patient) {
        const normalized = normalizePatient(patient) || patient;
        if (!normalized?.patient) {
            showOverviewLoading(translate("Select a patient first."));
            return;
        }

        overviewState.currentPatient = normalized.patient;
        showOverviewLoading(translate("Loading patient overview..."));

        try {
            const { message } = await frappe.call({
                method: "do_health.api.methods.get_patient_overview",
                args: {
                    patient: normalized.patient,
                    appointment: normalized.appointment || null
                }
            });
            renderPatientOverview(message || {}, normalized);
        } catch (error) {
            console.warn("[do_health] Failed to load patient overview", error);
            const $content = overviewState.$overlay?.find(".do-health-overview__content");
            if ($content?.length) {
                $content.html(
                    `<div class="do-health-overview__empty">${translate("Unable to load patient overview.")}</div>`
                );
            }
        }
    }

    function renderPatientOverview(data, patientContext) {
        ensureOverviewDrawerShell();
        const $overlay = overviewState.$overlay;
        const $content = $overlay.find(".do-health-overview__content");
        const info = data.patient || {};
        const contact = data.contact || {};
        const emergency = data.emergency_contact || {};
        const appointment = data.upcoming_appointment;
        const encounter = data.last_encounter;
        const vitals = Array.isArray(data.vitals) ? data.vitals : [];
        const counts = data.counts || {};
        const relations = Array.isArray(data.relations) ? data.relations : [];

        const patientName = info.patient_name || patientContext?.patient_name || patientContext?.patient || translate("Patient");
        const gender = info.gender || "";
        const metaPieces = [];
        if (info.age || info.age === 0) metaPieces.push(`${info.age} ${translate("Y")}`);
        if (gender) metaPieces.push(gender);
        const metaLabel = metaPieces.join(" • ");

        const chips = [];
        if (info.file_number) chips.push(buildChip(translate("File") + ": " + info.file_number));
        if (info.cpr) chips.push(buildChip("CPR: " + info.cpr));
        if (info.blood_group) chips.push(buildChip(translate("Blood") + ": " + info.blood_group));

        const contactChips = [];
        if (contact.phone) contactChips.push(buildLinkChip(contact.phone, `tel:${contact.phone}`, "fa-regular fa-phone"));
        if (contact.secondary_phone) contactChips.push(buildLinkChip(contact.secondary_phone, `tel:${contact.secondary_phone}`, "fa-regular fa-phone"));
        if (contact.email) contactChips.push(buildLinkChip(contact.email, `mailto:${contact.email}`, "fa-regular fa-envelope"));

        const avatarInitials = (patientName || "")
            .split(" ")
            .map((word) => word[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

        const headerHtml = `
            <div class="do-health-overview__hero-card">
                <div class="do-health-overview__avatar">
                    ${info.patient_image ? `<img src="${escapeHtml(info.patient_image)}" alt="${escapeHtml(patientName)}" />` : escapeHtml(avatarInitials || "?")}
                </div>
                <div class="do-health-overview__hero-text">
                    <div class="do-health-overview__eyebrow">${translate("Patient Details")}</div>
                    <div class="do-health-overview__name">${escapeHtml(patientName)}</div>
                    ${metaLabel ? `<div class="do-health-overview__muted">${escapeHtml(metaLabel)}</div>` : ""}
                    ${chips.length ? `<div class="do-health-overview__chip-row">${chips.join("")}</div>` : ""}
                    ${contactChips.length ? `<div class="do-health-overview__chip-row contact">${contactChips.join("")}</div>` : ""}
                </div>
                <div class="do-health-overview__cta">
                    <button class="do-health-overview__btn" type="button" data-open-patient-record>
                        ${translate("Open Record")}
                    </button>
                </div>
            </div>
        `;

        const visitCard = buildOverviewCard(
            translate("Visit Info"),
            appointment
                ? [
                    infoRow(translate("Date & Time"), [appointment.appointment_date_label, appointment.appointment_time_label].filter(Boolean).join(" • "), "fa-regular fa-calendar"),
                    infoRow(translate("Practitioner"), appointment.practitioner_name || appointment.practitioner, "fa-regular fa-user-doctor"),
                    infoRow(translate("Reason"), appointment.custom_visit_reason || translate("Not recorded"), "fa-regular fa-clipboard-list"),
                ].join("")
                : `<div class="do-health-overview__empty">${translate("No upcoming appointments found")}</div>`,
            {
                badge: appointment.status || appointment.custom_visit_status,
                actionLabel: appointment.name ? translate("Open Appointment") : null,
                actionAttr: appointment.name ? "data-open-appointment" : null
            }
        );

        const encounterCard = buildOverviewCard(
            translate("Last Encounter"),
            encounter
                ? [
                    infoRow(translate("Date"), [encounter.encounter_date_label, encounter.encounter_time_label].filter(Boolean).join(" • "), "fa-regular fa-clock"),
                    infoRow(translate("Practitioner"), encounter.practitioner_name || encounter.practitioner || translate("Not recorded"), "fa-regular fa-user-md"),
                    infoRow(translate("Department"), encounter.medical_department || translate("Not recorded"), "fa-regular fa-building")
                ].join("")
                : `<div class="do-health-overview__empty">${translate("No encounters found")}</div>`,
            {
                badge: encounter?.status,
                actionLabel: encounter?.name ? translate("Open Encounter") : null,
                actionAttr: encounter?.name ? "data-open-encounter" : null
            }
        );

        const emergencyCard = buildOverviewCard(
            translate("Emergency Contact"),
            buildEmergencyContact(emergency)
        );

        const statsCard = buildOverviewCard(
            translate("At a Glance"),
            `
                <div class="do-health-overview__stats">
                    <div><div class="label">${translate("Appointments")}</div><div class="value">${counts.appointments || 0}</div></div>
                    <div><div class="label">${translate("Encounters")}</div><div class="value">${counts.encounters || 0}</div></div>
                </div>
            `
        );

        const relationsCard = buildRelationsCard(relations);
        const vitalsBlock = buildVitalsBlock(vitals);

        $content.html(`
            ${headerHtml}

            <div class="do-health-overview__grid">
                <!-- LEFT COLUMN -->
                <div class="do-health-overview__grid-main">
                    <div class="do-health-overview__card-stack">
                        ${visitCard}
                    </div>
                    <div class="do-health-overview__card-stack">
                        ${statsCard}
                    </div>
                </div>

                <!-- RIGHT COLUMN -->
                <div class="do-health-overview__grid-side">
                    <div class="do-health-overview__card-stack">
                        ${encounterCard}
                    </div>
                    <div class="do-health-overview__card-stack">
                        ${emergencyCard}
                    </div>
                </div>
            </div>

            <div class="do-health-overview__relations-row">
                ${relationsCard}
            </div>

            ${buildTabbedSection([
            { id: "vitals", label: translate("Vitals"), content: vitalsBlock || "" },
            { id: "medical", label: translate("Medical Records"), content: buildComingSoon(translate("Medical records summary coming soon.")) },
            { id: "medications", label: translate("Medications"), content: buildComingSoon(translate("Medication history coming soon.")) },
            { id: "labs", label: translate("Lab Test Results"), content: buildComingSoon(translate("Lab results summary coming soon.")) },
        ])}
        `);

        $content.find("[data-open-patient-record]").on("click", () => {
            frappe.set_route("Form", "Patient", info.name || patientContext?.patient);
            closePatientOverviewDrawer();
        });
        $content.find("[data-close-overview]").on("click", closePatientOverviewDrawer);
        $content.find("[data-add-relation]").on("click", () => {
            openAddRelationDialog(info.name || patientContext?.patient);
        });
        $content.find("[data-open-appointment]").on("click", () => {
            if (appointment?.name) {
                frappe.set_route("Form", "Patient Appointment", appointment.name);
                closePatientOverviewDrawer();
            }
        });
        $content.find("[data-open-encounter]").on("click", () => {
            if (encounter?.name) {
                frappe.set_route("Form", "Patient Encounter", encounter.name);
                closePatientOverviewDrawer();
            }
        });
        $content.find("[data-open-related-patient]").on("click", (event) => {
            const targetPatient = $(event.currentTarget).data("openRelatedPatient");
            if (targetPatient) {
                frappe.set_route("Form", "Patient", targetPatient);
                closePatientOverviewDrawer();
            }
        });

        wireTabs($content);
    }

    function buildOverviewCard(title, body, options = {}) {
        const badge = options.badge ? `<span class="do-health-overview__pill">${escapeHtml(options.badge)}</span>` : "";
        const actionButton =
            options.actionLabel && options.actionAttr
                ? `<button class="do-health-overview__link" type="button" ${options.actionAttr}>${escapeHtml(options.actionLabel)}</button>`
                : "";
        return `
            <div class="do-health-overview__card">
                <div class="do-health-overview__card-header">
                    <div class="do-health-overview__card-title">${escapeHtml(title)}</div>
                    <div class="do-health-overview__card-actions">
                        ${badge}
                        ${actionButton}
                    </div>
                </div>
                ${body}
            </div>
        `;
    }

    function buildRelationsCard(relations = []) {
        const body = relations.length
            ? relations.map(buildRelationRow).join("")
            : `<div class="do-health-overview__empty">${translate("No related patients recorded yet.")}</div>`;

        return `
            <div class="do-health-overview__card">
                <div class="do-health-overview__card-header">
                    <div class="do-health-overview__card-title">${translate("Family & Relations")}</div>
                    <div class="do-health-overview__card-actions">
                        <button class="do-health-overview__link" type="button" data-add-relation>${translate("Add")}</button>
                    </div>
                </div>
                <div class="do-health-overview__card-body do-health-overview__relations">
                    ${body}
                </div>
            </div>
        `;
    }

    async function openAddRelationDialog(patientId) {
        if (!patientId) {
            frappe.msgprint(translate("Select a patient first."));
            return;
        }

        const relationOptions = await fetchRelationOptions();
        const dialog = new frappe.ui.Dialog({
            title: translate("Add Relation"),
            fields: [
                {
                    label: translate("Patient"),
                    fieldname: "patient",
                    fieldtype: "Link",
                    options: "Patient",
                    default: patientId,
                    read_only: 1
                },
                {
                    label: translate("Related Patient"),
                    fieldname: "related_patient",
                    fieldtype: "Link",
                    options: "Patient",
                    reqd: 1
                },
                {
                    label: translate("Relation"),
                    fieldname: "relation",
                    fieldtype: "Select",
                    options: ["", ...relationOptions].join("\n"),
                    reqd: 1
                },
                {
                    label: translate("Notes"),
                    fieldname: "notes",
                    fieldtype: "Small Text"
                }
            ],
            primary_action_label: translate("Save"),
            primary_action: async (values) => {
                if (!values.related_patient || !values.relation) {
                    frappe.msgprint(translate("Please select a related patient and relation."));
                    return;
                }
                dialog.disable_primary_action();
                try {
                    await frappe.call({
                        method: "do_health.api.methods.create_patient_relationship",
                        args: {
                            patient: patientId,
                            related_patient: values.related_patient,
                            relation: values.relation,
                            notes: values.notes || ""
                        }
                    });
                    dialog.hide();
                    // refresh overview to show the new relation
                    loadPatientOverview({ patient: patientId });
                } catch (error) {
                    console.warn("[do_health] Failed to add relation", error);
                } finally {
                    dialog.enable_primary_action();
                }
            }
        });

        dialog.show();
    }

    async function fetchRelationOptions() {
        try {
            await frappe.model.with_doctype("Patient Relationship");
            const df = frappe.meta.get_docfield("Patient Relationship", "relation", "Patient Relationship");
            const options = (df?.options || "")
                .split("\n")
                .map((opt) => opt.trim())
                .filter(Boolean);
            if (options.length) return options;
        } catch (error) {
            console.warn("[do_health] Failed to load relation options", error);
        }

        return ["Father", "Mother", "Parent", "Husband", "Wife", "Spouse", "Partner", "Child", "Son", "Daughter", "Sibling", "Brother", "Sister", "Guardian", "Ward", "Other"];
    }

    function buildRelationRow(relation = {}) {
        if (!relation.patient) return "";

        const avatarInitials = (relation.patient_name || relation.patient || "")
            .split(" ")
            .map((word) => word[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

        const meta = [];
        if (relation.relation) meta.push(relation.relation);
        if (relation.age || relation.age === 0) meta.push(`${relation.age} ${translate("Y")}`);
        if (relation.gender) meta.push(relation.gender);
        const metaLabel = meta.join(" • ");

        const identifiers = [];
        if (relation.file_number) identifiers.push(`${translate("File")}: ${relation.file_number}`);
        if (relation.cpr) identifiers.push(`CPR: ${relation.cpr}`);
        const identifierRow = identifiers.length
            ? `<div class="do-health-overview__muted small">${escapeHtml(identifiers.join(" • "))}</div>`
            : "";

        const note = relation.description
            ? `<div class="do-health-overview__muted small">${escapeHtml(relation.description)}</div>`
            : "";

        return `
            <div class="do-health-overview__row relation">
                <span class="do-health-overview__row-icon avatar">
                    ${relation.patient_image ? `<img src="${escapeHtml(relation.patient_image)}" alt="${escapeHtml(relation.patient_name || relation.patient)}" />` : escapeHtml(avatarInitials || "?")}
                </span>
                <div class="do-health-overview__row-body">
                    <div class="do-health-overview__row-label">${translate("Related Patient")}</div>
                    <div class="do-health-overview__row-value">${escapeHtml(relation.patient_name || relation.patient)}</div>
                    ${metaLabel ? `<div class="do-health-overview__muted small">${escapeHtml(metaLabel)}</div>` : ""}
                    ${identifierRow}
                    ${note}
                </div>
                <div class="do-health-overview__row-actions">
                    <button class="do-health-overview__link" type="button" data-open-related-patient="${escapeHtml(relation.patient)}">${translate("Open")}</button>
                </div>
            </div>
        `;
    }

    function buildVitalsBlock(vitals) {
        if (!vitals || !vitals.length) {
            return `
                <div class="do-health-overview__card do-health-overview__card--muted">
                    <div class="do-health-overview__card-title">${translate("Vitals")}</div>
                    <div class="do-health-overview__empty">${translate("No vitals captured yet.")}</div>
                </div>
            `;
        }

        const latest = vitals[0] || {};
        const readings = latest.readings || {};
        const items = [];
        const bpValue = readings.bp || (readings.bp_systolic && readings.bp_diastolic ? `${readings.bp_systolic}/${readings.bp_diastolic}` : null);

        if (bpValue) items.push({ label: translate("Blood Pressure"), value: `${bpValue} mmHg`, icon: "fa-solid fa-heart-pulse" });
        if (readings.temperature) items.push({ label: translate("Temperature"), value: `${readings.temperature} °F`, icon: "fa-solid fa-temperature-three-quarters" });
        if (readings.pulse) items.push({ label: translate("Heart Rate"), value: `${readings.pulse} bpm`, icon: "fa-solid fa-heart" });
        if (readings.oxygen_saturation) items.push({ label: translate("Oxygen Saturation"), value: `${readings.oxygen_saturation}%`, icon: "fa-solid fa-wind" });
        if (readings.weight) items.push({ label: translate("Weight"), value: `${readings.weight} kg`, icon: "fa-solid fa-weight-scale" });
        if (readings.height) items.push({ label: translate("Height"), value: `${readings.height} cm`, icon: "fa-solid fa-ruler-vertical" });

        const itemsHtml = items.map(
            (item) => `
                <div class="do-health-overview__pill-card">
                    <div class="label"><i class="${item.icon}"></i> ${escapeHtml(item.label)}</div>
                    <div class="value">${escapeHtml(item.value)}</div>
                </div>
            `
        );

        const meta = [latest.signs_date_label, latest.signs_time_label].filter(Boolean).join(" • ");

        return `
            <div class="do-health-overview__card">
                <div class="do-health-overview__card-header">
                    <div>
                        <div class="do-health-overview__card-title">${translate("Vitals")}</div>
                        ${meta ? `<div class="do-health-overview__muted">${escapeHtml(meta)}</div>` : ""}
                    </div>
                </div>
                <div class="do-health-overview__pill-grid">
                    ${itemsHtml.join("") || `<div class="do-health-overview__empty">${translate("No vitals captured yet.")}</div>`}
                </div>
            </div>
        `;
    }

    function buildEmergencyContact(emergency) {
        const name = emergency.name || translate("Not provided");
        const relation = emergency.relation || translate("Relation not set");
        const phone = emergency.phone;
        const email = emergency.email;

        return `
            <div class="do-health-overview__emergency">
                <div class="do-health-overview__row compact">
                    <span class="do-health-overview__row-icon"><i class="fa-regular fa-user-shield"></i></span>
                    <div class="do-health-overview__row-body">
                        <div class="do-health-overview__row-label">${translate("Contact")}</div>
                        <div class="do-health-overview__row-value">${escapeHtml(name)}</div>
                        <div class="do-health-overview__muted small">${escapeHtml(relation)}</div>
                    </div>
                </div>
                <div class="do-health-overview__contact-row">
                    ${phone ? `<a class="do-health-overview__contact-btn" href="tel:${escapeHtml(phone)}"><i class="fa-regular fa-phone"></i><span>${escapeHtml(phone)}</span></a>` : `<span class="do-health-overview__muted">${translate("No phone provided")}</span>`}
                    ${email ? `<a class="do-health-overview__contact-btn ghost" href="mailto:${escapeHtml(email)}"><i class="fa-regular fa-envelope"></i><span>${escapeHtml(email)}</span></a>` : ""}
                </div>
            </div>
        `;
    }

    function buildTabbedSection(tabs = []) {
        if (!tabs.length) return "";
        const nav = tabs
            .map(
                (tab, idx) => `
                <button class="do-health-overview__tab ${idx === 0 ? "active" : ""}" data-tab-target="${tab.id}">
                    ${escapeHtml(tab.label)}
                </button>`
            )
            .join("");
        const bodies = tabs
            .map(
                (tab, idx) => `
                <div class="do-health-overview__tab-pane ${idx === 0 ? "active" : ""}" data-tab-pane="${tab.id}">
                    ${tab.content}
                </div>`
            )
            .join("");

        return `
            <div class="do-health-overview__tabset">
                <div class="do-health-overview__tablist">
                    ${nav}
                </div>
                <div class="do-health-overview__tabbodies">
                    ${bodies}
                </div>
            </div>
        `;
    }

    function wireTabs($content) {
        const $tabs = $content.find(".do-health-overview__tab");
        $tabs.on("click", function () {
            const target = $(this).data("tabTarget");
            $tabs.removeClass("active");
            $(this).addClass("active");
            const $panes = $content.find(".do-health-overview__tab-pane");
            $panes.removeClass("active");
            $panes.filter(`[data-tab-pane="${target}"]`).addClass("active");
        });
    }

    function buildComingSoon(text) {
        return `<div class="do-health-overview__empty muted">${escapeHtml(text)}</div>`;
    }

    function infoRow(label, value, icon) {
        const safeValue = value ? escapeHtml(value) : `<span class="do-health-overview__muted">${translate("Not available")}</span>`;
        return `
            <div class="do-health-overview__row">
                ${icon ? `<span class="do-health-overview__row-icon"><i class="${icon}"></i></span>` : ""}
                <div class="do-health-overview__row-body">
                    <div class="do-health-overview__row-label">${escapeHtml(label)}</div>
                    <div class="do-health-overview__row-value">${safeValue}</div>
                </div>
            </div>
        `;
    }

    function buildChip(label) {
        return `<span class="do-health-overview__chip">${escapeHtml(label)}</span>`;
    }

    function buildLinkChip(label, href, icon) {
        if (!label) return "";
        const safeHref = href ? `href="${escapeHtml(href)}"` : "";
        return `<a class="do-health-overview__chip link" ${safeHref} target="_blank" rel="noreferrer">${icon ? `<i class="${icon}"></i>` : ""}${escapeHtml(label)}</a>`;
    }

    function ensureOverviewDrawerShell() {
        if (overviewState.$overlay?.length) {
            return overviewState.$overlay;
        }
        const $overlay = $(`
            <div id="${OVERVIEW_DRAWER_ID}" class="do-health-overview">
                <div class="do-health-overview__backdrop"></div>
                <div class="do-health-overview__panel">
                    <div class="do-health-overview__panel-inner">
                        <div class="do-health-overview__panel-header">
                            <div class="do-health-overview__panel-title">${translate("Patient Overview")}</div>
                            <button type="button" class="do-health-overview__close" aria-label="${translate("Close")}">&times;</button>
                        </div>
                        <div class="do-health-overview__content"></div>
                    </div>
                </div>
            </div>
        `);

        $overlay.on("click", ".do-health-overview__close, .do-health-overview__backdrop", closePatientOverviewDrawer);
        $("body").append($overlay);
        overviewState.$overlay = $overlay;
        return $overlay;
    }

    function showOverviewLoading(message) {
        ensureOverviewDrawerShell();
        const $content = overviewState.$overlay.find(".do-health-overview__content");
        $content.html(`
            <div class="do-health-overview__loading">
                <div class="spinner-border text-success spinner-border-sm" role="status"></div>
                <span>${escapeHtml(message || translate("Loading..."))}</span>
            </div>
        `);
    }

    function closePatientOverviewDrawer() {
        overviewState.isOpen = false;
        overviewState.currentPatient = null;
        if (overviewState.watcherUnsub) {
            overviewState.watcherUnsub();
            overviewState.watcherUnsub = null;
        }
        if (overviewState.$overlay?.length) {
            overviewState.$overlay.removeClass("is-open");
        }
    }

    function attachOverviewWatcher() {
        if (overviewState.watcherUnsub || !window.do_health?.patientWatcher) return;
        overviewState.watcherUnsub = window.do_health.patientWatcher.subscribe((payload) => {
            if (!overviewState.isOpen) return;
            const next = normalizePatient(payload);
            if (!next?.patient) {
                closePatientOverviewDrawer();
                return;
            }
            if (next.patient !== overviewState.currentPatient) {
                loadPatientOverview(next);
            }
        });
    }

    function escapeHtml(value) {
        if (value == null) return "";
        if (frappe?.utils?.escape_html) return frappe.utils.escape_html(value);
        const div = document.createElement("div");
        div.innerText = String(value);
        return div.innerHTML;
    }

    function renderWaitingList(patients, { silent } = { silent: false }) {
        const $list = $(SELECTORS.waitingList);
        const $count = $(SELECTORS.waitingCount);
        if (!$list.length) return;

        $list.empty();
        $count.text(patients.length);

        if (!patients.length) {
            $list.append(
                $("<div>", { class: "do-health-empty" }).text(
                    translate("No patients in the waiting list.")
                )
            );
            return;
        }

        const grouped = patients.reduce((acc, patient) => {
            const normalized = normalizePatient(patient);
            if (!normalized) return acc;
            const practitioner = normalized.practitioner_name || translate("Unassigned");
            (acc[practitioner] = acc[practitioner] || []).push(normalized);
            return acc;
        }, {});

        Object.keys(grouped)
            .sort((a, b) => a.localeCompare(b))
            .forEach((practitioner) => {
                const groupPatients = grouped[practitioner];
                const $group = $("<div>", { class: "do-health-waiting-group" });
                $group.append(
                    $("<div>", { class: "do-health-waiting-group__title" }).append(
                        $("<span>", { text: practitioner }),
                        $("<span>", { class: "badge", text: groupPatients.length })
                    )
                );

                const $items = $("<div>", { class: "do-health-waiting-items" });

                groupPatients.forEach((patient) => {
                    const minutes = formatMinutesSince(patient.arrival_time);
                    const status = patient.custom_visit_status;
                    const avatarText = (patient.patient_name || patient.patient)
                        .charAt(0)
                        .toUpperCase();

                    const $item = $("<div>", {
                        class: "do-health-waiting-item",
                        "title": patient.patient_name,
                        "data-patient": patient.patient,
                        "data-appointment": patient.appointment
                    });

                    if (state.selectedPatient?.patient === patient.patient && state.selectedPatient?.appointment === patient.appointment) {
                        $item.addClass("active");
                    }

                    const $avatar = patient.patient_image ? $("<div>", {
                        class: "do-health-waiting-item__avatar",
                    }).append($("<img>", { src: patient.patient_image, alt: "Patient Avatar", style: "width: 28px; height: 28px;" })) :
                        $("<div>", {
                            class: "do-health-waiting-item__avatar",
                            text: avatarText
                        });;

                    const $body = $("<div>", { class: "do-health-waiting-item__body" }).append(
                        $("<div>", { class: "title", text: patient.patient_name }),
                        $("<div>", {
                            class: "meta",
                            text: patient.appointment_type || translate("No appointment type")
                        })
                    );

                    // Use custom auto-updating timestamp
                    const $timeChip = $("<span>", {
                        class: "do-health-chip do-health-chip--time"
                    });

                    if (patient.arrival_time && isValidDate(patient.arrival_time)) {
                        const minutes = formatMinutesSince(patient.arrival_time);
                        $timeChip.html(
                            `<span class="waitinglist-timestamp" data-timestamp="${patient.arrival_time}" title="${patient.arrival_time}">${minutes}</span>`
                        );
                    } else {
                        $timeChip.text("–");
                    }

                    const $right = $("<div>", { class: "do-health-waiting-item__right" }).append(
                        $timeChip,
                        status && status !== "Arrived"
                            ? $("<span>", {
                                class: "do-health-status-pill",
                                css: { background: getStatusColor(status) },
                                text: status
                            })
                            : null
                    );

                    $item.append($avatar, $body, $right);

                    $item.on("click", (e) => {
                        e.preventDefault();
                        if (state.selectedPatient?.patient === patient.patient && state.selectedPatient?.appointment === patient.appointment) {
                            clearPatientContext();
                            return;
                        }
                        activatePatientContext(patient);
                    });

                    $items.append($item);
                });

                $group.append($items);
                $list.append($group);
            });

        if (!silent) {
            $(SELECTORS.waitingList)
                .closest(".do-health-scroll")
                .scrollTop(0);
        }
    }

    function fetchActionBadge(item, patient) {
        const args = {};
        if (patient) {
            args.patient = patient.patient;
            if (patient.appointment) {
                args.appointment = patient.appointment;
            }
        }

        return frappe
            .call({
                method: item.badge_method,
                args
            })
            .then((response) => response?.message)
            .catch((error) => {
                console.warn("[do_health] Failed to fetch badge value", error);
                return null;
            });
    }

    function parseRouteParams(raw) {
        if (!raw) return null;
        if (typeof raw === "object") return raw;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return { name: raw };
        }
    }

    async function navigateToItem(item, patient) {
        const requiresPatient = !!item.requires_patient;
        if (requiresPatient && !patient) {
            frappe.msgprint(translate("Select a patient first."));
            return;
        }

        const params = parseRouteParams(item.route_params);
        const routeType = (item.route_type || "Workspace").toLowerCase();

        if (routeType === "workspace") {
            frappe.set_route("Workspaces", item.route_value);
            return;
        }

        if (routeType === "page") {
            frappe.route_options = Object.assign({}, params || {}, requiresPatient ? { patient: patient.patient } : {});
            frappe.set_route(item.route_value);
            return;
        }

        if (routeType === "report") {
            frappe.set_route("query-report", item.route_value);
            return;
        }

        if (routeType === "url") {
            const target = item.route_value;
            if (target) frappe.set_route(target);
            return;
        }

        if (routeType === "form") {
            if (item.route_value === "Patient Encounter" && patient) {
                await openEncounterForPatient(patient);
                return;
            }

            if (requiresPatient) {
                frappe.set_route("Form", item.route_value, patient.patient);
                return;
            }

            if (params?.name === "new") {
                frappe.new_doc(item.route_value);
            } else if (params?.name) {
                frappe.set_route("Form", item.route_value, params.name);
            } else {
                frappe.set_route("List", item.route_value);
            }
        }
    }

    async function navigateToEncounter(patient) {
        await openEncounterForPatient(patient);
    }

    async function navigateToProcedure(patient) {
        await openProcedureForPatient(patient);
    }

    async function openEncounterForPatient(patient) {
        if (!patient) return;

        const appointmentName = patient.appointment;

        const existingEncounter = await findEncounterForAppointment(appointmentName);
        if (existingEncounter) {
            frappe.set_route("Form", "Patient Encounter", existingEncounter);
            return;
        }

        // const prefilled = await maybeOpenPrefilledFollowUpEncounter(patient);
        // if (prefilled) return;

        frappe.new_doc("Patient Encounter", {
            appointment: appointmentName
        });
    }

    async function openProcedureForPatient(patient) {
        if (!patient) return;

        const appointmentName = patient.appointment;

        const existingProcedure = await findProcedureForAppointment(appointmentName);
        if (existingProcedure) {
            frappe.set_route("Form", "Clinical Procedure", existingProcedure);
            return;
        }

        // const prefilled = await maybeOpenPrefilledFollowUpProcedure(patient);
        // if (prefilled) return;

        frappe.new_doc("Clinical Procedure", {
            patient: patient.patient,
            appointment: appointmentName,
            practitioner: patient.practitioner,
            medical_department: patient.medical_department || patient.department
        });
    }

    async function findEncounterForAppointment(appointment) {
        if (!appointment) return null;

        try {
            const { message } = await frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Patient Encounter",
                    filters: { appointment },
                    fields: ["name"],
                    order_by: "creation desc",
                    limit: 1
                }
            });

            return message?.[0]?.name || null;
        } catch (error) {
            console.warn("[do_health] Failed to check existing encounter", error);
            return null;
        }
    }

    async function findProcedureForAppointment(appointment) {
        if (!appointment) return null;

        try {
            const { message } = await frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Clinical Procedure",
                    filters: { appointment },
                    fields: ["name"],
                    order_by: "creation desc",
                    limit: 1
                }
            });

            return message?.[0]?.name || null;
        } catch (error) {
            console.warn("[do_health] Failed to check existing clinical procedure", error);
            return null;
        }
    }

    async function maybeOpenPrefilledFollowUpEncounter(patient) {
        const appointmentName = patient?.appointment;
        if (!appointmentName) return false;

        const appointmentDetails = await fetchAppointmentDetails(appointmentName);
        const category = (appointmentDetails?.custom_appointment_category || patient.custom_appointment_category || "").trim();
        const pastAppointment = appointmentDetails?.custom_past_appointment || patient.custom_past_appointment;

        if (category !== "Follow-up" || !pastAppointment) return false;

        const pastEncounter = await fetchLatestEncounterForAppointment(pastAppointment);
        if (!pastEncounter) return false;

        const wantsPrefill = await confirmPrefillFromPastEncounter(pastEncounter, pastAppointment);
        if (!wantsPrefill) return false;

        await openEncounterFromTemplate(pastEncounter, {
            appointment: appointmentName,
            patient: patient.patient,
            practitioner: appointmentDetails?.practitioner || patient.practitioner,
            practitioner_name: appointmentDetails?.practitioner_name || patient.practitioner_name,
            appointment_type: appointmentDetails?.appointment_type || patient.appointment_type,
            medical_department: appointmentDetails?.department || patient.medical_department || patient.department,
            custom_appointment_category: category
        });

        return true;
    }

    async function maybeOpenPrefilledFollowUpProcedure(patient) {
        const appointmentName = patient?.appointment;
        if (!appointmentName) return false;

        const appointmentDetails = await fetchAppointmentDetails(appointmentName);
        const category = (appointmentDetails?.custom_appointment_category || patient.custom_appointment_category || "").trim();
        const pastAppointment = appointmentDetails?.custom_past_appointment || patient.custom_past_appointment;

        if (category !== "Follow-up" || !pastAppointment) return false;

        const pastProcedure = await fetchLatestProcedureForAppointment(pastAppointment);
        if (!pastProcedure) return false;

        const wantsPrefill = await confirmPrefillFromPastProcedure(pastProcedure, pastAppointment);
        if (!wantsPrefill) return false;

        await openProcedureFromTemplate(pastProcedure, {
            appointment: appointmentName,
            patient: patient.patient,
            practitioner: appointmentDetails?.practitioner || patient.practitioner,
            medical_department: appointmentDetails?.department || patient.medical_department || patient.department
        });

        return true;
    }

    async function fetchAppointmentDetails(appointment) {
        if (!appointment) return null;

        try {
            const { message } = await frappe.call({
                method: "frappe.client.get_value",
                args: {
                    doctype: "Patient Appointment",
                    filters: { name: appointment },
                    fieldname: [
                        "custom_appointment_category",
                        "custom_past_appointment",
                        "appointment_type",
                        "practitioner",
                        "practitioner_name",
                        "department"
                    ]
                }
            });
            return message || null;
        } catch (error) {
            console.warn("[do_health] Failed to fetch appointment details", error);
            return null;
        }
    }

    async function fetchLatestEncounterForAppointment(appointment) {
        if (!appointment) return null;

        try {
            const { message } = await frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Patient Encounter",
                    filters: { appointment },
                    fields: ["name"],
                    order_by: "creation desc",
                    limit: 1
                }
            });

            const encounterName = message?.[0]?.name;
            if (!encounterName) return null;

            const { message: encounter } = await frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Patient Encounter",
                    name: encounterName
                }
            });

            return encounter || null;
        } catch (error) {
            console.warn("[do_health] Failed to load past encounter", error);
            return null;
        }
    }

    async function fetchLatestProcedureForAppointment(appointment) {
        if (!appointment) return null;

        try {
            const { message } = await frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Clinical Procedure",
                    filters: { appointment },
                    fields: ["name"],
                    order_by: "creation desc",
                    limit: 1
                }
            });

            const procedureName = message?.[0]?.name;
            if (!procedureName) return null;

            const { message: procedure } = await frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Clinical Procedure",
                    name: procedureName
                }
            });

            return procedure || null;
        } catch (error) {
            console.warn("[do_health] Failed to load past clinical procedure", error);
            return null;
        }
    }

    function confirmPrefillFromPastEncounter(encounter, pastAppointment) {
        return new Promise((resolve) => {
            const encounterLabel = encounter?.name ? `#${encounter.name}` : translate("past encounter");
            const message = translate(
                "This is a follow-up appointment. Do you want to prefill details from {0}?",
                [encounterLabel]
            );

            frappe.confirm(
                message,
                () => resolve(true),
                () => resolve(false)
            );
        });
    }

    function confirmPrefillFromPastProcedure(procedure, pastAppointment) {
        return new Promise((resolve) => {
            const procedureLabel = procedure?.name ? `#${procedure.name}` : translate("past clinical procedure");
            const message = translate(
                "This is a follow-up appointment. Do you want to prefill details from {0}?",
                [procedureLabel]
            );

            frappe.confirm(
                message,
                () => resolve(true),
                () => resolve(false)
            );
        });
    }

    async function openEncounterFromTemplate(template, overrides) {
        if (!template) return;

        await frappe.model.with_doctype("Patient Encounter");

        const newDoc = frappe.model.copy_doc(template);

        newDoc.patient = overrides?.patient || template.patient;
        newDoc.appointment = overrides?.appointment || template.appointment;
        newDoc.appointment_type = overrides?.appointment_type || template.appointment_type;
        newDoc.practitioner = overrides?.practitioner || template.practitioner;
        newDoc.practitioner_name = overrides?.practitioner_name || template.practitioner_name;
        newDoc.medical_department = overrides?.medical_department || template.medical_department;
        newDoc.custom_appointment_category = overrides?.custom_appointment_category || template.custom_appointment_category;
        newDoc.encounter_date = frappe.datetime?.get_today ? frappe.datetime.get_today() : newDoc.encounter_date;
        newDoc.encounter_time = frappe.datetime?.now_time ? frappe.datetime.now_time() : newDoc.encounter_time;
        newDoc.status = "Open";

        frappe.set_route("Form", newDoc.doctype, newDoc.name);
    }

    async function openProcedureFromTemplate(template, overrides) {
        if (!template) return;

        await frappe.model.with_doctype("Clinical Procedure");

        const newDoc = frappe.model.copy_doc(template);

        newDoc.patient = overrides?.patient || template.patient;
        newDoc.appointment = overrides?.appointment || template.appointment;
        newDoc.practitioner = overrides?.practitioner || template.practitioner;
        newDoc.medical_department = overrides?.medical_department || template.medical_department;
        newDoc.start_date = frappe.datetime?.get_today ? frappe.datetime.get_today() : newDoc.start_date;
        newDoc.start_time = frappe.datetime?.now_time ? frappe.datetime.now_time() : newDoc.start_time;
        newDoc.status = "Draft";

        frappe.set_route("Form", newDoc.doctype, newDoc.name);
    }

    async function openBillingForPatient(patient) {
        if (!patient?.appointment) {
            frappe.msgprint(translate("Select a patient with an appointment to open billing."));
            return;
        }
        await openBillingInterface(patient.appointment);
    }

    async function openBillingInterface(appointmentId) {
        let appt = await frappe.db.get_doc('Patient Appointment', appointmentId);
        const isInsurance = (appt.custom_payment_type || '').toLowerCase().includes('insur');

        const defaultOverrideRoles = ["Can Override Billing Rate", "System Manager", "Healthcare Practitioner"];
        const fetchOverrideRoles = async () => {
            try {
                const { message } = await frappe.call({
                    method: 'frappe.client.get',
                    args: {
                        doctype: 'Do Health Settings',
                        name: 'Do Health Settings'
                    }
                });
                const rows = message?.billing_override_roles || [];
                const roles = rows.map(r => r.role).filter(Boolean);
                return roles.length ? roles : defaultOverrideRoles;
            } catch (e) {
                return defaultOverrideRoles;
            }
        };
        const allowedOverrideRoles = await fetchOverrideRoles();
        const userCanOverride = (frappe.boot?.user?.roles || []).some(r => allowedOverrideRoles.includes(r));

        const dialog = new frappe.ui.Dialog({
            title: `💳 ${__('Billing')} — ${appt.patient_name}`,
            size: 'extra-large',
            primary_action_label: __('Generate Invoices'),
            primary_action: async () => {
                try {
                    const { message: result } = await frappe.call({
                        method: 'do_health.api.methods.create_invoices_for_appointment',
                        args: { appointment_id: appt.name, submit_invoice: 0 },
                        freeze: true,
                        freeze_message: __('Creating invoice(s)...')
                    });
                    const info = result || {};
                    const alerts = [];
                    if (info.patient_invoice) {
                        alerts.push(
                            info.patient_invoice_updated
                                ? __('Patient invoice {0} updated.', [info.patient_invoice])
                                : __('Patient invoice {0} created.', [info.patient_invoice])
                        );
                    }
                    if (info.insurance_invoice) {
                        alerts.push(
                            info.insurance_invoice_updated
                                ? __('Insurance invoice {0} updated.', [info.insurance_invoice])
                                : __('Insurance invoice {0} created.', [info.insurance_invoice])
                        );
                    }
                    if (!alerts.length) {
                        alerts.push(__('Billing synchronised.'));
                    }
                    frappe.show_alert({ message: alerts.join(' '), indicator: 'green' });
                    appt = await frappe.db.get_doc('Patient Appointment', appointmentId);
                    await refreshAppointmentItemsUI(appt.name);
                    await loadPolicySummary(appt.patient, appt.company);
                    appointmentActions.refreshCalendar();
                } catch (e) {
                    console.error(e);
                }
            },
        });

        dialog.$body.html(`
            <div class="billing-shell" style="display:flex; gap:18px; align-items:flex-start;">
                <aside class="billing-side" style="width:320px; display:flex; flex-direction:column; gap:16px;">
                    <section class="billing-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                        <h5 class="font-semibold m-0">${__('Add Item')}</h5>
                        <div class="mt-3" style="display:flex; gap:8px; align-items:center;">
                            <div style="flex:1;" id="bill-item-link-wrapper"></div>
                            <div style="width:110px; margin-top:10px;">
                                <input type="number" id="bill-item-qty" class="form-control" min="1" step="1" value="1" />
                            </div>
                            <div style="margin-top:10px;">
                                <button class="btn btn-primary" id="bill-add-item">${__('Add')}</button>
                            </div>
                        </div>
                    </section>

                    <section class="billing-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;">
                        <div>
                            <label class="form-label text-muted small mb-1">${__('Payment Type')}</label>
                            <select id="payment-type-select" class="form-control">
                                <option value="Self Payment">${__('Self Payment')}</option>
                                <option value="Insurance">${__('Insurance')}</option>
                            </select>
                        </div>
                        <div style="height:1px;background:#f1f5f9;"></div>
                        <div>
                            <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap;">
                                <span class="font-semibold">${__('Insurance Policy')}</span>
                                <button class="btn btn-sm btn-outline-primary" id="btn-manage-policy">${__('Manage')}</button>
                            </div>
                            <div id="policy-summary" class="text-sm text-muted mt-2">${__('Loading...')}</div>
                        </div>
                    </section>
                </aside>

                <section class="billing-main" style="flex:1; display:flex; flex-direction:column; gap:16px;">
                    <section class="billing-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                        <div class="flex items-center justify-between flex-wrap" style="gap:8px;">
                            <h5 class="font-semibold m-0">${__('Appointment Items')}</h5>
                            <span class="badge badge-${isInsurance ? 'info' : 'secondary'}">
                                ${isInsurance ? __('Insurance') : __('Self Payment')}
                            </span>
                        </div>
                        <div id="bill-items-table" class="table-responsive mt-3"></div>
                    </section>

                    <section class="billing-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                        <div class="info-grid" style="display:grid;grid-template-columns:repeat(${isInsurance ? 2 : 1}, minmax(0,1fr));gap:16px;">
                            <div class="rounded-lg p-3" style="border:1px solid #e5e7eb;">
                                <div class="text-sm text-muted mb-1">${__('Patient Invoice')}</div>
                                <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap;">
                                    <span id="patient-invoice-link" class="font-medium"></span>
                                    <button class="btn btn-sm btn-outline-primary" id="btn-record-payment">${__('Record Payment')}</button>
                                </div>
                                <div class="text-sm text-muted mt-2">${__('Outstanding')}: <span id="patient-outstanding">0.00</span></div>
                            </div>
                            ${isInsurance ? `
                            <div class="rounded-lg p-3" id="insurance-claim-card" style="border:1px solid #e5e7eb;">
                                <div class="text-sm text-muted mb-1">${__('Insurance Claim')}</div>
                                <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap;">
                                    <span id="insurance-claim-summary" class="text-muted">${__('No claim yet')}</span>
                                    <button class="btn btn-sm btn-warning" disabled id="btn-insurance-claim">${__('Submit Claim')}</button>
                                </div>
                            </div>` : ''}
                        </div>
                    </section>

                    <section class="billing-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                        <div class="info-grid" style="display:grid;grid-template-columns:repeat(${isInsurance ? 2 : 1}, minmax(0,1fr));gap:16px;">
                            <div class="rounded-lg p-3" style="border:1px solid #e5e7eb;">
                                <div class="text-sm text-muted mb-1">${__('Patient Billing Status')}</div>
                                <div id="patient-status" class="badge badge-secondary">Loading...</div>
                            </div>
                            ${isInsurance ? `
                            <div class="rounded-lg p-3" style="border:1px solid #e5e7eb;">
                                <div class="text-sm text-muted mb-1">${__('Insurance Claim Status')}</div>
                                <div id="insurance-status" class="badge badge-info">Loading...</div>
                            </div>` : ''}
                        </div>
                    </section>
                </section>
            </div>
        `);

        dialog.show();

        // --- Auto-select payment type based on active insurance ---
        try {
            const { message: activePolicy } = await frappe.call({
                method: 'do_health.api.methods.get_active_insurance_policy_summary',
                args: {
                    patient: appt.patient,
                    company: appt.company,
                    on_date: appt.appointment_date || appt.posting_date || frappe.datetime.get_today(),
                },
            });

            const ptSelect = document.querySelector('#payment-type-select');
            if (activePolicy && activePolicy.name) {
                // If an active policy exists, switch to Insurance automatically
                ptSelect.value = 'Insurance';
                await frappe.db.set_value('Patient Appointment', appt.name, 'custom_payment_type', 'Insurance');
                frappe.show_alert({ message: __('Payment type set to Insurance (active policy detected)'), indicator: 'blue' });
            } else {
                // Otherwise default to Self Payment
                ptSelect.value = 'Self Payment';
                await frappe.db.set_value('Patient Appointment', appt.name, 'custom_payment_type', 'Self Payment');
            }
        } catch (error) {
            console.warn('Failed to auto-detect insurance policy:', error);
        }

        const el = dialog.$wrapper.get(0);
        const qtyInput = el.querySelector('#bill-item-qty');
        const addBtn = el.querySelector('#bill-add-item');

        await loadPolicySummary(appt.patient, appt.company);
        await refreshAppointmentItemsUI(appt.name);

        // Link field for item
        let chosenItemCode = null;
        const itemParent = $(el).find('#bill-item-link-wrapper');
        if (!itemParent.length) {
            console.warn('Billing item wrapper not found');
            return;
        }
        const itemLink = frappe.ui.form.make_control({
            parent: itemParent,
            df: {
                fieldtype: 'Link',
                fieldname: 'item_code',
                label: __('Item'),
                options: 'Item',
                reqd: 1,
                change: (val) => { chosenItemCode = val || null; }
            },
            render_input: true
        });
        itemLink.refresh();

        // Change payment type
        const ptSelect = el.querySelector('#payment-type-select');
        ptSelect.value = appt.custom_payment_type || 'Self Payment';
        ptSelect.addEventListener('change', async () => {
            await frappe.db.set_value('Patient Appointment', appt.name, 'custom_payment_type', ptSelect.value);
            appt.custom_payment_type = ptSelect.value;
            frappe.show_alert({ message: __('Payment type updated'), indicator: 'green' });
            await refreshAppointmentItemsUI(appt.name);
        });

        // Add item
        addBtn.addEventListener('click', async () => {
            const qty = cint(qtyInput.value || 1);
            const item_code = itemLink.get_value();
            if (!item_code) {
                frappe.show_alert({ message: __('Pick an item first'), indicator: 'orange' });
                return;
            }
            await addAppointmentItem(appt.name, item_code, qty);
            itemLink.set_value('');
            chosenItemCode = null;
            qtyInput.value = '1';
            await refreshAppointmentItemsUI(appt.name);
        });

        async function addAppointmentItem(appointment, item_code, qty) {
            await frappe.call({
                method: 'do_health.api.methods.add_item_to_appointment',
                args: { appointment, item_code, qty },
                freeze: true,
                freeze_message: __('Adding item...')
            });
        }

        async function removeAppointmentItem(rowname) {
            await frappe.call({
                method: 'do_health.api.methods.remove_item_from_appointment',
                args: { rowname },
                freeze: true,
                freeze_message: __('Removing item...')
            });
        }

        async function updateAppointmentItemQty(rowname, qty) {
            await frappe.call({
                method: 'do_health.api.methods.update_item_qty_in_appointment',
                args: { rowname, qty },
            });
        }

        async function updateAppointmentItemOverride(rowname, rate, reason) {
            await frappe.call({
                method: 'do_health.api.methods.update_item_override',
                args: { rowname, rate, reason }
            });
        }

        async function loadPolicySummary(patient, company) {
            const summaryEl = el.querySelector('#policy-summary');
            const manageBtn = el.querySelector('#btn-manage-policy');
            summaryEl.textContent = __('Checking policy...');

            try {
                const { message } = await frappe.call({
                    method: 'do_health.api.methods.get_active_insurance_policy_summary',
                    args: {
                        patient,
                        company: company || null,
                        on_date: appt.appointment_date || appt.posting_date || frappe.datetime.get_today()
                    }
                });
                if (message && message.name) {
                    const expiry = message.policy_expiry_date
                        ? frappe.datetime.str_to_user(message.policy_expiry_date)
                        : __('No expiry date');
                    const plan = message.insurance_plan || __('No plan');
                    summaryEl.textContent = `${message.insurance_payor || __('Insurance Payor')} • ${plan} (${__('Expires')}: ${expiry})`;
                    manageBtn.onclick = () => openPolicyManager(message);
                } else {
                    summaryEl.textContent = __('No active insurance policy');
                    manageBtn.onclick = () => openPolicyManager(null);
                }
            } catch (err) {
                console.error(err);
                summaryEl.textContent = __('Unable to load policy information');
                manageBtn.onclick = () => openPolicyManager(null);
            }
        }

        async function openPolicyEditor(policyName = null, opts = {}) {
            let baseDoc = null;
            if (policyName) {
                baseDoc = await frappe.db.get_doc('Patient Insurance Policy', policyName);
            }

            const isRenew = !!opts.renew;
            const dialogTitle = policyName
                ? (isRenew ? __('Renew Insurance Policy') : __('Edit Insurance Policy'))
                : __('Add Insurance Policy');

            const defaultExpiry = isRenew && baseDoc?.policy_expiry_date
                ? frappe.datetime.add_months(baseDoc.policy_expiry_date, 12)
                : (baseDoc?.policy_expiry_date || frappe.datetime.get_today());

            const policyDialog = new frappe.ui.Dialog({
                title: dialogTitle,
                fields: [
                    {
                        fieldtype: 'Link',
                        fieldname: 'insurance_payor',
                        label: __('Insurance Payor'),
                        options: 'Insurance Payor',
                        reqd: 1,
                        default: baseDoc?.insurance_payor || ''
                    },
                    {
                        fieldtype: 'Link',
                        fieldname: 'insurance_plan',
                        label: __('Insurance Plan'),
                        options: 'Insurance Payor Eligibility Plan',
                        default: baseDoc?.insurance_plan || ''
                    },
                    {
                        fieldtype: 'Data',
                        fieldname: 'policy_number',
                        label: __('Policy Number'),
                        reqd: 1,
                        default: baseDoc?.policy_number || ''
                    },
                    {
                        fieldtype: 'Date',
                        fieldname: 'policy_expiry_date',
                        label: __('Policy Expiry Date'),
                        reqd: 1,
                        default: defaultExpiry
                    }
                ],
                primary_action_label: policyName && !isRenew ? __('Save Changes') : __('Save Policy'),
                primary_action: async (values) => {
                    try {
                        if (policyName && !isRenew) {
                            await frappe.call({
                                method: 'do_health.api.methods.update_patient_insurance_policy',
                                args: {
                                    policy_name: policyName,
                                    insurance_payor: values.insurance_payor,
                                    insurance_plan: values.insurance_plan,
                                    policy_number: values.policy_number,
                                    policy_expiry_date: values.policy_expiry_date,
                                }
                            });
                        } else {
                            await frappe.call({
                                method: 'do_health.api.methods.create_patient_insurance_policy',
                                args: {
                                    patient: appt.patient,
                                    insurance_payor: values.insurance_payor,
                                    insurance_plan: values.insurance_plan,
                                    policy_number: values.policy_number,
                                    policy_expiry_date: values.policy_expiry_date,
                                }
                            });
                        }

                        frappe.show_alert({ message: __('Insurance policy saved'), indicator: 'green' });
                        policyDialog.hide();
                        await loadPolicySummary(appt.patient, appt.company);
                        if (typeof opts.onSuccess === 'function') {
                            opts.onSuccess();
                        }
                    } catch (error) {
                        console.error(error);
                    }
                }
            });

            policyDialog.show();
        }

        async function openPolicyManager(activePolicySummary) {
            const { message: policies } = await frappe.call({
                method: 'do_health.api.methods.list_patient_insurance_policies',
                args: { patient: appt.patient }
            });

            const manager = new frappe.ui.Dialog({
                title: __('Manage Insurance Policies'),
                size: 'large'
            });

            const rows = (policies || []).map(policy => {
                const expiryText = policy.policy_expiry_date
                    ? frappe.datetime.str_to_user(policy.policy_expiry_date)
                    : __('No expiry date');
                const diff = policy.policy_expiry_date
                    ? frappe.datetime.get_diff(policy.policy_expiry_date, frappe.datetime.get_today())
                    : 1;
                const isActive = diff >= 0 && policy.docstatus === 1;
                const statusBadge = isActive
                    ? `<span class="badge badge-success">${__('Active')}</span>`
                    : `<span class="badge badge-secondary">${__('Expired')}</span>`;

                return `
                    <tr data-policy="${policy.name}">
                        <td>${policy.policy_number || policy.name}</td>
                        <td>${frappe.utils.escape_html(policy.insurance_payor || '')}</td>
                        <td>${frappe.utils.escape_html(policy.insurance_plan || __('—'))}</td>
                        <td>${expiryText}</td>
                        <td>${statusBadge}</td>
                        <td class="text-right" style="white-space:nowrap; display:flex; gap:6px; justify-content:flex-end;">
                            <button class="btn btn-xs btn-secondary js-edit-policy" data-policy="${policy.name}">${__('Edit')}</button>
                            <button class="btn btn-xs btn-outline-primary js-renew-policy" data-policy="${policy.name}">${__('Renew')}</button>
                        </td>
                    </tr>
                `;
            }).join('');

            manager.$body.html(`
                <div>
                    ${(policies || []).length ? `
                        <div class="table-responsive">
                            <table class="table table-sm table-striped">
                                <thead>
                                    <tr>
                                        <th>${__('Policy')}</th>
                                        <th>${__('Payor')}</th>
                                        <th>${__('Plan')}</th>
                                        <th>${__('Expiry')}</th>
                                        <th>${__('Status')}</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                    ` : `<div class="text-muted">${__('No insurance policies found for this patient.')}</div>`}

                    <div class="mt-4" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <button class="btn btn-primary" id="btn-add-policy">${__('Add Policy')}</button>
                        ${activePolicySummary ? `<span class="text-muted small">${__('Active policy')}: ${frappe.utils.escape_html(activePolicySummary.policy_number || activePolicySummary.name)}</span>` : ''}
                    </div>
                </div>
            `);

            manager.$body.find('#btn-add-policy').on('click', () => {
                manager.hide();
                openPolicyEditor(null, { onSuccess: () => openPolicyManager(null) });
            });

            manager.$body.find('.js-edit-policy').on('click', (e) => {
                const name = e.currentTarget.getAttribute('data-policy');
                manager.hide();
                openPolicyEditor(name, { onSuccess: () => openPolicyManager(null) });
            });

            manager.$body.find('.js-renew-policy').on('click', (e) => {
                const name = e.currentTarget.getAttribute('data-policy');
                manager.hide();
                openPolicyEditor(name, { renew: true, onSuccess: () => openPolicyManager(null) });
            });

            manager.show();
        }

        async function refreshAppointmentItemsUI(appointment) {
            const { message } = await frappe.call({
                method: 'do_health.api.methods.get_appointment_items_snapshot',
                args: { appointment_id: appointment }
            });

            const tblWrap = el.querySelector('#bill-items-table');
            if (!tblWrap) {
                return;
            }
            const currency = (message && message.currency) || 'BHD';
            const isInsurancePayment = (appt.custom_payment_type || '').toLowerCase().includes('insur');

            if (!message || !Array.isArray(message.rows) || !message.rows.length) {
                tblWrap.innerHTML = `<div class="text-muted small">${__('No items yet.')}</div>`;
            } else {
                const header = isInsurancePayment
                    ? `
                        <th>${__('Item')}</th>
                        <th>${__('Qty')}</th>
                        <th>${__('Rate')}</th>
                        <th>${__('Override')}</th>
                        <th>${__('Patient')}</th>
                        <th>${__('Insurance')}</th>
                        <th>${__('Total')}</th>
                        <th></th>`
                    : `
                        <th>${__('Item')}</th>
                        <th>${__('Qty')}</th>
                        <th>${__('Rate')}</th>
                        <th>${__('Override')}</th>
                        <th>${__('Total')}</th>
                        <th></th>`;

                const bodyRows = message.rows.map(r => {
                    const qtyInput = `<input type="number" min="1" step="1" class="form-control form-control-sm js-qty" value="${r.qty}">`;
                    const overrideBadge = r.override_rate ? `<span class="badge badge-warning ml-1">${__('Override')}</span>` : '';
                    const baseRateNote = r.base_rate && r.override_rate
                        ? `<div class="text-muted small">${__('Base')}: ${format_currency(r.base_rate || 0, currency)}</div>`
                        : '';
                    const overrideMeta = r.override_by
                        ? `<div class="text-muted small">${__('By')}: ${frappe.utils.escape_html(r.override_by)}</div>`
                        : '';
                    const overrideReason = r.override_reason
                        ? `<div class="text-muted small">${frappe.utils.escape_html(r.override_reason)}</div>`
                        : '';
                    const rateLabel = `
                        <div>${format_currency(r.rate || 0, currency)} ${overrideBadge}</div>
                        ${baseRateNote}
                        ${overrideMeta}
                        ${overrideReason}
                    `;
                    const overrideControl = userCanOverride
                        ? `
                            <div class="input-group input-group-sm">
                                <input type="number" min="0" step="0.01" class="form-control form-control-sm js-override" value="${r.override_rate || ''}" placeholder="${format_currency(r.rate || 0, currency)}">
                                <div class="input-group-append">
                                    <button class="btn btn-outline-secondary btn-sm js-clear-override" type="button">&times;</button>
                                </div>
                            </div>`
                        : (r.override_rate ? format_currency(r.override_rate, currency) : '—');

                    if (isInsurancePayment) {
                        return `
                            <tr data-row="${r.name}">
                                <td>${frappe.utils.escape_html(r.item_name || r.item_code)}</td>
                                <td>${qtyInput}</td>
                                <td>${rateLabel}</td>
                                <td>${overrideControl}</td>
                                <td>${format_currency(r.patient_share || 0, currency)}</td>
                                <td>${format_currency(r.insurance_share || 0, currency)}</td>
                                <td>${format_currency(r.amount || 0, currency)}</td>
                                <td class="text-center">
                                    <button class="btn btn-xs btn-danger js-del">&times;</button>
                                </td>
                            </tr>`;
                    }
                    return `
                        <tr data-row="${r.name}">
                            <td>${frappe.utils.escape_html(r.item_name || r.item_code)}</td>
                            <td>${qtyInput}</td>
                            <td>${rateLabel}</td>
                            <td>${overrideControl}</td>
                            <td>${format_currency(r.amount || 0, currency)}</td>
                            <td class="text-center">
                                <button class="btn btn-xs btn-danger js-del">&times;</button>
                            </td>
                        </tr>`;
                }).join('');

                const totalsRow = isInsurancePayment
                    ? `
                        <tr class="table-total" style="background:#f8fafc;">
                            <td colspan="4" class="text-right font-weight-bold">${__('Totals')}</td>
                            <td class="font-weight-bold">${format_currency(message.totals.patient || 0, currency)}</td>
                            <td class="font-weight-bold">${format_currency(message.totals.insurance || 0, currency)}</td>
                            <td class="font-weight-bold">${format_currency(message.totals.grand || 0, currency)}</td>
                            <td></td>
                        </tr>`
                    : `
                        <tr class="table-total" style="background:#f8fafc;">
                            <td colspan="4" class="text-right font-weight-bold">${__('Totals')}</td>
                            <td class="font-weight-bold">${format_currency(message.totals.grand || 0, currency)}</td>
                            <td></td>
                        </tr>`;

                tblWrap.innerHTML = `
                    <table class="table table-sm table-bordered billing-items-table">
                        <thead>
                            <tr>${header}</tr>
                        </thead>
                        <tbody>
                            ${bodyRows}
                        </tbody>
                        <tfoot>
                            ${totalsRow}
                        </tfoot>
                    </table>
                `;

                tblWrap.querySelectorAll('tbody tr[data-row]').forEach(tr => {
                    const rowname = tr.getAttribute('data-row');
                    tr.querySelector('.js-del').addEventListener('click', async () => {
                        await removeAppointmentItem(rowname);
                        await refreshAppointmentItemsUI(appt.name);
                    });
                    tr.querySelector('.js-qty').addEventListener('change', async (e) => {
                        const q = cint(e.target.value || 1);
                        await updateAppointmentItemQty(rowname, q);
                        await refreshAppointmentItemsUI(appt.name);
                    });
                    tr.querySelector('.js-override')?.addEventListener('change', async (e) => {
                        if (!userCanOverride) return;
                        const val = flt(e.target.value || 0);
                        if (val <= 0) {
                            await updateAppointmentItemOverride(rowname, 0, null);
                            await refreshAppointmentItemsUI(appt.name);
                            return;
                        }
                        frappe.prompt(
                            [
                                {
                                    fieldtype: 'Small Text',
                                    fieldname: 'reason',
                                    label: __('Override Reason'),
                                    reqd: 0
                                }
                            ],
                            async (values) => {
                                await updateAppointmentItemOverride(rowname, val, values?.reason || '');
                                await refreshAppointmentItemsUI(appt.name);
                            },
                            __('Confirm Override')
                        );
                    });
                    tr.querySelector('.js-clear-override')?.addEventListener('click', async () => {
                        if (!userCanOverride) return;
                        const input = tr.querySelector('.js-override');
                        if (input) input.value = '';
                        await updateAppointmentItemOverride(rowname, 0, null);
                        await refreshAppointmentItemsUI(appt.name);
                    });
                });
            }

            const apptDoc = await frappe.db.get_doc('Patient Appointment', appointment);
            const patientStatusEl = el.querySelector('#patient-status');
            if (patientStatusEl) {
                patientStatusEl.textContent = apptDoc.custom_billing_status || __('Not Billed');
            }

            const insuranceStatusEl = el.querySelector('#insurance-status');
            if (insuranceStatusEl) {
                insuranceStatusEl.textContent = isInsurancePayment
                    ? (apptDoc.custom_insurance_status || __('Not Claimed'))
                    : __('Not Applicable');
            }

            const invoiceLinkEl = el.querySelector('#patient-invoice-link');
            const outstandingEl = el.querySelector('#patient-outstanding');
            if (apptDoc.ref_sales_invoice) {
                invoiceLinkEl.innerHTML = `<a href="/app/sales-invoice/${apptDoc.ref_sales_invoice}" target="_blank">${apptDoc.ref_sales_invoice}</a>`;
                const inv = await frappe.db.get_doc('Sales Invoice', apptDoc.ref_sales_invoice);
                outstandingEl.textContent = format_currency(inv.outstanding_amount, inv.currency || currency);
            } else {
                invoiceLinkEl.textContent = '—';
                outstandingEl.textContent = format_currency(0, currency);
            }

            const claimSummaryEl = el.querySelector('#insurance-claim-summary');
            if (claimSummaryEl) {
                if (apptDoc.custom_insurance_sales_invoice) {
                    claimSummaryEl.innerHTML = __(`Linked invoice: <a href="/app/sales-invoice/${apptDoc.custom_insurance_sales_invoice}" target="_blank">
                    ${apptDoc.custom_insurance_sales_invoice}</a>`);
                    // claimSummary.innerHTML = `<a href="/app/Sales Invoice/${apptDoc.custom_insurance_sales_invoice}">
                    // ${apptDoc.custom_insurance_sales_invoice}</a>`;
                } else {
                    claimSummaryEl.textContent = __('No claim yet');
                }
            }
        }

        // Record payment button
        el.querySelector('#btn-record-payment')?.addEventListener('click', async () => {
            if (!appt.ref_sales_invoice) return;
            const invoiceDoc = await frappe.db.get_doc('Sales Invoice', appt.ref_sales_invoice);

            const defaultMOP = 'Cash';
            const outstanding = invoiceDoc.outstanding_amount ?? invoiceDoc.grand_total;

            const paymentDialog = new frappe.ui.Dialog({
                title: __('Record Payment'),
                fields: [
                    {
                        fieldtype: 'Table',
                        fieldname: 'payments',
                        label: __('Payments'),
                        reqd: 1,
                        in_place_edit: true,
                        data: [],
                        fields: [
                            {
                                fieldtype: 'Link',
                                fieldname: 'mode_of_payment',
                                options: 'Mode of Payment',
                                in_list_view: 1,
                                reqd: 1,
                                label: __('Mode of Payment'),
                            },
                            {
                                fieldtype: 'Currency',
                                fieldname: 'amount',
                                in_list_view: 1,
                                reqd: 1,
                                label: __('Amount'),
                            },
                            {
                                fieldtype: 'Data',
                                fieldname: 'reference_no',
                                in_list_view: 1,
                                label: __('Reference No'),
                            },
                        ],
                    },
                    {
                        fieldtype: 'Date',
                        fieldname: 'posting_date',
                        label: __('Posting Date'),
                        default: frappe.datetime.now_date(),
                        reqd: 1,
                    },
                    {
                        fieldtype: 'Check',
                        fieldname: 'submit_invoice',
                        label: __('Submit Invoice'),
                        default: 1,
                    },
                ],
                primary_action_label: __('Submit'),
                primary_action: async (values) => {
                    const paymentRows = (values.payments || []).filter(row => row.mode_of_payment && flt(row.amount) > 0);
                    if (!paymentRows.length) {
                        frappe.msgprint(__('Please add at least one payment row with an amount.'));
                        return;
                    }
                    await frappe.call({
                        method: 'do_health.api.methods.record_sales_invoice_payment',
                        args: {
                            invoice: invoiceDoc.name,
                            payments: paymentRows,
                            posting_date: values.posting_date,
                            submit_invoice: values.submit_invoice ? 1 : 0,
                        },
                        freeze: true,
                        freeze_message: __('Recording payment...'),
                    });
                    frappe.show_alert({ message: __('Payments recorded on invoice {0}.', [invoiceDoc.name]), indicator: 'green' });
                    paymentDialog.hide();
                    appt = await frappe.db.get_doc('Patient Appointment', appointmentId);
                    await refreshAppointmentItemsUI(appt.name);
                },
            });

            paymentDialog.show();

            const paymentsField = paymentDialog.fields_dict.payments;
            paymentsField.df.data = [{
                mode_of_payment: defaultMOP,
                amount: outstanding,
                reference_no: '',
            }];
            paymentsField.grid.refresh();
        });

        // Insurance Claim button
        el.querySelector('#btn-insurance-claim')?.addEventListener('click', async () => {
            const inv = appt.custom_insurance_sales_invoice;
            if (!inv) {
                frappe.show_alert({ message: __('No insurance invoice found'), indicator: 'orange' });
                return;
            }
            const { message: claimName } = await frappe.call({
                method: 'do_health.api.methods.create_or_update_insurance_claim',
                args: { appointment: appt.name, invoice: inv }
            });
            frappe.show_alert({
                message: claimName
                    ? __('Insurance claim {0} prepared.', [claimName])
                    : __('Insurance coverage prepared for claim.'),
                indicator: 'green'
            });
            appt = await frappe.db.get_doc('Patient Appointment', appointmentId);
            await refreshAppointmentItemsUI(appt.name);
        });

        // Auto-refresh billing summary every 60s
        setInterval(async () => {
            await refreshAppointmentItemsUI(appt.name);
        }, 60000);

        // Inside refreshAppointmentItemsUI
        const patientStatusEl = el.querySelector('#patient-status');
        if (patientStatusEl) {
            const status = appt.custom_billing_status || __('Not Billed');
            patientStatusEl.textContent = status;
            const map = {
                'Paid': 'success',
                'Partially Paid': 'warning',
                'Not Paid': 'info',
                'Cancelled': 'danger',
                'Not Billed': 'secondary',
            };
            patientStatusEl.className = `badge badge-${map[status] || 'secondary'}`;
        }

        const insuranceStatusEl = el.querySelector('#insurance-status');
        if (insuranceStatusEl) {
            const status = isInsurancePayment ? (appt.custom_insurance_status || __('Not Claimed')) : __('N/A');
            insuranceStatusEl.textContent = status;
            const map = {
                'Claimed': 'info',
                'Approved': 'success',
                'Rejected': 'danger',
                'Paid': 'primary',
                'Not Claimed': 'secondary',
            };
            insuranceStatusEl.className = `badge badge-${map[status] || 'secondary'}`;
        }

        await loadPolicySummary(appt.patient, appt.company);
        await refreshAppointmentItemsUI(appt.name);
    }

    function activatePatientContext(patient) {
        const normalized = normalizePatient(patient);
        if (!normalized) return;

        state.selectedPatient = normalized;
        savePatientContext(normalized);

        $(".do-health-waiting-item.active").removeClass("active");
        $(`.do-health-waiting-item[data-patient="${normalized.patient}"][data-appointment="${normalized.appointment}"]`).addClass("active");

        renderSelectedPatient(normalized);
    }

    function restorePatientContext() {
        const saved = getSavedPatientContext();
        if (!saved) {
            renderSelectedPatient(null);
            return;
        }

        state.selectedPatient = saved;
        renderSelectedPatient(saved);
    }

    let waitingListHash = "";
    let waitingTimeUpdateInterval = null;

    // Auto-update waiting list timestamps using custom format
    function updateWaitingListTimestamps() {
        $('.waitinglist-timestamp').each(function () {
            const $timestamp = $(this);
            const arrivalTime = $timestamp.attr('data-timestamp');
            if (arrivalTime && isValidDate(arrivalTime)) {
                const formattedTime = formatMinutesSince(arrivalTime);
                $timestamp.text(formattedTime);
            }
        });
    }

    // Start the auto-update interval
    function startWaitingListTimestamps() {
        if (waitingTimeUpdateInterval) {
            clearInterval(waitingTimeUpdateInterval);
        }
        // Update every 30 seconds
        waitingTimeUpdateInterval = setInterval(updateWaitingListTimestamps, 30000);
    }

    // Stop the auto-update interval
    function stopWaitingListTimestamps() {
        if (waitingTimeUpdateInterval) {
            clearInterval(waitingTimeUpdateInterval);
            waitingTimeUpdateInterval = null;
        }
    }

    async function fetchWaitingPatients(triggeredByRealtime = false) {
        try {
            const response = await frappe.call({
                method: "do_health.api.methods.get_waiting_list"
            });

            const patients = Array.isArray(response.message) ? response.message : [];
            const normalized = patients.map(normalizePatient).filter(Boolean);
            const newHash = JSON.stringify(normalized);

            if (!triggeredByRealtime || newHash !== waitingListHash) {
                waitingListHash = newHash;
                state.waiting = normalized;
                renderWaitingList(state.waiting);
                restorePatientContext();
                // Start auto-updating timestamps
                startWaitingListTimestamps();
            }
        } catch (error) {
            console.error("[do_health] Failed to fetch waiting patients", error);
            frappe.show_alert({
                message: translate("Unable to load waiting patients"),
                indicator: "red"
            });
        }
    }



    function registerAppSwitcherListener() {
        if (appSwitcherListenerRegistered) return;
        $(document).on("click.doHealthSidebar", ".app-link, .app-switcher-dropdown", (event) => {
            const $target = $(event.currentTarget);
            const appName = ($target.data("name") || "").toLowerCase();
            const href = ($target.attr("href") || "").toLowerCase();
            const label = ($target.find(".app-title").text() || $target.text() || "").toLowerCase();
            const isHealth =
                appName === "do_health" ||
                href.includes("do-health") ||
                label.includes("do health");
            if (isHealth) {
                saveSidebarMode("health");
            } else if (appName || href) {
                saveSidebarMode("standard");
            }
        });
        appSwitcherListenerRegistered = true;
    }

    function initSidebar() {
        if (!mountSidebarShell()) {
            setTimeout(initSidebar, 200);
            return;
        }
        applySidebarMode(state.mode);
        renderPrimaryNav();
        restorePatientContext();
        renderWaitingList(state.waiting);
        fetchWaitingPatients();
        registerAppSwitcherListener();

        frappe.router.on("change", syncActiveNavWithRoute);
        state.initialized = true;
    }

    frappe.after_ajax(() => {
        registerAppSwitcherListener();

        if (!state.initialized) {
            initSidebar();
        } else {
            fetchWaitingPatients();
        }
    });

    // Clean up interval on page unload
    $(window).on('beforeunload', () => {
        stopWaitingListTimestamps();
    });

    window.doHealthSidebar = window.doHealthSidebar || {};
    Object.assign(window.doHealthSidebar, {
        config: SIDEBAR_CONFIG,
        selectPatient(patient) {
            if (!state.initialized) initSidebar();
            activatePatientContext(patient);
        },
        clearSelection() {
            clearPatientContext();
        },
        setSecondaryCollapsed(collapsed) {
            setSecondaryCollapsed(collapsed);
        },
        isSecondaryCollapsed() {
            return !!state.secondaryCollapsed;
        },
        getSelectedPatient() {
            return state.selectedPatient || getSavedPatientContext();
        },
        refreshWaitingList() {
            return fetchWaitingPatients(true);
        }
    });
})();

// Register realtime events after socket is connected
function registerHealthSidebarRealtime() {
    if (!frappe.realtime || !frappe.realtime.on) {
        setTimeout(registerHealthSidebarRealtime, 100);
        return;
    }

    if (!frappe.realtime.socket || !frappe.realtime.socket.connected) {
        setTimeout(registerHealthSidebarRealtime, 100);
        return;
    }

    frappe.realtime.on("do_health_waiting_list_update", function (data) {
        if (window.doHealthSidebar && window.doHealthSidebar.refreshWaitingList) {
            window.doHealthSidebar.refreshWaitingList();
        }
    });

    frappe.realtime.on("patient_appointments_updated", function (data) {
        if (window.doHealthSidebar && window.doHealthSidebar.refreshWaitingList) {
            window.doHealthSidebar.refreshWaitingList();
        }
    });
}

registerHealthSidebarRealtime();

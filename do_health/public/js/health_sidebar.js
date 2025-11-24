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
            state.secondaryCollapsed = !state.secondaryCollapsed;
            saveSecondaryCollapsed(state.secondaryCollapsed);
            applySecondaryCollapsed(state.secondaryCollapsed);
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
                // $action.on("click", () => navigateToEncounter(patient))
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
                if (isOverview) {
                    $action.on("click", () => openPatientOverviewDrawer(patient));
                } else {
                    $action.on("click", () => navigateToItem(item, patient));
                }
            } else {
                $action.attr("title", translate("Select a patient first"));
            }

            $container.append($action);
        });

        const $interactive = $container
            .children(".do-health-selected-action")
            .filter((_, el) => !$(el).hasClass("disabled"));
        $interactive.first().addClass("active");
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
            <div class="do-health-overview__hero">
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
                    <button class="do-health-overview__btn ghost" type="button" data-close-overview>${translate("Close")}</button>
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

        const vitalsBlock = buildVitalsBlock(vitals);

        $content.html(`
            ${headerHtml}
            <div class="do-health-overview__cards">
                ${visitCard}
                ${emergencyCard}
                ${encounterCard}
                ${statsCard}
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
                        "data-appointment": patient.appointment,
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

                    const $right = $("<div>", { class: "do-health-waiting-item__right" }).append(
                        $("<span>", {
                            class: "do-health-chip do-health-chip--time",
                            text: minutes || "–"
                        }),
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

    async function openEncounterForPatient(patient) {
        if (!patient) return;

        if (patient.appointment) {
            try {
                const { message } = await frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Patient Encounter",
                        filters: { appointment: patient.appointment },
                        fields: ["name"],
                        limit: 1
                    }
                });

                if (message && message.length) {
                    frappe.set_route("Form", "Patient Encounter", message[0].name);
                    return;
                }
            } catch (error) {
                console.warn("[do_health] Failed to check existing encounter", error);
            }
        }

        frappe.new_doc("Patient Encounter", {
            // patient: patient.patient,
            appointment: patient.appointment,
            // appointment_type: patient.appointment_type,
            // custom_appointment_category: patient.custom_appointment_category
        });
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
            }
        } catch (error) {
            console.error("[do_health] Failed to fetch waiting patients", error);
            frappe.show_alert({
                message: translate("Unable to load waiting patients"),
                indicator: "red"
            });
        }
    }

    function registerRealtime() {
        if (state.realtimeRegistered) return;

        const realtimeHandler = () => fetchWaitingPatients(true);

        frappe.realtime.on("do_health_waiting_list_update", realtimeHandler);
        frappe.realtime.on("patient_appointments_updated", realtimeHandler);
        state.realtimeRegistered = true;
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
        registerRealtime();
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
        getSelectedPatient() {
            return state.selectedPatient || getSavedPatientContext();
        }
    });
})();

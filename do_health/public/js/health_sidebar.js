(() => {
    const ACTIVE_PATIENT_STORAGE_KEY = "do_health_active_patient";
    const WAITING_SECTION_ID = "do-health-sidebar-waiting";
    const WAITING_SECTION_SELECTOR = `.sidebar-item-container[item-name='Waiting'], #${WAITING_SECTION_ID}`;
    const SELECTED_SECTION_ID = "do-health-selected-patient";
    const SELECTED_SECTION_SELECTOR = `#${SELECTED_SECTION_ID}`;
    const ENCOUNTER_SELECTOR = `.sidebar-item-container[item-name='Encounter']`;
    const DEFAULT_PATIENT_AVATAR = "/assets/frappe/images/ui/user-avatar.png";
    const AUTO_REFRESH_INTERVAL = 60000;
    const SIDEBAR_REBUILD_DELAY = 300;

    let lastWaitingPatients = [];
    let initialized = false;
    let refreshTimerId = null;
    let realtimeHandlerRegistered = false;

    const translate = (...args) => (typeof __ === "function" ? __(...args) : args[0]);
    const isValidDate = (value) => value && !Number.isNaN(new Date(value).getTime());

    function getSidebarWrapper() {
        return $(".sidebar-items .standard-sidebar-section");
    }

    function iconMarkup(name, size = "md") {
        if (frappe?.utils?.icon) {
            return frappe.utils.icon(name, size);
        }
        const symbolId = name.startsWith("es-") ? name : `icon-${name}`;
        return `<svg class="icon icon-${size}"><use href="#${symbolId}"></use></svg>`;
    }

    function formatMinutesSince(arrivalTime) {
        if (!isValidDate(arrivalTime)) return "";
        const now = Date.now();
        const arrival = new Date(arrivalTime).getTime();
        const diffMinutes = Math.max(Math.floor((now - arrival) / 60000), 0);
        return diffMinutes >= 60
            ? `${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`
            : `${diffMinutes}m`;
    }

    function normalizePatient(patient = {}) {
        const patientId = patient.patient || patient.name;
        if (!patientId) return null;
        return {
            patient: patientId,
            patient_name: patient.patient_name || patient.full_name || patientId,
            appointment: patient.appointment || patient.name || null,
            arrival_time: patient.arrival_time || null,
            patient_image: patient.patient_image || null
        };
    }

    function getSavedPatientContext() {
        try {
            const raw = localStorage.getItem(ACTIVE_PATIENT_STORAGE_KEY);
            if (!raw) return null;
            return normalizePatient(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    function savePatientContext(patient) {
        if (!patient) return;
        localStorage.setItem(ACTIVE_PATIENT_STORAGE_KEY, JSON.stringify(patient));
    }

    function clearPatientContext() {
        localStorage.removeItem(ACTIVE_PATIENT_STORAGE_KEY);
        renderSelectedPatient(null);
        disableEncounter();
    }

    // --- Encounter workspace control
    function disableEncounter() {
        const $enc = $(ENCOUNTER_SELECTOR).find(".item-anchor");
        if (!$enc.length) return;
        $enc.addClass("hidden").attr("href", "#").attr("title", translate("Select a patient first"));
    }

    function enableEncounter(patient) {
        const $enc = $(ENCOUNTER_SELECTOR).find(".item-anchor");
        if (!$enc.length) return;
        const url = `/app/patient-encounter/new?patient=${encodeURIComponent(patient.patient)}${patient.appointment ? "&appointment=" + encodeURIComponent(patient.appointment) : ""
            }`;
        $enc.removeClass("hidden").attr("href", url).attr("title", `Start encounter for ${patient.patient_name}`);
    }

    // --- Selected patient UI
    function ensureSelectedSection() {
        let $section = $(SELECTED_SECTION_SELECTOR);
        if ($section.length) return $section;

        const $sidebar = getSidebarWrapper();
        if (!$sidebar.length) return null;

        $section = $("<div>", { class: "sidebar-item-container", id: SELECTED_SECTION_ID });
        const $header = $("<div>", { class: "standard-sidebar-item" });
        $header.append(
            $("<div>", { class: "item-anchor block-click" }).append(
                $("<span>", { class: "sidebar-item-icon" }).html(iconMarkup("user", "md")),
                $("<span>", { class: "sidebar-item-label", style: "font-weight: 700;", text: translate("Selected Patient") })
            )
        );
        $section.append($header, $("<div>", { class: "sidebar-child-item" }));

        const $waiting = $(WAITING_SECTION_SELECTOR);
        if ($waiting.length) {
            $section.insertAfter($waiting);
            $("<div class='divider mt-4'></div>").insertAfter($waiting);
        }

        return $section;
    }

    function renderSelectedPatient(patient) {
        const $section = ensureSelectedSection();
        if (!$section) return;

        const $child = $section.find(".sidebar-child-item");
        $child.empty();

        if (!patient) {
            $child.append(
                $("<div>", { class: "sidebar-item-container" }).append(
                    $("<div>", { class: "standard-sidebar-item" }).append(
                        $("<div>", { class: "item-anchor" }).append(
                            $("<span>", { class: "sidebar-item-icon" }).append(
                                $("<i>", { class: "fa fa-user-o" })
                            ),
                            $("<span>", {
                                class: "sidebar-item-label text-muted",
                                text: translate("Select patient")
                            })
                        )
                    )
                )
            );
            return;
        }

        const $item = $("<div>", { class: "sidebar-item-container selected-patient" });
        const $wrapper = $("<div>", { class: "standard-sidebar-item d-flex align-center justify-between" });

        const $anchor = $("<a>", {
            class: "item-anchor d-flex align-center",
            href: `/app/patient/${encodeURIComponent(patient.patient)}`
        });
        $anchor.on("click", (e) => {
            e.preventDefault();
            frappe.set_route("patient", patient.patient);
        });

        $anchor.append(
            $("<span>", { class: "sidebar-item-icon" }).append(
                $("<img>", {
                    class: "icon icon-md",
                    src: patient.patient_image || DEFAULT_PATIENT_AVATAR
                })
            ),
            $("<span>", { class: "sidebar-item-label", text: patient.patient_name })
        );

        const $clear = $("<button>", {
            class: "btn-reset",
            title: translate("Clear selection")
        }).html(iconMarkup("es-small-close", "sm"));

        $clear.on("click", (e) => {
            e.stopPropagation();
            clearPatientContext();
        });

        $wrapper.append($anchor, $clear);
        $item.append($wrapper);
        $child.append($item);
    }

    // --- Context activation
    function activatePatientContext(patient) {
        const normalized = normalizePatient(patient);
        if (!normalized) {
            clearPatientContext();
            return;
        }
        savePatientContext(normalized);
        $(".active-waiting-patient").removeClass("active-waiting-patient");
        $(`[data-patient='${normalized.patient}']`).addClass("active-waiting-patient");
        renderSelectedPatient(normalized);
        enableEncounter(normalized);
    }

    function restorePatientContext() {
        const saved = getSavedPatientContext();
        if (!saved) {
            renderSelectedPatient(null);
            disableEncounter();
            return;
        }
        renderSelectedPatient(saved);
        enableEncounter(saved);
    }

    // --- Waiting patients
    function renderWaitingPatients(patients = []) {
        lastWaitingPatients = patients;
        const $waiting = $(WAITING_SECTION_SELECTOR);
        if (!$waiting.length) return;
        const $child = $waiting.find(".sidebar-child-item");
        $child.empty();

        if (!patients.length) {
            $child.append(
                $("<div>", { class: "sidebar-item-container" }).append(
                    $("<div>", { class: "standard-sidebar-item" }).append(
                        $("<span>", { class: "sidebar-item-label text-muted", text: translate("No patients") })
                    )
                )
            );
            return;
        }

        patients.forEach((raw) => {
            const patient = normalizePatient(raw);
            const mins = formatMinutesSince(patient.arrival_time);

            const $item = $("<div>", {
                class: "sidebar-item-container",
                "data-patient": patient.patient
            });
            const $wrapper = $("<div>", { class: "standard-sidebar-item" });
            const $anchor = $("<a>", {
                href: "#",
                class: "item-anchor w-100 d-flex justify-between"
            });

            $anchor.append(
                $("<span>", { class: "d-flex align-center" }).append(
                    $("<span>", { class: "sidebar-item-icon" }).append(
                        $("<img>", { class: "icon icon-md", src: patient.patient_image || DEFAULT_PATIENT_AVATAR })
                    ),
                    $("<span>", { class: "sidebar-item-label", text: patient.patient_name })
                ),
                $("<span>", { css: { marginLeft: "auto", color: "gray", fontSize: "12px" }, text: mins })
            );

            $anchor.on("click", (e) => {
                e.preventDefault();
                activatePatientContext(patient);
                // frappe.set_route("patient", patient.patient);
            });

            $wrapper.append($anchor);
            $item.append($wrapper);
            $child.append($item);
        });
    }

    async function fetchWaitingPatients() {
        try {
            const r = await frappe.call({ method: "do_health.api.methods.get_waiting_list" });
            renderWaitingPatients(r.message || []);
            restorePatientContext();
        } catch (err) {
            console.error(err);
        }
    }

    // --- Init
    function initSidebar() {
        fetchWaitingPatients();
        restorePatientContext();

        // realtime
        if (!realtimeHandlerRegistered) {
            frappe.realtime.on("patient_appointments_updated", () => fetchWaitingPatients());
            realtimeHandlerRegistered = true;
        }

        if (refreshTimerId) clearInterval(refreshTimerId);
        refreshTimerId = setInterval(() => {
            if (lastWaitingPatients.length) renderWaitingPatients(lastWaitingPatients);
            restorePatientContext();
        }, AUTO_REFRESH_INTERVAL);

        initialized = true;
    }

    frappe.router.on("change", () => {
        const route = frappe.get_route();
        if (route[0] === "Workspaces" && route[1] === "Appointments") {
            if (!window._appointments_redirected) {
                window._appointments_redirected = true;
                frappe.set_route("patient-appointment/view/calendar/default");
            }
        } else {
            window._appointments_redirected = false;
        }
        setTimeout(() => {
            fetchWaitingPatients();
        }, SIDEBAR_REBUILD_DELAY);
    });

    frappe.after_ajax(() => {
        if (!initialized) initSidebar();
        else restorePatientContext();
    });

    window.doHealthSidebar = window.doHealthSidebar || {};
    Object.assign(window.doHealthSidebar, {
        selectPatient(patient) {
            if (!initialized) {
                initSidebar();
            }
            activatePatientContext(patient);
        },
        clearSelection() {
            clearPatientContext();
        },
        getSelectedPatient() {
            return getSavedPatientContext();
        }
    });
})();

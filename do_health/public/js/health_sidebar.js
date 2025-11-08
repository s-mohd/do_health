(() => {
    const ACTIVE_PATIENT_STORAGE_KEY = "do_health_active_patient";
    const WAITING_SECTION_ID = "do-health-sidebar-waiting";
    const WAITING_SECTION_SELECTOR = `.sidebar-item-container[item-name='Waiting'], #${WAITING_SECTION_ID}`;
    const SELECTED_SECTION_ID = "do-health-selected-patient";
    const SELECTED_SECTION_SELECTOR = `#${SELECTED_SECTION_ID}`;
    const ENCOUNTER_SELECTOR = `.sidebar-item-container[item-name='Encounter']`;
        const APPOINTMENTS_SELECTOR = `.sidebar-item-container[item-name='Appointments']`;
    const DEFAULT_PATIENT_AVATAR = null; // Will use icon fallback instead
    const TIMER_UPDATE_DELAY = 10000; // Update timers every 10 seconds
    const AUTO_REFRESH_INTERVAL = 60000;
    const SIDEBAR_REBUILD_DELAY = 300;

    let lastWaitingPatients = [];
    let initialized = false;
    let refreshTimerId = null;
    let realtimeHandlerRegistered = false;

    const translate = (...args) => (typeof __ === "function" ? __(...args) : args[0]);
    const isValidDate = (value) => value && !Number.isNaN(new Date(value).getTime());

    function getStatusColor(status) {
        const statusColors = {
            'Arrived': '#17a2b8',      // cyan
            'In Room': '#28a745',       // green
            'Completed': '#6c757d',     // gray
            'Checked Out': '#6c757d',   // gray
            'Cancelled': '#dc3545',     // red
            'No Show': '#ffc107'        // yellow
        };
        return statusColors[status] || '#6c757d';
    }

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
            patient_image: patient.patient_image || null,
            custom_visit_status: patient.custom_visit_status || null
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
        $(".active-waiting-patient").removeClass("active-waiting-patient");
        disableEncounter();
    }

    // --- Encounter workspace control
    function disableEncounter() {
        const $enc = $(ENCOUNTER_SELECTOR).find(".item-anchor");
        if (!$enc.length) return;
        $enc.addClass("hidden").attr("href", "#").attr("title", translate("Select a patient first"));
        $enc.css({
            "color": "",
            "background": "",
            "border-left": "",
            "font-weight": "",
            "box-shadow": ""
        });
        // Remove any status indicator
        $enc.find(".encounter-status-indicator").remove();
    }

    async function enableEncounter(patient) {
        const $enc = $(ENCOUNTER_SELECTOR).find(".item-anchor");
        if (!$enc.length) return;
        
        // Remove any existing status indicator
        $enc.find(".encounter-status-indicator").remove();
        
        // Check if an encounter exists for this appointment
        if (patient.appointment) {
            try {
                const result = await frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Patient Encounter",
                        filters: {
                            appointment: patient.appointment
                        },
                        fields: ["name", "docstatus"],
                        limit: 1
                    }
                });
                
                if (result.message && result.message.length > 0) {
                    const encounter = result.message[0];
                    // Encounter exists - style it prominently in green
                    $enc.removeClass("hidden")
                        .attr("href", "#")
                        .attr("title", `View existing encounter for ${patient.patient_name}`)
                        .css({
                            "color": "#155724",
                            "background": "linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)",
                            "border-left": "4px solid #28a745",
                            "font-weight": "600",
                            "box-shadow": "0 2px 4px rgba(40, 167, 69, 0.2)"
                        });
                    
                    // Add click handler to navigate without full page reload
                    $enc.off("click").on("click", function(e) {
                        e.preventDefault();
                        frappe.set_route("Form", "Patient Encounter", encounter.name);
                    });
                    
                    // Add a checkmark indicator
                    const $label = $enc.find(".sidebar-item-label");
                    if ($label.length && !$enc.find(".encounter-status-indicator").length) {
                        $label.append(
                            $("<i>", {
                                class: "fa fa-check-circle encounter-status-indicator",
                                style: "margin-left: 8px; font-size: 12px; color: #28a745;"
                            })
                        );
                    }
                    return;
                }
            } catch (err) {
                console.error("Failed to check for existing encounter:", err);
            }
        }
        
        // No encounter exists - link to create new one with default styling
        $enc.removeClass("hidden")
            .attr("href", "#")
            .attr("title", `Start new encounter for ${patient.patient_name}`)
            .css({
                "color": "",
                "background": "",
                "border-left": "",
                "font-weight": "",
                "box-shadow": ""
            });
        
        // Add click handler to navigate without full page reload
        $enc.off("click").on("click", function(e) {
            e.preventDefault();
            frappe.set_route("Form", "Patient Encounter", "new", {
                patient: patient.patient,
                appointment: patient.appointment
            });
        });
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
        enableEncounter(normalized);
    }

    function restorePatientContext() {
        const saved = getSavedPatientContext();
        if (!saved) {
            disableEncounter();
            return;
        }
        $(".active-waiting-patient").removeClass("active-waiting-patient");
        $(`[data-patient='${saved.patient}']`).addClass("active-waiting-patient");
        enableEncounter(saved);
    }

    // --- Waiting patients
    function renderWaitingPatients(patients = []) {
        lastWaitingPatients = patients;
        const $waiting = $(WAITING_SECTION_SELECTOR);
        if (!$waiting.length) return;
        
        const $child = $waiting.find(".sidebar-child-item");
        if (!$child.length) return;
        
        $child.empty();

        if (!patients.length) {
            $child.append(
                $("<div>", { class: "sidebar-item-container" }).append(
                    $("<div>", { class: "standard-sidebar-item" }).append(
                        $("<div>", { class: "item-anchor" }).append(
                            $("<span>", { class: "sidebar-item-icon" }).append(iconMarkup("users", "sm")),
                            $("<span>", { class: "sidebar-item-label text-muted", text: translate("No patients") })
                        )
                    )
                )
            );
            return;
        }

        // Group patients by practitioner
        const groupedPatients = {};
        patients.forEach((raw) => {
            const patient = normalizePatient(raw);
            const practitionerName = raw.practitioner_name || "Unassigned";
            if (!groupedPatients[practitionerName]) {
                groupedPatients[practitionerName] = [];
            }
            // Preserve all original fields plus normalized ones
            groupedPatients[practitionerName].push({ 
                ...patient, 
                practitioner_name: practitionerName,
                custom_visit_status: raw.custom_visit_status  // Ensure status is preserved
            });
        });

        // Render each practitioner group
        Object.keys(groupedPatients).sort().forEach((practitionerName) => {
            const patientCount = groupedPatients[practitionerName].length;
            const groupId = `practitioner-group-${practitionerName.replace(/\s+/g, '-')}`;
            
            // Add practitioner header (collapsible)
            const $header = $("<div>", { 
                class: "practitioner-header",
                style: "padding: 8px 12px; background: #f8f9fa; font-weight: 600; font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 80px; z-index: 10; border-bottom: 1px solid #dee2e6; cursor: pointer; display: flex; align-items: center; justify-content: space-between; user-select: none;",
                "data-group": groupId
            });
            
            const $headerLeft = $("<div>", { style: "display: flex; align-items: center; gap: 8px;" });
            const $chevron = $("<i>", { 
                class: "fa fa-chevron-down",
                style: "font-size: 10px; transition: transform 0.2s ease;"
            });
            const $nameText = $("<span>").text(practitionerName);
            $headerLeft.append($chevron, $nameText);
            
            const $badge = $("<span>", {
                class: "badge",
                style: "background: #69a5ff; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;",
                text: patientCount
            });
            
            $header.append($headerLeft, $badge);
            $child.append($header);

            // Container for patients (collapsible)
            const $groupContainer = $("<div>", {
                class: "practitioner-group-container",
                "data-group": groupId,
                style: "overflow: hidden;"
            });

            // Add patients for this practitioner
            groupedPatients[practitionerName].forEach((patient) => {
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
                            patient.patient_image 
                                ? $("<img>", { class: "icon icon-sm", src: patient.patient_image })
                                : $("<div>", { 
                                    class: "avatar avatar-small", 
                                    style: "background-color: #6c757d; color: white; display: flex; align-items: center; justify-content: center; border-radius: 50%; width: 16px; height: 16px; font-size: 11px; font-weight: 600;",
                                    text: (patient.patient_name || "?").charAt(0).toUpperCase()
                                })
                        ),
                        $("<span>", { class: "sidebar-item-label", text: patient.patient_name }),
                        (patient.custom_visit_status && patient.custom_visit_status !== 'Arrived') ? $("<span>", { 
                            class: "status-badge",
                            style: "margin-left: 6px; font-size: 9px; padding: 2px 6px; border-radius: 3px; font-weight: 600; background: " + getStatusColor(patient.custom_visit_status) + "; color: white;",
                            text: patient.custom_visit_status
                        }) : null
                    ),
                    $("<span>", { css: { marginLeft: "auto", color: "gray", fontSize: "12px" }, text: mins })
                );

                $anchor.on("click", (e) => {
                    e.preventDefault();
                    const saved = getSavedPatientContext();
                    if (saved && saved.patient === patient.patient) {
                        // If clicking the already selected patient, deselect
                        clearPatientContext();
                    } else {
                        // Otherwise, select this patient
                        activatePatientContext(patient);
                    }
                    // frappe.set_route("patient", patient.patient);
                });

                $wrapper.append($anchor);
                $item.append($wrapper);
                $groupContainer.append($item);
            });
            
            // Add click handler for collapse/expand
            $header.on("click", function() {
                const $container = $(`.practitioner-group-container[data-group='${groupId}']`);
                const $chevron = $(this).find(".fa-chevron-down");
                
                // Check if any patient in this group is selected
                const hasSelectedPatient = $container.find(".active-waiting-patient").length > 0;
                
                if ($container.is(":visible")) {
                    // Don't allow collapse if a patient is selected in this group
                    if (hasSelectedPatient) {
                        return;
                    }
                    // Collapse
                    $container.hide();
                    $chevron.css("transform", "rotate(-90deg)");
                } else {
                    // Expand
                    $container.show();
                    $chevron.css("transform", "rotate(0deg)");
                }
            });
            
            $child.append($groupContainer);
        });
    }

    async function fetchWaitingPatients() {
        try {
            const r = await frappe.call({ method: "do_health.api.methods.get_waiting_list" });
            let patients = r.message || [];
            
            // If there's a selected patient, check if they're in the waiting list
            const saved = getSavedPatientContext();
            if (saved && saved.appointment) {
                const isInList = patients.some(p => p.patient === saved.patient);
                
                // If not in the waiting list, fetch their current appointment data
                if (!isInList) {
                    try {
                        const appointmentData = await frappe.call({
                            method: "frappe.client.get",
                            args: {
                                doctype: "Patient Appointment",
                                name: saved.appointment,
                                fields: ["name", "patient", "patient_name", "practitioner_name", 
                                        "custom_visit_status", "arrival_time", "patient_image"]
                            }
                        });
                        
                        if (appointmentData.message) {
                            // Add the selected patient to the list with their current status
                            patients = [appointmentData.message, ...patients];
                        }
                    } catch (err) {
                        console.error("Failed to fetch selected patient appointment:", err);
                    }
                }
            }
            
            renderWaitingPatients(patients);
            restorePatientContext();
        } catch (err) {
            console.error(err);
        }
    }

    // --- Init
    function initSidebar() {
        // Wait 500ms for sidebar to be built, then fetch
        setTimeout(() => {
            fetchWaitingPatients();
        }, 500);

        // Register realtime handler when socket is ready
        if (!realtimeHandlerRegistered) {
            function registerRealtimeHandler() {
                if (!frappe.realtime?.socket?.connected) {
                    setTimeout(registerRealtimeHandler, 200);
                    return;
                }
                
                frappe.realtime.socket.on("do_health_waiting_list_update", (data) => {
                    fetchWaitingPatients();
                });
            }
            
            registerRealtimeHandler();
            realtimeHandlerRegistered = true;
        }

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
        
        // Re-render sidebar after route change to maintain waiting list
        if (initialized) {
            setTimeout(() => {
                if (lastWaitingPatients.length > 0) {
                    renderWaitingPatients(lastWaitingPatients);
                    restorePatientContext();
                }
            }, 100);
        }
    });

    frappe.after_ajax(() => {
        if (!initialized) {
            initSidebar();
        } else {
            if (lastWaitingPatients.length > 0) {
                renderWaitingPatients(lastWaitingPatients);
                restorePatientContext();
            }
        }
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

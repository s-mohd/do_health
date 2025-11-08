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

    // --- Patient Info Banner
    function createPatientInfoBanner(patient) {
        // Remove any existing banner first
        $(".do-health-patient-banner").remove();
        
        // Don't create if we don't have patient or appointment
        if (!patient || !patient.patient || !patient.appointment) return;
        
        // Fetch patient data
        frappe.db.get_doc("Patient", patient.patient).then(patientData => {
            // Fetch appointment data and vital signs in parallel
            Promise.all([
                frappe.db.get_doc("Patient Appointment", patient.appointment),
                frappe.db.get_list("Patient Encounter", {
                    filters: { patient: patient.patient, docstatus: 1 },
                    fields: ["encounter_date"],
                    order_by: "encounter_date desc",
                    limit: 1
                }),
                frappe.db.get_list("Vital Signs", {
                    filters: { 
                        appointment: patient.appointment,
                        docstatus: ['<', 2]
                    },
                    fields: ["name", "temperature", "pulse", "bp_systolic", "bp_diastolic", "weight"],
                    order_by: "creation desc",
                    limit: 1
                })
            ]).then(([appointmentData, lastVisits, vitalSigns]) => {
                // Use vital signs data if available, otherwise fall back to appointment custom fields
                const vitals = vitalSigns.length > 0 ? vitalSigns[0] : {
                    temperature: appointmentData.custom_temperature,
                    pulse: appointmentData.custom_pulse,
                    bp_systolic: appointmentData.custom_bp_systolic,
                    bp_diastolic: appointmentData.custom_bp_diastolic,
                    weight: appointmentData.custom_weight
                };
                
                renderBanner(patientData, appointmentData, lastVisits[0]?.encounter_date, vitals);
            });
        });
    }
    
    function renderBanner(patient, appointment, lastVisit, vitals) {
        const age = patient.dob ? Math.floor((Date.now() - new Date(patient.dob)) / 31557600000) : "";
        
        // Calculate top position: navbar + page-head
        const navbarHeight = $(".navbar").outerHeight() || 0;
        const pageHeadHeight = $(".page-head").outerHeight() || 0;
        const topPosition = navbarHeight + pageHeadHeight;
        
        const $banner = $("<div>", {
            class: "do-health-patient-banner",
            style: `background: linear-gradient(to right, #ffffff 0%, #f8f9fa 100%); border-bottom: 2px solid #e3e8ef; padding: 16px 28px; position: sticky; top: ${topPosition}px; z-index: 5; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin: 0; width: 100%;`
        });
        
        const $row = $("<div>", {
            style: "display: flex; align-items: center; gap: 20px;"
        });
        
        // Avatar with gradient border
        const initial = patient.patient_name?.charAt(0).toUpperCase() || "?";
        const $avatarWrapper = $("<div>", {
            style: "position: relative; flex-shrink: 0;"
        });
        
        const $avatar = patient.image 
            ? $("<img>", { 
                src: patient.image, 
                style: "width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 3px solid #fff; box-shadow: 0 2px 12px rgba(102, 126, 234, 0.3);" 
            })
            : $("<div>", { 
                style: "width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 22px; font-weight: 700; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); border: 3px solid #fff;",
                text: initial 
            });
        
        $avatarWrapper.append($avatar);
        
        // Patient info section with enhanced typography
        const $info = $("<div>", { style: "flex: 1; min-width: 200px;" });
        
        const $nameWrapper = $("<div>", {
            style: "display: flex; align-items: center; gap: 8px; margin-bottom: 6px;"
        });
        
        const $name = $("<span>", {
            style: "font-size: 19px; font-weight: 700; color: #2c3e50; letter-spacing: -0.3px;",
            text: patient.patient_name
        });
        
        $nameWrapper.append($name);
        
        if (patient.sex) {
            const genderColor = patient.sex === "Male" ? "#3498db" : patient.sex === "Female" ? "#e91e63" : "#95a5a6";
            const $genderBadge = $("<span>", {
                style: `background: ${genderColor}; color: white; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px;`,
                text: patient.sex
            });
            $nameWrapper.append($genderBadge);
        }
        
        const details = [];
        if (patient.custom_cpr || patient.name) {
            details.push(`<span style="font-weight: 600; color: #495057;">CPR:</span> <span style="color: #6c757d;">${patient.custom_cpr || patient.name}</span>`);
        }
        if (patient.dob) {
            details.push(`<span style="font-weight: 600; color: #495057;">DOB:</span> <span style="color: #6c757d;">${frappe.datetime.str_to_user(patient.dob)} (${age}y)</span>`);
        }
        
        const $details = $("<div>", {
            style: "font-size: 13px; line-height: 1.6;",
            html: details.join(" <span style='color: #dee2e6; margin: 0 6px;'>|</span> ")
        });
        
        // Add last visit as clickable element
        if (lastVisit) {
            if (details.length > 0) {
                $details.append($("<span>", {
                    style: "color: #dee2e6; margin: 0 6px;",
                    text: "|"
                }));
            }
            
            const $lastVisitLabel = $("<span>", {
                style: "font-weight: 600; color: #495057;",
                text: "Last Visit: "
            });
            
            const $lastVisitValue = $("<span>", {
                style: "color: #6c757d; cursor: pointer; text-decoration: underline; text-decoration-style: dotted;",
                text: frappe.datetime.str_to_user(lastVisit)
            });
            
            $lastVisitValue.on("click", function(e) {
                e.stopPropagation();
                
                // Find the encounter with this date
                frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Patient Encounter",
                        filters: {
                            patient: patient.name,
                            encounter_date: lastVisit,
                            docstatus: 1
                        },
                        fields: ["name"],
                        order_by: "creation desc",
                        limit: 1
                    },
                    callback: function(r) {
                        if (r.message && r.message.length > 0) {
                            const encounterName = r.message[0].name;
                            
                            // Open encounter in a dialog
                            frappe.call({
                                method: "frappe.client.get",
                                args: {
                                    doctype: "Patient Encounter",
                                    name: encounterName
                                },
                                callback: function(encounterData) {
                                    if (encounterData.message) {
                                        const encounter = encounterData.message;
                                        
                                        // Create dialog to show encounter details
                                        const dialog = new frappe.ui.Dialog({
                                            title: `Encounter: ${encounter.name}`,
                                            size: 'large',
                                            fields: [
                                                {
                                                    fieldtype: 'HTML',
                                                    fieldname: 'encounter_details'
                                                }
                                            ]
                                        });
                                        
                                        // Build encounter details HTML
                                        let html = `
                                            <div style="padding: 16px;">
                                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                                                    <div>
                                                        <div style="font-size: 11px; color: #6c757d; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Encounter Date</div>
                                                        <div style="font-size: 14px; font-weight: 600;">${frappe.datetime.str_to_user(encounter.encounter_date)}</div>
                                                    </div>
                                                    <div>
                                                        <div style="font-size: 11px; color: #6c757d; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Practitioner</div>
                                                        <div style="font-size: 14px; font-weight: 600;">${encounter.practitioner_name || encounter.practitioner || 'N/A'}</div>
                                                    </div>
                                                </div>
                                        `;
                                        
                                        // Add symptoms if available
                                        if (encounter.symptoms) {
                                            html += `
                                                <div style="margin-bottom: 20px;">
                                                    <div style="font-size: 12px; color: #495057; font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #e3e8ef;">Symptoms</div>
                                                    <div style="font-size: 13px; color: #6c757d; white-space: pre-wrap;">${encounter.symptoms}</div>
                                                </div>
                                            `;
                                        }
                                        
                                        // Add diagnosis if available
                                        if (encounter.diagnosis) {
                                            html += `
                                                <div style="margin-bottom: 20px;">
                                                    <div style="font-size: 12px; color: #495057; font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #e3e8ef;">Diagnosis</div>
                                                    <div style="font-size: 13px; color: #6c757d; white-space: pre-wrap;">${encounter.diagnosis}</div>
                                                </div>
                                            `;
                                        }
                                        
                                        // Add notes if available
                                        if (encounter.encounter_comment) {
                                            html += `
                                                <div style="margin-bottom: 20px;">
                                                    <div style="font-size: 12px; color: #495057; font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #e3e8ef;">Notes</div>
                                                    <div style="font-size: 13px; color: #6c757d; white-space: pre-wrap;">${encounter.encounter_comment}</div>
                                                </div>
                                            `;
                                        }
                                        
                                        // Add button to open full encounter
                                        html += `
                                                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e3e8ef;">
                                                    <button class="btn btn-primary btn-sm" onclick="frappe.set_route('Form', 'Patient Encounter', '${encounter.name}'); cur_dialog.hide();">
                                                        <i class="fa fa-external-link-alt"></i> Open Full Encounter
                                                    </button>
                                                </div>
                                            </div>
                                        `;
                                        
                                        dialog.fields_dict.encounter_details.$wrapper.html(html);
                                        dialog.show();
                                    }
                                }
                            });
                        } else {
                            frappe.msgprint(__('Encounter not found'));
                        }
                    }
                });
            });
            
            $details.append($lastVisitLabel, $lastVisitValue);
        }
        
        $info.append($nameWrapper, $details);
        
        // Vitals section with cards
        const vitalsList = [];
        if (vitals.temperature) {
            vitalsList.push({ icon: "fa-thermometer-half", label: "Temp", value: `${vitals.temperature}°C`, color: "#ff6b6b", bg: "#ffe5e5" });
        }
        if (vitals.pulse) {
            vitalsList.push({ icon: "fa-heartbeat", label: "Pulse", value: `${vitals.pulse}`, unit: "bpm", color: "#ee5a6f", bg: "#ffe5eb" });
        }
        if (vitals.bp_systolic && vitals.bp_diastolic) {
            vitalsList.push({ icon: "fa-stethoscope", label: "BP", value: `${vitals.bp_systolic}/${vitals.bp_diastolic}`, color: "#4ecdc4", bg: "#e0f7f6" });
        }
        if (vitals.weight) {
            vitalsList.push({ icon: "fa-weight", label: "Weight", value: `${vitals.weight}`, unit: "kg", color: "#95e1d3", bg: "#e8f8f5" });
        }
        
        let $vitals = null;
        
        if (vitalsList.length > 0) {
            $vitals = $("<div>", {
                style: "display: flex; gap: 12px; padding-left: 20px; margin-left: 20px; border-left: 2px solid #e3e8ef;"
            });
            
            vitalsList.forEach(v => {
                const $card = $("<div>", {
                    style: `background: ${v.bg}; padding: 10px 14px; border-radius: 10px; text-align: center; min-width: 75px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); border: 1px solid ${v.color}20;`
                });
                
                $card.append(
                    $("<div>", {
                        style: `color: ${v.color}; font-size: 16px; margin-bottom: 4px;`,
                        html: `<i class="fa ${v.icon}"></i>`
                    }),
                    $("<div>", {
                        style: "font-size: 9px; color: #6c757d; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 3px;",
                        text: v.label
                    }),
                    $("<div>", {
                        style: `font-size: 15px; font-weight: 800; color: ${v.color};`,
                        html: v.value + (v.unit ? `<span style="font-size: 10px; font-weight: 600; margin-left: 2px;">${v.unit}</span>` : "")
                    })
                );
                
                $vitals.append($card);
            });
        } else {
            // No vitals available - show button to enter them
            $vitals = $("<div>", {
                style: "display: flex; align-items: center; padding-left: 20px; margin-left: 20px; border-left: 2px solid #e3e8ef;"
            });
            
            const $addVitalsBtn = $("<button>", {
                class: "btn btn-sm",
                style: "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);",
                html: '<i class="fa fa-plus-circle"></i> Vital Signs'
            });
            
            $addVitalsBtn.on("click", function() {
                // Open dialog to enter vitals
                const dialog = new frappe.ui.Dialog({
                    title: 'Vital Signs',
                    fields: [
                        {
                            label: 'Temperature (°C)',
                            fieldname: 'custom_temperature',
                            fieldtype: 'Float'
                        },
                        {
                            label: 'Pulse (bpm)',
                            fieldname: 'custom_pulse',
                            fieldtype: 'Int'
                        },
                        {
                            label: 'BP Systolic',
                            fieldname: 'custom_bp_systolic',
                            fieldtype: 'Int'
                        },
                        {
                            label: 'BP Diastolic',
                            fieldname: 'custom_bp_diastolic',
                            fieldtype: 'Int'
                        },
                        {
                            label: 'Weight (kg)',
                            fieldname: 'custom_weight',
                            fieldtype: 'Float'
                        }
                    ],
                    primary_action_label: 'Save',
                    primary_action(values) {
                        // First check if Vital Signs already exist for this appointment (draft or submitted, not cancelled)
                        frappe.call({
                            method: 'frappe.client.get_list',
                            args: {
                                doctype: 'Vital Signs',
                                filters: {
                                    appointment: appointment.name,
                                    docstatus: ['<', 2]  // 0 = draft, 1 = submitted, 2 = cancelled
                                },
                                fields: ['name'],
                                limit: 1
                            },
                            callback: function(existingCheck) {
                                if (existingCheck.message && existingCheck.message.length > 0) {
                                    // Update existing Vital Signs
                                    const vitalSignsName = existingCheck.message[0].name;
                                    frappe.call({
                                        method: 'frappe.client.set_value',
                                        args: {
                                            doctype: 'Vital Signs',
                                            name: vitalSignsName,
                                            fieldname: {
                                                temperature: values.custom_temperature,
                                                pulse: values.custom_pulse,
                                                bp_systolic: values.custom_bp_systolic,
                                                bp_diastolic: values.custom_bp_diastolic,
                                                weight: values.custom_weight
                                            }
                                        },
                                        callback: function(r) {
                                            if (!r.exc) {
                                                updateAppointmentAndRefresh(values, dialog);
                                            }
                                        }
                                    });
                                } else {
                                    // Create new Vital Signs document
                                    const vitalSignsDoc = {
                                        doctype: 'Vital Signs',
                                        patient: appointment.patient,
                                        patient_name: appointment.patient_name,
                                        appointment: appointment.name,
                                        signs_date: frappe.datetime.nowdate(),
                                        signs_time: frappe.datetime.now_time(),
                                        temperature: values.custom_temperature,
                                        pulse: values.custom_pulse,
                                        bp_systolic: values.custom_bp_systolic,
                                        bp_diastolic: values.custom_bp_diastolic,
                                        weight: values.custom_weight
                                    };
                                    
                                    frappe.call({
                                        method: 'frappe.client.insert',
                                        args: {
                                            doc: vitalSignsDoc
                                        },
                                        callback: function(r) {
                                            if (!r.exc) {
                                                updateAppointmentAndRefresh(values, dialog);
                                            }
                                        }
                                    });
                                }
                            }
                        });
                        
                        function updateAppointmentAndRefresh(values, dialog) {
                            // Update appointment with vitals
                            frappe.call({
                                method: 'frappe.client.set_value',
                                args: {
                                    doctype: 'Patient Appointment',
                                    name: appointment.name,
                                    fieldname: {
                                        custom_temperature: values.custom_temperature,
                                        custom_pulse: values.custom_pulse,
                                        custom_bp_systolic: values.custom_bp_systolic,
                                        custom_bp_diastolic: values.custom_bp_diastolic,
                                        custom_weight: values.custom_weight
                                    }
                                },
                                callback: function() {
                                    frappe.show_alert({
                                        message: __('Vital Signs saved successfully'),
                                        indicator: 'green'
                                    });
                                    dialog.hide();
                                    // Refresh banner
                                    const saved = getSavedPatientContext();
                                    if (saved) {
                                        $(".do-health-patient-banner").remove();
                                        createPatientInfoBanner(saved);
                                    }
                                }
                            });
                        }
                    }
                });
                
                dialog.show();
            });
            
            $vitals.append($addVitalsBtn);
        }
        
        // Insurance badge with premium design
        let $insurance = null;
        if (appointment.insurance_company || appointment.insurance) {
            $insurance = $("<div>", {
                style: "padding: 10px 18px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3); margin-left: 12px;",
                html: `<i class="fa fa-shield-alt" style="color: #fff; font-size: 16px;"></i><div style="color: #fff;"><div style="font-size: 9px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; opacity: 0.9;">Insurance</div><div style="font-size: 13px; font-weight: 700;">${appointment.insurance_company || appointment.insurance}</div></div>`
            });
        }
        
        // Assemble
        $row.append($avatarWrapper, $info);
        if ($vitals) $row.append($vitals);
        if ($insurance) $row.append($insurance);
        
        $banner.append($row);
        
        // Insert right below page-head (breadcrumb area) without gap
        const $pageHead = $(".page-head");
        if ($pageHead.length) {
            $pageHead.after($banner);
        } else {
            const $layoutMain = $(".layout-main-section");
            if ($layoutMain.length) {
                $layoutMain.prepend($banner);
            } else {
                $(".page-container").prepend($banner);
            }
        }
        
        // Adjust form elements to account for sticky banner
        const bannerHeight = $banner.outerHeight() || 0;
        const stickyOffset = navbarHeight + pageHeadHeight + bannerHeight;
        
        // Fix form-message and form-tabs-list sticky positioning
        setTimeout(() => {
            const $formMessage = $(".form-message");
            const $formTabsList = $(".form-tabs-list");
            
            if ($formMessage.length && $formMessage.css("position") === "sticky") {
                $formMessage.css("top", `${stickyOffset}px`);
            }
            
            if ($formTabsList.length && $formTabsList.css("position") === "sticky") {
                $formTabsList.css("top", `${stickyOffset}px`);
            }
        }, 50);
        
        // Hide form's patient info only (keep page title)
        setTimeout(() => {
            $(".form-patient-info, .patient-details-section").hide();
        }, 100);
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
                        // Banner will be shown by route change handler
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
            // Banner will be shown by route change handler
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
                
                // Show patient banner if on encounter page
                if (route[0] === "Form" && route[1] === "Patient Encounter") {
                    const saved = getSavedPatientContext();
                    if (saved) {
                        setTimeout(() => {
                            createPatientInfoBanner(saved);
                        }, 400);
                    }
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

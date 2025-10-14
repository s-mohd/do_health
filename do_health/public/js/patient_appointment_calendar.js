
// Constants and configuration
const CONFIG = {
    LICENSE_KEY: 'CC-Attribution-NonCommercial-NoDerivatives',
    DEFAULT_VIEW: 'resourceTimeGridDay',
    SLOT_DURATION: '00:05:00',
    SLOT_MIN_TIME: "08:00:00",
    SLOT_MAX_TIME: "20:00:00",
    SLOT_LABEL_INTERVAL: "00:15:00",
    SCROLL_TIME: "09:00:00",
    RESOURCE_AREA_WIDTH: '75px'
}

frappe.views.calendar["Patient Appointment"] = {
    // State management
    state: {
        showDoctorsOnly: false,
        showcancelled: false,
        currentView: 'resourceTimeGridDay'
    },

    // Get CSS class names based on status
    getEventClassNames: function (status) {
        const classNames = ['appointment-event'];
        if (status) {
            classNames.push(`status-${status.toLowerCase().replace(' ', '-')}`);
        }
        return classNames;
    },

    options: {
        themeSystem: 'standard',
        schedulerLicenseKey: CONFIG.LICENSE_KEY,

        initialView: CONFIG.DEFAULT_VIEW,
        initialDate: get_session_date(),

        scrollTime: CONFIG.SCROLL_TIME,

        slotMinTime: CONFIG.SLOT_MIN_TIME,
        slotMaxTime: CONFIG.SLOT_MAX_TIME,
        slotDuration: CONFIG.SLOT_DURATION,
        slotLabelInterval: CONFIG.SLOT_LABEL_INTERVAL,
        // slotEventOverlap: false,
        allDaySlot: false,
        slotLabelFormat: {
            hour: 'numeric',
            minute: '2-digit',
            omitZeroMinute: false,
            meridiem: 'short'
        },

        resourceAreaHeaderContent: 'Providers',
        resourceAreaWidth: CONFIG.RESOURCE_AREA_WIDTH,
        filterResourcesWithEvents: true,


        selectable: true,
        editable: true,
        droppable: true,
        nowIndicator: true,

        selectMinDistance: 2,
        nextDayThreshold: "08:00:00",

        // header configuration
        headerToolbar: {
            left: "jumpToNow searchAppointments",
            center: "title",
            right: "doctors cancelled toggleSide"
        },

        titleFormat: {
            weekday: 'long',
            day: 'numeric',
            month: 'short'
        },

        eventDataTransform: function (eventData) {
            const {
                name,
                customer,
                starts_at,
                ends_at,
                resource,
                background_color,
                text_color,
                ...extendedProps
            } = eventData;

            return {
                id: name,
                title: customer,
                start: starts_at,
                end: ends_at,
                resourceId: resource,
                backgroundColor: background_color,
                textColor: text_color,
                extendedProps,
                classNames: frappe.views.calendar["Patient Appointment"].getEventClassNames(extendedProps.status)
            };
        },

        resources: function (fetchInfo, successCallback, failureCallback) {
            const cacheKey = 'practitioner_resources';
            const cacheTime = 5 * 60 * 1000; // 5 minutes cache

            // Check cache first
            const cached = frappe.views.calendar["Patient Appointment"].getCachedResources(cacheKey, cacheTime);
            if (cached) {
                successCallback(cached);
                return;
            }

            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Healthcare Practitioner',
                    filters: [["Healthcare Practitioner", "status", "=", "Active"]],
                    fields: [
                        'name',
                        'first_name',
                        'custom_background_color',
                        'custom_text_color'
                    ],
                },
                callback: (r) => {
                    const resources = r.message.map(practitioner => ({
                        id: practitioner.name,
                        title: practitioner.first_name,
                        backgroundColor: practitioner.custom_background_color,
                        textColor: practitioner.custom_text_color,
                        extendedProps: {
                            order: 1,
                            background_color: practitioner.custom_background_color
                        }
                    }));

                    // Cache the results
                    frappe.views.calendar["Patient Appointment"].cacheResources(cacheKey, resources);
                    successCallback(resources);
                },
                error: () => failureCallback()
            });
        },

        // resource styling
        resourceLabelDidMount: function (resourceObj) {
            const { resource } = resourceObj;
            const { background_color, textColor } = resource.extendedProps;

            if (background_color) {
                resourceObj.el.style.background = background_color;
                resourceObj.el.style.borderLeft = `3px solid ${frappe.views.calendar["Patient Appointment"].darkenColor(background_color, 20)}`;
            }
            if (textColor) {
                resourceObj.el.style.color = textColor;
            }

            // Add hover effects
            resourceObj.el.classList.add('resource-label');
        },

        // drop handler
        drop: function (info) {
            $(info.draggedEl).fadeOut(300, function () {
                $(this).remove();
            });
        },

        // custom buttons
        customButtons: {
            doctors: {
                text: 'All Doctors',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].toggleViewMode('doctors');
                }
            },
            cancelled: {
                text: frappe.views.calendar["Patient Appointment"]?.state?.showcancelled ? 'Hide Cancelled' : 'Show Cancelled',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].state.showcancelled = !frappe.views.calendar["Patient Appointment"].state.showcancelled;
                    cur_list.calendar.fullCalendar.refetchEvents()

                    if (frappe.views.calendar["Patient Appointment"].state.showcancelled)
                        $(this).text('Hide Cancelled')
                    else
                        $(this).text('Show Cancelled')
                }
            },
            toggleSide: {
                text: '☰',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].toggleSidebar();
                }
            },
            jumpToNow: {
                text: '⏰ Now',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].jumpToCurrentTime();
                }
            },
            searchAppointments: {
                text: '🔍 Search',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].showSearchDialog();
                }
            }
        },

        // select handler
        select: function (info) {
            frappe.views.calendar["Patient Appointment"].createNewAppointment(info);
        },

        // event click handler
        eventClick: function (info) {
            frappe.views.calendar["Patient Appointment"].handleAppointmentClick(info);
        },

        // event hover handler
        eventMouseLeave: function (info) {
            $(`[role="tooltip"].popover`).remove();
        },

        // event drop handler
        eventDrop: function (info) {
            frappe.views.calendar["Patient Appointment"].showConfirmationDialog(
                `Move <strong>${info.event.title}</strong> appointment?`,
                `New time: <strong>${info.event.start.toLocaleTimeString()}</strong><br>
                 Practitioner: <strong>${info.event.getResources().map(r => r.title).join(', ')}</strong>`,
                () => updateEvent(info),
                () => info.revert()
            );
        },

        // event resize handler
        eventResize: function (info) {
            frappe.views.calendar["Patient Appointment"].showConfirmationDialog(
                `Resize <strong>${info.event.title}</strong> appointment?`,
                `New duration: <strong>${moment(info.event.end).diff(info.event.start, 'minutes')} minutes</strong>`,
                () => frappe.views.calendar["Patient Appointment"].updateAppointmentDuration(info),
                () => info.revert()
            );
        },

        // event rendering
        eventDidMount: function (info) {
            frappe.views.calendar["Patient Appointment"].applyEventStyling(info);
            frappe.views.calendar["Patient Appointment"].enhanceEventContent(info);
            frappe.views.calendar["Patient Appointment"].addEventInteractions(info);
        },

        // event content
        eventContent: function (arg) {
            return frappe.views.calendar["Patient Appointment"].getTimeGridEventContent(arg);
        },

        // events fetching
        events: function (fetchInfo, successCallback, failureCallback) {
            frappe.call({
                method: "do_health.api.methods.get_events_full_calendar",
                args: {
                    start: fetchInfo.startStr,
                    end: fetchInfo.endStr,
                    filters: {},
                    field_map: JSON.stringify({
                        showcancelled: frappe.views.calendar["Patient Appointment"].state.showcancelled || false
                    })
                },
                callback: (r) => {
                    if (r.message) {
                        const enhancedEvents = frappe.views.calendar["Patient Appointment"].enhanceEventsData(r.message);
                        successCallback(enhancedEvents);
                    } else {
                        console.error('No events data received');
                        failureCallback();
                    }
                },
                error: (err) => {
                    console.error('Error fetching events:', err);
                    failureCallback();
                }
            });
        },

        // View render handlers
        datesSet: function (info) {
            cur_list.$result.css('height', '');
            if ((sessionStorage.just_logged_in == 1) && isToday && ($('.fc-timegrid-now-indicator-arrow').length > 0)) {
                $('div.fc-scroller').animate({
                    scrollTop: ($('.fc-timegrid-now-indicator-arrow').position().top - 200)
                }, 25);
                sessionStorage.just_logged_in = 0;
            }

            console.log(info)

            set_current_session(info.view);
            update_waiting_list();
            sessionStorage.server_update = 0;

            // Update current view state
            frappe.views.calendar["Patient Appointment"].state.currentView = info.view.type;
        }
    },

    // Search appointments by name, mobile, or CPR
    showSearchDialog: function () {
        let d = new frappe.ui.Dialog({
            title: __('Search Appointments'),
            fields: [
                {
                    fieldtype: 'Link',
                    fieldname: 'patient',
                    label: __('Patient'),
                    options: 'Patient',
                    // placeholder: __('Enter patient name, mobile number, or CPR'),
                    reqd: 1,
                    onchange: function () {
                        var patient = d.get_value('patient');
                        if (patient) {
                            frappe.call({
                                method: 'frappe.client.get_value',
                                args: {
                                    doctype: 'Patient',
                                    filters: { name: patient },
                                    fieldname: 'patient_name'
                                },
                                callback(r) {
                                    if (r.message) {
                                        d.set_value('patient_name', r.message.patient_name);
                                    }
                                }
                            });
                        }
                    }
                },
                {
                    fieldtype: 'Data',
                    fieldname: 'patient_name',
                    label: __('Patient Name'),
                    hidden: 1,
                }
            ],
            primary_action_label: __('Search'),
            primary_action: function (values) {
                if (values) {
                    d.hide();
                    frappe.views.calendar["Patient Appointment"].searchAppointments(values);
                }
            }
        });

        d.show();
    },

    searchAppointments: function (patient) {
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Patient Appointment',
                filters: { patient: patient.patient },
                fields: ['name', 'patient', 'appointment_type', 'custom_visit_reason', 'appointment_date', 'appointment_time', 'practitioner', 'status'],
                limit: 50,
                order_by: 'appointment_date desc, appointment_time desc'
            },
            callback: function (r) {
                if (r.message && r.message.length > 0) {
                    // Get patient details for filtering
                    frappe.views.calendar["Patient Appointment"].displaySearchResults(r.message, patient);
                } else {
                    frappe.msgprint(__('No appointments found'));
                }
            }
        });
    },

    displaySearchResults: function (appointments, patient) {
        if (appointments.length === 0) {
            frappe.msgprint(__('No appointments found for: {0}', [patient.patient_name]));
            return;
        }

        let results_html = `
            <div class="search-results">
                <h5>${__('Found {0} appointments for: {1}', [appointments.length, patient.patient_name])}</h5>
                <div class="results-list" style="max-height: 400px; overflow-y: auto;">
        `;

        appointments.forEach(appt => {
            appt.apptHours = appt.appointment_time.split(':')[0];
            appt.apptMinutes = appt.appointment_time.split(':')[1];
            // Use data attributes instead of passing objects in onclick
            results_html += `
                <div class="search-result-item" style="padding: 10px; border-bottom: 1px solid #d1d8dd; cursor: pointer;" 
                     data-appointment-name="${appt.name}"
                     data-appointment-date="${appt.appointment_date}"
                     data-appointment-time="${appt.appointment_time}"
                    <strong>${appt.appointment_type}</strong><br>
                    <small>
                        ${frappe.datetime.str_to_user(appt.appointment_date)} at ${appt.apptHours}:${appt.apptMinutes}<br>
                        Practitioner: ${appt.practitioner || 'Not assigned'}<br>
                        Reason: ${appt.custom_visit_reason || 'Not assigned'}<br>
                        Status: <span class="label label-${appt.status === 'Scheduled' ? 'primary' : appt.status === 'Completed' ? 'success' : 'default'}">${appt.status}</span>
                    </small>
                </div>
            `;
        });

        results_html += `</div></div>`;

        const dialog = frappe.msgprint({
            title: __('Search Results'),
            message: results_html,
            indicator: 'blue'
        });

        // Add click event listeners after the dialog is rendered
        setTimeout(() => {
            $('.search-result-item').on('click', function () {
                const appointmentName = $(this).data('appointment-name');
                const appointmentDate = $(this).data('appointment-date');
                const appointmentTime = $(this).data('appointment-time');

                frappe.views.calendar["Patient Appointment"].goToAppointment(
                    appointmentName,
                    appointmentDate,
                    appointmentTime,
                    dialog
                );
            });
        }, 500);
    },

    goToAppointment: function (appointmentName, appointmentDate, appointmentTime, dialog) {
        var calendar = cur_list.calendar.fullCalendar;

        // Close the search dialog
        if (dialog && dialog.hide) {
            dialog.hide();
        }

        // Navigate to the appointment date
        sessionStorage.selected_date = new Date(appointmentDate);
        calendar.gotoDate(new Date(appointmentDate));

        // Scroll to the appointment time
        setTimeout(() => {
            // Find the time slot and scroll to it

            $('div.fc-scroller').animate({
                scrollTop: ($(`[data-time="${appointmentTime}"].fc-timegrid-slot`).position().top - 200)
            }, 500);

        }, 500);
    },

    // Create new appointment
    createNewAppointment: function (info) {
        set_current_session(info.view);

        var event = frappe.model.get_new_doc("Patient Appointment");

        // Check for rebooking from session storage
        if (sessionStorage.selected_appt && sessionStorage.selected_appt != '') {
            var appt = JSON.parse(sessionStorage.selected_appt);
            if (appt.name) {
                event.customer = appt.customer;
                event.note = (appt.note ? `${appt.note}\n` : '') + `(REBOOKED from ${moment(appt.date).format('D MMM')})`;
            } else if (appt.customer) {
                event.customer = appt.customer;
            }
        }

        // Set values for Patient Appointment
        event.appointment_date = info.startStr.split('T')[0];
        var starttime_local = moment(info.start).format("HH:mm:SS");
        var endtime_local = moment(info.end).format("HH:mm:SS");
        var EndTime = endtime_local.split(":");
        var StartTime = starttime_local.split(":");
        var hour = (EndTime[0] - StartTime[0]) * 60;
        var min = (EndTime[1] - StartTime[1]) + hour;

        event.appointment_time = starttime_local;
        event.appointment_timeo = starttime_local;
        event.duration = min;
        event.practitioner = info.resource ? info.resource.id : '';

        check_and_set_availability(event, true);
    },

    // Handle appointment click
    handleAppointmentClick: function (info) {
        // Convert FullCalendar event back to our format
        var eventData = {
            name: info.event.id,
            customer: info.event.title,
            starts_at: info.event.start,
            ends_at: info.event.end,
            resource: info.event.getResources()[0]?.id,
            ...info.event.extendedProps
        };
        check_and_set_availability(eventData);
    },

    // Show confirmation dialog
    showConfirmationDialog: function (title, message, confirmCallback, cancelCallback) {
        frappe.confirm(
            `<strong>${title}</strong><br>${message}`,
            confirmCallback,
            cancelCallback
        );
    },

    // Update appointment duration
    updateAppointmentDuration: function (info) {
        var starttime_local = moment(info.event.start).format("H:mm:ss");
        var endtime_local = moment(info.event.end).format("H:mm:ss");
        var duration = moment(info.event.end).diff(moment(info.event.start), 'minutes');

        frappe.call({
            method: 'frappe.client.set_value',
            args: {
                doctype: 'Patient Appointment',
                name: info.event.id,
                fieldname: {
                    appointment_date: moment(info.event.start).format("YYYY-MM-DD"),
                    appointment_time: starttime_local,
                    duration: duration,
                }
            },
            callback: function (r) {
                if (cur_list) cur_list.refresh(true);
                frappe.show_alert({
                    message: __('Appointment duration updated successfully'),
                    indicator: 'green'
                });
            }
        });
    },

    // Apply event styling
    applyEventStyling: function (info) {
        var event = info.event;
        var element = info.el;

        // Apply styles based on event status
        if (event.extendedProps.status == 'Completed') {
            element.style.backgroundColor = '#04d900';
            element.style.color = '#177245';
        } else if (event.extendedProps.status == 'No Show' || event.extendedProps.status == 'Cancelled') {
            element.classList.add('crossed-white');
        }

        // Add custom classes based on status
        if (event.extendedProps.status === 'Arrived') {
            element.classList.add('arrived-appointment');
        }
    },

    // Enhance event content
    enhanceEventContent: function (info) {
        var event = info.event;
        var element = info.el;

        // Format title
        var full_name = event.extendedProps.full_name || '';
        var short_name = full_name.split(' ')[0] + ' ' + full_name.trim().split(' ').splice(-1);
        var titleEl = element.querySelector('.fc-event-title');
        if (titleEl) {
            titleEl.innerHTML = `<strong>${short_name}</strong>`;
        }

        // Add custom details
        var duration = event.extendedProps.duration || SEhumanizer(moment.duration(event.end - event.start), {
            units: ['h', 'm', 's'],
            largest: 2,
            round: true
        });

        var timeEl = element.querySelector('.fc-event-time');
        if (timeEl) {
            timeEl.textContent = `${duration} min ▶ ${timeEl.textContent}`;
        }

        // Add custom content
        var details = `<div class="event-details" data-appt="${event.id}">
            ${event.extendedProps.procedure_name || ''}
            ${event.extendedProps.note || ''}
        </div>`;

        var status = `<div class="appt-status ${event.extendedProps.status?.toLowerCase().replace(' ', '-') || ''}">
            <span class="${info.view.type == 'timeGridDay' ? 'agenda-day' : ''} 
            ${event.extendedProps.status == 'Completed' ? 'hidden' : ''}"></span>
            ${event.extendedProps.status}
            <span style="${event.extendedProps.status != 'Arrived' ? 'display: none;' : ''}">
                <span class="arrival_timers">${moment(event.extendedProps.arrival_time, "HH:mm:ss").fromNow()}</span>
            </span>
        </div>`;

        var mainContent = element.querySelector('.fc-event-main .fc-event-main-frame');
        if (mainContent) {
            mainContent.insertAdjacentHTML('beforeend', status);
        }
    },

    // Add event interactions
    addEventInteractions: function (info) {
        var event = info.event;
        var element = info.el;

        // Right-click handler
        element.addEventListener('contextmenu', function (e) {
            e.preventDefault();

            // Remove any existing menu
            $('#custom-menu').remove();

            // Create the menu
            const menuHtml = `
                <ul id="custom-menu" class="dropdown-menu show" role="menu" style="position: absolute; z-index: 1050;">
                    <li class="dropdown-item" href="#">Open Appointment</li>
                    <li class="dropdown-item" href="#">Cancel Appointment</li>
                    <li class="dropdown-item" href="#">Billing</li>
                </ul>
            `;

            // Append the menu to the body
            $('body').append(menuHtml);

            // Position the menu at the cursor
            $('#custom-menu').css({
                top: e.pageY + 'px',
                left: e.pageX + 'px'
            });

            // Add click handlers for menu items
            $('#custom-menu .dropdown-item').on('click', function () {
                const action = $(this).text();
                if (action === 'Edit Appointment') {
                    appointmentActions.editAppointment(event.id);
                }
                else if (action === 'Vital Signs') {
                    frappe.confirm('Are you sure you want to cancel this appointment?', () => {
                        frappe.msgprint('Appointment canceled');
                    });
                }
                else if (action === 'Billing') {
                    appointmentActions.openBillingInterface(event.id);
                }

                // Remove the menu after selection
                $('#custom-menu').remove();
            });

            // Remove the menu if clicked outside
            $(document).on('click', function () {
                $('#custom-menu').remove();
            });
        });

        // Create popover
        this.createPopover(element, event);
    },

    // Create popover
    createPopover: function (element, event) {
        var created_by = formatUserName(event.extendedProps.owner);
        var modified_by = formatUserName(event.extendedProps.modified_by);

        var popoverContent = `
            <div id="popoverX-${event.id}" class="popover-x popover-default popover-md">
                <div class="arrow"></div>
                <div style="background-color: #D9D9D9;opacity: 0.9;" class="popover-header popover-content">
                    ${event.extendedProps.full_name} <small class=""><br/>
                    <span class="${event.extendedProps.birthdate ? "" : "hidden"}">Age: ${moment().diff(event.extendedProps.birthdate, 'years')} | </span>
                    <span class="${event.extendedProps.file_number ? "" : "hidden"}">File: ${event.extendedProps.file_number} | </span>
                    <span class="${event.extendedProps.cpr ? "" : "hidden"}"> CPR: ${event.extendedProps.cpr} | </span>${event.extendedProps.mobile}</small>
                </div>
                <div style="background-color: #F2F2F2" class="popover-body popover-content">
                    <div style="background-color: #F2F2F2" class="row">
                        <div class="col-md-5 ${event.extendedProps.image ? "" : "hidden"}">
                            ${event.extendedProps.image ? `<img class="img-thumbnail img-responsive" src="${event.extendedProps.image}">` : ''}
                        </div>
                        <div class="col-md-7" style="${event.extendedProps.image ? "padding-left: 0px;" : ""}">
                            ${event.extendedProps.appointment_type ? `<small><b>Type:</b> ${event.extendedProps.appointment_type}</small><br/>` : ''}
                            ${event.extendedProps.visit_reason ? `<small><b>Reason:</b> ${event.extendedProps.visit_reason}</small><br/>` : ''}
                            ${event.extendedProps.room ? `<small><b>Room:</b> ${event.extendedProps.room}</small><br/>` : ''}
                            ${event.extendedProps.note ? `<small><b>Notes:</b> ${event.extendedProps.note}</small><br/>` : ''}
                            <small><div class="label label-warning">
                                ${event.extendedProps.status ? `${event.extendedProps.status}<br/>` : ''}
                            </div></small>
                        </div>
                    </div>
                </div>
                <div style="background-color: #D9D9D9;opacity: 0.9;" class="popover-footer">
                    <div class="small text-left" data-popoverap="${event.id}">
                        <span> Created by: ${created_by}</span>
                        <span> on ${moment(event.extendedProps.creation).format('Do MMM')}</span>
                        <div class="${event.extendedProps.modified_by != event.extendedProps.owner ? "" : "hidden"}">
                            <span>Modified by: ${modified_by}</span>
                            <span> on ${moment(event.extendedProps.modified).format('Do MMM')}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        element.insertAdjacentHTML('beforeend', popoverContent);
        $(`[role="tooltip"].popover`).remove();
        if (event.id) {
            // Initialize popover
            $(element).popover({
                trigger: 'hover',
                content: $(`#popoverX-${event.id}`).html(),
                html: true,
                placement: 'auto'
            });
        }
    },

    // Calculate event duration
    calculateDuration: function (event) {
        return moment(event.end).diff(moment(event.start), 'minutes');
    },

    // Enhance events data
    enhanceEventsData: function (events) {
        let fillteredEvents = events;
        if (!frappe.views.calendar["Patient Appointment"].state.showcancelled) {
            fillteredEvents = events.filter(event => event.status !== 'Cancelled');
        }
        return fillteredEvents.map(event => {
            // Add any additional event processing here
            if (!event.duration && event.start && event.end) {
                event.duration = this.calculateDuration(event);
            }
            return event;
        });
    },

    // Get time grid event content
    getTimeGridEventContent: function (arg) {
        const { status, appointment_type, room, note, duration } = arg.event.extendedProps;
        return {
            html: `
                <div class="fc-event-main-frame appt-card ${status?.toLowerCase().replace(' ', '-') || ''}">
                    <div class="appt-header">
                        <div class="appt-title">${arg.event.title}</div>
                        <div class="appt-duration">${duration || this.calculateDuration(arg.event)}m</div>
                    </div>
                    <div class="appt-meta">
                        <div class="appt-type"><i class="fa fa-user-md"></i> ${appointment_type || ''}</div>
                        ${room ? `<div class="appt-room"><i class="fa fa-home"></i> ${room}</div>` : ''}
                        ${note ? `<div class="appt-note"><i class="fa fa-commenting"></i> ${note}</div>` : ''}
                    </div>
                </div>
            `
        };
    },

    // Toggle view mode
    toggleViewMode: function (mode) {
        this.state.showDoctorsOnly = (mode === 'doctors');
        this.state.showcancelled = (mode === 'cancelled');

        cur_list.calendar.fullCalendar.refetchResources();
        cur_list.calendar.fullCalendar.setOption('filterResourcesWithEvents', false);

        // Update button states
        this.updateButtonStates(mode);
    },

    // Update button states
    updateButtonStates: function (activeMode) {
        const modes = ['all', 'doctors', 'cancelled'];
        modes.forEach(mode => {
            const button = $(`.fc-${mode}-button`);
            if (mode === activeMode) {
                button.addClass('btn-primary').removeClass('btn-secondary');
            } else {
                button.addClass('btn-secondary').removeClass('btn-primary');
            }
        });
    },

    // Toggle sidebar
    toggleSidebar: function () {
        $('.layout-side-section').toggleClass("hidden");
        $('.layout-main-section-wrapper').toggleClass("col-md-12 col-md-10");
        // Trigger resize event for calendar to adjust
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 300);
    },

    // Jump to current time
    jumpToCurrentTime: function () {
        var calendar = cur_list.calendar.fullCalendar;
        var view = calendar.view;

        if ($('.fc-timegrid-now-indicator-arrow').length > 0) {
            $('div.fc-scroller').animate({
                scrollTop: ($('.fc-timegrid-now-indicator-arrow').position().top - 200)
            }, 1250);
            sessionStorage.selected_date = new Date();
        } else {
            sessionStorage.selected_date = new Date();
            calendar.gotoDate(new Date());
        }
    },

    // Get cached resources
    getCachedResources: function (cacheKey, cacheTime) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const { timestamp, data } = JSON.parse(cached);
            if (Date.now() - timestamp < cacheTime) {
                return data;
            }
        }
        return null;
    },

    // Cache resources
    cacheResources: function (cacheKey, data) {
        sessionStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: data
        }));
    },

    // Darken color utility
    darkenColor: function (color, percent) {
        // Simple color darkening utility
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
    },

    get_events_method: "do_health.api.methods.get_events_full_calendar"
};

// Helper functions

// update_waiting_list with real-time updates
function update_waiting_list() {
    frappe.call({
        method: 'do_health.api.methods.get_waiting_list',
        callback: function (r) {
            render_waiting_list_table(r.message);
            // Schedule next update
            setTimeout(update_waiting_list, 30000); // Update every 30 seconds
        }
    });
}
function render_waiting_list_table(data) {
    if ($('#monthdatepicker').length == 0) {
        sessionStorage.server_update = 0;

        cur_list.$page.find(".layout-side-section .list-sidebar").prepend(function () {
            // return $('<div id="monthdatepicker" style="width: 210px"></div>').datepicker({
            return $('<div id="monthdatepicker"></div>').datepicker({
                language: 'en',
                todayButton: new Date(),
                onSelect: function (d, i) {
                    if (i && d !== i.lastVal) {
                        sessionStorage.selected_date = moment(i).format();
                        // $('.fc').fullCalendar('gotoDate', i);
                        cur_list.calendar.fullCalendar.gotoDate(i);
                    }
                },
            });

        });

        // $('#mycss').css('background-color','#FFFFFF').css('padding','10px');
        $("div.col-lg-2.layout-side-section").css('max-width', '25%');      // increase the wating list width
        $("div.col-lg-2.layout-side-section").css('padding', '1px');
        $("div.monthdatepicker").css("width: 300px");
        // wating list
        $("#monthdatepicker").append(function () {
            return $(`
                <div id="Wating-List">  
                    <table id="waitinglist" class="table table-striped table-hover table-condensed">
                        <thead>
                         <tr>
                           <th class="text-left small" style="padding: 1px">Patient</th>
                           <th class="text-right small" style="padding: 1px">Waited</th>
                           <th class="text-right small" style="padding: 1px">Arrived</th>
                         </tr>
                        </thead>
                        <tbody></tbody>
                        </table>
                </div>
            `)
        });
    }

    $("#waitinglist tbody").remove();
    var rows = '';

    if (data) {
        for (var i in data) {
            var name = `${data[i].patient_name.trim().split(' ')[0]} ${data[i].patient_name.trim().split(' ').splice(-1)}`
            var arrival_time = moment(data[i].arrival_time, "HH:mm:ss");
            var arrived = moment().diff(arrival_time) < 60000 ? '1m' : SEhumanizer(moment().diff(arrival_time), { units: ['h', 'm', 's'], largest: 2, round: true });
            var from_time = moment(data[i].appointment_time, "HH:mm:ss");
            var delayed_by = moment().diff(from_time);
            var punctuality = arrival_time.diff(from_time);
            var provider = data[i].practitioner;

            if (provider == 'Dr Nedhal' || provider == 'Walk-in DO') {
                // provider = 'background-color: #ffa685;color: black;';
                provider = 'background-color: #FFB4A2;color: black;';
                // provider = 'orange';
            } else if (provider == 'Dr Sadiq' || provider == 'Walk-in SC') {
                provider = 'background-color: #7575ff; color: white;';
                // provider = 'blue';
            } else if (provider == 'Dr Amani') {
                provider = 'background-color: #fdfd96; color: black;';
            } else if (provider == 'Dr Kameela') {
                provider = 'background-color: #ffc4c4; color: black;';
            } else if (provider == 'SurgiCare') {
                provider = 'background-color: #a83333; color: white;';
                // <span class="${provider != '' ? 'indicator' : ''} ${provider}"></span>
            } else {
                provider = ''
            }

            rows += `
            <tr  data-appt="${data[i].name}" title="Appointment ${delayed_by < -60000 ? 'is in ' + SEhumanizer(delayed_by, { units: ['h', 'm', 's'], largest: 2, round: true }) : (delayed_by < 60000 ? 'is now' : 'delayed by ' + SEhumanizer(delayed_by, { units: ['h', 'm', 's'], largest: 2, round: true }))}">
            <td style="${provider} padding: 1px">
                <strong><small>
                ${name}
                </small></strong>
            </td>
            <td class="text-right" style="${moment().diff(arrival_time, 'minutes') > 60 ? 'color: red;' : ''} padding: 1px">${arrived}</td>
            <td class="text-right small" style="padding: 1px">
                ${punctuality < -240000 ? SEhumanizer(punctuality, { units: ['h', 'm', 's'], largest: 2, round: true }) + ' early' : (punctuality < 240000 ? 'on time' : SEhumanizer(punctuality, { units: ['h', 'm', 's'], largest: 2, round: true }) + ' late')}
            </td>
            </tr>
            `;

        }
    }
    $('#waitinglist').append(`<tbody>${rows}</tbody>`);
    $('#waitinglist tr').each(function (i, e) {
        if ($(e).data('appt')) {
            $(e).popoverButton({
                trigger: 'hover focus',
                target: `#popoverX-${$(e).data('appt')}`,
                placement: 'auto-right',
                padding: '1px'
            });
        }
    });
}

function set_current_session(view) {
    sessionStorage.selected_date = view.currentStart;
    sessionStorage.selected_view = view.type;
}

function updateEvent(info) {
    const starttime_local = moment(info.event.start).format("H:mm:ss");
    const endtime_local = moment(info.event.end).format("H:mm:ss");
    const duration = moment(info.event.end).diff(moment(info.event.start), 'minutes');

    frappe.call({
        method: 'frappe.client.set_value',
        args: {
            doctype: 'Patient Appointment',
            name: info.event.id,
            fieldname: {
                appointment_date: moment(info.event.start).format("YYYY-MM-DD"),
                appointment_time: starttime_local,
                duration: duration,
                practitioner: info.event.getResources()[0].id
            }
        },
        callback: function (r) {
            if (cur_list) cur_list.refresh(true);
        }
    });
}

function get_session_date() {
    return sessionStorage.selected_date ? new Date(sessionStorage.selected_date) : new Date();
}

function formatUserName(user) {
    if (!user) return '';
    var fullName = frappe.user.full_name(user);
    if (fullName.startsWith('Dr')) {
        return `Dr ${fullName.split(' ')[1]}`;
    } else {
        return fullName.split(' ')[0];
    }
}

async function loadAvailableServices(appointment) {
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Healthcare Service Template',
            fields: ['name', 'service_name', 'base_price']
        },
        callback: function (r) {
            console.log(document)
            const container = document.getElementById('available-services');
            container.innerHTML = '';
            r.message.forEach(service => {
                const card = document.createElement('div');
                card.className = 'service-card bg-white shadow-sm hover:shadow-md transition p-3 rounded-lg cursor-pointer border';
                card.draggable = true;
                card.dataset.service = service.name;
                card.innerHTML = `
              <div class="font-medium">${service.service_name}</div>
              <div class="text-xs text-gray-500">${service.base_price} BHD</div>
            `;
                card.addEventListener('click', () => addServiceToSelection(service, appointment));
                container.appendChild(card);
            });
        }
    });

}

async function renderSelectedServices(appointment) {
    const container = document.getElementById('selected-services');
    console.log($('#selected-services'))
    container.innerHTML = '';

    const res = await frappe.call({
        method: 'frappe.client.get',
        args: { doctype: 'Patient Appointment', name: appointment.name }
    });

    const services = res.message.appointment_services || [];
    let patientTotal = 0, insuranceTotal = 0;

    services.forEach((srv, idx) => {
        const card = document.createElement('div');
        card.className = 'selected-service bg-white shadow-sm p-3 rounded-lg flex justify-between items-center';
        card.innerHTML = `
      <div>
        <div class="font-medium">${srv.service}</div>
        <div class="text-xs text-gray-500">Practitioner: ${appointment.practitioner}</div>
      </div>
      <div class="text-right">
        ${appointment.billing_type === 'Insurance' ? `
          <div class="text-xs text-blue-600">Insurance: ${srv.insurance_share || 0}</div>
          <div class="text-xs text-amber-600">Patient: ${srv.patient_share || 0}</div>
        ` : `<div class="font-semibold">${srv.price} BHD</div>`}
      </div>
    `;
        container.appendChild(card);

        if (appointment.billing_type === 'Insurance') {
            patientTotal += srv.patient_share || 0;
            insuranceTotal += srv.insurance_share || 0;
        } else {
            patientTotal += srv.price || 0;
        }
    });

    document.getElementById('patient-total').textContent = patientTotal.toFixed(2);
    document.getElementById('insurance-total').textContent = insuranceTotal.toFixed(2);
    document.getElementById('total-price').textContent = (patientTotal + insuranceTotal).toFixed(2);
}

async function addServiceToSelection(service, appointment) {
    await frappe.call({
        method: 'frappe.client.insert',
        args: {
            doc: {
                doctype: 'Appointment Service',
                parent: appointment.name,
                parenttype: 'Patient Appointment',
                parentfield: 'appointment_services',
                service: service.name
            }
        }
    });
    await renderSelectedServices(appointment);
}

async function generateAppointmentInvoice(appointment) {
    await frappe.call({
        method: 'your_app.api.create_invoice_for_appointment',
        args: { appointment: appointment.name }
    });
}

const appointmentActions = {
    // 1. Edit Appointment
    editAppointment(appointmentId) {
        frappe.set_route('Form', 'Patient Appointment', appointmentId);
    },

    // 2. Add Vital Signs
    addVitalSigns(appointmentId) {
        frappe.new_doc('Vital Signs', {
            appointment: appointmentId,
        });
    },

    // 3. Billing and Payment
    async openBillingInterface(appointmentId) {
        await frappe.db.get_doc('Patient Appointment', appointmentId)
            .then(async (appointment) => {
                const dialog = new frappe.ui.Dialog({
                    title: `💳 Billing — ${appointment.patient_name}`,
                    size: 'extra-large',
                    primary_action_label: 'Generate Invoice',
                    primary_action: async () => {
                        await generateAppointmentInvoice(appointment);
                        dialog.hide();
                        frappe.show_alert({ message: 'Invoice created successfully', indicator: 'green' });
                    },
                });

                dialog.$body.html(`
                    <div class="billing-wrapper flex" style="gap: 20px; min-height: 500px;">
                    
                    <!-- Left Column: Services Library -->
                    <div class="services-library w-1/2 bg-gray-50 p-3 rounded-xl overflow-y-auto border">
                        <h5 class="font-semibold mb-3">Available Services</h5>
                        <div class="service-items grid grid-cols-2 gap-3" id="available-services"></div>
                    </div>

                    <!-- Right Column: Selected & Billing Details -->
                    <div class="selected-services w-1/2 p-3 rounded-xl border">
                        <h5 class="font-semibold mb-3">Selected Services</h5>
                        <div id="selected-services" class="selected-items space-y-3"></div>
                        
                        <hr class="my-3" />

                        <div class="billing-summary text-sm">
                        <div class="flex justify-between"><span>Patient Share:</span> <span id="patient-total">0</span></div>
                        <div class="flex justify-between"><span>Insurance Share:</span> <span id="insurance-total">0</span></div>
                        <div class="flex justify-between font-bold border-t mt-2 pt-2"><span>Total:</span> <span id="total-price">0</span></div>
                        </div>
                    </div>
                    </div>
                `);

                await dialog.show();
                console.log('dialog')
                console.log(document.getElementById('available-services'))

                await loadAvailableServices(appointment);
                await renderSelectedServices(appointment);
            });
    },

    // 4. Update Payment Type
    async updatePaymentType(appointmentId, paymentType) {
        frappe.prompt(
            {
                fieldname: 'payment_type',
                label: 'Payment Type',
                fieldtype: 'Select',
                options: ['', 'Self Payment', 'Insurance'],
                default: paymentType,
                reqd: 1,
            },
            async (values) => {
                await frappe.db.set_value('Patient Appointment', appointmentId, 'custom_payment_type', values.payment_type)
                    .then(r => {
                        frappe.show_alert('Payment type updated');
                    })
            },
            'Update Payment Type',
            'Update'
        );
    },

    // 5. Add Patient Encounter
    addPatientEncounter(appointmentId) {
        frappe.db.get_value('Patient Encounter', { appointment: appointmentId, docstatus: ['!=', 2] }, 'name')
            .then(encounter => {
                if (encounter.message.name) {
                    frappe.set_route('Form', 'Patient Encounter', encounter.message.name);
                }
                else {
                    frappe.db.get_value('Patient Appointment',
                        appointmentId,
                        ['name', 'practitioner', 'patient', 'department']
                    ).then(function (appointment) {
                        const appointmentDoc = appointment.message; // Fixed: massage -> message
                        frappe.new_doc('Patient Encounter', {}, newEncounter => {
                            newEncounter.appointment = appointmentDoc.name;
                            newEncounter.encounter_date = frappe.datetime.nowdate();
                            newEncounter.encounter_time = frappe.datetime.now_time();
                            newEncounter.patient = appointmentDoc.patient;
                            newEncounter.practitioner = appointmentDoc.practitioner;
                            newEncounter.medical_department = appointmentDoc.department;
                        });
                    });
                }
            })
    },

    // 6. Add Visit Note
    addVisitNote(appointmentId, visitNotes) {
        frappe.prompt(
            {
                fieldname: 'visit_notes',
                label: 'Visit Notes',
                fieldtype: 'Small Text',
                default: visitNotes,
            },
            async (values) => {
                await frappe.db.set_value('Patient Appointment', appointmentId, 'custom_visit_notes', values.visit_notes)
                    .then(r => {
                        frappe.show_alert('Payment type updated');
                    })
            },
            'Update Payment Type',
            'Update'
        );
    },

    // 7. Change Visit Status
    async changeVisitStatus(appointmentId) {
        frappe.prompt(
            {
                fieldname: 'status',
                label: 'Visit Status',
                fieldtype: 'Select',
                options: ['Checked In', 'Under Consultation', 'Completed', 'Cancelled'],
                reqd: 1,
            },
            async (values) => {
                await frappe.call({
                    method: 'do_health.api.methods.update_visit_status',
                    args: {
                        appointment_id: appointmentId,
                        status: values.status,
                    },
                    callback() {
                        frappe.show_alert('Visit status updated');
                    },
                });
            },
            'Change Visit Status',
            'Update'
        );
    },

    // 8. Add / Book Follow-up Appointment
    bookFollowUp(appointmentId) {
        frappe.new_doc('Patient Appointment', {
            follow_up_of: appointmentId,
        });
    },

    // 9. Add Visit Reason
    async addVisitReason(appointmentId) {
        frappe.prompt(
            {
                fieldname: 'reason',
                label: 'Visit Reason',
                fieldtype: 'Small Text',
                reqd: 1,
            },
            async (values) => {
                await frappe.call({
                    method: 'do_health.api.methods.update_visit_reason',
                    args: {
                        appointment_id: appointmentId,
                        reason: values.reason,
                    },
                    callback() {
                        frappe.show_alert('Visit reason updated');
                    },
                });
            },
            'Add Visit Reason',
            'Save'
        );
    },

    // 10. Show Patient Visit Log
    async showVisitLog(appointmentId) {
        const r = await frappe.call({
            method: 'do_health.api.methods.get_visit_log',
            args: { appointment_id: appointmentId },
        });

        if (r.message && r.message.length) {
            let logHtml = r.message
                .map(
                    (entry) =>
                        `<div>
              <b>${entry.date}</b> - ${entry.action} by ${entry.user}
            </div>`
                )
                .join('');
            frappe.msgprint({
                title: 'Visit Log',
                message: logHtml,
                indicator: 'blue',
            });
        } else {
            frappe.msgprint('No visit logs found.');
        }
    },
};

frappe.realtime.on("appointment_update", function (data) {
    var current_route = frappe.get_route();
    if (current_route[1] == 'Patient Appointment' && current_route[2] == 'Calendar') {
        setTimeout(function () {
            sessionStorage.server_update = 1;
            // Refresh calendar - Frappe will handle this automatically
            frappe.utils.play_sound('click');
        }, 250);
    }
});

frappe.realtime.on("appointment_delete", function (data) {
    var current_route = frappe.get_route();
    if (current_route[1] == 'Patient Appointment' && current_route[2] == 'Calendar') {
        setTimeout(function () {
            sessionStorage.server_update = 1;
            // Refresh calendar - Frappe will handle this automatically
            frappe.utils.play_sound('click');
        }, 500);
    }
});

function scrollToTime(time) {
    var targets = $('.fc-axis');

    $.each(targets, function () {
        var scrollable = $(this),
            closestTime = $(this).closest('tr').data('time');

        if (closestTime === time) {
            $('div.fc-scroller').animate({
                scrollTop: scrollable.offset().top - 200
            }, 1250);
        }
    });
};

let check_and_set_availability = function (event, is_new = false) {
    // Store original event to avoid mutation issues
    let originalEvent = event;
    let latest_doc = null;

    if (!is_new && event && event.name) {
        frappe.call({
            method: 'frappe.client.get',
            freeze: true,
            freeze_message: __('Getting Appointment...'),
            args: {
                doctype: 'Patient Appointment',
                name: event.name
            },
            async: false,
            callback: function (r) {
                if (!r.exc) {
                    latest_doc = r.message;
                    event = r.message;
                }
            }
        });
    }

    let selected_slot = event ? event.appointment_time : null;
    let service_unit = null;
    let duration = event ? event.duration : 30; // default duration
    let add_video_conferencing = null;
    let overlap_appointments = null;
    let appointment_based_on_check_in = false;

    show_availability();

    function show_empty_state(practitioner, appointment_date) {
        frappe.msgprint({
            title: __('Not Available'),
            message: __('Healthcare Practitioner {0} not available on {1}', [practitioner.bold(), appointment_date.bold()]),
            indicator: 'red'
        });
    }

    function show_availability() {
        let selected_practitioner = '';
        let d = new frappe.ui.Dialog({
            title: __('Available slots'),
            fields: [
                { fieldtype: 'Section Break', label: 'Patient Details', collapsible: 0 },
                { fieldtype: 'Link', options: 'Patient', reqd: 1, fieldname: 'patient', label: 'Patient', onchange: () => { d.get_primary_btn().attr('disabled', null) } },
                { fieldtype: 'Data', fieldname: 'patient_name', label: 'Patient Name', read_only: 1, onchange: () => { d.get_primary_btn().attr('disabled', null) } },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'patient_cpr', label: 'CPR', read_only: 1 },
                { fieldtype: 'Data', fieldname: 'patient_mobile', label: 'Mobile', read_only: 1 },
                { fieldtype: 'Section Break' },
                { fieldtype: 'Select', options: 'First Time\nFollow Up\nProcedure\nSession', reqd: 1, fieldname: 'appointment_category', label: 'Appointment Category' },
                { fieldtype: 'Link', fieldname: 'appointment_type', options: 'Appointment Type', label: 'Appointment Type', onchange: () => { d.get_primary_btn().attr('disabled', null) } },
                { fieldtype: 'Data', fieldname: 'appointment_for', label: 'Appointment For', hidden: 1, default: 'Practitioner' },
                { fieldtype: 'Int', fieldname: 'duration', label: 'Duration', default: duration, onchange: () => { d.get_primary_btn().attr('disabled', null) } },
                { fieldtype: 'Check', fieldname: 'confirmed', label: 'Confirmed?', onchange: () => { d.get_primary_btn().attr('disabled', null) } },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Link', fieldname: 'branch', options: 'Branch', label: 'Branch', onchange: () => { d.get_primary_btn().attr('disabled', null) } },
                { fieldtype: 'Small Text', fieldname: 'notes', label: 'Notes', onchange: () => { d.get_primary_btn().attr('disabled', null) } },
                { fieldtype: 'Section Break' },
                { fieldtype: 'Link', options: 'Healthcare Practitioner', reqd: 1, fieldname: 'practitioner', label: 'Healthcare Practitioner' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Date', reqd: 1, fieldname: 'appointment_date', label: 'Date', min_date: new Date(frappe.datetime.get_today()) },
                { fieldtype: 'Section Break' },
                { fieldtype: 'HTML', fieldname: 'available_slots' },
            ],
            primary_action_label: __('Book'),
            primary_action: async function () {
                let data = {
                    'patient': d.get_value('patient'),
                    'custom_appointment_category': d.get_value('appointment_category'),
                    'appointment_type': d.get_value('appointment_type'),
                    'appointment_for': d.get_value('appointment_for'),
                    'duration': d.get_value('duration'),
                    'custom_confirmed': d.get_value('confirmed'),
                    'custom_branch': d.get_value('branch'),
                    'notes': d.get_value('notes'),
                    'practitioner': d.get_value('practitioner'),
                    'appointment_date': d.get_value('appointment_date'),
                    'service_unit': service_unit,
                }

                if (is_new) {
                    // Validate required fields for new appointment
                    if (!selected_slot) {
                        frappe.msgprint({
                            title: __('Error'),
                            message: __('Please select an appointment time slot'),
                            indicator: 'red'
                        });
                        return;
                    }

                    // For new appointments, create the full document
                    let doc_data = {
                        'doctype': 'Patient Appointment',
                        'patient': data.patient,
                        'custom_appointment_category': data.custom_appointment_category,
                        'appointment_type': data.appointment_type,
                        'appointment_for': data.appointment_for,
                        'duration': data.duration,
                        'custom_confirmed': data.custom_confirmed,
                        'custom_branch': data.custom_branch,
                        'notes': data.notes,
                        'practitioner': data.practitioner,
                        'appointment_date': data.appointment_date,
                        'appointment_time': selected_slot,
                        'service_unit': data.service_unit,
                    };

                    frappe.call({
                        method: 'frappe.client.insert',
                        freeze: true,
                        freeze_message: __('Booking Appointment...'),
                        args: {
                            doc: doc_data
                        },
                        callback: function (r) {
                            if (!r.exc) {
                                d.hide();
                                frappe.show_alert({
                                    message: __('Appointment booked successfully'),
                                    indicator: 'green'
                                });
                                if (cur_list && cur_list.calendar && cur_list.calendar.fullCalendar) {
                                    cur_list.calendar.fullCalendar.refetchResources();
                                    cur_list.calendar.fullCalendar.setOption('filterResourcesWithEvents', false);
                                    cur_list.refresh();
                                    scrollToTime(r.message.appointment_time);
                                }
                            } else {
                                frappe.msgprint({
                                    title: __('Error'),
                                    message: __('Failed to book appointment: {0}', [r.exc]),
                                    indicator: 'red'
                                });
                            }
                            d.get_primary_btn().attr('disabled', null);
                        }
                    });

                } else {
                    // For existing appointments, get latest document first
                    frappe.call({
                        method: 'frappe.client.get',
                        args: {
                            doctype: 'Patient Appointment',
                            name: event.name
                        },
                        callback: function (r) {
                            if (r.exc) {
                                frappe.msgprint({
                                    title: __('Error'),
                                    message: __('Failed to get latest document. Please refresh and try again.'),
                                    indicator: 'red'
                                });
                                d.get_primary_btn().attr('disabled', null);
                                return;
                            }

                            let latest_doc = r.message;
                            let updatePromises = [];

                            // Check each field and add to update promises if changed
                            if (data.patient !== latest_doc.patient) {
                                updatePromises.push(updateField('patient', data.patient));
                            }
                            if (data.custom_appointment_category !== latest_doc.custom_appointment_category) {
                                updatePromises.push(updateField('custom_appointment_category', data.custom_appointment_category));
                            }
                            if (data.appointment_type !== latest_doc.appointment_type) {
                                updatePromises.push(updateField('appointment_type', data.appointment_type));
                            }
                            if (data.appointment_for !== latest_doc.appointment_for) {
                                updatePromises.push(updateField('appointment_for', data.appointment_for));
                            }
                            if (parseInt(data.duration) !== parseInt(latest_doc.duration)) {
                                updatePromises.push(updateField('duration', data.duration));
                            }
                            if (data.custom_confirmed !== latest_doc.custom_confirmed) {
                                updatePromises.push(updateField('custom_confirmed', data.custom_confirmed));
                            }
                            if (data.custom_branch !== latest_doc.custom_branch) {
                                updatePromises.push(updateField('custom_branch', data.custom_branch));
                            }
                            if (data.notes !== latest_doc.notes) {
                                updatePromises.push(updateField('notes', data.notes));
                            }
                            if (data.practitioner !== latest_doc.practitioner) {
                                updatePromises.push(updateField('practitioner', data.practitioner));
                            }
                            if (data.appointment_date !== latest_doc.appointment_date) {
                                updatePromises.push(updateField('appointment_date', data.appointment_date));
                            }
                            if (selected_slot && selected_slot !== latest_doc.appointment_time) {
                                updatePromises.push(updateField('appointment_time', selected_slot));
                            }
                            if (data.service_unit !== latest_doc.service_unit) {
                                updatePromises.push(updateField('service_unit', data.service_unit));
                            }

                            // If no fields changed, show message and return
                            if (updatePromises.length === 0) {
                                frappe.show_alert({
                                    message: __('No changes made to the appointment'),
                                    indicator: 'blue'
                                });
                                d.get_primary_btn().attr('disabled', null);
                                return;
                            }

                            // Disable button and update fields
                            d.get_primary_btn().attr('disabled', true);

                            // Execute all update promises
                            Promise.all(updatePromises)
                                .then(() => {
                                    d.hide();
                                    frappe.show_alert({
                                        message: __('Appointment updated successfully'),
                                        indicator: 'green'
                                    });
                                    if (cur_list && cur_list.calendar && cur_list.calendar.fullCalendar) {
                                        cur_list.calendar.fullCalendar.refetchResources();
                                        cur_list.calendar.fullCalendar.setOption('filterResourcesWithEvents', false);
                                        cur_list.refresh();
                                    }
                                })
                                .catch((error) => {
                                    if (error.includes('has been modified after you have opened it')) {
                                        frappe.msgprint({
                                            title: __('Document Updated'),
                                            message: __('This appointment was modified by another user. Please refresh the page and try again.'),
                                            indicator: 'orange'
                                        });
                                    } else {
                                        frappe.msgprint({
                                            title: __('Error'),
                                            message: __('Failed to update appointment: {0}', [error]),
                                            indicator: 'red'
                                        });
                                    }
                                })
                                .finally(() => {
                                    d.get_primary_btn().attr('disabled', null);
                                });
                        }
                    });
                }

                // Helper function to update individual field
                function updateField(fieldname, value) {
                    return new Promise((resolve, reject) => {
                        frappe.call({
                            method: 'frappe.client.set_value',
                            args: {
                                doctype: 'Patient Appointment',
                                name: event.name,
                                fieldname: fieldname,
                                value: value
                            },
                            callback: function (r) {
                                if (!r.exc) {
                                    resolve();
                                } else {
                                    reject(r.exc);
                                }
                            }
                        });
                    });
                }
            }
        });

        // Set initial values safely
        if (event) {
            d.set_values({
                'practitioner': event.practitioner,
                'appointment_date': event.appointment_date,
            });

            if (!is_new) {
                d.set_values({
                    'patient': event.patient,
                    'appointment_category': event.custom_appointment_category,
                    'appointment_type': event.appointment_type,
                    'duration': event.duration,
                    'confirmed': event.custom_confirmed,
                    'branch': event.custom_branch,
                    'notes': event.notes,
                });
            }
        }

        // disable dialog action initially
        d.get_primary_btn().attr('disabled', true);

        // Field Change Handler
        let fd = d.fields_dict;

        d.fields_dict['appointment_date'].df.onchange = () => {
            show_slots(d, fd);
        };

        d.fields_dict['practitioner'].df.onchange = () => {
            if (d.get_value('practitioner') && d.get_value('practitioner') != selected_practitioner) {
                selected_practitioner = d.get_value('practitioner');
                show_slots(d, fd);
            }
        };

        d.fields_dict['patient'].df.onchange = () => {
            let patient_value = d.get_value('patient');
            if (patient_value) {
                frappe.call({
                    method: 'frappe.client.get_value',
                    args: {
                        doctype: 'Patient',
                        filters: { name: patient_value },
                        fieldname: ['patient_name', 'custom_cpr', 'mobile']
                    },
                    callback: function (response) {
                        if (!response.exc) {
                            d.set_value('patient_name', response.message.patient_name);
                            d.set_value('patient_cpr', response.message.custom_cpr);
                            d.set_value('patient_mobile', response.message.mobile);
                        }
                    }
                });
            }
        };

        d.show();

        if (d.get_value('practitioner') && d.get_value('practitioner') != selected_practitioner) {
            selected_practitioner = d.get_value('practitioner');
            show_slots(d, fd);
        }
    }

    function show_slots(d, fd) {
        if (d.get_value('appointment_date') && d.get_value('practitioner')) {
            fd.available_slots.html('');
            frappe.call({
                method: 'do_health.api.methods.get_availability_data',
                args: {
                    practitioner: d.get_value('practitioner'),
                    date: d.get_value('appointment_date'),
                    appointment: {
                        "docstatus": 0,
                        "doctype": "Patient Appointment",
                        "name": event ? event.name : null,
                    }
                },
                callback: (r) => {
                    if (r.exc) {
                        fd.available_slots.html(__('Error fetching availability data').bold());
                        return;
                    }

                    let data = r.message;
                    if (data.slot_details && data.slot_details.length > 0) {
                        let $wrapper = d.fields_dict.available_slots.$wrapper;

                        // make buttons for each slot
                        let slot_html = get_slots(data.slot_details, data.fee_validity, d.get_value('appointment_date'), selected_slot);

                        $wrapper
                            .css('margin-bottom', 0)
                            .addClass('text-center')
                            .html(slot_html);

                        // highlight button when clicked
                        $wrapper.on('click', 'button', function () {
                            let $btn = $(this);
                            $wrapper.find('button').removeClass('btn-outline-primary');
                            $wrapper.find('button').removeClass('btn-primary');
                            $btn.addClass('btn-outline-primary');
                            $btn.addClass('btn-primary');
                            selected_slot = $btn.attr('data-name');
                            service_unit = $btn.attr('data-service-unit');
                            appointment_based_on_check_in = $btn.attr('data-day-appointment');
                            duration = $btn.attr('data-duration');
                            add_video_conferencing = parseInt($btn.attr('data-tele-conf'));
                            overlap_appointments = parseInt($btn.attr('data-overlap-appointments'));

                            // show option to opt out of tele conferencing
                            if ($btn.attr('data-tele-conf') == 1) {
                                if (d.$wrapper.find(".opt-out-conf-div").length) {
                                    d.$wrapper.find(".opt-out-conf-div").show();
                                } else {
                                    if (overlap_appointments) {
                                        d.footer.prepend(
                                            `<div class="opt-out-conf-div ellipsis text-muted" style="vertical-align:text-bottom;">
                                                <label>
                                                    <span class="label-area">
                                                    ${__("Video Conferencing disabled for group consultations")}
                                                    </span>
                                                </label>
                                            </div>`
                                        );
                                    } else {
                                        d.footer.prepend(
                                            `<div class="opt-out-conf-div ellipsis" style="vertical-align:text-bottom;">
                                            <label>
                                                <input type="checkbox" class="opt-out-check"/>
                                                <span class="label-area">
                                                ${__("Do not add Video Conferencing")}
                                                </span>
                                            </label>
                                        </div>`
                                        );
                                    }
                                }
                            } else {
                                if (d.$wrapper.find(".opt-out-conf-div").length) {
                                    d.$wrapper.find(".opt-out-conf-div").hide();
                                }
                            }

                            // enable primary action 'Book'
                            d.get_primary_btn().attr('disabled', null);
                        });

                    } else {
                        show_empty_state(d.get_value('practitioner'), d.get_value('appointment_date'));
                    }
                },
                freeze: true,
                freeze_message: __('Fetching Schedule...')
            });
        } else {
            fd.available_slots.html(__('Appointment date and Healthcare Practitioner are Mandatory').bold());
        }
    }

    function get_slots(slot_details, fee_validity, appointment_date, selected_slot) {
        let slot_html = '';
        let appointment_count = 0;
        let disabled = false;
        let start_str, slot_start_time, slot_end_time, interval, count, count_class, tool_tip, available_slots;

        slot_details.forEach((slot_info) => {
            slot_html += `<div class="slot-info">`;
            if (fee_validity && fee_validity != 'Disabled') {
                slot_html += `
                    <span style="color:green">
                    ${__('Patient has fee validity till')} <b>${moment(fee_validity.valid_till).format('DD-MM-YYYY')}</b>
                    </span><br>`;
            } else if (fee_validity != 'Disabled') {
                slot_html += `
                    <span style="color:red">
                    ${__('Patient has no fee validity')}
                    </span><br>`;
            }

            slot_html += `
                <span><b>
                ${__('Practitioner Schedule: ')} </b> ${slot_info.slot_name}
                    ${slot_info.tele_conf && !slot_info.allow_overlap ? '<i class="fa fa-video-camera fa-1x" aria-hidden="true"></i>' : ''}
                </span><br>
                <span><b> ${__('Service Unit: ')} </b> ${slot_info.service_unit}</span>`;
            if (slot_info.service_unit_capacity) {
                slot_html += `<br><span> <b> ${__('Maximum Capacity:')} </b> ${slot_info.service_unit_capacity} </span>`;
            }

            slot_html += '</div><br>';

            if (slot_info.avail_slot && Array.isArray(slot_info.avail_slot)) {
                slot_html += slot_info.avail_slot.map(slot => {
                    appointment_count = 0;
                    disabled = false;
                    count_class = tool_tip = '';
                    start_str = slot.from_time;
                    slot_start_time = moment(slot.from_time, 'HH:mm:ss');
                    slot_end_time = moment(slot.to_time, 'HH:mm:ss');
                    interval = (slot_end_time - slot_start_time) / 60000 | 0;

                    // restrict past slots based on the current time.
                    let now = moment();
                    let booked_moment = "";
                    if ((now.format("YYYY-MM-DD") == appointment_date) && (slot_start_time.isBefore(now) && !slot.maximum_appointments)) {
                        disabled = true;
                    } else {
                        // iterate in all booked appointments, update the start time and duration
                        if (slot_info.appointments && Array.isArray(slot_info.appointments)) {
                            slot_info.appointments.forEach((booked) => {
                                booked_moment = moment(booked.appointment_time, 'HH:mm:ss');
                                let end_time = booked_moment.clone().add(booked.duration, 'minutes');

                                // to get appointment count for all day appointments
                                if (slot.maximum_appointments) {
                                    if (booked.appointment_date == appointment_date) {
                                        appointment_count++;
                                    }
                                }
                                // Deal with 0 duration appointments
                                if (booked_moment.isSame(slot_start_time) || booked_moment.isBetween(slot_start_time, slot_end_time)) {
                                    if (booked.duration == 0) {
                                        disabled = true;
                                        return false;
                                    }
                                }

                                // Check for overlaps considering appointment duration
                                if (slot_info.allow_overlap != 1) {
                                    if (slot_start_time.isBefore(end_time) && slot_end_time.isAfter(booked_moment)) {
                                        // There is an overlap
                                        disabled = true;
                                        return false;
                                    }
                                } else {
                                    if (slot_start_time.isBefore(end_time) && slot_end_time.isAfter(booked_moment)) {
                                        appointment_count++;
                                    }
                                    if (appointment_count >= slot_info.service_unit_capacity) {
                                        // There is an overlap
                                        disabled = true;
                                        return false;
                                    }
                                }
                            });
                        }
                    }

                    if (slot_info.allow_overlap == 1 && slot_info.service_unit_capacity > 1) {
                        available_slots = slot_info.service_unit_capacity - appointment_count;
                        count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
                        count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
                        tool_tip = `${available_slots} ${__('slots available for booking')}`;
                    }

                    if (slot.maximum_appointments) {
                        if (appointment_count >= slot.maximum_appointments) {
                            disabled = true;
                        }
                        else {
                            disabled = false;
                        }
                        available_slots = slot.maximum_appointments - appointment_count;
                        count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
                        count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
                        return `<button class="btn btn-secondary" data-name=${start_str}
                                    data-service-unit="${slot_info.service_unit || ''}"
                                    data-day-appointment=${1}
                                    data-duration=${slot.duration}
                                    ${disabled ? 'disabled="disabled"' : ""}>${slot.from_time} -
                                    ${slot.to_time} ${slot.maximum_appointments ?
                                `<br><span class='badge ${count_class}'>${count} </span>` : ''}</button>`;
                    } else {
                        return `
                                <button class="btn btn-secondary ${(selected_slot == start_str) ? 'btn-primary btn-outline-primary' : ''}" data-name=${start_str}
                                    data-duration=${interval}
                                    data-service-unit="${slot_info.service_unit || ''}"
                                    data-tele-conf="${slot_info.tele_conf || 0}"
                                    data-overlap-appointments="${slot_info.service_unit_capacity || 0}"
                                    style="margin: 0 10px 10px 0; width: auto;" ${disabled ? 'disabled="disabled"' : ""}
                                    data-toggle="tooltip" title="${tool_tip || ''}">
                                    ${start_str.substring(0, start_str.length - 3)}
                                    ${slot_info.service_unit_capacity ? `<br><span class='badge ${count_class}'> ${count} </span>` : ''}
                                </button>`;
                    }
                }).join("");
            }

            if (slot_info.service_unit_capacity) {
                slot_html += `<br/><small>${__('Each slot indicates the capacity currently available for booking')}</small>`;
            }
            slot_html += `<br/><br/>`;
        });

        return slot_html;
    }
};

const SEhumanizer = humanizeDuration.humanizer({
    language: "shortEn",
    languages: {
        shortEn: {
            y: () => "y",
            mo: () => "mo",
            w: () => "w",
            d: () => "d",
            h: () => "h",
            m: () => "m",
            s: () => "s",
            ms: () => "ms",
        },
    },
});

const enhancedStyles = `
<style>
/* Status-based background colors */
.status-scheduled { 
    background: linear-gradient(135deg, #D6EAF8, #AED6F1) !important; 
}
.status-no-show { 
    background: linear-gradient(135deg, #FADBD8, #F5B7B1) !important; 
}
.status-arrived { 
    background: linear-gradient(135deg, #FDEBD0, #F8C471) !important; 
}
.status-ready { 
    background: linear-gradient(135deg, #D5F5E3, #ABEBC6) !important; 
}
.status-in-room { 
    background: linear-gradient(135deg, #FCF3CF, #F9E79F) !important; 
}
.status-transferred { 
    background: linear-gradient(135deg, #E8DAEF, #D7BDE2) !important; 
}
.status-completed { 
    background: linear-gradient(135deg, #D4EFDF, #A9DFBF) !important; 
}
.status-cancelled { 
    background: linear-gradient(135deg, #F2F3F4, #D7DBDD) !important; 
    text-decoration: line-through;
}

.status-scheduled .scheduled { 
    color: #1A5276 !important;
}
.status-no-show .no-show { 
    color: #922B21 !important;
}
.status-arrived .arrived { 
    color: #9C640C !important;
}
.status-ready .ready { 
    color: #186A3B !important;
}
.status-in-room .in-room { 
    color: #7D6608 !important;
}
.status-transferred .transferred { 
    color: #6C3483 !important;
}
.status-completed .completed { 
    color: #145A32 !important;
}
.status-cancelled .cancelled{ 
    color: #515A5A !important;
    text-decoration: line-through;
}

.appointment-event {
    border-radius: 8px;
    transition: all 0.3s ease;
    margin: 1px 0;
    font-weight: 500;
    border: none !important;
}

.appointment-event:focus::after {
    background-color: unset !important;
}

.appointment-event:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.status-cancelled .fc-event-title {
    text-decoration: line-through;
}

.status-arrived {
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.4); }
    70% { box-shadow: 0 0 0 10px rgba(40, 167, 69, 0); }
    100% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0); }
}

/* Enhanced Appt Card */
.appt-card {
    padding: 4px;
    font-size: 0.85em;
    line-height: 1.3;
}

.appt-card-compact {
    padding: 2px;
    font-size: 0.75em;
}

.appt-header {
    display: flex;
    justify-content: between;
    align-items: start;
    margin-bottom: 2px;
}

.appt-title {
    font-weight: 600;
    flex: 1;
}

.appt-duration {
    font-size: 0.75em;
    opacity: 0.8;
    background: rgba(0,0,0,0.1);
    padding: 1px 4px;
    border-radius: 3px;
}

.appt-meta {
    opacity: 0.8;
}

.appt-meta div {
    margin-bottom: 3px;
}

/* Resource Styling */
.resource-label {
    transition: all 0.3s ease;
    cursor: pointer;
}

.resource-label:hover {
    transform: translateX(2px);
}

/* Waiting List Enhancements */
#waitinglist tr {
    transition: background-color 0.3s ease;
    cursor: pointer;
}

#waitinglist tr:hover {
    background-color: #f8f9fa;
}

.waiting-list-delayed {
    background-color: #fff3cd !important;
}

.waiting-list-urgent {
    background-color: #f8d7da !important;
    animation: blink 2s infinite;
}

@keyframes blink {
    50% { opacity: 0.7; }
}

/* Responsive Design */
@media (max-width: 768px) {
    .fc-toolbar {
        flex-direction: column;
    }
    
    .fc-toolbar-chunk {
        margin-bottom: 10px;
    }
    
    .resource-area {
        width: 60px !important;
    }
}

/* Loading States */
.calendar-loading {
    opacity: 0.7;
    pointer-events: none;
}

/* Custom Scrollbar */
.fc-scroller::-webkit-scrollbar {
    width: 8px;
}

.fc-scroller::-webkit-scrollbar-track {
    background: #f1f1f1;
}

.fc-scroller::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 4px;
}

.fc-scroller::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
}


.dropdown-submenu {
    position: relative;
}

.dropdown-submenu>.dropdown-menu {
    top: 0;
    left: 100%;
    margin-top: -6px;
    margin-left: -1px;
    -webkit-border-radius: 0 6px 6px 6px;
    -moz-border-radius: 0 6px 6px;
    border-radius: 0 6px 6px 6px;
}

.dropdown-submenu:hover>.dropdown-menu {
    display: block;
}

.dropdown-submenu>a:after {
    display: block;
    content: " ";
    float: right;
    width: 0;
    height: 0;
    border-color: transparent;
    border-style: solid;
    border-width: 5px 0 5px 5px;
    border-left-color: #ccc;
    margin-top: 5px;
    margin-right: -10px;
}

.dropdown-submenu:hover>a:after {
    border-left-color: #fff;
}

.dropdown-submenu.pull-left {
    float: none;
}

.dropdown-submenu.pull-left>.dropdown-menu {
    left: -100%;
    margin-left: 10px;
    -webkit-border-radius: 6px 0 6px 6px;
    -moz-border-radius: 6px 0 6px 6px;
    border-radius: 6px 0 6px 6px;
}
</style>
`;

// Inject styles
$(document).ready(function () {
    $('head').append(enhancedStyles);
});

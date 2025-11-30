
// Patient Appointment Calendar enhancements: custom scheduler configuration, rendering, and actions.
// Default configuration that can be overridden from Do Health Settings
const DEFAULT_CALENDAR_CONFIG = {
    LICENSE_KEY: 'CC-Attribution-NonCommercial-NoDerivatives',
    DEFAULT_VIEW: 'resourceTimeGridDay',
    SLOT_DURATION: '00:15:00',
    SLOT_MIN_TIME: "08:00:00",
    SLOT_MAX_TIME: "20:00:00",
    SLOT_LABEL_INTERVAL: "01:00:00",
    RESOURCE_AREA_WIDTH: '75px',
    SIDEBAR_DATEPICKER_WIDTH: '220px'
};

// Appointment-level actions exposed through the context menu
const DEFAULT_ACTION_MENU_ITEMS = [
    // { action: 'pinPatientToSidebar', label: 'Pin Patient to Sidebar', icon: 'fa-regular fa-thumbtack' },
    { action: 'editAppointment', label: 'Edit', icon: 'fa-regular fa-pen-to-square' },
    { action: 'openAppointment', label: 'Open Appointment', icon: 'fa-regular fa-arrow-up-right-from-square' },
    { action: 'bookFollowUp', label: 'Book Follow-up', icon: 'fa-regular fa-calendar-circle-plus' },
    // { action: 'addPatientEncounter', label: 'Patient Encounter', icon: 'fa-regular fa-file-lines' },
    { action: 'addVitalSigns', label: 'Capture Vital Signs', icon: 'fa-regular fa-heart-pulse' },
    { action: 'openBillingInterface', label: 'Billing & Payment', icon: 'fa-regular fa-file-invoice-dollar' },
    // { action: 'addVisitNote', label: 'Add Visit Notes', icon: 'fa-regular fa-note-sticky' },
    { action: 'cprReading', label: 'CPR Reading', icon: 'fa-regular fa-id-card-clip' },
    { action: 'showVisitLog', label: 'Visit Log', icon: 'fa-regular fa-clipboard-list' },
];

const PRACTITIONER_MENU_ITEMS = [
    { action: 'openProfile', label: 'Open Practitioner Profile', icon: 'fa-regular fa-user-doctor' },
    { action: 'createAvailability', label: 'Practitioner Availability', icon: 'fa-regular fa-calendar-check' }
];

const BOOT_CALENDAR_SETTINGS = frappe.boot?.do_health_calendar || {};
const CONFIG = Object.assign({}, DEFAULT_CALENDAR_CONFIG, BOOT_CALENDAR_SETTINGS.config || {});
const ACTION_MENU_ITEMS = (BOOT_CALENDAR_SETTINGS.action_menu_items && BOOT_CALENDAR_SETTINGS.action_menu_items.length
    ? BOOT_CALENDAR_SETTINGS.action_menu_items
    : DEFAULT_ACTION_MENU_ITEMS);

const ROOM_UNASSIGNED_RESOURCE = '__room_unassigned__';

// LocalStorage keys for filter persistence
const FILTER_STORAGE_KEY = 'patient_appointment_calendar_filters';

// Quick visit status shortcuts surfaced in the context menu
const VISIT_STATUS_OPTIONS = [
    { value: 'Scheduled', label: 'Scheduled', icon: 'fa-regular fa-calendar-days' },
    { value: 'Arrived', label: 'Arrived', icon: 'fa-regular fa-person-walking-arrow-right' },
    { value: 'Ready', label: 'Ready', icon: 'fa-regular fa-circle-check' },
    { value: 'In Room', label: 'In Room', icon: 'fa-regular fa-stethoscope' },
    { value: 'Completed', label: 'Completed', icon: 'fa-regular fa-clipboard-check' },
    { value: 'Cancelled', label: 'Cancelled', icon: 'fa-regular fa-circle-xmark' },
];

frappe.views.calendar["Patient Appointment"] = {
    // State management
    state: {
        showcancelled: false,
        currentView: 'resourceTimeGridDay',
        resources: [],
        availabilityCache: {},
        lastViewInfo: null,
        unavailableByResourceDate: {},
        resourceMode: 'doctors',
        resourceFilters: {
            doctors: { showAll: true },
            rooms: { showAll: true }
        },
        isDatepickerSyncing: false,
        isPointerDown: false
    },

    // Save filter state to localStorage
    saveFiltersToStorage: function () {
        const filterState = {
            resourceMode: this.state.resourceMode,
            showcancelled: this.state.showcancelled,
            resourceFilters: this.state.resourceFilters
        };
        try {
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filterState));
        } catch (e) {
            console.warn('Failed to save filter state to localStorage:', e);
        }
    },

    // Load filter state from localStorage
    loadFiltersFromStorage: function () {
        try {
            const stored = localStorage.getItem(FILTER_STORAGE_KEY);
            if (stored) {
                const filterState = JSON.parse(stored);
                if (filterState.resourceMode) {
                    this.state.resourceMode = filterState.resourceMode;
                }
                if (typeof filterState.showcancelled === 'boolean') {
                    this.state.showcancelled = filterState.showcancelled;
                }
                if (filterState.resourceFilters) {
                    this.state.resourceFilters = Object.assign({}, this.state.resourceFilters, filterState.resourceFilters);
                }
                return true;
            } else {
                // No saved filters, apply defaults
                this.state.resourceMode = 'doctors';
                this.state.showcancelled = false;
                this.state.resourceFilters = {
                    doctors: { showAll: true },
                    rooms: { showAll: true }
                };
                return false;
            }
        } catch (e) {
            console.warn('Failed to load filter state from localStorage:', e);
            // On error, apply defaults
            this.state.resourceMode = 'doctors';
            this.state.showcancelled = false;
            this.state.resourceFilters = {
                doctors: { showAll: true },
                rooms: { showAll: true }
            };
        }
        return false;
    },

    // Clear filters and restore defaults
    clearFilters: function () {
        this.state.resourceMode = 'doctors';
        this.state.showcancelled = false;
        this.state.resourceFilters = {
            doctors: { showAll: true },
            rooms: { showAll: true }
        };
        try {
            localStorage.removeItem(FILTER_STORAGE_KEY);
        } catch (e) {
            console.warn('Failed to clear filter state from localStorage:', e);
        }

        // Refresh calendar
        const calendar = cur_list?.calendar?.fullCalendar;
        if (calendar) {
            calendar.refetchResources();
            calendar.refetchEvents();
        }
        this.updateResourceModeButtons(this.state.resourceMode);
        this.updateCancelledButtonLabel();
        // this.updateClearFiltersButton();
        frappe.show_alert({ message: __('Filters cleared'), indicator: 'blue' });
    },

    // Get CSS class names based on status
    getEventClassNames: function (status) {
        const classNames = ['appointment-event'];
        if (status) {
            classNames.push(`status-${status.toLowerCase().replace(' ', '-')}`);
        }
        return classNames;
    },

    getCalendarApi: function () {
        return cur_list?.calendar?.fullCalendar || null;
    },

    syncDatepickerWithCalendar: function (dateInput) {
        const $picker = $('#monthdatepicker');
        if (!$picker.length) {
            return;
        }

        const state = this.state || {};
        const calendarApi = this.getCalendarApi();
        const candidate = dateInput
            || state.lastViewInfo?.view?.currentStart
            || calendarApi?.getDate?.()
            || null;

        if (!candidate) {
            return;
        }

        const targetDate = new Date(candidate);
        if (Number.isNaN(targetDate.getTime())) {
            return;
        }

        const pickerInstance = $picker.data('datepicker');
        let currentDate = null;

        if (pickerInstance?.selectedDates?.length) {
            currentDate = pickerInstance.selectedDates[0];
        } else if (typeof $picker.datepicker === 'function') {
            try {
                currentDate = $picker.datepicker('getDate');
            } catch (err) {
                currentDate = null;
            }
        }

        if (currentDate instanceof Date && currentDate.toDateString() === targetDate.toDateString()) {
            return;
        }

        state.isDatepickerSyncing = true;
        const disableSyncFlag = () => {
            setTimeout(() => {
                state.isDatepickerSyncing = false;
            }, 0);
        };

        try {
            if (pickerInstance && typeof pickerInstance.selectDate === 'function') {
                pickerInstance.selectDate(targetDate);
            } else if (typeof $picker.datepicker === 'function') {
                $picker.datepicker('setDate', targetDate);
            }
        } finally {
            disableSyncFlag();
        }
    },

    options: {
        themeSystem: 'standard',
        height: 'calc(100vh - 100px)',
        schedulerLicenseKey: CONFIG.LICENSE_KEY,

        initialView: CONFIG.DEFAULT_VIEW,
        initialDate: get_session_date(),

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
        nextDayThreshold: CONFIG.SLOT_MIN_TIME,

        // header configuration
        headerToolbar: {
            left: "jumpToNow searchAppointments",
            center: "title",
            right: "doctors rooms cancelled toggleSide"
        },

        titleFormat: {
            weekday: 'long',
            day: 'numeric',
            month: 'short'
        },

        eventDataTransform: function (eventData) {
            const calendarView = frappe.views.calendar["Patient Appointment"];
            const resourceMode = calendarView?.state?.resourceMode || 'doctors';
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

            const practitionerId = resource;
            const roomResourceId = extendedProps.room_id || extendedProps.service_unit_id || null;
            const resourceId = resourceMode === 'rooms'
                ? (roomResourceId || ROOM_UNASSIGNED_RESOURCE)
                : practitionerId;

            const enhancedProps = Object.assign({}, extendedProps, {
                practitioner_id: practitionerId,
                room_resource_id: roomResourceId
            });

            return {
                id: name,
                title: customer,
                start: starts_at,
                end: ends_at,
                resourceId,
                backgroundColor: background_color,
                textColor: text_color,
                extendedProps: enhancedProps,
                classNames: calendarView.getEventClassNames(enhancedProps.status)
            };
        },

        resources: function (fetchInfo, successCallback, failureCallback) {
            const calendarView = frappe.views.calendar["Patient Appointment"];

            // Ensure filters are loaded before determining resource mode
            if (!calendarView.state._filtersLoaded) {
                calendarView.loadFiltersFromStorage();
                calendarView.state._filtersLoaded = true;
            }

            const mode = calendarView?.state?.resourceMode || 'doctors';
            const cacheKey = mode === 'rooms' ? 'service_unit_resources' : 'practitioner_resources';
            const cacheTime = 5 * 60 * 1000; // 5 minutes cache

            const cached = calendarView.getCachedResources(cacheKey, cacheTime);
            if (cached) {
                calendarView.state.resources = cached;
                successCallback(cached);
                calendarView.afterResourcesLoaded();
                return;
            }

            const loader = mode === 'rooms'
                ? calendarView.loadRoomResources.bind(calendarView)
                : calendarView.loadPractitionerResources.bind(calendarView);

            loader()
                .then(resources => {
                    calendarView.state.resources = resources;
                    calendarView.cacheResources(cacheKey, resources);
                    successCallback(resources);
                    calendarView.afterResourcesLoaded();
                })
                .catch((error) => {
                    console.error('Unable to load resources', error);
                    failureCallback();
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

            if (resource.extendedProps?.type === 'practitioner') {
                resourceObj.el.classList.add('practitioner-resource-label');
                resourceObj.el.setAttribute('tabindex', '0');

                const calendarView = frappe.views.calendar["Patient Appointment"];
                const openMenu = (evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    const anchor = {
                        x: evt.pageX ?? (resourceObj.el.getBoundingClientRect().left + window.scrollX),
                        y: evt.pageY ?? (resourceObj.el.getBoundingClientRect().bottom + window.scrollY)
                    };
                    calendarView.showPractitionerMenu(resource, anchor);
                };

                resourceObj.el.addEventListener('click', openMenu);
                // resourceObj.el.addEventListener('contextmenu', openMenu);
                // resourceObj.el.addEventListener('keydown', (evt) => {
                //     if (evt.key === 'Enter' || evt.key === ' ') {
                //         openMenu(evt);
                //     }
                // });
            }
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
                text: '',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].handleResourceButtonClick('doctors');
                }
            },
            rooms: {
                text: '',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].handleResourceButtonClick('rooms');
                }
            },
            cancelled: {
                text: '',
                click: function () {
                    const calendarView = frappe.views.calendar["Patient Appointment"];
                    calendarView.state.showcancelled = !calendarView.state.showcancelled;
                    cur_list.calendar.fullCalendar.refetchEvents()
                    cur_list.calendar.fullCalendar.setOption('filterResourcesWithEvents', false);

                    calendarView.updateCancelledButtonLabel();
                    // calendarView.updateClearFiltersButton();
                    calendarView.saveFiltersToStorage();
                }
            },
            toggleSide: {
                text: '',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].toggleSidebar();
                }
            },
            jumpToNow: {
                text: '',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].jumpToCurrentTime();
                }
            },
            searchAppointments: {
                text: '',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].showSearchDialog();
                }
            },
            clearFilters: {
                text: '',
                hint: __('Clear all filters'),
                click: function () {
                    frappe.views.calendar["Patient Appointment"].clearFilters();
                }
            }
        },

        // select handler
        select: function (info) {
            frappe.views.calendar["Patient Appointment"].handleSlotSelection(info);
        },

        // event click handler
        eventClick: function (info) {
            frappe.views.calendar["Patient Appointment"].hideActivePopovers();
            applySecondaryCollapsed(false);
            appointmentActions.pinPatientToSidebar(info.event.id, info.event);
        },

        // event hover handler
        eventMouseLeave: function (info) {
            $(`[role="tooltip"].popover`).remove();
        },

        eventDragStart: function () {
            frappe.views.calendar["Patient Appointment"].hideActivePopovers();
        },

        eventResizeStart: function () {
            frappe.views.calendar["Patient Appointment"].hideActivePopovers();
        },

        // event drop handler
        eventDrop: function (info) {
            const calendarView = frappe.views.calendar["Patient Appointment"];
            const resourceLabel = calendarView.state.resourceMode === 'rooms' ? __('Room') : __('Practitioner');
            const preserveTime = calendarView.state.resourceMode === 'rooms';
            const originalStart = preserveTime ? (info.oldEvent?.start || info.event.start) : info.event.start;
            const originalEnd = preserveTime ? (info.oldEvent?.end || info.event.end) : info.event.end;

            if (preserveTime && info.oldEvent?.start && info.oldEvent?.end && typeof info.event.setDates === 'function') {
                info.event.setDates(info.oldEvent.start, info.oldEvent.end);
            }

            const resourceNames = info.event.getResources().map(r => r.title).join(', ');
            const summary = preserveTime
                ? ''
                : `New time: <strong>${info.event.start.toLocaleTimeString()}</strong><br>
                 ${resourceLabel}: <strong>${resourceNames}</strong>`;
            const prompt = preserveTime
                ? __(`Assign <strong>{0}</strong> to this {1}?`, [info.event.title, resourceLabel.toLowerCase()])
                : `Move <strong>${info.event.title}</strong> appointment?`;

            frappe.views.calendar["Patient Appointment"].showConfirmationDialog(
                prompt,
                summary,
                () => updateEvent(info, { preserveTime, originalStart, originalEnd }),
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
            const calendarView = frappe.views.calendar["Patient Appointment"];
            if (info.event.display === 'background' && info.event.extendedProps?.__availabilityOverlay) {
                calendarView.decorateAvailabilityOverlay(info);
                return;
            }

            calendarView.applyEventStyling(info);
            calendarView.enhanceEventContent(info);
            calendarView.addEventInteractions(info);
            calendarView.adjustEventDensity(info);
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

            render_datepicker();
            set_current_session(info.view);
            sessionStorage.server_update = 0;

            const calendarView = frappe.views.calendar["Patient Appointment"];

            // Load filters from localStorage on first render (if not already loaded)
            if (!calendarView.state._filtersLoaded) {
                calendarView.loadFiltersFromStorage();
                calendarView.state._filtersLoaded = true;
            }

            // Apply the resource mode filter on first render
            if (!calendarView.state._filterModeApplied) {
                calendarView.applyResourceFilterMode(calendarView.state.resourceMode);
                calendarView.state._filterModeApplied = true;
            }

            calendarView.state.currentView = info.view.type;
            calendarView.state.lastViewInfo = info;
            calendarView.updateResourceModeButtons(calendarView.state.resourceMode);
            calendarView.updateCancelledButtonLabel();
            calendarView.updateStaticButtonLabels();
            calendarView.updateResourceAreaHeader();
            calendarView.ensureUnavailableSlotStyles();
            calendarView.markUnavailableSlots(info).catch((err) => {
                console.warn('Unable to mark unavailable slots', err);
            });
            calendarView.syncDatepickerWithCalendar(info.view?.currentStart || info.start);

            if (cur_list?.page) {
                const primaryActionLabel = __('Add Patient Appointment');
                cur_list.page.set_primary_action(primaryActionLabel, () => {
                    if (typeof check_and_set_availability === 'function') {
                        const defaultEvent = {
                            appointment_date: get_session_date(),
                            duration: 30
                        };
                        check_and_set_availability(defaultEvent, true);
                    } else {
                        frappe.new_doc('Patient Appointment');
                    }
                });
            }
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

    // Validate resource availability before creating appointment
    handleSlotSelection: function (info) {
        const available = this.isSlotAvailable(info);
        if (available) {
            this.createNewAppointment(info);
        } else {
            this.unselectCurrentSlot(info);
        }
    },

    // Check if the practitioner has the selected slot free
    isSlotAvailable: function (info) {
        const practitionerId = info.resource?.id || info.resourceId || '';
        if (!practitionerId) {
            return true;
        }

        const appointmentDate = moment(info.start).format('YYYY-MM-DD');
        const selectedStart = moment(info.start);
        const selectedEnd = moment(info.end);
        const practitionerName = info.resource?.title || practitionerId;

        const mapKey = `${practitionerId}__${appointmentDate}`;
        const unavailableSlots = this.state?.unavailableByResourceDate?.[mapKey] || [];
        if (!unavailableSlots.length) {
            return true;
        }

        const blockingSlot = unavailableSlots.find(range => {
            const rangeStart = moment(range.start);
            const rangeEnd = moment(range.end);
            if (!rangeStart.isValid() || !rangeEnd.isValid()) {
                return false;
            }
            return selectedStart.isBefore(rangeEnd) && selectedEnd.isAfter(rangeStart);
        });

        if (!blockingSlot) {
            return true;
        }

        const sanitize = (text) => {
            if (!text) return '';
            if (frappe.utils?.escape_html) {
                return frappe.utils.escape_html(text);
            }
            const span = document.createElement('span');
            span.textContent = text;
            return span.innerHTML;
        };

        const messageParts = [
            __('{0} is not available at the selected time.', [practitionerName])
        ];
        if (blockingSlot.reason) {
            messageParts.push(__('Reason: {0}', [sanitize(blockingSlot.reason)]));
        }
        if (blockingSlot.note) {
            messageParts.push(sanitize(blockingSlot.note));
        }

        frappe.show_alert({
            message: messageParts.join('<br>'),
            indicator: 'red'
        });
        return false;
    },

    // Clear calendar selection when slot is not valid
    unselectCurrentSlot: function (info) {
        if (info?.view?.calendar?.unselect) {
            info.view.calendar.unselect();
        } else if (cur_list?.calendar?.fullCalendar?.unselect) {
            cur_list.calendar.fullCalendar.unselect();
        }
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

    setResourceMode: function (mode) {
        const normalized = mode === 'rooms' ? 'rooms' : 'doctors';
        this.ensureResourceFilterConfig(normalized);

        if (this.state.resourceMode !== normalized) {
            this.state.resourceMode = normalized;
            this.state.resources = [];

            if (normalized !== 'doctors') {
                this.clearAvailabilityOverlays();
                this.resetAvailabilityCache();
            }

            const calendar = cur_list?.calendar?.fullCalendar;
            if (calendar) {
                calendar.refetchResources();
                calendar.refetchEvents();
            } else if (typeof cur_list?.refresh === 'function') {
                cur_list.refresh();
            }
        }

        this.applyResourceFilterMode(normalized);
        this.updateResourceAreaHeader();
        // this.updateClearFiltersButton();
        this.saveFiltersToStorage();
    },

    handleResourceButtonClick: function (mode) {
        const normalized = mode === 'rooms' ? 'rooms' : 'doctors';
        if (this.state.resourceMode !== normalized) {
            this.setResourceMode(normalized);
            return;
        }
        this.ensureResourceFilterConfig(normalized);
        if (mode !== 'rooms')
            this.state.resourceFilters[normalized].showAll = !this.state.resourceFilters[normalized].showAll;
        this.applyResourceFilterMode(normalized, { rerender: true });
        // this.updateClearFiltersButton();
        this.saveFiltersToStorage();
    },

    applyResourceFilterMode: function (mode, opts) {
        const options = opts || {};
        const showAll = this.isShowAllResources(mode);
        const shouldFilter = !showAll;
        const calendar = cur_list?.calendar?.fullCalendar;
        if (calendar?.setOption) {
            calendar.setOption('filterResourcesWithEvents', shouldFilter);
        }
        this.updateResourceModeButtons(this.state.resourceMode);
        if (options.rerender && calendar) {
            calendar.refetchResources();
            calendar.refetchEvents();
        }
    },

    updateToolbarButtonLabel: function (selector, label) {
        const $button = $(selector);
        if (!$button.length) {
            return;
        }

        const current = $button.data('applied-label');
        if (current === label) {
            return;
        }

        if (!$button.data('initial-icon-html')) {
            const $icon = $button.find('i, svg').first();
            if ($icon.length) {
                $button.data('initial-icon-html', $icon.prop('outerHTML'));
            } else {
                $button.data('initial-icon-html', '');
            }
        }

        const iconHtml = $button.data('initial-icon-html') || '';
        $button.empty();
        if (iconHtml) {
            $button.append($(iconHtml));
        }

        const $label = $('<span class="fc-button-label"></span>').text(label);
        $button.append($label);
        $button.data('applied-label', label);
    },

    updateCancelledButtonLabel: function () {
        const label = this.state.showcancelled ? __('Hide Cancelled') : __('Show Cancelled');
        this.updateToolbarButtonLabel('.fc-cancelled-button', label);
    },

    isFiltersAtDefault: function () {
        return this.state.resourceMode === 'doctors' &&
            !this.state.showcancelled &&
            this.state.resourceFilters.doctors.showAll;
    },

    updateStaticButtonLabels: function () {
        this.updateToolbarButtonLabel('.fc-toggleSide-button', '☰');
        this.updateToolbarButtonLabel('.fc-jumpToNow-button', '⏰ Now');
        this.updateToolbarButtonLabel('.fc-searchAppointments-button', '🔍 Search');
        // this.updateClearFiltersButton();
    },

    updateClearFiltersButton: function () {
        const $clearBtn = $('.fc-clearFilters-button');
        if (!$clearBtn.length) return;

        const isDefault = this.isFiltersAtDefault();
        $clearBtn.empty();
        $clearBtn.append(frappe.utils.icon('filter-x', 'sm'));

        if (!isDefault) {
            // Add text when filters are not at default
            $clearBtn.prop('disabled', false);
            $clearBtn.removeClass('fc-button-disabled');
        } else {
            // Disable button when filters are at default
            $clearBtn.prop('disabled', true);
            $clearBtn.addClass('fc-button-disabled');
        }

        $clearBtn.attr('title', __('Clear filters'));
    },

    updateResourceModeButtons: function (activeMode) {
        ['doctors', 'rooms'].forEach(mode => {
            const button = $(`.fc-${mode}-button`);
            if (!button.length) return;

            const baseLabel = mode === 'rooms' ? __('Rooms') : __('Doctors');
            const descriptor = this.isShowAllResources(mode) && mode !== 'rooms' ? __('(All)') : '';
            const labelText = `${baseLabel}${descriptor ? ` ${descriptor}` : ''}`;
            this.updateToolbarButtonLabel(`.fc-${mode}-button`, labelText.trim());

            if (mode === activeMode) {
                button.addClass('btn-primary').removeClass('btn-secondary');
            } else {
                button.addClass('btn-secondary').removeClass('btn-primary');
            }
        });
    },

    updateResourceAreaHeader: function () {
        const calendar = cur_list?.calendar?.fullCalendar;
        if (calendar?.setOption) {
            const label = this.state.resourceMode === 'rooms' ? __('Rooms') : __('Providers');
            calendar.setOption('resourceAreaHeaderContent', label);
        }
    },

    ensureResourceFilterConfig: function (mode) {
        this.state.resourceFilters = this.state.resourceFilters || {};
        if (!this.state.resourceFilters[mode]) {
            this.state.resourceFilters[mode] = { showAll: mode === 'rooms' ? true : false };
        }
    },

    isShowAllResources: function (mode) {
        this.ensureResourceFilterConfig(mode);
        return !!this.state.resourceFilters[mode].showAll;
    },

    // Safely escape text for HTML output
    escapeHtml: function (value) {
        if (value === undefined || value === null) {
            return '';
        }
        const stringValue = typeof value === 'string' ? value : String(value);
        if (frappe.utils?.escape_html) {
            return frappe.utils.escape_html(stringValue);
        }
        const div = document.createElement('div');
        div.textContent = stringValue;
        return div.innerHTML;
    },

    // Map billing status to Bootstrap badge styles
    getBillingBadgeClass: function (status) {
        const normalized = (status || '').toString().trim().toLowerCase();
        const map = {
            'paid': 'success',
            'partially paid': 'warning',
            'partially billed': 'warning',
            'not paid': 'warning',
            'not billed': 'secondary',
            'invoiced': 'info',
            'cancelled': 'danger'
        };
        return map[normalized] || 'secondary';
    },

    // Map insurance claim status to Bootstrap badge styles
    getInsuranceBadgeClass: function (status) {
        const normalized = (status || '').toString().trim().toLowerCase();
        const map = {
            'claimed': 'info',
            'submitted': 'info',
            'approved': 'success',
            'paid': 'primary',
            'rejected': 'danger',
            'not claimed': 'secondary',
            'not submitted': 'secondary',
            'in progress': 'warning'
        };
        return map[normalized] || 'secondary';
    },
    adjustEventDensity: function (info) {
        const calendarView = this;
        const el = info?.el;
        if (!el) {
            return;
        }

        const applyDensityClass = () => {
            el.classList.remove('appointment-event--tight', 'appointment-event--condensed');

            const height = el.getBoundingClientRect().height;
            if (!height) {
                return;
            }

            if (height <= 54) {
                el.classList.add('appointment-event--tight');
            } else if (height <= 74) {
                el.classList.add('appointment-event--condensed');
            }
        };

        if (window.requestAnimationFrame) {
            requestAnimationFrame(() => requestAnimationFrame(applyDensityClass));
        } else {
            setTimeout(applyDensityClass, 0);
        }
    },

    // Enhance event content
    enhanceEventContent: function (info) {
        var event = info.event;
        var element = info.el;
        const calendarView = this;

        // Format title
        var full_name = event.extendedProps.full_name || event.title || '';
        var short_name = '';
        if (full_name) {
            const parts = full_name.trim().split(/\s+/).filter(Boolean);
            if (parts.length === 1) {
                short_name = parts[0];
            } else if (parts.length > 1) {
                short_name = `${parts[0]} ${parts[parts.length - 1]}`;
            }
        }
        if (!short_name) {
            short_name = event.title || '';
        }
        var titleEl = element.querySelector('.fc-event-title');
        if (titleEl) {
            titleEl.innerHTML = '';
            var strong = document.createElement('strong');
            strong.textContent = short_name;
            titleEl.appendChild(strong);
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

        const statusValue = event.extendedProps.status || '';
        const statusClass = statusValue ? statusValue.toLowerCase().replace(/\s+/g, '-') : '';
        const statusLabel = calendarView.escapeHtml(statusValue);
        const showArrival = statusValue === 'Arrived' && event.extendedProps.arrival_time;
        // var status = `<div class="appt-status ${statusClass}">
        //     <span class="${info.view.type == 'timeGridDay' ? 'agenda-day' : ''} 
        //     ${statusValue == 'Completed' ? 'hidden' : ''}"></span>
        //     ${statusLabel}
        //     <span style="${showArrival ? '' : 'display: none;'}">
        //         ${showArrival ? `<span class="arrival_timers">${moment(event.extendedProps.arrival_time, "HH:mm:ss").fromNow()}</span>` : ''}
        //     </span>
        // </div>`;

        // var mainContent = element.querySelector('.fc-event-main .fc-event-main-frame');
        // if (mainContent) {
        //     mainContent.insertAdjacentHTML('beforeend', status);
        // }
    },

    // Add event interactions
    addEventInteractions: function (info) {
        const event = info.event;
        const element = info.el;
        const calendarView = this;

        // Right-click should take the user straight to editing the appointment
        element.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            if (info.jsEvent) {
                info.jsEvent.preventDefault();
                info.jsEvent.stopPropagation();
            }
            const anchor = info.jsEvent
                ? { x: info.jsEvent.pageX, y: info.jsEvent.pageY }
                : {
                    x: info.el.getBoundingClientRect().left + window.scrollX,
                    y: info.el.getBoundingClientRect().bottom + window.scrollY
                };
            frappe.views.calendar["Patient Appointment"].showActionsMenu(info.event, anchor);
            // appointmentActions.editAppointment(event.id);
        });

        // Allow status badge click to open quick status shortcuts
        const statusEl = element.querySelector('.appt-status');
        if (statusEl) {
            statusEl.classList.add('interactive-status');
            statusEl.setAttribute('title', __('Update visit status'));
            statusEl.style.cursor = 'pointer';
            statusEl.addEventListener('click', function (e) {
                e.stopPropagation();
                const rect = statusEl.getBoundingClientRect();
                calendarView.showActionsMenu(
                    event,
                    {
                        x: rect.left + window.scrollX,
                        y: rect.bottom + window.scrollY
                    },
                    'status'
                );
            });
        }

        // Create popover
        this.createPopover(element, event);
    },

    decorateAvailabilityOverlay: function (info) {
        const element = info.el;
        if (!element) {
            return;
        }

        element.classList.add('slot-unavailable-indicator');

        const reason = info.event.extendedProps?.reason || '';
        const note = info.event.extendedProps?.note || '';
        const tooltipLines = [];

        const sanitize = (text) => {
            if (!text) return '';
            if (frappe.utils?.escape_html) {
                return frappe.utils.escape_html(text);
            }
            const span = document.createElement('span');
            span.textContent = text;
            return span.innerHTML;
        };

        if (reason) {
            tooltipLines.push(__('Reason: {0}', [sanitize(reason)]));
        }
        if (note) {
            tooltipLines.push(sanitize(note));
        }

        $(element).tooltip('dispose');

        if (!tooltipLines.length) {
            element.removeAttribute('title');
            element.removeAttribute('data-original-title');
            element.removeAttribute('data-toggle');
            return;
        }

        element.setAttribute('title', tooltipLines.join('\n'));
        element.setAttribute('data-toggle', 'tooltip');
        $(element).tooltip({
            container: 'body',
            trigger: 'hover',
            placement: 'top'
        });
    },

    // Build and display the contextual action menu
    showActionsMenu: function (event, anchor, focusSection) {
        const menuId = 'patient-appointment-action-menu';
        const existingMenu = $(`#${menuId}`);
        if (existingMenu.length) {
            existingMenu.remove();
        }

        const $menu = $(`<div id="${menuId}" class="dropdown-menu show appointment-context-menu" role="menu"></div>`);
        let menuHtml = '';

        if (VISIT_STATUS_OPTIONS.length) {
            const activeStatus = (event.extendedProps.status || '').toLowerCase();
            menuHtml += `
                <div class="dropdown-submenu">
                <a class="dropdown-item dropdown-toggle" href="#">
                    ${__('Change Visit Status')}
                </a>
                <div class="dropdown-menu">
                    ${VISIT_STATUS_OPTIONS.map(status => `
                    <a class="dropdown-item js-status-option ${status.value.toLowerCase() === activeStatus ? 'active' : ''}"
                        data-status="${status.value}">
                        <i class="${status.icon}"></i> ${__(status.label)}
                    </a>
                    `).join('')}
                </div>
                </div>
            `;
        }

        if (ACTION_MENU_ITEMS.length) {
            if (VISIT_STATUS_OPTIONS.length) {
                menuHtml += '<div class="dropdown-divider"></div>';
            }
            menuHtml += `<div class="dropdown-header">${__('Appointment Actions')}</div>`;
            menuHtml += ACTION_MENU_ITEMS.map(item => `
                <a class="dropdown-item js-action-item" data-action="${item.action}">
                    <i class="${item.icon}"></i> ${__(item.label)}
                </a>
            `).join('');
        }

        if (!menuHtml) {
            return;
        }

        $menu.html(menuHtml);
        $('body').append($menu);

        const viewportWidth = $(window).width();
        const viewportHeight = $(window).height();
        const menuWidth = $menu.outerWidth();
        const menuHeight = $menu.outerHeight();

        let left = anchor.x;
        let top = anchor.y;

        if (left + menuWidth > viewportWidth) {
            left = viewportWidth - menuWidth - 8;
        }
        if (top + menuHeight > viewportHeight + window.scrollY) {
            top = anchor.y - menuHeight;
        }

        $menu.css({
            position: 'absolute',
            top: `${top}px`,
            left: `${left}px`,
            zIndex: 1050
        });

        if (focusSection === 'status') {
            const statusToFocus = $menu.find('.js-status-option.active');
            (statusToFocus.length ? statusToFocus : $menu.find('.js-status-option').first()).focus();
        }

        const closeMenu = () => {
            $menu.remove();
            $(document).off('click', handleOutsideClick);
            $(window).off('resize', closeMenu);
            $('body').off('scroll', closeMenu);
        };

        const handleOutsideClick = (e) => {
            if (!$(e.target).closest(`#${menuId}`).length) {
                closeMenu();
            }
        };

        setTimeout(() => {
            $(document).on('click', handleOutsideClick);
        }, 0);

        $(window).on('resize', closeMenu);
        $('body').on('scroll', closeMenu);

        $menu.on('click', '.js-status-option', async function (e) {
            e.preventDefault();
            const status = $(this).data('status');
            await appointmentActions.setVisitStatus(event.id, status);
            closeMenu();
        });

        $menu.on('click', '.js-action-item', async function (e) {
            e.preventDefault();
            const actionKey = $(this).data('action');
            const handler = appointmentActions[actionKey];
            closeMenu();
            if (typeof handler === 'function') {
                await handler(event.id, event, focusSection);
            }
        });
    },

    showPractitionerMenu: function (resource, anchor) {
        if (!resource || resource.extendedProps?.type !== 'practitioner' || !PRACTITIONER_MENU_ITEMS.length) {
            return;
        }

        const menuId = 'practitioner-action-menu';
        $(`#${menuId}`).remove();

        const $menu = $(`<div id="${menuId}" class="dropdown-menu show appointment-context-menu" role="menu"></div>`);
        const safeName = this.escapeHtml(resource.title || resource.id || __('Practitioner'));
        let menuHtml = `<div class="dropdown-header">${__('Actions for {0}', [safeName])}</div>`;
        menuHtml += PRACTITIONER_MENU_ITEMS.map(item => `
            <a class="dropdown-item js-practitioner-action" data-action="${item.action}">
                <i class="${item.icon}"></i> ${__(item.label)}
            </a>
        `).join('');

        $menu.html(menuHtml);
        $('body').append($menu);

        const viewportWidth = $(window).width();
        const viewportHeight = $(window).height();
        const menuWidth = $menu.outerWidth();
        const menuHeight = $menu.outerHeight();

        let left = anchor.x;
        let top = anchor.y;

        if (left + menuWidth > viewportWidth) {
            left = viewportWidth - menuWidth - 8;
        }
        if (top + menuHeight > viewportHeight + window.scrollY) {
            top = anchor.y - menuHeight;
        }

        $menu.css({
            position: 'absolute',
            top: `${top}px`,
            left: `${left}px`,
            zIndex: 1050
        });

        const closeMenu = () => {
            $menu.remove();
            $(document).off('click', handleOutsideClick);
            $(window).off('resize', closeMenu);
            $('body').off('scroll', closeMenu);
        };

        const handleOutsideClick = (e) => {
            if (!$(e.target).closest(`#${menuId}`).length) {
                closeMenu();
            }
        };

        setTimeout(() => {
            $(document).on('click', handleOutsideClick);
        }, 0);

        $(window).on('resize', closeMenu);
        $('body').on('scroll', closeMenu);

        $menu.on('click', '.js-practitioner-action', function (e) {
            e.preventDefault();
            const actionKey = $(this).data('action');
            const handler = practitionerActions[actionKey];
            closeMenu();
            if (typeof handler === 'function') {
                handler(resource);
            }
        });
    },

    afterResourcesLoaded: function () {
        this.applyResourceFilterMode(this.state.resourceMode || 'doctors');
        if (this.state.resourceMode === 'doctors' && this.state.lastViewInfo) {
            this.ensureUnavailableSlotStyles();
            this.markUnavailableSlots(this.state.lastViewInfo).catch(console.warn);
        } else if (this.state.resourceMode !== 'doctors') {
            this.clearAvailabilityOverlays();
        }
        this.updateResourceAreaHeader();
    },

    loadPractitionerResources: function () {
        return new Promise((resolve, reject) => {
            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Healthcare Practitioner',
                    filters: [["Healthcare Practitioner", "status", "=", "Active"]],
                    fields: [
                        'name',
                        'first_name',
                        'last_name',
                        'custom_background_color',
                        'custom_text_color'
                    ],
                    order_by: 'first_name asc',
                    limit_page_length: 500
                },
                callback: (r) => {
                    const list = Array.isArray(r.message) ? r.message : [];
                    const resources = list.map(practitioner => {
                        const displayName = practitioner.first_name || practitioner.last_name
                            ? [practitioner.first_name, practitioner.last_name].filter(Boolean).join(' ')
                            : practitioner.name;
                        return {
                            id: practitioner.name,
                            title: displayName,
                            backgroundColor: practitioner.custom_background_color,
                            textColor: practitioner.custom_text_color,
                            extendedProps: {
                                type: 'practitioner',
                                background_color: practitioner.custom_background_color
                            }
                        };
                    });
                    resolve(resources);
                },
                error: reject
            });
        });
    },

    loadRoomResources: function () {
        return new Promise((resolve, reject) => {
            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Healthcare Service Unit',
                    filters: [
                        ["Healthcare Service Unit", "is_group", "=", "0"],
                        ["Healthcare Service Unit", "allow_appointments", "=", "1"]
                    ],
                    fields: [
                        'name',
                        'healthcare_service_unit_name',
                        'custom_background_color',
                        'custom_text_color',
                        'service_unit_capacity'
                    ],
                    order_by: 'healthcare_service_unit_name asc',
                    limit_page_length: 500
                },
                callback: (r) => {
                    const list = Array.isArray(r.message) ? r.message : [];
                    const resources = list.map(unit => {
                        const bg = unit.custom_background_color || '#fde68a';
                        const text = unit.custom_text_color || '#1f2937';
                        return {
                            id: unit.name,
                            title: unit.healthcare_service_unit_name || unit.name,
                            backgroundColor: bg,
                            textColor: text,
                            extendedProps: {
                                type: 'room',
                                capacity: unit.service_unit_capacity || null
                            }
                        };
                    });
                    resources.unshift(this.createUnassignedRoomResource());
                    resolve(resources);
                },
                error: reject
            });
        });
    },

    createUnassignedRoomResource: function () {
        return {
            id: ROOM_UNASSIGNED_RESOURCE,
            title: __('Unassigned'),
            backgroundColor: '#e5e7eb',
            textColor: '#1f2937',
            extendedProps: {
                type: 'room',
                capacity: null
            }
        };
    },

    // Create popover
    createPopover: function (element, event) {
        var created_by = formatUserName(event.extendedProps.owner);
        var modified_by = formatUserName(event.extendedProps.modified_by);
        const calendarView = frappe.views.calendar["Patient Appointment"];
        const escapeHtml = calendarView.escapeHtml.bind(calendarView);
        calendarView.bindGlobalPointerGuards();

        const patientName = escapeHtml(event.extendedProps.full_name || event.title || '');
        const mobile = escapeHtml(event.extendedProps.mobile || '');
        const fileNumberRaw = event.extendedProps.file_number || '';
        const fileNumber = escapeHtml(fileNumberRaw);
        const cprRaw = event.extendedProps.cpr || '';
        const cpr = escapeHtml(cprRaw);
        const hasBirthdate = Boolean(event.extendedProps.birthdate);
        const hasFileNumber = Boolean(fileNumberRaw);
        const hasCpr = Boolean(cprRaw);
        const appointmentType = event.extendedProps.appointment_type ? escapeHtml(event.extendedProps.appointment_type) : '';
        const visitReason = event.extendedProps.visit_reason ? escapeHtml(event.extendedProps.visit_reason) : '';
        const rawRoom = event.extendedProps.room || event.extendedProps.room_name || '';
        const room = rawRoom ? escapeHtml(rawRoom) : '';
        const note = event.extendedProps.note ? escapeHtml(event.extendedProps.note) : '';
        const paymentType = event.extendedProps.payment_type ? escapeHtml(event.extendedProps.payment_type) : '';
        const statusLabel = event.extendedProps.status ? escapeHtml(event.extendedProps.status) : '';
        const imageSrc = event.extendedProps.image ? escapeHtml(event.extendedProps.image) : '';
        const hasImage = Boolean(event.extendedProps.image);

        const salesInvoiceRaw = event.extendedProps.sales_invoice;
        const insuranceInvoiceRaw = event.extendedProps.insurance_invoice;
        const billingStatusValue = event.extendedProps.billing_status || (salesInvoiceRaw ? 'Invoiced' : 'Not Billed');
        const insuranceStatusValue = event.extendedProps.insurance_status || 'Not Claimed';
        const billingBadgeClass = calendarView.getBillingBadgeClass(billingStatusValue);
        const insuranceBadgeClass = calendarView.getInsuranceBadgeClass(insuranceStatusValue);
        const billingLabel = escapeHtml(__(billingStatusValue));
        const insuranceLabel = escapeHtml(__(insuranceStatusValue));
        const salesInvoiceLink = salesInvoiceRaw
            ? `<a href="/app/sales-invoice/${encodeURIComponent(salesInvoiceRaw)}" target="_blank">${escapeHtml(salesInvoiceRaw)}</a>`
            : '';
        const insuranceInvoiceLink = insuranceInvoiceRaw
            ? `<a href="/app/sales-invoice/${encodeURIComponent(insuranceInvoiceRaw)}" target="_blank">${escapeHtml(insuranceInvoiceRaw)}</a>`
            : '';

        const headerMetaParts = [];
        if (hasBirthdate) {
            headerMetaParts.push(`${__('Age')}: ${moment().diff(event.extendedProps.birthdate, 'years')}`);
        }
        if (hasFileNumber) {
            headerMetaParts.push(`${__('File')}: ${fileNumber}`);
        }
        if (hasCpr) {
            headerMetaParts.push(`${__('CPR')}: ${cpr}`);
        }
        if (mobile) {
            headerMetaParts.push(mobile);
        }
        const headerMeta = headerMetaParts.join(' | ');

        const billingInfoHtml = `
            <small class="d-block mt-1">
                <b>${__('Billing')}:</b>
                <span class="badge badge-${billingBadgeClass}">${billingLabel}</span>
                ${salesInvoiceLink ? `<span class="ml-1">${salesInvoiceLink}</span>` : ''}
            </small>
        `.trim();

        const insuranceInfoHtml = `
            <small class="d-block">
                <b>${__('Insurance')}:</b>
                <span class="badge badge-${insuranceBadgeClass}">${insuranceLabel}</span>
                ${insuranceInvoiceLink ? `<span class="ml-1">${insuranceInvoiceLink}</span>` : ''}
            </small>
        `.trim();

        var popoverContent = `
            <div id="popoverX-${event.id}" class="popover-x popover-default popover-md">
                <div class="arrow"></div>
                <div style="background-color: #D9D9D9;opacity: 0.9;" class="popover-header popover-content">
                    ${patientName}
                    ${headerMeta ? `<small class=""><br/>${headerMeta}</small>` : ''}
                </div>
                <div style="background-color: #F2F2F2" class="popover-body popover-content">
                    <div style="background-color: #F2F2F2" class="row">
                        <div class="col-md-5 ${hasImage ? "" : "hidden"}">
                            ${hasImage ? `<img class="img-thumbnail img-responsive" src="${imageSrc}">` : ''}
                        </div>
                        <div class="col-md-7" style="${hasImage ? "padding-left: 0px;" : ""}">
                            <div class="label label-warning">
                                ${statusLabel ? `${statusLabel}<br/>` : ''}
                            </div>
                            ${appointmentType ? `<small><b>${__('Type')}:</b> ${appointmentType}</small><br/>` : ''}
                            ${visitReason ? `<small><b>${__('Reason')}:</b> ${visitReason}</small><br/>` : ''}
                            ${room ? `<small><b>${__('Room')}:</b> ${room}</small><br/>` : ''}
                            ${note ? `<small><b>${__('Notes')}:</b> ${note}</small><br/>` : ''}
                            ${paymentType ? `<small><b>${__('Payment')}:</b> ${paymentType}</small><br/>` : ''}
                            ${billingInfoHtml}
                            ${insuranceInfoHtml}
                        </div>
                    </div>
                </div>
                <div style="background-color: #D9D9D9;opacity: 0.9;" class="popover-footer text-center">
                    <small>
                        <b>${__('Time')}:</b> 
                        ${moment(event.start).format('h:mm A')} –> ${moment(event.end).format('h:mm A')}
                    </small><br/>
                    <small>
                        <b>${__('Date')}:</b> ${moment(event.start).format('dddd, Do MMM YYYY')}
                    </small>
                </div>
            </div>
        `;

        element.insertAdjacentHTML('beforeend', popoverContent);
        $(`[role="tooltip"].popover`).remove();
        if (event.id) {
            const $element = $(element);
            $element.popover({
                trigger: 'manual',
                content: $(`#popoverX-${event.id}`).html(),
                html: true,
                placement: 'right',
                container: 'body',
                boundary: 'viewport',
                offset: '0,8'
            });

            let hideTimer = null;
            const hoverState = { trigger: false, tip: false };
            const clearHideTimer = () => {
                if (hideTimer) {
                    clearTimeout(hideTimer);
                    hideTimer = null;
                }
            };
            const scheduleHideIfIdle = () => {
                clearHideTimer();
                hideTimer = setTimeout(() => {
                    if (!hoverState.trigger && !hoverState.tip) {
                        $element.popover('hide');
                    }
                }, 220);
            };

            const bindPopoverHoverGuards = () => {
                const instance = $element.data('bs.popover');
                if (!instance) return;

                const tip = (() => {
                    if (typeof instance.getTipElement === 'function') return instance.getTipElement();
                    if (typeof instance.tip === 'function') return instance.tip();
                    if (instance.$tip && instance.$tip[0]) return instance.$tip[0];
                    if (instance.tip && instance.tip.nodeType) return instance.tip;
                    return null;
                })();

                if (!tip || tip._hoverGuardsBound || typeof tip.addEventListener !== 'function') return;

                tip._hoverGuardsBound = true;
                tip.addEventListener('mouseenter', () => {
                    hoverState.tip = true;
                    clearHideTimer();
                });
                tip.addEventListener('mouseleave', () => {
                    hoverState.tip = false;
                    scheduleHideIfIdle();
                });
            };

            element.addEventListener('mouseenter', function () {
                if (calendarView.state.isPointerDown) {
                    return;
                }
                calendarView.hideActivePopovers();
                $element.popover('show');
                hoverState.trigger = true;
                clearHideTimer();
                // Ensure bindings run after popover DOM exists
                setTimeout(bindPopoverHoverGuards, 0);
            });

            element.addEventListener('mouseleave', function () {
                hoverState.trigger = false;
                scheduleHideIfIdle();
            });

            element.addEventListener('mousedown', function () {
                calendarView.state.isPointerDown = true;
                calendarView.hideActivePopovers();
            });
        }
    },

    bindGlobalPointerGuards: function () {
        if (this._pointerGuardsBound) {
            return;
        }
        const calendarView = this;
        const resetPointer = function () {
            calendarView.state.isPointerDown = false;
        };
        document.addEventListener('mouseup', resetPointer, true);
        document.addEventListener('dragend', resetPointer, true);
        document.addEventListener('touchend', resetPointer, true);
        this._pointerGuardsBound = true;
    },

    hideActivePopovers: function () {
        try {
            $('.fc-event').each(function () {
                const $el = $(this);
                if (typeof $el.popover === 'function') {
                    $el.popover('hide');
                }
            });
        } catch (error) {
            console.warn('Unable to hide popovers', error);
        }
        $(`[role="tooltip"].popover`).remove();
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
        const calendarView = this;
        const {
            status,
            appointment_type,
            visit_reason,
            booking_type,
            room,
            room_name,
            note,
            duration,
            billing_status,
            sales_invoice,
            insurance_status,
            insurance_invoice
        } = arg.event.extendedProps;

        const safeStatusClass = status ? status.toLowerCase().replace(/\s+/g, '-') : '';
        const safeTitle = calendarView.escapeHtml(arg.event.title || '');
        const safeType = appointment_type ? calendarView.escapeHtml(appointment_type) : '';
        const safeStatus = status ? calendarView.escapeHtml(status) : '';
        const safeBookType = booking_type ? calendarView.escapeHtml(booking_type) : '';
        const safeReason = visit_reason ? calendarView.escapeHtml(visit_reason) : '';
        const roomLabel = room || room_name || '';
        const safeRoom = roomLabel ? calendarView.escapeHtml(roomLabel) : '';
        const safeNote = note ? calendarView.escapeHtml(note) : '';

        const billingValue = billing_status || (sales_invoice ? 'Invoiced' : 'Not Billed');
        const billingBadgeClass = calendarView.getBillingBadgeClass(billingValue);
        const billingLabel = calendarView.escapeHtml(__(billingValue));
        const salesInvoiceLabel = sales_invoice ? calendarView.escapeHtml(sales_invoice) : '';

        const insuranceValue = insurance_status || 'Not Claimed';
        const insuranceBadgeClass = calendarView.getInsuranceBadgeClass(insuranceValue);
        const insuranceLabel = calendarView.escapeHtml(__(insuranceValue));
        const insuranceInvoiceLabel = insurance_invoice ? calendarView.escapeHtml(insurance_invoice) : '';

        const billingLine = `
            <div class="appt-finance-line appt-billing">
                <i class="fa-regular fa-credit-card-front"></i>
                <span class="badge badge-${billingBadgeClass}">${billingLabel}</span>
                ${salesInvoiceLabel ? `<span class="appt-invoice-ref">${salesInvoiceLabel}</span>` : ''}
            </div>
        `.trim();

        const insuranceLine = `
            <div class="appt-finance-line appt-insurance">
                <i class="fa-regular fa-shield-heart"></i>
                <span class="badge badge-${insuranceBadgeClass}">${insuranceLabel}</span>
                ${insuranceInvoiceLabel ? `<span class="appt-invoice-ref">${insuranceInvoiceLabel}</span>` : ''}
            </div>
        `.trim();

        return {
            html: `
                <div class="fc-event-main-frame appt-card ${safeStatusClass}">
                    <div class="appt-header">
                        <div class="appt-title">${safeTitle}</div>
                        ${safeBookType === 'Walked In' ?
                    `<svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 640 640"><!--!Font Awesome Free v7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M320 144C350.9 144 376 118.9 376 88C376 57.1 350.9 32 320 32C289.1 32 264 57.1 264 88C264 118.9 289.1 144 320 144zM233.4 291.9L256 269.3L256 338.6C256 366.6 268.2 393.3 289.5 411.5L360.9 472.7C366.8 477.8 370.7 484.8 371.8 492.5L384.4 580.6C386.9 598.1 403.1 610.3 420.6 607.8C438.1 605.3 450.3 589.1 447.8 571.6L435.2 483.5C431.9 460.4 420.3 439.4 402.6 424.2L368.1 394.6L368.1 279.4L371.9 284.1C390.1 306.9 417.7 320.1 446.9 320.1L480.1 320.1C497.8 320.1 512.1 305.8 512.1 288.1C512.1 270.4 497.8 256.1 480.1 256.1L446.9 256.1C437.2 256.1 428 251.7 421.9 244.1L404 221.7C381 192.9 346.1 176.1 309.2 176.1C277 176.1 246.1 188.9 223.4 211.7L188.1 246.6C170.1 264.6 160 289 160 314.5L160 352C160 369.7 174.3 384 192 384C209.7 384 224 369.7 224 352L224 314.5C224 306 227.4 297.9 233.4 291.9zM245.8 471.3C244.3 476.5 241.5 481.3 237.7 485.1L169.4 553.4C156.9 565.9 156.9 586.2 169.4 598.7C181.9 611.2 202.2 611.2 214.7 598.7L283 530.4C294.5 518.9 302.9 504.6 307.4 488.9L309.6 481.3L263.6 441.9C261.1 439.7 258.6 437.5 256.2 435.1L245.8 471.3z"/></svg>` :
                    safeBookType === 'Rescheduled' ?
                        '<i class="fa-regular fa-arrow-rotate-right" aria-hidden="true"></i>' : ''
                }
                        <div class="appt-duration">${duration || calendarView.calculateDuration(arg.event)}m</div>
                    </div>
                    <div class="appt-meta">
                        ${safeType ? `<div class="appt-type"><i class="fa-regular fa-clipboard-list"></i> ${safeType}</div>` : ''}
                        ${safeStatus ? `<div class="appt-type fs-1 font-weight-bolder">${safeStatus}</div>` : ''}
                    </div>
                </div>
                `
            // ${safeReason ? `<div class="appt-type"><i class="fa-regular fa-user-doctor"></i> ${safeReason}</div>` : ''}
            // ${safeRoom ? `<div class="appt-room"><i class="fa-regular fa-bed"></i> ${safeRoom}</div>` : ''}
            // ${safeNote ? `<div class="appt-note"><i class="fa-regular fa-comments"></i> ${safeNote}</div>` : ''}
            // <div class="appt-finance">
            //     ${billingLine}
            //     ${insuranceLine}
            // </div>
        };
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

    // Convenience helper to refresh the calendar after server-side updates
    refreshCalendar: function () {
        if (cur_list?.calendar?.fullCalendar) {
            cur_list.calendar.fullCalendar.refetchEvents();
        } else if (typeof cur_list?.refresh === 'function') {
            cur_list.refresh();
        }
        if (this.state?.lastViewInfo && this.state.resourceMode === 'doctors') {
            this.ensureUnavailableSlotStyles();
            this.markUnavailableSlots(this.state.lastViewInfo).catch((err) => {
                console.warn('Unable to refresh availability overlays', err);
            });
        } else if (this.state?.resourceMode !== 'doctors') {
            this.clearAvailabilityOverlays();
        }
    },

    resetAvailabilityCache: function () {
        this.state.availabilityCache = {};
        this.state.unavailableByResourceDate = {};
    },

    ensureUnavailableSlotStyles: function () {
        if (document.getElementById('slot-unavailable-style-tag')) {
            return;
        }
        const styleEl = document.createElement('style');
        styleEl.id = 'slot-unavailable-style-tag';
        styleEl.textContent = `
            .slot-unavailable-indicator {
                background: repeating-linear-gradient(135deg, rgba(220, 53, 69, 0.16), rgba(220, 53, 69, 0.16) 12px, rgba(220, 53, 69, 0.05) 12px, rgba(220, 53, 69, 0.05) 24px) !important;
                border: 0 !important;
                pointer-events: none !important;
            }
        `;
        document.head.appendChild(styleEl);
    },

    clearAvailabilityOverlays: function () {
        const calendar = cur_list?.calendar?.fullCalendar;
        if (!calendar || typeof calendar.getEvents !== 'function') {
            return;
        }
        calendar.getEvents().forEach(event => {
            if (event.extendedProps && event.extendedProps.__availabilityOverlay) {
                event.remove();
            }
        });
        $('.slot-unavailable-indicator[data-toggle="tooltip"]').tooltip('dispose');
        this.state.unavailableByResourceDate = {};
    },

    getAvailabilityData: async function (practitionerId, date, opts) {
        if (!practitionerId || !date) {
            return null;
        }

        const cacheKey = `${practitionerId}__${date}`;
        this.state.availabilityCache = this.state.availabilityCache || {};
        const forceRefresh = opts && opts.forceRefresh;
        if (!forceRefresh && this.state.availabilityCache[cacheKey]) {
            return this.state.availabilityCache[cacheKey];
        }

        const response = await frappe.call({
            method: 'do_health.api.methods.get_availability_data',
            args: {
                practitioner: practitionerId,
                date,
                appointment: {
                    docstatus: 0,
                    doctype: 'Patient Appointment',
                    name: null,
                    duration: 15
                }
            },
            freeze: false
        });

        if (response.exc || response._server_messages) {
            throw response;
        }

        const data = response.message || {};
        this.state.availabilityCache[cacheKey] = data;
        return data;
    },

    computeUnavailableRanges: function (slotDetails, dateStr, dayStart, dayEnd) {
        const explicitlyUnavailable = [];
        (slotDetails || []).forEach(slotInfo => {
            (slotInfo.appointments || []).forEach(booked => {
                if ((booked.type || '').toLowerCase() !== 'unavailable') {
                    return;
                }
                const bookedStartRaw = moment(`${dateStr} ${booked.appointment_time}`, 'YYYY-MM-DD HH:mm:ss');
                let bookedEndRaw = bookedStartRaw.clone();
                const durationMinutes = parseInt(booked.duration, 10);
                if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
                    bookedEndRaw = bookedEndRaw.add(durationMinutes, 'minutes');
                } else {
                    bookedEndRaw = bookedEndRaw.add(15, 'minutes');
                }

                if (!bookedStartRaw.isValid() || !bookedEndRaw.isValid()) {
                    return;
                }

                const bookedStart = moment.max(bookedStartRaw, dayStart);
                const bookedEnd = moment.min(bookedEndRaw, dayEnd);
                if (bookedEnd.isAfter(bookedStart)) {
                    explicitlyUnavailable.push({
                        start: bookedStart,
                        end: bookedEnd,
                        reason: booked.reason || '',
                        note: booked.note || ''
                    });
                }
            });
        });

        if (!explicitlyUnavailable.length) {
            return [];
        }

        explicitlyUnavailable.sort((a, b) => a.start.valueOf() - b.start.valueOf());

        const mergedUnavailable = [];
        explicitlyUnavailable.forEach(range => {
            if (!mergedUnavailable.length) {
                mergedUnavailable.push({
                    start: range.start.clone(),
                    end: range.end.clone(),
                    reason: range.reason,
                    note: range.note
                });
                return;
            }
            const last = mergedUnavailable[mergedUnavailable.length - 1];
            if (range.start.isSameOrBefore(last.end)) {
                if (range.end.isAfter(last.end)) {
                    last.end = range.end.clone();
                }
                last.reason = last.reason || range.reason;
                last.note = last.note || range.note;
            } else {
                mergedUnavailable.push({
                    start: range.start.clone(),
                    end: range.end.clone(),
                    reason: range.reason,
                    note: range.note
                });
            }
        });

        return mergedUnavailable.filter(range => range.end.isAfter(range.start));
    },

    markUnavailableSlots: async function (info) {
        if (this.state.resourceMode !== 'doctors') {
            this.clearAvailabilityOverlays();
            return;
        }

        const calendar = cur_list?.calendar?.fullCalendar;
        if (!calendar || typeof calendar.addEvent !== 'function') {
            return;
        }

        const viewType = info?.view?.type || this.state.currentView;
        const supportedViews = ['resourceTimeGridDay', 'resourceTimeGridWeek'];
        if (!supportedViews.includes(viewType)) {
            return;
        }

        const resources = Array.isArray(this.state.resources) ? this.state.resources : [];
        if (!resources.length) {
            return;
        }

        const viewStart = moment(info?.view?.currentStart);
        const viewEnd = moment(info?.view?.currentEnd);
        if (!viewStart.isValid() || !viewEnd.isValid()) {
            return;
        }

        this.resetAvailabilityCache();
        this.clearAvailabilityOverlays();
        if (!this.state.availabilityCache) {
            this.state.availabilityCache = {};
        }

        const backgroundEvents = [];
        const fetchTasks = [];
        const availabilityMap = {};

        for (let day = viewStart.clone(); day.isBefore(viewEnd); day.add(1, 'day')) {
            const dateStr = day.format('YYYY-MM-DD');
            resources.forEach(resource => {
                fetchTasks.push((async () => {
                    const dayStart = moment(`${dateStr} ${CONFIG.SLOT_MIN_TIME}`, 'YYYY-MM-DD HH:mm:ss');
                    const dayEnd = moment(`${dateStr} ${CONFIG.SLOT_MAX_TIME}`, 'YYYY-MM-DD HH:mm:ss');
                    if (!dayStart.isValid() || !dayEnd.isValid() || !dayEnd.isAfter(dayStart)) {
                        return;
                    }
                    try {
                        const availability = await this.getAvailabilityData(resource.id, dateStr, { forceRefresh: true });
                        const slotDetails = availability?.slot_details || [];
                        const unavailableRanges = this.computeUnavailableRanges(slotDetails, dateStr, dayStart, dayEnd);

                        if (!unavailableRanges.length) {
                            return;
                        }

                        const mapKey = `${resource.id}__${dateStr}`;
                        availabilityMap[mapKey] = availabilityMap[mapKey] || [];

                        unavailableRanges.forEach(range => {
                            const startIso = range.start.toISOString();
                            const endIso = range.end.toISOString();

                            availabilityMap[mapKey].push({
                                start: startIso,
                                end: endIso,
                                reason: range.reason || '',
                                note: range.note || ''
                            });

                            backgroundEvents.push({
                                start: startIso,
                                end: endIso,
                                resourceId: resource.id,
                                display: 'background',
                                overlap: false,
                                extendedProps: {
                                    __availabilityOverlay: true,
                                    reason: range.reason || '',
                                    note: range.note || ''
                                }
                            });
                        });
                    } catch (error) {
                        console.warn(`Failed to fetch availability for ${resource.id} on ${dateStr}`, error);
                    }
                })());
            });
        }

        await Promise.all(fetchTasks);

        this.state.unavailableByResourceDate = availabilityMap;

        if (!backgroundEvents.length) {
            return;
        }

        backgroundEvents.forEach(eventConfig => {
            const extendedProps = Object.assign({ __availabilityOverlay: true }, eventConfig.extendedProps || {});
            calendar.addEvent(Object.assign({}, eventConfig, {
                extendedProps,
                classNames: ['slot-unavailable-indicator']
            }));
        });
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

function applySecondaryCollapsed(collapsed) {
    if (window.doHealthSidebar?.setSecondaryCollapsed) {
        window.doHealthSidebar.setSecondaryCollapsed(collapsed);
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 300);
    }
}

// Load waiting list data once on page load

function render_datepicker() {
    cur_list.$page.find('.filter-section').addClass('hidden');
    if ($('#monthdatepicker').length == 0) {
        sessionStorage.server_update = 0;

        const calendarView = frappe.views.calendar["Patient Appointment"];
        const $sidebar = cur_list.$page.find(".layout-side-section .list-sidebar");

        // Add datepicker
        $sidebar.html(function () {
            return $('<div id="monthdatepicker"></div>').datepicker({
                language: 'en',
                todayButton: new Date(),
                onSelect: function (formattedValue, selectedDate) {
                    if (!selectedDate || !calendarView) {
                        return;
                    }
                    if (calendarView.state?.isDatepickerSyncing) {
                        return;
                    }

                    sessionStorage.selected_date = moment(selectedDate).format();
                    const calendarApi = calendarView.getCalendarApi();
                    if (calendarApi?.gotoDate) {
                        calendarApi.gotoDate(selectedDate);
                    } else if (cur_list?.calendar?.fullCalendar?.gotoDate) {
                        cur_list.calendar.fullCalendar.gotoDate(selectedDate);
                    }
                },
                onChangeMonth: function (month, year) {
                    // Fetch and display appointment counts when month changes
                    updateAppointmentBadges(month, year);
                },
                onRenderCell: function (date, cellType) {
                    if (cellType === 'day') {
                        const dateStr = moment(date).format('YYYY-MM-DD');
                        const count = window._appointmentCounts?.[dateStr] || 0;

                        if (count > 0) {
                            return {
                                html: date.getDate() + `<span class="appointment-badge">${count}</span>`
                            };
                        }
                    }
                }
            });

        });

        // $('#mycss').css('background-color','#FFFFFF').css('padding','10px');
        $("div.col-lg-2.layout-side-section").css('max-width', '25%');      // increase the wating list width
        $("div.col-lg-2.layout-side-section").css('padding', '1px');

        calendarView?.syncDatepickerWithCalendar();

        // Initial load of appointment badges
        const now = new Date();
        updateAppointmentBadges(now.getMonth(), now.getFullYear());

        // Waiting list is now rendered in the health sidebar (do-health-secondary-wrapper)
    }
}

function updateAppointmentBadges(month, year) {
    // Calculate start and end dates for the month
    const startDate = moment([year, month, 1]).format('YYYY-MM-DD');
    const endDate = moment([year, month]).add(1, 'month').format('YYYY-MM-DD');

    frappe.call({
        method: 'do_health.api.methods.get_appointment_counts_for_month',
        args: {
            start_date: startDate,
            end_date: endDate
        },
        callback: function (r) {
            if (r.message) {
                window._appointmentCounts = r.message;

                // Update the datepicker to show badges
                const $picker = $('#monthdatepicker');
                if ($picker.length) {
                    const pickerInstance = $picker.data('datepicker');
                    if (pickerInstance) {
                        // Force re-render of the calendar
                        pickerInstance.update();
                    }
                }
            }
        }
    });
}

function set_current_session(view) {
    sessionStorage.selected_date = view.currentStart;
    sessionStorage.selected_view = view.type;
}

function updateEvent(info, options) {
    const opts = options || {};
    const preserveTime = !!opts.preserveTime;
    const eventStart = opts.originalStart || info.event.start;
    const eventEnd = opts.originalEnd || info.event.end;
    const starttime_local = moment(eventStart).format("H:mm:ss");
    const endtime_local = moment(eventEnd).format("H:mm:ss");
    const duration = moment(eventEnd).diff(moment(eventStart), 'minutes');
    const calendarView = frappe.views.calendar["Patient Appointment"];
    const mode = calendarView?.state?.resourceMode || 'doctors';
    const firstResource = info.event.getResources()[0];
    const resourceId = firstResource?.id || null;
    const resourceTitle = firstResource?.title || '';

    if (mode === 'rooms') {
        info.event.setExtendedProp('room_resource_id', resourceId === ROOM_UNASSIGNED_RESOURCE ? null : resourceId);
        info.event.setExtendedProp('room', resourceId === ROOM_UNASSIGNED_RESOURCE ? '' : resourceTitle);
        if (preserveTime && opts.originalStart && opts.originalEnd && typeof info.event.setDates === 'function') {
            info.event.setDates(opts.originalStart, opts.originalEnd);
        }
    } else {
        info.event.setExtendedProp('practitioner_id', resourceId);
    }

    frappe.call({
        method: 'frappe.client.set_value',
        args: {
            doctype: 'Patient Appointment',
            name: info.event.id,
            fieldname: {
                appointment_date: moment(eventStart).format("YYYY-MM-DD"),
                appointment_time: starttime_local,
                duration: duration,
                practitioner: mode === 'doctors' ? resourceId : info.event.extendedProps.practitioner_id,
                service_unit: mode === 'rooms'
                    ? (resourceId === ROOM_UNASSIGNED_RESOURCE ? '' : resourceId)
                    : (info.event.extendedProps.room_resource_id || '')
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

const appointmentActions = {
    // Common helpers ---------------------------------------------------------
    async fetchAppointmentFields(appointmentId, fields = []) {
        const fieldList = Array.isArray(fields) ? fields : [fields];
        if (!fieldList.length) {
            return {};
        }
        const { message } = await frappe.db.get_value('Patient Appointment', appointmentId, fieldList);
        return message || {};
    },

    refreshCalendar() {
        frappe.views.calendar["Patient Appointment"].refreshCalendar();
    },

    // Appointment navigation & clinical flows --------------------------------
    openAppointment(appointmentId) {
        frappe.set_route('Form', 'Patient Appointment', appointmentId);
    },

    editAppointment(appointmentId, event) {
        frappe.views.calendar["Patient Appointment"].handleAppointmentClick({ event });
    },

    addVitalSigns(appointmentId) {
        frappe.new_doc('Vital Signs', {
            appointment: appointmentId,
        });
    },

    cprReading(appointmentId) {
    },

    async openBillingInterface(appointmentId) {
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
    },


    async pinPatientToSidebar(appointmentId, event = {}) {
        const sidebarApi = window.doHealthSidebar;
        if (!sidebarApi || typeof sidebarApi.selectPatient !== 'function') {
            frappe.show_alert({ message: __('Sidebar is not ready yet'), indicator: 'orange' });
            return;
        }

        const context = event.extendedProps;

        let patientContext = {
            patient: context.patient || context.customer || context.patient_id || null,
            patient_name: context.full_name || context.patient_name || context.customer_name || context.customer || '',
            appointment: appointmentId,
            arrival_time: context.arrival_time || context.check_in_time || null,
            patient_image: context.image || context.patient_image || null,
            appointment_date: event.startStr.split('T')[0],
            appointment_time: event.startStr.split('T')[1].split('+')[0],
            appointment_type: context.appointment_type,
            arrival_time: context.arrival_time,
            custom_cpr: context.cpr,
            custom_file_number: context.file_number,
            custom_visit_status: context.status,
            dob: context.birthdate,
            gender: context.gender,
            mobile: context.mobile,
            name: appointmentId,
            practitioner: context.practitioner,
            practitioner_name: context.practitioner_name,
        };

        if (!patientContext.patient) {
            const details = await appointmentActions.fetchAppointmentFields(appointmentId, ['patient', 'patient_name']);
            patientContext.patient = details.patient;
            patientContext.patient_name = details.patient_name || patientContext.patient;
        }

        if (!patientContext.patient) {
            frappe.show_alert({ message: __('Unable to identify patient for this appointment'), indicator: 'red' });
            return;
        }

        sidebarApi.selectPatient(patientContext);
        frappe.show_alert({
            message: __('Patient pinned to sidebar'),
            indicator: 'green'
        });
    },

    async addPatientEncounter(appointmentId) {
        const encounter = await frappe.db.get_value(
            'Patient Encounter',
            { appointment: appointmentId, docstatus: ['!=', 2] },
            'name'
        );

        if (encounter.message?.name) {
            frappe.set_route('Form', 'Patient Encounter', encounter.message.name);
            return;
        }

        const appointment = await appointmentActions.fetchAppointmentFields(appointmentId, [
            'name',
            'practitioner',
            'patient',
            'department'
        ]);

        frappe.new_doc('Patient Encounter', {}, (newEncounter) => {
            newEncounter.appointment = appointment.name;
            newEncounter.encounter_date = frappe.datetime.nowdate();
            newEncounter.encounter_time = frappe.datetime.now_time();
            newEncounter.patient = appointment.patient;
            newEncounter.practitioner = appointment.practitioner;
            newEncounter.medical_department = appointment.department;
        });
    },

    async addVisitNote(appointmentId, event = {}) {
        const context = event.extendedProps;
        const defaults = context?.custom_visit_notes
            ? { custom_visit_notes: context.custom_visit_notes }
            : await appointmentActions.fetchAppointmentFields(appointmentId, 'custom_visit_notes');

        frappe.prompt(
            {
                fieldname: 'visit_notes',
                label: __('Visit Notes'),
                fieldtype: 'Small Text',
                default: defaults.custom_visit_notes || '',
            },
            async (values) => {
                await frappe.db.set_value('Patient Appointment', appointmentId, 'custom_visit_notes', values.visit_notes);
                frappe.show_alert({ message: __('Visit notes updated'), indicator: 'green' });
                this.refreshCalendar();
            },
            __('Update Visit Notes'),
            __('Update')
        );
    },

    async setVisitStatus(appointmentId, status) {
        if (!status) {
            return;
        }

        await frappe.db.set_value('Patient Appointment', appointmentId, 'custom_visit_status', status)

        frappe.show_alert({ message: __('Visit status updated'), indicator: 'green' });
        this.refreshCalendar();
    },

    async bookFollowUp(appointmentId) {
        let details = await appointmentActions.fetchAppointmentFields(appointmentId,
            ['patient', 'practitioner', 'appointment_type', 'duration']
        );
        const defaultEvent = {
            practitioner: details.practitioner,
            patient: details.patient,
            appointment_type: details.appointment_type,
            duration: details.duration,
            custom_appointment_category: 'Follow-up',
            custom_past_appointment: appointmentId,

            // 'appointment_category': event.custom_appointment_category,
            // 'appointment_type': event.appointment_type,
            // 'duration': event.duration,
            // 'confirmed': event.custom_confirmed,
            // 'reminded': event.reminded,
            // 'custom_visit_reason': event.custom_visit_reason,
            // 'branch': event.custom_branch,
            // 'notes': event.notes,
        };
        check_and_set_availability(defaultEvent, true);
    },

    async showVisitLog(appointmentId) {
        try {
            const { message } = await frappe.call({
                method: 'do_health.api.methods.get_visit_log',
                args: { appointment_id: appointmentId },
            });

            const data = message || {};
            const entries = Array.isArray(data.entries) ? data.entries : [];

            if (!entries.length) {
                frappe.msgprint(__('No visit logs found.'));
                return;
            }

            const escapeHtml = frappe.utils?.escape_html || ((value) => {
                if (value === undefined || value === null) {
                    return '';
                }
                return String(value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            });

            const makeDocLink = (doctype, name, label) => {
                if (!doctype || !name) {
                    return escapeHtml(label || name || '');
                }
                const safeLabel = escapeHtml(label || name);
                return `<a href="/app/sales-invoice/${encodeURIComponent(name)}" target="_blank">${safeLabel}</a>`;
            };

            const STATUS_BADGE_STYLES = {
                scheduled: { bg: '#D6EAF8', text: '#1A5276' },
                arrived: { bg: '#FDEBD0', text: '#9C640C' },
                ready: { bg: '#D5F5E3', text: '#186A3B' },
                'in room': { bg: '#FCF3CF', text: '#7D6608' },
                completed: { bg: '#D4EFDF', text: '#145A32' },
                cancelled: { bg: '#F2F3F4', text: '#515A5A', border: '#D7DBDD' },
                'no show': { bg: '#FADBD8', text: '#922B21' },
                transferred: { bg: '#E8DAEF', text: '#6C3483' }
            };

            const DOC_STATUS_STYLES = {
                draft: { bg: '#E9ECEF', text: '#495057' },
                submitted: { bg: '#D6EAF8', text: '#1A5276' },
                paid: { bg: '#D4EFDF', text: '#145A32' },
                unpaid: { bg: '#FDEBD0', text: '#9C640C' },
                overdue: { bg: '#FADBD8', text: '#922B21' },
                cancelled: { bg: '#F8D7DA', text: '#842029' },
                'partially paid': { bg: '#FCF3CF', text: '#7D6608' }
            };

            const DEFAULT_BADGE_STYLE = { bg: '#ADB5BD', text: '#1E1E1E' };

            const buildBadge = (label, style) => {
                if (!label) {
                    return '';
                }

                const { bg, text, border } = style || DEFAULT_BADGE_STYLE;
                const safeLabel = escapeHtml(label);
                const borderStyle = border ? `border: 1px solid ${border};` : '';
                return `<span class="badge ml-2" style="background:${bg};color:${text};${borderStyle}">${safeLabel}</span>`;
            };

            const resolveStatusBadge = (entry) => {
                if (!entry?.badge) return '';
                const key = (entry.badge || '').toLowerCase();
                const style = STATUS_BADGE_STYLES[key] || DEFAULT_BADGE_STYLE;
                return buildBadge(entry.badge, style);
            };

            const resolveDocumentBadge = (entry) => {
                if (!entry?.badge) return '';
                const value = (entry.badge || '').toLowerCase();

                let style = DOC_STATUS_STYLES[value];
                if (!style) {
                    if (value.includes('partial')) {
                        style = DOC_STATUS_STYLES['partially paid'];
                    } else if (value.includes('paid')) {
                        style = DOC_STATUS_STYLES.paid;
                    } else if (value.includes('draft')) {
                        style = DOC_STATUS_STYLES.draft;
                    } else if (value.includes('submit')) {
                        style = DOC_STATUS_STYLES.submitted;
                    } else if (value.includes('overdue')) {
                        style = DOC_STATUS_STYLES.overdue;
                    } else if (value.includes('cancel')) {
                        style = DOC_STATUS_STYLES.cancelled;
                    }
                }

                return buildBadge(entry.badge, style || DEFAULT_BADGE_STYLE);
            };

            const resolveTagBadge = (entry) => {
                if (!entry?.tag) return '';
                const key = (entry.tag || '').toLowerCase();
                let style = { bg: '#EAECEF', text: '#3E444A' };
                if (key.includes('patient')) {
                    style = { bg: '#FFF4D3', text: '#705214', border: '#FFE8A3' };
                } else if (key.includes('insurance')) {
                    style = { bg: '#E5E4FF', text: '#3C327B', border: '#C9C5FF' };
                }
                return buildBadge(entry.tag, style);
            };

            let lastDateLabel = null;
            const timelineRows = entries.map((entry) => {
                const entryDate = entry.date || '';
                const entryTime = entry.time || '';

                const isNewDate = entryDate && entryDate !== lastDateLabel;
                const whenParts = [];
                if (isNewDate && entryDate) {
                    whenParts.push(escapeHtml(entryDate));
                }
                if (entryTime) {
                    whenParts.push(escapeHtml(entryTime));
                }
                const whenLabel = whenParts.length ? whenParts.join(isNewDate ? ' - ' : ' ') : escapeHtml(entryDate || entryTime || '');

                if (entryDate) {
                    lastDateLabel = entryDate;
                }

                const title = escapeHtml(entry.title || '');
                const docLink = entry.doc ? makeDocLink(entry.doc.doctype, entry.doc.name, entry.doc.label || entry.doc.name) : '';
                const badge = entry.type === 'status' ? resolveStatusBadge(entry) : resolveDocumentBadge(entry);
                const tag = resolveTagBadge(entry);
                const description = entry.description ? `<div class="text-muted mt-1">${escapeHtml(entry.description)}</div>` : '';

                const referenceHtml = entry.reference
                    ? `<div class="text-muted small">${__('Against')}: ${makeDocLink(entry.reference.doctype, entry.reference.name, entry.reference.label || entry.reference.name)}</div>`
                    : '';

                const extraHtml = Array.isArray(entry.extra)
                    ? entry.extra
                        .filter((item) => item && item.label && item.value)
                        .map((item) => `<div class="text-muted small">${escapeHtml(item.label)}: ${escapeHtml(item.value)}</div>`)
                        .join('')
                    : '';

                const userLine = entry.user
                    ? `<div class="text-muted small">${__('By {0}', [escapeHtml(entry.user)])}</div>`
                    : '';

                return `
                    <div class="visit-log-row d-flex mb-3">
                        <div class="visit-log-time text-muted mr-3 ${isNewDate ? 'font-weight-bold' : ''}">${whenLabel}</div>
                        <div class="visit-log-body flex-grow-1">
                            <div class="d-flex align-items-center flex-wrap">
                                <div class="font-weight-bold">${title}</div>
                                ${docLink ? `<div>${docLink}</div>` : ''}
                                ${badge}
                                ${tag}
                            </div>
                            ${description}
                            ${referenceHtml}
                            ${extraHtml}
                            ${userLine}
                        </div>
                    </div>`;
            }).join('');

            const dialogHtml = `
                <style>
                    .visit-log-timeline {
                        max-height: 60vh;
                        overflow-y: auto;
                    }
                    .visit-log-time {
                        min-width: 140px;
                    }
                </style>
                <div class="visit-log-timeline">
                    ${timelineRows}
                </div>`;

            frappe.msgprint({
                title: __('Visit Log'),
                message: dialogHtml,
                indicator: 'blue',
                wide: true,
            });
        } catch (error) {
            console.error('Failed to load visit log', error);
            frappe.msgprint({
                title: __('Visit Log'),
                message: __('Unable to load visit log. Please try again.'),
                indicator: 'red',
            });
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
    let duration = event && event.duration ? parseInt(event.duration, 10) : 30;
    if (!duration || isNaN(duration)) {
        duration = 30; // sensible fallback when duration is falsy or invalid
    }
    const initialDuration = duration;
    const initialAppointmentType = event?.appointment_type || '';
    const initialAppointmentFor = event?.appointment_for || 'Practitioner';
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
        let previousAppointmentType = initialAppointmentType;
        let d = new frappe.ui.Dialog({
            title: __('Patient Appointment'),
            fields: [
                { fieldtype: 'Section Break', label: 'Patient Details', collapsible: 0 },
                { fieldtype: 'Link', options: 'Patient', reqd: 1, fieldname: 'patient', label: 'Patient', default: event?.patient ? event.patient : '' },
                { fieldtype: 'Data', fieldname: 'patient_name', label: 'Patient Name', read_only: 1, default: event?.patient_name ? event.patient_name : '' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'patient_cpr', label: 'CPR', read_only: 1, default: event?.cpr ? event.cpr : '' },
                { fieldtype: 'Data', fieldname: 'patient_mobile', label: 'Mobile', read_only: 1, default: event?.mobile ? event.mobile : '' },
                { fieldtype: 'Section Break' },
                { fieldtype: 'Select', fieldname: 'status', options: 'Scheduled\nRescheduled\nWalked In', label: 'Booking Type', default: event.status || 'Scheduled' },
                { fieldtype: 'Link', fieldname: 'appointment_type', options: 'Appointment Type', reqd: 1, label: 'Appointment Type', default: initialAppointmentType },
                { fieldtype: 'Data', fieldname: 'appointment_for', label: 'Appointment For', hidden: 1, default: initialAppointmentFor },
                { fieldtype: 'Int', fieldname: 'duration', label: 'Duration', default: initialDuration },
                { fieldtype: 'Select', options: 'First Time\nFollow-up\nProcedure\nSession', fieldname: 'appointment_category', label: 'Appointment Category', default: event?.custom_appointment_category ? event.custom_appointment_category : '' },
                { fieldtype: 'Link', options: 'Patient Appointment', fieldname: 'custom_past_appointment', hidden: 1, default: event?.custom_past_appointment ? event.custom_past_appointment : '' },
                { fieldtype: 'Link', options: 'Visit Reason', fieldname: 'visit_reason', label: 'Visit Reason', default: event?.visit_reason ? event.visit_reason : '' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Link', fieldname: 'branch', options: 'Branch', label: 'Branch', default: event?.branch ? event.branch : '' },
                { fieldtype: 'Link', fieldname: 'service_unit', options: 'Healthcare Service Unit', label: 'Room', default: event?.service_unit ? event.service_unit : '' },
                { fieldtype: 'Small Text', fieldname: 'notes', label: 'Notes', default: event?.notes ? event.notes : '' },
                { fieldtype: 'Check', fieldname: 'reminded', label: 'Reminded?', default: event?.reminded ? event.reminded : '' },
                { fieldtype: 'Check', fieldname: 'confirmed', label: 'Confirmed?', default: event?.confirmed ? event.confirmed : '' },
                { fieldtype: 'Section Break' },
                { fieldtype: 'Link', options: 'Healthcare Practitioner', reqd: 1, fieldname: 'practitioner', label: 'Healthcare Practitioner' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Date', reqd: 1, fieldname: 'appointment_date', label: 'Date', min_date: new Date(frappe.datetime.get_today()) },
                { fieldtype: 'Section Break', label: 'Available Slots', collapsible: 1 },
                { fieldtype: 'HTML', fieldname: 'available_slots' },
            ],
            primary_action_label: __('Book'),
            primary_action: async function () {
                let data = {
                    'patient': d.get_value('patient'),
                    'custom_appointment_category': d.get_value('appointment_category'),
                    'status': d.get_value('status'),
                    'appointment_type': d.get_value('appointment_type'),
                    'custom_past_appointment': d.get_value('custom_past_appointment'),
                    'appointment_for': d.get_value('appointment_for'),
                    'duration': d.get_value('duration'),
                    'custom_visit_reason': d.get_value('visit_reason'),
                    'reminded': d.get_value('reminded'),
                    'custom_confirmed': d.get_value('confirmed'),
                    'custom_branch': d.get_value('branch'),
                    'notes': d.get_value('notes'),
                    'practitioner': d.get_value('practitioner'),
                    'appointment_date': d.get_value('appointment_date'),
                    'service_unit': d.get_value('service_unit') || service_unit,
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
                        'status': data.status,
                        'appointment_type': data.appointment_type,
                        'custom_past_appointment': data.custom_past_appointment,
                        'appointment_for': data.appointment_for,
                        'duration': data.duration,
                        'reminded': data.reminded,
                        'custom_confirmed': data.custom_confirmed,
                        'custom_visit_reason': data.custom_visit_reason,
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
                                return;
                            }

                            const latest_doc = r.message;
                            const updateQueue = [];

                            // Check each field and queue sequential updates for only the changed values
                            if (data.patient !== latest_doc.patient) {
                                updateQueue.push(() => updateField('patient', data.patient));
                            }
                            if (data.custom_appointment_category !== latest_doc.custom_appointment_category) {
                                updateQueue.push(() => updateField('custom_appointment_category', data.custom_appointment_category));
                            }
                            if (data.status !== latest_doc.status) {
                                updateQueue.push(() => updateField('status', data.status));
                            }
                            if (data.appointment_type !== latest_doc.appointment_type) {
                                updateQueue.push(() => updateField('appointment_type', data.appointment_type));
                            }
                            if (data.custom_past_appointment !== latest_doc.custom_past_appointment) {
                                updateQueue.push(() => updateField('custom_past_appointment', data.custom_past_appointment));
                            }
                            if (data.appointment_for !== latest_doc.appointment_for) {
                                updateQueue.push(() => updateField('appointment_for', data.appointment_for));
                            }
                            if (parseInt(data.duration, 10) !== parseInt(latest_doc.duration, 10)) {
                                updateQueue.push(() => updateField('duration', data.duration));
                            }
                            if (data.custom_confirmed !== latest_doc.custom_confirmed) {
                                updateQueue.push(() => updateField('custom_confirmed', data.custom_confirmed));
                            }
                            if (data.reminded !== latest_doc.reminded) {
                                updateQueue.push(() => updateField('reminded', data.reminded));
                            }
                            if (data.custom_visit_reason !== latest_doc.custom_visit_reason) {
                                updateQueue.push(() => updateField('custom_visit_reason', data.custom_visit_reason));
                            }
                            if (data.custom_branch !== latest_doc.custom_branch) {
                                updateQueue.push(() => updateField('custom_branch', data.custom_branch));
                            }
                            if (data.notes !== latest_doc.notes) {
                                updateQueue.push(() => updateField('notes', data.notes));
                            }
                            if (data.practitioner !== latest_doc.practitioner) {
                                updateQueue.push(() => updateField('practitioner', data.practitioner));
                            }
                            if (data.appointment_date !== latest_doc.appointment_date) {
                                updateQueue.push(() => updateField('appointment_date', data.appointment_date));
                            }
                            if (selected_slot && selected_slot !== latest_doc.appointment_time) {
                                updateQueue.push(() => updateField('appointment_time', selected_slot));
                            }
                            if (data.service_unit !== latest_doc.service_unit) {
                                updateQueue.push(() => updateField('service_unit', data.service_unit));
                            }

                            if (updateQueue.length === 0) {
                                frappe.show_alert({
                                    message: __('No changes made to the appointment'),
                                    indicator: 'blue'
                                });
                                return;
                            }

                            (async () => {
                                try {
                                    for (const applyUpdate of updateQueue) {
                                        await applyUpdate();
                                    }

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
                                } catch (error) {
                                    const rawError = typeof error === 'string' ? error : (error?.message || error?.exc || '');
                                    const errorText = String(rawError || __('Unknown error'));

                                    if (errorText.includes('has been modified after you have opened it')) {
                                        frappe.msgprint({
                                            title: __('Document Updated'),
                                            message: __('This appointment was modified by another user. Please refresh the page and try again.'),
                                            indicator: 'orange'
                                        });
                                    } else {
                                        frappe.msgprint({
                                            title: __('Error'),
                                            message: __('Failed to update appointment: {0}', [errorText]),
                                            indicator: 'red'
                                        });
                                    }
                                }
                            })();
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

        const dateField = d.fields_dict?.appointment_date;
        const getDatepickerInstance = () => {
            if (!dateField) {
                return null;
            }
            return dateField.datepicker || dateField.$input?.data('datepicker') || null;
        };

        const applyDynamicPosition = () => {
            const instance = getDatepickerInstance();
            const inputEl = dateField?.$input?.get(0);
            if (!instance || !instance.update || !inputEl) {
                return;
            }
            const rect = inputEl.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            const showBelow = spaceAbove < spaceBelow;
            instance.update({ position: showBelow ? 'bottom center' : 'top center' });
        };

        const ensureQuickButtons = () => {
            const instance = getDatepickerInstance();
            const pickerEl = instance?.$datepicker;
            if (!pickerEl || pickerEl.data('has-quick-buttons')) {
                return;
            }

            let buttonsContainer = pickerEl.find('.datepicker--buttons');
            if (!buttonsContainer.length) {
                pickerEl.append('<div class="datepicker--buttons"></div>');
                buttonsContainer = pickerEl.find('.datepicker--buttons');
            }

            const makeJumpButton = (label, offset) => {
                const $btn = $(`<span class="datepicker-jump-btn">${__(label)}</span>`);
                $btn.on('click', () => {
                    const currentValue = dateField.$input?.val();
                    const baseMoment = currentValue && moment(currentValue, frappe.defaultDateFormat, true).isValid()
                        ? moment(currentValue, frappe.defaultDateFormat)
                        : moment();

                    if (offset.type === 'days') {
                        baseMoment.add(offset.value, 'days');
                    } else if (offset.type === 'months') {
                        baseMoment.add(offset.value, 'months');
                    }

                    const nextDate = baseMoment.toDate();
                    instance.selectDate(nextDate);
                    instance.hide();
                    dateField.$input.trigger('change');
                });
                return $btn;
            };

            buttonsContainer.append([
                makeJumpButton('After a Week', { type: 'days', value: 7 }),
                makeJumpButton('After a Month', { type: 'months', value: 1 }),
                makeJumpButton('After 6 Months', { type: 'months', value: 6 })
            ]);

            pickerEl.data('has-quick-buttons', true);
        };

        const bindDatepickerEnhancements = () => {
            if (!dateField?.$input) {
                return;
            }
            dateField.$input.on('focus.dynamic-datepicker click.dynamic-datepicker keyup.dynamic-datepicker', () => {
                setTimeout(() => {
                    applyDynamicPosition();
                    ensureQuickButtons();
                }, 0);
            });
        };

        const cleanupDatepickerEnhancements = () => {
            dateField?.$input?.off('.dynamic-datepicker');
        };

        d.$wrapper.on('shown.bs.modal', () => {
            bindDatepickerEnhancements();
            setTimeout(() => {
                applyDynamicPosition();
                ensureQuickButtons();
            }, 50);
        });

        d.$wrapper.on('hidden.bs.modal', () => {
            cleanupDatepickerEnhancements();
        });

        // Set initial values safely
        if (event) {
            d.set_values({
                'practitioner': event.practitioner,
                'appointment_date': event.appointment_date,
            });

            if (!is_new) {
                d.set_df_property('status', 'read_only', 1);
                d.set_values({
                    'patient': event.patient,
                    'appointment_category': event.custom_appointment_category,
                    'status': event.status,
                    'appointment_type': event.appointment_type,
                    'custom_past_appointment': event.custom_past_appointment,
                    'duration': event.duration,
                    'confirmed': event.custom_confirmed,
                    'reminded': event.reminded,
                    'custom_visit_reason': event.custom_visit_reason,
                    'branch': event.custom_branch,
                    'service_unit': event.service_unit,
                    'notes': event.notes,
                });
            }
        }

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

        d.fields_dict['appointment_type'].df.onchange = () => {
            const appointment_type = d.get_value('appointment_type');

            if (!appointment_type) {
                previousAppointmentType = '';
                return;
            }

            if (appointment_type === previousAppointmentType) {
                return;
            }

            previousAppointmentType = appointment_type;

            frappe.call({
                method: 'frappe.client.get_value',
                args: {
                    doctype: 'Appointment Type',
                    filters: { name: appointment_type },
                    fieldname: ['default_duration', 'custom_default_visit_reason']
                },
                callback: function (response) {
                    if (!response.exc && response.message) {
                        const fetchedDuration = parseInt(response.message.default_duration, 10);
                        if (!isNaN(fetchedDuration)) {
                            duration = fetchedDuration;
                            d.set_value('duration', fetchedDuration);
                        }

                        d.set_value('custom_visit_reason', response.message.custom_default_visit_reason);
                    }
                }
            });
        };

        d.fields_dict['duration'].df.onchange = () => {
            const manualDuration = parseInt(d.get_value('duration'), 10);
            if (!isNaN(manualDuration)) {
                duration = manualDuration;
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
                        "duration": duration,
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
                            d.set_value('service_unit', service_unit);
                            appointment_based_on_check_in = $btn.attr('data-day-appointment');
                            const slotDuration = parseInt($btn.attr('data-duration'), 10);
                            if (!isNaN(slotDuration)) {
                                duration = slotDuration;
                                d.set_value('duration', slotDuration);
                            }
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
                    ${slot_info.tele_conf && !slot_info.allow_overlap ? '<i class="fa-regular fa-video fa-1x" aria-hidden="true"></i>' : ''}
                </span><br>
                ${slot_info.service_unit ? `<span><b> ${__('Service Unit: ')} </b> ${slot_info.service_unit}</span>` : ''}`;
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

const practitionerActions = {
    openProfile(resource) {
        if (!resource?.id) {
            frappe.show_alert({ message: __('Unable to determine practitioner'), indicator: 'orange' });
            return;
        }
        frappe.set_route('Form', 'Healthcare Practitioner', resource.id);
    },

    createAvailability(resource) {
        if (!resource?.id) {
            frappe.show_alert({ message: __('Unable to determine practitioner'), indicator: 'orange' });
            return;
        }

        const selectedDate = sessionStorage.selected_date
            ? moment(sessionStorage.selected_date).format('YYYY-MM-DD')
            : frappe.datetime.get_today();

        frappe.new_doc('Practitioner Availability', {}, (doc) => {
            doc.scope_type = 'Healthcare Practitioner';
            doc.scope = resource.id;
            doc.start_date = selectedDate;
            doc.end_date = selectedDate;
        });
    }
};

const enhancedStyles = `
<style>

:root {
    --do-health-month-picker-font-size: 11px;
    --do-health-month-picker-cell-size: 26px;
}

.fc .fc-timegrid-slot {
    height: ${CONFIG.SLOT_HEIGHT || '1rem'};
    min-height: ${CONFIG.SLOT_HEIGHT || '1rem'};
}

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

.appointment-context-menu{
    overflow: unset
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

.appointment-event .appt-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
}
.appointment-event .appt-title {
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.appointment-event .appt-duration {
    font-size: 11px;
    color: rgba(17, 24, 39, 0.7);
}
.appointment-event .appt-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    line-height: 16px;
}
.appointment-event .appt-meta i {
    margin-right: 4px;
    color: rgba(31, 41, 55, 0.75);
}
.appointment-event .appt-finance {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.appointment-event .appt-finance-line {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    line-height: 16px;
    color: rgba(30, 64, 175, 0.85);
}
.appointment-event .appt-finance-line .badge {
    font-size: 10px;
    padding: 2px 6px;
    line-height: 14px;
}
.appointment-event .appt-invoice-ref {
    font-size: 11px;
    color: #475569;
}
.datepicker--buttons{
    flex-wrap: wrap;
}
.datepicker--button{
    flex: 50%;
}
.datepicker-jump-btn {
    color: #4EB5E6;
    cursor: pointer;
    border-radius: 4px;
    display: -ms-inline-flexbox;
    display: inline-flex;
    -ms-flex-pack: center;
    justify-content: center;
    -ms-flex-align: center;
    align-items: center;
    height: 32px;
    flex: 50%;
}
.datepicker-jump-btn:hover {
    color: var(--text-color);
    background-color: var(--fg-hover-color);
}

.appointment-event--tight .appt-meta {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
}

.appointment-event--condensed .appt-note {
    display: none !important;
}
.appointment-event--condensed .appt-invoice-ref {
    display: none !important;
}

.appointment-event--tight .appt-finance {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
}
.appointment-event--tight .appt-finance-line {
    border-radius: 4px;
    padding: 0 6px;
    font-size: 10px;
    line-height: 14px;
}
.appointment-event--tight .appt-invoice-ref {
    display: none !important;
}
.appointment-event--tight .appt-header {
    margin-right: 8px;
    flex-wrap: wrap;
    gap: 4px;
}
.appointment-event--tight .appt-title {
    font-size: 12px;
    max-width: 100%;
}

.appointment-event--tight .appt-header i, .appointment-event--tight .appt-header svg {
    position: absolute;
    right: 42px;
}

.appointment-event--tight .appt-duration {
    font-size: 10px;
    position: absolute;
    right: 5px;
}

#monthdatepicker .datepicker {
    font-size: var(--do-health-month-picker-font-size);
    padding: 0.35rem 0.45rem 0.5rem;
    width: min-content;
    min-width: calc((var(--do-health-month-picker-cell-size) * 7) + 10px);
}

#monthdatepicker .datepicker--nav {
    margin-bottom: 0.15rem;
    padding: 0 0.15rem;
}

#monthdatepicker .datepicker--nav-action,
#monthdatepicker .datepicker--nav-title {
    font-size: calc(var(--do-health-month-picker-font-size) - 1px);
    padding: 0.15rem 0.2rem;
    line-height: 1.2;
}

#monthdatepicker .datepicker--day-name {
    font-size: calc(var(--do-health-month-picker-font-size) - 1px);
    padding: 0.1rem 0;
}

#monthdatepicker .datepicker--cell-day {
    width: var(--do-health-month-picker-cell-size);
    height: calc(var(--do-health-month-picker-cell-size) - 4px);
    line-height: calc(var(--do-health-month-picker-cell-size) - 6px);
    padding: 0;
    font-size: var(--do-health-month-picker-font-size);
}

#monthdatepicker .datepicker--cell-day.-other-month- {
    opacity: 0.4;
}
</style>
`;

// Inject styles
$(document).ready(function () {
    $('head').append(enhancedStyles);
    $('.do-health-secondary-toggle').on('click', () => {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 300);
    });
});

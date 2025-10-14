
frappe.views.calendar["Patient Appointment"] = {

    field_map: {
        "start": "starts_at",
        "end": "ends_at",
        "id": "name",
        "title": "customer",
        "resourceId": "resource",
        "allDay": "allDay",
        "color": "background_color",
        "showcancelled": false,
        "showDoctorsOnly": false
    },
    options: {
        // 		// // themeSystem: 'bootstrap3',
        resources: function (cb) {
            // console.log("step 1: ");
            let filters = [["Healthcare Practitioner", "status", "=", "Active"]];
            // if (frappe.views.calendar["Patient Appointment"].field_map['showDoctorsOnly']) {
            //     filters.push(["Healthcare Practitioner", "is_doctor", "=", 1]);
            // }

            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Healthcare Practitioner',
                    filters: filters,
                    fields: ['name', 'first_name', 'custom_column_order', 'custom_background_color', 'custom_text_color'],
                },
                order_by: 'custom_column_order',
                callback: function (r) {

                    var resources = [];
                    for (var i in r.message) {
                        var provider = {
                            id: r.message[i].name,
                            title: r.message[i].first_name,
                            color: r.message[i].custom_background_color,
                            text_color: r.message[i].custom_text_color,
                            background_color: r.message[i].custom_background_color,
                            order: r.message[i].custom_column_order
                        }
                        resources.push(provider);
                    }
                    cb(resources);
                }
            });

        },

        // adding color to resource
        resourceRender: function (resourceObj, labelTds, bodyTds) {
            labelTds.css('background', resourceObj.background_color);
            labelTds.css('color', resourceObj.text_color);
            var rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([a-z][^\/\0>\x20\t\r\n\f]*)[^>]*)\/>/gi;
            jQuery.htmlPrefilter = function (html) {
                return html.replace(rxhtmlTag, "<$1></$2>");
            };
            // console.log("RR", resourceObj);
        },


        resourceOrder: 'order',
        resourceLabelText: 'Providers',
        resourceAreaWidth: '75px',
        filterResourcesWithEvents: true,
        editable: true,
        droppable: true,
        drop: function (date) {
            $(this).remove();
        },

        // height: $(window).height() - $('.page-head').height() - $('.navbar').height() - 75,
        // contentHeight: $(window).height() - $('.page-head').height() - $('.navbar').height() - 155,
        defaultView: 'agendaDay',
        defaultView: 'timelineDay',
        defaultView: get_session_view(),
        defaultDate: get_session_date(),
        // footer: false,
        allDaySlot: false,
        nowIndicator: true,
        minTime: "08:00:00",
        maxTime: "24:05:00",
        scrollTime: "09:00:00",     // initial scroll posistion

        slotDuration: "00:05:00",
        slotLabelInterval: "00:15:00",
        slotLabelFormat: "h(:mm)a",
        slotEventOverlap: false,
        // slotMinutes: 15,
        nextDayThreshold: "08:00:00",

        dragOpacity: 0.65,
        selectMinDistance: 2,

        header: {
            left: "jumpToNow title",
            center: "",
            // right : "toggleView,month,listDay doctors all cancelled" // agendaDay timelineDay
            right: "Month, doctors all cancelled" // agendaDay timelineDay
        },
        titleFormat: 'dddd Do MMM',

        bootstrapGlyphicons: {
            month: 'glyphicon glyphicon-calendar',
            listDay: 'glyphicon glyphicon-th-list'
        },

        customButtons: {

            all: {
                text: 'All',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].field_map['showDoctorsOnly'] = false;
                    $('.fc').fullCalendar('refetchResources');
                    $('.fc').fullCalendar('option', 'filterResourcesWithEvents', false);
                }
            },
            doctors: {
                text: 'Doctors',
                click: function () {
                    frappe.views.calendar["Patient Appointment"].field_map['showDoctorsOnly'] = true;
                    $('.fc').fullCalendar('refetchResources');
                    $('.fc').fullCalendar('option', 'filterResourcesWithEvents', false);
                }
            },
            cancelled: {
                text: 'Cancelled',

                click: function () {
                    frappe.views.calendar["Patient Appointment"].field_map['showcancelled'] = true;
                    $('.fc').fullCalendar('refetchResources');
                    $('.fc').fullCalendar('option', 'filterResourcesWithEvents', false);
                }
            },
            toggleSide: {
                text: 'sidebar',
                click: function () {
                    $('.layout-side-section').toggleClass("hidden");
                    $('.layout-main-section-wrapper').toggleClass("col-md-12 col-md-10");
                }
            },
            toggleView: {
                bootstrapGlyphicon: 'glyphicon glyphicon-arrow-down',
                click: function () {
                    var view = $('.fc').fullCalendar('getView');
                    if (view.name == 'timelineDay') {
                        $('.fc-toggleView-button > span').removeClass('glyphicon-arrow-down');
                        $('.fc-toggleView-button > span').addClass('glyphicon-arrow-right');
                        $('.fc').fullCalendar('changeView', 'agendaDay');
                    } else {
                        $('.fc-toggleView-button > span').removeClass('glyphicon-arrow-right');
                        $('.fc-toggleView-button > span').addClass('glyphicon-arrow-down');
                        $('.fc').fullCalendar('changeView', 'timelineDay');
                    }
                }
            },
            jumpToNow: {
                text: 'now',
                click: function () {
                    var view = $('.fc').fullCalendar('getView');
                    var isToday = $('.fc').fullCalendar('getDate').format('Y-M-D') == moment().format('Y-M-D');

                    // console.log("Now scroll: view name " + view.name);
                    if (isToday && $('.fc-now-indicator-arrow').length > 0) {

                        if (view.name == 'agendaDay') {
                            // console.log(" AgendaDay ");
                            $('div.fc-scroller').animate({
                                scrollTop: ($('.fc-now-indicator-arrow').position().top - 200)
                            }, 1250);
                        } else if (view.name == 'timelineDay') {
                            // console.log(" timelineDay ");
                            $('div.fc-scroller').animate({
                                scrollLeft: ($('.fc-now-indicator-arrow').position().left - 300)
                            }, 1250);
                            // console.log("timelineDay ");
                        }
                        sessionStorage.selected_date = moment();
                    } else {
                        // console.log(" timelineDay (ELSE) ");
                        var sd = view.intervalStart;
                        var dp = $('#monthdatepicker').find(`[data-date="${sd.date()}"][data-month="${sd.month()}"][data-year="${sd.year()}"]`);
                        if (dp.hasClass('-selected-')) {
                            dp.removeClass('-selected-')
                        }
                        sessionStorage.selected_date = moment();
                        $('.fc').fullCalendar('gotoDate', moment());
                    }
                }
            }    // jumpToNow
        },              // button



        // create appointment by draging the mouse
        select: function (startDate, endDate, jsEvent, view, resource) {
            set_current_session(view);
            // console.log("step 2: ");

            if (view.name === "month" && (endDate - startDate) === 86400000) {
                // detect single day click in month view
                return;
            }
            var event = frappe.model.get_new_doc("Patient Appointment");
            if (sessionStorage.selected_appt && sessionStorage.selected_appt != '') {
                var appt = JSON.parse(sessionStorage.selected_appt);
                if (appt.name) {
                    event.customer = appt.customer;
                    event.note = (appt.note ? `${appt.note}\n` : '') + `(REBOOKED from ${moment(appt.date).format('D MMM')})`;
                } else if (appt.customer) {
                    event.customer = appt.customer;
                }
            }

            // loay: set values for Patient Appointment before calling the form
            event.appointment_date = startDate.format("YYYY-MM-DD");    //startDate.format("YYYY-MM-DD") = "2023-01-08"
            var starttime_local = startDate.format("HH:mm:SS");         // startDate.format("HH:mm:SS") = "08:45:00"
            var endtime_local = endDate.format("HH:mm:SS");             // startDate.format("HH:mm:SS") = "09:15:00"
            var EndTime = endtime_local.split(":");
            var StartTime = starttime_local.split(":");
            var hour = (EndTime[0] - StartTime[0]) * 60;
            var min = (EndTime[1] - StartTime[1]) + hour;
            // event.start_time = starttime_local;
            // event.arrival_time = "";
            // event.in_room_time  = "";
            // event.walked_out_time ="";
            // event.done_time  ="";
            // console.log("start time : "  + starttime_local);
            event.appointment_time = starttime_local;
            event.appointment_timeo = starttime_local
            event.duration = min
            event.practitioner = resource ? resource.id : '';

            // TODO: patient appointment dialog
            check_and_set_availability(event, true);

            // frappe.set_route('Form', 'Patient Appointment', event.name);      // loay change: direct call to Patient Appointment
        },

        eventClick: function (event, jsEvent, view) {
            // console.log("step 3: ");
            set_current_session(view);
            // $(this).popover('show');

            // frappe.set_route('Form', 'Appointment', event.name);
            // frappe.set_route('Form', 'Patient Appointment', event.name);      // loay change: direct call to Patient Appointment

            // TODO: patient appointment dialog
            check_and_set_availability(event);
        },

        // update event record 
        eventDrop: function (event, delta, revertFunc, jsEvent, ui, view) {
            // console.log("step 4: ");
            frappe.confirm(
                `1 Move <strong>${event.title}</strong>
                appointment to <strong>${event.resourceId}</strong>
                at <strong>${event.start.format('h:mm a')}</strong>?`,
                function () {
                    update_event();
                },
                function () {
                    revertFunc();
                }
            );
            function update_event() {
                var starttime_local = event.start.format("H:mm:ss");
                var endtime_local = event.end.format("H:mm:ss")
                var EndTime = endtime_local.split(":");
                var StartTime = starttime_local.split(":");
                var hour = (EndTime[0] - StartTime[0]) * 60;
                var min = (EndTime[1] - StartTime[1]) + hour;
                frappe.call({
                    method: 'frappe.client.set_value',
                    args: {
                        doctype: 'Patient Appointment',
                        name: event.name,
                        fieldname: {
                            appointment_date: event.start.format("YYYY-MM-DD"),
                            appointment_time: starttime_local,
                            duration: min,
                            practitioner: event.resourceId
                        }
                    },
                    callback: function (r) {
                        cur_list.refresh(true);
                    }
                });
            }
        },
        eventResize: function (event, delta, revertFunc, jsEvent, ui, view) {
            // console.log("step 5: ");
            frappe.confirm(
                `Confirm <strong>${event.title}</strong> appointment
                will start from <strong>${event.start.format('h:mm a')}</strong>
                to <strong>${event.end.format('h:mm a')}</strong>?`,
                function () {
                    update_event();
                },
                function () {
                    revertFunc();
                }
            );
            function update_event() {
                var starttime_local = event.start.format("H:mm:ss");
                var endtime_local = event.end.format("H:mm:ss")
                var EndTime = endtime_local.split(":");
                var StartTime = starttime_local.split(":");
                var hour = (EndTime[0] - StartTime[0]) * 60;
                var min = (EndTime[1] - StartTime[1]) + hour;
                frappe.call({
                    method: 'frappe.client.set_value',
                    args: {
                        doctype: 'Patient Appointment',
                        name: event.name,
                        fieldname: {
                            appointment_date: event.start.format("YYYY-MM-DD"),
                            start_time: starttime_local,
                            duration: min,
                        }
                    },
                    callback: function (r) {
                        cur_list.refresh(true);
                    }
                });
            }
        },

        eventRender: function (event, element, view) {
            // console.log("step 6: ");
            $(element).find('.fc-content').attr('style', `color: ${event.text_color} !important;`);
            $(element).css(`background-color`, `${event.background_color} !important;`);

            if (event.status == 'Completed') {
                // $(element).find('.fc-content').attr('style', 'color: #014000 !important;'); // color green for done
                $(element).find('.fc-content').attr('style', 'color: #177245 !important;');
                $(element).css('background', '#04d900');
            } else if (event.status == 'No Show' || event.status == 'Cancelled') {
                // $(element).find('.fc-content').attr('style', 'color: #000000 !important;');
                // $(element).css('backgroundColor', '#8f8f8f');
                // if (event.resourceId != 'Dr Sadiq') {
                //     $(element).addClass('crossed');
                // } else {
                $(element).addClass('crossed-white');
                // }
            }


            // detailed appointment duration and starttime adn endtime
            var duration = SEhumanizer(moment.duration(event.end - event.start), { units: ['h', 'm', 's'], largest: 2, round: true });
            element.find('.fc-time span').prepend(`${duration} ▶ `);
            //  console.log("Step 7: " + duration);
            //  console.log(" vent " + event.name);
            if (event.name) {
                element.find('.fc-title').css('font-weight', 'bold');
                element.find('.fc-title').text(event.full_name.split(' ')[0] + ' ' + event.full_name.trim().split(' ').splice(-1));
                // + (isNaN(event.full_name.split(' ').splice(-1)) ? event.full_name.split(' ').splice(-1) : event.full_name.split(' ').splice(-3)[0]));

                var details = `<div class="event-details" data-appt="${event.name}">
                                ${event.procedure_name ? event.procedure_name : ''}
                                ${event.note ? event.note : ''}
                                <br/>
                                </div>`;
                element.find('.fc-title').after(details);

                var status = `<div class="appt-status">
                                     <span class="
                                     ${view.name == 'agendaDay' ? 'agenda-day' : ''}
                                     ${event.status == 'Completed' ? 'hidden' : ''}"></span>
                                     ${event.status}
                                     <span style="${event.status != 'Arrived' ? 'display: none;' : ''}">
                                         <span class="arrival_timers">${moment(event.arrival_time, "HH:mm:ss").fromNow()}</span>
                                     </span>
                                </div>`;
                element.find('.event-details').after(status);
                element.bind('mousedown', function (e) {
                    if (e.which === 3) {
                        e.preventDefault();

                        frappe.call({
                            method: 'frappe.client.get',
                            args: {
                                doctype: 'Patient Appointment',
                                filters: {
                                    name: event.name,
                                },
                                fields: ['patient']
                            },
                            callback: function (r) {
                                if (r.message) {
                                    const patient = r.message.patient;

                                    // Remove any existing menu
                                    $('#custom-menu').remove();

                                    // Create the menu
                                    const menuHtml = `
                                        <ul id="custom-menu" class="dropdown-menu show" style="position: absolute; z-index: 1050;">
                                            <li class="dropdown-item" href="#">View Patient</li>
                                            <li class="dropdown-item" href="#">Edit Appointment</li>
                                            <li class="dropdown-item" href="#">Cancel Appointment</li>
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
                                        if (action === 'View Patient') {
                                            frappe.msgprint(`Patient: ${patient}`);
                                        } else if (action === 'Edit Appointment') {
                                            frappe.set_route('Form', 'Patient Appointment', event.name);
                                        } else if (action === 'Cancel Appointment') {
                                            frappe.confirm('Are you sure you want to cancel this appointment?', () => {
                                                frappe.msgprint('Appointment canceled');
                                            });
                                        }

                                        // Remove the menu after selection
                                        $('#custom-menu').remove();
                                    });

                                    // Remove the menu if clicked outside
                                    $(document).on('click', function () {
                                        $('#custom-menu').remove();
                                    });
                                }
                            }
                        });
                    }
                });
            }
        },
        // 		// 		///

        // --- on mouse hover popup windows to view appointment detail
        eventAfterRender: function (event, element, view) {
            // console.log("step 8: ");
            var created_by = '';
            var modified_by = '';
            if (frappe.user.full_name(event.owner).startsWith('Dr')) {
                created_by = `Dr ${frappe.user.full_name(event.owner).split(' ')[1]}`
            } else {
                created_by = `${frappe.user.full_name(event.owner).split(' ')[0]}`
            }
            if (frappe.user.full_name(event.modified_by).startsWith('Dr')) {
                modified_by = `Dr ${frappe.user.full_name(event.modified_by).split(' ')[1]}`
            } else {
                modified_by = `${frappe.user.full_name(event.modified_by).split(' ')[0]}`
            }
            element.append(`
                <div id="popoverX-${event.name}" class="popover popover-x popover-default popover-md">
                    <div class="arrow"></div>
                    <div style="background-color: #D9D9D9;opacity: 0.9;" class="popover-header popover-content " style="font-weight: bold;">
                        ${event.full_name} <small class=""><br/>
                        <span class="${event.birthdate ? "" : "hidden"}">Age: ${moment().diff(event.birthdate, 'years')} | </span>
                        <span class="${event.file_number ? "" : "hidden"}">File: ${event.file_number} | </span>
                        <span class="${event.cpr ? "" : "hidden"}"> CPR: ${event.cpr} | </span>${event.mobile}</small>
                    </div>
                    <div style="background-color: #F2F2F2" class="popover-body popover-content">
                    <div style="background-color: #F2F2F2" class="row">
                        <div class="col-md-5 ${event.image ? "" : "hidden"}">`
                + (event.image ?
                    `<img class="img-thumbnail img-responsive" src="${event.image}">` : ``)
                + `</div><div class="col-md-7" style="${event.image ? "padding-left: 0px;" : ""}">`
                + (event.procedure_name ? `${event.procedure_name}<br/>` : ``)
                + (event.note ? `${event.note}<br/>` : ``)
                + (event.room ? `${event.room}<br/>` : ``)
                + `<small> <div class="label label-warning">`
                + (event.status ? `${event.status}<br/>` : ``)
                + `</div></small>`
                + `</div></div>` +
                `</div>
                    <div style="background-color: #D9D9D9;opacity: 0.9;" class="popover-footer">
                        <div class="small text-left">
                            <span> Created by: ${created_by}</span>
                            <span> on ${moment(event.creation).format('Do MMM')}</span>
                            <div class="${event.modified_by != event.owner ? "" : "hidden"}">
                                <span>Modified by: ${modified_by}</span>
                                <span> on ${moment(event.modified).format('Do MMM')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `);

            element.popoverButton({
                trigger: 'hover focus',
                target: `#popoverX-${event.name}`,
                placement: 'horizontal'
            });

            element.draggable({
                revert: true,
                revertDuration: 200
            });
        },

        eventMouseover: function (event, jsEvent, view) {
            if (event.name) {
                $(this).popover("show");
                $(`#popoverX-${event.name}`).popoverX('show');
            }
        },

        eventMouseout: function (event, jsEvent, view) {
            $(this).popover("hide");
            $(`#popoverX-${event.name}`).popoverX('hide');
        },

        viewRender: function (view, element) {
            update_waiting_list();

            var currentWidth = $("div.page-wrapper").width();

            $('.fc').fullCalendar('gotoDate', sessionStorage.selected_date);
            if ($(window).width() >= 992) {
                // $('.page-content .row.layout-main .layout-main-section-wrapper').attr('style','position: fixed; right: 0px;');
                // console.log ("471");
            }
            $('.list-unstyled.sidebar-menu.sidebar-stat, .list-tag-preview').hide();
            $('.footnote-area, .list-paging-area').hide();
            $('.fc:not(".fc-event")').on('contextmenu', function (e) {
                e.preventDefault()
            });

            var isToday = $('.fc').fullCalendar('getDate').format('Y-M-D') == moment().format('Y-M-D');
            if (view.name == 'agendaDay') {
                $('tr[data-time]:not(.fc-minor)').each(function (i, e) {
                    var time = $(e).data().time;
                    if (time.split(':')[1] == '00') {
                        $(e).css('font-weight', 'bold');
                    } else {
                        $(e).find('.fc-time > span').text(':' + time.split(':')[1]);
                    }

                });
                if ((sessionStorage.just_logged_in == 1) && isToday && ($('.fc-now-indicator-arrow').length > 0)) {
                    $('div.fc-scroller').animate({
                        scrollTop: ($('.fc-now-indicator-arrow').position().top - 200)
                    }, 25);
                    sessionStorage.just_logged_in = 0;
                } else if ((moment(sessionStorage.selected_date).hour() > 0)) {
                    var time_point = `[data-time="${moment(sessionStorage.selected_date).format('HH')}:00:00"]`;
                    $('div.fc-scroller').animate({
                        scrollTop: ($(time_point).position().top - 200)
                    }, 25);
                } else if ((sessionStorage.server_update == 0) && isToday && ($('.fc-now-indicator-arrow').length > 0)) {
                    $('div.fc-scroller').animate({
                        scrollTop: ($('.fc-now-indicator-arrow').position().top - 200)
                    }, 25);
                }


            } else if (view.name == 'timelineDay') {
                if ((sessionStorage.server_update == 0) && isToday && $('.fc-now-indicator-arrow').length > 0) {
                    $('div.fc-scroller').animate({
                        scrollLeft: ($('.fc-now-indicator-arrow').position().left - 300)
                    }, 25);
                }
            }

            $('.fc-left h2').html(function (i, s) {
                return s.replace(/(\d)(st|nd|rd|th)/g, '$1<sup>$2</sup>');
            });

            update_waiting_list();
            sessionStorage.server_update = 0;
        },

        viewDestroy: function (view, element) {
            //   console.log("step 12: ");
            //    // $('.page-content .row.layout-main .layout-main-section-wrapper').attr('style','');
            //       $('.list-unstyled.sidebar-menu.sidebar-stat, .list-tag-preview').show();
            //             // $('.footnote-area, .list-paging-area').show();
        },
        eventAfterAllRender: function (view) {
            // console.log("step 13: ");
            // update_waiting_list();
            frappe.realtime.on('waiting_list', (data) => {
                $('.fc').fullCalendar('rerenderEvents');
                render_waiting_list_table(data);
            });

            var sd = view.intervalStart;    // first date of the month
            var dp = $('#monthdatepicker').find(`[data-date="${sd.date()}"][data-month="${sd.month()}"]
            
            [data-year="${sd.year()}"]`);
            if (!dp.hasClass('-selected-')) {
                dp.addClass('-selected-')
            }
        },

        schedulerLicenseKey: 'CC-Attribution-NonCommercial-NoDerivatives'

    },

    get_events_method: "do_health.api.methods.get_events_full_calendar"

};


function set_current_session(view) {
    sessionStorage.selected_date = view.intervalStart.format();
    sessionStorage.selected_view = view.name;
    // console.log('Setting: ' , sessionStorage.selected_view, sessionStorage.selected_date);
}
function get_session_view() {
    // console.log('Getting session view: ', sessionStorage.selected_view);
    return sessionStorage.selected_view || 'agendaDay';
}
function get_session_date() {
    // console.log('Getting session date: ', sessionStorage.selected_date);
    // return sessionStorage.selected_date || null;
    return sessionStorage.selected_date || moment();
}

function update_waiting_list() {
    frappe.call({
        method: 'do_health.api.methods.get_waiting_list',
        callback: function (r) {
            render_waiting_list_table(r.message);
        }
    });

}

function render_waiting_list_table(data) {
    if ($('#monthdatepicker').length == 0) {
        sessionStorage.server_update = 0;

        $("div.col-lg-2.layout-side-section .list-sidebar").prepend(function () {
            // return $('<div id="monthdatepicker" style="width: 210px"></div>').datepicker({
            return $('<div id="monthdatepicker"></div>').datepicker({
                language: 'en',
                todayButton: new Date(),
                onSelect: function (d, i) {
                    if (i && d !== i.lastVal) {
                        sessionStorage.selected_date = moment(i).format();
                        console.log($('.fc'))
                        $('.fc').fullCalendar('gotoDate', i);
                    }
                },
            });

        });

        // $('#mycss').css('background-color','#FFFFFF').css('padding','10px');
        $("div.col-lg-2.layout-side-section").css('max-width', '25%');      // increase the wating list width
        $("div.col-lg-2.layout-side-section").css('padding', '1px');
        $("div.monthdatepicker").css("width: 300px");
        // wating list
        console.log($("#monthdatepicker"))
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

frappe.realtime.on("appointment_update", function (data) {
    // console.log(data, 'CLIENT: ' + data.event + ' updated on server');
    // console.log("realtime update ");
    var current_route = frappe.get_route();
    if (current_route[1] == 'Patient Appointment' && current_route[2] == 'Calendar') {
        setTimeout(function () {
            sessionStorage.server_update = 1;
            $('.fc').fullCalendar('refetchEvents');
            frappe.utils.play_sound('click');
        }, 250);
    }
});

frappe.realtime.on("appointment_delete", function (data) {
    // console.log(data, 'CLIENT: ' + data.event + ' deleted on server');
    // console.log("realtime delete ")
    var current_route = frappe.get_route();
    if (current_route[1] == 'Patient Appointment' && current_route[2] == 'Calendar') {
        setTimeout(function () {
            sessionStorage.server_update = 1;
            $('.fc').fullCalendar('refetchEvents');
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
    if (!is_new) {
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
                    event = r.message;
                }
            }
        });
    }

    let selected_slot = event.appointment_time;
    let service_unit = null;
    let duration = event.duration;
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
                { fieldtype: 'Link', options: 'Patient', reqd: 1, fieldname: 'patient', label: 'Patient' },
                { fieldtype: 'Data', fieldname: 'patient_name', label: 'Patient Name', read_only: 1 },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Data', fieldname: 'patient_cpr', label: 'CPR', read_only: 1 },
                { fieldtype: 'Data', fieldname: 'patient_mobile', label: 'Mobile', read_only: 1 },
                { fieldtype: 'Section Break' },
                { fieldtype: 'Select', options: 'First Time\nFollow Up\nProcedure\nSession', reqd: 1, fieldname: 'appointment_category', label: 'Appointment Category' },
                { fieldtype: 'Link', fieldname: 'appointment_type', options: 'Appointment Type', label: 'Appointment Type' },
                { fieldtype: 'Data', fieldname: 'appointment_for', label: 'Appointment For', hidden: 1, default: 'Practitioner' },
                { fieldtype: 'Int', fieldname: 'duration', label: 'Duration', default: duration },
                { fieldtype: 'Check', fieldname: 'confirmed', label: 'Confirmed?' },
                { fieldtype: 'Column Break' },
                { fieldtype: 'Link', fieldname: 'branch', options: 'Branch', label: 'Branch' },
                { fieldtype: 'Small Text', fieldname: 'notes', label: 'Notes' },
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
                    'appointment_time': selected_slot,
                    'service_unit': service_unit,
                }

                let method = (is_new ? 'frappe.client.insert' : 'frappe.client.update');

                frappe.call({
                    method: method,
                    freeze: true,
                    freeze_message: __('Booking Appointment...'),
                    args: {
                        doc: {
                            'doctype': 'Patient Appointment',
                            'patient': data.patient,
                            'appointment_category': data.custom_appointment_category,
                            'appointment_type': data.appointment_type,
                            'appointment_for': data.appointment_for,
                            'duration': data.duration,
                            'confirmed': data.custom_confirmed,
                            'branch': data.custom_branch,
                            'notes': data.notes,
                            'practitioner': data.practitioner,
                            'appointment_date': data.appointment_date,
                            'appointment_time': data.appointment_time,
                            'service_unit': data.service_unit,
                        }
                    },
                    callback: function (r) {
                        if (!r.exc) {
                            d.hide();
                            frappe.show_alert({
                                message: __('Appointment booked successfully'),
                                indicator: 'green'
                            });
                            $('.fc').fullCalendar('refetchResources');
                            $('.fc').fullCalendar('option', 'filterResourcesWithEvents', false);
                            // jumb to the new appointment time
                            scrollToTime(r.message.appointment_time);
                        }
                    }
                })

                d.get_primary_btn().attr('disabled', true);
            }
        });

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
                        d.set_value('patient_name', response.message.patient_name);
                        d.set_value('patient_cpr', response.message.custom_cpr);
                        d.set_value('patient_mobile', response.message.mobile);
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
                method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.get_availability_data',
                args: {
                    practitioner: d.get_value('practitioner'),
                    date: d.get_value('appointment_date'),
                    appointment: {
                        "docstatus": 0,
                        "doctype": "Patient Appointment",
                        "name": event.name,
                    }
                },
                callback: (r) => {
                    let data = r.message;
                    if (data.slot_details.length > 0) {
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
                                    overlap_appointments ?
                                        d.footer.prepend(
                                            `<div class="opt-out-conf-div ellipsis text-muted" style="vertical-align:text-bottom;">
												<label>
													<span class="label-area">
													${__("Video Conferencing disabled for group consultations")}
													</span>
												</label>
											</div>`
                                        )
                                        :
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
                            } else {
                                d.$wrapper.find(".opt-out-conf-div").hide();
                            }

                            // enable primary action 'Book'
                            d.get_primary_btn().attr('disabled', null);
                        });

                    } else {
                        //	fd.available_slots.html('Please select a valid date.'.bold())
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
                let booked_moment = ""
                if ((now.format("YYYY-MM-DD") == appointment_date) && (slot_start_time.isBefore(now) && !slot.maximum_appointments)) {
                    disabled = true;
                } else {
                    // iterate in all booked appointments, update the start time and duration
                    slot_info.appointments.forEach((booked) => {
                        booked_moment = moment(booked.appointment_time, 'HH:mm:ss');
                        let end_time = booked_moment.clone().add(booked.duration, 'minutes');

                        // to get apointment count for all day appointments
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
                            `<br><span class='badge ${count_class}'>${count} </span>` : ''}</button>`
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
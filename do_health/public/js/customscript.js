$(window).on('hashchange', page_changed);
$(window).on('load', page_changed);

function page_changed(event) {
    try {
        // console.log($(window).width())

        const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if ($(window).width() > 575 && !isMobile()) {
            add_calendar_btn();
        } else {
            document.querySelector('#calendar-btn').remove()
            document.querySelector('#patient-btn').remove()
        }
        // add_cardreader_btn();
    }
    catch { }
}

function add_calendar_btn() {
    // console.log("customscript test 3")
    if (!document.querySelector('#calendar-btn')) {

        // $('.form-inline').prepend(`<div class="input-group text-muted">     <button id="calendar-btn" class="btn btn-secondary btn-default btn-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path fill-rule="evenodd" d="M4.75 0a.75.75 0 01.75.75V2h5V.75a.75.75 0 011.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0113.25 16H2.75A1.75 1.75 0 011 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 014.75 0zm0 3.5h8.5a.25.25 0 01.25.25V6h-11V3.75a.25.25 0 01.25-.25h2zm-2.25 4v6.75c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25V7.5h-11z"></path></svg></button></div>`);

        $('.form-inline').prepend(`<div class="input-group text-muted">     <button id="calendar-btn" class="btn btn-secondary btn-default btn-sm"><svg class="icon  icon-sm" style="">
        <use class="" href="#icon-calendar"></use>
        </svg></button></div>`);
        $('#calendar-btn').on('click', function () {
            frappe.set_route('List', 'Patient Appointment', 'calendar', 'default');
        });
    }

    if (!document.querySelector('#patient-btn')) {

        $('.form-inline').prepend(`<div class="input-group text-muted">     <button id="patient-btn" class="btn btn-secondary btn-default btn-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path fill-rule="evenodd" d="M5.5 3.5a2 2 0 100 4 2 2 0 000-4zM2 5.5a3.5 3.5 0 115.898 2.549 5.507 5.507 0 013.034 4.084.75.75 0 11-1.482.235 4.001 4.001 0 00-7.9 0 .75.75 0 01-1.482-.236A5.507 5.507 0 013.102 8.05 3.49 3.49 0 012 5.5zM11 4a.75.75 0 100 1.5 1.5 1.5 0 01.666 2.844.75.75 0 00-.416.672v.352a.75.75 0 00.574.73c1.2.289 2.162 1.2 2.522 2.372a.75.75 0 101.434-.44 5.01 5.01 0 00-2.56-3.012A3 3 0 0011 4z"></path></svg></button></div>`);
        $('#patient-btn').on('click', function () {
            frappe.set_route('List', 'Patient');
        });
    }
}

function add_cardreader_btn() {
    // console.log("called")
    if (!document.querySelector('#cardreader-btn')) {
        // console.log("called 2")
        var btn = $(`<btn id="cardreader-btn" class="navbar-brand btn"
                style="margin-left: 0px;float: right;padding-left: 0px;padding-right: 0px;">
                <span class="glyphicon glyphicon-credit-card"></span>
                </btn>`);
        // console.log($('#search-modal'))
        $('#search-modal').after(btn);
        // console.log("called 3")
        $('#cardreader-btn').on('click', function () {
            frappe.set_route("List", "Change Card Reader", { "user": frappe.session.user });
        });
    }
}

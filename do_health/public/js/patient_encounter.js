frappe.ui.form.on('Patient Encounter', {
	refresh: function (frm) {
		// Remove existing elements if any
		$('.offcanvas-wrapper').remove();
		if (frm.doc.patient) {
			createSideTabs(frm);
		}
	},
	patient: function (frm) {
		// Remove existing elements if any
		$('.offcanvas-wrapper').remove();
		if (frm.doc.patient) {
			createSideTabs(frm);
		}
	},

});

function createSideTabs(frm) {
	$(`
			<div class="offcanvas-wrapper">
				<div class="vertical-tabs-container">
					<!-- Tabs will be added here -->
				</div>
				<div class="custom-offcanvas">
					<div class="offcanvas-overlay"></div>
					<div class="offcanvas-sidebar">
						<div class="offcanvas-header">
							<h5 class="offcanvas-title"></h5>
							<button type="button" class="btn-edit btn btn-default icon-btn" 
							data-action="Edit"
							>Edit
							</button>
							<button type="button" class="btn-close">
								<i class="fa fa-times"></i>
							</button>
						</div>
						<div class="offcanvas-body"></div>
						<div class="offcanvas-footer"></div>
					</div>
				</div>
			</div>
		`).appendTo($(frm.$wrapper));

	frm.call('get_side_tab_data')
		.then(r => {
			const settings = r.message.settings
			// Add tabs
			const tabs = [
				...(settings.show_vital_signs ? [{
					label: 'Vital Signs',
					content: () => get_vitals_content(frm, r.message),
					icon: 'fa fa-heartbeat',
					// editor: encodeURIComponent(settings.vital_signs_editor)
				}] : []),
				...(settings.show_patient_history ? [{
					label: 'Patient History',
					content: () => get_history_content(frm),
					icon: 'fa fa-history',
					// editor: encodeURIComponent(settings.patietn_history_editor)
				}] : []),
				...(settings.show_dental_charts ? [{
					label: 'Dental Chart',
					content: () => get_dental_chart_content(frm, r.message),
					svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free v6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M186.1 52.1C169.3 39.1 148.7 32 127.5 32C74.7 32 32 74.7 32 127.5l0 6.2c0 15.8 3.7 31.3 10.7 45.5l23.5 47.1c4.5 8.9 7.6 18.4 9.4 28.2l36.7 205.8c2 11.2 11.6 19.4 22.9 19.8s21.4-7.4 24-18.4l28.9-121.3C192.2 323.7 207 312 224 312s31.8 11.7 35.8 28.3l28.9 121.3c2.6 11.1 12.7 18.8 24 18.4s20.9-8.6 22.9-19.8l36.7-205.8c1.8-9.8 4.9-19.3 9.4-28.2l23.5-47.1c7.1-14.1 10.7-29.7 10.7-45.5l0-2.1c0-55-44.6-99.6-99.6-99.6c-24.1 0-47.4 8.8-65.6 24.6l-3.2 2.8 19.5 15.2c7 5.4 8.2 15.5 2.8 22.5s-15.5 8.2-22.5 2.8l-24.4-19-37-28.8z"/></svg>',
				}] : []),
			];

			tabs.forEach(tab => {
				$(`
					<button class="vertical-tab" data-tab="${tab.label}">
						${tab.icon ? `<i class="${tab.icon}"></i>` : tab.svg}
						<span>${tab.label}</span>
					</button>
				`).appendTo('.vertical-tabs-container').click(() => {
					if (tab.label === 'Vital Signs' && r.message.vital_signs_layout.length === 0) {
						$('.btn-edit').text('Add');
					}
					else {
						$('.btn-edit').text('Edit');
					}
					show_offcanvas(tab.label, tab.content());
				});
			});

		})

	// Close button event
	$(document).on('click', '.btn-close, .offcanvas-overlay', () => {
		hide_offcanvas();
	});

	// Close with ESC key
	$(document).on('keydown', (e) => {
		if (e.key === 'Escape') {
			hide_offcanvas();
		}
	});

	$(document).on('click', '.btn-edit', function (e) {
		e.preventDefault();
		// const actionCode = decodeURIComponent($(this).data('code'));
		// const rowData = JSON.parse(decodeURIComponent($(this).data('row')));

		try {
			if ($(this).siblings('.offcanvas-title').text() === 'Vital Signs') {
				// Create a function from the code string
				const func = new Function('doc', settings.vital_signs_editor);
				// Execute the function
				func(frm.doc);
			}
			else if ($(this).siblings('.offcanvas-title').text() === 'Patient History') {
				// Create a function from the code string
				const func = new Function('doc', settings.patient_history_editor);
				// Execute the function
				func(frm.doc);
			}
		} catch (error) {
			console.error('Error executing action code:', error);
			frappe.msgprint(__('Error executing action: ') + error.message);
		}
	});
}

function show_offcanvas(title, content) {
	// Pre-render content before showing to prevent layout shifts
	$('.offcanvas-title').text(title);
	$('.btn-edit').attr('data-tab', title);

	// Force reflow before adding show class
	document.body.clientWidth;
	if (title === 'Dental Chart') {
		$('.offcanvas-wrapper').addClass('full');
		$('.btn-edit').hide();
	}
	else {
		$('.offcanvas-body').html(content);
		$('.offcanvas-wrapper').removeClass('full');
		$('.btn-edit').show();
	}

	$('.offcanvas-wrapper').addClass('show');
	$('body').addClass('offcanvas-open');

	// Add active class with slight delay for smoother transition
	setTimeout(() => {
		$(`.vertical-tab[data-tab="${title}"]`).addClass('active')
			.siblings().removeClass('active');
	}, 50);
}

function hide_offcanvas() {
	$('.offcanvas-wrapper').removeClass('show');
	$('body').removeClass('offcanvas-open');

	// Delay removing active class until transition completes
	setTimeout(() => {
		$('.vertical-tab').removeClass('active');
	}, 300);
}

function get_vitals_content(frm, message) {
	let vitals_html = '';
	if (message.vital_signs_layout.length === 0) {
		return `
			<div class="p-3">
				<h3>No vital signs recorded</h3>
				<h5 class="text-muted">Click 'Add' to record vital signs.</h5>
			</div>
		`;
	}
	message.vital_signs_layout.forEach((field, index) => {
		if (field.style === 'Card') {
			if (index === 0 || vitals.layout[index - 1].style !== 'Card') {
				vitals_html += `<div class="vitals-grid mt-3">`;
			}
			vitals_html += render_vital(field.label, field.value, '')
		}
		else {
			if (index > 0 && vitals.layout[index - 1].style === 'Card') {
				vitals_html += `</div>`;
			}
			vitals_html += `
				<div class="mt-3">
					<h6>Notes</h6>
					<div class="vitals-notes">${field.value || 'No notes recorded'}</div>
				</div>
			`
		}
	})
	return vitals_html;
}

function render_vital(label, value, unit) {
	return `
		<div class="vital-item mb-3 text-center">
			<label class="form-label">${label}</label>
			<div class="vital-value">
				${value ? `<span class="bold">${value} ${unit}</span>` : '<span class="text-muted">Not recorded</span>'}
			</div>
		</div>
	`;
}

function get_history_content(frm) {
	return `
		<div class="scroll-panel" style="width: 100%;">
			<!-- Allergies Section -->
			<div class="card p-0" id="allergies" style="background-color: #e1f5fe; border-color: #03a9f4;">
				<div class="card-header">
				<h5 class="card-title mb-0">Allergies <span id="allergies-count"></span></h5>
				</div>
				<div class="card-body">
				<div id="no-allergies">
					<div class="empty-state">
					<h6>No Allergies</h6>
					</div>
				</div>
				<div id="allergies-list" class="d-none">
					<!-- Allergies items will be added here by JavaScript -->
				</div>
				</div>
			</div>

			<!-- Medical History Section -->
			<div class="card p-0 mt-4" id="infected-diseases" style="background-color: #e8f5e9; border-color: #4caf50;">
				<div class="card-header">
				<h5 class="card-title mb-0">Medical History</h5>
				</div>
				<div class="card-body">
				<div id="no-medical-history">
					<div class="empty-state">
					<h6>No Medical History</h6>
					</div>
				</div>
				<div id="medical-history-list" class="d-none">
					<!-- Medical history items will be added here by JavaScript -->
				</div>
				</div>
			</div>

			<!-- Surgical History Section -->
			<div class="card p-0 mt-4" id="surgical-history" style="background-color: #f3e5f5; border-color: #9c27b0;">
				<div class="card-header">
				<h5 class="card-title mb-0">Surgical History<a class="fs-6 float-end d-none" id="see-all-surgical">See All</a></h5>
				</div>
				<div class="card-body">
				<div id="no-surgical-history">
					<div class="empty-state">
					<h6>No Surgical History</h6>
					</div>
				</div>
				<div id="surgical-history-list" class="d-none">
					<!-- Surgical history items will be added here by JavaScript -->
				</div>
				</div>
			</div>

			<!-- Medications Section -->
			<div class="card p-0 mt-4" id="medications" style="background-color: #fce4ec; border-color: #e91e63;">
				<div class="card-header">
				<h5 class="card-title mb-0">Medications (<span id="medications-count">0</span>)</h5>
				</div>
				<div class="card-body">
				<div id="no-medications">
					<div class="empty-state">
					<h6>No Medications</h6>
					</div>
				</div>
				<div id="medications-list" class="d-none">
					<!-- Medication items will be added here by JavaScript -->
				</div>
				</div>
			</div>

			<!-- Habits/Social Section -->
			<div class="card p-0 mt-4" id="habits" style="background-color: #e0f2f1; border-color: #009688;">
				<div class="card-header">
				<h5 class="card-title mb-0">Habits / Social</h5>
				</div>
				<div class="card-body">
				<div id="no-habits">
					<div class="empty-state">
					<h6>No Habits / Social</h6>
					</div>
				</div>
				<div id="habits-list" class="d-none">
					<!-- Habit items will be added here by JavaScript -->
				</div>
				</div>
			</div>

			<!-- Family History Section -->
			<div class="card p-0 mt-4" id="family-history" style="background-color: #efebe9; border-color: #795548;">
				<div class="card-header">
				<h5 class="card-title mb-0">Family History</h5>
				</div>
				<div class="card-body">
				<div id="no-family-history">
					<div class="empty-state">
					<h6>No Family History</h6>
					</div>
				</div>
				<div id="family-history-list" class="d-none">
					<!-- Family history items will be added here by JavaScript -->
				</div>
				</div>
			</div>

			<!-- Risk Factors Section -->
			<div class="card p-0 mt-4" id="risk-factors" style="background-color: #fbe9e7; border-color: #ff5722;">
				<div class="card-header">
				<h5 class="card-title mb-0">Risk Factors</h5>
				</div>
				<div class="card-body">
				<div id="no-risk-factors">
					<div class="empty-state">
					<h6>No Risk Factors</h6>
					</div>
				</div>
				<div id="risk-factors-list" class="d-none">
					<!-- Risk factor items will be added here by JavaScript -->
				</div>
				</div>
			</div>
		</div>
	`;
}

function get_dental_chart_content(frm, message) {
	$('.offcanvas-body').html('');
	console.log(message)

	// Initialize dental chart
	frappe.require([
		'/assets/do_dental/js/dental_chart.js',
		'/assets/do_dental/css/dental_chart.css'
	], () => {
		// Verify container exists
		const $container = $('.offcanvas-body');
		if (!$container || !$container.length) {
			frappe.msgprint(__('Failed to find chart container'));
			return;
		}
		let actualChart = null;
		if (message.dental_charts.some(d => d.name === frm.doc.custom_dental_chart)) {
			actualChart = message.dental_charts.filter(d => d.name === frm.doc.custom_dental_chart)[0];
		}
		else if (message.dental_charts.length > 0) {
			actualChart = message.dental_charts[0];
		}
		else {
			return;
		}


		// Initialize chart
		try {
			new dental.DentalChart({
				parent: $container,
				doc: actualChart
			});
		} catch (e) {
			console.error(e);
			$container.html(`<div class="alert alert-danger">
                Failed to load dental chart: ${e.message}
            </div>`);
		}
	});
}
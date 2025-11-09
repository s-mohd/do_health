frappe.pages["patient-documents"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Documents"),
		single_column: true,
	});

	const ACTIVE_PATIENT_STORAGE_KEY = "do_health_active_patient";
	const hiddenClass = "d-none";

	const FILE_TYPE_LABELS = {
		image: __("Images"),
		pdf: __("PDF"),
		document: __("Documents"),
		sheet: __("Spreadsheets"),
		presentation: __("Presentations"),
		audio: __("Audio"),
		video: __("Video"),
		archive: __("Archives"),
		other: __("Other"),
	};

	const FILE_TYPE_EXTENSIONS = {
		image: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "svg"],
		pdf: ["pdf"],
		document: ["doc", "docx", "odt", "rtf", "txt"],
		sheet: ["xls", "xlsx", "xlsm", "ods", "csv", "tsv"],
		presentation: ["ppt", "pptx", "odp", "pps"],
		audio: ["mp3", "wav", "aac", "ogg", "flac", "m4a"],
		video: ["mp4", "mov", "avi", "mkv", "webm", "wmv"],
		archive: ["zip", "rar", "7z", "tar", "gz", "bz2"],
	};

	const FILE_TYPE_ORDER = ["image", "pdf", "document", "sheet", "presentation", "audio", "video", "archive", "other"];

	const FILE_TYPE_FILTER_OPTIONS = [
		{ value: "all", label: __("All file types") },
		{ value: "image", label: __("Images") },
		{ value: "pdf", label: __("PDF") },
		{ value: "document", label: __("Documents") },
		{ value: "sheet", label: __("Spreadsheets") },
		{ value: "presentation", label: __("Presentations") },
		{ value: "audio", label: __("Audio") },
		{ value: "video", label: __("Video") },
		{ value: "archive", label: __("Archives") },
		{ value: "other", label: __("Other") },
	];

	const PRIVACY_FILTER_OPTIONS = [
		{ value: "all", label: __("All visibility") },
		{ value: "public", label: __("Public files") },
		{ value: "private", label: __("Private files") },
	];

	const filtersState = {
		search: "",
		filetype: "all",
		doctype: "all",
		privacy: "all",
	};

	let requestId = 0;
	let documentsCache = [];
	let totalFilesCount = 0;

	page.body.addClass("patient-documents-page");
	page.body.empty();

	const $container = $(`
		<div class="patient-documents-container m-4">
			<div class="patient-documents-toolbar ${hiddenClass}">
				<div class="form-row align-items-center">
					<div class="col-md-4 mb-2 mb-md-0">
						<input type="text" class="form-control form-control-sm patient-documents-search" />
					</div>
					<div class="col-sm-4 col-md-3 mb-2 mb-md-0">
						<select class="form-control form-control-sm patient-documents-filetype"></select>
					</div>
					<div class="col-sm-4 col-md-2 mb-2 mb-md-0">
						<select class="form-control form-control-sm patient-documents-doctype"></select>
					</div>
					<div class="col-sm-4 col-md-2 mb-2 mb-md-0">
						<select class="form-control form-control-sm patient-documents-privacy"></select>
					</div>
					<div class="col-1 mt-2 mt-md-0 text-md-right">
						<button type="button" class="btn btn-sm btn-default patient-documents-reset">
							${__("Reset filters")}
						</button>
					</div>
				</div>
			</div>
			<div class="patient-documents-state text-muted mb-3"></div>
			<div class="patient-documents-summary text-muted mb-3 ${hiddenClass}"></div>
			<div class="patient-documents-list"></div>
		</div>
	`);

	page.body.append($container);

	const $toolbar = $container.find(".patient-documents-toolbar");
	const $state = $container.find(".patient-documents-state");
	const $summary = $container.find(".patient-documents-summary");
	const $list = $container.find(".patient-documents-list");

	const $search = $toolbar.find(".patient-documents-search");
	const $filetypeSelect = $toolbar.find(".patient-documents-filetype");
	const $doctypeSelect = $toolbar.find(".patient-documents-doctype");
	const $privacySelect = $toolbar.find(".patient-documents-privacy");
	const $resetFilters = $toolbar.find(".patient-documents-reset");

	$search.attr("placeholder", __("Search files or records"));

	populateSelect($filetypeSelect, FILE_TYPE_FILTER_OPTIONS);
	populateSelect($privacySelect, PRIVACY_FILTER_OPTIONS);
	populateDoctypeFilter([]);

	const patientField = page.add_field({
		fieldtype: "Link",
		fieldname: "patient",
		options: "Patient",
		label: __("Patient"),
		change: () => {
			const patient = patientField.get_value();
			onPatientChange(patient);
		},
	});

	showState(__("Select a patient to view documents."));

	const routeOptions =
		frappe.route_options && frappe.route_options.patient
			? frappe.route_options
			: null;

	if (routeOptions && routeOptions.patient) {
		const routePatient = routeOptions.patient;
		frappe.route_options = null;
		patientField.set_value(routePatient);
	} else {
		const savedPatient = getActivePatientFromStorage();
		if (savedPatient) {
			patientField.set_value(savedPatient);
		}
	}

	const debouncedSearch = debounce(() => {
		filtersState.search = ($search.val() || "").trim().toLowerCase();
		applyFiltersAndRender();
	}, 250);

	$search.on("input", debouncedSearch);
	$filetypeSelect.on("change", () => {
		filtersState.filetype = $filetypeSelect.val() || "all";
		applyFiltersAndRender();
	});
	$doctypeSelect.on("change", () => {
		filtersState.doctype = $doctypeSelect.val() || "all";
		applyFiltersAndRender();
	});
	$privacySelect.on("change", () => {
		filtersState.privacy = $privacySelect.val() || "all";
		applyFiltersAndRender();
	});
	$resetFilters.on("click", () => resetFilters(true));

	function resetFilters(apply = false) {
		filtersState.search = "";
		filtersState.filetype = "all";
		filtersState.doctype = "all";
		filtersState.privacy = "all";
		$search.val("");
		$filetypeSelect.val("all");
		$privacySelect.val("all");
		$doctypeSelect.val("all");
		if (apply) {
			applyFiltersAndRender();
		}
	}

	function populateSelect($select, options) {
		$select.empty();
		options.forEach((option) => {
			$select.append(
				$("<option>", {
					value: option.value,
					text: option.label,
				})
			);
		});
	}

	function populateDoctypeFilter(documents) {
		const previousValue = filtersState.doctype;
		const doctypes = new Map();
		documents.forEach((doc) => {
			if (!doc || !doc.doctype) {
				return;
			}
			const label = doc.doctype_label || doc.doctype;
			doctypes.set(doc.doctype, label);
		});

		const options = [{ value: "all", label: __("All records") }];
		Array.from(doctypes.keys())
			.sort((a, b) => doctypes.get(a).localeCompare(doctypes.get(b)))
			.forEach((doctype) => {
				options.push({ value: doctype, label: doctypes.get(doctype) });
			});

		populateSelect($doctypeSelect, options);

		if (options.every((opt) => opt.value !== previousValue)) {
			filtersState.doctype = "all";
			$doctypeSelect.val("all");
		} else {
			$doctypeSelect.val(previousValue);
		}
	}

	function showState(message, options = {}) {
		const isError = Boolean(options.is_error);
		$state.removeClass("text-muted text-danger");
		$state.addClass(isError ? "text-danger" : "text-muted");
		$state.removeClass(hiddenClass).text(message);
		resetSummary();
		$list.empty();
		toggleToolbar(false);
	}

	function hideState() {
		$state.addClass(hiddenClass).empty();
	}

	function resetSummary() {
		$summary.addClass(hiddenClass).empty();
	}

	function toggleToolbar(shouldShow) {
		if (shouldShow) {
			$toolbar.removeClass(hiddenClass);
		} else {
			$toolbar.addClass(hiddenClass);
		}
	}

	function updateSummary(total, filtered) {
		if (!total && !filtered) {
			resetSummary();
			return;
		}

		const shown = typeof filtered === "number" ? filtered : total;
		let text;
		if (total && typeof filtered === "number" && filtered !== total) {
			text = __("{0} of {1} files shown", [shown, total]);
		} else if (shown === 1) {
			text = __("1 file found");
		} else {
			text = __("{0} files found", [shown]);
		}

		$summary.removeClass(hiddenClass).text(text);
	}

	function onPatientChange(patient) {
		resetFilters(false);

		if (!patient) {
			if (page.clear_primary_action) {
				page.clear_primary_action();
			}
			clearActivePatientInStorage();
			showState(__("Select a patient to view documents."));
			return;
		}

		updateActivePatientInStorage(patient);

		page.set_primary_action(__("Refresh"), () => {
			fetchDocuments(patient);
		});

		fetchDocuments(patient);
	}

	async function fetchDocuments(patient) {
		if (!patient) {
			return;
		}

		requestId += 1;
		const activeRequest = requestId;

		showState(__("Fetching documents..."));

		try {
			const { message } = await frappe.call({
				method: "do_health.api.methods.get_patient_documents",
				args: { patient },
			});

			if (activeRequest !== requestId) {
				return;
			}

			renderDocuments(message || {});
		} catch (error) {
			if (activeRequest !== requestId) {
				return;
			}

			console.error("[patient-documents] Failed to fetch documents", error);
			showState(__("Unable to load patient documents."), { is_error: true });
			frappe.show_alert(
				{ message: __("Could not fetch patient documents."), indicator: "red" },
				5
			);
		}
	}

	function renderDocuments(data) {
		const documents = Array.isArray(data.documents) ? data.documents : [];
		documentsCache = enrichDocuments(documents);
		totalFilesCount =
			typeof data.total_files === "number"
				? data.total_files
				: documentsCache.reduce((acc, doc) => acc + (doc.files ? doc.files.length : 0), 0);

		if (!documentsCache.length) {
			showState(__("No attachments found for this patient."));
			return;
		}

		hideState();
		toggleToolbar(true);
		populateDoctypeFilter(documentsCache);
		applyFiltersAndRender();
	}

	function applyFiltersAndRender() {
		if (!documentsCache.length) {
			return;
		}

		const { documents, fileCount } = filterDocuments(documentsCache);

		if (!documents.length) {
			updateSummary(totalFilesCount, 0);
			renderNoMatches();
			return;
		}

		updateSummary(totalFilesCount, fileCount);
		renderDocumentGroups(documents);
	}

	function filterDocuments(documents) {
		const filteredDocuments = [];
		let fileCount = 0;

		const searchTerm = filtersState.search;
		const filetypeFilter = filtersState.filetype;
		const doctypeFilter = filtersState.doctype;
		const privacyFilter = filtersState.privacy;

		documents.forEach((doc) => {
			if (doctypeFilter !== "all" && doc.doctype !== doctypeFilter) {
				return;
			}

			const filteredFiles = (doc.files || []).filter((file) => {
				if (filetypeFilter !== "all" && file.category !== filetypeFilter) {
					return false;
				}

				if (privacyFilter === "private" && !file.is_private) {
					return false;
				}
				if (privacyFilter === "public" && file.is_private) {
					return false;
				}

				if (!searchTerm) {
					return true;
				}

				const haystack = [
					doc.title,
					doc.docname,
					doc.doctype_label,
					file.file_name,
					file.name,
				]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();

				return haystack.includes(searchTerm);
			});

			if (!filteredFiles.length) {
				return;
			}

			fileCount += filteredFiles.length;

			filteredDocuments.push({
				...doc,
				files: filteredFiles,
			});
		});

		return { documents: filteredDocuments, fileCount };
	}

	function renderNoMatches() {
		$list.empty();
		$list.append(
			$("<div>", {
				class: "text-muted text-center py-4 border rounded",
				text: __("No files match the current filters."),
			})
		);
	}

	function renderDocumentGroups(documents) {
		$list.empty();

		documents.forEach((doc) => {
			const filesByCategory = groupFilesByCategory(doc.files || []);
			const categorySummary = buildCategorySummary(filesByCategory);

			const $card = $('<div class="card patient-document-card shadow-sm mb-4"></div>');
			const $header = $('<div class="card-header d-flex flex-column flex-md-row align-items-md-center justify-content-between"></div>');

			const $headerInfo = $('<div class="patient-document-card-header-info"></div>');
			$headerInfo.append(
				$("<div>", { class: "text-uppercase text-muted small mb-1", text: doc.doctype_label || doc.doctype || "" })
			);

			const $title = $('<div class="h6 mb-1 mb-md-0"></div>');
			$title.append(
				$("<a>", {
					class: "font-weight-bold",
					href: `/app/${String(doc.doctype).toLowerCase().replace(' ', '-')}/${encodeURIComponent(doc.docname)}`,
					text: doc.title || doc.docname || __("Record"),
				})
			);
			$headerInfo.append($title);

			if (categorySummary) {
				$headerInfo.append(
					$("<div>", {
						class: "small text-muted mt-1",
						text: categorySummary,
					})
				);
			}

			$header.append($headerInfo);
			$card.append($header);

			const $body = $('<div class="card-body p-0"></div>');

			FILE_TYPE_ORDER.forEach((category) => {
				const files = filesByCategory.get(category);
				if (!files || !files.length) {
					return;
				}

				const label = FILE_TYPE_LABELS[category] || category;
				const $categorySection = $('<div class="patient-document-category-group"></div>');

				$categorySection.append(
					$("<div>", {
						class: "patient-document-category-title px-3 py-2 bg-light border-top border-bottom font-weight-bold",
						text: label,
					})
				);

				const $filesWrapper = $('<div class="patient-document-files"></div>');

				files.forEach((file, index) => {
					const $fileRow = renderFileRow(file, index > 0);
					$filesWrapper.append($fileRow);
				});

				$categorySection.append($filesWrapper);
				$body.append($categorySection);
			});

			$card.append($body);
			$list.append($card);
		});
	}

	function renderFileRow(file, hasTopBorder) {
		const $row = $('<div class="patient-document-file d-flex flex-column flex-md-row align-items-md-center px-3 py-2"></div>');
		if (hasTopBorder) {
			$row.addClass("border-top");
		}

		const $main = $('<div class="d-flex align-items-center flex-grow-1"></div>');

		const iconHtml = file.category === "image" ? imagePreviewMarkup(file) : fileIconMarkup(file);
		$main.append(
			$("<span>", {
				class: "file-icon mr-2",
				html: iconHtml,
			})
		);

		const $link = $("<a>", {
			class: "file-link font-weight-bold",
			target: "_blank",
			rel: "noopener noreferrer",
			text: file.file_name || file.name || __("File"),
			href: getFileUrl(file),
		});
		$main.append($link);

		if (file.is_private) {
			$main.append(
				$("<span>", {
					class: "badge badge-warning badge-pill ml-2",
					text: __("Private"),
				})
			);
		}

		$row.append($main);

		const metaPieces = [];
		if (file.category_label) {
			metaPieces.push(file.category_label);
		}
		if (file.file_size) {
			metaPieces.push(frappe.form.formatters.FileSize(file.file_size));
		}
		if (file.creation) {
			metaPieces.push(frappe.datetime.comment_when(file.creation));
		}
		if (file.owner_fullname) {
			metaPieces.push(__("Uploaded by {0}", [file.owner_fullname]));
		}

		if (metaPieces.length) {
			$row.append(
				$("<div>", {
					class: "file-meta small text-muted mt-2 mt-md-0 ml-md-auto text-md-right",
					html: metaPieces.join(" | "),
				})
			);
		}

		return $row;
	}

	function getFileUrl(file) {
		if (file.file_url) {
			return frappe.urllib.get_full_url(file.file_url);
		}
		return frappe.urllib.get_full_url(`/app/file/${file.name}`);
	}

	function imagePreviewMarkup(file) {
		const url = getFileUrl(file);
		return `<span class="file-preview thumbnail mr-1">
			<img src="${url}" alt="${escapeHtml(file.file_name || file.name || __("Image"))}" class="rounded" style="width: 42px; height: 42px; object-fit: cover;">
		</span>`;
	}

	function fileIconMarkup(file) {
		const iconMap = {
			image: "image",
			pdf: "file-text",
			document: "file-text",
			sheet: "grid",
			presentation: "sliders",
			audio: "music",
			video: "video",
			archive: "package",
			other: "file",
		};
		const icon = iconMap[file.category] || "file";
		return frappe.utils.icon(icon, "sm");
	}

	function groupFilesByCategory(files) {
		const map = new Map();
		files.forEach((file) => {
			const category = file.category || "other";
			if (!map.has(category)) {
				map.set(category, []);
			}
			map.get(category).push(file);
		});
		return map;
	}

	function buildCategorySummary(filesByCategory) {
		const parts = [];
		FILE_TYPE_ORDER.forEach((category) => {
			const files = filesByCategory.get(category);
			if (!files || !files.length) {
				return;
			}
			const label = FILE_TYPE_LABELS[category] || category;
			parts.push(`${label} (${files.length})`);
		});
		return parts.join(" | ");
	}

	function enrichDocuments(documents) {
		return documents.map((doc) => ({
			...doc,
			files: (doc.files || []).map(enrichFileDetails),
		}));
	}

	function enrichFileDetails(file) {
		const category = detectFileCategory(file.file_name || file.name || "");
		const ownerInfo = file.owner ? frappe.user_info(file.owner) : null;

		return {
			...file,
			category,
			category_label: FILE_TYPE_LABELS[category] || FILE_TYPE_LABELS.other,
			owner_fullname: ownerInfo ? ownerInfo.fullname : file.owner,
		};
	}

	function detectFileCategory(filename) {
		const ext = (filename.split(".").pop() || "").toLowerCase();
		if (!ext) {
			return "other";
		}

		for (const [category, extensions] of Object.entries(FILE_TYPE_EXTENSIONS)) {
			if (extensions.includes(ext)) {
				return category;
			}
		}
		return "other";
	}

	function debounce(fn, delay) {
		let timer = null;
		return function (...args) {
			clearTimeout(timer);
			timer = setTimeout(() => fn.apply(this, args), delay);
		};
	}

	function escapeHtml(value) {
		if (value == null) {
			return "";
		}
		if (frappe?.utils?.escape_html) {
			return frappe.utils.escape_html(value);
		}
		const div = document.createElement("div");
		div.innerText = String(value);
		return div.innerHTML;
	}

	function getActivePatientFromStorage() {
		try {
			const raw = window.localStorage?.getItem(ACTIVE_PATIENT_STORAGE_KEY);
			if (!raw) {
				return null;
			}
			const parsed = JSON.parse(raw);
			return parsed?.patient || parsed?.name || null;
		} catch (error) {
			console.warn("[patient-documents] Failed to read active patient from storage", error);
			return null;
		}
	}

	function updateActivePatientInStorage(patient) {
		const storage = getLocalStorageSafe();
		if (!storage || !patient) {
			return;
		}

		const existing = getActivePatientPayload();
		if (existing && existing.patient === patient && existing.patient_name) {
			try {
				storage.setItem(ACTIVE_PATIENT_STORAGE_KEY, JSON.stringify(existing));
			} catch (error) {
				console.warn("[patient-documents] Unable to persist patient context", error);
			}
			return;
		}

		if (frappe?.db?.get_value) {
			frappe.db
				.get_value("Patient", patient, ["patient_name", "patient_image"])
				.then((response) => {
					const message = response?.message || {};
					const payload = {
						patient,
						patient_name: message.patient_name || patient,
						patient_image: message.patient_image || null,
					};
					try {
						storage.setItem(ACTIVE_PATIENT_STORAGE_KEY, JSON.stringify(payload));
					} catch (error) {
						console.warn("[patient-documents] Unable to persist patient context", error);
					}
				})
				.catch(() => {
					writeFallbackPatient(storage, patient);
				});
		} else {
			writeFallbackPatient(storage, patient);
		}
	}

	function clearActivePatientInStorage() {
		const storage = getLocalStorageSafe();
		if (!storage) {
			return;
		}
		try {
			storage.removeItem(ACTIVE_PATIENT_STORAGE_KEY);
		} catch (error) {
			console.warn("[patient-documents] Unable to clear patient context", error);
		}
	}

	function writeFallbackPatient(storage, patient) {
		try {
			storage.setItem(
				ACTIVE_PATIENT_STORAGE_KEY,
				JSON.stringify({
					patient,
					patient_name: patient,
				})
			);
		} catch (error) {
			console.warn("[patient-documents] Unable to persist patient context", error);
		}
	}

	function getLocalStorageSafe() {
		try {
			return window.localStorage || null;
		} catch (error) {
			console.warn("[patient-documents] Local storage unavailable", error);
			return null;
		}
	}

	function getActivePatientPayload() {
		try {
			const raw = window.localStorage?.getItem(ACTIVE_PATIENT_STORAGE_KEY);
			if (!raw) {
				return null;
			}
			return JSON.parse(raw);
		} catch (error) {
			console.warn("[patient-documents] Failed to parse patient payload", error);
			return null;
		}
	}

	// --- Watch for external patient changes in localStorage
	let previousPatient = getActivePatientFromStorage();
	let patientWatcherTimer = null;

	function startWatchingPatient() {
		// Use the native storage event (fires across tabs) and polling (same tab)
		window.addEventListener("storage", handlePatientChange);

		// Fallback polling (for same-tab updates since storage events
		// only fire between different tabs)
		patientWatcherTimer = setInterval(() => {
			checkPatientChange();
		}, 1500);
	}

	function stopWatchingPatient() {
		window.removeEventListener("storage", handlePatientChange);
		if (patientWatcherTimer) clearInterval(patientWatcherTimer);
	}

	function handlePatientChange(e) {
		if (e.key !== ACTIVE_PATIENT_STORAGE_KEY) return;
		checkPatientChange();
	}

	function checkPatientChange() {
		const currentPatient = getActivePatientFromStorage();
		const currentValue = currentPatient || "";
		const previousValue = previousPatient || "";

		if (currentValue !== previousValue) {
			console.log(`[patient-documents] Active patient changed from "${previousValue}" to "${currentValue}"`);
			previousPatient = currentValue;
			onPatientChange(currentValue);
		}
	}

	// Start the watcher when page loads
	startWatchingPatient();

	// Stop watcher when navigating away
	$(window).on("beforeunload", () => stopWatchingPatient());
};

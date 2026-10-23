const supabaseClient = window.supabase.createClient(window.RLG_SUPABASE.url, window.RLG_SUPABASE.anonKey);
const BUCKET = "member-images";
let members = [];
let attendance = [];
let payments = [];
let renewals = [];
let staffAccounts = [];
let currentUser = null;
let pendingRenewal = null;
const pageRole = document.body.dataset.page || "staff";
const isAdminPage = pageRole === "admin";
const PLAN_MONTHS = { Daily: 0, Monthly: 1, Quarterly: 3, Annual: 12 };
const PLAN_RATES = { Daily: 80, Monthly: 800 };
const MEMBERSHIP_TYPES = ["Standard", "VIP"];
let pendingPhoto = null;
let pendingValidId = null;
let rfidScan = null;
let rfidScanBusy = false;
let rfidActionBusy = false;
let lastRfidAction = null;
let currentView = "overview";
let directoryPage = 0;
let attendancePage = 0;
let attendanceCount = 0;
let memberLoadVersion = 0;
let adminDataStale = true;
let staffDataLoaded = false;
let activeUserId = null;
let photoObserver = null;
let attendanceRequestId = 0;
let reportsRequestId = 0;
let reportSummary = { dailyAttendance: 0, monthlyAttendance: 0, renewalCount: 0, dailyPayments: [] };
const DIRECTORY_PAGE_SIZE = 24;
const ATTENDANCE_PAGE_SIZE = 25;
const signedImageCache = new Map();
const signedImagePending = new Map();
const $ = (selector) => document.querySelector(selector);
const loginScreen = $("#loginScreen");
const appShell = $("#appShell");
const table = $("#membersTable");
const form = $("#memberForm");
const memberDialog = $("#memberDialog");
const profileDialog = $("#profileDialog");
const walkInDialog = $("#walkInDialog");
const walkInForm = $("#walkInForm");
const renewDialog = $("#renewDialog");
const renewForm = $("#renewForm");

$("#todayLabel").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const parseLocalDate = (value) => {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};
const formatDate = (value) => {
  const date = parseLocalDate(value);
  return date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date) : "Not set";
};
const formatCheckin = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "Never";
};
const formatTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date) : "Not set";
};
const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "Not set";
};
const statusOf = (expiry) => { const expiryDate = parseLocalDate(expiry); if (!expiryDate) return "expired"; const days = Math.ceil((expiryDate - new Date().setHours(0, 0, 0, 0)) / 86400000); return days < 0 ? "expired" : days <= 14 ? "expiring" : "active"; };
const statusText = (status) => status === "expiring" ? "Expiring soon" : status[0].toUpperCase() + status.slice(1);

function notify(text, tone = "success") {
  $("#toast").textContent = text;
  $("#toast").dataset.tone = tone;
  $("#toast").classList.add("show");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => $("#toast").classList.remove("show"), 2500);
}

const dateFields = [...document.querySelectorAll("[data-date-field]")];
function dateOptions(start, end, placeholder) { return `<option value="">${placeholder}</option>` + Array.from({ length: end - start + 1 }, (_, index) => { const value = start + index; return `<option value="${String(value).padStart(2, "0")}">${value}</option>`; }).join(""); }
function syncDateField(field, value = "") { const [year = "", month = "", day = ""] = value.split("-"); field.querySelector('[data-part="month"]').value = month; field.querySelector('[data-part="day"]').value = day; field.querySelector('[data-part="year"]').value = year; }
function updateDateField(field) { const month = field.querySelector('[data-part="month"]').value, day = field.querySelector('[data-part="day"]').value, year = field.querySelector('[data-part="year"]').value; field.querySelector('input[type="hidden"]').value = month && day && year ? `${year}-${month}-${day}` : ""; if (field.dataset.dateField === "startDate") updateExpiry(); }
dateFields.forEach((field) => { const name = field.dataset.dateField, currentYear = new Date().getFullYear(); field.querySelector('[data-part="month"]').innerHTML = dateOptions(1, 12, "Month"); field.querySelector('[data-part="day"]').innerHTML = dateOptions(1, 31, "Day"); const start = name === "dob" ? currentYear - 100 : currentYear - 2, end = name === "dob" ? currentYear : currentYear + 15; field.querySelector('[data-part="year"]').innerHTML = `<option value="">Year</option>` + Array.from({ length: end - start + 1 }, (_, index) => end - index).map((year) => `<option value="${year}">${year}</option>`).join(""); field.querySelectorAll("select").forEach((select) => select.addEventListener("change", () => updateDateField(field))); });
function expiryFrom(startDate, plan) {
  if (!startDate || PLAN_MONTHS[plan] === undefined) return "";
  if (plan === "Daily") return startDate;
  const [year, month, day] = startDate.split("-").map(Number);
  const targetMonth = month - 1 + PLAN_MONTHS[plan];
  const lastDay = new Date(year, targetMonth + 1, 0).getDate();
  const date = new Date(year, targetMonth, Math.min(day, lastDay));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function expiryAfterMonths(startDate, months) {
  if (!parseLocalDate(startDate)) return "";
  const [year, month, day] = startDate.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const lastDay = new Date(year, targetMonth + 1, 0).getDate();
  const date = new Date(year, targetMonth, Math.min(day, lastDay));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function updateExpiry() {
  const existing = members.find((member) => member.id === form.elements.recordId.value);
  const expiry = existing && existing.startDate === form.elements.startDate.value && existing.plan === form.elements.plan.value
    ? existing.expiry : expiryFrom(form.elements.startDate.value, form.elements.plan.value);
  form.elements.expiry.value = expiry;
  $("#expiryDisplay").textContent = expiry ? formatDate(expiry) : "Choose a start date and plan";
  $("#planRate").textContent = form.elements.membershipType.value === "VIP"
    ? "VIP payment amount is entered during renewal"
    : PLAN_RATES[form.elements.plan.value] ? `${form.elements.plan.value} rate: ${money(PLAN_RATES[form.elements.plan.value])}` : "Rate not configured";
}
form.elements.plan.addEventListener("change", updateExpiry);
form.elements.membershipType.addEventListener("change", updateExpiry);

function dbToMember(row) {
  return { id: row.id, memberId: row.member_id, name: row.name, dob: row.dob, email: row.email || "", phone: row.phone || "", address: row.address || "", emergencyName: row.emergency_name || "", emergencyPhone: row.emergency_phone || "", membershipType: row.membership_type || "Standard", plan: row.plan, startDate: row.start_date, expiry: row.expiry, lastCheckin: row.last_checkin, notes: row.notes || "", photoPath: row.face_photo_path, validIdPath: row.valid_id_path, photo: "", validIdPhoto: "", rfidUid: "" };
}
function memberToDb(data, facePath, validIdPath) {
  return { member_id: data.memberId, name: data.name, dob: data.dob, email: data.email, phone: data.phone, address: data.address, emergency_name: data.emergencyName, emergency_phone: data.emergencyPhone, membership_type: data.membershipType, plan: data.plan, start_date: data.startDate, expiry: data.expiry, notes: data.notes, face_photo_path: facePath, valid_id_path: validIdPath };
}
async function signedUrl(path) {
  if (!path) return "";
  const cached = signedImageCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  if (signedImagePending.has(path)) return signedImagePending.get(path);
  const request = supabaseClient.storage.from(BUCKET).createSignedUrl(path, 3600)
    .then(({ data, error }) => {
      if (error) return "";
      signedImageCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 50 * 60 * 1000 });
      return data.signedUrl;
    }).finally(() => signedImagePending.delete(path));
  signedImagePending.set(path, request);
  return request;
}
async function loadMembers() {
  const version = ++memberLoadVersion;
  $("#memberListStatus").textContent = "Loading members…";
  const loaded = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabaseClient.from("members").select("*").order("created_at", { ascending: false }).range(start, start + 499);
    if (version !== memberLoadVersion) return;
    if (error) { notify(`Could not load members: ${error.message}`, "error"); $("#memberListStatus").textContent = "Could not load members. Refresh to retry."; return; }
    loaded.push(...data.map(dbToMember));
    if (data.length < 500) break;
  }
  members = loaded;
  render();
  if (currentView === "reports") renderReports();
  if ($("#verifyInput").value.trim()) verify();
}
async function loadAdminData() {
  if (!isAdminPage) return;
  adminDataStale = true;
  if (currentView === "attendance") await loadAttendance();
  if (currentView === "reports") await loadReports();
}
async function callStaffFunction(body) {
  const { data, error } = await supabaseClient.functions.invoke("manage-staff", { body });
  if (error) throw new Error(data?.error || error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
async function loadStaffAccounts() {
  if (!isAdminPage) return;
  $("#staffEmpty").hidden = false;
  $("#staffEmpty").textContent = "Loading staff accounts…";
  try {
    const data = await callStaffFunction({ action: "list" });
    staffAccounts = data.staff || [];
    staffDataLoaded = true;
    renderStaffAccounts();
  } catch (error) {
    staffDataLoaded = false;
    $("#staffTable").innerHTML = "";
    $("#staffEmpty").hidden = false;
    $("#staffEmpty").textContent = `Could not load staff accounts: ${error.message}`;
  }
}
function renderStaffAccounts() {
  if (!isAdminPage) return;
  $("#staffTable").innerHTML = staffAccounts.map((staff) => `<tr><td data-label="Staff Name"><b>${escapeHTML(staff.fullName || "Staff")}</b></td><td data-label="Email">${escapeHTML(staff.email)}</td><td data-label="Created">${escapeHTML(formatCheckin(staff.createdAt))}</td><td data-label="Last Sign In">${escapeHTML(formatCheckin(staff.lastSignInAt))}</td></tr>`).join("");
  $("#staffEmpty").hidden = staffAccounts.length > 0;
  $("#staffEmpty").textContent = "No staff accounts found.";
}
async function showApp(session) {
  const role = session.user.app_metadata?.role || "";
  if (!["staff", "admin"].includes(role)) {
    $("#loginError").textContent = "This account has not been assigned a staff or admin role.";
    await supabaseClient.auth.signOut();
    return;
  }
  if (role !== pageRole) {
    window.location.href = role === "admin" ? "admin.html" : "index.html";
    return;
  }
  if (activeUserId === session.user.id && !appShell.hidden) return;
  activeUserId = session.user.id;
  currentUser = session.user;
  $("#userName").textContent = session.user.email;
  $("#userRole").textContent = role === "admin" ? "Administrator" : "Staff";
  $("#userAvatar").textContent = role === "admin" ? "AD" : "ST";
  loginScreen.hidden = true;
  appShell.hidden = false;
  setView("overview");
  await loadMembers();
}

const VIEW_LABELS = {
  overview: ["Member overview", "Today at RLG Gym"],
  members: ["Members", "Search and manage membership profiles"],
  verification: ["Verification", "Confirm a member before entry"],
  rfid: ["RFID scanner", "Tap a card, compare the face, confirm the visit"],
  attendance: ["Attendance", "Check-ins and check-outs"],
  reports: ["Reports", "Membership and revenue trends"],
  staff: ["Staff accounts", "Manage staff access"]
};
function setView(view) {
  if (!VIEW_LABELS[view] || (!isAdminPage && !["overview", "members", "verification"].includes(view))) return;
  currentView = view;
  document.body.dataset.view = view;
  document.querySelectorAll("[data-section]").forEach((section) => {
    section.hidden = !(view === "overview" ? ["verification", "metrics", "members"].includes(section.dataset.section) : section.dataset.section === view);
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#pageHeading").textContent = VIEW_LABELS[view][0];
  $("#pageDescription").textContent = VIEW_LABELS[view][1];
  closeMobileMenu();
  if (view === "rfid") focusRfidInput();
  if (view === "verification") $("#verifyInput").focus({ preventScroll: true });
  if (view === "attendance") loadAttendance();
  if (view === "reports") loadReports();
  if (view === "staff" && !staffDataLoaded) loadStaffAccounts();
  if (view === "overview" || view === "members") loadDirectoryPhotos();
  window.scrollTo({ top: 0, behavior: "auto" });
}
document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === "INITIAL_SESSION") return;
  if (session) showApp(session);
  else { activeUserId = null; currentUser = null; loginScreen.hidden = false; appShell.hidden = true; }
});
supabaseClient.auth.getSession().then(({ data }) => { if (data.session) showApp(data.session); });
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const { error } = await supabaseClient.auth.signInWithPassword({ email: values.email, password: values.password });
  if (error) $("#loginError").textContent = error.message;
});
$("#logoutButton").addEventListener("click", () => supabaseClient.auth.signOut());

function render() {
  const query = $("#searchInput").value.toLowerCase().trim(), filter = $("#statusFilter").value;
  const filtered = members.filter((member) => `${member.memberId} ${member.name} ${member.email} ${member.phone} ${member.membershipType}`.toLowerCase().includes(query) && (filter === "all" || statusOf(member.expiry) === filter));
  const pages = Math.max(1, Math.ceil(filtered.length / DIRECTORY_PAGE_SIZE));
  directoryPage = Math.min(directoryPage, pages - 1);
  const shown = filtered.slice(directoryPage * DIRECTORY_PAGE_SIZE, (directoryPage + 1) * DIRECTORY_PAGE_SIZE);
  table.innerHTML = shown.map((member) => `<tr><td data-label="Member"><div class="member-cell"><span class="member-photo photo-placeholder" data-member-photo="${member.id}" aria-hidden="true">${escapeHTML(member.name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHTML(member.name)}</strong><small>${escapeHTML(member.membershipType)} · ${escapeHTML(member.email)}</small></span></div></td><td data-label="Member ID"><b>${escapeHTML(member.memberId)}</b></td><td data-label="Started">${formatDate(member.startDate)}</td><td data-label="Expires">${formatDate(member.expiry)}</td><td data-label="Status"><span class="status ${statusOf(member.expiry)}">${statusText(statusOf(member.expiry))}</span></td><td data-label="Last check-in">${escapeHTML(formatCheckin(member.lastCheckin))}</td><td class="member-card-action"><button class="view-button" data-id="${member.id}">View profile</button></td></tr>`).join("");
  loadDirectoryPhotos();
  $("#emptyState").hidden = filtered.length > 0;
  $("#emptyState").textContent = members.length ? "No members match this search. Try another name or status." : "No members yet. Add the first member to get started.";
  $("#memberListStatus").textContent = filtered.length ? `Showing ${directoryPage * DIRECTORY_PAGE_SIZE + 1}–${directoryPage * DIRECTORY_PAGE_SIZE + shown.length} of ${filtered.length} members` : "No matching members";
  $("#memberPageLabel").textContent = `Page ${directoryPage + 1} of ${pages}`;
  $("#memberPrev").disabled = directoryPage === 0;
  $("#memberNext").disabled = directoryPage >= pages - 1;
  $("#totalCount").textContent = members.length;
  $("#activeCount").textContent = members.filter((member) => statusOf(member.expiry) !== "expired").length;
  $("#expiringCount").textContent = members.filter((member) => statusOf(member.expiry) === "expiring").length;
  $("#expiredCount").textContent = members.filter((member) => statusOf(member.expiry) === "expired").length;
}

async function showDirectoryPhoto(placeholder) {
  const member = members.find((item) => item.id === placeholder.dataset.memberPhoto);
  if (!member?.photoPath || !placeholder.isConnected) return;
  member.photo ||= await signedUrl(member.photoPath);
  if (!member.photo || !placeholder.isConnected || placeholder.dataset.memberPhoto !== member.id) return;
  const image = document.createElement("img");
  image.className = "member-photo";
  image.src = member.photo;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  placeholder.replaceWith(image);
}
function loadDirectoryPhotos() {
  photoObserver?.disconnect();
  const placeholders = [...table.querySelectorAll("[data-member-photo]")];
  if (typeof IntersectionObserver === "undefined") {
    placeholders.slice(0, 8).forEach(showDirectoryPhoto);
    return;
  }
  photoObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      showDirectoryPhoto(entry.target);
    });
  }, { rootMargin: "160px" });
  placeholders.forEach((placeholder) => photoObserver.observe(placeholder));
}

async function openForm(member) {
  form.reset();
  pendingPhoto = null;
  pendingValidId = null;
  $("#formTitle").textContent = member ? "Edit member" : "Add member";
  $("#formKicker").textContent = member ? "Update profile" : "New profile";
  [...form.elements].forEach((element) => { if (element.name && element.type !== "file" && member?.[element.name] !== undefined) element.value = member[element.name]; });
  form.elements.recordId.value = member?.id || "";
  if (!member) { form.elements.startDate.value = localDate(new Date()); form.elements.memberId.value = `RLG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; }
  dateFields.forEach((field) => syncDateField(field, form.elements[field.dataset.dateField].value));
  if (!member) updateExpiry();
  else {
    $("#expiryDisplay").textContent = formatDate(member.expiry);
    $("#planRate").textContent = member.membershipType === "VIP"
      ? "VIP payment amount is entered during renewal"
      : PLAN_RATES[member.plan] ? `${member.plan} rate: ${money(PLAN_RATES[member.plan])}` : "Rate not configured";
  }
  $("#photoPreview").innerHTML = member?.photo ? `<img src="${escapeHTML(member.photo)}" alt="Member face photo">` : "<span>Add<br>face photo</span>";
  $("#validIdPreview").innerHTML = member?.validIdPhoto ? `<img src="${escapeHTML(member.validIdPhoto)}" alt="Valid ID image">` : "<span>Add valid<br>ID image</span>";
  memberDialog.showModal();
  if (!member) return;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const [photo, validIdPhoto, card] = await Promise.all([
      member.photo || signedUrl(member.photoPath),
      member.validIdPhoto || signedUrl(member.validIdPath),
      isAdminPage ? supabaseClient.from("member_rfid_cards").select("rfid_uid").eq("member_id", member.id).maybeSingle() : Promise.resolve(null)
    ]);
    if (card?.error) throw card.error;
    member.photo = photo;
    member.validIdPhoto = validIdPhoto;
    if (isAdminPage) member.rfidUid = card?.data?.rfid_uid || "";
    if (memberDialog.open && form.elements.recordId.value === member.id) {
      form.elements.rfidUid && (form.elements.rfidUid.value = member.rfidUid);
      if (!pendingPhoto && photo) $("#photoPreview").innerHTML = `<img src="${escapeHTML(photo)}" alt="Member face photo">`;
      if (!pendingValidId && validIdPhoto) $("#validIdPreview").innerHTML = `<img src="${escapeHTML(validIdPhoto)}" alt="Valid ID image">`;
    }
  } catch (error) { notify(`Could not load profile images or card: ${error.message}`, "error"); }
  finally { submit.disabled = false; }
}
$("#addMemberButton").addEventListener("click", () => openForm());
document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => memberDialog.close()));
function readImage(input, onLoad, maxDimension = 1400) { const file = input.files[0]; if (!file) return; if (file.size > 10_000_000) { notify("Each image must be smaller than 10 MB", "error"); input.value = ""; return; } const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { const scale = Math.min(1, maxDimension / Math.max(image.width, image.height)), canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); canvas.toBlob((blob) => onLoad(blob, URL.createObjectURL(blob)), "image/jpeg", .78); }; image.src = reader.result; }; reader.readAsDataURL(file); }
$("#photoInput").addEventListener("change", (event) => readImage(event.target, (blob, preview) => { pendingPhoto = blob; $("#photoPreview").innerHTML = `<img src="${preview}" alt="Member face photo">`; }, 900));
$("#validIdInput").addEventListener("change", (event) => readImage(event.target, (blob, preview) => { pendingValidId = blob; $("#validIdPreview").innerHTML = `<img src="${preview}" alt="Valid ID image">`; }));
async function uploadImage(blob, memberId, type) {
  if (!blob) return null;
  const path = `${memberId}/${type}-${crypto.randomUUID()}.jpg`;
  const { error } = await supabaseClient.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error(`Image upload rejected: ${error.message}`);
  return path;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  delete data.photo; delete data.validIdPhoto;
  const rfidUid = isAdminPage ? (data.rfidUid || "").trim() : "";
  delete data.rfidUid;
  const existing = members.find((member) => member.id === data.recordId);
  data.expiry = existing && existing.startDate === data.startDate && existing.plan === data.plan
    ? existing.expiry : expiryFrom(data.startDate, data.plan);
  if (!MEMBERSHIP_TYPES.includes(data.membershipType)) { notify("Choose a valid membership type", "error"); return; }
  const validDate = (value) => Boolean(parseLocalDate(value));
  if (!validDate(data.dob) || !validDate(data.startDate) || !validDate(data.expiry)) { notify("Please choose valid dates", "error"); return; }
  if (!data.emergencyName.trim()) { notify("Emergency contact is required", "error"); return; }
  if (!/^\d{11}$/.test(data.phone) || !/^\d{11}$/.test(data.emergencyPhone)) { notify("Phone and emergency phone must contain exactly 11 digits", "error"); return; }
  if (!existing && (!pendingPhoto || !pendingValidId)) { notify("A face photo and valid ID image are required", "error"); return; }
  const duplicate = members.find((member) => member.memberId.toLowerCase() === data.memberId.toLowerCase() && member.id !== data.recordId);
  if (duplicate) { notify("That member ID is already registered", "error"); return; }
  if (isAdminPage && rfidUid && !/^\d{10}$/.test(rfidUid)) { notify("RFID card number must contain exactly 10 digits", "error"); return; }
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    const [facePath, validIdPath] = await Promise.all([uploadImage(pendingPhoto, data.memberId, "face"), uploadImage(pendingValidId, data.memberId, "valid-id")]);
    const payload = memberToDb(data, facePath || existing?.photoPath, validIdPath || existing?.validIdPath);
    const query = existing ? supabaseClient.from("members").update(payload).eq("id", existing.id).select("id").single() : supabaseClient.from("members").insert(payload).select("id").single();
    const { data: savedMember, error } = await query;
    if (error) throw new Error(`Member record rejected: ${error.message}`);
    let cardError = null;
    if (isAdminPage && rfidUid !== (existing?.rfidUid || "")) {
      const cardResult = rfidUid
        ? await supabaseClient.from("member_rfid_cards").upsert({ member_id: savedMember.id, rfid_uid: rfidUid }, { onConflict: "member_id" })
        : await supabaseClient.from("member_rfid_cards").delete().eq("member_id", savedMember.id);
      cardError = cardResult.error;
    }
    memberDialog.close();
    const updatedMember = dbToMember({ ...payload, id: savedMember.id, last_checkin: existing?.lastCheckin });
    updatedMember.rfidUid = cardError ? existing?.rfidUid || "" : rfidUid;
    updatedMember.photo = facePath ? "" : existing?.photo || "";
    updatedMember.validIdPhoto = validIdPath ? "" : existing?.validIdPhoto || "";
    if (existing) members.splice(members.indexOf(existing), 1, updatedMember);
    else members.unshift(updatedMember);
    adminDataStale = true;
    render();
    if ($("#verifyInput").value.trim()) verify();
    notify(cardError
      ? `Profile saved, but RFID assignment failed: ${cardError.code === "23505" ? "card already assigned" : cardError.message}`
      : existing ? "Member profile updated" : "Member profile created", cardError ? "error" : "success");
  } catch (error) { notify(`Save failed: ${error.message}`, "error"); }
  finally { submitButton.disabled = false; }
});

function profileHTML(member) {
  if (!member) return '<div class="empty">Member profile was not found. Refresh the directory and try again.</div>';
  const status = statusOf(member.expiry);
  const validId = member.validIdPhoto ? `<div class="id-document"><span>Valid ID image</span><img src="${escapeHTML(member.validIdPhoto)}" alt="Valid ID for ${escapeHTML(member.name)}"></div>` : `<div class="id-document"><span>Valid ID image</span><strong>${member.validIdPath ? "Loading image…" : "No valid ID image uploaded"}</strong></div>`;
  const photo = member.photo ? `<img src="${escapeHTML(member.photo)}" alt="${escapeHTML(member.name)}">` : `<div class="profile-photo-placeholder">${member.photoPath ? "Loading face photo…" : "Face photo unavailable"}</div>`;
  return `<div class="profile-top">${photo}<div><p class="kicker">Member verification profile</p><h2>${escapeHTML(member.name)}</h2><p class="profile-id">${escapeHTML(member.memberId)} · ${escapeHTML(member.membershipType)} · ${escapeHTML(member.plan)} membership</p><span class="status ${status}">${statusText(status)}</span><div class="profile-actions"><button class="button primary" data-action="checkin" data-id="${member.id}">Confirm check-in</button><button class="button secondary" data-action="edit" data-id="${member.id}">Edit profile</button><button class="button ghost" data-action="renew" data-id="${member.id}">Renew plan</button></div></div></div><div class="info-grid">${[["Membership type", member.membershipType], ...(isAdminPage ? [["RFID card", member.rfidUid || "Not assigned"]] : []), ["Start date", formatDate(member.startDate)], ["Expiry date", formatDate(member.expiry)], ["Date of birth", formatDate(member.dob)], ["Phone", member.phone], ["Email", member.email], ["Home address", member.address], ["Emergency contact", member.emergencyName], ["Emergency phone", member.emergencyPhone], ["Last check-in", formatCheckin(member.lastCheckin)], ["Admin notes", member.notes || "None"]].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>${validId}`;
}
async function openProfile(id) {
  const member = members.find((item) => item.id === id);
  if (!member) { notify("Member profile was not found. Refreshing records.", "error"); loadMembers(); return; }
  $("#profileContent").innerHTML = profileHTML(member);
  profileDialog.showModal();
  try {
    const [photo, validIdPhoto, card] = await Promise.all([
      member.photo || signedUrl(member.photoPath),
      member.validIdPhoto || signedUrl(member.validIdPath),
      isAdminPage ? supabaseClient.from("member_rfid_cards").select("rfid_uid").eq("member_id", member.id).maybeSingle() : Promise.resolve(null)
    ]);
    member.photo = photo;
    member.validIdPhoto = validIdPhoto;
    if (card?.error) notify(`Could not load RFID card: ${card.error.message}`, "error");
    else if (isAdminPage) member.rfidUid = card?.data?.rfid_uid || "";
    if (profileDialog.open && $("#profileContent [data-id]")?.dataset.id === member.id) $("#profileContent").innerHTML = profileHTML(member);
  } catch (error) { notify(`Could not load profile: ${error.message}`, "error"); }
}
table.addEventListener("click", (event) => { const button = event.target.closest("[data-id]"); if (button) openProfile(button.dataset.id); });
$(".close-profile").addEventListener("click", () => profileDialog.close());
async function confirmCheckin(member) {
  if (!member) { notify("Member profile was not found. Refresh the directory and try again.", "error"); return false; }
  if (statusOf(member.expiry) === "expired") { notify("Entry denied: membership is expired", "error"); return false; }
  const checkedInAt = new Date().toISOString();
  const { error: attendanceError } = await supabaseClient.from("attendance").insert({ member_id: member.id, member_name: member.name, phone: member.phone, address: member.address, attendance_type: `${member.membershipType} Member`, time_in: checkedInAt, recorded_by: currentUser.email });
  if (attendanceError) { notify(attendanceError.message, "error"); return false; }
  const { error } = await supabaseClient.from("members").update({ last_checkin: checkedInAt }).eq("id", member.id);
  if (error) { notify(error.message, "error"); return false; }
  member.lastCheckin = checkedInAt;
  render();
  await loadAdminData();
  notify("Member verified and checked in");
  return true;
}
$("#profileContent").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const member = members.find((item) => item.id === button.dataset.id);
  if (!member) { notify("Member profile was not found. Refreshing records.", "error"); await loadMembers(); return; }
  if (button.dataset.action === "edit") { profileDialog.close(); openForm(member); return; }
  if (button.dataset.action === "checkin") {
    if (await confirmCheckin(member)) $("#profileContent").innerHTML = profileHTML(members.find((item) => item.id === member.id));
    return;
  }
  if (button.dataset.action === "renew") {
    const oldExpiry = member.expiry;
    const renewalStart = new Date(`${member.expiry}T23:59:59`) > new Date() ? member.expiry : localDate(new Date());
    pendingRenewal = { member, oldExpiry, renewalStart };
    renewForm.reset();
    renewForm.elements.renewMembershipType.value = member.membershipType;
    renewForm.elements.renewPlan.value = member.plan === "Daily" ? "Monthly" : member.plan;
    renewForm.elements.renewMonths.value = Math.max(1, PLAN_MONTHS[renewForm.elements.renewPlan.value]);
    updateRenewalPreview(true);
    renewDialog.showModal();
    return;
  }
});
function updateRenewalPreview(setDefaultAmount = false) {
  if (!pendingRenewal) return;
  const plan = renewForm.elements.renewPlan.value;
  const membershipType = renewForm.elements.renewMembershipType.value;
  const months = Math.max(1, Number(renewForm.elements.renewMonths.value) || 1);
  const newExpiry = expiryAfterMonths(pendingRenewal.renewalStart, months);
  if (setDefaultAmount) {
    renewForm.elements.renewAmount.value = membershipType === "VIP" ? "" : plan === "Monthly" ? months * PLAN_RATES.Monthly : PLAN_RATES[plan] || "";
  }
  $("#renewMember").innerHTML = `Confirm renewal for <strong>${escapeHTML(pendingRenewal.member.name)}</strong>. You may change the plan or months before confirming.`;
  $("#renewDetails").innerHTML = `<span>Membership type<strong>${escapeHTML(membershipType)}</strong></span><span>New plan<strong>${escapeHTML(plan)}</strong></span><span>Renewal duration<strong>${months} month${months === 1 ? "" : "s"}</strong></span><span>Current expiry<strong>${formatDate(pendingRenewal.oldExpiry)}</strong></span><span>New expiry<strong>${formatDate(newExpiry)}</strong></span>`;
}
renewForm.elements.renewMembershipType.addEventListener("change", () => updateRenewalPreview(true));
renewForm.elements.renewPlan.addEventListener("change", () => {
  const plan = renewForm.elements.renewPlan.value;
  renewForm.elements.renewMonths.value = Math.max(1, PLAN_MONTHS[plan]);
  updateRenewalPreview(true);
});
renewForm.elements.renewMonths.addEventListener("input", () => updateRenewalPreview(true));
document.querySelectorAll(".close-renew").forEach((button) => button.addEventListener("click", () => { pendingRenewal = null; renewDialog.close(); }));
renewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingRenewal) return;
  const { member, oldExpiry, renewalStart } = pendingRenewal;
  const plan = renewForm.elements.renewPlan.value;
  const membershipType = renewForm.elements.renewMembershipType.value;
  const months = Number(renewForm.elements.renewMonths.value);
  const amount = Number(renewForm.elements.renewAmount.value);
  if (!Number.isInteger(months) || months < 1 || months > 120) { notify("Renewal months must be between 1 and 120", "error"); return; }
  if (!MEMBERSHIP_TYPES.includes(membershipType)) { notify("Choose a valid membership type", "error"); return; }
  if (!Number.isFinite(amount) || amount <= 0) { notify("Enter a valid renewal payment amount", "error"); return; }
  const newExpiry = expiryAfterMonths(renewalStart, months);
  const submitButton = renewForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const { error: renewalError } = await supabaseClient.from("renewals").insert({ member_id: member.id, member_name: member.name, membership_type: membershipType, old_expiry: oldExpiry, new_expiry: newExpiry, renewal_plan: plan, renewal_months: months, amount, recorded_by: currentUser.email });
  if (renewalError) { notify(renewalError.message, "error"); submitButton.disabled = false; return; }
  const { error: paymentError } = await supabaseClient.from("payments").insert({ member_id: member.id, member_name: member.name, membership_type: membershipType, amount, payment_type: `${membershipType} renewal - ${plan} (${months} month${months === 1 ? "" : "s"})`, recorded_by: currentUser.email });
  if (paymentError) { notify(paymentError.message, "error"); submitButton.disabled = false; return; }
  const { error } = await supabaseClient.from("members").update({ membership_type: membershipType, plan, expiry: newExpiry }).eq("id", member.id);
  if (error) { notify(error.message, "error"); submitButton.disabled = false; return; }
  renewDialog.close();
  pendingRenewal = null;
  submitButton.disabled = false;
  member.membershipType = membershipType;
  member.plan = plan;
  member.expiry = newExpiry;
  render();
  await loadAdminData();
  $("#profileContent").innerHTML = profileHTML(member);
  notify("Membership renewed");
});
function verify() {
  const query = $("#verifyInput").value.toLowerCase().trim();
  if (!query) { $("#verifyResult").innerHTML = '<span class="scan-icon">◎</span><strong>Ready to verify</strong><small>Member details will appear here</small>'; return; }
  const member = members.find((item) => `${item.memberId} ${item.name} ${item.email} ${item.phone} ${item.membershipType}`.toLowerCase().includes(query));
  if (!member) { $("#verifyResult").innerHTML = '<span class="scan-icon">×</span><strong>No registered member found</strong><small>Check the ID or create a new profile</small>'; return; }
  const status = statusOf(member.expiry);
  $("#verifyResult").innerHTML = `<div class="verify-card"><img class="verify-photo" src="${escapeHTML(member.photo || "assets/rlggym.png")}" alt="${member.photo ? `Face photo for ${escapeHTML(member.name)}` : "Face photo loading"}"><div><h3>${escapeHTML(member.name)}</h3><p>${escapeHTML(member.memberId)} · ${escapeHTML(member.membershipType)} · Expires ${formatDate(member.expiry)}</p><button class="button secondary" data-verify-id="${member.id}">View full profile</button></div><div class="verify-state"><span class="status ${status}">${statusText(status)}</span><p>${status === "expired" ? "Do not admit" : `${escapeHTML(member.membershipType)} access approved`}</p></div></div>`;
  const profileButton = $("#verifyResult [data-verify-id]");
  const actions = document.createElement("div");
  actions.className = "verify-actions";
  actions.innerHTML = `<button class="button primary" data-verify-checkin="${member.id}" ${status === "expired" ? "disabled" : ""}>${status === "expired" ? "Entry denied" : "Confirm check-in"}</button>`;
  profileButton.insertAdjacentHTML("beforebegin", `<p class="verify-last-checkin">Last check-in: <strong>${escapeHTML(formatCheckin(member.lastCheckin))}</strong></p>`);
  profileButton.replaceWith(actions);
  actions.append(profileButton);
  if (!member.photo && member.photoPath) signedUrl(member.photoPath).then((url) => {
    member.photo = url;
    const photo = $("#verifyResult .verify-photo");
    if (photo && $("#verifyInput").value.toLowerCase().trim() === query && url) photo.src = url;
  });
}
$("#verifyInput").addEventListener("input", verify);
$("#verifyResult").addEventListener("click", async (event) => {
  const profileButton = event.target.closest("[data-verify-id]");
  if (profileButton) { openProfile(profileButton.dataset.verifyId); return; }
  const checkinButton = event.target.closest("[data-verify-checkin]");
  if (!checkinButton) return;
  checkinButton.disabled = true;
  const member = members.find((item) => item.id === checkinButton.dataset.verifyCheckin);
  if (!(await confirmCheckin(member))) checkinButton.disabled = false;
  else verify();
});
function closeMobileMenu() { $(".sidebar").classList.remove("open"); }
$("#searchInput").addEventListener("input", () => { directoryPage = 0; render(); });
$("#statusFilter").addEventListener("change", () => { directoryPage = 0; render(); });
$("#memberRefresh").addEventListener("click", loadMembers);
$("#memberPrev").addEventListener("click", () => { if (directoryPage > 0) { directoryPage--; render(); } });
$("#memberNext").addEventListener("click", () => { directoryPage++; render(); });
$("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#walkInButton").addEventListener("click", () => { walkInForm.reset(); walkInDialog.showModal(); });
document.querySelectorAll(".close-walk-in").forEach((button) => button.addEventListener("click", () => walkInDialog.close()));
walkInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(walkInForm));
  if (!/^\d{11}$/.test(data.phone)) { notify("Walk-in phone number must contain exactly 11 digits", "error"); return; }
  const timeIn = new Date().toISOString();
  const { error: attendanceError } = await supabaseClient.from("attendance").insert({ member_name: data.name, phone: data.phone, address: data.address, attendance_type: "Walk-in", time_in: timeIn, recorded_by: currentUser.email });
  if (attendanceError) { notify(attendanceError.message, "error"); return; }
  const { error: paymentError } = await supabaseClient.from("payments").insert({ member_name: data.name, membership_type: "Standard", amount: PLAN_RATES.Daily, payment_type: "Standard daily walk-in", paid_at: timeIn, recorded_by: currentUser.email });
  if (paymentError) { notify(paymentError.message, "error"); return; }
  walkInDialog.close();
  await loadAdminData();
  notify("Walk-in attendance and PHP 80 payment recorded");
});

function money(value) { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0); }
function localDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function dateBounds(value, unit = "day") {
  const start = unit === "month" ? new Date(`${value}-01T00:00:00`) : new Date(`${value}T00:00:00`);
  const end = new Date(start);
  if (unit === "month") end.setMonth(end.getMonth() + 1);
  else end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}
async function fetchAllRows(tableName, columns = "*", configure = (query) => query, orderField = "") {
  const rows = [];
  for (let start = 0; ; start += 500) {
    let query = configure(supabaseClient.from(tableName).select(columns));
    if (orderField) query = query.order(orderField, { ascending: false });
    const { data, error } = await query.range(start, start + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
function setRfidMessage(message, tone = "ready") {
  $("#rfidMessage").textContent = message;
  $("#rfidMessage").dataset.tone = tone;
  $("#rfidReady").textContent = tone === "loading" ? "Reading card…" : "Ready to scan";
}
function focusRfidInput() {
  $("#rfidInput").value = "";
  $("#rfidInput").focus({ preventScroll: true });
}
function renderRfidResult() {
  if (!rfidScan) return;
  const { uid, member, open, lastIn, lastOut } = rfidScan;
  const status = statusOf(member.expiry);
  const action = open ? "checkout" : "checkin";
  const coolingDown = lastRfidAction?.uid === uid && Date.now() - lastRfidAction.at < 8000;
  const denied = !open && status === "expired";
  const missingPhoto = !member.photo;
  const warning = denied ? "Entry denied. Renew this membership before check-in."
    : missingPhoto ? "Face photo unavailable. Add one before the next RFID check-in."
    : status === "expiring" ? "Membership expires soon. Confirm identity before entry."
    : "Compare the member's face with the photo before confirming.";
  $("#rfidResult").innerHTML = `<div class="rfid-card">
    <div class="rfid-face">${member.photo ? `<img id="rfidFacePhoto" src="${escapeHTML(member.photo)}" alt="Face photo for ${escapeHTML(member.name)}">` : `<span>Face photo unavailable</span>`}</div>
    <div class="rfid-details"><p class="kicker">Card ${escapeHTML(uid)}</p><h3>${escapeHTML(member.name)}</h3>
      <span class="status ${status}">${statusText(status)}</span>
      <dl><div><dt>Member ID</dt><dd>${escapeHTML(member.memberId)}</dd></div><div><dt>Membership</dt><dd>${escapeHTML(member.membershipType)} · ${escapeHTML(member.plan)}</dd></div><div><dt>Expires</dt><dd>${formatDate(member.expiry)}</dd></div><div><dt>Last check-in</dt><dd>${lastIn ? escapeHTML(formatDateTime(lastIn)) : "Never"}</dd></div><div><dt>Last check-out</dt><dd>${lastOut ? escapeHTML(formatDateTime(lastOut)) : "Never"}</dd></div><div><dt>Visit</dt><dd>${open ? "Currently checked in" : "No open RFID visit"}</dd></div></dl>
      <p class="rfid-warning ${denied ? "denied" : status === "expiring" ? "caution" : ""}">${warning}</p>
      <button class="button ${open ? "secondary" : "primary"}" id="rfidActionButton" type="button" data-action="${action}" ${rfidActionBusy || coolingDown || denied || (!open && missingPhoto) ? "disabled" : ""}>${open ? "Confirm check-out" : "Confirm check-in"}</button>
      ${coolingDown ? `<small class="rfid-cooldown">Wait a few seconds before another action for this card.</small>` : ""}
    </div>
  </div>`;
  const photo = $("#rfidFacePhoto");
  if (photo) photo.addEventListener("error", () => {
    if (rfidScan?.uid !== uid) return;
    rfidScan.member.photo = "";
    renderRfidResult();
    setRfidMessage("Face photo could not load. Add a valid photo before check-in.", "error");
  }, { once: true });
}
async function showRfidCard(uid) {
  const cardResult = await supabaseClient.from("member_rfid_cards").select("member_id").eq("rfid_uid", uid).maybeSingle();
  if (cardResult.error) throw cardResult.error;
  if (!cardResult.data) {
    rfidScan = null;
    $("#rfidResult").innerHTML = `<div class="rfid-unknown"><strong>Unknown card</strong><p>No member is assigned to ${escapeHTML(uid)}. Check the card number or assign it to a member.</p></div>`;
    setRfidMessage("Unknown card. Ready for another scan.", "error");
    return;
  }
  const memberId = cardResult.data.member_id;
  const [memberResult, visitsResult] = await Promise.all([
    supabaseClient.from("members").select("*").eq("id", memberId).single(),
    supabaseClient.from("attendance").select("id,time_in,time_out").eq("member_id", memberId).eq("checkin_method", "rfid").order("time_in", { ascending: false }).limit(2)
  ]);
  const failed = [memberResult, visitsResult].find((result) => result.error);
  if (failed) throw failed.error;
  const member = dbToMember(memberResult.data);
  member.rfidUid = uid;
  member.photo = await signedUrl(member.photoPath);
  const visits = visitsResult.data || [];
  const lastIn = [member.lastCheckin, visits[0]?.time_in].filter(Boolean).sort().at(-1);
  rfidScan = { uid, member, open: visits[0]?.time_out == null ? visits[0] || null : null, lastIn, lastOut: visits.find((visit) => visit.time_out)?.time_out };
  renderRfidResult();
  const entryBlocked = !rfidScan.open && statusOf(member.expiry) === "expired";
  const photoBlocked = !rfidScan.open && !member.photo;
  setRfidMessage(entryBlocked ? "Membership expired. Check-in is blocked; ready for another scan."
    : photoBlocked ? "Face photo unavailable. Check-in is blocked; ready for another scan."
    : `${member.name} found. Review the face photo and confirm ${rfidScan.open ? "check-out" : "check-in"}. Ready for the next card.`,
  entryBlocked || photoBlocked ? "error" : "ready");
}
function renderAttendance() {
  if (!isAdminPage) return;
  $("#attendanceTable").innerHTML = attendance.map((record) => `<tr><td data-label="Attendance ID"><b>${escapeHTML(record.id.slice(0, 8).toUpperCase())}</b></td><td data-label="Name">${escapeHTML(record.member_name)}</td><td data-label="Type">${escapeHTML(record.attendance_type || "Member")}</td><td data-label="Method">${record.checkin_method === "rfid" ? "RFID" : "Manual"}</td><td data-label="RFID card">${escapeHTML(record.rfid_uid || "—")}</td><td data-label="Phone">${escapeHTML(record.phone || "-")}</td><td data-label="Address">${escapeHTML(record.address || "-")}</td><td data-label="Date of Visit">${formatDate(localDate(record.time_in))}</td><td data-label="Time In">${formatTime(record.time_in)}</td><td data-label="Time Out">${record.time_out ? formatDateTime(record.time_out) : record.checkin_method === "rfid" ? "Inside" : "—"}</td><td data-label="Recorded By">${escapeHTML(record.recorded_by)}</td><td data-label="Checked Out By">${escapeHTML(record.checked_out_by || "—")}</td></tr>`).join("");
  $("#attendanceEmpty").hidden = attendance.length > 0;
  $("#attendanceEmpty").textContent = "No attendance records for this date.";
  const pages = Math.max(1, Math.ceil(attendanceCount / ATTENDANCE_PAGE_SIZE));
  $("#attendanceListStatus").textContent = attendanceCount ? `Showing ${attendancePage * ATTENDANCE_PAGE_SIZE + 1}–${attendancePage * ATTENDANCE_PAGE_SIZE + attendance.length} of ${attendanceCount} visits` : "No visits found";
  $("#attendancePageLabel").textContent = `Page ${attendancePage + 1} of ${pages}`;
  $("#attendancePrev").disabled = attendancePage === 0;
  $("#attendanceNext").disabled = attendancePage >= pages - 1;
}
async function loadAttendance() {
  if (!isAdminPage) return;
  const requestId = ++attendanceRequestId;
  $("#attendanceListStatus").textContent = "Loading attendance…";
  let query = supabaseClient.from("attendance").select("*", { count: "exact" }).order("time_in", { ascending: false });
  const selectedDate = $("#attendanceDate").value;
  if (selectedDate) {
    const [start, end] = dateBounds(selectedDate);
    query = query.gte("time_in", start).lt("time_in", end);
  }
  const { data, count, error } = await query.range(attendancePage * ATTENDANCE_PAGE_SIZE, (attendancePage + 1) * ATTENDANCE_PAGE_SIZE - 1);
  if (requestId !== attendanceRequestId) return;
  if (error) { $("#attendanceListStatus").textContent = "Could not load attendance. Press Refresh to retry."; notify(`Could not load attendance: ${error.message}`, "error"); return; }
  attendance = data;
  attendanceCount = count || 0;
  adminDataStale = false;
  renderAttendance();
}
function renderReports() {
  if (!isAdminPage) return;
  const monthlyPayments = payments;
  const standardPayments = monthlyPayments.filter((record) => (record.membership_type || "Standard") === "Standard");
  const vipPayments = monthlyPayments.filter((record) => record.membership_type === "VIP");
  $("#reportActive").textContent = members.filter((member) => statusOf(member.expiry) !== "expired").length;
  $("#reportExpired").textContent = members.filter((member) => statusOf(member.expiry) === "expired").length;
  $("#reportDailyAttendance").textContent = reportSummary.dailyAttendance;
  $("#reportMonthlyAttendance").textContent = reportSummary.monthlyAttendance;
  $("#reportPayments").textContent = monthlyPayments.length;
  $("#reportPaymentAmount").textContent = money(monthlyPayments.reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportStandardRevenue").textContent = money(standardPayments.reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportVipRevenue").textContent = money(vipPayments.reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportRenewals").textContent = reportSummary.renewalCount;
  $("#reportDailyRevenue").textContent = money(reportSummary.dailyPayments.reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportMonthlyRevenue").textContent = money(monthlyPayments.reduce((sum, record) => sum + Number(record.amount), 0));
}
async function loadReports() {
  if (!isAdminPage) return;
  const requestId = ++reportsRequestId;
  $("#reportsSection").classList.add("is-loading");
  $("#reportLoadStatus").textContent = "Loading current figures…";
  const today = localDate(new Date());
  const month = $("#reportMonth").value || today.slice(0, 7);
  const [monthStart, monthEnd] = dateBounds(month, "month");
  const [dayStart, dayEnd] = dateBounds(today);
  try {
    const [monthlyPayments, monthlyAttendance, dailyAttendance, renewalCount, dailyPayments] = await Promise.all([
      fetchAllRows("payments", "amount,membership_type,paid_at", (query) => query.gte("paid_at", monthStart).lt("paid_at", monthEnd)),
      supabaseClient.from("attendance").select("id", { count: "exact", head: true }).gte("time_in", monthStart).lt("time_in", monthEnd),
      supabaseClient.from("attendance").select("id", { count: "exact", head: true }).gte("time_in", dayStart).lt("time_in", dayEnd),
      supabaseClient.from("renewals").select("id", { count: "exact", head: true }).gte("renewed_at", monthStart).lt("renewed_at", monthEnd),
      month === today.slice(0, 7) ? Promise.resolve(null) : fetchAllRows("payments", "amount,paid_at", (query) => query.gte("paid_at", dayStart).lt("paid_at", dayEnd))
    ]);
    const failed = [monthlyAttendance, dailyAttendance, renewalCount].find((result) => result.error);
    if (failed) throw failed.error;
    if (requestId !== reportsRequestId) return;
    payments = monthlyPayments;
    reportSummary = {
      dailyAttendance: dailyAttendance.count || 0,
      monthlyAttendance: monthlyAttendance.count || 0,
      renewalCount: renewalCount.count || 0,
      dailyPayments: dailyPayments || monthlyPayments.filter((record) => localDate(record.paid_at) === today)
    };
    adminDataStale = false;
    renderReports();
    $("#reportLoadStatus").textContent = `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date())}`;
  } catch (error) {
    if (requestId === reportsRequestId) {
      $("#reportLoadStatus").textContent = "Could not load reports. Press Refresh to retry.";
      notify(`Could not load reports: ${error.message}`, "error");
    }
  }
  finally { if (requestId === reportsRequestId) $("#reportsSection").classList.remove("is-loading"); }
}
function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
if (isAdminPage) {
  const today = localDate(new Date());
  $("#reportMonth").value = today.slice(0, 7);
  $("#attendanceDate").addEventListener("change", () => { attendancePage = 0; loadAttendance(); });
  $("#attendanceRefresh").addEventListener("click", loadAttendance);
  $("#reportMonth").addEventListener("change", loadReports);
  $("#reportsRefresh").addEventListener("click", loadReports);
  $("#attendancePrev").addEventListener("click", () => { if (attendancePage > 0) { attendancePage--; loadAttendance(); } });
  $("#attendanceNext").addEventListener("click", () => { attendancePage++; loadAttendance(); });
  $("#exportAttendance").addEventListener("click", async () => {
    const button = $("#exportAttendance");
    button.disabled = true;
    button.textContent = "Preparing CSV…";
    try {
      const rows = await fetchAllRows("attendance", "*", (query) => query, "time_in");
      downloadCsv("attendance-report.csv", [["Attendance ID", "Name", "Type", "Method", "Check-in RFID", "Check-out RFID", "Phone", "Address", "Date of Visit", "Time In", "Time Out", "Recorded By", "Checked Out By"], ...rows.map((record) => [record.id, record.member_name, record.attendance_type || "Member", record.checkin_method === "rfid" ? "RFID" : "Manual", record.rfid_uid || "", record.checkout_rfid_uid || "", record.phone || "", record.address || "", localDate(record.time_in), formatTime(record.time_in), record.time_out ? formatDateTime(record.time_out) : "", record.recorded_by, record.checked_out_by || ""])]);
      notify(`${rows.length} attendance records exported`);
    } catch (error) { notify(`Export failed: ${error.message}`, "error"); }
    finally { button.disabled = false; button.textContent = "Export CSV"; }
  });
  $("#rfidScanForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const uid = $("#rfidInput").value.trim();
    focusRfidInput();
    if (rfidScanBusy || rfidActionBusy) { setRfidMessage("Finishing the previous scan. Try again.", "error"); return; }
    if (!/^\d{10}$/.test(uid)) {
      rfidScan = null;
      $("#rfidResult").innerHTML = '<div class="rfid-unknown"><strong>Invalid card number</strong><p>Use a 10-digit number. Ready for another scan.</p></div>';
      setRfidMessage("Invalid or incomplete card number. Ready for another scan.", "error");
      return;
    }
    if (lastRfidAction?.uid === uid && Date.now() - lastRfidAction.at < 8000) {
      setRfidMessage("Duplicate tap ignored. Ready for another card.", "error");
      return;
    }
    rfidScanBusy = true;
    setRfidMessage("Looking up card…", "loading");
    try { await showRfidCard(uid); }
    catch (error) { rfidScan = null; $("#rfidResult").innerHTML = '<div class="rfid-unknown"><strong>Scan failed</strong><p>Check the connection or database setup, then scan again.</p></div>'; setRfidMessage(`Scan failed: ${error.message}`, "error"); }
    finally { rfidScanBusy = false; focusRfidInput(); }
  });
  $("#rfidResult").addEventListener("click", async (event) => {
    const button = event.target.closest("#rfidActionButton");
    if (!button || !rfidScan || rfidActionBusy || button.disabled) return;
    const { uid, member } = rfidScan;
    const action = button.dataset.action;
    rfidActionBusy = true;
    button.disabled = true;
    setRfidMessage(`Recording ${action === "checkin" ? "check-in" : "check-out"}…`, "loading");
    let saved = false;
    try {
      const { data, error } = await supabaseClient.rpc("rfid_visit_action", { p_uid: uid, p_action: action });
      if (error) throw error;
      saved = true;
      lastRfidAction = { uid, at: Date.now() };
      if (action === "checkin") {
        const listedMember = members.find((item) => item.id === member.id);
        if (listedMember) listedMember.lastCheckin = data.time;
        rfidScan.open = { id: data.visit_id, time_in: data.time, time_out: null };
        rfidScan.lastIn = data.time;
        render();
      } else {
        rfidScan.open = null;
        rfidScan.lastOut = data.time;
      }
      adminDataStale = true;
      renderRfidResult();
      setRfidMessage(`${member.name} checked ${action === "checkin" ? "in" : "out"}. Ready for the next card.`, "success");
      setTimeout(() => { if (rfidScan?.uid === uid) renderRfidResult(); }, 8100);
    } catch (error) {
      if (!saved) { try { await showRfidCard(uid); } catch (_) { /* Keep the error visible and allow a retry. */ } }
      setRfidMessage(saved
        ? `Visit recorded, but the display could not refresh: ${error.message}. Scan again after a few seconds.`
        : `Could not record visit: ${error.message}`, "error");
    } finally { rfidActionBusy = false; renderRfidResult(); focusRfidInput(); }
  });
  $("#exportReports").addEventListener("click", () => downloadCsv("business-summary.csv", [["Report", "Value"], ["Active Members", $("#reportActive").textContent], ["Expired Members", $("#reportExpired").textContent], ["Daily Attendance", $("#reportDailyAttendance").textContent], ["Monthly Attendance", $("#reportMonthlyAttendance").textContent], ["Payments", $("#reportPayments").textContent], ["Payment Amount", $("#reportPaymentAmount").textContent], ["Standard Revenue", $("#reportStandardRevenue").textContent], ["VIP Revenue", $("#reportVipRevenue").textContent], ["Renewals", $("#reportRenewals").textContent], ["Daily Revenue", $("#reportDailyRevenue").textContent], ["Monthly Revenue", $("#reportMonthlyRevenue").textContent]]));
  const staffDialog = $("#staffDialog");
  const staffForm = $("#staffForm");
  $("#addStaffButton").addEventListener("click", () => { staffForm.reset(); staffDialog.showModal(); });
  document.querySelectorAll(".close-staff").forEach((button) => button.addEventListener("click", () => staffDialog.close()));
  staffForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(staffForm));
    if (values.password !== values.confirmPassword) { notify("Staff passwords do not match", "error"); return; }
    const submitButton = staffForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await callStaffFunction({ action: "create", fullName: values.fullName, email: values.email, password: values.password });
      staffDialog.close();
      notify("Staff account created");
      await loadStaffAccounts();
    } catch (error) {
      notify(`Could not create staff account: ${error.message}`, "error");
    } finally {
      submitButton.disabled = false;
    }
  });
}

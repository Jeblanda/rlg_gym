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
const statusOf = (expiry) => { const expiryDate = parseLocalDate(expiry); if (!expiryDate) return "expired"; const days = Math.ceil((expiryDate - new Date().setHours(0, 0, 0, 0)) / 86400000); return days < 0 ? "expired" : days <= 14 ? "expiring" : "active"; };
const statusText = (status) => status === "expiring" ? "Expiring soon" : status[0].toUpperCase() + status.slice(1);

function notify(text) {
  $("#toast").textContent = text;
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
  const expiry = expiryFrom(form.elements.startDate.value, form.elements.plan.value);
  form.elements.expiry.value = expiry;
  $("#expiryDisplay").textContent = expiry ? formatDate(expiry) : "Choose a start date and plan";
  $("#planRate").textContent = form.elements.membershipType.value === "VIP"
    ? "VIP payment amount is entered during renewal"
    : PLAN_RATES[form.elements.plan.value] ? `${form.elements.plan.value} rate: ${money(PLAN_RATES[form.elements.plan.value])}` : "Rate not configured";
}
form.elements.plan.addEventListener("change", updateExpiry);
form.elements.membershipType.addEventListener("change", updateExpiry);

function dbToMember(row) {
  return { id: row.id, memberId: row.member_id, name: row.name, dob: row.dob, email: row.email || "", phone: row.phone || "", address: row.address || "", emergencyName: row.emergency_name || "", emergencyPhone: row.emergency_phone || "", membershipType: row.membership_type || "Standard", plan: row.plan, startDate: row.start_date, expiry: row.expiry, lastCheckin: row.last_checkin, notes: row.notes || "", photoPath: row.face_photo_path, validIdPath: row.valid_id_path, photo: "", validIdPhoto: "" };
}
function memberToDb(data, facePath, validIdPath) {
  return { member_id: data.memberId, name: data.name, dob: data.dob, email: data.email, phone: data.phone, address: data.address, emergency_name: data.emergencyName, emergency_phone: data.emergencyPhone, membership_type: data.membershipType, plan: data.plan, start_date: data.startDate, expiry: data.expiry, notes: data.notes, face_photo_path: facePath, valid_id_path: validIdPath };
}
async function signedUrl(path) {
  if (!path) return "";
  const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrl(path, 3600);
  return error ? "" : data.signedUrl;
}
async function loadMembers() {
  const { data, error } = await supabaseClient.from("members").select("*").order("created_at", { ascending: false });
  if (error) { notify(`Could not load members: ${error.message}`); return; }
  members = await Promise.all(data.map(async (row) => { const member = dbToMember(row); [member.photo, member.validIdPhoto] = await Promise.all([signedUrl(member.photoPath), signedUrl(member.validIdPath)]); return member; }));
  render();
}
async function loadAdminData() {
  if (!isAdminPage) return;
  const [attendanceResult, paymentsResult, renewalsResult] = await Promise.all([
    supabaseClient.from("attendance").select("*").order("time_in", { ascending: false }),
    supabaseClient.from("payments").select("*").order("paid_at", { ascending: false }),
    supabaseClient.from("renewals").select("*").order("renewed_at", { ascending: false })
  ]);
  const failed = [attendanceResult, paymentsResult, renewalsResult].find((result) => result.error);
  if (failed) { notify(`Could not load admin records: ${failed.error.message}`); return; }
  attendance = attendanceResult.data;
  payments = paymentsResult.data;
  renewals = renewalsResult.data;
  renderAdmin();
  await loadStaffAccounts();
}
async function callStaffFunction(body) {
  const { data, error } = await supabaseClient.functions.invoke("manage-staff", { body });
  if (error) throw new Error(data?.error || error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
async function loadStaffAccounts() {
  if (!isAdminPage) return;
  try {
    const data = await callStaffFunction({ action: "list" });
    staffAccounts = data.staff || [];
    renderStaffAccounts();
  } catch (error) {
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
  currentUser = session.user;
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
  $("#userName").textContent = session.user.email;
  $("#userRole").textContent = role === "admin" ? "Administrator" : "Staff";
  $("#userAvatar").textContent = role === "admin" ? "AD" : "ST";
  loginScreen.hidden = true;
  appShell.hidden = false;
  await loadMembers();
  await loadAdminData();
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) showApp(session);
  else { loginScreen.hidden = false; appShell.hidden = true; }
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
  table.innerHTML = filtered.map((member) => `<tr><td data-label="Member"><div class="member-cell"><img class="member-photo" src="${member.photo}" alt=""><span><strong>${escapeHTML(member.name)}</strong><small>${escapeHTML(member.membershipType)} · ${escapeHTML(member.email)}</small></span></div></td><td data-label="Member ID"><b>${escapeHTML(member.memberId)}</b></td><td data-label="Started">${formatDate(member.startDate)}</td><td data-label="Expires">${formatDate(member.expiry)}</td><td data-label="Status"><span class="status ${statusOf(member.expiry)}">${statusText(statusOf(member.expiry))}</span></td><td data-label="Last check-in">${escapeHTML(formatCheckin(member.lastCheckin))}</td><td class="member-card-action"><button class="view-button" data-id="${member.id}">View full profile</button></td></tr>`).join("");
  $("#emptyState").hidden = filtered.length > 0;
  $("#totalCount").textContent = members.length;
  $("#activeCount").textContent = members.filter((member) => statusOf(member.expiry) !== "expired").length;
  $("#expiringCount").textContent = members.filter((member) => statusOf(member.expiry) === "expiring").length;
  $("#expiredCount").textContent = members.filter((member) => statusOf(member.expiry) === "expired").length;
}

function openForm(member) {
  form.reset();
  pendingPhoto = null;
  pendingValidId = null;
  $("#formTitle").textContent = member ? "Edit member" : "Add member";
  $("#formKicker").textContent = member ? "Update profile" : "New profile";
  [...form.elements].forEach((element) => { if (element.name && element.type !== "file" && member?.[element.name] !== undefined) element.value = member[element.name]; });
  form.elements.recordId.value = member?.id || "";
  if (!member) { form.elements.startDate.value = new Date().toISOString().slice(0, 10); form.elements.memberId.value = `RLG-${String(100 + members.length + 1).padStart(4, "0")}`; }
  dateFields.forEach((field) => syncDateField(field, form.elements[field.dataset.dateField].value));
  if (!member) updateExpiry();
  else {
    $("#expiryDisplay").textContent = formatDate(member.expiry);
    $("#planRate").textContent = member.membershipType === "VIP"
      ? "VIP payment amount is entered during renewal"
      : PLAN_RATES[member.plan] ? `${member.plan} rate: ${money(PLAN_RATES[member.plan])}` : "Rate not configured";
  }
  $("#photoPreview").innerHTML = member?.photo ? `<img src="${member.photo}" alt="Member face photo">` : "<span>Add<br>face photo</span>";
  $("#validIdPreview").innerHTML = member?.validIdPhoto ? `<img src="${member.validIdPhoto}" alt="Valid ID image">` : "<span>Add valid<br>ID image</span>";
  memberDialog.showModal();
}
$("#addMemberButton").addEventListener("click", () => openForm());
document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => memberDialog.close()));
function readImage(input, onLoad) { const file = input.files[0]; if (!file) return; if (file.size > 10_000_000) { notify("Each image must be smaller than 10 MB"); input.value = ""; return; } const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { const scale = Math.min(1, 1400 / Math.max(image.width, image.height)), canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); canvas.toBlob((blob) => onLoad(blob, URL.createObjectURL(blob)), "image/jpeg", .78); }; image.src = reader.result; }; reader.readAsDataURL(file); }
$("#photoInput").addEventListener("change", (event) => readImage(event.target, (blob, preview) => { pendingPhoto = blob; $("#photoPreview").innerHTML = `<img src="${preview}" alt="Member face photo">`; }));
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
  data.expiry = expiryFrom(data.startDate, data.plan);
  if (!MEMBERSHIP_TYPES.includes(data.membershipType)) { notify("Choose a valid membership type"); return; }
  const validDate = (value) => Boolean(parseLocalDate(value));
  if (!validDate(data.dob) || !validDate(data.startDate) || !validDate(data.expiry)) { notify("Please choose valid dates"); return; }
  if (!data.emergencyName.trim()) { notify("Emergency contact is required"); return; }
  if (!/^\d{11}$/.test(data.phone) || !/^\d{11}$/.test(data.emergencyPhone)) { notify("Phone and emergency phone must contain exactly 11 digits"); return; }
  const existing = members.find((member) => member.id === data.recordId);
  if (!existing && (!pendingPhoto || !pendingValidId)) { notify("A face photo and valid ID image are required"); return; }
  const duplicate = members.find((member) => member.memberId.toLowerCase() === data.memberId.toLowerCase() && member.id !== data.recordId);
  if (duplicate) { notify("That member ID is already registered"); return; }
  try {
    const [facePath, validIdPath] = await Promise.all([uploadImage(pendingPhoto, data.memberId, "face"), uploadImage(pendingValidId, data.memberId, "valid-id")]);
    const payload = memberToDb(data, facePath || existing?.photoPath, validIdPath || existing?.validIdPath);
    const query = existing ? supabaseClient.from("members").update(payload).eq("id", existing.id) : supabaseClient.from("members").insert(payload);
    const { error } = await query;
    if (error) throw new Error(`Member record rejected: ${error.message}`);
    memberDialog.close();
    notify(existing ? "Member profile updated" : "Member profile created");
    await loadMembers();
  } catch (error) { notify(`Save failed: ${error.message}`); }
});

function profileHTML(member) {
  if (!member) return '<div class="empty">Member profile was not found. Refresh the directory and try again.</div>';
  const status = statusOf(member.expiry);
  const validId = member.validIdPhoto ? `<div class="id-document"><span>Valid ID image</span><img src="${member.validIdPhoto}" alt="Valid ID for ${escapeHTML(member.name)}"></div>` : `<div class="id-document"><span>Valid ID image</span><strong>No valid ID image uploaded</strong></div>`;
  return `<div class="profile-top"><img src="${member.photo}" alt="${escapeHTML(member.name)}"><div><p class="kicker">Member verification profile</p><h2>${escapeHTML(member.name)}</h2><p class="profile-id">${escapeHTML(member.memberId)} · ${escapeHTML(member.membershipType)} · ${escapeHTML(member.plan)} membership</p><span class="status ${status}">${statusText(status)}</span><div class="profile-actions"><button class="button primary" data-action="checkin" data-id="${member.id}">Confirm check-in</button><button class="button secondary" data-action="edit" data-id="${member.id}">Edit profile</button><button class="button ghost" data-action="renew" data-id="${member.id}">Renew plan</button></div></div></div><div class="info-grid">${[["Membership type", member.membershipType], ["Start date", formatDate(member.startDate)], ["Expiry date", formatDate(member.expiry)], ["Date of birth", formatDate(member.dob)], ["Phone", member.phone], ["Email", member.email], ["Home address", member.address], ["Emergency contact", member.emergencyName], ["Emergency phone", member.emergencyPhone], ["Last check-in", formatCheckin(member.lastCheckin)], ["Admin notes", member.notes || "None"]].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>${validId}`;
}
function openProfile(id) {
  const member = members.find((item) => item.id === id);
  if (!member) { notify("Member profile was not found. Refreshing records."); loadMembers(); return; }
  $("#profileContent").innerHTML = profileHTML(member);
  profileDialog.showModal();
}
table.addEventListener("click", (event) => { const button = event.target.closest("[data-id]"); if (button) openProfile(button.dataset.id); });
$(".close-profile").addEventListener("click", () => profileDialog.close());
async function confirmCheckin(member) {
  if (!member) { notify("Member profile was not found. Refresh the directory and try again."); return false; }
  if (statusOf(member.expiry) === "expired") { notify("Entry denied: membership is expired"); return false; }
  const checkedInAt = new Date().toISOString();
  const { error: attendanceError } = await supabaseClient.from("attendance").insert({ member_id: member.id, member_name: member.name, phone: member.phone, address: member.address, attendance_type: `${member.membershipType} Member`, time_in: checkedInAt, recorded_by: currentUser.email });
  if (attendanceError) { notify(attendanceError.message); return false; }
  const { error } = await supabaseClient.from("members").update({ last_checkin: checkedInAt }).eq("id", member.id);
  if (error) { notify(error.message); return false; }
  await loadMembers();
  await loadAdminData();
  notify("Member verified and checked in");
  return true;
}
$("#profileContent").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const member = members.find((item) => item.id === button.dataset.id);
  if (!member) { notify("Member profile was not found. Refreshing records."); await loadMembers(); return; }
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
  if (!Number.isInteger(months) || months < 1 || months > 120) { notify("Renewal months must be between 1 and 120"); return; }
  if (!MEMBERSHIP_TYPES.includes(membershipType)) { notify("Choose a valid membership type"); return; }
  if (!Number.isFinite(amount) || amount <= 0) { notify("Enter a valid renewal payment amount"); return; }
  const newExpiry = expiryAfterMonths(renewalStart, months);
  const submitButton = renewForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const { error: renewalError } = await supabaseClient.from("renewals").insert({ member_id: member.id, member_name: member.name, membership_type: membershipType, old_expiry: oldExpiry, new_expiry: newExpiry, renewal_plan: plan, renewal_months: months, amount, recorded_by: currentUser.email });
  if (renewalError) { notify(renewalError.message); submitButton.disabled = false; return; }
  const { error: paymentError } = await supabaseClient.from("payments").insert({ member_id: member.id, member_name: member.name, membership_type: membershipType, amount, payment_type: `${membershipType} renewal - ${plan} (${months} month${months === 1 ? "" : "s"})`, recorded_by: currentUser.email });
  if (paymentError) { notify(paymentError.message); submitButton.disabled = false; return; }
  const { error } = await supabaseClient.from("members").update({ membership_type: membershipType, plan, expiry: newExpiry }).eq("id", member.id);
  if (error) { notify(error.message); submitButton.disabled = false; return; }
  renewDialog.close();
  pendingRenewal = null;
  submitButton.disabled = false;
  await loadMembers();
  await loadAdminData();
  const refreshed = members.find((item) => item.id === member.id);
  $("#profileContent").innerHTML = profileHTML(refreshed);
  notify("Membership renewed");
});
function verify() {
  const query = $("#verifyInput").value.toLowerCase().trim();
  if (!query) { $("#verifyResult").innerHTML = '<span class="scan-icon">◎</span><strong>Ready to verify</strong><small>Member details will appear here</small>'; return; }
  const member = members.find((item) => `${item.memberId} ${item.name} ${item.email} ${item.phone} ${item.membershipType}`.toLowerCase().includes(query));
  if (!member) { $("#verifyResult").innerHTML = '<span class="scan-icon">×</span><strong>No registered member found</strong><small>Check the ID or create a new profile</small>'; return; }
  const status = statusOf(member.expiry);
  $("#verifyResult").innerHTML = `<div class="verify-card"><img class="verify-photo" src="${member.photo}" alt=""><div><h3>${escapeHTML(member.name)}</h3><p>${escapeHTML(member.memberId)} · ${escapeHTML(member.membershipType)} · Expires ${formatDate(member.expiry)}</p><button class="button secondary" data-verify-id="${member.id}">View full profile</button></div><div class="verify-state"><span class="status ${status}">${statusText(status)}</span><p>${status === "expired" ? "Do not admit" : `${escapeHTML(member.membershipType)} access approved`}</p></div></div>`;
  const profileButton = $("#verifyResult [data-verify-id]");
  const actions = document.createElement("div");
  actions.className = "verify-actions";
  actions.innerHTML = `<button class="button primary" data-verify-checkin="${member.id}" ${status === "expired" ? "disabled" : ""}>${status === "expired" ? "Entry denied" : "Confirm check-in"}</button>`;
  profileButton.insertAdjacentHTML("beforebegin", `<p class="verify-last-checkin">Last check-in: <strong>${escapeHTML(formatCheckin(member.lastCheckin))}</strong></p>`);
  profileButton.replaceWith(actions);
  actions.append(profileButton);
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
$("#searchInput").addEventListener("input", render);
$("#statusFilter").addEventListener("change", render);
$("#navMembers").addEventListener("click", () => { closeMobileMenu(); $("#directory").scrollIntoView({ behavior: "smooth" }); });
$("#navCheckin").addEventListener("click", () => { closeMobileMenu(); $("#verifyPanel").scrollIntoView({ behavior: "smooth" }); $("#verifyInput").focus(); });
$("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#walkInButton").addEventListener("click", () => { walkInForm.reset(); walkInDialog.showModal(); });
document.querySelectorAll(".close-walk-in").forEach((button) => button.addEventListener("click", () => walkInDialog.close()));
walkInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(walkInForm));
  if (!/^\d{11}$/.test(data.phone)) { notify("Walk-in phone number must contain exactly 11 digits"); return; }
  const timeIn = new Date().toISOString();
  const { error: attendanceError } = await supabaseClient.from("attendance").insert({ member_name: data.name, phone: data.phone, address: data.address, attendance_type: "Walk-in", time_in: timeIn, recorded_by: currentUser.email });
  if (attendanceError) { notify(attendanceError.message); return; }
  const { error: paymentError } = await supabaseClient.from("payments").insert({ member_name: data.name, membership_type: "Standard", amount: PLAN_RATES.Daily, payment_type: "Standard daily walk-in", paid_at: timeIn, recorded_by: currentUser.email });
  if (paymentError) { notify(paymentError.message); return; }
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
function renderAdmin() {
  if (!isAdminPage) return;
  const attendanceDate = $("#attendanceDate").value;
  const shownAttendance = attendance.filter((record) => !attendanceDate || localDate(record.time_in) === attendanceDate);
  $("#attendanceTable").innerHTML = shownAttendance.map((record) => `<tr><td data-label="Attendance ID"><b>${escapeHTML(record.id.slice(0, 8).toUpperCase())}</b></td><td data-label="Name">${escapeHTML(record.member_name)}</td><td data-label="Type">${escapeHTML(record.attendance_type || "Member")}</td><td data-label="Phone">${escapeHTML(record.phone || "-")}</td><td data-label="Address">${escapeHTML(record.address || "-")}</td><td data-label="Date of Visit">${formatDate(localDate(record.time_in))}</td><td data-label="Time In">${formatTime(record.time_in)}</td><td data-label="Recorded By">${escapeHTML(record.recorded_by)}</td></tr>`).join("");
  $("#attendanceEmpty").hidden = shownAttendance.length > 0;

  const today = localDate(new Date());
  const month = $("#reportMonth").value || today.slice(0, 7);
  const monthlyPayments = payments.filter((record) => localDate(record.paid_at).startsWith(month));
  const standardPayments = monthlyPayments.filter((record) => (record.membership_type || "Standard") === "Standard");
  const vipPayments = monthlyPayments.filter((record) => record.membership_type === "VIP");
  $("#reportActive").textContent = members.filter((member) => statusOf(member.expiry) !== "expired").length;
  $("#reportExpired").textContent = members.filter((member) => statusOf(member.expiry) === "expired").length;
  $("#reportDailyAttendance").textContent = attendance.filter((record) => localDate(record.time_in) === today).length;
  $("#reportMonthlyAttendance").textContent = attendance.filter((record) => localDate(record.time_in).startsWith(month)).length;
  $("#reportPayments").textContent = monthlyPayments.length;
  $("#reportPaymentAmount").textContent = money(monthlyPayments.reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportStandardRevenue").textContent = money(standardPayments.reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportVipRevenue").textContent = money(vipPayments.reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportRenewals").textContent = renewals.filter((record) => localDate(record.renewed_at).startsWith(month)).length;
  $("#reportDailyRevenue").textContent = money(payments.filter((record) => localDate(record.paid_at) === today).reduce((sum, record) => sum + Number(record.amount), 0));
  $("#reportMonthlyRevenue").textContent = money(monthlyPayments.reduce((sum, record) => sum + Number(record.amount), 0));
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
  $("#attendanceDate").addEventListener("change", renderAdmin);
  $("#reportMonth").addEventListener("change", renderAdmin);
  $("#navAttendance").addEventListener("click", () => { closeMobileMenu(); $("#attendanceSection").scrollIntoView({ behavior: "smooth" }); });
  $("#navReports").addEventListener("click", () => { closeMobileMenu(); $("#reportsSection").scrollIntoView({ behavior: "smooth" }); });
  $("#navStaff").addEventListener("click", () => { closeMobileMenu(); $("#staffSection").scrollIntoView({ behavior: "smooth" }); });
  $("#exportAttendance").addEventListener("click", () => downloadCsv("attendance-report.csv", [["Attendance ID", "Name", "Type", "Phone", "Address", "Date of Visit", "Time In", "Recorded By"], ...attendance.map((record) => [record.id, record.member_name, record.attendance_type || "Member", record.phone || "", record.address || "", localDate(record.time_in), formatTime(record.time_in), record.recorded_by])]));
  $("#exportReports").addEventListener("click", () => downloadCsv("business-summary.csv", [["Report", "Value"], ["Active Members", $("#reportActive").textContent], ["Expired Members", $("#reportExpired").textContent], ["Daily Attendance", $("#reportDailyAttendance").textContent], ["Monthly Attendance", $("#reportMonthlyAttendance").textContent], ["Payments", $("#reportPayments").textContent], ["Payment Amount", $("#reportPaymentAmount").textContent], ["Standard Revenue", $("#reportStandardRevenue").textContent], ["VIP Revenue", $("#reportVipRevenue").textContent], ["Renewals", $("#reportRenewals").textContent], ["Daily Revenue", $("#reportDailyRevenue").textContent], ["Monthly Revenue", $("#reportMonthlyRevenue").textContent]]));
  const staffDialog = $("#staffDialog");
  const staffForm = $("#staffForm");
  $("#addStaffButton").addEventListener("click", () => { staffForm.reset(); staffDialog.showModal(); });
  document.querySelectorAll(".close-staff").forEach((button) => button.addEventListener("click", () => staffDialog.close()));
  staffForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(staffForm));
    if (values.password !== values.confirmPassword) { notify("Staff passwords do not match"); return; }
    const submitButton = staffForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await callStaffFunction({ action: "create", fullName: values.fullName, email: values.email, password: values.password });
      staffDialog.close();
      notify("Staff account created");
      await loadStaffAccounts();
    } catch (error) {
      notify(`Could not create staff account: ${error.message}`);
    } finally {
      submitButton.disabled = false;
    }
  });
}

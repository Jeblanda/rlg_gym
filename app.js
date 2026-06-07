const supabaseClient = window.supabase.createClient(window.RLG_SUPABASE.url, window.RLG_SUPABASE.anonKey);
const BUCKET = "member-images";
let members = [];
let pendingPhoto = null;
let pendingValidId = null;
const $ = (selector) => document.querySelector(selector);
const loginScreen = $("#loginScreen");
const appShell = $("#appShell");
const table = $("#membersTable");
const form = $("#memberForm");
const memberDialog = $("#memberDialog");
const profileDialog = $("#profileDialog");

$("#todayLabel").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const formatDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
const formatCheckin = (value) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Never";
const statusOf = (expiry) => { const days = Math.ceil((new Date(`${expiry}T00:00:00`) - new Date().setHours(0, 0, 0, 0)) / 86400000); return days < 0 ? "expired" : days <= 14 ? "expiring" : "active"; };
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
function updateDateField(field) { const month = field.querySelector('[data-part="month"]').value, day = field.querySelector('[data-part="day"]').value, year = field.querySelector('[data-part="year"]').value; field.querySelector('input[type="hidden"]').value = month && day && year ? `${year}-${month}-${day}` : ""; }
dateFields.forEach((field) => { const name = field.dataset.dateField, currentYear = new Date().getFullYear(); field.querySelector('[data-part="month"]').innerHTML = dateOptions(1, 12, "Month"); field.querySelector('[data-part="day"]').innerHTML = dateOptions(1, 31, "Day"); const start = name === "dob" ? currentYear - 100 : currentYear - 2, end = name === "dob" ? currentYear : currentYear + 15; field.querySelector('[data-part="year"]').innerHTML = `<option value="">Year</option>` + Array.from({ length: end - start + 1 }, (_, index) => end - index).map((year) => `<option value="${year}">${year}</option>`).join(""); field.querySelectorAll("select").forEach((select) => select.addEventListener("change", () => updateDateField(field))); });

function dbToMember(row) {
  return { id: row.id, memberId: row.member_id, name: row.name, dob: row.dob, email: row.email || "", phone: row.phone || "", address: row.address || "", emergencyName: row.emergency_name || "", emergencyPhone: row.emergency_phone || "", plan: row.plan, startDate: row.start_date, expiry: row.expiry, lastCheckin: row.last_checkin, notes: row.notes || "", photoPath: row.face_photo_path, validIdPath: row.valid_id_path, photo: "", validIdPhoto: "" };
}
function memberToDb(data, facePath, validIdPath) {
  return { member_id: data.memberId, name: data.name, dob: data.dob, email: data.email, phone: data.phone, address: data.address, emergency_name: data.emergencyName, emergency_phone: data.emergencyPhone, plan: data.plan, start_date: data.startDate, expiry: data.expiry, notes: data.notes, face_photo_path: facePath, valid_id_path: validIdPath };
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
async function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
  await loadMembers();
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) showApp();
  else { loginScreen.hidden = false; appShell.hidden = true; }
});
supabaseClient.auth.getSession().then(({ data }) => { if (data.session) showApp(); });
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
  const filtered = members.filter((member) => `${member.memberId} ${member.name} ${member.email} ${member.phone}`.toLowerCase().includes(query) && (filter === "all" || statusOf(member.expiry) === filter));
  table.innerHTML = filtered.map((member) => `<tr><td data-label="Member"><div class="member-cell"><img class="member-photo" src="${member.photo}" alt=""><span><strong>${escapeHTML(member.name)}</strong><small>${escapeHTML(member.email)}</small></span></div></td><td data-label="Member ID"><b>${escapeHTML(member.memberId)}</b></td><td data-label="Started">${formatDate(member.startDate)}</td><td data-label="Expires">${formatDate(member.expiry)}</td><td data-label="Status"><span class="status ${statusOf(member.expiry)}">${statusText(statusOf(member.expiry))}</span></td><td data-label="Last check-in">${escapeHTML(formatCheckin(member.lastCheckin))}</td><td class="member-card-action"><button class="view-button" data-id="${member.id}">View full profile</button></td></tr>`).join("");
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
  const validDate = (value) => { if (!value) return false; const [year, month, day] = value.split("-").map(Number), date = new Date(year, month - 1, day); return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day; };
  if (!validDate(data.dob) || !validDate(data.startDate) || !validDate(data.expiry)) { notify("Please choose valid dates"); return; }
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
  const status = statusOf(member.expiry);
  const validId = member.validIdPhoto ? `<div class="id-document"><span>Valid ID image</span><img src="${member.validIdPhoto}" alt="Valid ID for ${escapeHTML(member.name)}"></div>` : `<div class="id-document"><span>Valid ID image</span><strong>No valid ID image uploaded</strong></div>`;
  return `<div class="profile-top"><img src="${member.photo}" alt="${escapeHTML(member.name)}"><div><p class="kicker">Member verification profile</p><h2>${escapeHTML(member.name)}</h2><p class="profile-id">${escapeHTML(member.memberId)} · ${escapeHTML(member.plan)} membership</p><span class="status ${status}">${statusText(status)}</span><div class="profile-actions"><button class="button primary" data-action="checkin" data-id="${member.id}">Confirm check-in</button><button class="button secondary" data-action="edit" data-id="${member.id}">Edit profile</button><button class="button ghost" data-action="renew" data-id="${member.id}">Renew plan</button></div></div></div><div class="info-grid">${[["Start date", formatDate(member.startDate)], ["Expiry date", formatDate(member.expiry)], ["Date of birth", formatDate(member.dob)], ["Phone", member.phone], ["Email", member.email], ["Home address", member.address], ["Emergency contact", member.emergencyName], ["Emergency phone", member.emergencyPhone], ["Last check-in", formatCheckin(member.lastCheckin)], ["Admin notes", member.notes || "None"]].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>${validId}`;
}
function openProfile(id) { const member = members.find((item) => item.id === id); $("#profileContent").innerHTML = profileHTML(member); profileDialog.showModal(); }
table.addEventListener("click", (event) => { const button = event.target.closest("[data-id]"); if (button) openProfile(button.dataset.id); });
$(".close-profile").addEventListener("click", () => profileDialog.close());
$("#profileContent").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const member = members.find((item) => item.id === button.dataset.id);
  if (button.dataset.action === "edit") { profileDialog.close(); openForm(member); return; }
  if (button.dataset.action === "checkin" && statusOf(member.expiry) === "expired") { notify("Entry denied: membership is expired"); return; }
  let changes;
  if (button.dataset.action === "checkin") changes = { last_checkin: new Date().toISOString() };
  if (button.dataset.action === "renew") { const date = new Date(Math.max(Date.now(), new Date(`${member.expiry}T00:00:00`))); date.setMonth(date.getMonth() + ({ Monthly: 1, Quarterly: 3, Annual: 12 })[member.plan]); changes = { expiry: date.toISOString().slice(0, 10) }; }
  const { error } = await supabaseClient.from("members").update(changes).eq("id", member.id);
  if (error) { notify(error.message); return; }
  await loadMembers();
  const refreshed = members.find((item) => item.id === member.id);
  $("#profileContent").innerHTML = profileHTML(refreshed);
  notify(button.dataset.action === "checkin" ? "Member verified and checked in" : "Membership renewed");
});
function verify() {
  const query = $("#verifyInput").value.toLowerCase().trim();
  if (!query) { $("#verifyResult").innerHTML = '<span class="scan-icon">◎</span><strong>Ready to verify</strong><small>Member details will appear here</small>'; return; }
  const member = members.find((item) => `${item.memberId} ${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(query));
  if (!member) { $("#verifyResult").innerHTML = '<span class="scan-icon">×</span><strong>No registered member found</strong><small>Check the ID or create a new profile</small>'; return; }
  const status = statusOf(member.expiry);
  $("#verifyResult").innerHTML = `<div class="verify-card"><img class="verify-photo" src="${member.photo}" alt=""><div><h3>${escapeHTML(member.name)}</h3><p>${escapeHTML(member.memberId)} · Expires ${formatDate(member.expiry)}</p><button class="button secondary" data-verify-id="${member.id}">View full profile</button></div><div class="verify-state"><span class="status ${status}">${statusText(status)}</span><p>${status === "expired" ? "Do not admit" : "Identity and membership found"}</p></div></div>`;
}
$("#verifyInput").addEventListener("input", verify);
$("#verifyResult").addEventListener("click", (event) => { const button = event.target.closest("[data-verify-id]"); if (button) openProfile(button.dataset.verifyId); });
function closeMobileMenu() { $(".sidebar").classList.remove("open"); }
$("#searchInput").addEventListener("input", render);
$("#statusFilter").addEventListener("change", render);
$("#navMembers").addEventListener("click", () => { closeMobileMenu(); $("#directory").scrollIntoView({ behavior: "smooth" }); });
$("#navCheckin").addEventListener("click", () => { closeMobileMenu(); $("#verifyPanel").scrollIntoView({ behavior: "smooth" }); $("#verifyInput").focus(); });
$("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open"));

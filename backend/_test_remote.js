// --- Failover: list of backend servers (same MongoDB) --------------------
const SERVERS = [
  window.location.origin,
  "https://fullstck-production.up.railway.app",
  "https://fullstck.onrender.com",
];
// Remove duplicates (if we're already on one of them)
const UNIQUE_SERVERS = [...new Set(SERVERS)];
let API = window.location.origin + "/api";

async function findWorkingServer() {
  for (const server of UNIQUE_SERVERS) {
    try {
      const res = await fetch(server + "/api/health", {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        API = server + "/api";
        console.log("[Failover] Using server:", server);
        return server;
      }
    } catch (_) {}
  }
  return null;
}
let authToken = localStorage.getItem("adminToken") || "";
let adminUsername = localStorage.getItem("adminUsername") || "admin";
let uploadMode = "replace";
let selectedFile = null;
let pageLoaded = {
  dashboard: false,
  master: false,
  workers: false,
  users: false,
};
let currentItemsPage = 1;
let currentItemsPages = 1;
let liveRefreshTimer = null;
let currentPage = "dashboard";
let workerRefreshInFlight = false;

// --- Auth --------------------------------------------------------------------
async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (authToken) headers["Authorization"] = "Bearer " + authToken;
  if (!(opts.body instanceof FormData))
    headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(API + path, { ...opts, headers });
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: raw || "Request failed" };
    }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  } catch (err) {
    // Network failure � try failover
    const working = await findWorkingServer();
    if (working) {
      const res2 = await fetch(API + path, { ...opts, headers });
      const raw2 = await res2.text();
      let data2 = {};
      try {
        data2 = raw2 ? JSON.parse(raw2) : {};
      } catch {
        data2 = { error: raw2 || "Request failed" };
      }
      if (!res2.ok) throw new Error(data2.error || "Request failed");
      return data2;
    }
    throw err;
  }
}

async function checkSetup() {
  try {
    const data = await apiFetch("/auth/check-setup");
    if (data.needsSetup)
      document.getElementById("setupSection").classList.remove("hidden");
  } catch {}
}

async function doLogin() {
  const username = document.getElementById("loginUser").value.trim();
  const pin = document.getElementById("loginPin").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  if (!username || !pin) {
    errEl.textContent = "Enter username and PIN";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, pin }),
    });
    if (data.role !== "admin") {
      errEl.textContent = "Only admins can access this panel";
      errEl.classList.remove("hidden");
      return;
    }
    authToken = data.token;
    localStorage.setItem("adminToken", authToken);
    adminUsername = username;
    localStorage.setItem("adminUsername", username);
    showPanel();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
}

async function doSetup() {
  const username = document.getElementById("loginUser").value.trim();
  const pin = document.getElementById("loginPin").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  if (!username || !pin) {
    errEl.textContent = "Enter username and PIN";
    errEl.classList.remove("hidden");
    return;
  }
  if (pin.length < 4) {
    errEl.textContent = "PIN must be at least 4 digits";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    const data = await apiFetch("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, pin }),
    });
    authToken = data.token;
    localStorage.setItem("adminToken", authToken);
    adminUsername = username;
    localStorage.setItem("adminUsername", username);
    showPanel();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
}

function doLogout() {
  authToken = "";
  adminUsername = "admin";
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminUsername");
  document.getElementById("mainPanel").classList.add("hidden");
  document.getElementById("loginSection").classList.remove("hidden");
}

async function showPanel() {
  document.getElementById("loginSection").classList.add("hidden");
  document.getElementById("mainPanel").classList.remove("hidden");
  startLiveRefresh();
  switchPage("dashboard");
}

function startLiveRefresh() {
  if (liveRefreshTimer) return;
  liveRefreshTimer = setInterval(() => {
    if (document.hidden || !authToken) return;
    const tasks = [loadStats()];
    if (currentPage === "workers" && pageLoaded.workers) {
      if (workerRefreshInFlight) return;
      workerRefreshInFlight = true;
      tasks.push(loadWorkerStatus(true), loadTransactions(true));
    }
    Promise.allSettled(tasks).finally(() => {
      workerRefreshInFlight = false;
    });
  }, 60000);
}

async function switchPage(page) {
  currentPage = page;
  const pages = ["dashboard", "master", "workers", "users"];
  pages.forEach((p) => {
    document
      .getElementById("page" + p.charAt(0).toUpperCase() + p.slice(1))
      .classList.toggle("hidden", p !== page);
    document
      .getElementById("nav" + p.charAt(0).toUpperCase() + p.slice(1))
      .classList.toggle("active", p === page);
  });

  if (page === "dashboard" && !pageLoaded.dashboard) {
    await loadStats();
    pageLoaded.dashboard = true;
  }
  if (page === "master" && !pageLoaded.master) {
    await Promise.allSettled([loadStats(), loadItems(1), loadPushStats()]);
    pageLoaded.master = true;
  }
  if (page === "workers" && !pageLoaded.workers) {
    await Promise.allSettled([
      loadStats(),
      loadWorkerStatus(),
      loadTransactions(),
    ]);
    pageLoaded.workers = true;
  }
  if (page === "users" && !pageLoaded.users) {
    await Promise.allSettled([loadStats(), loadUsers()]);
    pageLoaded.users = true;
  }
}

// --- Stats -------------------------------------------------------------------
async function loadStats() {
  // Fire all 3 stats requests in parallel for speed
  const [itemsRes, usersRes, statsRes] = await Promise.allSettled([
    apiFetch("/items/count"),
    apiFetch("/auth/users"),
    apiFetch("/transactions/stats"),
  ]);
  document.getElementById("statItems").textContent =
    itemsRes.status === "fulfilled" ? itemsRes.value.count || 0 : "?";
  document.getElementById("statUsers").textContent =
    usersRes.status === "fulfilled" ? usersRes.value.users?.length || 0 : "?";
  document.getElementById("statTx").textContent =
    statsRes.status === "fulfilled" ? statsRes.value.total || 0 : "?";
}

// --- File Upload -------------------------------------------------------------

// --- Push Master -------------------------------------------------------------
async function loadPushStats() {
  try {
    const data = await apiFetch("/items/version");
    document.getElementById("pushItemCount").textContent =
      data.totalItems ?? "-";
    document.getElementById("pushVersion").textContent =
      "v" + (data.version ?? "-");
  } catch {}
}

async function pushMasterToPhones() {
  const btn = document.getElementById("pushMasterBtn");
  const resultDiv = document.getElementById("pushResult");
  const count = document.getElementById("pushItemCount").textContent;
  if (
    !confirm(
      "Push " +
        count +
        " items to ALL phones?\n\nPhones will download the full master on next manual sync.",
    )
  )
    return;
  btn.disabled = true;
  btn.textContent = "? Pushing...";
  resultDiv.innerHTML = "";
  try {
    const data = await apiFetch("/items/push-master", { method: "POST" });
    resultDiv.innerHTML =
      '<div style="color:#2e7d32;font-weight:600;padding:8px;background:#c8e6c9;border-radius:6px">? Pushed! Version: v' +
      data.version +
      " � " +
      data.totalItems +
      " items ready for phones</div>";
    document.getElementById("pushVersion").textContent = "v" + data.version;
    document.getElementById("pushItemCount").textContent = data.totalItems;
  } catch (err) {
    resultDiv.innerHTML =
      '<div style="color:#c62828;font-weight:600;padding:8px;background:#ffcdd2;border-radius:6px">? ' +
      esc(err.message || "Push failed") +
      "</div>";
  } finally {
    btn.disabled = false;
    btn.textContent = "?? Push Master Data to All Phones";
  }
}

// --- File Upload continued ----------------------------------------------------
const dropZone = document.getElementById("dropZone");
const csvInput = document.getElementById("csvFile");

csvInput.addEventListener("change", (e) => {
  selectedFile = e.target.files[0];
  if (selectedFile) {
    document.getElementById("fileName").textContent = selectedFile.name;
    document.getElementById("uploadBtn").disabled = false;
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () =>
  dropZone.classList.remove("dragover"),
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) {
    selectedFile = e.dataTransfer.files[0];
    document.getElementById("fileName").textContent = selectedFile.name;
    document.getElementById("uploadBtn").disabled = false;
  }
});

function setMode(mode) {
  uploadMode = mode;
  document.getElementById("modeReplace").className =
    mode === "replace" ? "active" : "";
  document.getElementById("modeMerge").className =
    mode === "merge" ? "active" : "";
}

async function uploadCSV() {
  if (!selectedFile) return;
  const btn = document.getElementById("uploadBtn");
  const resultDiv = document.getElementById("uploadResult");
  btn.disabled = true;
  btn.textContent = "Uploading...";
  resultDiv.innerHTML = "";

  const formData = new FormData();
  formData.append("file", selectedFile);

  try {
    const headers = {};
    if (authToken) headers["Authorization"] = "Bearer " + authToken;
    const res = await fetch(
      API + "/items/upload-csv-async?mode=" + uploadMode,
      {
        method: "POST",
        headers,
        body: formData,
      },
    );
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(
        "Server returned invalid response. Hard refresh browser (Ctrl+F5), login again, and retry.",
      );
    }
    if (!res.ok) throw new Error(data.error || "Upload failed");

    const jobId = data.jobId;
    if (!jobId) throw new Error("Upload job was not created");

    while (true) {
      const status = await apiFetch(
        "/items/upload-csv-status/" + encodeURIComponent(jobId),
      );
      if (status.status === "processing") {
        const pct =
          status.total > 0
            ? Math.round((status.processed / status.total) * 100)
            : 0;
        btn.textContent = "Processing... " + pct + "%";
      }
      if (status.status === "done") {
        resultDiv.innerHTML =
          '<div class="alert alert-success">&#10004; Uploaded! ' +
          status.totalItems +
          " items on server. (Inserted: " +
          status.inserted +
          ", Updated: " +
          status.modified +
          ")</div>";
        loadStats();
        loadItems(1);
        selectedFile = null;
        document.getElementById("fileName").textContent = "";
        break;
      }
      if (status.status === "error") {
        throw new Error(status.error || "Upload failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (err) {
    resultDiv.innerHTML =
      '<div class="alert alert-error">&#10008; ' + err.message + "</div>";
  } finally {
    btn.disabled = false;
    btn.textContent = "\u{1F680} Upload & Push to Server";
  }
}

// --- Worker Sync Status ------------------------------------------------------
async function loadWorkerStatus(silent = false) {
  const container = document.getElementById("workerStatusContainer");
  if (!silent) {
    container.innerHTML = '<div class="loading">Loading...</div>';
  }
  try {
    const data = await apiFetch("/sync/worker-status");
    const workers = data.workers || [];
    if (workers.length === 0) {
      container.innerHTML =
        '<div class="loading">No sync activity recorded yet.</div>';
      return;
    }
    let html =
      "<table><thead><tr><th>Worker</th><th>Last Sync</th><th>Ago</th><th>Today</th></tr></thead><tbody>";
    workers.forEach((w) => {
      let color = "#4caf50";
      if (w.minutesAgo > 240) color = "#f44336";
      else if (w.minutesAgo > 30) color = "#ff9800";
      const ago =
        w.minutesAgo < 60
          ? w.minutesAgo + " min"
          : Math.round(w.minutesAgo / 60) + " hr";
      html +=
        "<tr><td>" +
        w.worker +
        "</td><td>" +
        new Date(w.lastSync).toLocaleTimeString() +
        "</td>";
      html +=
        '<td style="color:' + color + ';font-weight:bold">' + ago + "</td>";
      html += "<td>" + (w.totalToday || 0) + "</td></tr>";
    });
    html += "</tbody></table>";
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML =
      '<div class="alert alert-error">' + err.message + "</div>";
  }
}

// --- Column Config ------------------------------------------------------------
const DEFAULT_TX_COLS = [
  { key: "syncStatus", label: "Status", vis: true },
  { key: "Item_Code", label: "Item Code", vis: true },
  { key: "Item_Barcode", label: "Barcode", vis: true },
  { key: "Item_Name", label: "Item Name", vis: true },
  { key: "Frombin", label: "From Bin", vis: true },
  { key: "Tobin", label: "To Bin", vis: true },
  { key: "Qty", label: "Qty", vis: true },
  { key: "Worker_Name", label: "Worker", vis: true },
  { key: "Notes", label: "Notes", vis: true },
  { key: "processedBy", label: "Processed By", vis: false },
  { key: "processedAt", label: "Processed At", vis: false },
  { key: "erpDocument", label: "ERP Document", vis: false },
  { key: "erpBatch", label: "ERP Batch", vis: false },
  { key: "Timestamp", label: "Date/Time", vis: true },
];

let txCols = (() => {
  try {
    const saved = localStorage.getItem("txColConfig");
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_TX_COLS.map((c) => ({ ...c }));
})();

function saveTxCols() {
  localStorage.setItem("txColConfig", JSON.stringify(txCols));
}

let colConfigOpen = false;
function toggleColConfig() {
  colConfigOpen = !colConfigOpen;
  const panel = document.getElementById("colConfigPanel");
  panel.style.display = colConfigOpen ? "block" : "none";
  if (colConfigOpen) renderColConfig();
}

function renderColConfig() {
  const list = document.getElementById("colConfigList");
  list.innerHTML = "";
  txCols.forEach((col, idx) => {
    const item = document.createElement("div");
    item.draggable = true;
    item.dataset.idx = idx;
    item.style =
      "display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px 10px;cursor:grab;user-select:none";
    item.innerHTML =
      '<span style="color:#aaa;font-size:16px;cursor:grab">&#8801;</span>' +
      '<input type="checkbox" id="col_' +
      idx +
      '" ' +
      (col.vis ? "checked" : "") +
      ' onchange="toggleColVis(' +
      idx +
      ')">' +
      '<label for="col_' +
      idx +
      '" style="cursor:pointer;font-weight:600">' +
      esc(col.label) +
      "</label>";
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", idx);
      item.style.opacity = "0.4";
    });
    item.addEventListener("dragend", () => {
      item.style.opacity = "1";
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      item.style.borderColor = "#1565c0";
    });
    item.addEventListener("dragleave", () => {
      item.style.borderColor = "#ddd";
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.style.borderColor = "#ddd";
      const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
      const toIdx = parseInt(item.dataset.idx);
      if (fromIdx === toIdx) return;
      const moved = txCols.splice(fromIdx, 1)[0];
      txCols.splice(toIdx, 0, moved);
      saveTxCols();
      renderColConfig();
      filterTransactions();
    });
    list.appendChild(item);
  });
}

function toggleColVis(idx) {
  txCols[idx].vis = !txCols[idx].vis;
  saveTxCols();
  filterTransactions();
}

function resetColConfig() {
  txCols = DEFAULT_TX_COLS.map((c) => ({ ...c }));
  saveTxCols();
  renderColConfig();
  filterTransactions();
}

// --- Transactions ------------------------------------------------------------
let allTransactions = [];
let filteredTransactions = [];
let selectedIds = new Set();

function updateSelectionBar() {
  const bar = document.getElementById("txBulkBar");
  const countEl = document.getElementById("txBulkCount");
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.style.display = "flex";
    countEl.textContent =
      selectedIds.size +
      " row" +
      (selectedIds.size !== 1 ? "s" : "") +
      " selected";
  } else {
    bar.style.display = "none";
  }
}

function toggleTxRow(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelectionBar();
  const sa = document.getElementById("txSelectAll");
  if (sa) {
    const curIds = window._txCurPage || [];
    sa.checked = curIds.length > 0 && curIds.every((x) => selectedIds.has(x));
    sa.indeterminate = !sa.checked && curIds.some((x) => selectedIds.has(x));
  }
}

function toggleSelectAllTx(checked) {
  const curIds = window._txCurPage || [];
  curIds.forEach((id) => {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  document
    .querySelectorAll(".tx-row-check")
    .forEach((cb) => (cb.checked = checked));
  updateSelectionBar();
}

function clearTxSelection() {
  selectedIds.clear();
  document
    .querySelectorAll(".tx-row-check")
    .forEach((cb) => (cb.checked = false));
  const sa = document.getElementById("txSelectAll");
  if (sa) {
    sa.checked = false;
    sa.indeterminate = false;
  }
  updateSelectionBar();
}

async function markSelectedDone() {
  if (!selectedIds.size) return;
  await bulkSetTransactionStatus(
    [...selectedIds],
    selectedIds.size + " row(s)",
    "",
    "processed",
  );
  clearTxSelection();
}

async function reopenSelected() {
  if (!selectedIds.size) return;
  await bulkSetTransactionStatus(
    [...selectedIds],
    selectedIds.size + " row(s)",
    "",
    "pending",
  );
  clearTxSelection();
}

function populateEodWorkerSelect() {
  const sel = document.getElementById("eodWorkerSelect");
  if (!sel) return;
  const prev = sel.value;
  const workers = [
    ...new Set(
      allTransactions
        .filter(
          (tx) =>
            String(tx.syncStatus || "pending").toLowerCase() === "pending",
        )
        .map((t) => t.Worker_Name)
        .filter(Boolean),
    ),
  ].sort();
  sel.innerHTML =
    '<option value="">-- Select Worker --</option>' +
    workers
      .map(
        (w) =>
          '<option value="' +
          esc(w) +
          '"' +
          (w === prev ? " selected" : "") +
          ">" +
          esc(w) +
          " (" +
          allTransactions.filter(
            (tx) =>
              tx.Worker_Name === w &&
              String(tx.syncStatus || "pending").toLowerCase() === "pending",
          ).length +
          ")</option>",
      )
      .join("");
}

async function downloadWorkerEOD(format) {
  const worker = document.getElementById("eodWorkerSelect")?.value;
  const resultDiv = document.getElementById("eodResult");
  if (!worker) {
    resultDiv.innerHTML =
      '<div class="alert alert-error">Select a worker first.</div>';
    return;
  }
  const workerTxs = allTransactions.filter(
    (tx) =>
      tx.Worker_Name === worker &&
      String(tx.syncStatus || "pending").toLowerCase() === "pending",
  );
  if (!workerTxs.length) {
    resultDiv.innerHTML =
      '<div class="alert alert-error">No pending transactions for ' +
      esc(worker) +
      ".</div>";
    return;
  }
  const erpDetails = collectErpDetails();
  if (erpDetails === null) return;
  const filename = nextExportFilename(worker) + "." + format;
  if (format === "xlsx" && typeof XLSX !== "undefined") {
    const headers = [
      "Worker",
      "Date",
      "Barcode",
      "ItemCode",
      "ItemName",
      "From",
      "To",
      "Qty",
      "Notes",
    ];
    const aoa = [
      headers,
      ...workerTxs.map((r) => [
        r.Worker_Name || "",
        r.Timestamp ? new Date(r.Timestamp).toLocaleString() : "",
        r.Item_Barcode || "",
        r.Item_Code || "",
        r.Item_Name || "",
        r.Frombin || "",
        r.Tobin || "",
        r.Qty ?? "",
        r.Notes || "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, filename);
  } else {
    const url =
      API +
      "/transactions/export?worker=" +
      encodeURIComponent(worker) +
      "&status=pending";
    fetch(url, { headers: { Authorization: "Bearer " + authToken } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
      });
  }
  try {
    const workerIds = workerTxs.map((tx) => tx._id);
    const data = await apiFetch("/transactions/bulk-status", {
      method: "POST",
      body: JSON.stringify({
        ids: workerIds,
        status: "processed",
        fromStatus: "all",
        ...erpDetails,
      }),
    });
    resultDiv.innerHTML =
      '<div class="alert alert-success">&#10004; Exported and marked ' +
      (data.updated || workerIds.length) +
      " transaction(s) as done for " +
      esc(worker) +
      ".</div>";
    await Promise.all([loadTransactions(), loadStats()]);
  } catch (err) {
    resultDiv.innerHTML =
      '<div class="alert alert-error">' + esc(err.message) + "</div>";
  }
}

async function markWorkerDoneOnly() {
  const worker = document.getElementById("eodWorkerSelect")?.value;
  const resultDiv = document.getElementById("eodResult");
  if (!worker) {
    resultDiv.innerHTML =
      '<div class="alert alert-error">Select a worker first.</div>';
    return;
  }
  const ids = allTransactions
    .filter(
      (tx) =>
        tx.Worker_Name === worker &&
        String(tx.syncStatus || "pending").toLowerCase() === "pending",
    )
    .map((tx) => tx._id);
  if (!ids.length) {
    resultDiv.innerHTML =
      '<div class="alert alert-error">No pending transactions for ' +
      esc(worker) +
      ".</div>";
    return;
  }
  await bulkSetTransactionStatus(ids, worker, worker, "processed");
}

async function loadTransactions(silent = false) {
  const container = document.getElementById("txContainer");
  if (!silent) {
    container.innerHTML = '<div class="loading">Loading transactions...</div>';
  }
  try {
    const status =
      document.getElementById("txStatusFilter")?.value || "pending";
    // Fetch ALL pages to get every transaction
    let all = [];
    let page = 1;
    while (true) {
      const data = await apiFetch(
        "/transactions?page=" +
          page +
          "&limit=200&status=" +
          encodeURIComponent(status),
      );
      all = all.concat(data.transactions || []);
      if (all.length >= (data.total || 0)) break;
      page++;
      if (page > 100) break; // safety
    }
    allTransactions = all;
    // Populate worker filter dropdown (keep current selection)
    const workers = [
      ...new Set(all.map((t) => t.Worker_Name).filter(Boolean)),
    ].sort();
    const sel = document.getElementById("txWorkerFilter");
    const prevVal = sel.value;
    sel.innerHTML =
      '<option value="">All Workers (' +
      all.length +
      ")</option>" +
      workers
        .map((w) => {
          const cnt = all.filter((t) => t.Worker_Name === w).length;
          return (
            '<option value="' +
            esc(w) +
            '"' +
            (w === prevVal ? " selected" : "") +
            ">" +
            esc(w) +
            " (" +
            cnt +
            ")</option>"
          );
        })
        .join("");
    // Default to All Workers on first load
    if (!prevVal) sel.value = "";
    // Apply filters & render
    filterTransactions();
  } catch (err) {
    container.innerHTML =
      '<div class="alert alert-error">' + err.message + "</div>";
  }
}

function filterTransactions() {
  const workerFilter = document.getElementById("txWorkerFilter").value;
  const search = (
    document.getElementById("txSearch").value || ""
  ).toLowerCase();
  filteredTransactions = allTransactions.filter((tx) => {
    if (workerFilter && tx.Worker_Name !== workerFilter) return false;
    if (search) {
      const hay = [
        tx.Item_Code,
        tx.Item_Barcode,
        tx.Item_Name,
        tx.Frombin,
        tx.Tobin,
        tx.Worker_Name,
        tx.erpDocument,
        tx.erpBatch,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  renderTransactions(filteredTransactions);
  populateEodWorkerSelect();
}

function txStatusBadge(tx) {
  const status = String(tx.syncStatus || "pending").toLowerCase();
  const colors = {
    pending: "#ef6c00",
    processed: "#2e7d32",
    archived: "#6d4c41",
  };
  const bg = colors[status] || "#607d8b";
  return (
    '<td><span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:' +
    bg +
    "18;color:" +
    bg +
    ';font-weight:700;font-size:12px;text-transform:capitalize">' +
    esc(status) +
    "</span></td>"
  );
}

function txCellValue(tx, key) {
  if (key === "syncStatus") {
    return txStatusBadge(tx);
  }
  if (key === "Timestamp") {
    return tx.Timestamp
      ? '<td style="white-space:nowrap">' +
          esc(new Date(tx.Timestamp).toLocaleString()) +
          "</td>"
      : "<td></td>";
  }
  if (key === "processedAt") {
    return tx.processedAt
      ? '<td style="white-space:nowrap">' +
          esc(new Date(tx.processedAt).toLocaleString()) +
          "</td>"
      : "<td></td>";
  }
  if (key === "processedBy") {
    return "<td>" + esc(tx.processedBy || "") + "</td>";
  }
  if (key === "erpDocument") {
    return "<td>" + esc(tx.erpDocument || "") + "</td>";
  }
  if (key === "erpBatch") {
    return "<td>" + esc(tx.erpBatch || "") + "</td>";
  }
  if (key === "Qty")
    return "<td>" + (tx.Qty !== undefined ? tx.Qty : "") + "</td>";
  return "<td>" + esc(tx[key] || "") + "</td>";
}

function collectErpDetails(existingTx) {
  const documentValue = prompt(
    "ERP document / reference (optional):",
    existingTx?.erpDocument || "",
  );
  if (documentValue === null) return null;

  const batchValue = prompt(
    "ERP batch / batch number (optional):",
    existingTx?.erpBatch || "",
  );
  if (batchValue === null) return null;

  return {
    erpDocument: String(documentValue || "")
      .trim()
      .toUpperCase(),
    erpBatch: String(batchValue || "")
      .trim()
      .toUpperCase(),
  };
}

function renderTransactions(txs) {
  const container = document.getElementById("txContainer");
  if (txs.length === 0) {
    container.innerHTML = '<div class="loading">No transactions found.</div>';
    return;
  }
  const visibleCols = txCols.filter((c) => c.vis);
  const pageSize = 50;
  const pages = Math.ceil(txs.length / pageSize);
  let page = 1;
  function render() {
    const start = (page - 1) * pageSize;
    const slice = txs.slice(start, start + pageSize);
    window._txCurPage = slice.map((tx) => String(tx._id || "")).filter(Boolean);
    let html =
      '<div class="preview-count" style="display:flex;justify-content:space-between;align-items:center">Showing ' +
      (start + 1) +
      "�" +
      (start + slice.length) +
      " of " +
      txs.length +
      " transactions</div>";
    html += '<div style="overflow-x:auto"><table id="txTable"><thead><tr>';
    html +=
      '<th style="width:32px;padding:8px 6px"><input type="checkbox" id="txSelectAll" title="Select all on this page" onchange="toggleSelectAllTx(this.checked)"></th>';
    visibleCols.forEach((c) => {
      html += "<th>" + esc(c.label) + "</th>";
    });
    html += "<th>Copy</th><th>Action</th></tr></thead><tbody>";
    slice.forEach((tx, i) => {
      const idx = start + i;
      const txId = String(tx._id || "");
      const isChecked = selectedIds.has(txId);
      html += "<tr>";
      html +=
        '<td style="padding:6px"><input type="checkbox" class="tx-row-check" value="' +
        txId +
        '" ' +
        (isChecked ? "checked" : "") +
        " onchange=\"toggleTxRow('" +
        txId.replace(/'/g, "") +
        "',this.checked)\"></td>";
      visibleCols.forEach((c) => {
        html += txCellValue(tx, c.key);
      });
      html +=
        '<td><button class="copy-icon-btn" onclick="copyRow(' +
        idx +
        ', this)" title="Copy this row"><svg class="copy-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"></polyline></svg></button></td>';
      const actionLabel =
        String(tx.syncStatus || "pending").toLowerCase() === "pending"
          ? "Done"
          : "Reopen";
      html +=
        '<td><button class="copy-icon-btn" style="color:#1565c0;border-color:#c7daf8" onclick="setTxRowStatus(' +
        idx +
        ', this)" title="Update this row status">' +
        actionLabel +
        "</button></td>";
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    if (pages > 1) {
      html += '<div class="pagination">';
      html +=
        "<button " +
        (page <= 1 ? "disabled" : "") +
        ' onclick="txPage(' +
        (page - 1) +
        ')">Prev</button>';
      html += '<span style="padding:6px;">' + page + " / " + pages + "</span>";
      html +=
        "<button " +
        (page >= pages ? "disabled" : "") +
        ' onclick="txPage(' +
        (page + 1) +
        ')">Next</button>';
      html += "</div>";
    }
    container.innerHTML = html;
    const sa = document.getElementById("txSelectAll");
    if (sa && window._txCurPage.length > 0) {
      sa.checked = window._txCurPage.every((x) => selectedIds.has(x));
      sa.indeterminate =
        !sa.checked && window._txCurPage.some((x) => selectedIds.has(x));
    }
    updateSelectionBar();
  }
  window.txPage = function (p) {
    page = p;
    render();
  };
  render();
}

function copyRow(idx, btnEl) {
  const tx = filteredTransactions[idx];
  if (!tx) return;
  const visibleCols = txCols.filter((c) => c.vis);
  const text = visibleCols
    .map((c) => {
      if (c.key === "Timestamp")
        return tx.Timestamp ? new Date(tx.Timestamp).toLocaleString() : "";
      return String(tx[c.key] !== undefined ? tx[c.key] : "");
    })
    .join("\t");
  copyToClip(text);
  flashCopyBtn(btnEl);
}

function copyToClip(text) {
  // Works on HTTP (non-secure) contexts too
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function flashCopyBtn(btnEl) {
  btnEl.classList.add("copied");
  const label = btnEl.querySelector(".copy-label");
  if (label) label.textContent = "Copied!";
  setTimeout(() => {
    btnEl.classList.remove("copied");
    if (label) label.textContent = "Copy";
  }, 1500);
}

async function setTxRowStatus(idx, btnEl) {
  const tx = filteredTransactions[idx];
  if (!tx || !tx._id) return;

  const currentStatus = String(tx.syncStatus || "pending").toLowerCase();
  const nextStatus = currentStatus === "pending" ? "processed" : "pending";
  const actionText =
    nextStatus === "processed" ? "mark as processed" : "reopen";

  const ok = confirm(
    "Do you want to " +
      actionText +
      " this transaction?\n\n" +
      (tx.Item_Code || "") +
      " | " +
      (tx.Item_Name || "") +
      "\n" +
      (tx.Frombin || "") +
      " -> " +
      (tx.Tobin || "") +
      " | Qty: " +
      (tx.Qty || ""),
  );
  if (!ok) return;

  const erpDetails =
    nextStatus === "processed"
      ? collectErpDetails(tx)
      : { erpDocument: "", erpBatch: "" };
  if (erpDetails === null) return;

  const original = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = nextStatus === "processed" ? "Saving..." : "Reopening...";
  try {
    await apiFetch("/transactions/bulk-status", {
      method: "POST",
      body: JSON.stringify({
        ids: [tx._id],
        status: nextStatus,
        fromStatus: "all",
        ...erpDetails,
      }),
    });
    await Promise.all([loadTransactions(), loadStats(), loadWorkerStatus()]);
  } catch (err) {
    alert("Status update failed: " + err.message);
    btnEl.disabled = false;
    btnEl.textContent = original;
  }
}

async function bulkSetTransactionStatus(ids, label, workerName, status) {
  const safeIds = (ids || []).filter(Boolean);
  if (safeIds.length === 0 && !workerName) {
    alert("No matching transactions found.");
    return;
  }

  const actionText = status === "processed" ? "mark as processed" : "reopen";

  const confirmMsg =
    "Do you want to " +
    actionText +
    " " +
    safeIds.length +
    " transaction(s)" +
    (label ? " for " + label : "") +
    "?";
  if (!confirm(confirmMsg)) return;

  const erpDetails =
    status === "processed"
      ? collectErpDetails()
      : { erpDocument: "", erpBatch: "" };
  if (erpDetails === null) return;

  try {
    const body = workerName
      ? { worker: workerName, status, fromStatus: "all", ...erpDetails }
      : { ids: safeIds, status, fromStatus: "all", ...erpDetails };
    const data = await apiFetch("/transactions/bulk-status", {
      method: "POST",
      body: JSON.stringify(body),
    });
    await Promise.all([loadTransactions(), loadStats(), loadWorkerStatus()]);
    alert((data.updated || 0) + " transaction(s) updated.");
  } catch (err) {
    alert("Bulk status change failed: " + err.message);
  }
}

async function markFilteredProcessed() {
  await bulkSetTransactionStatus(
    filteredTransactions.map((tx) => tx._id),
    "current filter",
    "",
    "processed",
  );
}

async function reopenFilteredTransactions() {
  await bulkSetTransactionStatus(
    filteredTransactions.map((tx) => tx._id),
    "current filter",
    "",
    "pending",
  );
}

async function markWorkerProcessed() {
  const worker = document.getElementById("txWorkerFilter").value;
  if (!worker) {
    alert("Select a worker first from the dropdown.");
    return;
  }
  const workerIds = allTransactions
    .filter((tx) => tx.Worker_Name === worker)
    .map((tx) => tx._id);
  await bulkSetTransactionStatus(workerIds, worker, worker, "processed");
}

function copyTransactionsToClipboard() {
  const txs = filteredTransactions;
  if (txs.length === 0) {
    alert("No transactions to copy.");
    return;
  }
  const visibleCols = txCols.filter((c) => c.vis);
  let text = visibleCols.map((c) => c.label).join("\t") + "\n";
  txs.forEach((tx) => {
    text +=
      visibleCols
        .map((c) => {
          if (c.key === "Timestamp")
            return tx.Timestamp ? new Date(tx.Timestamp).toLocaleString() : "";
          return String(tx[c.key] !== undefined ? tx[c.key] : "");
        })
        .join("\t") + "\n";
  });
  copyToClip(text);
  flashCopyBtn(document.getElementById("copyAllBtn"));
}

// --- Smart export filename -------------------------------------------------
function todayStr() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function nextExportFilename(workerFilter) {
  const date = todayStr();
  const safe = (adminUsername || "admin").replace(/[^a-zA-Z0-9_-]/g, "_");
  const base = workerFilter
    ? `${safe}_${date}_${workerFilter.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    : `${safe}_${date}`;
  const key = `exportCount_${base}`;
  const n = parseInt(localStorage.getItem(key) || "0", 10);
  localStorage.setItem(key, String(n + 1));
  return n === 0 ? base : `${base}_${n}`;
}

function downloadTransactionsCSV(format = "csv") {
  const workerFilter = document.getElementById("txWorkerFilter").value;
  const statusFilter =
    document.getElementById("txStatusFilter")?.value || "pending";
  let url = API + "/transactions/export";
  const params = new URLSearchParams();
  if (workerFilter) params.set("worker", workerFilter);
  params.set("status", statusFilter);
  url += "?" + params.toString();
  const filename = nextExportFilename(workerFilter) + "." + format;

  if (format === "xlsx" && typeof XLSX !== "undefined") {
    // Fetch JSON rows then build XLSX in the browser
    fetch(url + "&json=1", {
      headers: { Authorization: "Bearer " + authToken },
    })
      .then((r) => r.json())
      .then((data) => {
        // data may be [{...}] or {transactions:[...]}
        const rows = Array.isArray(data) ? data : data.transactions || [];
        if (!rows.length) {
          alert("No transactions to export.");
          return;
        }
        const headers = [
          "Status",
          "ProcessedAt",
          "ProcessedBy",
          "ERPDocument",
          "ERPBatch",
          "Worker",
          "Date",
          "Barcode",
          "ItemCode",
          "ItemName",
          "From",
          "To",
          "Qty",
          "Notes",
        ];
        const aoa = [
          headers,
          ...rows.map((r) => [
            r.syncStatus || "pending",
            r.processedAt ? new Date(r.processedAt).toLocaleString() : "",
            r.processedBy || "",
            r.erpDocument || "",
            r.erpBatch || "",
            r.Worker_Name || r.worker_name || "",
            r.Timestamp
              ? new Date(r.Timestamp).toLocaleString()
              : r.timestamp
                ? new Date(r.timestamp).toLocaleString()
                : "",
            r.Item_Barcode || r.item_barcode || "",
            r.Item_Code || r.item_code || "",
            r.Item_Name || r.item_name || "",
            r.Frombin || r.frombin || "",
            r.Tobin || r.tobin || "",
            r.Qty ?? r.qty ?? "",
            r.Notes || r.notes || "",
          ]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Transactions");
        XLSX.writeFile(wb, filename);
      })
      .catch((err) => alert("XLSX export failed: " + err.message));
  } else {
    // Standard CSV download
    fetch(url, { headers: { Authorization: "Bearer " + authToken } })
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => alert("Export failed: " + err.message));
  }
}

// --- Users --------------------------------------------------------------------
let pinResetTargetUser = "";

async function loadUsers() {
  const container = document.getElementById("usersContainer");
  container.innerHTML = '<div class="loading">Loading users...</div>';
  try {
    const data = await apiFetch("/auth/users");
    const users = data.users || [];
    if (users.length === 0) {
      container.innerHTML = '<div class="loading">No users found.</div>';
      return;
    }
    let html = "";
    users.forEach((u) => {
      const initials = u.username.substring(0, 2).toUpperCase();
      const avClass = u.role === "admin" ? "admin-av" : "worker-av";
      const dateStr = u.createdAt
        ? new Date(u.createdAt).toLocaleDateString()
        : "";
      html += '<div class="user-card">';
      html += '<div class="user-card-header">';
      html +=
        '<div class="user-avatar ' + avClass + '">' + esc(initials) + "</div>";
      html += '<div class="user-info">';
      html +=
        '<div class="name">' +
        esc(u.username) +
        ' <span class="role-badge ' +
        u.role +
        '">' +
        u.role.toUpperCase() +
        "</span></div>";
      html += '<div class="meta">Joined ' + dateStr + "</div>";
      html += "</div>";
      html += "</div>";
      html += '<div class="user-card-actions">';
      html +=
        '<button class="btn-sm" style="background:#e3f2fd;color:#1565c0" onclick="openPinModal(\'' +
        esc(u.username).replace(/'/g, "\\'") +
        "')\">&#128273; Reset PIN</button>";
      html +=
        '<button class="btn-sm" style="background:#fff3e0;color:#e65100" onclick="deleteUserDataOnly(\'' +
        esc(u.username).replace(/'/g, "\\'") +
        "')\">&#128451; Archive Data</button>";
      if (u.role !== "admin") {
        html +=
          '<button class="btn-sm" style="background:#fce4ec;color:#c62828" onclick="deleteUserOnly(\'' +
          esc(u.username).replace(/'/g, "\\'") +
          "')\">&#128100; Delete User</button>";
        html +=
          '<button class="btn-sm" style="background:#d32f2f;color:#fff" onclick="deleteUserAndData(\'' +
          esc(u.username).replace(/'/g, "\\'") +
          "')\">&#128465; Delete User + Data</button>";
      }
      html += "</div>";
      html += "</div>";
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML =
      '<div class="alert alert-error">' + err.message + "</div>";
  }
}

function openPinModal(username) {
  pinResetTargetUser = username;
  document.getElementById("pinModalUser").textContent = username;
  document.getElementById("pinModalUser2").textContent = username;
  document.getElementById("pinConfirmCheck").checked = false;
  document.getElementById("pinConfirmBtn").disabled = true;
  document.getElementById("pinNewInput").value = "";
  document.getElementById("pinConfirmInput").value = "";
  document.getElementById("pinResultMsg").innerHTML = "";
  document.getElementById("pinSaveBtn").disabled = false;
  document.getElementById("pinStep1").classList.add("active");
  document.getElementById("pinStep2").classList.remove("active");
  document.getElementById("pinFooterStep1").style.display = "flex";
  document.getElementById("pinFooterStep2").style.display = "none";
  document.getElementById("pinResetOverlay").classList.add("open");
}

function closePinModal() {
  document.getElementById("pinResetOverlay").classList.remove("open");
  pinResetTargetUser = "";
}

function goToPinStep2() {
  document.getElementById("pinStep1").classList.remove("active");
  document.getElementById("pinStep2").classList.add("active");
  document.getElementById("pinFooterStep1").style.display = "none";
  document.getElementById("pinFooterStep2").style.display = "flex";
  document.getElementById("pinResultMsg").innerHTML = "";
  setTimeout(function () {
    document.getElementById("pinNewInput").focus();
  }, 100);
}

async function savePinReset() {
  const pin = (document.getElementById("pinNewInput").value || "").trim();
  const confirmPin = (
    document.getElementById("pinConfirmInput").value || ""
  ).trim();
  const msg = document.getElementById("pinResultMsg");
  msg.innerHTML = "";
  if (!pin || pin.length < 4) {
    msg.innerHTML =
      '<span style="color:#c62828">&#9888; PIN must be at least 4 digits.</span>';
    document.getElementById("pinNewInput").focus();
    return;
  }
  if (pin !== confirmPin) {
    msg.innerHTML =
      '<span style="color:#c62828">&#9888; PINs do not match. Please re-enter.</span>';
    document.getElementById("pinConfirmInput").focus();
    return;
  }
  document.getElementById("pinSaveBtn").disabled = true;
  try {
    await apiFetch(
      "/auth/users/" + encodeURIComponent(pinResetTargetUser) + "/reset-pin",
      { method: "POST", body: JSON.stringify({ pin }) },
    );
    msg.innerHTML =
      '<span style="color:#2e7d32">&#10004; PIN reset successfully for <strong>' +
      esc(pinResetTargetUser) +
      "</strong>!</span>";
    setTimeout(function () {
      closePinModal();
    }, 1500);
  } catch (err) {
    msg.innerHTML =
      '<span style="color:#c62828">&#9888; ' + esc(err.message) + "</span>";
    document.getElementById("pinSaveBtn").disabled = false;
  }
}

async function createUser() {
  const username = document.getElementById("newUserName").value.trim();
  const pin = document.getElementById("newUserPin").value.trim();
  const role = document.getElementById("newUserRole").value;
  const result = document.getElementById("userCreateResult");
  result.innerHTML = "";
  if (!username || !pin) {
    result.innerHTML =
      '<div class="alert alert-error">Username and PIN are required.</div>';
    return;
  }
  if (pin.length < 4) {
    result.innerHTML =
      '<div class="alert alert-error">PIN must be at least 4 digits.</div>';
    return;
  }
  try {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, pin, role }),
    });
    result.innerHTML =
      '<div class="alert alert-success">User created: ' +
      esc(data.username) +
      " (" +
      esc(data.role) +
      ")</div>";
    document.getElementById("newUserName").value = "";
    document.getElementById("newUserPin").value = "";
    await Promise.allSettled([loadUsers(), loadStats()]);
  } catch (err) {
    result.innerHTML =
      '<div class="alert alert-error">' + esc(err.message) + "</div>";
  }
}

async function deleteUserOnly(username) {
  if (!confirm("Delete user '" + username + "'?")) return;
  try {
    await apiFetch("/auth/users/" + encodeURIComponent(username), {
      method: "DELETE",
    });
    await Promise.all([loadUsers(), loadStats()]);
    alert("User deleted.");
  } catch (err) {
    alert("Delete user failed: " + err.message);
  }
}

async function deleteUserDataOnly(username) {
  if (
    !confirm(
      "Archive all transaction data for '" +
        username +
        "'? Archived data stays available for audit.",
    )
  )
    return;
  try {
    const data = await apiFetch("/transactions/bulk-status", {
      method: "POST",
      body: JSON.stringify({
        worker: username,
        status: "archived",
        fromStatus: "all",
      }),
    });
    await Promise.all([loadTransactions(), loadStats(), loadWorkerStatus()]);
    alert(
      (data.updated || 0) + " transaction(s) archived for " + username + ".",
    );
  } catch (err) {
    alert("Archive user data failed: " + err.message);
  }
}

async function deleteUserAndData(username) {
  if (
    !confirm(
      "Delete user '" +
        username +
        "' and archive all of their transactions first?",
    )
  )
    return;
  try {
    await apiFetch("/transactions/bulk-status", {
      method: "POST",
      body: JSON.stringify({
        worker: username,
        status: "archived",
        fromStatus: "all",
      }),
    });
    await apiFetch("/auth/users/" + encodeURIComponent(username), {
      method: "DELETE",
    });
    await Promise.all([
      loadUsers(),
      loadTransactions(),
      loadStats(),
      loadWorkerStatus(),
    ]);
    alert("User deleted. Their transactions were archived.");
  } catch (err) {
    alert("Delete user + archive data failed: " + err.message);
  }
}

// --- Items List --------------------------------------------------------------
async function loadItems(page = 1) {
  const container = document.getElementById("itemsContainer");
  container.innerHTML = '<div class="loading">Loading items...</div>';
  try {
    const q = (document.getElementById("itemsSearch")?.value || "").trim();
    const data = await apiFetch(
      "/items?paginated=1&page=" +
        page +
        "&limit=50" +
        (q ? "&q=" + encodeURIComponent(q) : ""),
    );
    currentItemsPage = data.page || 1;
    currentItemsPages = Math.max(
      1,
      Math.ceil((data.total || 0) / (data.limit || 50)),
    );
    renderItems(data.items || [], data.total || 0);
  } catch (err) {
    container.innerHTML =
      '<div class="alert alert-error">' + err.message + "</div>";
  }
}

function renderItems(items, total) {
  const container = document.getElementById("itemsContainer");
  if (items.length === 0) {
    container.innerHTML =
      '<div class="loading">No items found. Upload a CSV to get started.</div>';
    return;
  }
  const start = (currentItemsPage - 1) * 50;
  let html =
    '<div class="preview-count">Showing ' +
    (start + 1) +
    "�" +
    (start + items.length) +
    " of " +
    total +
    "</div>";
  html +=
    "<table><thead><tr><th>#</th><th>ItemCode</th><th>Barcode</th><th>Item Name</th></tr></thead><tbody>";
  items.forEach((it, i) => {
    html +=
      "<tr><td>" +
      (start + i + 1) +
      "</td><td>" +
      esc(it.ItemCode) +
      "</td><td>" +
      esc(it.Barcode) +
      "</td><td>" +
      esc(it.Item_Name) +
      "</td></tr>";
  });
  html += "</tbody></table>";
  if (currentItemsPages > 1) {
    html += '<div class="pagination">';
    html +=
      "<button " +
      (currentItemsPage <= 1 ? "disabled" : "") +
      ' onclick="loadItems(' +
      (currentItemsPage - 1) +
      ')">Prev</button>';
    html +=
      '<span style="padding:6px;">' +
      currentItemsPage +
      " / " +
      currentItemsPages +
      "</span>";
    html +=
      "<button " +
      (currentItemsPage >= currentItemsPages ? "disabled" : "") +
      ' onclick="loadItems(' +
      (currentItemsPage + 1) +
      ')">Next</button>';
    html += "</div>";
  }
  container.innerHTML = html;
}

function esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// --- Danger Zone -------------------------------------------------------------
async function clearAllItems() {
  if (!confirm("DELETE ALL ITEMS from the server? This cannot be undone!"))
    return;
  try {
    await apiFetch("/items/all", { method: "DELETE" });
    loadStats();
    loadItems(1);
    alert("All items deleted.");
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function clearAllTransactions() {
  alert(
    "Hard delete is disabled for safety. Use Mark Done, Reopen, or Archive workflows instead.",
  );
}

// --- Init --------------------------------------------------------------------
async function init() {
  if (authToken) {
    try {
      await apiFetch("/auth/users");
      showPanel();
      return;
    } catch {
      doLogout();
    }
  }
  checkSetup();
}
init();

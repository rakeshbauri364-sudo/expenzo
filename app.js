
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const config = window.EXPENSEBOOK_CONFIG || {};

  const hasSupabase = Boolean(
    window.supabase &&
    config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY
  );

  const sb = hasSupabase
    ? window.supabase.createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY
      )
    : null;

  const KEYS = {
    tx: "expenzo_transactions_v1",
    budgets: "expenzo_budgets_v1",
    lang: "expenzo_language_v1"
  };

  let mode = "offline";
  let user = null;
  let rows = [];
  let editingId = null;
  let busy = false;
  let language = localStorage.getItem(KEYS.lang) || "hi";

  const words = {
    hi: {
      income: "कमाई",
      expense: "खर्च",
      lend: "उधार दिया",
      borrow: "उधार लिया",
      repay: "उधार वापसी",
      other: "अन्य",
      save: "रिकॉर्ड सेव करें",
      update: "रिकॉर्ड अपडेट करें",
      edit: "Edit",
      delete: "हटाएँ",
      noRecords: "कोई रिकॉर्ड नहीं मिला।",
      invalidAmount: "राशि 0 से अधिक होनी चाहिए।",
      saved: "रिकॉर्ड सेव हो गया।",
      updated: "रिकॉर्ड अपडेट हो गया।",
      deleted: "रिकॉर्ड हटा दिया गया।",
      confirmDelete: "क्या यह रिकॉर्ड हटाना है?",
      offline: "ऑफलाइन मोड",
      cloud: "क्लाउड से कनेक्ट है",
      language: "English",
      budget: "बजट",
      spent: "खर्च",
      remaining: "शेष",
      budgetSet: "इस महीने का बजट सेट करें।",
      noExport: "एक्सपोर्ट करने के लिए रिकॉर्ड नहीं हैं।",
      error: "समस्या: ",
      lentDue: "आपको वापस मिलने हैं",
      borrowedDue: "आपको वापस देने हैं"
    },
    en: {
      income: "Income",
      expense: "Expense",
      lend: "Lent",
      borrow: "Borrowed",
      repay: "Repayment",
      other: "Other",
      save: "Save Record",
      update: "Update Record",
      edit: "Edit",
      delete: "Delete",
      noRecords: "No records found.",
      invalidAmount: "Amount must be greater than zero.",
      saved: "Record saved.",
      updated: "Record updated.",
      deleted: "Record deleted.",
      confirmDelete: "Delete this record?",
      offline: "Offline mode",
      cloud: "Connected to cloud",
      language: "हिन्दी",
      budget: "Budget",
      spent: "Spent",
      remaining: "Remaining",
      budgetSet: "Set a budget for this month.",
      noExport: "No records to export.",
      error: "Error: ",
      lentDue: "Owed to you",
      borrowedDue: "You owe"
    }
  };

  const tr = key =>
    words[language]?.[key] || words.en[key] || key;

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const currentMonth = () => today().slice(0, 7);

  const money = value =>
    new Intl.NumberFormat(
      language === "hi" ? "hi-IN" : "en-IN",
      {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2
      }
    ).format(Number(value) || 0);

  const uid = () =>
    window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);

  function getLocal(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setLocal(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function localRows() {
    const data = getLocal(KEYS.tx, []);
    return Array.isArray(data) ? data : [];
  }

  function saveLocalRows(data) {
    setLocal(KEYS.tx, data);
  }

  function toast(message) {
    const el = $("toast");
    if (!el) {
      alert(message);
      return;
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(
      () => el.classList.remove("show"),
      3000
    );
  }

  function setMessage(id, message, error = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("error", error);
  }

  function setSync(message, state = "") {
    const el = $("syncStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `sync-status ${state}`;
  }

  function showApp(show, label = "") {
    $("authPanel")?.classList.toggle("hidden", show);
    $("appPanel")?.classList.toggle("hidden", !show);
    $("logoutBtn")?.classList.toggle(
      "hidden",
      !show || mode !== "online"
    );
    if ($("userEmail")) $("userEmail").textContent = label;
  }

  function monthRows() {
    const month = $("monthFilter")?.value || currentMonth();
    return rows.filter(
      r => String(r.entry_date || "").slice(0, 7) === month
    );
  }

  function visibleRows() {
    const query = ($("recordSearch")?.value || "")
      .trim().toLowerCase();

    const type = $("recordTypeFilter")?.value || "all";
    const from = $("filterFrom")?.value || "";
    const to = $("filterTo")?.value || "";

    return monthRows().filter(r => {
      const haystack = [
        r.category,
        r.note,
        r.person,
        r.entry_date,
        r.type
      ].join(" ").toLowerCase();

      return (
        (type === "all" || r.type === type) &&
        haystack.includes(query) &&
        (!from || r.entry_date >= from) &&
        (!to || r.entry_date <= to)
      );
    });
  }

  // व्यक्ति के नाम से उधार और वापसी का हिसाब।
  function calculate(list) {
    let income = 0;
    let expenses = 0;
    let cashChange = 0;
    const balances = new Map();

    for (const r of list) {
      const amount = Number(r.amount) || 0;
      const person = String(r.person || "")
        .trim().toLocaleLowerCase() || "__unknown__";

      if (r.type === "income") {
        income += amount;
        cashChange += amount;
      } else if (r.type === "expense") {
        expenses += amount;
        cashChange -= amount;
      } else if (r.type === "lend") {
        cashChange -= amount;
        balances.set(person, (balances.get(person) || 0) + amount);
      } else if (r.type === "borrow") {
        cashChange += amount;
        balances.set(person, (balances.get(person) || 0) - amount);
      } else if (r.type === "repay") {
        if (r.repay_direction === "received") {
          cashChange += amount;
          balances.set(person, (balances.get(person) || 0) - amount);
        } else {
          cashChange -= amount;
          balances.set(person, (balances.get(person) || 0) + amount);
        }
      }
    }

    let lentDue = 0;
    let borrowedDue = 0;

    for (const balance of balances.values()) {
      if (balance > 0) lentDue += balance;
      else borrowedDue += Math.abs(balance);
    }

    return { income, expenses, cashChange, lentDue, borrowedDue };
  }

  function render() {
    const selectedMonth = monthRows();

    if ($("totalIncome")) {
      $("totalIncome").textContent = money(
        selectedMonth
          .filter(r => r.type === "income")
          .reduce((sum, r) => sum + Number(r.amount || 0), 0)
      );
    }

    if ($("totalExpense")) {
      $("totalExpense").textContent = money(
        selectedMonth
          .filter(r => r.type === "expense")
          .reduce((sum, r) => sum + Number(r.amount || 0), 0)
      );
    }

    if ($("balance")) {
      $("balance").textContent = money(calculate(selectedMonth).cashChange);
    }

    if ($("recordCount")) {
      $("recordCount").textContent =
        `${visibleRows().length} ${language === "hi" ? "रिकॉर्ड" : "records"}`;
    }

    const host = $("records");

    if (host) {
      const shown = visibleRows();

      host.innerHTML = shown.length
        ? shown.map(r => {
            const positive =
              r.type === "income" ||
              r.type === "borrow" ||
              (r.type === "repay" && r.repay_direction === "received");

            const amountClass =
              r.type === "income" ? "amount-income" :
              r.type === "expense" ? "amount-expense" :
              "amount-other";

            const detail = [r.person, r.note]
              .filter(Boolean)
              .join(" · ");

            return `
              <article class="record">
                <div class="record-main">
                  <div class="record-title">
                    ${escapeHTML(r.category || tr("other"))}
                    · ${escapeHTML(tr(r.type))}
                  </div>
                  <div class="record-sub">
                    ${escapeHTML(r.entry_date || "")}
                    ${detail ? " · " + escapeHTML(detail) : ""}
                  </div>
                </div>
                <div class="record-right">
                  <strong class="${amountClass}">
                    ${positive ? "+" : "−"}${money(r.amount)}
                  </strong><br>
                  <button type="button" class="secondary"
                    data-edit="${escapeHTML(r.id)}">
                    ${escapeHTML(tr("edit"))}
                  </button>
                  <button type="button" class="delete"
                    data-delete="${escapeHTML(r.id)}">
                    ${escapeHTML(tr("delete"))}
                  </button>
                </div>
              </article>`;
          }).join("")
        : `<p class="muted">${escapeHTML(tr("noRecords"))}</p>`;
    }

    renderBudget();
    renderReports();
    updateRepaymentFields();
  }

  function renderBudget() {
    const input = $("budgetInput");
    if (!input) return;

    const month = $("monthFilter")?.value || currentMonth();
    const budgets = getLocal(KEYS.budgets, {});
    const budget = Number(budgets[month] ?? input.value) || 0;

    if (document.activeElement !== input) {
      input.value = budget || "";
    }

    const spent = monthRows()
      .filter(r => r.type === "expense")
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);

    const percent = budget > 0
      ? Math.min(100, spent / budget * 100)
      : 0;

    if ($("budgetProgress")) {
      $("budgetProgress").style.width = `${percent}%`;
      $("budgetProgress").style.background =
        percent >= 100
          ? "#c0392b"
          : "linear-gradient(90deg,#19c37d,#087a49)";
    }

    if ($("budgetText")) {
      $("budgetText").textContent = budget > 0
        ? `${tr("budget")} ${money(budget)} · ${tr("spent")} ${money(spent)} · ${tr("remaining")} ${money(budget - spent)}`
        : tr("budgetSet");
    }
  }

  function renderReports() {
    const host = $("reportSummary");
    if (!host) return;

    const period = $("reportPeriod")?.value || "month";
    const year = $("reportYear")?.value || today().slice(0, 4);

    const list = period === "year"
      ? rows.filter(r => String(r.entry_date || "").slice(0, 4) === year)
      : monthRows();

    const s = calculate(list);

    host.innerHTML = `
      <div class="report-card">
        <small>${escapeHTML(tr("income"))}</small>
        <strong>${money(s.income)}</strong>
      </div>
      <div class="report-card">
        <small>${escapeHTML(tr("expense"))}</small>
        <strong>${money(s.expenses)}</strong>
      </div>
      <div class="report-card">
        <small>${escapeHTML(tr("lentDue"))}</small>
        <strong>${money(s.lentDue)}</strong>
      </div>
      <div class="report-card">
        <small>${escapeHTML(tr("borrowedDue"))}</small>
        <strong>${money(s.borrowedDue)}</strong>
      </div>`;
  }

  async function loadRows() {
    if (mode === "online" && user) {
      const { data, error } = await sb
        .from("transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("entry_date", { ascending: false });

      if (error) throw error;
      rows = data || [];
    } else {
      rows = localRows();
    }

    render();
  }

  async function loadBudget() {
    const month = $("monthFilter")?.value || currentMonth();

    if (mode === "online" && user) {
      const { data, error } = await sb
        .from("monthly_budgets")
        .select("amount")
        .eq("user_id", user.id)
        .eq("month", month)
        .maybeSingle();

      if (error) throw error;

      const budgets = getLocal(KEYS.budgets, {});
      budgets[month] = Number(data?.amount || 0);
      setLocal(KEYS.budgets, budgets);

      if ($("budgetInput")) {
        $("budgetInput").value = data?.amount ?? "";
      }
    } else {
      const budgets = getLocal(KEYS.budgets, {});
      if ($("budgetInput")) {
        $("budgetInput").value = budgets[month] ?? "";
      }
    }

    renderBudget();
  }

  async function refresh() {
    await loadRows();
    await loadBudget();
  }

  async function activate(account) {
    user = account;
    mode = "online";
    showApp(true, account.email || "Account");
    setSync(tr("cloud"));

    try {
      await refresh();
    } catch (error) {
      toast(tr("error") + error.message);
    }
  }

  async function login() {
    if (busy) return;
    if (!sb) {
      setMessage("authMsg", "Supabase configuration नहीं मिली।", true);
      return;
    }

    busy = true;

    try {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;

      if (!email || !password) {
        throw new Error("Email और password भरें।");
      }

      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      await activate(data.user);
    } catch (error) {
      setMessage("authMsg", error.message, true);
    } finally {
      busy = false;
    }
  }

  async function signup() {
    if (busy) return;
    if (!sb) {
      setMessage("authMsg", "Supabase configuration नहीं मिली।", true);
      return;
    }

    busy = true;

    try {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;

      if (!email || !password) {
        throw new Error("Email और password भरें।");
      }

      if (password.length < 6) {
        throw new Error("Password कम से कम 6 अक्षर का रखें।");
      }

      const { data, error } = await sb.auth.signUp({ email, password });

      if (error) throw error;

      if (data.session && data.user) {
        await activate(data.user);
      } else {
        setMessage(
          "authMsg",
          "Account बन गया। Email verification के बाद login करें।"
        );
      }
    } catch (error) {
      setMessage("authMsg", error.message, true);
    } finally {
      busy = false;
    }
  }

  async function googleLogin() {
    if (!sb) {
      toast("Supabase configuration उपलब्ध नहीं है।");
      return;
    }

    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: location.origin + location.pathname
      }
    });

    if (error) toast(tr("error") + error.message);
  }

  function offlineMode() {
    mode = "offline";
    user = null;
    rows = localRows();
    showApp(true, "Offline");
    setSync(tr("offline"), "offline");
    render();
    loadBudget().catch(() => {});
  }

  async function logout() {
    if (sb && mode === "online") {
      const { error } = await sb.auth.signOut();
      if (error) {
        toast(tr("error") + error.message);
        return;
      }
    }

    mode = "offline";
    user = null;
    showApp(false);
    setSync(tr("offline"), "offline");
  }

  function updateRepaymentFields() {
    const type = $("type")?.value || "expense";

    $("repayDirectionField")?.classList.toggle(
      "hidden",
      type !== "repay"
    );

    $("personField")?.classList.toggle(
      "hidden",
      !["lend", "borrow", "repay"].includes(type)
    );
  }

  function getFormRecord() {
    const amount = Number($("amount")?.value);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(tr("invalidAmount"));
    }

    const type = $("type")?.value || "expense";

    if (!["income", "expense", "lend", "borrow", "repay"].includes(type)) {
      throw new Error("Transaction type सही चुनें।");
    }

    return {
      id: editingId || uid(),
      type,
      amount,
      category: $("category")?.value.trim() || tr("other"),
      entry_date: $("entryDate")?.value || today(),
      note: $("note")?.value.trim() || "",
      person: $("person")?.value.trim() || "",
      repay_direction: $("repayDirection")?.value || "paid"
    };
  }

  async function saveTransaction(event) {
    event.preventDefault();
    if (busy) return;

    busy = true;

    try {
      const record = getFormRecord();
      const wasEditing = Boolean(editingId);

      if (mode === "online" && user) {
        const payload = {
          user_id: user.id,
          type: record.type,
          amount: record.amount,
          category: record.category,
          entry_date: record.entry_date,
          note: record.note,
          person: record.person,
          repay_direction: record.repay_direction
        };

        const result = wasEditing
          ? await sb.from("transactions")
              .update(payload)
              .eq("id", editingId)
              .eq("user_id", user.id)
          : await sb.from("transactions").insert(payload);

        if (result.error) throw result.error;
      } else {
        const data = localRows();
        const index = data.findIndex(
          r => String(r.id) === String(record.id)
        );

        if (index >= 0) data[index] = record;
        else data.unshift(record);

        saveLocalRows(data);
      }

      $("entryForm")?.reset();

      if ($("entryDate")) {
        $("entryDate").value = today();
      }

      clearEdit();
      await refresh();
      toast(wasEditing ? tr("updated") : tr("saved"));
      setMessage("entryMsg", "");
    } catch (error) {
      setMessage("entryMsg", error.message, true);
    } finally {
      busy = false;
    }
  }

  function startEdit(id) {
    const record = rows.find(r => String(r.id) === String(id));
    if (!record) return;

    editingId = record.id;

    if ($("type")) $("type").value = record.type;
    if ($("amount")) $("amount").value = record.amount;
    if ($("category")) $("category").value = record.category || "";
    if ($("entryDate")) $("entryDate").value = record.entry_date || today();
    if ($("note")) $("note").value = record.note || "";
    if ($("person")) $("person").value = record.person || "";

    if ($("repayDirection")) {
      $("repayDirection").value = record.repay_direction || "paid";
    }

    const submit = $("entryForm")?.querySelector('[type="submit"]');
    if (submit) submit.textContent = tr("update");

    $("cancelEdit")?.classList.remove("hidden");
    updateRepaymentFields();

    $("entryForm")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function clearEdit() {
    editingId = null;

    const submit = $("entryForm")?.querySelector('[type="submit"]');
    if (submit) submit.textContent = tr("save");

    $("cancelEdit")?.classList.add("hidden");
  }

  async function deleteTransaction(id) {
    if (!confirm(tr("confirmDelete"))) return;

    try {
      if (mode === "online" && user) {
        const { error } = await sb
          .from("transactions")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id);

        if (error) throw error;
      } else {
        saveLocalRows(
          localRows().filter(r => String(r.id) !== String(id))
        );
      }

      await refresh();
      toast(tr("deleted"));
    } catch (error) {
      toast(tr("error") + error.message);
    }
  }

  async function saveBudget() {
    const amount = Number($("budgetInput")?.value);
    const month = $("monthFilter")?.value || currentMonth();

    if (!Number.isFinite(amount) || amount < 0) {
      toast("सही बजट राशि भरें।");
      return;
    }

    try {
      if (mode === "online" && user) {
        const { error } = await sb.from("monthly_budgets").upsert(
          {
            user_id: user.id,
            month,
            amount
          },
          { onConflict: "user_id,month" }
        );

        if (error) throw error;
      }

      const budgets = getLocal(KEYS.budgets, {});
      budgets[month] = amount;
      setLocal(KEYS.budgets, budgets);

      renderBudget();
      toast("Budget saved.");
    } catch (error) {
      toast(tr("error") + error.message);
    }
  }

  function exportRows() {
    const list = visibleRows();

    if (!list.length) {
      toast(tr("noExport"));
      return [];
    }

    return list.map(r => ({
      Date: r.entry_date,
      Type: r.type,
      Amount: Number(r.amount),
      Category: r.category || "",
      Person: r.person || "",
      RepaymentDirection: r.repay_direction || "",
      Note: r.note || ""
    }));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV() {
    const data = exportRows();
    if (!data.length) return;

    const headers = Object.keys(data[0]);

    const csv = [
      headers,
      ...data.map(row => headers.map(header => row[header]))
    ].map(row =>
      row.map(value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`
      ).join(",")
    ).join("\r\n");

    downloadBlob(
      new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8"
      }),
      `expenzo-${today()}.csv`
    );
  }

  function exportExcel() {
    const data = exportRows();
    if (!data.length) return;

    if (window.XLSX) {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(wb, ws, "Transactions");
      XLSX.writeFile(wb, `expenzo-${today()}.xlsx`);
    } else {
      exportCSV();
    }
  }

  function exportPDF() {
    const data = exportRows();
    if (!data.length) return;

    if (!window.jspdf?.jsPDF) {
      toast("PDF library लोड नहीं हुई। CSV export इस्तेमाल करें।");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Expenzo - Transactions", 14, 16);
    doc.setFontSize(9);

    let y = 26;

    data.forEach(r => {
      const line =
        `${r.Date} | ${r.Type} | INR ${r.Amount} | ${r.Category} | ${r.Person} | ${r.Note}`;

      const lines = doc.splitTextToSize(line, 180);

      if (y + lines.length * 5 > 280) {
        doc.addPage();
        y = 16;
      }

      doc.text(lines, 14, y);
      y += lines.length * 5 + 2;
    });

    doc.save(`expenzo-${today()}.pdf`);
  }

  function setLanguage() {
    language = language === "hi" ? "en" : "hi";
    localStorage.setItem(KEYS.lang, language);

    if ($("languageToggle")) {
      $("languageToggle").textContent = tr("language");
    }

    const submit = $("entryForm")?.querySelector('[type="submit"]');
    if (submit) {
      submit.textContent = editingId ? tr("update") : tr("save");
    }

    render();
  }

  // Offline records remain on this device.
  // Automatic offline-to-cloud sync is not implemented in this version.
  async function syncQueue() {
    if (mode === "online" && user) {
      setSync(tr("cloud"));
    }
  }

  function bindEvents() {
    $("loginBtn")?.addEventListener("click", login);
    $("signupBtn")?.addEventListener("click", signup);
    $("googleLoginBtn")?.addEventListener("click", googleLogin);
    $("offlineBtn")?.addEventListener("click", offlineMode);
    $("logoutBtn")?.addEventListener("click", logout);

    $("entryForm")?.addEventListener("submit", saveTransaction);
    $("saveBudgetBtn")?.addEventListener("click", saveBudget);

    $("cancelEdit")?.addEventListener("click", () => {
      $("entryForm")?.reset();
      clearEdit();
      updateRepaymentFields();
    });

    $("type")?.addEventListener("change", updateRepaymentFields);

    [
      "monthFilter",
      "recordSearch",
      "recordTypeFilter",
      "filterFrom",
      "filterTo",
      "reportPeriod",
      "reportYear"
    ].forEach(id => {
      $(id)?.addEventListener("input", () => {
        render();

        if (id === "monthFilter") {
          loadBudget().catch(error =>
            toast(tr("error") + error.message)
          );
        }
      });
    });

    $("generateReport")?.addEventListener("click", renderReports);
    $("exportCsv")?.addEventListener("click", exportCSV);
    $("exportExcel")?.addEventListener("click", exportExcel);
    $("exportPdf")?.addEventListener("click", exportPDF);
    $("languageToggle")?.addEventListener("click", setLanguage);

    $("records")?.addEventListener("click", event => {
      const editButton = event.target.closest("[data-edit]");
      const deleteButton = event.target.closest("[data-delete]");

      if (editButton) startEdit(editButton.dataset.edit);
      if (deleteButton) deleteTransaction(deleteButton.dataset.delete);
    });
  }

  async function init() {
    if ($("monthFilter") && !$("monthFilter").value) {
      $("monthFilter").value = currentMonth();
    }

    if ($("entryDate") && !$("entryDate").value) {
      $("entryDate").value = today();
    }

    if ($("reportYear") && !$("reportYear").value) {
      $("reportYear").value = today().slice(0, 4);
    }

    if ($("languageToggle")) {
      $("languageToggle").textContent = tr("language");
    }

    bindEvents();
    updateRepaymentFields();

    if (sb) {
      try {
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;

        if (data.session?.user) {
          await activate(data.session.user);
        } else {
          mode = "offline";
          showApp(false);
          setSync(tr("offline"), "offline");
        }

        sb.auth.onAuthStateChange((_event, session) => {
          if (session?.user) activate(session.user);
        });
      } catch (error) {
        showApp(false);
        setMessage("authMsg", tr("error") + error.message, true);
      }
    } else {
      showApp(false);
      setMessage(
        "authMsg",
        "Cloud login के लिए config.js में Supabase settings जाँचें।",
        true
      );
    }

    if ($("languageToggle")) {
      $("languageToggle").textContent = tr("language");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

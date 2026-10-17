
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
    lang: "expenzo_language_v1",
    queue: "expenzo_sync_queue_v1"
  };

  let mode = "offline";
  let user = null;
  let rows = [];
  let editingId = null;
  let busy = false;
  let syncing = false;
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
      cancel: "Edit रद्द करें",
      noRecords: "कोई रिकॉर्ड नहीं मिला।",
      invalidAmount: "राशि 0 से अधिक होनी चाहिए।",
      saved: "रिकॉर्ड सेव हो गया।",
      updated: "रिकॉर्ड अपडेट हो गया।",
      deleted: "रिकॉर्ड हटा दिया गया।",
      confirmDelete: "क्या यह रिकॉर्ड हटाना है?",
      offline: "ऑफलाइन मोड",
      cloud: "क्लाउड से कनेक्ट है",
      syncPending: "सिंक बाकी है",
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
      cancel: "Cancel Edit",
      noRecords: "No records found.",
      invalidAmount: "Amount must be greater than zero.",
      saved: "Record saved.",
      updated: "Record updated.",
      deleted: "Record deleted.",
      confirmDelete: "Delete this record?",
      offline: "Offline mode",
      cloud: "Connected to cloud",
      syncPending: "Sync pending",
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

  const tr = key => words[language]?.[key] || words.en[key] || key;

  const today = () => {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
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
      : "local-" + Date.now() + "-" +
        Math.random().toString(16).slice(2);

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

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

  function toast(text) {
    const el = $("toast");
    if (!el) {
      alert(text);
      return;
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(
      () => el.classList.remove("show"),
      3000
    );
  }

  function setMessage(id, text, error = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", error);
  }

  function setSync(text, state = "") {
    const el = $("syncStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "sync-status " + state;
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
      .trim()
      .toLowerCase();

    const type = $("recordTypeFilter")?.value || "all";
    const from = $("filterFrom")?.value || "";
    const to = $("filterTo")?.value || "";

    return monthRows().filter(r => {
      const text = [
        r.category, r.note, r.person, r.entry_date, r.type
      ].join(" ").toLowerCase();

      return (
        (type === "all" || r.type === type) &&
        text.includes(query) &&
        (!from || r.entry_date >= from) &&
        (!to || r.entry_date <= to)
      );
    });
  }

  function calculate(list) {
    let income = 0;
    let expenses = 0;
    let cashChange = 0;
    let lent = 0;
    let borrowed = 0;

    for (const r of list) {
      const amount = Number(r.amount) || 0;

      switch (r.type) {
        case "income":
          income += amount;
          cashChange += amount;
          break;

        case "expense":
          expenses += amount;
          cashChange -= amount;
          break;

        case "lend":
          cashChange -= amount;
          lent += amount;
          break;

        case "borrow":
          cashChange += amount;
          borrowed += amount;
          break;

        case "repay":
          if (r.repay_direction === "received") {
            cashChange += amount;
            lent -= amount;
          } else {
            cashChange -= amount;
            borrowed -= amount;
          }
          break;
      }
    }

    return {
      income,
      expenses,
      cashChange,
      lentDue: Math.max(0, lent),
      borrowedDue: Math.max(0, borrowed)
    };
  }

  function render() {
    const list = monthRows();
    const sums = calculate(list);

    if ($("totalIncome"))
      $("totalIncome").textContent = money(sums.income);

    if ($("totalExpense"))
      $("totalExpense").textContent = money(sums.expenses);

    if ($("balance"))
      $("balance").textContent = money(sums.cashChange);

    if ($("recordCount")) {
      $("recordCount").textContent =
        visibleRows().length + " " +
        (language === "hi" ? "रिकॉर्ड" : "records");
    }

    const host = $("records");

    if (host) {
      const shown = visibleRows();

      if (!shown.length) {
        host.innerHTML =
          `<p class="muted">${escapeHTML(tr("noRecords"))}</p>`;
      } else {
        host.innerHTML = shown.map(r => {
          const positive =
            r.type === "income" ||
            r.type === "borrow" ||
            (r.type === "repay" &&
             r.repay_direction === "received");

          const amountClass =
            r.type === "income" ? "amount-income" :
            r.type === "expense" ? "amount-expense" :
            "amount-other";

          const note = [r.person, r.note]
            .filter(Boolean)
            .join(" · ");

          return `
            <article class="record">
              <div class="record-main">
                <div class="record-title">
                  ${escapeHTML(r.category || tr("other"))}
                  · ${escapeHTML(tr(r.type) || r.type)}
                </div>
                <div class="record-sub">
                  ${escapeHTML(r.entry_date || "")}
                  ${note ? " · " + escapeHTML(note) : ""}
                </div>
              </div>
              <div class="record-right">
                <strong class="${amountClass}">
                  ${positive ? "+" : "−"}${money(r.amount)}
                </strong>
                <br>
                <button type="button"
                  class="secondary"
                  data-edit="${escapeHTML(r.id)}">
                  ${escapeHTML(tr("edit"))}
                </button>
                <button type="button"
                  class="delete"
                  data-delete="${escapeHTML(r.id)}">
                  ${escapeHTML(tr("delete"))}
                </button>
              </div>
            </article>`;
        }).join("");
      }
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

    const spent = monthRows().reduce(
      (sum, r) =>
        sum + (r.type === "expense" ? Number(r.amount) || 0 : 0),
      0
    );

    const percent = budget > 0
      ? Math.min(100, spent / budget * 100)
      : 0;

    if ($("budgetProgress")) {
      $("budgetProgress").style.width = percent + "%";
      $("budgetProgress").style.background =
        percent >= 100 ? "#c0392b" :
        "linear-gradient(90deg,#19c37d,#087a49)";
    }

    if ($("budgetText")) {
      $("budgetText").textContent = budget > 0
        ? `${tr("budget")} ${money(budget)} · ` +
          `${tr("spent")} ${money(spent)} · ` +
          `${tr("remaining")} ${money(budget - spent)}`
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

      if ($("budgetInput"))
        $("budgetInput").value = data?.amount ?? "";
    } else {
      const budgets = getLocal(KEYS.budgets, {});
      if ($("budgetInput"))
        $("budgetInput").value = budgets[month] ?? "";
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
      await syncQueue();
    } catch (error) {
      toast(tr("error") + error.message);
    }
  }

  async function login() {
    if (busy || !sb) return;
    busy = true;

    try {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;

      if (!email || !password)
        throw new Error("Email और password भरें।");

      const { data, error } = await sb.auth.signInWithPassword({
        email, password
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
    if (busy || !sb) return;
    busy = true;

    try {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;

      if (!email || !password)
        throw new Error("Email और password भरें।");

      if (password.length < 6)
        throw new Error("Password कम से कम 6 अक्षर का रखें।");

      const { data, error } = await sb.auth.signUp({
        email, password
      });

      if (error) throw error;

      if (data.session && data.user) {
        await activate(data.user);
      } else {
        setMessage(
          "authMsg",
          "Account बन गया। Email verification पूरा करके login करें।"
        );
      }
    } catch (error) {
      setMessage("authMsg", error.message, true);
    } finally {
      busy = false;
    }
  }

  async function googleLogin() {
    if (!sb) return toast("Supabase configuration उपलब्ध नहीं है।");

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
      if (error) return toast(tr("error") + error.message);
    }

    mode = "offline";
    user = null;
    showApp(false);
    setSync(tr("offline"), "offline");
  }

  function updateRepaymentFields() {
    const type = $("type")?.value || "expense";

    $("repayDirectionField")?.classList.toggle(
      "hidden", type !== "repay"
    );

    $("personField")?.classList.toggle(
      "hidden", !["lend", "borrow", "repay"].includes(type)
    );
  }

  function getFormRecord() {
    const amount = Number($("amount")?.value);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(tr("invalidAmount"));
    }

    const type = $("type")?.value || "expense";
    const record = {
      id: editingId || uid(),
      type,
      amount,
      category: $("category")?.value.trim() || tr("other"),
      entry_date: $("entryDate")?.value || today(),
      note: $("note")?.value.trim() || "",
      person: $("person")?.value.trim() || "",
      repay_direction: $("repayDirection")?.value || "paid"
    };

    if (!["income", "expense", "lend", "borrow", "repay"].includes(type)) {
      throw new Error("Transaction type सही चुनें।");
    }

    return record;
  }

  async function saveTransaction(event) {
    event.preventDefault();
    if (busy) return;

    busy = true;

    try {
      const record = getFormRecord();

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

        let result;

        if (editingId) {
          result = await sb.from("transactions")
            .update(payload)
            .eq("id", editingId)
            .eq("user_id", user.id);
        } else {
          result = await sb.from("transactions").insert(payload);
        }

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

      if ($("entryDate")) $("entryDate").value = today();

      clearEdit();
      await refresh();
      toast(editingId ? tr("updated") : tr("saved"));
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
      $("repayDirection").value =
        record.repay_direction || "paid";
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
      return toast("सही बजट राशि भरें।");
    }

    try {
      if (mode === "online" && user) {
        const { data, error } = await sb
          .from("monthly_budgets")
          .select("id")
          .eq("user_id", user.id)
          .eq("month", month)
          .maybeSingle();

        if (error) throw error;

        const result = data
          ? await sb.from("monthly_budgets")
              .update({ amount })
              .eq("id", data.id)
              .eq("user_id", user.id)
          : await sb.from("monthly_budgets").insert({
              user_id: user.id,
              month,
              amount
            });

        if (result.error) throw result.error;
      }

      const budgets = getLocal(KEYS.budgets, {});
 

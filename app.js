
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const cfg = window.EXPENSEBOOK_CONFIG || {};

  const configured = Boolean(
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_")
  );

  let sb = null;
  let user = null;
  let entries = [];
  let currentBudget = 0;
  let mode = "guest";
  let syncBusy = false;
  let authBusy = false;

  const money = value =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }).format(Number(value) || 0);

  const today = new Date();

  const dateString = date =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const monthNow = dateString(today).slice(0, 7);
  const guestKey = "expenzo:v1:guest";

  if ($("monthFilter")) $("monthFilter").value = monthNow;
  if ($("entryDate")) $("entryDate").value = dateString(today);

  function storageKey() {
    return `expenzo:v1:${user ? user.id : "guest"}`;
  }

  function message(id, text, error = false) {
    const el = $(id);
    if (!el) return;

    el.textContent = text;
    el.classList.toggle("error", error);
  }

  function toast(text) {
    const el = $("toast");
    if (!el) return;

    el.textContent = text;
    el.classList.add("show");

    setTimeout(() => el.classList.remove("show"), 2600);
  }

  function setSync(text, kind = "") {
    const el = $("syncStatus");
    if (!el) return;

    el.textContent = text;
    el.className = "sync-status " + kind;
  }

  function safeParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeLocal(data) {
    data = data && typeof data === "object" ? data : {};

    data.entries = Array.isArray(data.entries) ? data.entries : [];
    data.budgets =
      data.budgets && typeof data.budgets === "object"
        ? data.budgets
        : {};

    return data;
  }

  function readLocal(key = storageKey()) {
    return normalizeLocal(
      safeParse(localStorage.getItem(key), {
        entries: [],
        budgets: {}
      })
    );
  }

  function writeLocal(data, key = storageKey()) {
    try {
      localStorage.setItem(key, JSON.stringify(normalizeLocal(data)));
      return true;
    } catch (error) {
      toast("स्टोरेज उपलब्ध नहीं है। डेटा एक्सपोर्ट करके बैकअप लें।");
      return false;
    }
  }

  function selectedMonth() {
    return $("monthFilter")?.value || monthNow;
  }

  function showAuth() {
    $("authPanel")?.classList.remove("hidden");
    $("appPanel")?.classList.add("hidden");
    $("logoutBtn")?.classList.add("hidden");
  }

  function showApp() {
    $("authPanel")?.classList.add("hidden");
    $("appPanel")?.classList.remove("hidden");

    if (user) {
      $("logoutBtn")?.classList.remove("hidden");
    } else {
      $("logoutBtn")?.classList.add("hidden");
    }

    $("userEmail").textContent =
      user?.email ||
      user?.phone ||
      "Guest Mode — रिकॉर्ड केवल इस फोन में सेव";
  }

  function visibleEntries() {
    return entries
      .filter(e => String(e.entry_date || "").slice(0, 7) === selectedMonth())
      .sort((a, b) =>
        String(b.entry_date).localeCompare(String(a.entry_date)) ||
        String(b.created_at || "").localeCompare(String(a.created_at || ""))
      );
  }

  function totals(list) {
    const sum = type =>
      list
        .filter(e => e.type === type)
        .reduce((total, e) => total + Number(e.amount || 0), 0);

    const income = sum("income");
    const expense = sum("expense");

    return {
      income,
      expense,
      balance: income - expense
    };
  }

  function budgetAmount(value) {
    if (value && typeof value === "object") {
      return Number(value.amount) || 0;
    }

    return Number(value) || 0;
  }

  function render() {
    if (!$("records")) return;

    const list = visibleEntries();
    const result = totals(list);

    $("totalIncome").textContent = money(result.income);
    $("totalExpense").textContent = money(result.expense);
    $("balance").textContent = money(result.balance);

    const percent =
      currentBudget > 0
        ? Math.min(100, result.expense / currentBudget * 100)
        : 0;

    $("budgetProgress").style.width = percent + "%";

    $("budgetText").textContent =
      currentBudget > 0
        ? `${money(result.expense)} खर्च / ${money(currentBudget)} बजट · ${
            result.expense > currentBudget
              ? "बजट से " + money(result.expense - currentBudget) + " अधिक"
              : "बजट में " + money(currentBudget - result.expense) + " बाकी"
          }`
        : "इस महीने का बजट सेट करें।";

    $("recordCount").textContent = `${list.length} रिकॉर्ड`;

    const root = $("records");
    root.replaceChildren();

    if (!list.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "इस महीने कोई रिकॉर्ड नहीं है।";
      root.append(p);
      return;
    }

    for (const entry of list) {
      const card = document.createElement("div");
      card.className = "record";

      const main = document.createElement("div");
      main.className = "record-main";

      const title = document.createElement("div");
      title.className = "record-title";
      title.textContent = entry.note || entry.category || entry.type;

      const labels = {
        income: "कमाई",
        expense: "खर्च",
        lend: "उधार दिया",
        borrow: "उधार लिया",
        repay: "उधार वापसी/भुगतान"
      };

      const sub = document.createElement("div");
      sub.className = "record-sub";
      sub.textContent =
        `${entry.entry_date} · ${entry.category || "अन्य"} · ` +
        `${labels[entry.type] || entry.type}` +
        `${entry.pendingSync ? " · सिंक बाकी" : ""}`;

      main.append(title, sub);

      const right = document.createElement("div");
      right.className = "record-right";

      const amount = document.createElement("strong");
      amount.className =
        entry.type === "income"
          ? "amount-income"
          : entry.type === "expense"
            ? "amount-expense"
            : "amount-other";

      amount.textContent = money(entry.amount);

      const del = document.createElement("button");
      del.className = "delete";
      del.textContent = "हटाएँ";
      del.addEventListener("click", () => deleteEntry(entry.id));

      right.append(amount, document.createElement("br"), del);
      card.append(main, right);
      root.append(card);
    }
  }

  function importGuestData() {
    if (!user) return;

    const guest = readLocal(guestKey);
    const ownKey = storageKey();
    const own = readLocal(ownKey);
    const ids = new Set(own.entries.map(e => e.id));

    for (const entry of guest.entries) {
      if (!ids.has(entry.id)) {
        own.entries.push({
          ...entry,
          user_id: user.id,
          pendingSync: true
        });

        ids.add(entry.id);
      }
    }

    for (const [month, value] of Object.entries(guest.budgets)) {
      if (!own.budgets[month]) {
        own.budgets[month] = {
          amount: budgetAmount(value),
          pendingSync: true
        };
      }
    }

    writeLocal(own, ownKey);
  }

  async function loadData() {
    const local = readLocal();

    entries = local.entries;
    currentBudget = budgetAmount(local.budgets[selectedMonth()]);

    $("budgetInput").value = currentBudget || "";
    render();

    if (!user || !sb) {
      setSync(
        "ऑफलाइन मोड — रिकॉर्ड केवल इस फोन में सेव हैं",
        "offline"
      );
      return;
    }

    if (!navigator.onLine) {
      setSync("इंटरनेट नहीं है — रिकॉर्ड फोन में सेव हैं", "offline");
      return;
    }

    await syncNow();
  }

  async function syncNow() {
    if (syncBusy || !user || !sb || !navigator.onLine) return;

    syncBusy = true;
    setSync("क्लाउड से सिंक हो रहा है…");

    try {
      const local = readLocal();

      // Pending transactions are uploaded using stable IDs.
      for (const entry of local.entries.filter(e => e.pendingSync)) {
        const payload = {
          id: entry.id,
          user_id: user.id,
          type: entry.type,
          amount: Number(entry.amount),
          category: entry.category || "अन्य",
          entry_date: entry.entry_date,
          note: entry.note || null
        };

        const { error } = await sb
          .from("transactions")
          .upsert(payload, { onConflict: "id" });

        if (error) throw error;

        entry.pendingSync = false;
      }

      // Upload budgets saved locally.
      for (const [month, value] of Object.entries(local.budgets)) {
        if (!value || !value.pendingSync) continue;

        const { error } = await sb
          .from("monthly_budgets")
          .upsert(
            {
              user_id: user.id,
              month,
              amount: budgetAmount(value)
            },
            { onConflict: "user_id,month" }
          );

        if (error) throw error;

        value.pendingSync = false;
      }

      writeLocal(local);

      const { data: cloudRows, error: readError } = await sb
        .from("transactions")
        .select("*")
        .order("entry_date", { ascending: false })
        .limit(5000);

      if (readError) throw readError;

      const merged = new Map();

      for (const entry of cloudRows || []) {
        merged.set(entry.id, { ...entry, pendingSync: false });
      }

      // Keep any unsynced local records.
      for (const entry of local.entries) {
        if (entry.pendingSync) merged.set(entry.id, entry);
      }

      local.entries = Array.from(merged.values());

      const { data: budgets, error: budgetError } = await sb
        .from("monthly_budgets")
        .select("*");

      if (budgetError) throw budgetError;

      for (const budget of budgets || []) {
        local.budgets[budget.month] = {
          amount: Number(budget.amount) || 0,
          pendingSync: false
        };
      }

      writeLocal(local);

      entries = local.entries;
      currentBudget = budgetAmount(local.budgets[selectedMonth()]);

      $("budgetInput").value = currentBudget || "";
      render();

      setSync("क्लाउड सिंक पूरा", "");
    } catch (error) {
      console.error("Expenzo sync error:", error);

      setSync(
        "सिंक नहीं हुआ — इंटरनेट और Supabase सेटिंग जाँचें",
        "error"
      );
    } finally {
      syncBusy = false;
    }
  }

  async function auth(action) {
    if (authBusy) return;

    if (!configured || !sb) {
      message("authMsg", "Supabase URL और Publishable Key सेट करें।", true);
      return;
    }

    const email = $("email").value.trim();
    const password = $("password").value;

    if (!email || password.length < 6) {
      message(
        "authMsg",
        "सही ईमेल और कम से कम 6 अक्षर का पासवर्ड भरें।",
        true
      );
      return;
    }

    authBusy = true;
    message("authMsg", "कृपया प्रतीक्षा करें…");

    try {
      const result =
        action === "signup"
          ? await sb.auth.signUp({ email, password })
          : await sb.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      if (action === "signup" && !result.data.session) {
        message(
          "authMsg",
          "अकाउंट बनाया गया। यदि ईमेल confirmation चालू है, तो पुष्टि पूरी करके लॉगिन करें।"
        );
        return;
      }

      if (result.data.user) {
        user = result.data.user;
        mode = "cloud";
        importGuestData();
        showApp();
        await loadData();
        message("authMsg", "");
      }
    } catch (error) {
      message("authMsg", error.message || "लॉगिन नहीं हो पाया।", true);
    } finally {
      authBusy = false;
    }
  }

  async function googleLogin() {
    if (!configured || !sb) {
      message("authMsg", "Supabase सेटअप पूरा नहीं है।", true);
      return;
    }

    const button = $("googleLoginBtn");
    if (button) button.disabled = true;

    message("authMsg", "Google Login खोला जा रहा है…");

    try {
      const redirectTo = window.location.origin + window.location.pathname;

      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo
        }
      });

      if (error) throw error;

      // Supabase redirects to Google. Do not show a success message here.
    } catch (error) {
      message("authMsg", error.message || "Google Login शुरू नहीं हुआ।", true);

      if (button) button.disabled = false;
    }
  }

  function saveLocalEntry(entry) {
    const local = readLocal();
    const index = local.entries.findIndex(e => e.id === entry.id);

    if (index >= 0) {
      local.entries[index] = entry;
    } else {
      local.entries.unshift(entry);
    }

    if (writeLocal(local)) {
      entries = local.entries;
      render();
    }
  }

  async function deleteEntry(id) {
    if (!confirm("क्या यह रिकॉर्ड हटाना चाहते हैं?")) return;

    const local = readLocal();
    const existing = local.entries.find(e => e.id === id);

    local.entries = local.entries.filter(e => e.id !== id);

    if (!writeLocal(local)) return;

    entries = local.entries;
    render();

    if (user && sb && navigator.onLine && existing && !existing.pendingSync) {
      const { error } = await sb
        .from("transactions")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) {
        toast("क्लाउड से हटाना विफल हुआ। दोबारा जाँचें।");
        return;
      }
    }

    toast("रिकॉर्ड फोन से हटा दिया गया");
  }

  function exportRows() {
    return visibleEntries().map(entry => ({
      Date: entry.entry_date,
      Type: ({
        income: "Income",
        expense: "Expense",
        lend: "Lent",
        borrow: "Borrowed",
        repay: "Repayment"
      })[entry.type] || entry.type,
      Category: entry.category || "अन्य",
      Amount: Number(entry.amount),
      Note: entry.note || ""
    }));
  }

  // Email login and signup
  $("loginBtn")?.addEventListener("click", () => auth("login"));
  $("signupBtn")?.addEventListener("click", () => auth("signup"));

  // Google login
  $("googleLoginBtn")?.addEventListener("click", googleLogin);

  // Guest/offline mode
  $("offlineBtn")?.addEventListener("click", async () => {
    if (sb && user) {
      const { error } = await sb.auth.signOut();
      if (error) console.error(error);
    }

    user = null;
    mode = "guest";
    showApp();
    await loadData();
  });

  // Logout
  $("logoutBtn")?.addEventListener("click", async () => {
    if (sb && user) {
      const { error } = await sb.auth.signOut();
      if (error) {
        toast("लॉग आउट नहीं हुआ। दोबारा कोशिश करें।");
        return;
      }
    }

    user = null;
    mode = "guest";
    showAuth();
    await loadData();
  });

  // New income/expense entry
  $("entryForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const amount = Number($("amount").value);
    const entryDate = $("entryDate").value;

    if (!(amount > 0) || !entryDate) {
      message("entryMsg", "राशि और तारीख सही भरें।", true);
      return;
    }

    const id =
      crypto.randomUUID
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const entry = {
      id,
      user_id: user?.id || null,
      type: $("type").value,
      amount,
      category: $("category").value,
      entry_date: entryDate,
      note: $("note").value.trim() || null,
      created_at: new Date().toISOString(),
      pendingSync: Boolean(user)
    };

    saveLocalEntry(entry);

    $("amount").value = "";
    $("note").value = "";

    message(
      "entryMsg",
      user
        ? "रिकॉर्ड फोन में सेव हुआ। क्लाउड सिंक जारी रहेगा।"
        : "रिकॉर्ड इस फोन में सेव हो गया।"
    );

    if (user && navigator.onLine) await syncNow();
  });

  // Month filter
  $("monthFilter")?.addEventListener("change", loadData);

  // Save monthly budget
  $("saveBudgetBtn")?.addEventListener("click", async () => {
    const amount = Number($("budgetInput").value);

    if (!Number.isFinite(amount) || amount < 0) {
      toast("बजट की राशि सही भरें");
      return;
    }

    const local = readLocal();

    local.budgets[selectedMonth()] = {
      amount,
      pendingSync: Boolean(user)
    };

    if (!writeLocal(local)) return;

    currentBudget = amount;
    render();
    toast("बजट फोन में सेव हो गया");

    if (user && navigator.onLine) await syncNow();
  });

  // Excel export
  $("exportExcel")?.addEventListener("click", () => {
    const rows = exportRows();

    if (!rows.length) {
      toast("एक्सपोर्ट करने के लिए रिकॉर्ड नहीं हैं");
      return;
    }

    if (!window.XLSX) {
      toast("Excel लाइब्रेरी के लिए इंटरनेट चालू करें");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Expenzo");

    XLSX.writeFile(workbook, `Expenzo-${selectedMonth()}.xlsx`);
  });

  // PDF export
  $("exportPdf")?.addEventListener("click", () => {
    const rows = exportRows();

    if (!rows.length) {
      toast("एक्सपोर्ट करने के लिए रिकॉर्ड नहीं हैं");
      return;
    }

    if (!window.jspdf) {
      toast("PDF लाइब्रेरी के लिए इंटरनेट चालू करें");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const result = totals(visibleEntries());

    doc.setFontSize(18);
    doc.text("Expenzo", 14, 18);

    doc.setFontSize(11);
    doc.text(`Monthly report: ${selectedMonth()}`, 14, 27);
    doc.text(`Income: ${money(result.income)}`, 14, 35);
    doc.text(`Expenses: ${money(result.expense)}`, 14, 42);
    doc.text(`Balance: ${money(result.balance)}`, 14, 49);

    let y = 60;
    doc.setFontSize(9);
    doc.text("Date     Type     Category     Amount     Note", 14, y);
    y += 7;

    rows.forEach(row => {
      const line =
        `${row.Date}  ${row.Type}  ${row.Category}  ` +
        `${row.Amount}  ${(row.Note || "").slice(0, 30)}`;

      const split = doc.splitTextToSize(line, 180);

      if (y + split.length * 5 > 280) {
        doc.addPage();
        y = 18;
      }

      doc.text(split, 14, y);
      y += split.length * 5 + 2;
    });

    doc.save(`Expenzo-${selectedMonth()}.pdf`);
  });

  // Network status
  window.addEventListener("online", () => {
    if (user) {
      syncNow();
    } else {
      setSync("इंटरनेट उपलब्ध — रिकॉर्ड फोन में सेव हैं", "");
    }
  });

  window.addEventListener("offline", () => {
    setSync("ऑफलाइन — रिकॉर्ड फोन में सेव होंगे", "offline");
  });

  // Initialize Supabase and restore session
  if (configured && window.supabase) {
    sb = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    );

    sb.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        user = session.user;
        mode = "cloud";
        showApp();

        // Avoid blocking the auth event callback.
        setTimeout(() => {
          importGuestData();
          loadData();
        }, 0);
      } else if (event === "SIGNED_OUT") {
        user = null;
        mode = "guest";
        showAuth();
      }
    });

    sb.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error(error);
        showAuth();
        return;
      }

      if (data.session?.user) {
        user = data.session.user;
        mode = "cloud";
        importGuestData();
        showApp();
        loadData();
      } else {
        showAuth();
      }
    });
  } else {
    setSync(
      "क्लाउड सेटअप बाकी — ऑफलाइन रिकॉर्ड इस्तेमाल कर सकते हैं",
      "offline"
    );

    showAuth();
  }
})();
        

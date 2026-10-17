
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const config = window.EXPENSEBOOK_CONFIG || {};

  const configured = Boolean(
    window.supabase &&
    config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY
  );

  const sb = configured
    ? window.supabase.createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY
      )
    : null;

  const TX_KEY = "expenzo_transactions_v1";
  const BUDGET_KEY = "expenzo_budgets_v1";

  let mode = "offline";
  let user = null;
  let rows = [];
  let busy = false;

  const today = () => new Date().toLocaleDateString("en-CA");
  const monthNow = () => today().slice(0, 7);

  const money = amount => new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);

  const escapeHTML = value => String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]
  );

  function getLocal(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function message(id, text, error = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", error);
  }

  function toast(text) {
    const el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
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
    $("logoutBtn")?.classList.toggle("hidden", !show || mode !== "online");
    if ($("userEmail")) $("userEmail").textContent = label;
  }

  function monthRows() {
    const month = $("monthFilter").value || monthNow();
    return rows.filter(r => String(r.entry_date).slice(0, 7) === month);
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
      rows = getLocal(TX_KEY, []).sort(
        (a, b) => String(b.entry_date).localeCompare(String(a.entry_date))
      );
    }
    render();
  }

  async function loadBudget() {
    const month = $("monthFilter").value || monthNow();
    let amount = "";

    if (mode === "online" && user) {
      const { data, error } = await sb
        .from("monthly_budgets")
        .select("amount")
        .eq("user_id", user.id)
        .eq("month", month)
        .maybeSingle();

      if (error) throw error;
      amount = data?.amount ?? "";
    } else {
      amount = getLocal(BUDGET_KEY, {})[month] ?? "";
    }

    $("budgetInput").value = amount;
    render();
  }

  function render() {
    const list = monthRows();

    const sum = types => list.reduce(
      (total, r) => total + (
        types.includes(r.type) ? Number(r.amount) || 0 : 0
      ), 0
    );

    const income = sum(["income"]);
    const expense = sum(["expense", "repay"]);
    const balance = income + sum(["borrow"]) -
      expense - sum(["lend"]);

    $("totalIncome").textContent = money(income);
    $("totalExpense").textContent = money(expense);
    $("balance").textContent = money(balance);
    $("recordCount").textContent = list.length + " रिकॉर्ड";

    const host = $("records");

    if (!list.length) {
      host.innerHTML =
        '<p class="muted">इस महीने कोई रिकॉर्ड नहीं है। पहली एंट्री जोड़ें।</p>';
    } else {
      host.innerHTML = list.map(r => {
        const labels = {
          income: "कमाई",
          expense: "खर्च",
          lend: "उधार दिया",
          borrow: "उधार लिया",
          repay: "उधार वापसी/भुगतान"
        };

        const sign = ["income", "borrow"].includes(r.type)
          ? "+"
          : ["expense", "lend", "repay"].includes(r.type) ? "−" : "";

        const cls = r.type === "income"
          ? "amount-income"
          : ["expense", "repay"].includes(r.type)
            ? "amount-expense"
            : "amount-other";

        return `
          <article class="record">
            <div class="record-main">
              <div class="record-title">
                ${escapeHTML(r.category || "अन्य")} ·
                ${escapeHTML(labels[r.type] || r.type)}
              </div>
              <div class="record-sub">
                ${escapeHTML(r.entry_date || "")}
                ${r.note ? " · " + escapeHTML(r.note) : ""}
              </div>
            </div>
            <div class="record-right">
              <strong class="${cls}">
                ${sign}${money(r.amount)}
              </strong><br>
              <button class="delete" data-delete="${escapeHTML(r.id)}"
                type="button">हटाएँ</button>
            </div>
          </article>`;
      }).join("");
    }

    renderBudget();
  }

  function renderBudget() {
    if (!$("budgetInput")) return;

    const budget = Number($("budgetInput").value) || 0;
    const spent = monthRows().reduce((total, r) =>
      total + (["expense", "repay"].includes(r.type)
        ? Number(r.amount) || 0 : 0), 0);

    const percent = budget > 0
      ? Math.min(100, spent / budget * 100)
      : 0;

    $("budgetProgress").style.width = percent + "%";
    $("budgetText").textContent = budget > 0
      ? `बजट ${money(budget)} · खर्च ${money(spent)} · शेष ${money(budget - spent)}`
      : "इस महीने का बजट सेट करें।";

    $("budgetProgress").style.background = percent >= 100
      ? "#c0392b"
      : "linear-gradient(90deg,#19c37d,#087a49)";
  }

  async function refresh() {
    try {
      await loadRows();
      await loadBudget();
      setSync(
        mode === "online"
          ? "क्लाउड से सिंक है"
          : "ऑफलाइन मोड · रिकॉर्ड इस डिवाइस पर सेव हैं",
        mode === "online" ? "" : "offline"
      );
    } catch (e) {
      setSync("लोड करने में समस्या: " + e.message, "error");
    }
  }

  async function login() {
    if (!sb) {
      message("authMsg", "Supabase configuration जाँचें।", true);
      return;
    }

    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !password) {
      message("authMsg", "ईमेल और पासवर्ड भरें।", true);
      return;
    }

    $("loginBtn").disabled = true;
    message("authMsg", "लॉगिन हो रहा है…");

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email, password
      });
      if (error) throw error;
      await activate(data.user);
      message("authMsg", "");
    } catch (e) {
      message("authMsg", e.message, true);
    } finally {
      $("loginBtn").disabled = false;
    }
  }

  async function signup() {
    if (!sb) {
      message("authMsg", "Supabase configuration जाँचें।", true);
      return;
    }

    const email = $("email").value.trim();
    const password = $("password").value;

    if (!email || password.length < 6) {
      message("authMsg", "ईमेल और कम से कम 6 अक्षर का पासवर्ड भरें।", true);
      return;
    }

    $("signupBtn").disabled = true;
    message("authMsg", "अकाउंट बनाया जा रहा है…");

    try {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;

      if (data.session && data.user) {
        await activate(data.user);
        message("authMsg", "अकाउंट बन गया।");
      } else {
        message("authMsg", "अकाउंट बन गया। जरूरत हो तो ईमेल confirmation करें।");
      }
    } catch (e) {
      message("authMsg", e.message, true);
    } finally {
      $("signupBtn").disabled = false;
    }
  }

  async function googleLogin() {
    if (!sb) {
      message("authMsg", "Supabase configuration जाँचें।", true);
      return;
    }

    const button = $("googleLoginBtn");
    button.disabled = true;
    message("authMsg", "Google Login खोला जा रहा है…");

    try {
      const redirectTo = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (e) {
      message("authMsg", e.message || "Google Login शुरू नहीं हुआ।", true);
      button.disabled = false;
    }
  }

  async function activate(account) {
    mode = "online";
    user = account;
    showApp(true, account.email || "Cloud account");
    await refresh();
  }

  async function offlineMode() {
    mode = "offline";
    user = null;
    showApp(true, "Offline mode · इस डिवाइस पर");
    await refresh();
    toast("ऑफलाइन मोड शुरू");
  }

  async function logout() {
    if (mode === "online" && sb) {
      const { error } = await sb.auth.signOut();
      if (error) return toast(error.message);
    }

    mode = "offline";
    user = null;
    showApp(false);
    message("authMsg", "आप लॉग आउट हो गए।");
  }

  async function addTransaction(event) {
    event.preventDefault();
    if (busy) return;

    const amount = Number($("amount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return message("entryMsg", "राशि 0 से अधिक होनी चाहिए।", true);
    }

    const record = {
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : "tx-" + Date.now(),
      type: $("type").value,
      amount,
      category: $("category").value || "अन्य",
      entry_date: $("entryDate").value || today(),
      note: $("note").value.trim(),
      created_at: new Date().toISOString()
    };

    busy = true;
    const submit = $("entryForm").querySelector('[type="submit"]');
    submit.disabled = true;
    message("entryMsg", "रिकॉर्ड सेव हो रहा है…");

    try {
      if (mode === "online" && user) {
        const { error } = await sb.from("transactions").insert({
          user_id: user.id,
          type: record.type,
          amount: record.amount,
          category: record.category,
          entry_date: record.entry_date,
          note: record.note
        });
        if (error) throw error;
      } else {
        const stored = getLocal(TX_KEY, []);
        stored.push(record);
        localStorage.setItem(TX_KEY, JSON.stringify(stored));
      }

      $("amount").value = "";
      $("note").value = "";
      message("entryMsg", "रिकॉर्ड सेव हो गया।");
      await refresh();
      toast("रिकॉर्ड सेव हो गया");
    } catch (e) {
      message("entryMsg", "सेव नहीं हुआ: " + e.message, true);
    } finally {
      busy = false;
      submit.disabled = false;
    }
  }

  async function deleteTransaction(id) {
    if (!confirm("क्या यह रिकॉर्ड हटाना है?")) return;

    try {
      if (mode === "online" && user) {
        const { error } = await sb.from("transactions")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        localStorage.setItem(TX_KEY, JSON.stringify(
          getLocal(TX_KEY, []).filter(r => String(r.id) !== String(id))
        ));
      }

      await refresh();
      toast("रिकॉर्ड हटा दिया गया");
    } catch (e) {
      toast("हटाने में समस्या: " + e.message);
    }
  }

  async function saveBudget() {
    const amount = Number($("budgetInput").value);
    const month = $("monthFilter").value || monthNow();

    if (!Number.isFinite(amount) || amount < 0) {
      return toast("सही बजट राशि भरें");
    }

    try {
      if (mode === "online" && user) {
        const { data, error } = await sb.from("monthly_budgets")
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
          : await sb.from("monthly_budgets")
              .insert({ user_id: user.id, month, amount });

        if (result.error) throw result.error;
      } else {
        const budgets = getLocal(BUDGET_KEY, {});
        budgets[month] = amount;
        localStorage.setItem(BUDGET_KEY, JSON.stringify(budgets));
      }

      renderBudget();
      toast("बजट सेव हो गया");
    } catch (e) {
      toast("बजट सेव नहीं हुआ: " + e.message);
    }
  }

  function exportExcel() {
    const list = monthRows();
    if (!list.length) return toast("कोई रिकॉर्ड नहीं है");
    if (!window.XLSX) return toast("Excel library लोड नहीं हुई");

    const sheet = XLSX.utils.json_to_sheet(list.map(r => ({
      Date: r.entry_date,
      Type: r.type,
      Category: r.category,
      Amount: Number(r.amount),
      Note: r.note || ""
    })));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Expenzo");
    XLSX.writeFile(book, "Expenzo-" + $("monthFilter").value + ".xlsx");
  }

  function exportPDF() {
    const list = monthRows();
    if (!list.length) return toast("कोई रिकॉर्ड नहीं है");
    if (!window.jspdf?.jsPDF) return toast("PDF library लोड नहीं हुई");

    const doc = new window.jspdf.jsPDF();
    doc.setFontSize(16);
    doc.text("Expenzo - Monthly Records", 14, 18);
    doc.setFontSize(10);
    doc.text("Month: " + $("monthFilter").value, 14, 26);

    let y = 36;
    list.forEach(r => {
      const line = `${r.entry_date} | ${r.type} | ${r.category} | Rs ${r.amount} | ${r.note || ""}`;
      const wrapped = doc.splitTextToSize(line, 180);

      if (y + wrapped.length * 6 > 280) {
        doc.addPage();
        y = 18;
      }

      doc.text(wrapped, 14, y);
      y += wrapped.length * 6 + 2;
    });

    doc.save("Expenzo-" + $("monthFilter").value + ".pdf");
  }

  function bindEvents() {
    $("loginBtn")?.addEventListener("click", login);
    $("signupBtn")?.addEventListener("click", signup);
    $("googleLoginBtn")?.addEventListener("click", googleLogin);
    $("offlineBtn")?.addEventListener("click", offlineMode);
    $("logoutBtn")?.addEventListener("click", logout);
    $("entryForm")?.addEventListener("submit", addTransaction);
    $("saveBudgetBtn")?.addEventListener("click", saveBudget);
    $("exportExcel")?.addEventListener("click", exportExcel);
    $("exportPdf")?.addEventListener("click", exportPDF);

    $("monthFilter")?.addEventListener("change", async () => {
      render();
      try {
        await loadBudget();
      } catch (e) {
        toast("बजट लोड नहीं हुआ: " + e.message);
      }
    });

    $("budgetInput")?.addEventListener("input", renderBudget);

    $("records")?.addEventListener("click", event => {
      const button = event.target.closest("[data-delete]");
      if (button) deleteTransaction(button.dataset.delete);
    });
  }

  async function init() {
    $("monthFilter").value = monthNow();
    $("entryDate").value = today();
    bindEvents();

    if (!sb) {
      message("authMsg", "Supabase सेटअप उपलब्ध नहीं है। ऑफलाइन मोड इस्तेमाल करें।");
      return;
    }

    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;

      if (data.session?.user) {
        await activate(data.session.user);
      } else {
        setSync("लॉगिन करें या ऑफलाइन मोड इस्तेमाल करें", "offline");
      }
    } catch (e) {
      setSync("क्लाउड कनेक्शन नहीं मिला; ऑफलाइन मोड इस्तेमाल करें", "offline");
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        setTimeout(() => activate(session.user), 0);
      }
      if (event === "SIGNED_OUT") {
        mode = "offline";
        user = null;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
      

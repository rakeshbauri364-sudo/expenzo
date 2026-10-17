(() => {
  const $ = id => document.getElementById(id);
  const cfg = window.EXPENSEBOOK_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_ANON_KEY.includes("PASTE_"));
  let sb = null, user = null, entries = [], currentBudget = 0, mode = "guest", syncBusy = false;
  const money = n => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(n)||0);
  const today = new Date();
  const dateString = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const monthNow = dateString(today).slice(0,7);
  $("monthFilter").value = monthNow; $("entryDate").value = dateString(today);
  const storageKey = () => `expenzo:v1:${user ? user.id : "guest"}`;
  const guestKey = "expenzo:v1:guest";
  function message(id,text,error=false){const el=$(id);if(!el)return;el.textContent=text;el.classList.toggle("error",error)}
  function toast(text){const el=$("toast");el.textContent=text;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}
  function setSync(text,kind=""){const el=$("syncStatus");if(!el)return;el.textContent=text;el.className="sync-status "+kind}
  function safeParse(raw,fallback){try{return JSON.parse(raw)||fallback}catch{return fallback}}
  function readLocal(key=storageKey()){return safeParse(localStorage.getItem(key),{entries:[],budgets:{}})}
  function writeLocal(data,key=storageKey()){try{localStorage.setItem(key,JSON.stringify(data));return true}catch(e){toast("फोन की स्टोरेज भर गई है। एक्सपोर्ट करके बैकअप लें।");return false}}
  function localState(){return readLocal()}
  function saveLocalEntry(entry){
    const data=localState();const i=data.entries.findIndex(x=>x.id===entry.id);
    if(i>=0)data.entries[i]=entry;else data.entries.unshift(entry);
    writeLocal(data);entries=data.entries;render();
  }
  function showAuth(){ $("authPanel").classList.remove("hidden"); $("appPanel").classList.add("hidden"); $("logoutBtn").classList.add("hidden"); }
  function showApp(){
    $("authPanel").classList.add("hidden");$("appPanel").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");$("userEmail").textContent=user?.email||"Guest mode — केवल इस फोन में सेव";
  }
  function selectedMonth(){return $("monthFilter").value||monthNow}
  function visibleEntries(){return entries.filter(e=>String(e.entry_date).slice(0,7)===selectedMonth()).sort((a,b)=>String(b.entry_date).localeCompare(String(a.entry_date))||String(b.created_at||"").localeCompare(String(a.created_at||"")))}
  function totals(list){const sum=type=>list.filter(e=>e.type===type).reduce((s,e)=>s+Number(e.amount),0);const income=sum("income"),expense=sum("expense");return{income,expense,balance:income-expense}}
  function render(){
    const list=visibleEntries(),t=totals(list);
    $("totalIncome").textContent=money(t.income);$("totalExpense").textContent=money(t.expense);$("balance").textContent=money(t.balance);
    const spent=t.expense,percent=currentBudget>0?Math.min(100,spent/currentBudget*100):0;
    $("budgetProgress").style.width=percent+"%";
    $("budgetText").textContent=currentBudget>0?`${money(spent)} खर्च / ${money(currentBudget)} बजट · ${spent>currentBudget?"बजट से "+money(spent-currentBudget)+" अधिक":"बजट में "+money(currentBudget-spent)+" बाकी"}`:"इस महीने का बजट सेट करें।";
    $("recordCount").textContent=`${list.length} रिकॉर्ड`;
    const root=$("records");root.replaceChildren();
    if(!list.length){const p=document.createElement("p");p.className="muted";p.textContent="इस महीने कोई रिकॉर्ड नहीं है।";root.append(p);return}
    for(const e of list){
      const card=document.createElement("div");card.className="record";
      const main=document.createElement("div");main.className="record-main";
      const title=document.createElement("div");title.className="record-title";title.textContent=e.note||e.category||e.type;
      const typeLabel={income:"कमाई",expense:"खर्च",lend:"उधार दिया",borrow:"उधार लिया",repay:"उधार वापसी/भुगतान"}[e.type]||e.type;
      const sub=document.createElement("div");sub.className="record-sub";sub.textContent=`${e.entry_date} · ${e.category} · ${typeLabel}${e.pendingSync?" · सिंक बाकी":""}`;
      main.append(title,sub);
      const right=document.createElement("div");right.className="record-right";
      const amount=document.createElement("strong");amount.className=e.type==="income"?"amount-income":e.type==="expense"?"amount-expense":"amount-other";amount.textContent=money(e.amount);
      const del=document.createElement("button");del.className="delete";del.textContent="हटाएँ";del.addEventListener("click",()=>deleteEntry(e.id));
      right.append(amount,document.createElement("br"),del);card.append(main,right);root.append(card);
    }
  }
  async function loadData(){
    const local=localState();
    entries=local.entries||[];
    currentBudget=Number((local.budgets||{})[selectedMonth()]||0);
    $("budgetInput").value=currentBudget||"";
    render();
    if(!user||!sb||!navigator.onLine){setSync(user?"इंटरनेट नहीं है — रिकॉर्ड फोन में सेव हैं":"ऑफलाइन मोड — रिकॉर्ड केवल इस फोन में सेव हैं","offline");return}
    await syncNow();
  }
  async function syncNow(){
    if(syncBusy||!user||!sb||!navigator.onLine)return;
    syncBusy=true;setSync("क्लाउड से सिंक हो रहा है…");
    try{
      const local=localState();local.entries=local.entries||[];local.budgets=local.budgets||{};
      // Upload queued entries with stable client-generated UUIDs; this prevents duplicates on retries.
      const pending=local.entries.filter(e=>e.pendingSync);
      for(const e of pending){
        const payload={id:e.id,user_id:user.id,type:e.type,amount:Number(e.amount),category:e.category||"अन्य",entry_date:e.entry_date,note:e.note||null};
        const {error}=await sb.from("transactions").upsert(payload,{onConflict:"id"});
        if(error)throw error;
        e.pendingSync=false;
      }
      // Upload budgets saved while offline.
      for(const [month,b] of Object.entries(local.budgets)){
        if(b && b.pendingSync){
          const {error}=await sb.from("monthly_budgets").upsert({user_id:user.id,month,amount:Number(b.amount)},{onConflict:"user_id,month"});
          if(error)throw error;b.pendingSync=false;
        }
      }
      writeLocal(local);
      // Read cloud data, then keep locally queued items if a fetch temporarily fails.
      const {data,error}=await sb.from("transactions").select("*").order("entry_date",{ascending:false}).limit(5000);
      if(error)throw error;
      const queued=local.entries.filter(e=>e.pendingSync);
      const cloud=(data||[]).map(e=>({...e,pendingSync:false}));
      const map=new Map(cloud.map(e=>[e.id,e]));
      queued.forEach(e=>map.set(e.id,e));
      local.entries=Array.from(map.values());
      const {data:budgetRows,error:be}=await sb.from("monthly_budgets").select("*");
      if(be)throw be;
      (budgetRows||[]).forEach(b=>{local.budgets[b.month]={amount:Number(b.amount),pendingSync:false}});
      writeLocal(local);entries=local.entries;currentBudget=Number((local.budgets||{})[selectedMonth()]?.amount||0);
      $("budgetInput").value=currentBudget||"";render();setSync("क्लाउड सिंक पूरा",""); 
    }catch(err){console.error(err);setSync("सिंक बाकी — डेटा फोन में सुरक्षित है","error")}
    finally{syncBusy=false}
  }
  async function auth(action){
    if(!configured||!sb){message("authMsg","क्लाउड अकाउंट के लिए config.js में Supabase URL और public key सेट करें।",true);return}
    const email=$("email").value.trim(),password=$("password").value;
    if(!email||password.length<6){message("authMsg","सही ईमेल और कम से कम 6 अक्षर का पासवर्ड भरें।",true);return}
    message("authMsg","कृपया प्रतीक्षा करें…");
    const result=action==="signup"?await sb.auth.signUp({email,password}):await sb.auth.signInWithPassword({email,password});
    if(result.error){message("authMsg",result.error.message,true);return}
    if(action==="signup"&&!result.data.session){message("authMsg","अकाउंट बनाया गया। ईमेल verification पूरा करें, फिर लॉग इन करें।");return}
    user=result.data.user;mode="cloud";
    // Transfer guest-mode records once after sign-in, preserving their IDs to avoid duplicate inserts.
    const guest=readLocal(guestKey);const own=readLocal(`expenzo:v1:${user.id}`);
    const ownIds=new Set((own.entries||[]).map(e=>e.id));
    for(const e of (guest.entries||[])){if(!ownIds.has(e.id)){own.entries.push({...e,pendingSync:true});ownIds.add(e.id)}}
    own.budgets=own.budgets||{};
    Object.entries(guest.budgets||{}).forEach(([m,b])=>{if(!own.budgets[m])own.budgets[m]={...b,pendingSync:true}});
    writeLocal(own,`expenzo:v1:${user.id}`);
    showApp();await loadData();message("authMsg","");
  }
  $("loginBtn").addEventListener("click",()=>auth("login"));
  $("signupBtn").addEventListener("click",()=>auth("signup"));
  $("offlineBtn").addEventListener("click",()=>{user=null;mode="guest";showApp();loadData();});
  $("logoutBtn").addEventListener("click",async()=>{
    if(sb&&user)await sb.auth.signOut();user=null;mode="guest";showApp();loadData();
  });
  $("entryForm").addEventListener("submit",async ev=>{
    ev.preventDefault();
    const amount=Number($("amount").value),entryDate=$("entryDate").value;
    if(!(amount>0)||!entryDate){message("entryMsg","राशि और तारीख सही भरें।",true);return}
    const id=(crypto.randomUUID?crypto.randomUUID():`local-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    // For cloud-backed users the UUID is used as the server primary key. Guest data is queued for later upload.
    const entry={id,user_id:user?.id||null,type:$("type").value,amount,category:$("category").value,entry_date:entryDate,note:$("note").value.trim()||null,created_at:new Date().toISOString(),pendingSync:!!user};
    saveLocalEntry(entry);$("amount").value="";$("note").value="";
    message("entryMsg",user?"रिकॉर्ड फोन में सेव; क्लाउड सिंक होगा।":"रिकॉर्ड ऑफलाइन सेव हो गया। अकाउंट बनाकर क्लाउड में सिंक कर सकते हैं।");
    if(user&&navigator.onLine)syncNow();
  });
  async function deleteEntry(id){
    if(!confirm("क्या यह रिकॉर्ड हटाना चाहते हैं?"))return;
    const local=localState();local.entries=(local.entries||[]).filter(e=>e.id!==id);writeLocal(local);entries=local.entries;render();
    if(user&&sb&&navigator.onLine){
      const {error}=await sb.from("transactions").delete().eq("id",id).eq("user_id",user.id);
      if(error)toast("फोन से हटाया, लेकिन क्लाउड से हटाने के लिए दोबारा ऑनलाइन होकर जांचें");
      else toast("रिकॉर्ड हटा दिया गया");
    }else toast("रिकॉर्ड इस फोन से हटाया गया");
  }
  $("monthFilter").addEventListener("change",loadData);
  $("saveBudgetBtn").addEventListener("click",async()=>{
    const amount=Number($("budgetInput").value);
    if(amount<0||!Number.isFinite(amount)){toast("बजट की राशि सही भरें");return}
    const local=localState();local.budgets=local.budgets||{};
    local.budgets[selectedMonth()]={amount,pendingSync:!!user};writeLocal(local);currentBudget=amount;render();toast("बजट फोन में सेव हो गया");
    if(user&&sb&&navigator.onLine)syncNow();
  });
  function exportRows(){return visibleEntries().map(e=>({Date:e.entry_date,Type:({income:"Income",expense:"Expense",lend:"Lent",borrow:"Borrowed",repay:"Repayment"})[e.type]||e.type,Category:e.category,Amount:Number(e.amount),Note:e.note||""}))}
  $("exportExcel").addEventListener("click",()=>{
    const rows=exportRows();if(!rows.length){toast("एक्सपोर्ट करने के लिए रिकॉर्ड नहीं हैं");return}
    if(!window.XLSX){toast("Excel लाइब्रेरी लोड नहीं हुई; इंटरनेट चालू करके दोबारा प्रयास करें");return}
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Expenzo");XLSX.writeFile(wb,`Expenzo-${selectedMonth()}.xlsx`);
  });
  $("exportPdf").addEventListener("click",()=>{
    const rows=exportRows();if(!rows.length){toast("एक्सपोर्ट करने के लिए रिकॉर्ड नहीं हैं");return}
    if(!window.jspdf){toast("PDF लाइब्रेरी लोड नहीं हुई; इंटरनेट चालू करके दोबारा प्रयास करें");return}
    const {jsPDF}=window.jspdf;const doc=new jsPDF();const t=totals(visibleEntries());
    doc.setFontSize(18);doc.text("Expenzo",14,18);doc.setFontSize(11);
    doc.text(`Monthly report: ${selectedMonth()}`,14,27);doc.text(`Income: ${money(t.income)} | Expenses: ${money(t.expense)} | Balance: ${money(t.balance)}`,14,35);
    let y=45;doc.setFontSize(9);doc.text("Date       Type       Category       Amount (INR)       Note",14,y);y+=7;
    rows.forEach(r=>{const line=`${r.Date}  ${r.Type}  ${r.Category}  ${r.Amount}  ${(r.Note||"").slice(0,32)}`;const split=doc.splitTextToSize(line,180);if(y+split.length*5>280){doc.addPage();y=18}doc.text(split,14,y);y+=split.length*5+2});
    doc.save(`Expenzo-${selectedMonth()}.pdf`);
  });
  window.addEventListener("online",()=>{if(user)syncNow();else setSync("इंटरनेट उपलब्ध — अकाउंट बनाकर क्लाउड सिंक कर सकते हैं","")});
  window.addEventListener("offline",()=>setSync("ऑफलाइन — रिकॉर्ड फोन में सेव होंगे","offline"));
  if(configured){
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    sb.auth.getSession().then(({data})=>{if(data.session){user=data.session.user;showApp();loadData()}else showAuth()});
    sb.auth.onAuthStateChange((_event,session)=>{if(session){user=session.user;mode="cloud";showApp();loadData()}else if(mode==="cloud"){user=null;mode="guest";showApp();loadData()}});
  }else{
    // Guest/offline mode works without Supabase credentials.
    setSync("क्लाउड सेटअप बाकी — ऑफलाइन रिकॉर्ड इस्तेमाल कर सकते हैं","offline");
    showAuth();
  }
})();
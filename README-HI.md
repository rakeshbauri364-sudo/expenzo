# Expenzo — मोबाइल वेबसाइट + Android APK

## अभी क्या काम करता है
## नया: Offline-first guest mode
- बिना अकाउंट के भी ऐप खोलकर कमाई/खर्च फोन के browser storage में सेव कर सकते हैं.
- अकाउंट में लॉग इन/साइनअप करने पर guest records को क्लाउड में कॉपी करने की कोशिश होती है.
- ऑनलाइन होने पर cloud-backed records sync होते हैं.
- Guest mode का डेटा इसी फोन/browser में रहता है. Browser data clear या फोन खोने पर अकाउंट में सिंक होने से पहले डेटा खो सकता है; नियमित export करें.
- यह starter localStorage इस्तेमाल करता है; संवेदनशील/बहुत बड़े डेटा के लिए IndexedDB encryption और robust conflict/deletion sync अगला सुधार होना चाहिए.

- ईमेल/पासवर्ड अकाउंट (Supabase Auth)
- कमाई, खर्च, उधार दिया, उधार लिया, उधार वापसी/भुगतान रिकॉर्ड
- महीने के हिसाब से रिकॉर्ड और कमाई/खर्च/बैलेंस
- मासिक बजट और बची/अधिक राशि
- Excel (.xlsx) और basic PDF रिपोर्ट डाउनलोड
- Supabase में cloud sync; हर यूज़र का डेटा RLS policies से अलग

## ज़रूरी सीमाएँ
- ₹0 में कोड और शुरुआती build संभव है, लेकिन Supabase project, GitHub account और इंटरनेट चाहिए.
- यह starter ऐप है, audited financial product नहीं. असली वित्तीय रिकॉर्ड डालने से पहले टेस्ट करें.
- PDF में Devanagari font की गारंटी नहीं है; रिपोर्ट के labels में English इस्तेमाल है.
- APK बनाने के लिए GitHub Actions इस्तेमाल करें; वेबसाइट GitHub Pages पर publish की जा सकती है.
- कभी भी Supabase `service_role`/secret key frontend या APK में न डालें. केवल anon/publishable key + RLS.

## चरण 1: Supabase क्लाउड सेटअप
1. https://supabase.com पर अकाउंट बनाएं और नया project बनाएं.
2. Dashboard → SQL Editor → New query खोलें.
3. `supabase/schema.sql` की पूरी सामग्री paste करके Run करें.
4. Project Settings → API में Project URL और anon/publishable key कॉपी करें.
5. `www/config.js` में URL और key भरें. `service_role`/secret key नहीं.
6. Authentication → URL Configuration में वेबसाइट URL डालें. लोकल टेस्ट के लिए जरूरत के अनुसार redirect URL भी जोड़ें.
7. यदि email confirmation चालू है, signup के बाद ईमेल verify करें.

## चरण 2: मोबाइल वेबसाइट
1. GitHub पर नया public repository बनाएं, नाम `expenzo`.
2. इस ZIP की सभी फाइलें repository के root में upload करें (folders समेत).
3. `www/config.js` में Supabase URL/key भरकर commit करें.
4. GitHub repo → Settings → Pages → Build and deployment → Deploy from a branch चुनें.
5. Branch `main`, folder `/ (root)` चुनें और Save करें. वेबसाइट URL कुछ मिनट में खुलेगा.
6. Supabase Auth URL Configuration में GitHub Pages का वास्तविक URL add करें.
7. मोबाइल Chrome में URL खोलकर signup, login, entry, budget और export टेस्ट करें.

## चरण 3: GitHub से APK बनाएं (मोबाइल से)
1. GitHub repo में `.github/workflows/build-apk.yml` मौजूद होना चाहिए.
2. Actions tab → `Build Expenzo APK` workflow → Run workflow.
3. Build पूरा होने पर workflow run के नीचे Artifacts में `Expenzo-India-debug-apk` डाउनलोड करें.
4. ZIP extract करके `app-debug.apk` Android फोन में खोलें और install करें. जरूरत हो तो Android settings में उस source से app install की अनुमति दें.
5. हर नए code change पर workflow चलाएं. `app-debug.apk` टेस्टिंग के लिए है; Play Store release के लिए अलग signing/release setup चाहिए.

## सामान्य समस्याएं
- “Invalid API key” — config.js में Project URL और anon/publishable key जांचें.
- Signup के बाद login नहीं — email verification पूरा करें; Supabase Auth settings जांचें.
- डेटा सेव नहीं होता — SQL schema चलाया है या नहीं और browser console/network error जांचें.
- GitHub Pages पर login लौट आता है — Supabase Auth URL Configuration में सही Pages URL add करें.
- PDF में हिंदी टूटती है — इस starter में PDF का basic text English labels के साथ है; Devanagari font embed करना अलग enhancement है.

## डेटा मॉडल
`transactions`: type, amount, category, date, note.
`monthly_budgets`: user_id + month + amount.
उधार रिकॉर्ड फिलहाल लॉगबुक की तरह हैं; उधार की शेष राशि स्वतः मिलाने वाला अलग ledger अभी शामिल नहीं है.

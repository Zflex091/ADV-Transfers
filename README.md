# RideKaunas PRO

Privataus pervežimo rezervacijų svetainė, sukurta su React, TypeScript, Vite ir Vercel Serverless Functions.

## Paleidimas kompiuteryje

```powershell
cd ADV-services-staged
npm ci
npx vercel dev
```

Vien `npm run dev` atidaro tik dizaino peržiūrą: API adresams, maršrutams ir
mokėjimams šiame režime neveikia. Pilnam rezervacijos bandymui naudokite
`npx vercel dev` su testiniais Google Maps, Stripe, duomenų bazės ir el. pašto
nustatymais. Be jų rezervacija negali būti užbaigta.

Pirmą kartą paleidus `npx vercel dev`, pasirinkite **Create a new project**, o ne seną Vercel projektą. Atidarykite terminale parodytą adresą, paprastai `http://localhost:3000`.

## Funkcijos

- Adresų paieška ir pasirinkimas iš sąrašo
- Maršruto atstumo ir trukmės apskaičiavimas
- Dvi klasės: Economy (Opel Astra ST Black Edition 2025) ir Executive Minivan (Chrysler Pacifica 2024)
- Economy 2,20 €/km, Executive Minivan 2,50 €/km; 3,00 € įsėdimo mokestis įtrauktas į 25,00 € minimalią kainą
- Iki 4 keleivių ir 4 standartinių lagaminų Economy automobilyje; Minivan talpa priklauso nuo keleivių ir bagažo derinio
- Pasirašyto maršruto ir galutinės kainos patikra serveryje prieš rezervaciją ar mokėjimą
- Adresų pasirinkimai pasirašomi gavus „Google Place Details“ atsakymą; prieš mokėjimą serveris patikrina tikslią vietos ID, pavadinimo ir koordinačių atitiktį
- Rezervacija ne anksčiau nei po 30 minučių pagal `Europe/Vilnius` laiką
- Vardas, pavardė ir telefono numeris
- Visa kelionės suma internetu per „Stripe“ arba 0,50 € avansas per „Stripe“, likutį sumokant automobilyje grynaisiais / kortele
- Serverio patvirtinamas „Stripe“ mokėjimas, nuolatinis užsakymo įrašas ir apsauga nuo pasikartojančių paspaudimų / webhook
- Mobilus ir kompiuterio dizainas
- Atskiri maršruto, automobilio, pageidavimų, kontaktų ir mokėjimo žingsniai; grįžus į ankstesnį žingsnį įvesti duomenys išlieka
- Žalias kursas, nauji automobiliai, saugumas
- Atsinaujinantys degalai kaip pagrindinis išskirtinumas
- Orientacinė Economy kaina Kauno oro uostas → miesto centras / senamiestis: 35–40 €; galutinė kaina priklauso nuo tikslaus maršruto

Automobilių nuotraukos jau įtrauktos: `public/economy.png` (Opel) ir
`public/minivan.png` (Chrysler). Svetainė naudoja jų mažesnes WebP versijas.
Prieš paleidimą suderinkite, kokio dydžio bagažas laikomas standartiniu lagaminu.

## Mokėjimų ir užsakymų bazės prijungimas

Prieš priimant bet kokį mokėjimą prijunkite PostgreSQL bazę ir vieną kartą joje
įvykdykite [db/001_booking_payments.sql](db/001_booking_payments.sql). Šioje
bazėje saugomi užsakymo duomenys; į „Stripe“ siunčiamas tik vidinis atsitiktinis
užsakymo ID ir mokėtina suma. Kortelės duomenys svetainėje nesaugomi.

Vercel projekto aplinkos kintamuosiuose nustatykite:

```env
DATABASE_URL=postgresql://...
ORDER_STATUS_SECRET=ilga_atsitiktine_bent_32_simboliu_reiksme
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_SITE_URL=https://jusu-domenas.lt
```

„Stripe“ paskyroje sukurkite webhook į
`https://jusu-domenas.lt/api/stripe-webhook`, užregistruodami
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed` ir `checkout.session.expired` įvykius.
Naudokite testinius raktus ir testinę bazę iki bandomojo užsakymo patikros.
Lokaliam testavimui paslaptis laikykite tik `.env.local`; jos neturi patekti į
ZIP, Git ar naršyklės kodą. Viešas domenas turi būti HTTPS; vietiniam
`PUBLIC_SITE_URL` leidžiamas `http://localhost`.

„Mokėti automobilyje“ būdu „Stripe“ dabar nuskaito 0,50 € avansą, įskaitomą
į galutinę kelionės kainą. Internetu mokant visą kainą papildomo 0,50 €
nuskaitymo nėra. Grįžimo URL nieko nepatvirtina: užsakymas laikomas apmokėtu
tik po pasirašyto webhook ir išsaugotos teisingos sumos. Jei mokėjimas
nebaigtas arba nepavyko, patvirtinimas nesukuriamas. Šis avansas mažina
netikrų užsakymų riziką, bet netikrina tapatybės ir negarantuoja atvykimo.

Prieš realų paleidimą „Stripe“ paskyroje patikrinkite, ar 0,50 € mokėjimas
priimamas su naudojamais mokėjimo metodais ir kokie taikomi mokesčiai. Be
paskyros prieigos to patikrinti vien iš kodo negalima; avanso dydis dėl to
automatiškai nekeičiamas.

## Užsakymo laiškai (9 etapas)

Po pasirašytu „Stripe“ webhook patvirtinto mokėjimo sistema įrašo
užsakymo laišką į eilę ir bando jį išsiųsti verslo savininkui. Laiške yra
kliento kontaktai, abu adresai, kelionės ir mokėjimo duomenys bei tik
įjungti pageidavimai. Ankstesnė svetainė klientui patvirtinimo laiško
nesiuntė, todėl atskiro automatinio laiško klientui nenumatyta. Kodas
prijungtas, tačiau realus pristatymas priklauso nuo sukonfigūruotos bazės,
SMTP paskyros ir veikiančio diegimo; su tikra paskyra jis dar nepatikrintas.

Toje pačioje PostgreSQL bazėje po pirmosios migracijos įvykdykite
[db/002_booking_email_outbox.sql](db/002_booking_email_outbox.sql). Ši lentelė
saugo po vieną pristatymo įrašą kiekvienam užsakymui. Siuntimo kodas į eilę
priima tik apmokėtus užsakymus, o pakartotiniai bandymai naudoja tą patį
įrašą. Jei SMTP priimtų laišką, bet bazė nespėtų pažymėti jo kaip išsiųsto,
po laukimo termino sistema gali bandyti dar kartą; tokį retą neaiškaus
pristatymo atvejį reikia tikrinti pagal SMTP ir serverio žurnalus.

Kad laiškas būtų pristatomas, Vercel serverio aplinkoje nustatykite:

```env
SMTP_HOST=smtp.jusu-teikejas.lt
SMTP_PORT=587
SMTP_USER=jusiskis_smtp_naudotojas
SMTP_PASS=jusiskis_smtp_slaptazodis
SMTP_FROM=patvirtintas-siuntejas@jusu-domenas.lt
BOOKING_OWNER_EMAIL=patvirtintas-gavejas@jusu-domenas.lt
CRON_SECRET=ilga_atsitiktine_pakartojimo_kelio_paslaptis
```

`BOOKING_OWNER_EMAIL` įrašykite patvirtintą savininko adresą;
gavėjas kode nenustatytas. `SMTP_FROM` turi būti SMTP teikėjo leidžiamas
siuntėjo adresas. STARTTLS naudojamas su 587 prievadu, o TLS nuo ryšio
pradžios – su 465. `CRON_SECRET` saugo `GET /api/retry-booking-emails`:
kelias priima tik `Authorization: Bearer <CRON_SECRET>` antraštę, o be
paslapties visai neveikia. `vercel.json` numato jo iškvietimą kasdien
05:00 UTC. Vienu iškvietimu apdorojami daugiausia du eilėje laukiantys
apmokėtų užsakymų laiškai; kelias atsakyme pateikia tik rezultatų skaičius.
Šis tvarkaraštis pradės veikti tik įdiegus projektą su reikalingais
aplinkos kintamaisiais; tikras SMTP pristatymas dar nepatikrintas.

Slaptažodžių ir tikrų el. pašto adresų nedėkite į Git, ZIP archyvus ar
`VITE_` kintamuosius. Prieš naudojant produkcijoje, testinėje aplinkoje
patikrinkite visos sumos ir 0,50 € avanso užsakymus:
laiškas turi išeiti tik po pasirašyto webhook, o bazėje `adv_booking_email_outbox.state` turi tapti
`sent` ir `adv_booking_orders.confirmation_email_sent_at` – užpildytas.
Nepavykus SMTP siuntimui būsena lieka eilėje pakartotiniam bandymui.
Automatiniai testai (`npm run test:email`) naudoja netikrą SMTP transportą
ir tikrų laiškų nesiunčia. Galutinį pristatymą reikės patikrinti su jūsų
SMTP paskyra.

## Google Maps prijungimas

„Google Cloud“ projekte įjunkite **Places API (New)**, **Routes API** ir
**Maps JavaScript API**. Naudokite du atskirus raktus:

```env
# Tik Vercel serverio aplinkoje. Šis raktas nepatenka į naršyklę.
GOOGLE_MAPS_SERVER_API_KEY=...

# Neprivalomas atskiras serverio slaptasis raktas maršruto kainos žetonams.
# Jei nenurodytas, išvedamas iš GOOGLE_MAPS_SERVER_API_KEY.
ROUTE_TOKEN_SECRET=...

# Naršyklės žemėlapiui. Apribokite savo domeno HTTP referrer reikšmėmis.
VITE_GOOGLE_MAPS_BROWSER_API_KEY=...
```

Serverio raktą apribokite tik „Places API (New)“ ir „Routes API“, o naršyklės
raktą – tik „Maps JavaScript API“ bei svetainės domenais. Jei sąmoningai norite
naudoti mokamą eismo duomenų režimą, papildomai nustatykite
`GOOGLE_ROUTES_TRAFFIC_AWARE=true`; kitu atveju naudojamas standartinis
važiuojamas maršrutas be tariamo realaus laiko eismo tikslumo.

Be šių raktų forma negeneruoja atsitiktinio adreso, maršruto ar kainos – klientui
parodomas aiškus laikino nepasiekiamumo pranešimas.

Adreso patvirtinimo žetonas galioja iki 2 valandų. Po ilgos pertraukos arba
atnaujinus seną atidarytą svetainės kortelę gali reikėti iš naujo pasirinkti
abu adresus iš pasiūlymų sąrašo. Žetonui naudojama ta pati serverio
`ROUTE_TOKEN_SECRET` konfigūracija (arba atskirai šiam tikslui išvedamas raktas
iš `GOOGLE_MAPS_SERVER_API_KEY`), tačiau pats žetonas užsakymų bazėje
nesaugomas. Diegimo metu nekeiskite šių raktų, kol klientai pildo formas;
senos formos turės iš naujo patvirtinti adresus.

„Google Cloud“ taip pat nustatykite dienos kvotas ir biudžeto įspėjimus. API
tarpiniai serveriai riboja dažnas vieno adreso užklausas, tačiau serverless
aplinkoje tai yra tik pirmasis apsaugos sluoksnis; „Google Cloud“ kvotos lieka
galutinė išlaidų riba.

## Svarbu prieš paleidimą

Prieš paleisdami patikrinkite telefono numerį `src/App.tsx`, PostgreSQL
migraciją, „Stripe“ testinius mokėjimus ir webhook pranešimus. Senasis
`api/reservations.ts` kelias grąžina 410 ir nebegali patvirtinti neapmokėto
užsakymo.

# ADV Transfers – 1 etapo auditas

Audito data: 2026-09-22  
Darbinė šaka: `codex/adv-upgrade`  
Bazinis commit: `1036000a29d79bb741105b91fa99ff17934f55c8`

## Saugi darbo aplinka

- Originalas `C:\Users\PC\Downloads\ADV-services-updated` nebuvo pakeistas.
- Darbams sukurta atskira kopija `C:\Users\PC\Documents\Codex\ADV-services-staged` ir šaka `codex/adv-upgrade`.
- Originale jau buvo vienas neįtrauktas pakeitimas – ištrintas `.env.example`. Jis darbinėje kopijoje išsaugotas kaip ištrintas, kad nebūtų atkurta tai, ką vartotojas buvo pašalinęs.
- Sukurtas pilnos Git istorijos `.bundle`, šaltinio archyvas be `node_modules`, `dist`, `.git` ir slaptų aplinkos failų bei SHA-256 kontrolinės sumos.

## Esama technologija ir struktūra

- React 19, TypeScript 5.7 ir Vite 6.
- Vercel Serverless Functions kataloge `api/`.
- Stripe Checkout serverio biblioteka.
- Vieno puslapio rezervacijos sąsaja: didžioji būsena, tekstai, kainodara ir žingsniai sutelkti `src/App.tsx`.
- Adresų paieška: viešas OpenStreetMap Nominatim endpointas per `api/places.ts`.
- Maršrutas: viešas OSRM endpointas per `api/route.ts`.
- Duomenų bazės, užsakymų saugyklos, testų rinkinio, CI/CD ir Stripe webhook nėra.

`npm run build` patikra sėkminga. Bazinis atvaizdas taip pat sėkmingai sugeneruotas vietiniame Edge headless režime.

## Kas jau veikia ir turi būti išsaugota

- LT/EN kalbos pasirinkimas išlieka `localStorage`.
- Adresų paieška turi 450 ms uždelsimą, nutraukia pasenusias užklausas ir tikrina gautų koordinačių formatą.
- Ranka pakeitus pasirinktą adresą, senas struktūrizuotas pasirinkimas panaikinamas.
- Adresų sąrašas iš dalies valdomas klaviatūra: rodyklės, `Enter`, `Escape`.
- OSRM skaičiuoja važiuojamą maršrutą keliais, o ne atstumą tiesia linija.
- Grįžtant tarp dabartinių trijų žingsnių React būsena neprarandama.
- Stripe slaptas raktas naudojamas serverio funkcijoje, o kortelės numeriai svetainėje nesaugomi.
- Yra spaudžiamas telefono numeris, el. pašto ir WhatsApp nuorodos.
- Sąsaja turi mobiliojo vaizdo lūžio taškus ir `prefers-reduced-motion` palaikymą.

## Dabartinė pagrindinė verslo logika

Šiuo metu pagrindinė kainos, talpos ir laiko logika yra kliente, `src/App.tsx`:

- Kaina: `3 € + max(10 km, maršruto km) × 1,90 €`.
- Keleiviai: iki 4.
- Bagažas: iki 3.
- Išankstinė rezervacija: +2 valandos.
- Stripe endpointas galutinės kainos neperskaičiuoja ir pasitiki naršyklės atsiųsta suma.

Taisyklės dubliuojamos aktyviuose tekstuose, kainos atvaizdavime, nenaudojamame `src/i18n.ts` ir `README.md`. README net teigia kitą – 7 km – minimumą. Tai turi būti pakeista vienu bendru taisyklių šaltiniu, naudojamu klientui ir serveriui.

## Kritiniai radiniai

1. **Nėra užsakymų saugyklos.** `api/reservations.ts` tik sugeneruoja kodą ir nieko neišsaugo; frontendas šio endpointo net nekviečia.
2. **Kaina nėra apsaugota.** `api/create-checkout-session.ts` ima `booking.price` tiesiai iš kliento. Užklausą galima pakeisti ir sukurti Stripe sesiją neteisingai sumai.
3. **Nėra Stripe webhook ir būsenų.** Nėra `pending`, `confirmed`, `failed/cancelled`, PaymentIntent/Session išsaugojimo ar parašo tikrinimo.
4. **Nėra idempotencijos.** Pakartotinis paspaudimas ar būsimas pakartotas webhook galėtų sukurti kelias sesijas, patvirtinimus ar laiškus.
5. **„Mokėti automobilyje“ apeina Stripe.** Naršyklė tiesiai siunčia asmens duomenis į FormSubmit ir iškart rodo sėkmę; 0,50 € avanso nėra.
6. **Laiškai nėra serverio procesas.** Nėra mokėjimo patikros, pakartotinio siuntimo, pristatymo būsenos ar apsaugos nuo pasikartojimo. Laiške trūksta dalies net dabartinių laukų.
7. **Laiko taisyklė nepatikima.** `today` gaunama pagal UTC, o +2 val. riba – pagal naršyklės vietinį laiką. Nėra `Europe/Vilnius` ir serverio patikros; ties vidurnakčiu galimi neteisingi rezultatai.
8. **Maršruto geometrijos nėra.** OSRM kviečiamas su `overview=false`, todėl žemėlapyje neįmanoma parodyti visos trasos.
9. **Adresų įrašas neturi tiekėjo vietos ID.** Saugojami tik tekstas ir koordinatės. Nominatim paieška dabar visiškai apribota Lietuva ir turi nesuderintą kontaktinį `User-Agent`.
10. **Priklausomi duomenys ne visada išvalomi.** Pakeitus adresą panaikinamas `Place`, bet senas atstumas, trukmė ir kaina centralizuotai nenunulinami.
11. **Patvirtinimo ekranas aklai žada konkretų Opel ir numerį.** Realios automobilio paskyrimo sistemos nėra.
12. **Prieinamumas tik dalinis.** Trūksta pilnos combobox semantikos, su laukais susietų etikečių, `aria-live` klaidų ir vientisos `focus-visible` sistemos; dalis mobilių valdiklių per maži.

## Projekto turinio spragos

- `economy.png` ir `minivan.png` nerasti nei projekte, nei `Downloads` aplanke. Keturios pateiktos nuotraukos yra funkcionalumo pavyzdžiai, ne automobilių asset'ai.
- Telegram nuorodos nėra.
- Kliento el. pašto lauko nėra.
- Nėra automobilių, papildomų pageidavimų, mokėjimų ir el. laiškų pilno duomenų modelio.
- Nėra susietos Vercel testinės aplinkos (`.vercel/` nėra).
- Nežinoma, ar gyvoje sistemoje ankstesni užsakymai laikomi Gmail, Stripe, Vercel ar kitoje išorinėje sistemoje.

## Saugus tolesnis planas

1. Sukurti bendrus duomenų tipus ir vieną taisyklių modulį automobiliams, talpai, kainai, laiko ribai ir būsenoms.
2. Sutvarkyti struktūrizuotus adresus, aiškų išvalymą ir maršruto geometriją.
3. Pridėti dvi automobilių klases ir serverinę kainodaros/talpos patikrą.
4. Įgyvendinti +30 min. `Europe/Vilnius` taisyklę klientui ir serveriui.
5. Paruošti originalią dizaino kryptį patvirtinimui, tada įgyvendinti pilną naują rezervacijos eigą.
6. Pridėti keturis nemokamus pageidavimus ir jų saugų išsaugojimą.
7. Įdiegti patvarią užsakymų saugyklą, Stripe 0,50 € / pilnos sumos srautus, webhook ir idempotenciją.
8. Perkelti laiškus į serverį, pridėti vienkartinį siuntimą ir klaidų pakartojimą.
9. Sutvarkyti kontaktus, našumą, saugumą ir visus priėmimo scenarijus.
10. Tik po vartotojo patvirtinimo diegti į gyvą aplinką ir atlikti po-diegiminį patikrinimą.


export type Language = "lt" | "en";

export const translations = {
  lt: {
    route: "Maršrutas",
    contacts: "Kontaktai",
    payment: "Apmokėjimas",

    whereGoing: "Kur keliausite?",
    routeSubtitle:
      "Įveskite adresą ir pasirinkite tikslų variantą iš sąrašo.",

    pickup: "Iš kur",
    destination: "Kur",
    pickupPlaceholder: "Paėmimo vieta",
    destinationPlaceholder: "Kelionės tikslas",

    date: "Data",
    pickupTime: "Paėmimo laikas",
    minimumTime: "Rezervacija galima ne anksčiau nei po 30 min. (Lietuvos laiku).",

    passengers: "Keleiviai",
    luggage: "Bagažas",
    calculatePrice: "Apskaičiuoti kainą",

    contactDetails: "Kontaktiniai duomenys",
    contactSubtitle:
      "Įveskite savo duomenis, kad galėtume patvirtinti rezervaciją.",

    firstName: "Vardas",
    lastName: "Pavardė",
    phoneNumber: "Telefono numeris",
    continue: "Tęsti",
    back: "Grįžti",

    paymentTitle: "Pasirinkite mokėjimo būdą",
    paymentSubtitle:
      "Prieš patvirtindami rezervaciją patikrinkite kelionės informaciją.",

    payInCar: "Atsiskaitymas automobilyje",
    payInCarDescription: "Grynaisiais arba banko kortele",
    payStripe: "Apmokėti internetu",
    payStripeDescription: "Saugus išankstinis mokėjimas per Stripe",

    totalPrice: "Galutinė kelionės kaina",
    confirmBooking: "Patvirtinti rezervaciją",
    payAndBook: "Apmokėti ir rezervuoti",

    distance: "Atstumas",
    duration: "Trukmė",
    price: "Kaina",

    bookingConfirmed: "Rezervacija patvirtinta",
    bookingNumber: "Rezervacijos numeris",

    greenCourse: "Žalias kursas",
    renewableFuel: "Atsinaujinantys degalai",
    renewableDescription:
      "Naudodami atsinaujinančius degalus mažiname kelionių poveikį aplinkai ir padedame išsaugoti planetą.",

    newCars: "Nauji automobiliai",
    safety: "Saugumas",
    airportPrice: "Kauno oro uostas → miesto centras / senamiestis",
    airportPriceValue: "orientacinė Economy kaina 35–40 €",

    searchFailed: "Adresų paieška nepavyko. Bandykite dar kartą.",
    noAddresses: "Adresų nerasta. Įveskite tikslesnį adresą.",
    searching: "Ieškoma...",
    requiredFields: "Užpildykite visus privalomus laukus.",
  },

  en: {
    route: "Route",
    contacts: "Contact details",
    payment: "Payment",

    whereGoing: "Where are you going?",
    routeSubtitle:
      "Enter an address and select the exact option from the list.",

    pickup: "Pickup location",
    destination: "Destination",
    pickupPlaceholder: "Enter pickup address",
    destinationPlaceholder: "Enter destination",

    date: "Date",
    pickupTime: "Pickup time",
    minimumTime: "Book at least 30 minutes before pickup (Lithuanian time).",

    passengers: "Passengers",
    luggage: "Luggage",
    calculatePrice: "Calculate price",

    contactDetails: "Contact details",
    contactSubtitle:
      "Enter your details so we can confirm your reservation.",

    firstName: "First name",
    lastName: "Last name",
    phoneNumber: "Phone number",
    continue: "Continue",
    back: "Back",

    paymentTitle: "Choose a payment method",
    paymentSubtitle:
      "Review your trip details before confirming the reservation.",

    payInCar: "Pay in the vehicle",
    payInCarDescription: "Cash or bank card",
    payStripe: "Pay online",
    payStripeDescription: "Secure advance payment with Stripe",

    totalPrice: "Total trip price",
    confirmBooking: "Confirm reservation",
    payAndBook: "Pay and book",

    distance: "Distance",
    duration: "Duration",
    price: "Price",

    bookingConfirmed: "Reservation confirmed",
    bookingNumber: "Reservation number",

    greenCourse: "Green travel",
    renewableFuel: "Renewable fuel",
    renewableDescription:
      "By using renewable fuel, we reduce the environmental impact of each journey and help protect the planet.",

    newCars: "New vehicles",
    safety: "Safety",
    airportPrice: "Kaunas Airport → city centre / old town",
    airportPriceValue: "estimated Economy fare €35–40",

    searchFailed: "Address search failed. Please try again.",
    noAddresses: "No addresses found. Enter a more precise address.",
    searching: "Searching...",
    requiredFields: "Please complete all required fields.",
  },
} as const;

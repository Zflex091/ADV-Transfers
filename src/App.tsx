import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  CarFront,
  Check,
  ChevronLeft,
  Clock3,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  Phone,
  Route,
  Mail,
  MessageCircle,
} from "lucide-react";

import PlaceField from "./components/PlaceField";
import type { VehicleSelectorProps } from "./components/VehicleSelector";
import type {
  Booking,
  PaymentMethod,
  Place,
} from "./types";
import {
  calculatePaymentPlan,
  createEmptyPreferences,
  getVehicleCapacity,
  VEHICLES,
  type PricingSnapshot,
  type PreferredLanguageCode,
  type TripPreferences,
  type VehicleId,
} from "./domain/booking";
import {
  getEarliestVilniusPickup,
  ScheduleError,
  validatePickupSchedule,
} from "./domain/schedule";

type Language = "lt" | "en";

async function parseApiJson(response: Response, fallback: string) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("json")) {
    throw new Error(fallback);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(fallback);
  }
}

function safeApiMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError || error instanceof SyntaxError) return fallback;
  return error instanceof Error ? error.message : fallback;
}

function apiErrorText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

// Keep the address form interactive while later-step UI downloads on demand.
const GoogleRouteMap = lazy(() => import("./components/GoogleRouteMap"));
const VehicleSelector = lazy(() =>
  import("./components/VehicleSelector").then(({ VehicleSelector }) => ({
    default: VehicleSelector,
  })),
);

type RouteMapProps = {
  encodedPolyline: string;
  language?: Language;
  ariaLabel?: string;
};

class DeferredContentBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function DeferredRouteMap(props: RouteMapProps) {
  const english = props.language === "en";
  return (
    <DeferredContentBoundary
      fallback={
        <section className="google-route-map" aria-label={props.ariaLabel}>
          <div className="route-map-state route-map-error" role="alert">
            {english
              ? "The route map is unavailable. Your route details remain below."
              : "Žemėlapis nepasiekiamas. Maršruto duomenys pateikti žemiau."}
          </div>
        </section>
      }
    >
      <Suspense
        fallback={
          <section
            className="google-route-map"
            aria-label={props.ariaLabel || (english ? "Driving route map" : "Važiavimo maršruto žemėlapis")}
          >
            <div className="route-map-state" role="status">
              <LoaderCircle className="spin" aria-hidden="true" />
              <span>{english ? "Loading the route map..." : "Kraunamas maršruto žemėlapis..."}</span>
            </div>
          </section>
        }
      >
        <GoogleRouteMap {...props} />
      </Suspense>
    </DeferredContentBoundary>
  );
}

function DeferredVehicleSelector(props: VehicleSelectorProps) {
  return (
    <DeferredContentBoundary
      fallback={
        <div className="error" role="alert">
          {props.language === "en"
            ? "Vehicle choices failed to load. Refresh the page or call us."
            : "Automobilių pasirinkimų įkelti nepavyko. Atnaujinkite puslapį arba paskambinkite."}
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="quote-status" role="status">
            <LoaderCircle className="spin" aria-hidden="true" />
            {props.language === "en" ? "Loading vehicle choices..." : "Kraunami automobilių pasirinkimai..."}
          </div>
        }
      >
        <VehicleSelector {...props} />
      </Suspense>
    </DeferredContentBoundary>
  );
}

const CONTACT_PHONE = "+370 662 15037";
const CONTACT_PHONE_LINK = "+37066215037";
const CONTACT_EMAIL = "advserviceslt@gmail.com";
const WHATSAPP_LINK =
  "https://wa.me/37066215037";
const DRIVER_PHONE_LINK = CONTACT_PHONE_LINK;
const DRIVER_PHONE = CONTACT_PHONE

const translations = {
  lt: {
    pageTitle: "Kauno oro uosto pervežimai | ADV Services",

    route: "Maršrutas",
    contacts: "Kontaktai",
    payment: "Apmokėjimas",

    eyebrow: "Privatūs pervežimai · Kaunas",
    heroTitleFirst: "Oro uosto pervežimai,",
    heroTitleSecond: "be streso.",
    heroDescription:
      "Privatūs pervežimai iš Kauno oro uosto visoje Lietuvoje.",
    bookJourney: "Rezervuoti kelionę",
    callNow: "Skambinti",
    howItWorks: "Kaip veikia",
    contactNav: "Kontaktai",
    serviceLine: "Pirmiausia maršrutas, tada tinkamas automobilis ir aiški kaina.",

    estimatedPrice: "Orientacinė Economy kaina",
    airportCityPrice:
      "Kauno oro uostas → miesto centras / senamiestis: 35–40 €",

    whereGoing: "Rezervuokite kelionę",
    routeDescription:
      "Pasirinkite maršrutą ir paėmimo laiką.",

    pickup: "Iš kur",
    pickupPlaceholder: "Adresas, oro uostas ar vieta",
    destination: "Kur",
    destinationPlaceholder: "Kelionės tikslas",

    date: "Data",
    pickupTime: "Paėmimo laikas",
    reservationLimit:
      "Rezervacija galima ne anksčiau nei po 30 min. (Lietuvos laiku).",

    passengers: "Keleiviai",
    luggage: "Bagažas",

    decrease: "Mažinti",
    increase: "Didinti",

    selectRouteError:
      "Pasirinkite abu adresus iš pateikto sąrašo ir nurodykite kelionės laiką.",
    routeError: "Maršruto apskaičiuoti nepavyko.",

    calculating: "Skaičiuojama...",
    calculatePrice: "Ieškoti automobilių",

    changeRoute: "Keisti maršrutą",
    yourContacts: "Jūsų kontaktai",
    contactDescription:
      "Duomenys reikalingi rezervacijos patvirtinimui.",

    distance: "Atstumas",
    duration: "Trukmė",
    minutes: "min.",

    firstName: "Vardas",
    lastName: "Pavardė",
    phoneNumber: "Telefono numeris",
    emailAddress: "El. pašto adresas",

    firstNamePlaceholder: "Vardas",
    lastNamePlaceholder: "Pavardė",
    phonePlaceholder: "+370 662 15037",
    emailPlaceholder: "vardas@pastas.lt",

    contactError:
      "Įveskite vardą, pavardę, galiojantį el. pašto adresą ir telefono numerį.",

    continuePayment: "Tęsti į apmokėjimą",

    back: "Grįžti",
    howPay: "Kaip mokėsite?",
    finalPriceCalculated: "Galutinė kaina jau apskaičiuota.",
    finalTripPrice: "Galutinė kelionės kaina",
    chargedKm: "apmokestinamo km",

    payDriver: "Mokėti automobilyje",
    payDriverText:
      "Dabar 0,50 € avansas, likusi suma vairuotojui",

    payStripe: "Apmokėti visą sumą internetu",
    payStripeText:
      "Saugus internetinis mokėjimas per Stripe",
    recommended: "Rekomenduojama",

    securePayment:
      "Mokėjimo kortelės duomenys svetainėje nėra saugomi.",

    processing: "Vykdoma...",
    secureCheckout: "Pereiti į saugų mokėjimą",
    confirmBooking: "Patvirtinti rezervaciją",

    stripeError:
      "Nepavyko pradėti Stripe mokėjimo.",
    reservationError: "Rezervacija nepavyko.",

    reservationAccepted: "Apmokėjimas patvirtintas",
    bookingNumber: "Jūsų rezervacijos numeris",

    tripReady: "Jūsų kelionė paruošta",
    waitingAt: "Jūsų lauks",
    pickupTimeLabel: "Paėmimo laikas",
    vehicle: "Automobilis",
    supportTitle: "Kilus nesklandumams susisiekite",
    supportText:
      "Jeigu pasikeistų kelionės aplinkybės arba nepavyktų rasti automobilio, paskambinkite mums.",

  },

  en: {
    pageTitle: "Kaunas Airport Transfers | ADV Services",

    route: "Route",
    contacts: "Contact details",
    payment: "Payment",

    eyebrow: "Private transfers · Kaunas",
    heroTitleFirst: "Airport transfers,",
    heroTitleSecond: "without the stress.",
    heroDescription:
      "Private rides from Kaunas Airport across Lithuania.",
    bookJourney: "Book your transfer",
    callNow: "Call us",
    howItWorks: "How it works",
    contactNav: "Contact",
    serviceLine: "First the route, then the right vehicle and a clear fare.",

    estimatedPrice: "Estimated Economy fare",
    airportCityPrice:
      "Kaunas Airport → city centre / old town: €35–40",

    whereGoing: "Book transfer",
    routeDescription:
      "Choose your route and pickup time.",

    pickup: "Pickup location",
    pickupPlaceholder: "Address, airport or place",
    destination: "Destination",
    destinationPlaceholder: "Enter your destination",

    date: "Date",
    pickupTime: "Pickup time",
    reservationLimit:
      "Book at least 30 minutes before pickup (Lithuanian time).",

    passengers: "Passengers",
    luggage: "Luggage",

    decrease: "Decrease",
    increase: "Increase",

    selectRouteError:
      "Select both addresses from the list and specify the pickup time.",
    routeError: "The route could not be calculated.",

    calculating: "Calculating...",
    calculatePrice: "Search vehicles",

    changeRoute: "Change route",
    yourContacts: "Your contact details",
    contactDescription:
      "These details are required to confirm your reservation.",

    distance: "Distance",
    duration: "Duration",
    minutes: "min.",

    firstName: "First name",
    lastName: "Last name",
    phoneNumber: "Phone number",
    emailAddress: "Email address",

    firstNamePlaceholder: "First name",
    lastNamePlaceholder: "Last name",
    phonePlaceholder: "+370 662 15037",
    emailPlaceholder: "name@example.com",

    contactError:
      "Enter your first name, last name, a valid email address and phone number.",

    continuePayment: "Continue to payment",

    back: "Back",
    howPay: "How would you like to pay?",
    finalPriceCalculated:
      "The final price has already been calculated.",
    finalTripPrice: "Total trip price",
    chargedKm: "billable km",

    payDriver: "Pay in the vehicle",
    payDriverText:
      "€0.50 advance now, the balance to the driver",

    payStripe: "Pay the full fare online",
    payStripeText:
      "Secure online payment through Stripe",
    recommended: "Recommended",

    securePayment:
      "Your card details are not stored on this website.",

    processing: "Processing...",
    secureCheckout: "Continue to secure payment",
    confirmBooking: "Confirm reservation",

    stripeError:
      "Unable to start the Stripe payment.",
    reservationError:
      "The reservation could not be completed.",

    reservationAccepted: "Payment confirmed",
    bookingNumber: "Your reservation number",

    tripReady: "Your journey is ready",
    waitingAt: "Your vehicle will be waiting",
    pickupTimeLabel: "Pickup time",
    vehicle: "Vehicle",
    supportTitle: "Need assistance?",
    supportText:
      "If your travel plans change or you cannot find the vehicle, please call us.",

  },
} as const;

const initialPickup = getEarliestVilniusPickup();

const initialBooking: Booking = {
  pickup: null,
  destination: null,
  date: initialPickup.date,
  time: "",
  passengers: 1,
  luggage: 0,
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  paymentMethod: "driver",
  distanceKm: 0,
  durationMin: 0,
  distanceMeters: 0,
  durationSeconds: 0,
  routePolyline: "",
  routeProvider: null,
  routeToken: "",
  vehicleId: null,
  preferences: createEmptyPreferences(),
  pricing: null,
  price: 0,
};

const languageNames: Record<PreferredLanguageCode, { lt: string; en: string }> = {
  lt: { lt: "Lietuvių", en: "Lithuanian" },
  en: { lt: "Anglų", en: "English" },
  ru: { lt: "Rusų", en: "Russian" },
  pl: { lt: "Lenkų", en: "Polish" },
  other: { lt: "Kita", en: "Other" },
};

function activePreferences(preferences: TripPreferences): TripPreferences {
  return {
    spotify: preferences.spotify.enabled
      ? { enabled: true, preference: preferences.spotify.preference.trim() }
      : { enabled: false, preference: "" },
    preferredLanguage: preferences.preferredLanguage.enabled
      ? {
          enabled: true,
          language: preferences.preferredLanguage.language,
          otherLanguage: preferences.preferredLanguage.language === "other"
            ? preferences.preferredLanguage.otherLanguage.trim()
            : "",
        }
      : { enabled: false, language: null, otherLanguage: "" },
    meetAndGreet: preferences.meetAndGreet.enabled
      ? { enabled: true, signText: preferences.meetAndGreet.signText.trim() }
      : { enabled: false, signText: "" },
    driverComment: preferences.driverComment.enabled
      ? { enabled: true, text: preferences.driverComment.text.trim() }
      : { enabled: false, text: "" },
  };
}

function preferenceValidationError(
  preferences: TripPreferences,
  language: Language,
): string | null {
  if (preferences.preferredLanguage.enabled && !preferences.preferredLanguage.language) {
    return language === "lt"
      ? "Pasirinkite pageidaujamą vairuotojo kalbą."
      : "Choose your preferred driver language.";
  }
  if (
    preferences.preferredLanguage.enabled &&
    preferences.preferredLanguage.language === "other" &&
    !preferences.preferredLanguage.otherLanguage.trim()
  ) {
    return language === "lt"
      ? "Įrašykite pageidaujamą kalbą."
      : "Enter your preferred language.";
  }
  if (preferences.meetAndGreet.enabled && !preferences.meetAndGreet.signText.trim()) {
    return language === "lt"
      ? "Įrašykite vardą arba įmonės pavadinimą pasitikimo lentelei."
      : "Enter the name or company to display on the meet-and-greet sign.";
  }
  return null;
}

function preferenceSummary(
  preferences: TripPreferences,
  language: Language,
): Array<{ label: string; value: string }> {
  const active = activePreferences(preferences);
  const rows: Array<{ label: string; value: string }> = [];
  if (active.spotify.enabled) {
    rows.push({
      label: language === "lt" ? "Muzika" : "Music",
      value: active.spotify.preference || (language === "lt" ? "Spotify, pasirinkimas nenurodytas" : "Spotify, no preference specified"),
    });
  }
  if (active.preferredLanguage.enabled && active.preferredLanguage.language) {
    rows.push({
      label: language === "lt" ? "Kalba" : "Language",
      value: active.preferredLanguage.language === "other"
        ? active.preferredLanguage.otherLanguage
        : languageNames[active.preferredLanguage.language][language],
    });
  }
  if (active.meetAndGreet.enabled) {
    rows.push({
      label: language === "lt" ? "Pasitikimas su lentele" : "Meet and greet sign",
      value: active.meetAndGreet.signText,
    });
  }
  if (active.driverComment.enabled) {
    rows.push({
      label: language === "lt" ? "Komentaras vairuotojui" : "Driver comment",
      value: active.driverComment.text || (language === "lt" ? "Papildomų detalių nėra" : "No further details"),
    });
  }
  return rows;
}

type CheckoutReturn = { kind: "success" | "cancelled"; orderId: string };
type CheckoutStatus = {
  status: "pending" | "paid" | "failed" | "cancelled" | "error";
  bookingCode?: string;
  paymentMethod?: "online-full" | "pay-in-vehicle";
  totalCents?: number;
  paidCents?: number;
  balanceCents?: number;
};

const checkoutDraftKey = "adv-checkout-draft";
const checkoutRequestKey = "adv-checkout-request";

function getCheckoutReturn(): CheckoutReturn | null {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("checkout");
  if (kind !== "success" && kind !== "cancelled") return null;
  return { kind, orderId: params.get("order_id") ?? "" };
}

function readCheckoutDraft(): Booking | null {
  try {
    const raw = sessionStorage.getItem(checkoutDraftKey);
    if (!raw) return null;
    const draft: unknown = JSON.parse(raw);
    if (
      typeof draft !== "object" || draft === null ||
      !("routeToken" in draft) || typeof draft.routeToken !== "string" ||
      !("preferences" in draft) || typeof draft.preferences !== "object"
    ) return null;
    return draft as Booking;
  } catch {
    return null;
  }
}

function getOrCreateClientRequestId(payload: Booking): string {
  const fingerprint = JSON.stringify(payload);
  try {
    const previous = sessionStorage.getItem(checkoutRequestKey);
    if (previous) {
      const parsed: { fingerprint?: string; id?: string } = JSON.parse(previous);
      if (parsed.fingerprint === fingerprint && parsed.id) return parsed.id;
    }
  } catch {
    // A fresh request ID still keeps this click safe when storage is unavailable.
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(checkoutRequestKey, JSON.stringify({ fingerprint, id }));
  return id;
}

function money(cents: number, language: Language): string {
  const amount = (cents / 100).toFixed(2);
  return `${language === "lt" ? amount.replace(".", ",") : amount} €`;
}

export default function App() {
  const checkoutReturn = useMemo(getCheckoutReturn, []);
  const [language, setLanguage] =
    useState<Language>(() => {
      const savedLanguage = localStorage.getItem(
        "adv-language",
      );

      return savedLanguage === "lt" ? "lt" : "en";
    });

  const [booking, setBooking] =
    useState<Booking>(() => checkoutReturn ? readCheckoutDraft() ?? initialBooking : initialBooking);
  const [step, setStep] = useState(checkoutReturn ? 6 : 1);
  const [routeLoading, setRouteLoading] =
    useState(false);
  const [submitting, setSubmitting] =
    useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus | null>(
    checkoutReturn ? { status: "pending" } : null,
  );
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const routeAbortControllerRef =
    useRef<AbortController | null>(null);
  const routeRequestIdRef = useRef(0);
  const routeCalculatedAtRef = useRef(0);

  const t = translations[language];
  const selectedPreferences = activePreferences(booking.preferences);
  const selectedPreferenceRows = preferenceSummary(booking.preferences, language);
  const paymentPlan = booking.pricing
    ? calculatePaymentPlan(
        booking.paymentMethod === "stripe" ? "online-full" : "pay-in-vehicle",
        booking.pricing.totalCents,
      )
    : null;
  const bookingMatchesPaidStatus = checkoutStatus?.status === "paid" &&
    booking.pricing?.totalCents === checkoutStatus.totalCents &&
    (booking.paymentMethod === "driver" ? "pay-in-vehicle" : "online-full") === checkoutStatus.paymentMethod;

  const earliestPickup = useMemo(
    () => getEarliestVilniusPickup(clockMs),
    [clockMs],
  );
  const minTime = booking.date === earliestPickup.date
    ? earliestPickup.time
    : "00:00";

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step, done]);

  useEffect(() => {
    localStorage.setItem("adv-language", language);
    document.documentElement.lang = language;
    document.title = t.pageTitle;
  }, [language, t.pageTitle]);

  useEffect(() => {
    if (!checkoutReturn) return;
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();
    let checks = 0;
    let token: string | null = null;
    try {
      token = sessionStorage.getItem(`adv-order-token:${checkoutReturn.orderId}`);
    } catch {
      // The status cannot be trusted without the token returned for this order.
    }
    if (!checkoutReturn.orderId || !token) {
      setCheckoutStatus({ status: "error" });
      return;
    }

    async function checkPayment() {
      try {
        const response = await fetch(
          `/api/booking-status?order_id=${encodeURIComponent(checkoutReturn!.orderId)}`,
          {
            headers: { "X-Booking-Token": token! },
            signal: controller.signal,
          },
        );
        const data: CheckoutStatus & { error?: string } = await parseApiJson(response, "Unable to verify payment status.");
        if (!response.ok || !["pending", "paid", "failed", "cancelled"].includes(data.status)) {
          throw new Error(apiErrorText(data.error, "Unable to verify payment status."));
        }
        if (stopped) return;
        if (data.status === "paid") {
          if (!data.bookingCode) throw new Error("Missing booking confirmation.");
          setCheckoutStatus(data);
          setDone(data.bookingCode);
          sessionStorage.removeItem(`adv-order-url:${checkoutReturn!.orderId}`);
          return;
        }
        setCheckoutStatus(data);
        if (data.status === "pending" && ++checks < 30) {
          timer = window.setTimeout(checkPayment, 2000);
        }
      } catch (caughtError) {
        if (!stopped && !(caughtError instanceof DOMException && caughtError.name === "AbortError")) {
          setCheckoutStatus({ status: "error" });
        }
      }
    }

    void checkPayment();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [checkoutReturn, statusRefresh]);

  useEffect(() => {
    if (checkoutReturn) return;
    if (!booking.routeToken || !booking.vehicleId) {
      setQuoteLoading(false);
      return;
    }

    const controller = new AbortController();
    const selectedVehicleId = booking.vehicleId;
    const routeToken = booking.routeToken;
    const passengers = booking.passengers;
    const luggage = booking.luggage;
    setQuoteLoading(true);
    setQuoteError("");

    async function confirmQuote() {
      try {
        const response = await fetch("/api/quote", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ routeToken, passengers, luggage }),
          signal: controller.signal,
        });
        const result = await parseApiJson(response, t.routeError);

        if (!response.ok) {
          throw new Error(apiErrorText(result.error, t.routeError));
        }

        const selected = result.vehicles?.find(
          (vehicle: { vehicleId: VehicleId }) =>
            vehicle.vehicleId === selectedVehicleId,
        );
        const pricing = selected?.pricing as PricingSnapshot | null;

        if (
          !selected?.capacity?.available ||
          !pricing ||
          pricing.vehicleId !== selectedVehicleId ||
          pricing.distanceMeters !== booking.distanceMeters ||
          !Number.isInteger(pricing.totalCents) ||
          pricing.totalCents < 2500
        ) {
          throw new Error(
            language === "lt"
              ? "Pasirinkta kelionė nebetinka. Patikrinkite keleivių ir bagažo skaičių."
              : "This vehicle is no longer available for your party. Check your passenger and luggage counts.",
          );
        }

        if (!controller.signal.aborted) {
          setBooking((current) =>
            current.routeToken === routeToken &&
            current.vehicleId === selectedVehicleId &&
            current.passengers === passengers &&
            current.luggage === luggage
              ? {
                  ...current,
                  pricing,
                  price: pricing.totalCents / 100,
                }
              : current,
          );
        }
      } catch (caughtError) {
        if (controller.signal.aborted) return;
        setQuoteError(safeApiMessage(caughtError, t.routeError));
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }

    void confirmQuote();
    return () => controller.abort();
  }, [booking.routeToken, booking.vehicleId, booking.passengers, booking.luggage, booking.distanceMeters, language, t.routeError, checkoutReturn]);

  const update = <K extends keyof Booking>(
    key: K,
    value: Booking[K],
  ) => {
    setBooking((currentBooking) => ({
      ...currentBooking,
      [key]: value,
    }));
  };

  function updatePreference<K extends keyof TripPreferences>(
    key: K,
    changes: Partial<TripPreferences[K]>,
  ) {
    setBooking((current) => ({
      ...current,
      preferences: {
        ...current.preferences,
        [key]: { ...current.preferences[key], ...changes },
      },
    }));
    setError("");
  }

  function updateParty(key: "passengers" | "luggage", value: number) {
    setQuoteError("");
    setBooking((current) => {
      const passengers = key === "passengers" ? value : current.passengers;
      const luggage = key === "luggage" ? value : current.luggage;
      const vehicleId =
        current.vehicleId &&
        getVehicleCapacity(current.vehicleId, passengers, luggage).available
          ? current.vehicleId
          : null;

      return {
        ...current,
        passengers,
        luggage,
        vehicleId,
        pricing: null,
        price: 0,
      };
    });
  }

  function selectVehicle(vehicleId: VehicleId) {
    if (!getVehicleCapacity(vehicleId, booking.passengers, booking.luggage).available) {
      return;
    }

    setQuoteError("");
    setBooking((current) => ({
      ...current,
      vehicleId,
      pricing: null,
      price: 0,
    }));
  }

  function updateRouteDependency<
    K extends "pickup" | "destination" | "date" | "time",
  >(key: K, value: Booking[K]) {
    routeAbortControllerRef.current?.abort();
    routeRequestIdRef.current += 1;
    routeCalculatedAtRef.current = 0;
    setRouteLoading(false);
    setBooking((currentBooking) => ({
      ...currentBooking,
      [key]: value,
      distanceKm: 0,
      durationMin: 0,
      distanceMeters: 0,
      durationSeconds: 0,
      routePolyline: "",
      routeProvider: null,
      routeToken: "",
      vehicleId: null,
      pricing: null,
      price: 0,
    }));
    setError("");

    if (step > 1) {
      setStep(1);
    }
  }

  function pickupTimeIsValid() {
    try {
      validatePickupSchedule(booking.date, booking.time, Date.now());
      return true;
    } catch (caughtError) {
      const englishMessage = caughtError instanceof ScheduleError
        ? {
            "invalid-date": "Choose a valid pickup date.",
            "invalid-time": "Choose a valid pickup time.",
            "nonexistent-time": "This time does not exist because the clocks move forward. Choose another time.",
            "ambiguous-time": "This time occurs twice because the clocks move back. Choose another time.",
            "too-soon": "Book at least 30 minutes before pickup. Choose a later time.",
          }[caughtError.code]
        : "Choose a valid pickup time at least 30 minutes from now (Europe/Vilnius).";
      setError(
        language === "lt" && caughtError instanceof Error
          ? caughtError.message
          : englishMessage,
      );
      return false;
    }
  }

  function continueTo(nextStep: number) {
    setError("");
    if (!pickupTimeIsValid()) return;
    if (nextStep === 5) {
      const preferenceError = preferenceValidationError(booking.preferences, language);
      if (preferenceError) {
        setError(preferenceError);
        return;
      }
    }
    setStep(nextStep);
  }

  async function calculate() {
    setError("");

    if (
      !booking.pickup ||
      !booking.destination ||
      !booking.date ||
      !booking.time
    ) {
      setError(t.selectRouteError);
      return;
    }

    if (!pickupTimeIsValid()) return;

    if (
      booking.routeToken &&
      booking.routePolyline &&
      booking.distanceMeters > 0 &&
      Date.now() - routeCalculatedAtRef.current < 25 * 60 * 1000
    ) {
      setStep(3);
      return;
    }

    routeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    routeAbortControllerRef.current = controller;
    const requestId = ++routeRequestIdRef.current;
    setRouteLoading(true);

    setBooking((currentBooking) => ({
      ...currentBooking,
      distanceKm: 0,
      durationMin: 0,
      distanceMeters: 0,
      durationSeconds: 0,
      routePolyline: "",
      routeProvider: null,
      routeToken: "",
      vehicleId: null,
      pricing: null,
      price: 0,
    }));

    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          origin: {
            latitude: booking.pickup.latitude,
            longitude: booking.pickup.longitude,
          },
          destination: {
            latitude: booking.destination.latitude,
            longitude: booking.destination.longitude,
          },
          language,
        }),
        signal: controller.signal,
      });
      const data = await parseApiJson(response, t.routeError);

      if (
        controller.signal.aborted ||
        requestId !== routeRequestIdRef.current
      ) {
        return;
      }

      if (!response.ok) {
        throw new Error(apiErrorText(data.error, t.routeError));
      }

      if (
        data.provider !== "mapbox" ||
        !Number.isFinite(data.distanceMeters) ||
        !Number.isFinite(data.durationSeconds) ||
        typeof data.encodedPolyline !== "string" ||
        !data.encodedPolyline ||
        typeof data.routeToken !== "string" ||
        !data.routeToken
      ) {
        throw new Error(t.routeError);
      }

      setBooking((currentBooking) => ({
        ...currentBooking,
        distanceKm: Number(
          (data.distanceMeters / 1000).toFixed(1),
        ),
        durationMin: Math.max(
          1,
          Math.ceil(data.durationSeconds / 60),
        ),
        distanceMeters: data.distanceMeters,
        durationSeconds: data.durationSeconds,
        routePolyline: data.encodedPolyline,
        routeProvider: "mapbox",
        routeToken: data.routeToken,
        vehicleId: null,
        pricing: null,
        price: 0,
      }));

      routeCalculatedAtRef.current = Date.now();

      setStep(3);
    } catch (caughtError) {
      if (
        caughtError instanceof DOMException &&
        caughtError.name === "AbortError"
      ) {
        return;
      }

      setError(safeApiMessage(caughtError, t.routeError));
    } finally {
      if (requestId === routeRequestIdRef.current) {
        setRouteLoading(false);
      }
    }
  }

  function validateContact() {
    setError("");

    if (!pickupTimeIsValid()) return;

    if (!booking.vehicleId || !booking.pricing || quoteLoading || booking.price <= 0) {
      setError(
        language === "lt"
          ? "Pasirinkite tinkamą automobilį ir palaukite, kol kaina bus patvirtinta."
          : "Choose an available vehicle and wait for the price to be confirmed.",
      );
      return;
    }

    const phoneDigits = booking.phone.replace(/\D/g, "");
    const validPhone = phoneDigits.length >= 8 && phoneDigits.length <= 15;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email.trim()) && booking.email.length <= 254;

    if (
      !booking.firstName.trim() ||
      !booking.lastName.trim() ||
      !validPhone ||
      !validEmail
    ) {
      setError(t.contactError);
      return;
    }

    setStep(6);
  }

  async function submit() {
    setError("");

    if (!pickupTimeIsValid()) return;

    const preferenceError = preferenceValidationError(booking.preferences, language);
    if (preferenceError) {
      setStep(4);
      setError(preferenceError);
      return;
    }

    setSubmitting(true);

    try {
      if (
        !booking.pickup ||
        !booking.destination ||
        !booking.routeToken ||
        !booking.vehicleId ||
        !booking.pricing ||
        !getVehicleCapacity(
          booking.vehicleId,
          booking.passengers,
          booking.luggage,
        ).available
      ) {
        throw new Error(
          language === "lt"
            ? "Kelionės kaina paseno. Grįžkite ir pasirinkite automobilį iš naujo."
            : "The trip quote is no longer valid. Go back and choose the vehicle again.",
        );
      }

      const normalizedBooking = { ...booking, preferences: selectedPreferences };
      const clientRequestId = getOrCreateClientRequestId(normalizedBooking);
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...normalizedBooking, clientRequestId }),
      });
      const data: {
        url?: string;
        orderId?: string;
        statusToken?: string;
        totalCents?: number;
        dueNowCents?: number;
        balanceCents?: number;
        error?: string;
      } = await parseApiJson(response, t.stripeError);
      if (!response.ok || !data.url || !data.orderId || !data.statusToken) {
        throw new Error(apiErrorText(data.error, t.stripeError));
      }
      if (!paymentPlan) throw new Error(t.stripeError);
      if (
        data.totalCents !== paymentPlan.totalCents ||
        data.dueNowCents !== paymentPlan.amountDueNowCents ||
        data.balanceCents !== paymentPlan.remainingAfterSuccessfulPaymentCents
      ) {
        throw new Error(language === "lt"
          ? "Mokėjimo suma pasikeitė. Atnaujinkite kelionės kainą."
          : "The payment amount changed. Refresh your trip fare.");
      }
      const checkoutUrl = new URL(data.url);
      if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") {
        throw new Error(t.stripeError);
      }
      sessionStorage.setItem(`adv-order-token:${data.orderId}`, data.statusToken);
      sessionStorage.setItem(`adv-order-url:${data.orderId}`, checkoutUrl.href);
      sessionStorage.setItem(checkoutDraftKey, JSON.stringify(normalizedBooking));
      window.location.assign(checkoutUrl.href);
    } catch (caughtError) {
      setError(safeApiMessage(caughtError, t.reservationError));
    } finally {
      setSubmitting(false);
    }
  }

  function retryPayment() {
    if (checkoutReturn?.kind === "cancelled" && checkoutStatus?.status === "pending") {
      const savedUrl = sessionStorage.getItem(`adv-order-url:${checkoutReturn.orderId}`);
      if (savedUrl) {
        try {
          const checkoutUrl = new URL(savedUrl);
          if (checkoutUrl.protocol === "https:" && checkoutUrl.hostname === "checkout.stripe.com") {
            window.location.assign(checkoutUrl.href);
            return;
          }
        } catch {
          // A malformed saved URL falls back to the checked server request.
        }
      }
    }
    if (checkoutStatus?.status === "failed" || checkoutStatus?.status === "cancelled") {
      sessionStorage.removeItem(checkoutRequestKey);
    }
    void submit();
  }

  function setPlace(
    key: "pickup" | "destination",
    place: Place | null,
  ) {
    updateRouteDependency(key, place);
  }

  const flowSteps = language === "lt"
    ? [
        { value: 1, label: "Maršrutas" },
        { value: 3, label: "Automobilis" },
        { value: 4, label: "Pageidavimai" },
        { value: 5, label: "Kontaktai" },
        { value: 6, label: "Mokėjimas" },
      ]
    : [
        { value: 1, label: "Route" },
        { value: 3, label: "Vehicle" },
        { value: 4, label: "Extras" },
        { value: 5, label: "Details" },
        { value: 6, label: "Payment" },
      ];
  const activeFlowIndex = Math.max(0, flowSteps.findIndex((item) => item.value === step));

  return (
    <div className="site-shell" data-booking-step={step} data-booking-done={Boolean(done)}>
      <header className="site-header">
        <div className="site-header-inner">
          <a className="brand" href="#top" aria-label="ADV Services">
            <img src="/adv-logo.svg" alt="" />
            <span className="brand-wordmark"><b>ADV</b><small>SERVICES</small></span>
          </a>

          <div className="header-actions">
            <div className="language-switcher" aria-label={language === "lt" ? "Kalba" : "Language"}>
              <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
              <span aria-hidden="true" />
              <button type="button" className={language === "lt" ? "active" : ""} onClick={() => setLanguage("lt")}>LT</button>
            </div>
            <a className="phone" href={`tel:${CONTACT_PHONE_LINK}`} aria-label={`${t.callNow}: ${CONTACT_PHONE}`}>
              <Phone aria-hidden="true" />
              <span>{CONTACT_PHONE}</span>
            </a>
          </div>
        </div>
      </header>

      <main id="top" className={step === 1 && !done ? "landing-main" : "booking-main"}>
        {step === 1 && !done && (
          <section id="services" className="hero-copy">
            <div className="eyebrow">{language === "lt" ? "Privatūs oro uosto pervežimai" : "Private airport transfers"}</div>
            <h1>{t.heroTitleFirst}<br /><em>{t.heroTitleSecond}</em></h1>
            <p>{t.heroDescription}</p>

            <div className="hero-trust" aria-label={language === "lt" ? "Paslaugos privalumai" : "Service benefits"}>
              <span><Clock3 aria-hidden="true" />24/7</span>
              <span><LockKeyhole aria-hidden="true" />{language === "lt" ? "Fiksuota kaina" : "Fixed price"}</span>
              <span><CarFront aria-hidden="true" />{language === "lt" ? "Profesionalūs vairuotojai" : "Professional drivers"}</span>
            </div>

            <div className="hero-payment-note" aria-label={language === "lt" ? "Atsiskaitymo būdai" : "Payment options"}>
              <span><CreditCard aria-hidden="true" />{language === "lt" ? "Stripe internetu" : "Stripe online"}</span>
              <span><Banknote aria-hidden="true" />{language === "lt" ? "Mokėjimas automobilyje" : "Pay in car"}</span>
            </div>

          </section>
        )}

        <div className="booking-workspace">
        <motion.section
          id="booking"
          className="booking-card"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55 }}
        >
          {step > 1 && !done && <div className="steps" aria-label={language === "lt" ? "Rezervacijos eiga" : "Reservation progress"}>
            {flowSteps.map((item, index) => {
              const complete = activeFlowIndex > index;
              const active = activeFlowIndex >= index;
              return (
                <div
                  key={item.value}
                  aria-label={`${index + 1}. ${item.label}`}
                  aria-current={step === item.value ? "step" : undefined}
                  className={active ? "active" : ""}
                >
                  <span>{complete ? <Check /> : index + 1}</span>
                  <small>{item.label}</small>
                </div>
              );
            })}
          </div>}

          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                className="success"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <div className="success-icon">
                  <Check />
                </div>

                <h2>{t.reservationAccepted}</h2>
                <p>{t.bookingNumber}</p>
                <strong>{done}</strong>

                {checkoutStatus?.status === "paid" &&
                  Number.isInteger(checkoutStatus.totalCents) &&
                  Number.isInteger(checkoutStatus.paidCents) &&
                  Number.isInteger(checkoutStatus.balanceCents) && (
                    <dl className="confirmed-payment">
                      <div><dt>{language === "lt" ? "Bendra kelionės kaina" : "Total trip fare"}</dt><dd>{money(checkoutStatus.totalCents!, language)}</dd></div>
                      <div><dt>{language === "lt" ? "Sumokėta per „Stripe“" : "Paid through Stripe"}</dt><dd>{money(checkoutStatus.paidCents!, language)}</dd></div>
                      <div><dt>{language === "lt" ? "Mokėti automobilyje" : "Pay in the vehicle"}</dt><dd>{money(checkoutStatus.balanceCents!, language)}</dd></div>
                    </dl>
                  )}

                <div className="driver-info">
                  {bookingMatchesPaidStatus && <>
                  <div className="driver-info-heading">
                    <CarFront />

                    <div>
                      <small>{t.tripReady}</small>
                      <h3>
                        {booking.time} {t.waitingAt}{" "}
                        {booking.vehicleId ? VEHICLES[booking.vehicleId].model : ""}
                      </h3>
                    </div>
                  </div>

                  <div className="driver-card">
                    <div className="driver-row">
                      <span>{t.pickupTimeLabel}</span>
                      <b>{booking.time}</b>
                    </div>

                    <div className="driver-row">
                      <span>{t.vehicle}</span>
                      <b>{booking.vehicleId ? VEHICLES[booking.vehicleId].model : ""}</b>
                    </div>
                  </div>
                  </>}

                  <a
                    className="support-box"
                    href={`tel:${DRIVER_PHONE_LINK}`}
                  >
                    <div className="support-icon">
                      <Phone />
                    </div>

                    <span>
                      <b>{t.supportTitle}</b>
                      <small>{t.supportText}</small>
                      <strong>{DRIVER_PHONE}</strong>
                    </span>
                  </a>
                </div>
              </motion.div>
            ) : step === 1 ? (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <span className="booking-kicker">{t.route}</span>
                <div className="card-heading">
                  <span>01</span>

                  <div>
                    <h2>{t.whereGoing}</h2>
                    <p>{t.routeDescription}</p>
                  </div>
                </div>

                <div className="route-fields">
                  <PlaceField
                    label={t.pickup}
                    placeholder={t.pickupPlaceholder}
                    value={booking.pickup}
                    language={language}
                    onChange={(place) =>
                      setPlace("pickup", place)
                    }
                  />

                  <div className="route-line" />

                  <PlaceField
                    label={t.destination}
                    placeholder={
                      t.destinationPlaceholder
                    }
                    value={booking.destination}
                    language={language}
                    onChange={(place) =>
                      setPlace("destination", place)
                    }
                  />
                </div>

                <div className="grid2">
                  <div className="field-wrap">
                    <label htmlFor="booking-date">{t.date}</label>

                    <div className="input-icon">
                      <CalendarDays />

                      <input
                        id="booking-date"
                        type="date"
                        min={earliestPickup.date}
                        value={booking.date}
                        onChange={(event) =>
                          updateRouteDependency(
                            "date",
                            event.target.value,
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="field-wrap">
                    <label htmlFor="booking-time">{t.pickupTime}</label>

                    <div className="input-icon">
                      <Clock3 />

                      <input
                        id="booking-time"
                        type="time"
                        min={minTime}
                        value={booking.time}
                        onChange={(event) =>
                          updateRouteDependency(
                            "time",
                            event.target.value,
                          )
                        }
                      />
                    </div>

                    <small className="helper">
                      {t.reservationLimit}
                    </small>
                  </div>
                </div>

                {error && (
                  <div className="error" role="alert">{error}</div>
                )}

                <button
                  className="primary"
                  type="button"
                  onClick={calculate}
                  disabled={routeLoading}
                >
                  {routeLoading ? (
                    <>
                      <LoaderCircle className="spin" />
                      {t.calculating}
                    </>
                  ) : (
                    <>
                      {t.calculatePrice}
                      <ArrowRight />
                    </>
                  )}
                </button>
              </motion.div>
            ) : step === 3 ? (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <button className="back" type="button" onClick={() => { setError(""); setStep(1); }}>
                  <ChevronLeft />{language === "lt" ? "Keisti maršrutą" : "Edit route"}
                </button>

                <div className="card-heading">
                  <span>02</span>
                  <div>
                    <h2>{language === "lt" ? "Pasirinkite automobilį" : "Choose your vehicle"}</h2>
                    <p>{language === "lt" ? "Pasirinkite keleivių ir bagažo kiekį." : "Set passengers and bags, then pick a vehicle."}</p>
                  </div>
                </div>

                <div className="trip-ticket" aria-label={language === "lt" ? "Kelionės maršrutas" : "Trip route"}>
                  <div><small>{t.pickup}</small><strong>{booking.pickup?.label}</strong></div>
                  <span className="route-arrow" aria-hidden="true">→</span>
                  <div><small>{t.destination}</small><strong>{booking.destination?.label}</strong></div>
                  <time dateTime={`${booking.date}T${booking.time}`}>
                    {booking.date}<b>{booking.time} · {booking.distanceKm.toFixed(1)} km</b>
                  </time>
                </div>

                <div className="vehicle-workspace-grid">
                  <div className="vehicle-workspace-main">
                    <DeferredVehicleSelector
                      language={language}
                      passengers={booking.passengers}
                      luggage={booking.luggage}
                      selectedVehicleId={booking.vehicleId}
                      distanceMeters={booking.distanceMeters}
                      onPassengersChange={(count) => updateParty("passengers", count)}
                      onLuggageChange={(count) => updateParty("luggage", count)}
                      onVehicleSelect={selectVehicle}
                      contactHref={`tel:${CONTACT_PHONE_LINK}`}
                    />

                    {quoteLoading && (
                      <div className="quote-status" role="status">
                        <LoaderCircle className="spin" aria-hidden="true" />
                        {language === "lt" ? "Tikrinama kaina..." : "Confirming fare..."}
                      </div>
                    )}
                    {quoteError && <div className="error" role="alert">{quoteError}</div>}
                    {error && <div className="error" role="alert">{error}</div>}

                    <button
                      className="primary"
                      type="button"
                      onClick={() => continueTo(4)}
                      disabled={!booking.vehicleId || !booking.pricing || quoteLoading}
                    >
                      {quoteLoading ? (
                        <><LoaderCircle className="spin" />{language === "lt" ? "Tikrinama..." : "Confirming..."}</>
                      ) : (
                        <>{language === "lt" ? "Tęsti" : "Continue"}<ArrowRight /></>
                      )}
                    </button>
                  </div>

                  <aside className="vehicle-route-panel">
                    <div className="vehicle-route-summary">
                      <DeferredRouteMap
                        encodedPolyline={booking.routePolyline}
                        language={language}
                        ariaLabel={`${booking.pickup?.label ?? ""} – ${booking.destination?.label ?? ""}`}
                      />
                      <div className="vehicle-summary-route">
                        <span>{booking.pickup?.label}</span>
                        <ArrowRight aria-hidden="true" />
                        <span>{booking.destination?.label}</span>
                      </div>
                      <div className="vehicle-summary-meta">
                        <span><Route aria-hidden="true" /><b>{booking.distanceKm.toFixed(1)} km</b></span>
                        <span><Clock3 aria-hidden="true" /><b>~{booking.durationMin} {t.minutes}</b></span>
                      </div>
                      <div className="vehicle-route-total">
                        <span>{booking.vehicleId ? VEHICLES[booking.vehicleId].model : (language === "lt" ? "Pasirinkite automobilį" : "Select a vehicle")}</span>
                        <strong>{booking.pricing ? `${booking.price.toFixed(2)} €` : "—"}</strong>
                      </div>
                    </div>
                  </aside>
                </div>
              </motion.div>
            ) : step === 4 ? (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <button className="back" type="button" onClick={() => { setError(""); setStep(3); }}>
                  <ChevronLeft />{t.back}
                </button>

                <div className="card-heading">
                  <span>03</span>
                  <div>
                    <h2>{language === "lt" ? "Papildomi pageidavimai" : "Additional preferences"}</h2>
                    <p>{language === "lt" ? "Pasirinkite tai, kas padės keliauti patogiau. Visi pageidavimai nemokami." : "Choose what will make your journey more comfortable. All preferences are free."}</p>
                  </div>
                </div>

                <div className="preference-list">
                  <section className={`preference-item ${booking.preferences.spotify.enabled ? "is-enabled" : ""}`}>
                    <div className="preference-row">
                      <span className="preference-index" aria-hidden="true">01</span>
                      <div className="preference-copy">
                        <label htmlFor="pref-spotify">{language === "lt" ? "Mano Spotify muzika" : "Play my Spotify music"}</label>
                        <p id="pref-spotify-description">{language === "lt" ? "Muzikos pageidavimas kelionei." : "Optional music request."}</p>
                      </div>
                      <span className="preference-free">{language === "lt" ? "Nemokamai" : "Free"}</span>
                      <input id="pref-spotify" className="preference-toggle" type="checkbox" role="switch" aria-describedby="pref-spotify-description" checked={booking.preferences.spotify.enabled} onChange={(event) => updatePreference("spotify", { enabled: event.target.checked })} />
                    </div>
                    {booking.preferences.spotify.enabled && (
                      <div className="preference-detail">
                        <label htmlFor="pref-spotify-text">{language === "lt" ? "Atlikėjas, žanras arba grojaraščio nuoroda" : "Artist, genre or playlist link"} <span>{language === "lt" ? "neprivaloma" : "optional"}</span></label>
                        <input id="pref-spotify-text" type="text" maxLength={500} value={booking.preferences.spotify.preference} onChange={(event) => updatePreference("spotify", { preference: event.target.value })} placeholder={language === "lt" ? "Pvz., džiazas arba Spotify nuoroda" : "E.g. jazz or a Spotify link"} />
                      </div>
                    )}
                  </section>

                  <section className={`preference-item ${booking.preferences.preferredLanguage.enabled ? "is-enabled" : ""}`}>
                    <div className="preference-row">
                      <span className="preference-index" aria-hidden="true">02</span>
                      <div className="preference-copy">
                        <label htmlFor="pref-language">{language === "lt" ? "Pageidaujama vairuotojo kalba" : "Preferred driver language"}</label>
                        <p id="pref-language-description">{language === "lt" ? "Pageidaujama vairuotojo kalba." : "Request a preferred driver language."}</p>
                      </div>
                      <span className="preference-free">{language === "lt" ? "Nemokamai" : "Free"}</span>
                      <input id="pref-language" className="preference-toggle" type="checkbox" role="switch" aria-describedby="pref-language-description" checked={booking.preferences.preferredLanguage.enabled} onChange={(event) => updatePreference("preferredLanguage", { enabled: event.target.checked })} />
                    </div>
                    {booking.preferences.preferredLanguage.enabled && (
                      <div className="preference-detail">
                        <label htmlFor="pref-language-code">{language === "lt" ? "Pasirinkite kalbą" : "Choose a language"}</label>
                        <select id="pref-language-code" value={booking.preferences.preferredLanguage.language ?? ""} onChange={(event) => updatePreference("preferredLanguage", { language: event.target.value ? event.target.value as PreferredLanguageCode : null })} required>
                          <option value="">{language === "lt" ? "Pasirinkite" : "Select"}</option>
                          <option value="lt">{languageNames.lt[language]}</option>
                          <option value="en">{languageNames.en[language]}</option>
                          <option value="ru">{languageNames.ru[language]}</option>
                          <option value="pl">{languageNames.pl[language]}</option>
                          <option value="other">{languageNames.other[language]}</option>
                        </select>
                        {booking.preferences.preferredLanguage.language === "other" && (
                          <div className="preference-nested-field">
                            <label htmlFor="pref-language-other">{language === "lt" ? "Kokia kalba?" : "Which language?"}</label>
                            <input id="pref-language-other" type="text" maxLength={100} value={booking.preferences.preferredLanguage.otherLanguage} onChange={(event) => updatePreference("preferredLanguage", { otherLanguage: event.target.value })} required />
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  <section className={`preference-item ${booking.preferences.meetAndGreet.enabled ? "is-enabled" : ""}`}>
                    <div className="preference-row">
                      <span className="preference-index" aria-hidden="true">03</span>
                      <div className="preference-copy">
                        <label htmlFor="pref-meet">{language === "lt" ? "Pasitikimas su lentele" : "Meet me with a sign"}</label>
                        <p id="pref-meet-description">{language === "lt" ? "Pasitikimas oro uoste su lentele." : "Name sign at arrivals."}</p>
                      </div>
                      <span className="preference-free">{language === "lt" ? "Nemokamai" : "Free"}</span>
                      <input id="pref-meet" className="preference-toggle" type="checkbox" role="switch" aria-describedby="pref-meet-description" checked={booking.preferences.meetAndGreet.enabled} onChange={(event) => updatePreference("meetAndGreet", { enabled: event.target.checked })} />
                    </div>
                    {booking.preferences.meetAndGreet.enabled && (
                      <div className="preference-detail">
                        <label htmlFor="pref-meet-text">{language === "lt" ? "Ką rašyti ant lentelės?" : "What should the sign say?"}</label>
                        <input id="pref-meet-text" type="text" maxLength={150} value={booking.preferences.meetAndGreet.signText} onChange={(event) => updatePreference("meetAndGreet", { signText: event.target.value })} placeholder={language === "lt" ? "Vardas, pavardė arba įmonė" : "Name or company"} required />
                      </div>
                    )}
                  </section>

                  <section className={`preference-item ${booking.preferences.driverComment.enabled ? "is-enabled" : ""}`}>
                    <div className="preference-row">
                      <span className="preference-index" aria-hidden="true">04</span>
                      <div className="preference-copy">
                        <label htmlFor="pref-comment">{language === "lt" ? "Komentaras vairuotojui" : "Comment for the driver"}</label>
                        <p id="pref-comment-description">{language === "lt" ? "Trumpa žinutė vairuotojui." : "Anything the driver should know."}</p>
                      </div>
                      <span className="preference-free">{language === "lt" ? "Nemokamai" : "Free"}</span>
                      <input id="pref-comment" className="preference-toggle" type="checkbox" role="switch" aria-describedby="pref-comment-description" checked={booking.preferences.driverComment.enabled} onChange={(event) => updatePreference("driverComment", { enabled: event.target.checked })} />
                    </div>
                    {booking.preferences.driverComment.enabled && (
                      <div className="preference-detail">
                        <label htmlFor="pref-comment-text">{language === "lt" ? "Žinutė vairuotojui" : "Message to the driver"} <span>{language === "lt" ? "neprivaloma" : "optional"}</span></label>
                        <textarea id="pref-comment-text" maxLength={1000} rows={4} value={booking.preferences.driverComment.text} onChange={(event) => updatePreference("driverComment", { text: event.target.value })} placeholder={language === "lt" ? "Pvz., lauksiu prie pagrindinio įėjimo" : "E.g. I will wait by the main entrance"} />
                        <small>{booking.preferences.driverComment.text.length} / 1000</small>
                      </div>
                    )}
                  </section>
                </div>

                <p className="preference-note">{language === "lt" ? "Visi pageidavimai nemokami." : "All extras are free."}</p>

                {error && <div className="error" role="alert">{error}</div>}
                <button className="primary" type="button" onClick={() => continueTo(5)}>
                  {language === "lt" ? "Tęsti" : "Continue"}<ArrowRight />
                </button>
              </motion.div>
            ) : step === 5 ? (
              <motion.div
                key="step-5"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <button className="back" type="button" onClick={() => { setError(""); setStep(4); }}>
                  <ChevronLeft />{t.back}
                </button>

                <div className="card-heading">
                  <span>04</span>
                  <div>
                    <h2>{language === "lt" ? "Kontaktai ir suvestinė" : "Contact and trip summary"}</h2>
                    <p>{t.contactDescription}</p>
                  </div>
                </div>

                <div className="grid2">
                  <div className="field-wrap">
                    <label htmlFor="booking-first-name">{t.firstName}</label>
                    <input id="booking-first-name" value={booking.firstName} onChange={(event) => update("firstName", event.target.value)} placeholder={t.firstNamePlaceholder} autoComplete="given-name" />
                  </div>
                  <div className="field-wrap">
                    <label htmlFor="booking-last-name">{t.lastName}</label>
                    <input id="booking-last-name" value={booking.lastName} onChange={(event) => update("lastName", event.target.value)} placeholder={t.lastNamePlaceholder} autoComplete="family-name" />
                  </div>
                </div>
                <div className="field-wrap">
                  <label htmlFor="booking-phone">{t.phoneNumber}</label>
                  <div className="input-icon">
                    <Phone />
                    <input id="booking-phone" type="tel" value={booking.phone} onChange={(event) => update("phone", event.target.value)} placeholder={t.phonePlaceholder} autoComplete="tel" />
                  </div>
                </div>
                <div className="field-wrap">
                  <label htmlFor="booking-email">{t.emailAddress}</label>
                  <div className="input-icon">
                    <Mail />
                    <input id="booking-email" type="email" maxLength={254} value={booking.email} onChange={(event) => update("email", event.target.value)} placeholder={t.emailPlaceholder} autoComplete="email" required />
                  </div>
                </div>

                <div className="booking-overview">
                  <h3>{language === "lt" ? "Kelionės suvestinė" : "Trip summary"}</h3>
                  <DeferredRouteMap
                    encodedPolyline={booking.routePolyline}
                    language={language}
                    ariaLabel={`${booking.pickup?.label ?? ""} – ${booking.destination?.label ?? ""}`}
                  />
                  <dl>
                    <div><dt>{t.pickup}</dt><dd>{booking.pickup?.label}</dd></div>
                    <div><dt>{t.destination}</dt><dd>{booking.destination?.label}</dd></div>
                    <div><dt>{t.pickupTimeLabel}</dt><dd>{booking.date} · {booking.time} (Europe/Vilnius)</dd></div>
                    <div><dt>{t.distance} / {t.duration}</dt><dd>{booking.distanceKm.toFixed(1)} km · ~{booking.durationMin} {t.minutes}</dd></div>
                    <div><dt>{t.passengers} / {t.luggage}</dt><dd>{booking.passengers} / {booking.luggage}</dd></div>
                    <div><dt>{t.vehicle}</dt><dd>{booking.vehicleId ? VEHICLES[booking.vehicleId].model : "—"}</dd></div>
                    {selectedPreferenceRows.length > 0
                      ? selectedPreferenceRows.map((item) => <div key={item.label}><dt>{item.label}</dt><dd className="preference-summary-value">{item.value}</dd></div>)
                      : <div><dt>{language === "lt" ? "Pageidavimai" : "Preferences"}</dt><dd>{language === "lt" ? "Nėra" : "None"}</dd></div>}
                    <div><dt>{language === "lt" ? "Bazinė kaina" : "Base fare"}</dt><dd>{booking.pricing ? `${(booking.pricing.baseFareCents / 100).toFixed(2)} €` : "—"}</dd></div>
                    <div><dt>{t.finalTripPrice}</dt><dd><strong>{booking.price.toFixed(2)} €</strong></dd></div>
                  </dl>
                </div>

                {error && <div className="error" role="alert">{error}</div>}
                <button className="primary" type="button" onClick={validateContact}>
                  {t.continuePayment}<ArrowRight />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="step-6"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <button
                  className="back"
                  type="button"
                  onClick={() => {
                    setError("");
                    setStep(5);
                  }}
                >
                  <ChevronLeft />
                  {t.back}
                </button>

                <div className="card-heading">
                  <span>05</span>

                  <div>
                    <h2>{t.howPay}</h2>
                    <p>{t.finalPriceCalculated}</p>
                  </div>
                </div>

                <div className="final-price">
                  <span>{t.finalTripPrice}</span>

                  <strong>
                    {booking.price.toFixed(2)} €
                  </strong>

                  {booking.pricing && (
                    <small>
                      {language === "lt" ? "Tarifas" : "Rate"}: {" "}
                      {(booking.pricing.rateCentsPerKm / 100).toFixed(2)} € / km
                      {" · "}
                      {language === "lt" ? "įsėdimas" : "boarding"}: {" "}
                      {(booking.pricing.boardingFeeCents / 100).toFixed(2)} €
                      {booking.pricing.minimumAdjustmentCents > 0 &&
                        (language === "lt" ? " · taikomas 25,00 € minimumas (įsėdimas įskaičiuotas)" : " · €25.00 minimum applies (boarding included)")}
                    </small>
                  )}
                </div>

                {checkoutReturn && checkoutStatus && (
                  <div className={`payment-return payment-return--${checkoutStatus.status}`} role="status" aria-live="polite">
                    <strong>{checkoutStatus.status === "pending"
                      ? checkoutReturn.kind === "cancelled"
                        ? (language === "lt" ? "Mokėjimas nebaigtas" : "Payment not completed")
                        : (language === "lt" ? "Tikriname mokėjimą" : "Checking your payment")
                      : checkoutStatus.status === "error"
                        ? (language === "lt" ? "Būsenos patikrinti nepavyko" : "Unable to check payment status")
                        : (language === "lt" ? "Mokėjimas nepatvirtintas" : "Payment not confirmed")}</strong>
                    <p>{checkoutStatus.status === "pending"
                      ? checkoutReturn.kind === "cancelled"
                        ? (language === "lt" ? "Rezervacija dar nepatvirtinta. Galite grįžti į tą patį mokėjimą arba patikrinti būseną." : "Your booking is not confirmed. You can return to the same payment or check its status.")
                        : (language === "lt" ? "Rezervacija bus patvirtinta tik gavus patikimą „Stripe“ mokėjimo pranešimą. Palaukite kelias akimirkas." : "Your booking will be confirmed only after Stripe verifies the payment. Please wait a moment.")
                      : checkoutStatus.status === "error"
                        ? (language === "lt" ? "Nepriimkite šio puslapio kaip mokėjimo patvirtinimo. Patikrinkite dar kartą arba paskambinkite mums." : "This page is not a payment confirmation. Check again or call us.")
                        : (language === "lt" ? "Rezervacija nepatvirtinta. Galite saugiai bandyti mokėti dar kartą." : "Your booking is not confirmed. You can safely try paying again.")}</p>
                    <button type="button" className="payment-status-check" onClick={() => setStatusRefresh((value) => value + 1)}>
                      {language === "lt" ? "Patikrinti būseną" : "Check status"}
                    </button>
                  </div>
                )}

                {(!checkoutReturn ||
                  (checkoutReturn.kind === "cancelled" && checkoutStatus?.status === "pending") ||
                  checkoutStatus?.status === "failed" ||
                  checkoutStatus?.status === "cancelled") && <>

                {(!checkoutReturn || checkoutStatus?.status === "failed" || checkoutStatus?.status === "cancelled") && <>
                <PaymentChoice
                  value="driver"
                  selected={booking.paymentMethod}
                  onClick={(value) =>
                    update("paymentMethod", value)
                  }
                  icon={<Banknote />}
                  title={t.payDriver}
                  text={t.payDriverText}
                />

                <PaymentChoice
                  value="stripe"
                  selected={booking.paymentMethod}
                  onClick={(value) =>
                    update("paymentMethod", value)
                  }
                  icon={<CreditCard />}
                  title={t.payStripe}
                  text={t.payStripeText}
                  badge={t.recommended}
                />
                </>}

                {paymentPlan && (
                  <div className="payment-breakdown" aria-label={language === "lt" ? "Mokėjimo suvestinė" : "Payment breakdown"}>
                    <div><span>{language === "lt" ? "Bendra kelionės kaina" : "Total trip fare"}</span><strong>{money(paymentPlan.totalCents, language)}</strong></div>
                    <div><span>{language === "lt" ? "Dabar per „Stripe“" : "Pay now through Stripe"}</span><strong>{money(paymentPlan.amountDueNowCents, language)}</strong></div>
                    <div><span>{language === "lt" ? "Likutis automobilyje" : "Balance in the vehicle"}</span><strong>{money(paymentPlan.remainingAfterSuccessfulPaymentCents, language)}</strong></div>
                  </div>
                )}

                {booking.paymentMethod === "driver" && (
                  <p className="payment-advance-explanation">{language === "lt"
                    ? "Siekiant apsaugoti vairuotojus nuo netikrų rezervacijų, prieš patvirtinant užsakymą taikomas 0,50 € išankstinis mokėjimas. Ši suma įskaitoma į kelionės kainą; likusią sumą galėsite sumokėti automobilyje grynaisiais arba kortele. Avansas sumažina netikrų užsakymų riziką, tačiau negarantuoja tapatybės ar atvykimo."
                    : "To help protect drivers from false bookings, a €0.50 advance is required before confirmation. It is credited toward your trip fare; pay the balance in the vehicle by cash or card. The advance reduces false bookings but does not verify identity or guarantee arrival."}</p>
                )}

                <div className="secure-note">
                  <LockKeyhole />
                  {t.securePayment}
                </div>

                {error && (
                  <div className="error" role="alert">{error}</div>
                )}

                <button
                  className="primary"
                  type="button"
                  onClick={retryPayment}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <LoaderCircle className="spin" />
                      {t.processing}
                    </>
                  ) : (
                    <>
                      {t.secureCheckout}
                      <ArrowRight />
                    </>
                  )}
                </button>
                </>}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
        </div>
      </main>

      {step === 1 && !done && (
        <section className="home-support-strip" aria-label={language === "lt" ? "Pagalba ir kontaktai" : "Help and contact"}>
          <div className="home-support-intro">
            <strong>{language === "lt" ? "Reikia pagalbos?" : "Need help?"}</strong>
            <span>{language === "lt" ? "Atsakome greitai." : "We reply quickly."}</span>
          </div>

          <a className="home-support-item" href={`tel:${CONTACT_PHONE_LINK}`}>
            <span className="home-support-icon"><Phone aria-hidden="true" /></span>
            <span className="home-support-copy">
              <small>{language === "lt" ? "Skambinkite" : "Call us"}</small>
              <strong>{CONTACT_PHONE}</strong>
            </span>
          </a>

          <a className="home-support-item" href={`mailto:${CONTACT_EMAIL}`}>
            <span className="home-support-icon"><Mail aria-hidden="true" /></span>
            <span className="home-support-copy">
              <small>{language === "lt" ? "El. paštas" : "Email us"}</small>
              <strong>{CONTACT_EMAIL}</strong>
            </span>
          </a>

          <a className="home-support-item" href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer">
            <span className="home-support-icon"><MessageCircle aria-hidden="true" /></span>
            <span className="home-support-copy">
              <small>WhatsApp</small>
              <strong>{language === "lt" ? "Rašykite mums" : "Chat with us"}</strong>
            </span>
          </a>
        </section>
      )}

      <footer id="contacts" className="site-footer">
        <div className="footer-brand">
          <div className="footer-logo-row">
            <img src="/adv-logo.svg" alt="" />
            <div><b>ADV Services</b><span>{language === "lt" ? "Privatūs oro uosto pervežimai" : "Private airport transfers"}</span></div>
          </div>
        </div>

        <div className="footer-contacts" aria-label={language === "lt" ? "Susisiekite su mumis" : "Contact us"}>
          <a className="footer-contact" href={`tel:${CONTACT_PHONE_LINK}`}>
            <span className="footer-contact-icon"><Phone aria-hidden="true" /></span>
            <span className="footer-contact-copy"><small>{language === "lt" ? "Telefonas" : "Phone"}</small><strong>{CONTACT_PHONE}</strong></span>
          </a>
          <a className="footer-contact" href={`mailto:${CONTACT_EMAIL}`}>
            <span className="footer-contact-icon"><Mail aria-hidden="true" /></span>
            <span className="footer-contact-copy"><small>Email</small><strong>{CONTACT_EMAIL}</strong></span>
          </a>
          <a className="footer-contact" href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer">
            <span className="footer-contact-icon"><MessageCircle aria-hidden="true" /></span>
            <span className="footer-contact-copy"><small>WhatsApp</small><strong>{language === "lt" ? "Rašyti žinutę" : "Message us"}</strong></span>
          </a>
        </div>

        <div className="footer-bottom">
          <span>© 2026 ADV Services. {language === "lt" ? "Visos teisės saugomos." : "All rights reserved."}</span>
          <span>{language === "lt" ? "Stripe internetu · mokėjimas automobilyje" : "Stripe online · pay in car"}</span>
          <div className="footer-legal">
            <a href="#top">{language === "lt" ? "Privatumo politika" : "Privacy Policy"}</a>
            <a href="#top">{language === "lt" ? "Paslaugų teikimo sąlygos" : "Terms of Service"}</a>
          </div>
        </div>
      </footer>
    </div>

  );
}


type PaymentChoiceProps = {
  value: PaymentMethod;
  selected: PaymentMethod;
  onClick: (value: PaymentMethod) => void;
  icon: ReactNode;
  title: string;
  text: string;
  badge?: string;
};

function PaymentChoice({
  value,
  selected,
  onClick,
  icon,
  title,
  text,
  badge,
}: PaymentChoiceProps) {
  return (
    <button
      type="button"
      className={`pay-choice ${
        selected === value ? "selected" : ""
      }`}
      onClick={() => onClick(value)}
    >
      <div className="pay-icon">{icon}</div>

      <span>
        <b>{title}</b>
        <small>{text}</small>
      </span>

      {badge && <em>{badge}</em>}

      <i>{selected === value && <Check />}</i>
    </button>
  );
}

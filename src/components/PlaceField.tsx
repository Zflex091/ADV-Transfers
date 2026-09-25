import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  LoaderCircle,
  MapPin,
  X,
} from "lucide-react";

import type { Place } from "../types";

type Props = {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  language?: "lt" | "en";
};

type PlaceSuggestion = {
  provider: "mapbox";
  providerPlaceId: string;
  label: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

type ApiError = { error?: string };

async function parseJsonResponse<T>(response: Response, message: string): Promise<T> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("json")) {
    throw new Error(message);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(message);
  }
}

const copy = {
  lt: {
    searching: "Ieškoma adresų...",
    loadingPlace: "Tikslinamas adresas...",
    notFound: "Adresų nerasta. Įveskite tikslesnį adresą.",
    searchFailed: "Adresų paieška nepavyko.",
    invalidResponse: "Adresų paieška šiuo metu nepasiekiama. Bandykite vėliau arba paskambinkite.",
    clear: "Išvalyti adresą",
  },
  en: {
    searching: "Searching for addresses...",
    loadingPlace: "Confirming the address...",
    notFound: "No addresses found. Enter a more precise address.",
    searchFailed: "Address search failed.",
    invalidResponse: "Address search is temporarily unavailable. Please try again later or call us.",
    clear: "Clear address",
  },
} as const;

function createSessionToken() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const randomPart = `${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`.slice(0, 20);

  return `${Date.now().toString(36)}_${randomPart}`;
}
function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== "object") {
    return false;
  }

  const place = value as Partial<Place>;

  return (
    place.provider === "mapbox" &&
    typeof place.providerPlaceId === "string" &&
    typeof place.label === "string" &&
    typeof place.placeToken === "string" &&
    place.placeToken.length > 0 &&
    typeof place.latitude === "number" &&
    Number.isFinite(place.latitude) &&
    typeof place.longitude === "number" &&
    Number.isFinite(place.longitude)
  );
}
export default function PlaceField({
  label,
  placeholder,
  value,
  onChange,
  language = "lt",
}: Props) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const sessionTokenRef = useRef(createSessionToken());
  const listboxId = useId();
  const text = copy[language];

  useEffect(() => {
    if (value?.label !== undefined && value.label !== query) {
      setQuery(value.label);
    }
  }, [value?.label]);

  useEffect(() => {
    const searchQuery = query.trim();

    if (value?.label === query || searchQuery.length < 2) {
      abortControllerRef.current?.abort();
      setSuggestions([]);
      setError("");
      setOpen(false);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const sequence = ++requestSequenceRef.current;
    const timeout = window.setTimeout(async () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setLoading(true);
      setError("");
      setOpen(true);

      try {
        const params = new URLSearchParams({
          q: searchQuery,
          sessionToken: sessionTokenRef.current,
          language,
        });
        const response = await fetch(`/api/places?${params}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        const result = (await parseJsonResponse(response, text.invalidResponse)) as
          | PlaceSuggestion[]
          | ApiError;

        if (!response.ok) {
          throw new Error(
            Array.isArray(result)
              ? text.searchFailed
              : result.error || text.searchFailed,
          );
        }

        if (!Array.isArray(result)) {
          throw new Error(text.invalidResponse);
        }

        if (
          controller.signal.aborted ||
          sequence !== requestSequenceRef.current
        ) {
          return;
        }

        const validSuggestions = result.filter(
          (suggestion) =>
            suggestion?.provider === "mapbox" &&
            typeof suggestion.providerPlaceId === "string" &&
            typeof suggestion.label === "string",
        );
        setSuggestions(validSuggestions);
        setActiveIndex(-1);
        setError(validSuggestions.length === 0 ? text.notFound : "");
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        if (sequence === requestSequenceRef.current) {
          setSuggestions([]);
          setError(
            caughtError instanceof TypeError
              ? text.searchFailed
              : caughtError instanceof Error
                ? caughtError.message
                : text.searchFailed,
          );
        }
      } finally {
        if (
          !controller.signal.aborted &&
          sequence === requestSequenceRef.current
        ) {
          setLoading(false);
        }
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [language, query, text, value?.label]);

  function invalidateSelection(newQuery: string) {
    abortControllerRef.current?.abort();
    requestSequenceRef.current += 1;
    setQuery(newQuery);
    setSuggestions([]);
    setError("");
    setActiveIndex(-1);
    setLoading(newQuery.trim().length >= 2);
    setResolving(false);
    setOpen(newQuery.trim().length >= 2);
    onChange(null);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    invalidateSelection(event.target.value);
  }

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    setResolving(true);
    setLoading(false);
    setError("");
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(true);

    try {
      const params = new URLSearchParams({
        placeId: suggestion.providerPlaceId,
        sessionToken: sessionTokenRef.current,
        language,
      });
      const response = await fetch(`/api/place-details?${params}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      const result = (await parseJsonResponse(response, text.invalidResponse)) as Place | ApiError;

      if (!response.ok) {
        throw new Error(
          "error" in result && result.error
            ? result.error
            : text.searchFailed,
        );
      }

      if (!isPlace(result)) {
        throw new Error(text.invalidResponse);
      }

      if (
        controller.signal.aborted ||
        sequence !== requestSequenceRef.current
      ) {
        return;
      }

      setQuery(result.label);
      setOpen(false);
      setError("");
      onChange(result);
      sessionTokenRef.current = createSessionToken();
    } catch (caughtError) {
      if (
        caughtError instanceof DOMException &&
        caughtError.name === "AbortError"
      ) {
        return;
      }

      if (sequence === requestSequenceRef.current) {
        setOpen(true);
        setError(
          caughtError instanceof TypeError
            ? text.searchFailed
            : caughtError instanceof Error
              ? caughtError.message
              : text.searchFailed,
        );
      }
    } finally {
      if (
        !controller.signal.aborted &&
        sequence === requestSequenceRef.current
      ) {
        setResolving(false);
      }
    }
  }

  function clear() {
    invalidateSelection("");
    sessionTokenRef.current = createSessionToken();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!open || suggestions.length === 0 || resolving) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void selectSuggestion(suggestions[activeIndex]);
    }
  }

  const busy = loading || resolving;

  return (
    <div className="field-wrap place-field">
      <label htmlFor={`${listboxId}-input`}>{label}</label>

      <div className="input-icon place-input-shell">
        <MapPin aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          type="text"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim().length >= 2 && !value) {
              setOpen(true);
            }
          }}
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open && suggestions.length > 0}
          aria-activedescendant={
            activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
        />

        <div className="place-input-actions">
          {busy && (
            <LoaderCircle
              className="field-loader spin"
              aria-label={resolving ? text.loadingPlace : text.searching}
            />
          )}
          {query && (
            <button
              className="place-clear"
              type="button"
              onClick={clear}
              aria-label={text.clear}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div
          id={listboxId}
          className="suggestions suggestions-inline"
          role={suggestions.length > 0 ? "listbox" : undefined}
          aria-label={suggestions.length > 0 ? label : undefined}
        >
          {busy && suggestions.length === 0 ? (
            <div className="suggestion-status" role="status">
              <LoaderCircle className="spin" aria-hidden="true" />
              <span>{resolving ? text.loadingPlace : text.searching}</span>
            </div>
          ) : error ? (
            <div className="suggestion-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : (
            suggestions.map((suggestion, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className={
                  activeIndex === index ? "suggestion-active" : ""
                }
                key={suggestion.providerPlaceId}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void selectSuggestion(suggestion)}
              >
                <MapPin aria-hidden="true" />
                <span>
                  <strong>{suggestion.mainText || suggestion.label}</strong>
                  {suggestion.secondaryText && (
                    <small>{suggestion.secondaryText}</small>
                  )}
                </span>
              </button>
            ))
          )}
          {suggestions.length > 0 && (
            <div className="google-maps-attribution">
              <a
                href="https://www.mapbox.com/about/maps/"
                target="_blank"
                rel="noreferrer"
                aria-label="Map data by Mapbox"
              >
                © Mapbox
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

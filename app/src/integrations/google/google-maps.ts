import type { GoogleMapsConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";

export interface GoogleMapsStatus {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  message: string;
  defaultRegionCode: string;
  defaultLanguageCode: string;
}

export interface GooglePlaceLookupResult {
  source: "places" | "geocoding";
  query: string;
  name?: string;
  formattedAddress: string;
  shortFormattedAddress?: string;
  mapsUrl?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  types: string[];
}

export interface GooglePlaceSearchResult {
  query: string;
  results: GooglePlaceLookupResult[];
}

export interface GoogleMoneyAmount {
  currencyCode: string;
  amount: number;
}

export interface GoogleRouteLookupResult {
  originQuery: string;
  destinationQuery: string;
  origin: GooglePlaceLookupResult;
  destination: GooglePlaceLookupResult;
  distanceMeters: number;
  durationSeconds: number;
  staticDurationSeconds?: number;
  hasTolls: boolean;
  tolls?: GoogleMoneyAmount[];
  tollPriceKnown: boolean;
  localizedDistanceText?: string;
  localizedDurationText?: string;
  mapsUrl: string;
  warnings: string[];
}

interface PlacesTextSearchResponse {
  places?: Array<{
    id?: string;
    formattedAddress?: string;
    shortFormattedAddress?: string;
    googleMapsUri?: string;
    types?: string[];
    displayName?: { text?: string };
    location?: { latitude?: number; longitude?: number };
  }>;
}

interface GoogleGeocodingResponse {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    place_id?: string;
    types?: string[];
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
}

interface GoogleRoutesComputeResponse {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    staticDuration?: string;
    warnings?: string[];
    localizedValues?: {
      distance?: { text?: string };
      duration?: { text?: string };
    };
    travelAdvisory?: {
      tollInfo?: {
        estimatedPrice?: Array<{
          currencyCode?: string;
          units?: string;
          nanos?: number;
        }>;
      };
    };
    legs?: Array<{
      travelAdvisory?: {
        tollInfo?: {
          estimatedPrice?: Array<{
            currencyCode?: string;
            units?: string;
            nanos?: number;
          }>;
        };
      };
    }>;
  }>;
  error?: { message?: string };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildFallbackMapsUrl(input: {
  placeId?: string;
  latitude?: number;
  longitude?: number;
  formattedAddress: string;
}): string {
  if (input.placeId) {
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", input.formattedAddress);
    url.searchParams.set("query_place_id", input.placeId);
    return url.toString();
  }

  if (typeof input.latitude === "number" && typeof input.longitude === "number") {
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", `${input.latitude},${input.longitude}`);
    return url.toString();
  }

  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", input.formattedAddress);
  return url.toString();
}

function looksLikePostalAddress(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  return /\b(?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\b/i.test(text)
    && /\b\d+\b/.test(text);
}

function buildDirectionsMapsUrl(input: {
  origin: string;
  destination: string;
}): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", input.origin);
  url.searchParams.set("destination", input.destination);
  return url.toString();
}

function parseDurationSeconds(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = value.trim().replace(/s$/i, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMoneyAmount(input: {
  currencyCode?: string;
  units?: string;
  nanos?: number;
}): GoogleMoneyAmount | null {
  const currencyCode = input.currencyCode?.trim();
  if (!currencyCode) {
    return null;
  }
  const units = input.units ? Number.parseInt(input.units, 10) : 0;
  const nanos = typeof input.nanos === "number" ? input.nanos : 0;
  const amount = units + nanos / 1_000_000_000;
  if (!Number.isFinite(amount)) {
    return null;
  }
  return {
    currencyCode,
    amount,
  };
}

function dedupeMoneyAmounts(values: GoogleMoneyAmount[]): GoogleMoneyAmount[] {
  const seen = new Set<string>();
  const deduped: GoogleMoneyAmount[] = [];
  for (const item of values) {
    const key = `${item.currencyCode}:${item.amount.toFixed(2)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export class GoogleMapsService {
  constructor(
    private readonly config: GoogleMapsConfig,
    private readonly logger: Logger,
  ) {}

  getStatus(): GoogleMapsStatus {
    if (!this.config.enabled) {
      return {
        enabled: false,
        configured: false,
        ready: false,
        message: "Google Maps integration is disabled.",
        defaultRegionCode: this.config.defaultRegionCode,
        defaultLanguageCode: this.config.defaultLanguageCode,
      };
    }

    if (!this.config.apiKey?.trim()) {
      return {
        enabled: true,
        configured: false,
        ready: false,
        message: "Google Maps integration is enabled but missing GOOGLE_MAPS_API_KEY.",
        defaultRegionCode: this.config.defaultRegionCode,
        defaultLanguageCode: this.config.defaultLanguageCode,
      };
    }

    return {
      enabled: true,
      configured: true,
      ready: true,
      message: "Google Maps integration ready.",
      defaultRegionCode: this.config.defaultRegionCode,
      defaultLanguageCode: this.config.defaultLanguageCode,
    };
  }

  async lookupPlace(
    query: string,
    input?: {
      regionCode?: string;
      languageCode?: string;
    },
  ): Promise<GooglePlaceLookupResult | null> {
    const normalizedQuery = normalizeWhitespace(query);
    if (!normalizedQuery) {
      return null;
    }
    this.assertReady();

    const regionCode = (input?.regionCode?.trim() || this.config.defaultRegionCode).toUpperCase();
    const languageCode = input?.languageCode?.trim() || this.config.defaultLanguageCode;
    const strategies = looksLikePostalAddress(normalizedQuery)
      ? [() => this.geocode(normalizedQuery, languageCode, regionCode), () => this.searchText(normalizedQuery, languageCode, regionCode)]
      : [() => this.searchText(normalizedQuery, languageCode, regionCode), () => this.geocode(normalizedQuery, languageCode, regionCode)];

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result) {
          return result;
        }
      } catch (error) {
        this.logger.warn("Google Maps lookup strategy failed", {
          query: normalizedQuery,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  async searchPlaces(
    query: string,
    input?: {
      regionCode?: string;
      languageCode?: string;
      maxResults?: number;
    },
  ): Promise<GooglePlaceSearchResult> {
    const normalizedQuery = normalizeWhitespace(query);
    if (!normalizedQuery) {
      return {
        query,
        results: [],
      };
    }
    this.assertReady();

    const regionCode = (input?.regionCode?.trim() || this.config.defaultRegionCode).toUpperCase();
    const languageCode = input?.languageCode?.trim() || this.config.defaultLanguageCode;
    const maxResults = Math.min(Math.max(input?.maxResults ?? 5, 1), 8);
    const results = await this.searchTextResults(normalizedQuery, languageCode, regionCode, maxResults);
    return {
      query: normalizedQuery,
      results,
    };
  }

  async computeRoute(input: {
    origin: string;
    destination: string;
    includeTolls?: boolean;
    languageCode?: string;
    regionCode?: string;
    departureTime?: string;
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    avoidFerries?: boolean;
  }): Promise<GoogleRouteLookupResult | null> {
    const originQuery = normalizeWhitespace(input.origin);
    const destinationQuery = normalizeWhitespace(input.destination);
    if (!originQuery || !destinationQuery) {
      return null;
    }

    this.assertReady();

    const regionCode = (input.regionCode?.trim() || this.config.defaultRegionCode).toUpperCase();
    const languageCode = input.languageCode?.trim() || this.config.defaultLanguageCode;

    const [originPlace, destinationPlace] = await Promise.all([
      this.lookupPlace(originQuery, {
        regionCode,
        languageCode,
      }),
      this.lookupPlace(destinationQuery, {
        regionCode,
        languageCode,
      }),
    ]);

    if (!originPlace || !destinationPlace) {
      return null;
    }

    if (
      typeof originPlace.latitude !== "number"
      || typeof originPlace.longitude !== "number"
      || typeof destinationPlace.latitude !== "number"
      || typeof destinationPlace.longitude !== "number"
    ) {
      return null;
    }

    const fieldMask = [
      "routes.distanceMeters",
      "routes.duration",
      "routes.staticDuration",
      "routes.localizedValues.distance",
      "routes.localizedValues.duration",
      "routes.warnings",
    ];
    if (input.includeTolls) {
      fieldMask.push(
        "routes.travelAdvisory.tollInfo",
        "routes.legs.travelAdvisory.tollInfo",
      );
    }

    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.config.apiKey as string,
        "X-Goog-FieldMask": fieldMask.join(","),
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: originPlace.latitude,
              longitude: originPlace.longitude,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destinationPlace.latitude,
              longitude: destinationPlace.longitude,
            },
          },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
        routeModifiers: {
          avoidTolls: input.avoidTolls === true,
          avoidHighways: input.avoidHighways === true,
          avoidFerries: input.avoidFerries === true,
        },
        ...(input.includeTolls ? { extraComputations: ["TOLLS"] } : {}),
        ...(input.departureTime?.trim() ? { departureTime: input.departureTime.trim() } : {}),
        languageCode,
        units: "METRIC",
      }),
    });

    const payload = await response.json() as GoogleRoutesComputeResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message || `Routes compute failed with status ${response.status}`);
    }

    const route = payload.routes?.[0];
    if (!route?.distanceMeters || !route.duration) {
      return null;
    }

    const routeTolls = (route.travelAdvisory?.tollInfo?.estimatedPrice ?? [])
      .map((item) => parseMoneyAmount(item))
      .filter((item): item is GoogleMoneyAmount => Boolean(item));
    const legTolls = (route.legs ?? [])
      .flatMap((leg) => leg.travelAdvisory?.tollInfo?.estimatedPrice ?? [])
      .map((item) => parseMoneyAmount(item))
      .filter((item): item is GoogleMoneyAmount => Boolean(item));
    const tolls = dedupeMoneyAmounts(routeTolls.length > 0 ? routeTolls : legTolls);
    const hasTolls = Boolean(route.travelAdvisory?.tollInfo || (route.legs ?? []).some((leg) => Boolean(leg.travelAdvisory?.tollInfo)));

    return {
      originQuery,
      destinationQuery,
      origin: originPlace,
      destination: destinationPlace,
      distanceMeters: route.distanceMeters,
      durationSeconds: parseDurationSeconds(route.duration) ?? Math.round(route.distanceMeters / 15),
      ...(parseDurationSeconds(route.staticDuration) ? { staticDurationSeconds: parseDurationSeconds(route.staticDuration) } : {}),
      hasTolls,
      ...(tolls.length > 0 ? { tolls } : {}),
      tollPriceKnown: tolls.length > 0,
      ...(route.localizedValues?.distance?.text?.trim() ? { localizedDistanceText: route.localizedValues.distance.text.trim() } : {}),
      ...(route.localizedValues?.duration?.text?.trim() ? { localizedDurationText: route.localizedValues.duration.text.trim() } : {}),
      mapsUrl: buildDirectionsMapsUrl({
        origin: originPlace.formattedAddress,
        destination: destinationPlace.formattedAddress,
      }),
      warnings: route.warnings ?? [],
    };
  }

  private async searchText(
    query: string,
    languageCode: string,
    regionCode: string,
  ): Promise<GooglePlaceLookupResult | null> {
    const results = await this.searchTextResults(query, languageCode, regionCode, 5);
    return results[0] ?? null;
  }

  private async searchTextResults(
    query: string,
    languageCode: string,
    regionCode: string,
    maxResults: number,
  ): Promise<GooglePlaceLookupResult[]> {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.config.apiKey as string,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.googleMapsUri,places.location,places.types",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode,
        regionCode,
        maxResultCount: maxResults,
      }),
    });

    const payload = (await response.json()) as PlacesTextSearchResponse & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(payload.error?.message || `Places search failed with status ${response.status}`);
    }

    return (payload.places ?? [])
      .filter((place) => Boolean(place.formattedAddress))
      .map((place) => {
        const latitude = place.location?.latitude;
        const longitude = place.location?.longitude;
        const placeId = place.id?.trim() || undefined;
        const formattedAddress = place.formattedAddress?.trim() || "";
        return {
          source: "places" as const,
          query,
          name: place.displayName?.text?.trim() || undefined,
          formattedAddress,
          shortFormattedAddress: place.shortFormattedAddress?.trim() || undefined,
          mapsUrl:
            place.googleMapsUri?.trim() ||
            buildFallbackMapsUrl({
              placeId,
              latitude,
              longitude,
              formattedAddress,
            }),
          placeId,
          latitude: typeof latitude === "number" ? latitude : undefined,
          longitude: typeof longitude === "number" ? longitude : undefined,
          types: place.types ?? [],
        };
      });
  }

  private async geocode(
    query: string,
    languageCode: string,
    regionCode: string,
  ): Promise<GooglePlaceLookupResult | null> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("key", this.config.apiKey as string);
    url.searchParams.set("language", languageCode);
    url.searchParams.set("region", regionCode.toLowerCase());

    const response = await fetch(url);
    const payload = (await response.json()) as GoogleGeocodingResponse;
    if (!response.ok) {
      throw new Error(payload.error_message || `Geocoding request failed with status ${response.status}`);
    }
    if (payload.status !== "OK") {
      if (payload.status === "ZERO_RESULTS") {
        return null;
      }
      throw new Error(payload.error_message || `Geocoding request failed with status ${payload.status}`);
    }

    const result = payload.results?.[0];
    if (!result?.formatted_address) {
      return null;
    }

    const latitude = result.geometry?.location?.lat;
    const longitude = result.geometry?.location?.lng;
    const placeId = result.place_id?.trim() || undefined;
    return {
      source: "geocoding",
      query,
      formattedAddress: result.formatted_address.trim(),
      mapsUrl: buildFallbackMapsUrl({
        placeId,
        latitude,
        longitude,
        formattedAddress: result.formatted_address.trim(),
      }),
      placeId,
      latitude: typeof latitude === "number" ? latitude : undefined,
      longitude: typeof longitude === "number" ? longitude : undefined,
      types: result.types ?? [],
    };
  }

  private assertReady(): void {
    const status = this.getStatus();
    if (!status.ready) {
      throw new Error(status.message);
    }
  }
}

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

  private async searchText(
    query: string,
    languageCode: string,
    regionCode: string,
  ): Promise<GooglePlaceLookupResult | null> {
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
        maxResultCount: 5,
      }),
    });

    const payload = (await response.json()) as PlacesTextSearchResponse & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(payload.error?.message || `Places search failed with status ${response.status}`);
    }

    const place = payload.places?.[0];
    if (!place?.formattedAddress) {
      return null;
    }

    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    const placeId = place.id?.trim() || undefined;
    return {
      source: "places",
      query,
      name: place.displayName?.text?.trim() || undefined,
      formattedAddress: place.formattedAddress.trim(),
      shortFormattedAddress: place.shortFormattedAddress?.trim() || undefined,
      mapsUrl:
        place.googleMapsUri?.trim() ||
        buildFallbackMapsUrl({
          placeId,
          latitude,
          longitude,
          formattedAddress: place.formattedAddress.trim(),
        }),
      placeId,
      latitude: typeof latitude === "number" ? latitude : undefined,
      longitude: typeof longitude === "number" ? longitude : undefined,
      types: place.types ?? [],
    };
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

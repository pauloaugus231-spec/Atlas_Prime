import type { Logger } from "../types/logger.js";

interface OpenMeteoGeocodingResponse {
  results?: Array<{
    id?: number;
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    admin2?: string;
    timezone?: string;
    population?: number;
  }>;
}

interface OpenMeteoForecastResponse {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
  };
}

export interface WeatherForecastDay {
  date: string;
  weatherCode?: number;
  description: string;
  minTempC?: number;
  maxTempC?: number;
  precipitationProbabilityMax?: number;
  precipitationSumMm?: number;
}

export interface WeatherForecastResult {
  locationLabel: string;
  timezone: string;
  current?: {
    time?: string;
    temperatureC?: number;
    apparentTemperatureC?: number;
    humidityPercent?: number;
    precipitationMm?: number;
    weatherCode?: number;
    description: string;
    windSpeedKmh?: number;
  };
  daily: WeatherForecastDay[];
  source: {
    provider: string;
    geocodingUrl: string;
    forecastUrl: string;
  };
}

function normalizeWeatherQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function weatherCodeToDescription(code?: number): string {
  const map: Record<number, string> = {
    0: "céu limpo",
    1: "predominantemente limpo",
    2: "parcialmente nublado",
    3: "encoberto",
    45: "nevoeiro",
    48: "nevoeiro com geada",
    51: "garoa fraca",
    53: "garoa moderada",
    55: "garoa intensa",
    56: "garoa congelante fraca",
    57: "garoa congelante intensa",
    61: "chuva fraca",
    63: "chuva moderada",
    65: "chuva forte",
    66: "chuva congelante fraca",
    67: "chuva congelante forte",
    71: "neve fraca",
    73: "neve moderada",
    75: "neve forte",
    77: "grãos de neve",
    80: "pancadas de chuva fracas",
    81: "pancadas de chuva moderadas",
    82: "pancadas de chuva fortes",
    85: "pancadas de neve fracas",
    86: "pancadas de neve fortes",
    95: "trovoada",
    96: "trovoada com granizo fraco",
    99: "trovoada com granizo forte",
  };

  return map[code ?? -1] ?? "condição não identificada";
}

export class WeatherService {
  constructor(private readonly logger: Logger) {}

  async getForecast(input: { location: string; days?: number; timezone?: string }): Promise<WeatherForecastResult | null> {
    const location = input.location.trim();
    if (!location) {
      return null;
    }

    const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodingUrl.searchParams.set("name", location);
    geocodingUrl.searchParams.set("count", "5");
    geocodingUrl.searchParams.set("language", "pt");
    geocodingUrl.searchParams.set("format", "json");

    const geocodingResponse = await fetch(geocodingUrl, {
      headers: {
        "User-Agent": "AgenteAI-Local/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!geocodingResponse.ok) {
      throw new Error(`Weather geocoding failed with status ${geocodingResponse.status}`);
    }

    const geocodingData = (await geocodingResponse.json()) as OpenMeteoGeocodingResponse;
    const candidate = this.pickBestLocation(location, geocodingData.results ?? []);
    if (!candidate) {
      return null;
    }

    const timezone = input.timezone?.trim() || candidate.timezone || "America/Sao_Paulo";
    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.searchParams.set("latitude", String(candidate.latitude));
    forecastUrl.searchParams.set("longitude", String(candidate.longitude));
    forecastUrl.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    );
    forecastUrl.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    );
    forecastUrl.searchParams.set("forecast_days", String(Math.min(Math.max(input.days ?? 3, 1), 7)));
    forecastUrl.searchParams.set("timezone", timezone);

    const forecastResponse = await fetch(forecastUrl, {
      headers: {
        "User-Agent": "AgenteAI-Local/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!forecastResponse.ok) {
      throw new Error(`Weather forecast failed with status ${forecastResponse.status}`);
    }

    const forecastData = (await forecastResponse.json()) as OpenMeteoForecastResponse;
    const locationLabel = [candidate.name, candidate.admin1, candidate.country].filter(Boolean).join(", ");

    return {
      locationLabel,
      timezone: forecastData.timezone || timezone,
      current: forecastData.current
        ? {
            time: forecastData.current.time,
            temperatureC: forecastData.current.temperature_2m,
            apparentTemperatureC: forecastData.current.apparent_temperature,
            humidityPercent: forecastData.current.relative_humidity_2m,
            precipitationMm: forecastData.current.precipitation,
            weatherCode: forecastData.current.weather_code,
            description: weatherCodeToDescription(forecastData.current.weather_code),
            windSpeedKmh: forecastData.current.wind_speed_10m,
          }
        : undefined,
      daily: this.buildDailyForecast(forecastData.daily),
      source: {
        provider: "Open-Meteo",
        geocodingUrl: geocodingUrl.toString(),
        forecastUrl: forecastUrl.toString(),
      },
    };
  }

  private pickBestLocation(
    query: string,
    results: NonNullable<OpenMeteoGeocodingResponse["results"]>,
  ): NonNullable<OpenMeteoGeocodingResponse["results"]>[number] | undefined {
    if (!results.length) {
      return undefined;
    }

    const normalizedQuery = normalizeWeatherQuery(query);
    const wantsBrazil = /\b(brasil|brazil|rs|sp|rj|mg|pr|sc|ba|go|ce|pe|pa)\b/.test(normalizedQuery);

    const scored = results.map((item) => {
      const haystack = normalizeWeatherQuery(
        [item.name, item.admin1, item.admin2, item.country, item.country_code].filter(Boolean).join(" "),
      );
      let score = 0;
      if (haystack.includes(normalizedQuery)) {
        score += 50;
      }
      for (const term of normalizedQuery.split(" ")) {
        if (term.length < 2) continue;
        if (haystack.includes(term)) {
          score += 10;
        }
      }
      if (wantsBrazil && item.country_code === "BR") {
        score += 20;
      }
      if (typeof item.population === "number") {
        score += Math.min(item.population / 100000, 20);
      }
      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.item;
  }

  private buildDailyForecast(daily?: OpenMeteoForecastResponse["daily"]): WeatherForecastDay[] {
    if (!daily?.time?.length) {
      return [];
    }

    return daily.time.map((date, index) => ({
      date,
      weatherCode: daily.weather_code?.[index],
      description: weatherCodeToDescription(daily.weather_code?.[index]),
      minTempC: daily.temperature_2m_min?.[index],
      maxTempC: daily.temperature_2m_max?.[index],
      precipitationProbabilityMax: daily.precipitation_probability_max?.[index],
      precipitationSumMm: daily.precipitation_sum?.[index],
    }));
  }
}

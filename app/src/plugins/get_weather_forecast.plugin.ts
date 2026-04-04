import { WeatherService } from "../core/weather-service.js";
import { defineToolPlugin } from "../types/plugin.js";

interface GetWeatherForecastParameters {
  location: string;
  days?: number;
  timezone?: string;
}

export default defineToolPlugin<GetWeatherForecastParameters>({
  name: "get_weather_forecast",
  description: "Gets a weather forecast for a city or location using Open-Meteo.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City or location name, for example Porto Alegre or São Paulo.",
      },
      days: {
        type: "integer",
        minimum: 1,
        maximum: 7,
        description: "Number of forecast days to return.",
      },
      timezone: {
        type: "string",
        description: "IANA timezone, for example America/Sao_Paulo.",
      },
    },
    required: ["location"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const service = new WeatherService(context.logger.child({ scope: "weather" }));
    const forecast = await service.getForecast({
      location: parameters.location,
      days: parameters.days,
      timezone: parameters.timezone,
    });

    if (!forecast) {
      return {
        ok: false,
        status: {
          message: `No weather forecast results were found for ${parameters.location}.`,
        },
      };
    }

    return {
      ok: true,
      forecast,
    };
  },
});

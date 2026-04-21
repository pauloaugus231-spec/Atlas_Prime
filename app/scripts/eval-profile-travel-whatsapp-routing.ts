import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import { buildTravelPlanningGoalFromPrompt } from "../src/core/active-goal-state.js";
import {
  extractWhatsAppSearchQuery,
  isWhatsAppRecentSearchPrompt,
} from "../src/core/messaging-direct-helpers.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

function run(): void {
  const results: EvalResult[] = [];

  const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-profile-routing-"));
  try {
    const store = new PersonalOperationalMemoryStore(
      path.join(tempDir, "personal.sqlite"),
      makeLogger(),
    );
    const profile = store.updateProfile({
      homeAddress: "Av. Teste, 123, Porto Alegre - RS",
      homeLocationLabel: "casa",
      defaultVehicle: {
        name: "JAC T40",
        consumptionKmPerLiter: 13,
        fuelType: "gasolina",
      },
      defaultFuelPricePerLiter: 6.7,
    });

    results.push(assert(
      "profile_persists_home_vehicle_and_fuel_defaults",
      profile.homeAddress === "Av. Teste, 123, Porto Alegre - RS"
        && profile.defaultVehicle?.name === "JAC T40"
        && profile.defaultVehicle.consumptionKmPerLiter === 13
        && profile.defaultFuelPricePerLiter === 6.7,
      JSON.stringify(profile, null, 2),
    ));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const travelGoal = buildTravelPlanningGoalFromPrompt("quanto vou gastar para ir para Torres saindo de casa?");
  results.push(assert(
    "travel_prompt_understands_destination_and_home_origin_alias",
    travelGoal?.origin === "casa" && travelGoal.destination === "Torres",
    JSON.stringify(travelGoal, null, 2),
  ));

  const whatsappPrompt = "verificar WhatsApp institucional";
  results.push(assert(
    "whatsapp_institutional_prompt_routes_to_recent_search",
    isWhatsAppRecentSearchPrompt(whatsappPrompt)
      && extractWhatsAppSearchQuery(whatsappPrompt, whatsappPrompt) === "abordagem",
    JSON.stringify({
      isRecentSearch: isWhatsAppRecentSearchPrompt(whatsappPrompt),
      query: extractWhatsAppSearchQuery(whatsappPrompt, whatsappPrompt),
    }, null, 2),
  ));

  const failures = results.filter((item) => !item.passed);
  for (const result of results.filter((item) => item.passed)) {
    console.log(`PASS ${result.name}`);
  }
  for (const failure of failures) {
    console.error(`FAIL ${failure.name}`);
    if (failure.detail) {
      console.error(failure.detail);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("PASS eval-profile-travel-whatsapp-routing");
}

run();

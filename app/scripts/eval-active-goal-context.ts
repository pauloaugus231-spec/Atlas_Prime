import {
  buildPlaceDiscoveryGoalFromPrompt,
  buildPlaceDiscoveryPrompt,
  buildTravelPlanningGoalFromPrompt,
  buildTravelPlanningPrompt,
  describePlaceDiscoveryGoal,
  describeTravelPlanningGoal,
  isTravelGoalCancellationPrompt,
  mergePlaceDiscoveryGoal,
  mergeTravelPlanningGoal,
} from "../src/core/active-goal-state.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function assert(name: string, condition: boolean, detail?: string): EvalResult {
  return {
    name,
    passed: condition,
    detail,
  };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];

  const seeded = buildTravelPlanningGoalFromPrompt("quanto vou gastar de Porto Alegre até Torres com meu JAC T40?");
  results.push(assert(
    "travel_goal_seeded_from_initial_prompt",
    seeded?.objective === "travel_cost_estimate"
      && seeded.origin === "Porto Alegre"
      && seeded.destination === "Torres"
      && seeded.vehicle === "JAC T40",
    JSON.stringify(seeded, null, 2),
  ));

  const emptySeed = buildTravelPlanningGoalFromPrompt("oi atlas");
  results.push(assert(
    "non_travel_prompt_does_not_seed_goal",
    emptySeed === null,
    JSON.stringify(emptySeed, null, 2),
  ));

  const seededWithoutRoute = buildTravelPlanningGoalFromPrompt("quanto vou gastar com meu carro?")!;
  const mergedRoute = mergeTravelPlanningGoal(seededWithoutRoute, "Porto Alegre e Torres");
  results.push(assert(
    "bare_pair_reply_fills_origin_and_destination",
    mergedRoute.goal.origin === "Porto Alegre"
      && mergedRoute.goal.destination === "Torres"
      && mergedRoute.hasMeaningfulUpdate,
    JSON.stringify(mergedRoute, null, 2),
  ));

  const mergedFuel = mergeTravelPlanningGoal(mergedRoute.goal, "13 km/l e gasolina 6,70");
  results.push(assert(
    "fuel_and_consumption_reply_fills_missing_slots",
    mergedFuel.goal.consumptionKmPerLiter === 13
      && mergedFuel.goal.fuelPricePerLiter === 6.7
      && mergedFuel.changedKeys.includes("consumptionKmPerLiter")
      && mergedFuel.changedKeys.includes("fuelPricePerLiter"),
    JSON.stringify(mergedFuel, null, 2),
  ));

  const mergedRoundTrip = mergeTravelPlanningGoal(mergedFuel.goal, "ida e volta");
  results.push(assert(
    "round_trip_reply_sets_flag",
    mergedRoundTrip.goal.roundTrip === true
      && mergedRoundTrip.changedKeys.includes("roundTrip"),
    JSON.stringify(mergedRoundTrip, null, 2),
  ));

  const canonicalPrompt = buildTravelPlanningPrompt(mergedRoundTrip.goal);
  results.push(assert(
    "canonical_prompt_rebuilds_goal_for_planner",
    canonicalPrompt.includes("Porto Alegre")
      && canonicalPrompt.includes("Torres")
      && canonicalPrompt.includes("ida e volta")
      && canonicalPrompt.includes("13 km/l")
      && canonicalPrompt.includes("gasolina 6,7"),
    canonicalPrompt,
  ));

  const summary = describeTravelPlanningGoal(mergedRoundTrip.goal);
  results.push(assert(
    "goal_summary_mentions_known_context",
    summary.some((item) => item.includes("Porto Alegre"))
      && summary.some((item) => item.includes("13 km/l"))
      && summary.some((item) => item.includes("ida e volta")),
    JSON.stringify(summary, null, 2),
  ));

  results.push(assert(
    "travel_goal_cancellation_is_detected",
    isTravelGoalCancellationPrompt("deixa isso") && isTravelGoalCancellationPrompt("ignora"),
  ));

  const placeSeed = buildPlaceDiscoveryGoalFromPrompt("me mostra restaurantes perto de mim");
  results.push(assert(
    "place_discovery_goal_is_seeded_without_location",
    placeSeed?.kind === "place_discovery"
      && placeSeed.category === "restaurant"
      && placeSeed.locationQuery === undefined,
    JSON.stringify(placeSeed, null, 2),
  ));

  const mergedPlaceLocation = mergePlaceDiscoveryGoal(placeSeed!, "na Restinga");
  results.push(assert(
    "place_discovery_follow_up_fills_location",
    mergedPlaceLocation.goal.locationQuery === "Restinga"
      && mergedPlaceLocation.changedKeys.includes("locationQuery"),
    JSON.stringify(mergedPlaceLocation, null, 2),
  ));

  const placePrompt = buildPlaceDiscoveryPrompt(mergedPlaceLocation.goal);
  results.push(assert(
    "place_discovery_canonical_prompt_rebuilds_search",
    placePrompt.includes("restaurantes")
      && placePrompt.includes("Restinga"),
    placePrompt,
  ));

  const placeSummary = describePlaceDiscoveryGoal(mergedPlaceLocation.goal);
  results.push(assert(
    "place_discovery_summary_mentions_category_and_location",
    placeSummary.some((item) => item.includes("restaurantes"))
      && placeSummary.some((item) => item.includes("Restinga")),
    JSON.stringify(placeSummary, null, 2),
  ));

  const failed = results.filter((item) => !item.passed);
  if (failed.length > 0) {
    for (const item of failed) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
    }
    process.exit(1);
  }

  console.log(`\nActive goal evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

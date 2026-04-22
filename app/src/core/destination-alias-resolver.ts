import type { DeliveryDestination } from "../types/delivery-destination.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export class DestinationAliasResolver {
  resolve(query: string, destinations: DeliveryDestination[]): DeliveryDestination | undefined {
    const normalized = normalize(query);
    return destinations.find((item) => {
      const candidates = [item.label, ...item.aliases].map((entry) => normalize(entry));
      return candidates.some((entry) => entry === normalized || normalized.includes(entry) || entry.includes(normalized));
    });
  }
}

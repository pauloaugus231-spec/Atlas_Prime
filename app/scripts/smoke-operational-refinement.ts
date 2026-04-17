import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentCore } from "../src/core/create-agent-core.ts";
import type { PersonalOperationalProfile } from "../src/types/personal-operational-memory.ts";
import type { UserPreferences } from "../src/types/user-preferences.ts";

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function buildIso(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00-03:00`;
}

function toDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function summarize(text: string, max = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const account = readFlagValue(args, "--account")?.trim() || "primary";
  const {
    core,
    personalMemory,
    preferences,
  } = await createAgentCore();

  const originalProfile: PersonalOperationalProfile = structuredClone(personalMemory.getProfile());
  const originalPreferences: UserPreferences = structuredClone(preferences.get());
  const testDate = "2026-04-19";
  const dateLabel = toDateLabel(testDate);
  const shortDateLabel = dateLabel.slice(0, 5);
  const createdEvents: Array<{ id: string; account?: string }> = [];
  const transcript: Array<{ step: number; prompt: string; reply: string }> = [];
  const testSummaryA = "Reunião teste refino A Paulo";
  const testSummaryB = "Reunião teste refino B Paulo";
  const accountQualifier = account === "primary" ? "" : ` na ${account}`;
  const accountSuffix = account === "primary" ? "" : ` | conta: ${account}`;

  try {
    const eventA = await core.executeToolDirect("create_calendar_event", {
      summary: testSummaryA,
      start: buildIso(testDate, 15),
      end: buildIso(testDate, 16),
      account,
      reminder_minutes: 30,
    });
    const rawEventA = eventA.rawResult as { ok?: boolean; error?: string; event?: { id?: string } };
    if (rawEventA.ok === false) {
      console.log(JSON.stringify({
        ok: false,
        blocked: "calendar_write_unavailable",
        detail: rawEventA.error ?? "Falha ao criar evento temporário para smoke.",
      }, null, 2));
      return;
    }
    const createdA = rawEventA.event?.id;
    if (createdA) {
      createdEvents.push({ id: createdA, account });
    }

    const eventB = await core.executeToolDirect("create_calendar_event", {
      summary: testSummaryB,
      start: buildIso(testDate, 17),
      end: buildIso(testDate, 18),
      account,
      reminder_minutes: 30,
    });
    const rawEventB = eventB.rawResult as { ok?: boolean; error?: string; event?: { id?: string } };
    if (rawEventB.ok === false) {
      console.log(JSON.stringify({
        ok: false,
        blocked: "calendar_write_unavailable",
        detail: rawEventB.error ?? "Falha ao criar segundo evento temporário para smoke.",
      }, null, 2));
      return;
    }
    const createdB = rawEventB.event?.id;
    if (createdB) {
      createdEvents.push({ id: createdB, account });
    }

    await delay(1500);

    const prompts = [
      "mostre meu perfil operacional",
      "defina meu estilo de resposta como direto e objetivo",
      "gere meu briefing da manhã",
      `mostre minha agenda${accountQualifier} em ${dateLabel}`,
      `cancele o evento reuniao teste refino em ${dateLabel}${accountQualifier}`,
      `renomeie o evento ${testSummaryA} em ${dateLabel}${accountQualifier} para Reunião teste CAPS`,
      `atualize o evento ${testSummaryA} em ${dateLabel}${accountQualifier} com local: Sala 5`,
      `mova o evento ${testSummaryA} em ${dateLabel}${accountQualifier} para das 16h às 17h`,
    ];

    let step = 1;
    for (const prompt of prompts) {
      const result = await core.runUserPrompt(prompt);
      transcript.push({
        step,
        prompt,
        reply: result.reply,
      });
      step += 1;
    }

    const checks = {
      profileShown: transcript[0]?.reply.includes("Perfil operacional base:") === true,
      profileUpdated: transcript[1]?.reply.includes("Perfil operacional atualizado.") === true,
      briefStructured: ["Visão do dia:", "Atenção principal:", "Agenda limpa:"].every((token) =>
        transcript[2]?.reply.includes(token)
      ),
      agendaByDay: transcript[3]?.reply.includes(shortDateLabel) === true
        && transcript[3]?.reply.includes(accountSuffix),
      ambiguityShort: transcript[4]?.reply.includes("Responda com 1 ou 2") === true,
      renameDraft: transcript[5]?.reply.includes("Rascunho de atualização de evento Google pronto.") === true
        && transcript[5]?.reply.includes("- Título: Reunião teste CAPS"),
      locationDraft: transcript[6]?.reply.includes("- Local: Sala 5") === true,
      moveDraft: transcript[7]?.reply.includes("- Início: dom., 19/04, 16:00") === true
        || transcript[7]?.reply.includes("- Início: 19/04, 16:00"),
    };

    console.log(JSON.stringify({
      account,
      ok: Object.values(checks).every(Boolean),
      checks,
      transcript: transcript.map((item) => ({
        step: item.step,
        prompt: item.prompt,
        replyPreview: summarize(item.reply, 320),
      })),
    }, null, 2));
  } finally {
    for (const event of createdEvents) {
      try {
        await core.executeToolDirect("delete_calendar_event", {
          event_id: event.id,
          account: event.account ?? "primary",
        });
      } catch {
        // keep cleanup best effort; smoke output is the primary signal
      }
    }

    try {
      personalMemory.updateProfile(originalProfile);
    } catch {
      // best effort restore
    }

    try {
      preferences.update(originalPreferences);
    } catch {
      // best effort restore
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

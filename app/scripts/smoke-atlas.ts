import { promises as fs } from "node:fs";
import path from "node:path";
import { createAgentCore } from "../src/core/create-agent-core.ts";
import { OpenAiAudioTranscriptionService } from "../src/integrations/openai/audio-transcription.ts";

function extractJsonBetween(text: string, start: string, end: string): Record<string, unknown> | undefined {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return undefined;
  }

  const payload = text.slice(startIndex + start.length, endIndex).trim();
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildIso(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00-03:00`;
}

async function main(): Promise<void> {
  const { core, config } = await createAgentCore();

  const moveCreate = await core.executeToolDirect("create_calendar_event", {
    summary: "[TESTE MOVE] Atlas Prime",
    start: buildIso("2026-04-14", 15),
    end: buildIso("2026-04-14", 16),
    account: "primary",
    reminder_minutes: 30,
  });

  const batchOne = await core.executeToolDirect("create_calendar_event", {
    summary: "[TESTE LISTA] Atlas Prime A",
    start: buildIso("2026-04-15", 9),
    end: buildIso("2026-04-15", 10),
    account: "primary",
    reminder_minutes: 30,
  });

  const batchTwo = await core.executeToolDirect("create_calendar_event", {
    summary: "[TESTE LISTA] Atlas Prime B",
    start: buildIso("2026-04-15", 11),
    end: buildIso("2026-04-15", 12),
    account: "primary",
    reminder_minutes: 30,
  });

  const listResult = await core.runUserPrompt("liste meus compromissos em 15/04/2026");
  const moveResult = await core.runUserPrompt(
    "mova o evento TESTE MOVE Atlas Prime em 14/04/2026 para das 16h às 17h, local: Sala 5, convide maria@example.com",
  );
  const moveDraft = extractJsonBetween(
    moveResult.reply,
    "GOOGLE_EVENT_UPDATE_DRAFT",
    "END_GOOGLE_EVENT_UPDATE_DRAFT",
  );

  let updateResult: { rawResult: unknown } | null = null;
  if (moveDraft?.eventId) {
    updateResult = await core.executeToolDirect("update_calendar_event", {
      event_id: moveDraft.eventId,
      summary: moveDraft.summary,
      start: moveDraft.start,
      end: moveDraft.end,
      location: moveDraft.location,
      attendees: moveDraft.attendees,
      account: moveDraft.account,
      reminder_minutes: moveDraft.reminderMinutes,
    });
  }

  const deleteResult = await core.runUserPrompt("cancele meus eventos em 15/04/2026");
  const deleteDraft = extractJsonBetween(
    deleteResult.reply,
    "GOOGLE_EVENT_DELETE_BATCH_DRAFT",
    "END_GOOGLE_EVENT_DELETE_BATCH_DRAFT",
  );

  let deleted = 0;
  if (Array.isArray(deleteDraft?.events)) {
    for (const event of deleteDraft.events as Array<Record<string, unknown>>) {
      if (!String(event.summary ?? "").includes("[TESTE LISTA]")) {
        continue;
      }
      await core.executeToolDirect("delete_calendar_event", {
        event_id: event.eventId,
        account: event.account ?? "primary",
      });
      deleted += 1;
    }
  }

  const moveEventId =
    (typeof moveDraft?.eventId === "string" && moveDraft.eventId) ||
    ((moveCreate.rawResult as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined)?.id;
  if (moveEventId) {
    await core.executeToolDirect("delete_calendar_event", {
      event_id: moveEventId,
      account: (moveDraft?.account as string | undefined) ?? "primary",
    });
  }

  let transcription: unknown = null;
  const audioPath = path.join("/app", "tmp", "atlas-prime-test.m4a");
  if (config.llm.provider === "openai" && config.llm.apiKey) {
    const audio = await fs.readFile(audioPath);
    const transcriber = new OpenAiAudioTranscriptionService(config.llm.apiKey, config.llm.baseUrl);
    transcription = await transcriber.transcribe({
      audio,
      filename: "atlas-prime-test.m4a",
      mimeType: "audio/mp4",
      language: "pt",
    });
  }

  console.log(
    JSON.stringify(
      {
        moveCreate: moveCreate.rawResult,
        batchOne: batchOne.rawResult,
        batchTwo: batchTwo.rawResult,
        listReply: listResult.reply,
        moveReply: moveResult.reply,
        moveDraft,
        updateResult: updateResult?.rawResult ?? null,
        deleteReply: deleteResult.reply,
        deleteBatchCount: Array.isArray(deleteDraft?.events) ? deleteDraft.events.length : 0,
        deleted,
        transcription,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

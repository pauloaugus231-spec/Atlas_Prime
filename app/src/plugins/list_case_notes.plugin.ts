import { SOCIAL_NOTE_TYPES, SOCIAL_SENSITIVITY_LEVELS } from "../types/social-assistant.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ListCaseNotesParameters {
  note_type?: (typeof SOCIAL_NOTE_TYPES)[number];
  sensitivity?: (typeof SOCIAL_SENSITIVITY_LEVELS)[number];
  search?: string;
  limit?: number;
}

export default defineToolPlugin<ListCaseNotesParameters>({
  name: "list_case_notes",
  description: "Lists stored social-work notes with sensitivity preserved locally.",
  parameters: {
    type: "object",
    properties: {
      note_type: { type: "string", enum: [...SOCIAL_NOTE_TYPES] },
      sensitivity: { type: "string", enum: [...SOCIAL_SENSITIVITY_LEVELS] },
      search: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const notes = context.socialAssistant.listNotes({
      noteType: parameters.note_type,
      sensitivity: parameters.sensitivity,
      search: parameters.search,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: notes.length,
      notes,
      requires_human_review: true,
    };
  },
});

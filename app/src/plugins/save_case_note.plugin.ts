import { SOCIAL_NOTE_TYPES, SOCIAL_SENSITIVITY_LEVELS } from "../types/social-assistant.js";
import { defineToolPlugin } from "../types/plugin.js";

interface SaveCaseNoteParameters {
  title: string;
  note_type: (typeof SOCIAL_NOTE_TYPES)[number];
  sensitivity?: (typeof SOCIAL_SENSITIVITY_LEVELS)[number];
  person_label?: string;
  summary: string;
  details?: string;
  next_action?: string;
  follow_up_date?: string;
  tags?: string[];
}

export default defineToolPlugin<SaveCaseNoteParameters>({
  name: "save_case_note",
  description:
    "Persists a sensitive social-work case note or follow-up note in a dedicated local store.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      note_type: { type: "string", enum: [...SOCIAL_NOTE_TYPES] },
      sensitivity: { type: "string", enum: [...SOCIAL_SENSITIVITY_LEVELS], default: "restricted" },
      person_label: { type: "string" },
      summary: { type: "string" },
      details: { type: "string" },
      next_action: { type: "string" },
      follow_up_date: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["title", "note_type", "summary"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const note = context.socialAssistant.createNote({
      title: parameters.title,
      noteType: parameters.note_type,
      sensitivity: parameters.sensitivity,
      personLabel: parameters.person_label,
      summary: parameters.summary,
      details: parameters.details,
      nextAction: parameters.next_action,
      followUpDate: parameters.follow_up_date,
      tags: parameters.tags,
    });

    return {
      ok: true,
      note,
      requires_human_review: true,
    };
  },
});

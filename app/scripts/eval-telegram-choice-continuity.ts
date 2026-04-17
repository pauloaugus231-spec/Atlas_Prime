import process from "node:process";
import {
  buildPendingChoiceContinuationPrompt,
  extractPendingChoiceState,
  resolvePendingChoiceReply,
} from "../src/integrations/telegram/pending-choice.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const OPTIONS_TEXT = [
  "Próxima ação recomendada (escolha uma, responda com o número):",
  "1) Mostrar a semana completa (13–19/04) com todos os eventos e links.",
  "2) Exibir apenas detalhes completos dos eventos de 13/04.",
  "3) Marcar conflito/alerta para revisão humana nas sobreposições da manhã.",
  "4) Não fazer nada agora - encerrar aqui.",
].join("\n");

function runPendingChoiceHarness(input: {
  assistantText: string;
  userReply: string;
  runContinuation?: (prompt: string) => string;
}): { kind: string; reply?: string; selectedIndex?: number } {
  const state = extractPendingChoiceState(input.assistantText);
  const resolution = resolvePendingChoiceReply(state, input.userReply);

  if (resolution.kind === "select" && state) {
    const prompt = buildPendingChoiceContinuationPrompt({
      state,
      option: resolution.option,
      userReply: input.userReply,
    });
    const reply = input.runContinuation
      ? input.runContinuation(prompt)
      : `Executando opção ${resolution.option.index}`;
    return {
      kind: "select",
      reply,
      selectedIndex: resolution.option.index,
    };
  }

  if (resolution.kind === "cancel" || resolution.kind === "clarify") {
    return {
      kind: resolution.kind,
      reply: resolution.message,
    };
  }

  return {
    kind: resolution.kind,
  };
}

function run() {
  const results: EvalResult[] = [];
  const state = extractPendingChoiceState(OPTIONS_TEXT);

  results.push({
    name: "detects_pending_choice_state_from_numbered_options",
    passed: Boolean(state && state.options.length === 4),
    detail: JSON.stringify(state, null, 2),
  });

  const choiceOne = runPendingChoiceHarness({
    assistantText: OPTIONS_TEXT,
    userReply: "1",
  });
  results.push({
    name: "option_1_continues_pending_flow",
    passed: choiceOne.kind === "select" && choiceOne.selectedIndex === 1,
    detail: JSON.stringify(choiceOne, null, 2),
  });

  const choiceThree = runPendingChoiceHarness({
    assistantText: OPTIONS_TEXT,
    userReply: "3",
  });
  results.push({
    name: "option_3_continues_pending_flow",
    passed: choiceThree.kind === "select" && choiceThree.selectedIndex === 3,
    detail: JSON.stringify(choiceThree, null, 2),
  });

  const cancel = runPendingChoiceHarness({
    assistantText: OPTIONS_TEXT,
    userReply: "cancelar",
  });
  results.push({
    name: "cancel_ends_pending_flow",
    passed: cancel.kind === "cancel" && cancel.reply?.includes("cancelada") === true,
    detail: JSON.stringify(cancel, null, 2),
  });

  const invalid = runPendingChoiceHarness({
    assistantText: OPTIONS_TEXT,
    userReply: "9",
  });
  results.push({
    name: "invalid_short_reply_requests_short_correction",
    passed: invalid.kind === "clarify" && invalid.reply?.includes("Escolha uma opção válida") === true,
    detail: JSON.stringify(invalid, null, 2),
  });

  const unavailable = runPendingChoiceHarness({
    assistantText: OPTIONS_TEXT,
    userReply: "2",
    runContinuation: () => "Não consigo executar essa opção neste runtime atual. Posso mostrar os detalhes ou preparar um rascunho.",
  });
  results.push({
    name: "honest_reply_when_selected_option_cannot_run",
    passed: unavailable.kind === "select" && unavailable.reply?.includes("Não consigo executar") === true,
    detail: JSON.stringify(unavailable, null, 2),
  });

  const noContext = resolvePendingChoiceReply(null, "1");
  results.push({
    name: "isolated_number_without_pending_context_is_not_auto_choice",
    passed: noContext.kind === "no_match",
    detail: JSON.stringify(noContext, null, 2),
  });

  const okAmbiguous = runPendingChoiceHarness({
    assistantText: OPTIONS_TEXT,
    userReply: "ok",
  });
  results.push({
    name: "short_ok_with_multiple_options_stays_in_choice_context",
    passed: okAmbiguous.kind === "clarify" && okAmbiguous.reply?.includes("1, 2, 3, 4") === true,
    detail: JSON.stringify(okAmbiguous, null, 2),
  });

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const item of failures) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nTelegram choice continuity evals ok: ${results.length}/${results.length}`);
}

run();

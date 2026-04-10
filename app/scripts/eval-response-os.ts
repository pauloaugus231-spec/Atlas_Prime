import process from "node:process";
import { ResponseOS } from "../src/core/response-os.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function run() {
  const responseOs = new ResponseOS();
  const results: EvalResult[] = [];

  const approvalReply = responseOs.buildApprovalReviewReply({
    scopeLabel: "WhatsApp",
    items: [
      { id: 12, subject: "WhatsApp abordagem: Paulo Augusto", actionKind: "whatsapp_reply", createdAt: "2026-04-04T18:07:30.784Z" },
      { id: 25, subject: "YouTube: item #31", actionKind: "youtube_publish", createdAt: "2026-04-05T13:15:51.613Z" },
    ],
    recommendedNextStep: "Decidir a resposta pendente de WhatsApp: WhatsApp abordagem: Paulo Augusto.",
  });
  results.push({
    name: "approval_reply_contract",
    passed: approvalReply.includes("Leitura operacional:")
      && approvalReply.includes("Situação agora:")
      && approvalReply.includes("Prioridades:")
      && approvalReply.includes("Próxima ação:"),
    detail: approvalReply,
  });

  const inboxReply = responseOs.buildInboxTriageReply({
    scopeLabel: "email principal",
    unreadOnly: true,
    limit: 10,
    items: [
      {
        uid: "1001",
        subject: "Cliente pediu retorno hoje",
        from: ["Cliente <cliente@example.com>"],
        relationship: "client",
        priority: "alta",
        category: "operacional",
        action: "responder com proposta objetiva ainda hoje",
      },
      {
        uid: "1002",
        subject: "Follow-up comercial",
        from: ["Lead <lead@example.com>"],
        relationship: "lead",
        priority: "media",
        category: "comercial",
        action: "responder e alinhar próximo passo",
      },
    ],
    recommendedNextStep: "Executar a próxima ação do UID 1001: responder com proposta objetiva ainda hoje.",
  });
  results.push({
    name: "inbox_reply_contract",
    passed: inboxReply.includes("Leitura operacional:")
      && inboxReply.includes("Situação agora:")
      && inboxReply.includes("Plano curto:")
      && inboxReply.includes("UID 1001"),
    detail: inboxReply,
  });

  const scheduleReply = responseOs.buildScheduleLookupReply({
    targetLabel: "amanhã",
    topicLabel: "muralismo",
    events: [
      {
        account: "abordagem",
        summary: "Paulo e Máira: Muralismo",
        start: "09/04, 08:00",
        location: "Casa da Sopa",
      },
    ],
    recommendedNextStep: "Revisar os demais eventos do mesmo dia para confirmar conflito ou contexto.",
  });
  results.push({
    name: "schedule_reply_contract",
    passed: scheduleReply.includes("Leitura operacional:")
      && scheduleReply.includes("Objetivo: verificar agenda")
      && scheduleReply.includes("Prioridades:")
      && scheduleReply.includes("Próxima ação:"),
    detail: scheduleReply,
  });

  const messageReply = responseOs.buildMessageHistoryReply({
    scopeLabel: "WhatsApp abordagem",
    items: [
      {
        when: "10/04 09:00",
        who: "Paulo Augusto",
        direction: "recebida",
        text: "Consegue me responder hoje?",
      },
    ],
    recommendedNextStep: "Ler a última mensagem e decidir se o próximo passo é responder, acompanhar ou registrar contexto.",
  });
  results.push({
    name: "message_history_reply_contract",
    passed: messageReply.includes("Leitura operacional:")
      && messageReply.includes("Contexto útil:")
      && messageReply.includes("Próxima ação:"),
    detail: messageReply,
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

  console.log(`\nResponse OS evals ok: ${results.length}/${results.length}`);
}

run();

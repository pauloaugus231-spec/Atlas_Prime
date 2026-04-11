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
    groupSummary: [
      "categoria operacional: 1 email(s)",
      "relação client: 1 email(s)",
    ],
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
      && inboxReply.includes("Focos executivos:")
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

  const organizationReply = responseOs.buildOrganizationReply({
    objective: "organizar o dia operacional",
    currentSituation: [
      "4 compromisso(s) no dia",
      "1 conflito de agenda para Paulo",
      "clima hoje: chuva fraca | vestir: camada leve | levar: guarda-chuva",
    ],
    priorities: [
      "resolver o conflito de agenda em Espaço de Cuidados",
      "preparar deslocamento para Sistemática",
      "revisar a aprovação mais urgente: WhatsApp abordagem: Paulo Augusto",
    ],
    actionPlan: [
      "resolver primeiro os conflitos da sua agenda",
      "preparar deslocamento para Sistemática",
      "definir dono para Banho e tirar isso do seu foco direto",
    ],
    recommendedNextStep: "Resolver o conflito envolvendo Espaço de Cuidados.",
  });
  results.push({
    name: "organization_reply_contract",
    passed: organizationReply.includes("Leitura operacional:")
      && organizationReply.includes("Situação agora:")
      && organizationReply.includes("Prioridades:")
      && organizationReply.includes("Plano curto:")
      && organizationReply.includes("Próxima ação:"),
    detail: organizationReply,
  });

  const supportReply = responseOs.buildSupportQueueReply({
    objective: "revisar a fila de suporte e atendimento",
    currentSituation: [
      "2 email(s) com sinal de suporte ou cliente",
      "1 resposta de WhatsApp aguardando aprovação",
      "1 mensagem inbound recente com contexto de cliente",
    ],
    channelSummary: [
      "email: 2 caso(s) com sinal de cliente ou suporte",
      "whatsapp: 1 mensagem inbound de cliente",
      "aprovações: 1 resposta pronta para decidir",
    ],
    criticalCases: [
      {
        label: "WhatsApp abordagem: Paulo Augusto",
        channel: "approval",
        detail: "resposta pronta aguardando decisão",
      },
      {
        label: "Cliente sem acesso à conta",
        channel: "email",
        detail: "acesso e login | responder hoje com instrução objetiva",
      },
    ],
    pendingReplies: [
      {
        label: "WhatsApp abordagem: Paulo Augusto",
        channel: "approval",
        detail: "revisar rascunho antes de enviar",
      },
    ],
    recurringThemes: [
      "acesso e login: 2 ocorrência(s)",
      "erro e instabilidade: 1 ocorrência(s)",
    ],
    recommendedNextStep: "Abrir a aprovação mais urgente: WhatsApp abordagem: Paulo Augusto.",
  });
  results.push({
    name: "support_queue_reply_contract",
    passed: supportReply.includes("Leitura operacional:")
      && supportReply.includes("Fila por canal:")
      && supportReply.includes("Casos críticos:")
      && supportReply.includes("Respostas pendentes:")
      && supportReply.includes("Temas recorrentes:")
      && supportReply.includes("Próxima ação:"),
    detail: supportReply,
  });

  const followUpReply = responseOs.buildFollowUpReviewReply({
    scopeLabel: "pipeline e leads ativos",
    currentSituation: [
      "6 lead(s) abertos no pipeline",
      "2 follow-up(s) vencido(s)",
      "1 follow-up para hoje ou próximas 24h",
    ],
    overdueItems: [
      {
        label: "Clínica Aurora | Aurora Psi",
        status: "proposal",
        dueLabel: "vencido desde 10/04 09:00",
      },
    ],
    todayItems: [
      {
        label: "Instituto Delta",
        status: "qualified",
        dueLabel: "hoje às 11/04 15:00",
      },
    ],
    unscheduledItems: [
      {
        label: "Lead sem data",
        status: "contacted",
        dueLabel: "sem data",
      },
    ],
    recommendedNextStep: "Atacar primeiro o follow-up vencido de Clínica Aurora | Aurora Psi.",
  });
  results.push({
    name: "follow_up_reply_contract",
    passed: followUpReply.includes("Prioridades:")
      && followUpReply.includes("Sem follow-up definido:")
      && followUpReply.includes("Próxima ação:"),
    detail: followUpReply,
  });

  const commitmentPrepReply = responseOs.buildCommitmentPrepReply({
    title: "Reunião no CAPS Girassol",
    startLabel: "11/04, 10:00",
    account: "primary",
    owner: "paulo",
    context: "externo",
    location: "CAPS Girassol",
    weatherTip: "vestir: roupa leve | levar: guarda-chuva",
    checklist: [
      "confirmar endereço e rota antes de sair",
      "levar o local salvo: CAPS Girassol",
    ],
    alerts: ["há conflito de agenda nesse horário"],
    recommendedNextStep: "Resolver primeiro este alerta: há conflito de agenda nesse horário.",
  });
  results.push({
    name: "commitment_prep_reply_contract",
    passed: commitmentPrepReply.includes("Preparação do compromisso:")
      && commitmentPrepReply.includes("Checklist:")
      && commitmentPrepReply.includes("Alertas:")
      && commitmentPrepReply.includes("Próxima ação:"),
    detail: commitmentPrepReply,
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

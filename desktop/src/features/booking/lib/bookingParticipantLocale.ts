export type BookingParticipantSourceMessages = {
  participantSourceChannel: string;
  participantSourcePhone: string;
  participantSourceVisit: string;
  participantSourceTelegram: string;
  participantSourceMax: string;
  participantSourceWhatsapp: string;
  participantSourceOther: string;
  participantInternalComment: string;
  participantIdentityChoiceTitle: string;
  participantIdentityChoiceDescription: string;
  participantAlreadyAddedTitle: string;
  participantAlreadyAddedDescription: string;
  participantCapacityFullTitle: string;
  participantCapacityFullDescription: string;
};

export const RU_BOOKING_PARTICIPANT_SOURCE_MESSAGES: BookingParticipantSourceMessages =
  {
    participantSourceChannel: "Источник",
    participantSourcePhone: "Звонок",
    participantSourceVisit: "Визит",
    participantSourceTelegram: "Telegram",
    participantSourceMax: "MAX",
    participantSourceWhatsapp: "WhatsApp",
    participantSourceOther: "Другое",
    participantInternalComment: "Комментарий (необязательно)",
    participantIdentityChoiceTitle: "Нужно выбрать клиента",
    participantIdentityChoiceDescription:
      "Найдено несколько подходящих карточек. Вернитесь к поиску и выберите ребёнка из базы.",
    participantAlreadyAddedTitle: "Ребёнок уже добавлен",
    participantAlreadyAddedDescription:
      "Этот ребёнок уже записан или зачислен на занятие.",
    participantCapacityFullTitle: "Свободных мест нет",
    participantCapacityFullDescription:
      "На этом занятии больше нет свободных мест. Выберите другое занятие.",
  };

export const EN_BOOKING_PARTICIPANT_SOURCE_MESSAGES: BookingParticipantSourceMessages =
  {
    participantSourceChannel: "Source",
    participantSourcePhone: "Phone call",
    participantSourceVisit: "In-person visit",
    participantSourceTelegram: "Telegram",
    participantSourceMax: "MAX",
    participantSourceWhatsapp: "WhatsApp",
    participantSourceOther: "Other",
    participantInternalComment: "Internal note (optional)",
    participantIdentityChoiceTitle: "Choose a client",
    participantIdentityChoiceDescription:
      "Several matching records were found. Return to search and select the child from the client list.",
    participantAlreadyAddedTitle: "Child already added",
    participantAlreadyAddedDescription:
      "This child is already booked or enrolled in the class.",
    participantCapacityFullTitle: "No places available",
    participantCapacityFullDescription:
      "This class has no places left. Choose another class.",
  };

export const PT_BR_BOOKING_PARTICIPANT_SOURCE_MESSAGES: BookingParticipantSourceMessages =
  {
    participantSourceChannel: "Origem",
    participantSourcePhone: "Ligação telefônica",
    participantSourceVisit: "Visita presencial",
    participantSourceTelegram: "Telegram",
    participantSourceMax: "MAX",
    participantSourceWhatsapp: "WhatsApp",
    participantSourceOther: "Outro",
    participantInternalComment: "Observação interna (opcional)",
    participantIdentityChoiceTitle: "Escolha um cliente",
    participantIdentityChoiceDescription:
      "Foram encontrados vários cadastros correspondentes. Volte à busca e selecione a criança na lista de clientes.",
    participantAlreadyAddedTitle: "Criança já adicionada",
    participantAlreadyAddedDescription:
      "Esta criança já está agendada ou matriculada na aula.",
    participantCapacityFullTitle: "Sem vagas disponíveis",
    participantCapacityFullDescription:
      "Esta aula não tem mais vagas. Escolha outra aula.",
  };

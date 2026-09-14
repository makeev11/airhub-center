import type { ActivationLocale } from "@/features/activation/i18n";
import {
  parseBookingWorkspace,
  type BookingWorkspace,
} from "@/features/booking/model/bookingCore";

type DemoLocale = Extract<ActivationLocale, "ru-RU" | "en-US" | "pt-BR">;

type LocalizedValue = Readonly<{
  ru: string;
  en: string;
  pt: string;
}>;

const ORGANIZATION_NAME: LocalizedValue = {
  ru: "Каляка Маляка",
  en: "AirHop Demo Center",
  pt: "Centro de demonstração AirHop",
};

const BRANCHES: Readonly<
  Record<string, { name: LocalizedValue; address: LocalizedValue }>
> = {
  kurskaya: {
    name: { ru: "Курская", en: "Kurskaya", pt: "Kurskaya" },
    address: {
      ru: "ул. Земляной Вал, 27",
      en: "27 Zemlyanoy Val St.",
      pt: "Rua Zemlyanoy Val, 27",
    },
  },
  akademicheskaya: {
    name: { ru: "Академическая", en: "Akademicheskaya", pt: "Akademicheskaya" },
    address: {
      ru: "Профсоюзная ул., 17",
      en: "17 Profsoyuznaya St.",
      pt: "Rua Profsoyuznaya, 17",
    },
  },
};

const GROUP_NAMES: Readonly<Record<string, LocalizedValue>> = {
  "robotics-junior": {
    ru: "Робототехника Junior",
    en: "Junior Robotics",
    pt: "Robótica Júnior",
  },
  animation: {
    ru: "Мультстудия",
    en: "Animation Studio",
    pt: "Estúdio de animação",
  },
  "chess-start": {
    ru: "Шахматы: первый ход",
    en: "Chess: First Move",
    pt: "Xadrez: primeiro movimento",
  },
  "science-lab": {
    ru: "Научная лаборатория",
    en: "Science Lab",
    pt: "Laboratório de ciências",
  },
  "english-play": {
    ru: "English Play",
    en: "English Play",
    pt: "Inglês brincando",
  },
  theatre: {
    ru: "Театральная студия",
    en: "Theater Studio",
    pt: "Estúdio de teatro",
  },
  ceramics: { ru: "Керамика", en: "Ceramics", pt: "Cerâmica" },
  programming: { ru: "Программирование", en: "Programming", pt: "Programação" },
  "dance-kids": { ru: "Танцы Kids", en: "Kids Dance", pt: "Dança infantil" },
  "math-club": {
    ru: "Математический клуб",
    en: "Math Club",
    pt: "Clube de matemática",
  },
  "family-art": {
    ru: "Семейная арт-мастерская",
    en: "Family Art Workshop",
    pt: "Oficina de arte em família",
  },
  "music-start": {
    ru: "Музыка с нуля",
    en: "Music for Beginners",
    pt: "Música para iniciantes",
  },
  architecture: {
    ru: "Архитектура для детей",
    en: "Architecture for Kids",
    pt: "Arquitetura para crianças",
  },
  "public-speaking": {
    ru: "Уверенная речь",
    en: "Confident Speaking",
    pt: "Oratória com confiança",
  },
  "public-limited": {
    ru: "Открытая лаборатория",
    en: "Open Lab",
    pt: "Laboratório aberto",
  },
  "public-disabled": {
    ru: "Закрытая демонстрационная группа",
    en: "Closed Demo Group",
    pt: "Grupo de demonstração fechado",
  },
};

const ROOM_NAMES: Readonly<Record<string, LocalizedValue>> = {
  "robotics-junior-room": {
    ru: "Лаборатория 1",
    en: "Lab 1",
    pt: "Laboratório 1",
  },
  "animation-room": { ru: "Медиа-зал", en: "Media Room", pt: "Sala de mídia" },
  "science-lab-room": { ru: "Лаборатория 2", en: "Lab 2", pt: "Laboratório 2" },
  "english-play-room": { ru: "Зал 2", en: "Room 2", pt: "Sala 2" },
  "ceramics-room": { ru: "Мастерская", en: "Workshop", pt: "Oficina" },
  "programming-room": {
    ru: "Компьютерный класс",
    en: "Computer Lab",
    pt: "Laboratório de informática",
  },
  "dance-kids-room": {
    ru: "Большой зал",
    en: "Main Hall",
    pt: "Salão principal",
  },
  "math-club-room": { ru: "Кабинет 4", en: "Room 4", pt: "Sala 4" },
  "family-art-room": {
    ru: "Мастерская",
    en: "Art Studio",
    pt: "Estúdio de arte",
  },
  "architecture-room": { ru: "Зал 3", en: "Room 3", pt: "Sala 3" },
  "public-limited-room": {
    ru: "Лаборатория записи",
    en: "Booking Lab",
    pt: "Laboratório de agendamento",
  },
  "public-speaking-room": { ru: "Зал 1", en: "Room 1", pt: "Sala 1" },
};

const TEACHER_NAMES: Readonly<Record<string, LocalizedValue>> = {
  "teacher-1": { ru: "Анна Орлова", en: "Anna Orlova", pt: "Anna Orlova" },
  "teacher-2": { ru: "Илья Соколов", en: "Ilya Sokolov", pt: "Ilya Sokolov" },
  "teacher-3": {
    ru: "Мария Волкова",
    en: "Maria Volkova",
    pt: "Maria Volkova",
  },
  "teacher-4": {
    ru: "Павел Миронов",
    en: "Pavel Mironov",
    pt: "Pavel Mironov",
  },
  "teacher-5": {
    ru: "Елена Смирнова",
    en: "Elena Smirnova",
    pt: "Elena Smirnova",
  },
  "teacher-6": { ru: "Нина Белова", en: "Nina Belova", pt: "Nina Belova" },
  "teacher-7": { ru: "Ольга Рябова", en: "Olga Ryabova", pt: "Olga Ryabova" },
  "teacher-8": { ru: "Денис Котов", en: "Denis Kotov", pt: "Denis Kotov" },
  "teacher-9": {
    ru: "Алина Яковлева",
    en: "Alina Yakovleva",
    pt: "Alina Yakovleva",
  },
  "teacher-10": {
    ru: "Софья Лебедева",
    en: "Sofia Lebedeva",
    pt: "Sofia Lebedeva",
  },
  "teacher-11": { ru: "Роман Егоров", en: "Roman Egorov", pt: "Roman Egorov" },
  "teacher-12": { ru: "Дарья Попова", en: "Daria Popova", pt: "Daria Popova" },
  "teacher-13": { ru: "Максим Фролов", en: "Maxim Frolov", pt: "Maxim Frolov" },
  "teacher-14": { ru: "Вера Крылова", en: "Vera Krylova", pt: "Vera Krylova" },
};

const TARIFFS: Readonly<
  Record<string, { name: LocalizedValue; description: LocalizedValue }>
> = {
  "tariff-weekly-1": {
    name: { ru: "1 раз в неделю", en: "Once a week", pt: "Uma vez por semana" },
    description: {
      ru: "Одно регулярное занятие в неделю",
      en: "One regular class per week",
      pt: "Uma aula regular por semana",
    },
  },
  "tariff-weekly-2": {
    name: {
      ru: "2 раза в неделю",
      en: "Twice a week",
      pt: "Duas vezes por semana",
    },
    description: {
      ru: "Два регулярных занятия в неделю",
      en: "Two regular classes per week",
      pt: "Duas aulas regulares por semana",
    },
  },
  "tariff-weekly-3": {
    name: {
      ru: "3 раза в неделю",
      en: "Three times a week",
      pt: "Três vezes por semana",
    },
    description: {
      ru: "Три регулярных занятия в неделю",
      en: "Three regular classes per week",
      pt: "Três aulas regulares por semana",
    },
  },
};

const EXCEPTION_REASONS: Readonly<Record<string, LocalizedValue>> = {
  "english-play-moved": {
    ru: "Демонстрационный перенос",
    en: "Demo reschedule",
    pt: "Reagendamento de demonstração",
  },
  "theatre-cancelled": {
    ru: "Демонстрационная отмена",
    en: "Demo cancellation",
    pt: "Cancelamento de demonstração",
  },
};

function supportedLocale(locale: ActivationLocale): DemoLocale {
  return locale === "ru-RU" || locale === "pt-BR" ? locale : "en-US";
}

function localizeKnownValue(
  value: string,
  translation: LocalizedValue | undefined,
  locale: DemoLocale,
): string {
  if (!translation) return value;
  if (
    value !== translation.ru &&
    value !== translation.en &&
    value !== translation.pt
  )
    return value;
  return locale === "ru-RU"
    ? translation.ru
    : locale === "pt-BR"
      ? translation.pt
      : translation.en;
}

/**
 * Localizes only the stable records shipped with the local demo workspace.
 * User-created and renamed records are deliberately preserved verbatim.
 */
export function localizeDemoBookingWorkspace(
  workspace: BookingWorkspace,
  requestedLocale: ActivationLocale,
): BookingWorkspace {
  const locale = supportedLocale(requestedLocale);
  return parseBookingWorkspace({
    ...workspace,
    organization: {
      ...workspace.organization,
      locale,
      name:
        workspace.organization.id === "airhop"
          ? localizeKnownValue(
              workspace.organization.name,
              ORGANIZATION_NAME,
              locale,
            )
          : workspace.organization.name,
    },
    branches: workspace.branches.map((branch) => ({
      ...branch,
      name: localizeKnownValue(branch.name, BRANCHES[branch.id]?.name, locale),
      address: localizeKnownValue(
        branch.address,
        BRANCHES[branch.id]?.address,
        locale,
      ),
    })),
    rooms: workspace.rooms.map((room) => ({
      ...room,
      name: localizeKnownValue(room.name, ROOM_NAMES[room.id], locale),
    })),
    teachers: workspace.teachers.map((teacher) => ({
      ...teacher,
      displayName: localizeKnownValue(
        teacher.displayName,
        TEACHER_NAMES[teacher.id],
        locale,
      ),
    })),
    groups: workspace.groups.map((group) => ({
      ...group,
      name: localizeKnownValue(group.name, GROUP_NAMES[group.id], locale),
    })),
    lessonExceptions: workspace.lessonExceptions.map((exception) => ({
      ...exception,
      ...(exception.reason
        ? {
            reason: localizeKnownValue(
              exception.reason,
              EXCEPTION_REASONS[exception.id],
              locale,
            ),
          }
        : {}),
    })),
    tariffs: workspace.tariffs.map((tariff) => ({
      ...tariff,
      name: localizeKnownValue(tariff.name, TARIFFS[tariff.id]?.name, locale),
      ...(tariff.description === undefined
        ? {}
        : {
            description: localizeKnownValue(
              tariff.description,
              TARIFFS[tariff.id]?.description,
              locale,
            ),
          }),
    })),
    paymentExpectations: workspace.paymentExpectations.map((payment) => ({
      ...payment,
      tariffNameSnapshot: localizeKnownValue(
        payment.tariffNameSnapshot,
        TARIFFS[payment.tariffId]?.name,
        locale,
      ),
    })),
  });
}

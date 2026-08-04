export type BookingBranch = {
  id: "kurskaya" | "akademicheskaya";
  name: string;
  address: string;
  workingHours: string;
};

export type TrialOffer = { mode: "free" } | { mode: "paid"; priceRub: number };

export type ScheduleLesson = {
  id: string;
  dayIndex: number;
  date: string;
  startTime: string;
  endTime: string;
  branchId: BookingBranch["id"];
  groupName: string;
  ageLabel: string;
  room?: string;
  teachers?: string[];
  capacity?: number;
  booked: number;
  status: "scheduled" | "moved" | "cancelled";
  movedFrom?: string;
  trial: TrialOffer;
};

type LessonTemplate = Omit<ScheduleLesson, "date">;

export const BOOKING_TIME_ZONE = "Europe/Moscow";
export const DEMO_WEEK_START = "2026-08-10";

export const DEMO_BRANCHES: BookingBranch[] = [
  {
    id: "kurskaya",
    name: "Курская",
    address: "ул. Земляной Вал, 27",
    workingHours: "09:00–21:00",
  },
  {
    id: "akademicheskaya",
    name: "Академическая",
    address: "Профсоюзная ул., 17",
    workingHours: "10:00–22:00",
  },
];

const LESSON_TEMPLATES: LessonTemplate[] = [
  {
    id: "robotics-junior",
    dayIndex: 0,
    startTime: "10:00",
    endTime: "11:00",
    branchId: "kurskaya",
    groupName: "Робототехника Junior",
    ageLabel: "5–7 лет",
    room: "Лаборатория 1",
    teachers: ["Анна Орлова"],
    capacity: 8,
    booked: 3,
    status: "scheduled",
    trial: { mode: "free" },
  },
  {
    id: "animation",
    dayIndex: 0,
    startTime: "18:30",
    endTime: "20:00",
    branchId: "akademicheskaya",
    groupName: "Мультстудия",
    ageLabel: "8–11 лет",
    room: "Медиа-зал",
    teachers: ["Илья Соколов", "Мария Волкова"],
    capacity: 10,
    booked: 9,
    status: "scheduled",
    trial: { mode: "paid", priceRub: 900 },
  },
  {
    id: "chess-start",
    dayIndex: 1,
    startTime: "12:00",
    endTime: "13:00",
    branchId: "kurskaya",
    groupName: "Шахматы: первый ход",
    ageLabel: "от 6 лет",
    teachers: ["Павел Миронов"],
    booked: 6,
    status: "scheduled",
    trial: { mode: "free" },
  },
  {
    id: "science-lab",
    dayIndex: 1,
    startTime: "17:00",
    endTime: "18:30",
    branchId: "akademicheskaya",
    groupName: "Научная лаборатория",
    ageLabel: "9–12 лет",
    room: "Лаборатория 2",
    capacity: 8,
    booked: 8,
    status: "scheduled",
    trial: { mode: "paid", priceRub: 1_200 },
  },
  {
    id: "english-play",
    dayIndex: 2,
    startTime: "11:00",
    endTime: "12:00",
    branchId: "kurskaya",
    groupName: "English Play",
    ageLabel: "4–6 лет",
    room: "Зал 2",
    teachers: ["Елена Смирнова"],
    capacity: 12,
    booked: 5,
    status: "moved",
    movedFrom: "10:00",
    trial: { mode: "free" },
  },
  {
    id: "theatre",
    dayIndex: 2,
    startTime: "18:00",
    endTime: "19:30",
    branchId: "akademicheskaya",
    groupName: "Театральная студия",
    ageLabel: "7–10 лет",
    teachers: ["Нина Белова"],
    capacity: 14,
    booked: 10,
    status: "cancelled",
    trial: { mode: "paid", priceRub: 700 },
  },
  {
    id: "ceramics",
    dayIndex: 3,
    startTime: "10:30",
    endTime: "12:00",
    branchId: "akademicheskaya",
    groupName: "Керамика",
    ageLabel: "6–9 лет",
    room: "Мастерская",
    teachers: ["Ольга Рябова"],
    capacity: 7,
    booked: 2,
    status: "scheduled",
    trial: { mode: "paid", priceRub: 1_100 },
  },
  {
    id: "programming",
    dayIndex: 3,
    startTime: "17:30",
    endTime: "19:00",
    branchId: "kurskaya",
    groupName: "Программирование",
    ageLabel: "10–13 лет",
    room: "Компьютерный класс",
    teachers: ["Денис Котов"],
    capacity: 10,
    booked: 10,
    status: "scheduled",
    trial: { mode: "free" },
  },
  {
    id: "dance-kids",
    dayIndex: 4,
    startTime: "16:00",
    endTime: "17:00",
    branchId: "kurskaya",
    groupName: "Танцы Kids",
    ageLabel: "3–5 лет",
    room: "Большой зал",
    teachers: ["Алина Яковлева", "Софья Лебедева"],
    capacity: 16,
    booked: 15,
    status: "scheduled",
    trial: { mode: "paid", priceRub: 600 },
  },
  {
    id: "math-club",
    dayIndex: 4,
    startTime: "18:30",
    endTime: "19:30",
    branchId: "akademicheskaya",
    groupName: "Математический клуб",
    ageLabel: "от 8 лет",
    room: "Кабинет 4",
    teachers: ["Роман Егоров"],
    booked: 11,
    status: "scheduled",
    trial: { mode: "free" },
  },
  {
    id: "family-art",
    dayIndex: 5,
    startTime: "11:00",
    endTime: "12:30",
    branchId: "kurskaya",
    groupName: "Семейная арт-мастерская",
    ageLabel: "без ограничений",
    room: "Мастерская",
    teachers: ["Дарья Попова"],
    capacity: 18,
    booked: 7,
    status: "scheduled",
    trial: { mode: "paid", priceRub: 1_500 },
  },
  {
    id: "music-start",
    dayIndex: 5,
    startTime: "14:00",
    endTime: "15:00",
    branchId: "akademicheskaya",
    groupName: "Музыка с нуля",
    ageLabel: "5–8 лет",
    capacity: 9,
    booked: 4,
    status: "scheduled",
    trial: { mode: "free" },
  },
  {
    id: "architecture",
    dayIndex: 6,
    startTime: "12:00",
    endTime: "13:30",
    branchId: "kurskaya",
    groupName: "Архитектура для детей",
    ageLabel: "9–14 лет",
    room: "Зал 3",
    teachers: ["Максим Фролов"],
    capacity: 12,
    booked: 6,
    status: "scheduled",
    trial: { mode: "paid", priceRub: 1_000 },
  },
  {
    id: "public-speaking",
    dayIndex: 6,
    startTime: "16:30",
    endTime: "18:00",
    branchId: "akademicheskaya",
    groupName: "Уверенная речь",
    ageLabel: "11–15 лет",
    room: "Зал 1",
    teachers: ["Вера Крылова"],
    capacity: 10,
    booked: 1,
    status: "scheduled",
    trial: { mode: "free" },
  },
];

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getDemoWeek(weekOffset = 0) {
  const startDate = shiftIsoDate(DEMO_WEEK_START, weekOffset * 7);
  const dates = Array.from({ length: 7 }, (_, dayIndex) =>
    shiftIsoDate(startDate, dayIndex),
  );
  return {
    startDate,
    endDate: dates[6],
    dates,
    lessons: LESSON_TEMPLATES.map((lesson) => ({
      ...lesson,
      id: `${lesson.id}-w${weekOffset}`,
      date: dates[lesson.dayIndex],
    })),
  };
}

export function getBranch(branchId: BookingBranch["id"]) {
  return DEMO_BRANCHES.find((branch) => branch.id === branchId);
}

export function getAvailablePlaces(lesson: ScheduleLesson) {
  return lesson.capacity === undefined
    ? null
    : Math.max(lesson.capacity - lesson.booked, 0);
}

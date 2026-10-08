import { easternToday, easternDayBounds } from "./field-rules.js";

const WORKED = new Set([
  "Knocked",
  "No Answer",
  "Interested",
  "Not Interested",
  "Do Not Knock",
]);
export const OPEN_APPOINTMENT_STAGES = new Set([
  "Requested",
  "Scheduled",
  "Confirmed",
]);

/** Build once per data refresh, then use constant-time lookups during rendering. */
export function dashboardIndex(leads = [], reps = []) {
  const cities = new Map();
  for (const lead of leads) {
    const city = cities.get(lead.city) || { total: 0, mapped: 0 };
    city.total++;
    if (
      lead.lat != null &&
      lead.lng != null &&
      String(lead.lat).trim() !== "" &&
      String(lead.lng).trim() !== "" &&
      Number.isFinite(Number(lead.lat)) &&
      Number.isFinite(Number(lead.lng))
    )
      city.mapped++;
    cities.set(lead.city, city);
  }
  return {
    leads: new Map(leads.map((row) => [row.id, row])),
    reps: new Map(reps.map((row) => [row.id, row])),
    cities,
  };
}

export function dashboardSummary(
  { reps = [], appointments = [], activities = [], homes = [] },
  now = new Date(),
) {
  const { start, end } = easternDayBounds(easternToday(now));
  const today = (value) => {
    const time = new Date(value).getTime();
    return time >= start.getTime() && time < end.getTime();
  };
  return {
    worked: activities.filter(
      (row) => today(row.created_at) && WORKED.has(row.metadata?.to_status),
    ).length,
    apptToday: appointments.filter(
      (row) => today(row.scheduled_at) && row.stage !== "Cancelled",
    ).length,
    setters: reps.filter(
      (row) =>
        row.active && ["appointment_setter", "canvasser"].includes(row.role),
    ).length,
    sales: reps.filter((row) => row.active && row.role === "salesperson")
      .length,
    openHomes: homes.filter(
      (row) => !["Closed", "Completed", "Do Not Contact"].includes(row.status),
    ).length,
    newRequests: homes.filter((row) => row.status === "New").length,
    unassigned: appointments.filter(
      (row) => OPEN_APPOINTMENT_STAGES.has(row.stage) && !row.salesperson_id,
    ).length,
    overdue: appointments.filter(
      (row) =>
        OPEN_APPOINTMENT_STAGES.has(row.stage) &&
        row.scheduled_at &&
        new Date(row.scheduled_at) < now,
    ).length,
  };
}

export function upcomingAppointments(rows, now = new Date(), limit = 8) {
  return rows
    .filter(
      (row) =>
        OPEN_APPOINTMENT_STAGES.has(row.stage) &&
        row.scheduled_at &&
        new Date(row.scheduled_at) >= now,
    )
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, limit);
}

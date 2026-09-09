import type {
  WorkOrderCategory,
  WorkOrderUrgency,
} from "@/lib/work-orders/create";

export const CATEGORY_LABELS: Record<WorkOrderCategory, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "Heating & cooling",
  appliances: "Appliance",
  flooring: "Floors",
  painting: "Paint & walls",
  landscaping: "Yard & outdoors",
  security: "Locks & security",
  cleaning: "Cleaning",
  general: "General repair",
  other: "Something else",
};

export const URGENCY_LABELS: Record<WorkOrderUrgency, string> = {
  emergency: "Emergency — health or safety",
  urgent: "Urgent — needs attention soon",
  routine: "Routine",
};

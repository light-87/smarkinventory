import { HowToGuide } from "@/components/ui/how-to-guide";
import {
  ATTENDANCE_EMPLOYEE_SCENARIOS,
  ATTENDANCE_EMPLOYEE_STEPS,
  ATTENDANCE_OWNER_SCENARIOS,
  ATTENDANCE_OWNER_STEPS,
  PM_EMPLOYEE_SCENARIOS,
  PM_EMPLOYEE_STEPS,
  PM_OWNER_SCENARIOS,
  PM_OWNER_STEPS,
} from "./guide-content";

/**
 * components/guides/module-guides.tsx — one named guide per (module, role), so
 * a page renders the right one by name and never assembles content inline.
 *
 * Each carries its own localStorage key: hiding the attendance guide should
 * not also hide the projects one, and an owner dismissing theirs should not
 * affect what an employee sees on their own device.
 */

/** Owner's project-management guide (`/projects`, project overview). */
export function PmOwnerGuide() {
  return (
    <HowToGuide
      title="How Project Management works"
      storageKey="pm-guide-collapsed"
      steps={PM_OWNER_STEPS}
      scenarios={PM_OWNER_SCENARIOS}
    />
  );
}

/** Engineer's version, shown above their "My tasks" list. */
export function PmEmployeeGuide() {
  return (
    <HowToGuide
      title="How your tasks work"
      storageKey="pm-guide-employee-collapsed"
      steps={PM_EMPLOYEE_STEPS}
      scenarios={PM_EMPLOYEE_SCENARIOS}
      scenariosTitle="Questions people ask"
      defaultOpen={false}
    />
  );
}

/** Owner's attendance + comp-off guide (`/attendance`). */
export function AttendanceOwnerGuide() {
  return (
    <HowToGuide
      title="How attendance and comp-off work"
      storageKey="attendance-guide-owner-collapsed"
      steps={ATTENDANCE_OWNER_STEPS}
      scenarios={ATTENDANCE_OWNER_SCENARIOS}
    />
  );
}

/** Employee's attendance + comp-off guide (`/attendance`). */
export function AttendanceEmployeeGuide() {
  return (
    <HowToGuide
      title="How attendance and comp-off work"
      storageKey="attendance-guide-employee-collapsed"
      steps={ATTENDANCE_EMPLOYEE_STEPS}
      scenarios={ATTENDANCE_EMPLOYEE_SCENARIOS}
      scenariosTitle="Questions people ask"
      defaultOpen={false}
    />
  );
}

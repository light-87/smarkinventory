import type { GuideScenario, GuideStep } from "@/components/ui/how-to-guide";

/**
 * components/guides/guide-content.ts — the words in every in-app how-to panel,
 * in one file so they can be checked against the app's actual behaviour in a
 * single read.
 *
 * Two things drove this. Staff had no guidance anywhere: the only guide in the
 * app was owner-only and about project management, so an engineer had nothing
 * telling them how comp-off is earned or what a hold does to their task. And
 * the owner guide had drifted out of date, still describing time logging as
 * invisible and comp-off as hours the owner types in at approval.
 *
 * Written for readers who are not native English speakers and are usually on a
 * phone: short sentences, no jargon, and every step says what actually happens
 * so nobody has to click to find out.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Project management — owner
 * ──────────────────────────────────────────────────────────────────────────── */

export const PM_OWNER_STEPS: readonly GuideStep[] = [
  {
    title: "Create a project",
    body: "One project per client job. Add BOMs and documents from the tabs above.",
    outcome: "A new project card appears in the list. Nothing is shared with the client until you generate a portal link.",
  },
  {
    title: "Add tasks",
    body: "Break the work into tasks and assign engineers with estimated hours.",
    outcome: "Each assigned engineer sees the task under their “My tasks”, and the estimate is locked in for the efficiency comparison later.",
  },
  {
    title: "Engineers log time & submit",
    body: "Each engineer logs the hours they spend, then submits the task for your review.",
    outcome: "The task card shows their hours against the estimate, like “2h of 4h”. Open Manage to read every entry with its date and description.",
  },
  {
    title: "You mark it done",
    body: "Review submitted tasks and mark them done. Efficiency compares the estimate against the hours actually logged.",
    outcome: "Project progress goes up, the client portal reflects the new completion, and the engineer's efficiency score updates. 10 means they finished on estimate; above 10 means faster.",
  },
  {
    title: "Handle issues in Approvals",
    body: "Anyone can report a bug or request a change. Confirm it, dismiss it, or turn it into a new task.",
    outcome: "Confirm a bug and it counts against effectiveness. Accept a change request and it becomes a new task you assign. The client sees the outcome in their portal.",
  },
  {
    title: "Waiting on the client?",
    body: "Put a task on hold and send an email reminder from the task's Manage panel.",
    outcome: "The client sees “Awaiting your input” in amber and the task stops counting time. The engineer can still submit the work they have already done.",
  },
  {
    title: "Share progress",
    body: "Generate a read-only client link from the Manage tab. The client needs no login.",
    outcome: "They see tasks, schedule and documents, nothing else. Regenerating the link stops the old one working straight away.",
  },
];

export const PM_OWNER_SCENARIOS: readonly GuideScenario[] = [
  {
    q: "What if I reject a change request?",
    a: "No task is created and the client sees “Not taken up”. You can still accept a resubmitted one later.",
  },
  {
    q: "What if I dismiss a reported bug?",
    a: "It is marked reviewed with no change and counts against nobody's effectiveness. The reporter sees “Reviewed — no change”.",
  },
  {
    q: "What if I reassign a task mid-way?",
    a: "Logged hours stay with the task. The new engineer picks up from the current state and the estimate does not change.",
  },
  {
    q: "What if I regenerate the client link?",
    a: "The old link stops working immediately. Anyone still on it is locked out until you share the new one.",
  },
  {
    q: "What if I archive a project?",
    a: "It leaves the active list, its client link stops working, and it no longer counts in any dashboard total or filter. Nothing is deleted, so the Archived filter still shows it.",
  },
  {
    q: "Why does a task show 0 actual hours when the employee logged some?",
    a: "Hours logged while the task was on hold are left out of the efficiency comparison, because that time was spent waiting on the client, not working.",
  },
];

/* ────────────────────────────────────────────────────────────────────────────
 * Project management — employee
 * ──────────────────────────────────────────────────────────────────────────── */

export const PM_EMPLOYEE_STEPS: readonly GuideStep[] = [
  {
    title: "Find your work",
    body: "Everything assigned to you is on this page, across every project. The newest tasks are at the top.",
    outcome: "Each card shows the project, the task, and your hours against the estimate the owner set, like “2h of 4h”.",
  },
  {
    title: "Log your time",
    body: "Tap “Log time”, pick the date, enter the hours and write one line about what you did.",
    outcome: "You get a confirmation, the card total goes up straight away, and your entry appears under “Time logged” in the same panel.",
  },
  {
    title: "Submit when the task is finished",
    body: "Open Manage and tap “Submit for review”. Log your last hours before you do.",
    outcome: "The task moves to “Submitted” and goes to the owner. You cannot log more time on it until the owner sends it back or marks it done.",
  },
  {
    title: "Stuck waiting on the client?",
    body: "Open Manage and tap “Put on hold (awaiting client)”.",
    outcome: "Time logging pauses so the wait is not counted against your hours. You can still submit. Only the owner can mark the client's input as received.",
  },
  {
    title: "Something wrong with the work?",
    body: "Use “Report an issue” in Manage. Choose Bug for a defect, or Change request if the client wants something different.",
    outcome: "The owner is notified and decides. A confirmed bug affects the effectiveness score; a change request can become a new task.",
  },
  {
    title: "Check your scores",
    body: "The three tiles at the top of this page are yours, counted over the tasks that are already done.",
    outcome: "Efficiency compares the estimate against your logged hours: 10 means you finished on estimate, above 10 means faster. Effectiveness starts at 5 and drops only if confirmed bugs pile up.",
  },
];

export const PM_EMPLOYEE_SCENARIOS: readonly GuideScenario[] = [
  {
    q: "I logged hours but nothing changed?",
    a: "Pull the page down to refresh. If the total on the card still does not match, tell the owner rather than logging the same hours again.",
  },
  {
    q: "I entered the wrong hours.",
    a: "Ask the owner. Only they can correct a time entry, and they can log the right hours on your behalf.",
  },
  {
    q: "Why can't I log time on this task?",
    a: "Either it is on hold waiting for the client, or it has already been submitted or marked done.",
  },
  {
    q: "Do I need to log time every day?",
    a: "Log it the same day if you can. The date is yours to choose, so you can still enter yesterday's work.",
  },
];

/* ────────────────────────────────────────────────────────────────────────────
 * Attendance and comp-off — owner
 * ──────────────────────────────────────────────────────────────────────────── */

export const ATTENDANCE_OWNER_STEPS: readonly GuideStep[] = [
  {
    title: "Set the company holidays",
    body: "Use the Holidays tab for festival dates and the weekly off.",
    outcome: "Everyone sees it on their dashboard under “Upcoming holidays” as soon as you save, and the day is marked on every attendance calendar.",
  },
  {
    title: "Approve extra work",
    body: "Staff claim extra hours or a worked holiday. Both land in Approvals.",
    outcome: "Approving converts it to comp-off in days: under 4 hours gives half a day, 4 hours or more gives a full day, and a worked holiday gives a full day.",
  },
  {
    title: "Approve leave",
    body: "Compensatory leave spends the balance the employee has already earned. Personal and sick leave do not.",
    outcome: "You approve or reject, nothing to calculate. The panel shows what the leave costs and what they have banked, and the balance moves only when you approve.",
  },
  {
    title: "Set opening balances",
    body: "Open Employees, pick a person, and set their comp-off balance under Comp-off.",
    outcome: "The balance jumps to the figure you type, recorded as an adjustment with your name and reason on it. Do this once for balances carried over from before the app.",
  },
  {
    title: "Turn on the yearly entitlement",
    body: "On the same panel, switch on the yearly comp-off for staff who qualify.",
    outcome: "They receive 16 days each 1 January automatically. Staff without it still earn comp-off from extra hours and holiday work.",
  },
  {
    title: "Correct a day",
    body: "Open any date on an employee's calendar to fix a missed check-in or check-out.",
    outcome: "The day's record is updated. The month tally at the top of their page recounts immediately.",
  },
];

export const ATTENDANCE_OWNER_SCENARIOS: readonly GuideScenario[] = [
  {
    q: "What happens to comp-off on 1 January?",
    a: "Unused days are cleared and the yearly entitlement is granted again to whoever has it switched on. Days earned in late December are cleared too, so approve and let people use them before year end.",
  },
  {
    q: "Someone's balance looks wrong.",
    a: "Open their Comp-off panel. The history lists every movement with its reason, so you can see what changed it. Correct it by setting the balance to the right figure.",
  },
  {
    q: "Can an employee go into negative comp-off?",
    a: "No. A leave that costs more than they have banked is refused, both when they ask and when you approve.",
  },
  {
    q: "I approved something by mistake.",
    a: "Reject it instead and the days go back. The ledger keeps one entry per request, so switching your decision never double counts.",
  },
];

/* ────────────────────────────────────────────────────────────────────────────
 * Attendance and comp-off — employee
 * ──────────────────────────────────────────────────────────────────────────── */

export const ATTENDANCE_EMPLOYEE_STEPS: readonly GuideStep[] = [
  {
    title: "Mark in and out",
    body: "Tap “Mark present” when you start and “Mark out” when you leave.",
    outcome: "Today turns green on your calendar. Forgot one? Ask the owner, they can correct any day.",
  },
  {
    title: "Claim extra hours",
    body: "Worked beyond your normal day? Enter the date and how many hours, and send it for approval.",
    outcome: "Once the owner approves, under 4 hours becomes half a comp-off day and 4 hours or more becomes a full day.",
  },
  {
    title: "Worked on a holiday?",
    body: "Claim that date as comp work instead of extra hours.",
    outcome: "Approved, it gives you one full comp-off day.",
  },
  {
    title: "Take your comp-off",
    body: "Request leave with the reason set to Compensatory. For a single date you can tick “Half day”.",
    outcome: "The form shows what the leave costs before you send it: half a day costs 0.5, a full day costs 1, and each extra day costs 1 more.",
  },
  {
    title: "Watch your balance",
    body: "Your comp-off balance sits at the top of the leave card, in days.",
    outcome: "It goes up when the owner approves extra work, and down when they approve compensatory leave. Never in between.",
  },
];

export const ATTENDANCE_EMPLOYEE_SCENARIOS: readonly GuideScenario[] = [
  {
    q: "Why was my leave request refused?",
    a: "Compensatory leave can only use days you have already earned and the owner has approved. Personal or sick leave does not touch the balance.",
  },
  {
    q: "I claimed extra hours but my balance has not moved.",
    a: "It moves only after the owner approves. Until then the claim sits as pending.",
  },
  {
    q: "Do my comp-off days expire?",
    a: "Yes. Unused days are cleared every 1 January, so use them before the year ends.",
  },
  {
    q: "I forgot to mark out yesterday.",
    a: "Tell the owner. They can set the correct times on any past day from your calendar.",
  },
];

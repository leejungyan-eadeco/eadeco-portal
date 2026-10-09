"use client";

// The Guide button in a page's header starts a short tour of that page (driver.js): it highlights the real
// buttons one by one, with Next / Back. The last step offers the full written guide (src/guide/*.mdx) in a
// side panel, so nobody leaves what they are doing. Only the pages everyone uses have one: admin settings are set up by IT.
import { useState } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { Question } from "@phosphor-icons/react";
import Overview from "@/guide/overview.mdx";
import RecurringInvoices from "@/guide/recurring-invoices.mdx";
import Runs from "@/guide/runs.mdx";
import { Dialog } from "./dialog";

const step = (element: string, title: string, description: string, side: "top" | "bottom" | "left" | "right" = "bottom"): DriveStep => ({
  element,
  popover: { title, description, side, align: "start" },
});

const guides = {
  overview: {
    title: "Overview",
    Content: Overview,
    tour: [
      step('[data-tour="stats"]', "At a glance", "What is due this week, anything that failed, and how many recurring invoices are running."),
      step('[data-tour="upcoming"]', "Coming up", "Recurring invoices the portal will create in NAV in the next 14 days, soonest first.", "top"),
      step('[data-tour="attention"]', "Needs attention", "Drafts NAV did not accept and that are still not created. Open Activity to see why.", "top"),
      step('aside a[href="/automation/recurring-invoices"]', "Recurring invoices", "Set up the invoices that repeat. This is where most work happens.", "right"),
      step('aside a[href="/activity"]', "Activity", "Every run of every automation, with the NAV number or what went wrong.", "right"),
    ],
  },
  "recurring-invoices": {
    title: "Recurring invoices",
    Content: RecurringInvoices,
    tour: [
      step('[data-tour="new-invoice"]', "New recurring invoice", "Pick the company, customer or vendor, how often it repeats, and the lines, the same way as a NAV invoice.", "left"),
      step('[role="tablist"]', "Sales or purchase", "Show all, or only sales or purchase invoices."),
      step('[data-tour="search"]', "Search", "Find by company, customer, vendor or reference."),
      step('[data-tour="filters"]', "Filters", "Narrow by company or status. You can pick several values."),
      step('[aria-label^="View "]', "View", "Everything about one invoice: schedule, lines and total.", "left"),
      step('[aria-label^="Edit "]', "Edit", "Change it. The next date is worked out again.", "left"),
      step('[aria-label^="Run now"]', "Run now", "Creates today's draft in NAV straight away. If today's draft already exists, nothing new is made.", "left"),
      step('[aria-label^="Pause "], [aria-label^="Resume "]', "Pause or resume", "Stops it for a while without deleting it.", "left"),
      step('[aria-label^="Delete "]', "Delete", "Removes it from the portal. Drafts already in NAV stay in NAV.", "left"),
    ],
  },
  runs: {
    title: "Activity",
    Content: Runs,
    tour: [
      step('[data-tour="search"]', "Search", "Find runs by company, customer, vendor or NAV document number."),
      step('[data-tour="filters"]', "Filters", "Show only one company, or only Created or Failed runs."),
      step('[data-tour="table"]', "Each run", "When it ran and who started it, the result, and the NAV draft number or what went wrong.", "top"),
      step('[aria-label^="View run"]', "View", "The full details, including NAV's whole message when a run failed.", "left"),
    ],
  },
};
export type GuideKey = keyof typeof guides;

// Text styled with the portal's own colours; works in light and dark mode through the tokens.
const prose =
  "prose prose-sm max-w-none text-ink-2 prose-headings:font-semibold prose-headings:text-ink prose-h2:mt-6 prose-h2:text-base prose-h3:text-sm prose-p:leading-relaxed prose-strong:text-ink prose-a:text-accent-ink prose-li:my-0.5 prose-li:marker:text-ink-3 prose-code:rounded prose-code:bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-ink prose-code:before:content-none prose-code:after:content-none prose-table:text-sm prose-th:text-ink prose-td:text-ink-2";

export function GuideButton({ guide }: { guide: GuideKey }) {
  const [reading, setReading] = useState(false);
  const { title, Content, tour } = guides[guide];

  const start = () => {
    // Steps whose element is not on screen (e.g. no rows yet) are left out.
    const steps = tour.filter((s) => document.querySelector(s.element as string));
    if (steps.length === 0) return setReading(true);
    const d = driver({
      steps,
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      popoverClass: "portal-tour",
      stagePadding: 6,
      stageRadius: 10,
      onPopoverRender: (popover, { state }) => {
        if (state.activeIndex !== steps.length - 1) return;
        const more = document.createElement("button");
        more.textContent = "Read the full guide";
        more.className = "portal-tour-more";
        more.onclick = () => {
          d.destroy();
          setReading(true);
        };
        popover.footerButtons.prepend(more);
      },
    });
    d.drive();
  };

  return (
    <>
      <button data-tour="guide" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-subtle hover:text-ink" onClick={start}>
        <Question size={16} /> Guide
      </button>
      {reading && (
        <Dialog open variant="sheet" onClose={() => setReading(false)} title={`Guide: ${title}`}>
          <div className={prose}>
            <Content />
          </div>
        </Dialog>
      )}
    </>
  );
}

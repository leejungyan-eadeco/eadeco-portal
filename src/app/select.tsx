"use client";

import { useId } from "react";
import { Check } from "@phosphor-icons/react";
import ReactSelect, { type ClassNamesConfig } from "react-select";
import CreatableSelect from "react-select/creatable";

// search: extra text that typing also matches (e.g. email, department) without showing it in the list.
export type SelectOption = { value: string; label: string; search?: string };

const matches = (o: { label: string; data: SelectOption }, input: string) =>
  `${o.label} ${o.data.search ?? ""}`.toLowerCase().includes(input.trim().toLowerCase());

// Shared look for single and multi selects.
const classNames = (compact: boolean): ClassNamesConfig<SelectOption, boolean> => ({
  control: ({ isFocused, isDisabled }) =>
    `${compact ? "min-h-[34px] rounded-md px-2" : "min-h-[38px] rounded-lg px-3"} border text-sm transition-colors ${
      isDisabled ? "cursor-not-allowed border-line-strong bg-subtle text-ink-3" : isFocused ? "border-accent bg-surface ring-2 ring-accent/25" : "border-line-strong bg-surface hover:border-ink-3"
    }`,
  valueContainer: () => "gap-1",
  placeholder: () => "min-w-0 truncate text-ink-3",
  singleValue: () => "text-ink",
  input: () => "text-ink",
  indicatorsContainer: () => "gap-0.5 text-ink-3",
  clearIndicator: () => "rounded p-0.5 hover:bg-subtle hover:text-ink",
  dropdownIndicator: () => "p-0.5",
  indicatorSeparator: () => "hidden",
  // Lines grid (compact): the list is as wide as its column so it never runs off the screen; elsewhere at least 16rem.
  menu: () => `z-50 mt-1 ${compact ? "min-w-full" : "min-w-[16rem]"} overflow-hidden rounded-lg border border-line bg-surface shadow-[0_12px_32px_rgb(28_25_23/0.14)]`,
  menuList: () => "max-h-72 py-1",
  option: ({ isFocused, isSelected }) =>
    `cursor-pointer px-3 py-2 text-sm ${isSelected ? "bg-accent-soft font-medium text-ink" : isFocused ? "bg-subtle text-ink" : "text-ink"}`,
  noOptionsMessage: () => "px-3 py-2 text-sm text-ink-3",
});

// Searchable dropdown used for every select in the portal (type to filter by code or name).
// menuPosition="fixed" keeps the menu inside the <dialog> top layer and outside scroll containers such as the lines grid.
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
  clearable = false,
  compact = false,
  label,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean; // shows an x to empty the field (for optional fields)
  compact?: boolean; // lines grid size
  label: string; // accessible name
}) {
  const id = useId();
  return (
    <ReactSelect<SelectOption>
      unstyled
      instanceId={id}
      aria-label={label}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o?.value ?? "")}
      // Narrow boxes show just the code (e.g. EPP30001); the open list still shows code and name.
      formatOptionLabel={compact ? (o, { context }) => (context === "value" && o.value && o.label.startsWith(`${o.value},`) ? o.value : o.label) : undefined}
      isDisabled={disabled}
      isClearable={clearable}
      placeholder={placeholder}
      menuPosition="fixed"
      menuPlacement="auto"
      filterOption={matches}
      noOptionsMessage={() => "No matches"}
      classNames={classNames(compact)}
    />
  );
}

// Several values at once, for table filters. Shows a summary ("2 statuses") instead of chips, so the box keeps its size.
export function MultiSelect({ value, options, onChange, noun, label }: { value: string[]; options: SelectOption[]; onChange: (value: string[]) => void; noun: string; label: string }) {
  const id = useId();
  const picked = options.filter((o) => value.includes(o.value));
  const summary = value.length === 0 ? `All ${noun}` : value.length === 1 ? (picked[0]?.value ?? value[0]) : `${value.length} ${noun}`;
  return (
    <ReactSelect<SelectOption, true>
      unstyled
      isMulti
      instanceId={id}
      aria-label={label}
      options={options}
      value={picked}
      onChange={(os) => onChange(os.map((o) => o.value))}
      isClearable
      controlShouldRenderValue={false}
      hideSelectedOptions={false}
      closeMenuOnSelect={false}
      // Picked values show as one pill, cut short on one line (full name on hover) so long company names don't wrap.
      placeholder={
        value.length ? (
          <span title={picked.map((o) => o.label).join(", ")} className="inline-flex max-w-full rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink">
            <span className="min-w-0 truncate">{summary}</span>
          </span>
        ) : (
          summary
        )
      }
      menuPosition="fixed"
      menuPlacement="auto"
      noOptionsMessage={() => "No matches"}
      formatOptionLabel={(o, { context, selectValue }) =>
        context === "menu" ? (
          <span className="flex items-center gap-2.5">
            <span className={`grid size-4 shrink-0 place-items-center rounded border ${selectValue.some((s) => s.value === o.value) ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface"}`}>
              {selectValue.some((s) => s.value === o.value) && <Check size={11} weight="bold" />}
            </span>
            {o.label}
          </span>
        ) : (
          o.label
        )
      }
      classNames={{ ...classNames(false), option: ({ isFocused }) => `cursor-pointer px-3 py-2 text-sm text-ink ${isFocused ? "bg-subtle" : ""}` }}
    />
  );
}

// Several free-text values shown as chips (e.g. payment types). Suggests `options`; anything else can be typed and added.
export function TagSelect({ value, options, onChange, label, placeholder = "Pick or type", disabled = false }: { value: string[]; options: string[]; onChange: (value: string[]) => void; label: string; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  const all = [...new Set([...options, ...value])].filter(Boolean).map((v) => ({ value: v, label: v }));
  return (
    <CreatableSelect<SelectOption, true>
      unstyled
      isMulti
      instanceId={id}
      aria-label={label}
      options={all}
      value={all.filter((o) => value.includes(o.value))}
      onChange={(os) => onChange(os.map((o) => o.value.trim()).filter(Boolean))}
      isDisabled={disabled}
      formatCreateLabel={(input) => `Add "${input}"`}
      placeholder={placeholder}
      menuPosition="fixed"
      menuPlacement="auto"
      noOptionsMessage={() => "Type a payment type to add it"}
      classNames={{
        ...classNames(true),
        multiValue: () => "flex items-center gap-1 rounded border border-line bg-subtle py-0.5 pl-1.5 pr-0.5 text-xs text-ink",
        // Show the whole value: payment types like "TNG Card" and "TNG Seamless" differ only at the end.
        multiValueLabel: () => "whitespace-nowrap",
        multiValueRemove: () => "rounded px-0.5 text-ink-3 hover:bg-bad-soft hover:text-bad",
      }}
    />
  );
}

import type { KeyboardEvent, Ref } from "react";

export interface CustomDropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  variant?: "action";
}

interface DropdownTriggerProps {
  ariaDescribedBy?: string;
  ariaLabel?: string;
  disabled: boolean;
  invalid: boolean;
  listboxId: string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  open: boolean;
  placeholder: string;
  required: boolean;
  selectedLabel?: string;
  triggerId: string;
  triggerRef: Ref<HTMLButtonElement>;
}

export function DropdownTrigger({
  ariaDescribedBy,
  ariaLabel,
  disabled,
  invalid,
  listboxId,
  onClick,
  onKeyDown,
  open,
  placeholder,
  required,
  selectedLabel,
  triggerId,
  triggerRef,
}: DropdownTriggerProps) {
  return (
    <button
      aria-controls={open ? listboxId : undefined}
      aria-describedby={ariaDescribedBy}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      aria-required={required || undefined}
      className="custom-dropdown-trigger"
      disabled={disabled}
      id={triggerId}
      onClick={onClick}
      onKeyDown={onKeyDown}
      ref={triggerRef}
      role="combobox"
      type="button"
    >
      <span className={selectedLabel !== undefined ? undefined : "custom-dropdown-placeholder"}>
        {selectedLabel ?? placeholder}
      </span>
      <svg aria-hidden="true" className="custom-dropdown-chevron" viewBox="0 0 16 16" fill="none">
        <path d="m4 6 4 4 4-4" />
      </svg>
    </button>
  );
}

interface DropdownOptionsListProps {
  ariaLabel?: string;
  id: string;
  normalizedValue: string;
  onChoose: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onOptionRef: (index: number, element: HTMLButtonElement | null) => void;
  options: readonly CustomDropdownOption[];
}

export function DropdownOptionsList({
  ariaLabel,
  id,
  normalizedValue,
  onChoose,
  onKeyDown,
  onOptionRef,
  options,
}: DropdownOptionsListProps) {
  return (
    <div
      aria-label={ariaLabel ?? "Choose an option"}
      className="custom-dropdown-menu"
      id={id}
      onKeyDown={onKeyDown}
      role="listbox"
      tabIndex={-1}
    >
      {options.map((option, index) => (
        <button
          aria-selected={normalizedValue === option.value}
          className={`custom-dropdown-option${option.variant === "action" ? " custom-dropdown-option-action" : ""}`}
          disabled={option.disabled}
          id={`${id}-option-${index}`}
          key={option.value}
          onClick={() => onChoose(option.value)}
          ref={(element) => onOptionRef(index, element)}
          role="option"
          tabIndex={-1}
          type="button"
        >
          <span>{option.label}</span>
          {normalizedValue === option.value ? (
            <span aria-hidden="true" className="custom-dropdown-check">
              ✓
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

interface DropdownNativeSelectProps {
  disabled: boolean;
  name?: string;
  normalizedValue: string;
  onChange: (value: string) => void;
  onInvalid: () => void;
  options: readonly CustomDropdownOption[];
  placeholder: string;
  required: boolean;
}

export function DropdownNativeSelect({
  disabled,
  name,
  normalizedValue,
  onChange,
  onInvalid,
  options,
  placeholder,
  required,
}: DropdownNativeSelectProps) {
  return (
    <select
      aria-hidden="true"
      className="custom-dropdown-native"
      disabled={disabled}
      name={name}
      onChange={(event) => onChange(event.target.value)}
      onInvalid={(event) => {
        event.preventDefault();
        onInvalid();
      }}
      required={required}
      tabIndex={-1}
      value={normalizedValue}
    >
      <option disabled value="">
        {placeholder}
      </option>
      {options.map((option) => (
        <option disabled={option.disabled} key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

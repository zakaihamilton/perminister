"use client";

import { Select } from "panel-frame-ui";

export interface CustomDropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  variant?: "action";
}

interface CustomDropdownProps {
  options: readonly CustomDropdownOption[];
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  onValueChange?: (value: string) => void;
}

export function CustomDropdown({
  options,
  id,
  name,
  value,
  defaultValue = "",
  placeholder = "Choose an option",
  required = false,
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  onValueChange,
}: CustomDropdownProps) {
  return (
    <Select
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      className={`custom-dropdown ${className}`.trim()}
      defaultValue={defaultValue}
      disabled={disabled}
      id={id}
      name={name}
      onValueChange={onValueChange}
      options={options.map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
        kind: option.variant,
      }))}
      placeholder={placeholder}
      required={required}
      value={value}
    />
  );
}

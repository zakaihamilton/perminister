"use client";

import { useId } from "react";
import {
  DropdownNativeSelect,
  DropdownOptionsList,
  DropdownTrigger,
  type CustomDropdownOption,
} from "@/components/custom-dropdown-parts";
import { useCustomDropdownController } from "@/components/use-custom-dropdown-controller";

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
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;
  const {
    rootRef,
    triggerRef,
    invalid,
    open,
    selectedOption,
    normalizedValue,
    toggleMenu,
    handleTriggerKeyDown,
    handleListboxKeyDown,
    handleNativeChange,
    handleNativeInvalid,
    setOptionRef,
    choose,
    closeMenu,
  } = useCustomDropdownController({ options, value, defaultValue, onValueChange });

  return (
    <div
      className={`custom-dropdown${className ? ` ${className}` : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closeMenu();
        }
      }}
      ref={rootRef}
    >
      <DropdownTrigger
        ariaDescribedBy={ariaDescribedBy}
        ariaLabel={ariaLabel}
        disabled={disabled}
        invalid={invalid}
        listboxId={listboxId}
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
        open={open}
        placeholder={placeholder}
        required={required}
        selectedLabel={selectedOption?.label}
        triggerId={triggerId}
        triggerRef={triggerRef}
      />
      {open ? (
        <DropdownOptionsList
          ariaLabel={ariaLabel}
          id={listboxId}
          normalizedValue={normalizedValue}
          onChoose={choose}
          onKeyDown={handleListboxKeyDown}
          onOptionRef={setOptionRef}
          options={options}
        />
      ) : null}
      <DropdownNativeSelect
        disabled={disabled}
        name={name}
        normalizedValue={normalizedValue}
        onChange={handleNativeChange}
        onInvalid={handleNativeInvalid}
        options={options}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

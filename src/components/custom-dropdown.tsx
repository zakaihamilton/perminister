"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface CustomDropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
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
  onValueChange,
}: CustomDropdownProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const [activeValue, setActiveValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const currentValue = value ?? uncontrolledValue;
  const selectedOption = options.find((option) => option.value === currentValue);
  const normalizedValue = selectedOption ? currentValue : "";
  const enabledOptions = options.filter((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    const activeIndex = options.findIndex((option) => option.value === activeValue);
    const firstEnabledIndex = options.findIndex((option) => !option.disabled);
    optionRefs.current[activeIndex >= 0 ? activeIndex : firstEnabledIndex]?.focus();

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [activeValue, open, options]);

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  function openMenu() {
    const selected = options.find((option) => option.value === normalizedValue && !option.disabled);
    setActiveValue(selected?.value ?? enabledOptions[0]?.value ?? "");
    setOpen(true);
  }

  function choose(valueToChoose: string) {
    const option = options.find((item) => item.value === valueToChoose);
    if (!option || option.disabled) return;
    if (value === undefined) setUncontrolledValue(valueToChoose);
    setInvalid(false);
    onValueChange?.(valueToChoose);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function focusOption(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    setActiveValue(option.value);
    optionRefs.current[index]?.focus();
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openMenu();
    }
  }

  function handleListboxKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const activeIndex = optionRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    const move = (direction: 1 | -1) => {
      if (!options.length) return;
      const start = activeIndex < 0 ? (direction === 1 ? -1 : 0) : activeIndex;
      for (let offset = 1; offset <= options.length; offset += 1) {
        const index = (start + direction * offset + options.length * 2) % options.length;
        if (!options[index].disabled) {
          focusOption(index);
          break;
        }
      }
    };

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const index =
        event.key === "Home"
          ? options.findIndex((option) => !option.disabled)
          : options.findLastIndex((option) => !option.disabled);
      focusOption(index);
      return;
    }
    if (
      event.key.length !== 1 ||
      event.key === " " ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    typeaheadRef.current += event.key.toLocaleLowerCase();
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadRef.current = "";
    }, 600);
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (Math.max(activeIndex, -1) + offset) % options.length;
      if (
        !options[index].disabled &&
        options[index].label.toLocaleLowerCase().startsWith(typeaheadRef.current)
      ) {
        event.preventDefault();
        focusOption(index);
        break;
      }
    }
  }

  return (
    <div
      className={`custom-dropdown${className ? ` ${className}` : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      ref={rootRef}
    >
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        className="custom-dropdown-trigger"
        disabled={disabled}
        id={triggerId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className={selectedOption ? undefined : "custom-dropdown-placeholder"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg aria-hidden="true" className="custom-dropdown-chevron" viewBox="0 0 16 16" fill="none">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div
          aria-label={ariaLabel ?? "Choose an option"}
          className="custom-dropdown-menu"
          id={listboxId}
          onKeyDown={handleListboxKeyDown}
          role="listbox"
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <button
              aria-selected={normalizedValue === option.value}
              className="custom-dropdown-option"
              disabled={option.disabled}
              id={`${listboxId}-option-${index}`}
              key={option.value}
              onClick={() => choose(option.value)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              role="option"
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
      ) : null}
      <select
        aria-hidden="true"
        className="custom-dropdown-native"
        disabled={disabled}
        name={name}
        onChange={(event) => {
          if (value === undefined) setUncontrolledValue(event.target.value);
          onValueChange?.(event.target.value);
        }}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          triggerRef.current?.focus();
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
    </div>
  );
}

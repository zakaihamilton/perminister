import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useCloseOnOutsidePointerDown } from "@/components/use-close-on-outside-pointer-down";
import type { CustomDropdownOption } from "@/components/custom-dropdown-parts";

export function useCustomDropdownController({
  options,
  value,
  defaultValue,
  onValueChange,
}: {
  options: readonly CustomDropdownOption[];
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
}) {
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
  }, [activeValue, open, options]);

  useCloseOnOutsidePointerDown(open, rootRef, setOpen);

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

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openMenu();
    }
  }

  function handleListboxKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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

  function handleNativeChange(nextValue: string) {
    if (value === undefined) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  }

  function handleNativeInvalid() {
    setInvalid(true);
    triggerRef.current?.focus();
  }

  return {
    rootRef,
    triggerRef,
    optionRefs,
    open,
    invalid,
    selectedOption,
    normalizedValue,
    toggleMenu: () => (open ? setOpen(false) : openMenu()),
    handleTriggerKeyDown,
    handleListboxKeyDown,
    handleNativeChange,
    handleNativeInvalid,
    setOptionRef: (index: number, element: HTMLButtonElement | null) => {
      optionRefs.current[index] = element;
    },
    choose,
    closeMenu: () => setOpen(false),
  };
}

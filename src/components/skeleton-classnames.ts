import styles from "./skeletons.module.css";

const classMap = styles as Record<string, string>;

export function skeletonClasses(
  ...classNames: Array<string | false | null | undefined>
): string {
  return classNames
    .flatMap((className) => (typeof className === "string" ? className.split(/\s+/) : []))
    .filter(Boolean)
    .map((className) => classMap[className])
    .filter(Boolean)
    .join(" ");
}

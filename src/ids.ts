import { ulid } from "ulid";

/** Sortable unique id used for every bus event (`Envelope.id`). */
export function newId(): string {
  return ulid();
}

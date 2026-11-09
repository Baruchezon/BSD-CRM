// Maps a signed-agreement payload onto CRM columns.
// Seller legal name never goes into the listing name (businesses.internal_name / leads.business_name).

export type AgreementTable = "businesses" | "leads" | "brokers";
export type FieldErrorCode = "invalid_id_number" | "missing_legal_name" | "missing_address";

export function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

// Israeli company (ח.פ.) and osek murshe numbers are 9 digits. Separators are ignored.
export function israeliRegistrationNumber(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

export function entityKindLabel(value: unknown): "ח.פ." | "עוסק מורשה" | null {
  const compact = String(value ?? "").replace(/[\s."'״׳`]/g, "");
  if (!compact) return null;
  if (compact === "osek" || compact === "osek_murshe" || compact.includes("עוסק")) return "עוסק מורשה";
  if (
    compact === "company" ||
    compact === "hp" ||
    compact.includes("חפ") ||
    compact.includes("חברה") ||
    compact.includes("בעמ")
  ) return "ח.פ.";
  return null;
}

export function isSellerAgreement(tableName: string, leadType: string | null): boolean {
  return tableName === "businesses" || (tableName === "leads" && leadType === "seller");
}

const LISTING_KEYS = [
  "internal_name",
  "anonymous_name",
  "anon_display_name",
  "anon_presentation_name",
  "business_name",
  "notes",
  "note_text",
  "short_description",
] as const;

export function agreementCrmUpdate(input: {
  tableName: AgreementTable;
  leadType: string | null;
  details: Record<string, unknown>;
  signerName: string;
  signerEmail: string;
}): { update: Record<string, unknown> } | { error: FieldErrorCode } {
  const { tableName, leadType, details } = input;
  const signerName = clip(input.signerName, 200);
  const signerEmail = clip(input.signerEmail, 250);

  if (isSellerAgreement(tableName, leadType)) {
    const legal = clip(details.business_name ?? details.legal_name, 250);
    const address = clip(details.address, 500);
    const idNumber = israeliRegistrationNumber(details.id_number);
    if (!legal) return { error: "missing_legal_name" };
    if (!idNumber) return { error: "invalid_id_number" };
    if (!address) return { error: "missing_address" };
    const city = clip(details.city, 120);
    const kind = entityKindLabel(details.id_kind ?? details.entity);
    const update: Record<string, unknown> = {
      id_number: idNumber,
      address,
    };
    if (city) update.city = city;
    if (kind && (tableName === "businesses" || tableName === "leads")) update.entity_type = kind;
    if (tableName === "businesses") {
      update.legal_name = legal;
      if (signerName) update.owner_name = signerName;
      if (signerEmail) update.owner_email = signerEmail;
    } else {
      update.company = legal;
      if (signerName) update.full_name = signerName;
      if (signerEmail) update.email = signerEmail;
    }
    for (const key of LISTING_KEYS) delete update[key];
    return { update };
  }

  const update: Record<string, unknown> = {};
  const idNumber = clip(details.id_number, 80);
  const entity = clip(details.entity, tableName === "leads" ? 200 : 120);
  const address = clip(details.address, 500);
  const city = clip(details.city, 120);
  if (tableName === "leads") {
    if (signerName) update.full_name = signerName;
    if (idNumber) update.id_number = idNumber;
    if (entity) update.company = entity;
    if (signerEmail) update.email = signerEmail;
    if (address) update.address = address;
    if (city) update.city = city;
  } else {
    if (signerName) update.full_name = signerName;
    if (signerEmail) update.email = signerEmail;
    if (address) update.address = address;
    if (city) update.city = city;
  }
  return { update };
}

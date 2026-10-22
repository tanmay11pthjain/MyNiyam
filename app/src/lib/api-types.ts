// The API contract shared by route handlers and the client. See DOCUMENTATION.md for the full list.
import type { FormField } from "./forms";

export type SanghCard = { id: string; name: string; city: string; logoUrl: string | null; joinCode: string };

export type ClassItem = { id: string; name: string; nameHi: string | null; hidden?: boolean; ageMin?: number | null; ageMax?: number | null };

export type Profile = {
  id: string;
  name: string;
  relation: "self" | "child";
  role: "student" | "volunteer" | "admin";
  classId: string | null;
  setupDone: boolean;
  photoUrl?: string | null;
  answers?: Record<string, string | number>;
  /** Required questions not answered yet (the admin added them after this person joined). */
  missing?: string[];
};

export type Me = {
  phone: string; // masked
  sangh: SanghCard;
  classes: ClassItem[];
  formFields: FormField[];
  profiles: Profile[];
  activeProfileId: string | null;
};

export type OtpChannel = "whatsapp" | "sms";

export type SendOtpResponse = { channel: OtpChannel; resendAfterSec: number; expiresInSec: number; simulated: boolean };

export type VerifyOtpResponse =
  | { status: "joined" }            // new account created in the chosen sangh
  | { status: "logged_in" };        // existing account, same sangh (or plain login)

/** Every error body looks like this. `error` is a stable code; the UI turns it into words. */
export type ApiError = {
  error:
    | "bad_request" | "invalid_phone" | "invalid_code" | "code_not_found" | "too_many_requests"
    | "send_failed" | "wrong_code" | "code_expired" | "no_code" | "other_sangh" | "not_member"
    | "unauthorized" | "not_found" | "consent_required" | "self_exists" | "profile_limit"
    | "invalid_answers" | "invalid_class" | "forbidden" | "too_large" | "server_error"
    // admin panel
    | "joins_closed" | "class_has_members" | "invalid_field" | "duplicate_key" | "no_sangh" | "unsupported_type"
    | "log_window_closed" | "demo_only" | "already_admin" | "already_member" | "same_number";
  retryAfterSec?: number;
  attemptsLeft?: number;
  sangh?: SanghCard;
  fields?: Record<string, string>;
  requestId?: string;
};

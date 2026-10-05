"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Tags } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  SectionHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/client";
import {
  CATEGORY_REVIEW_NOTE_MAX_LENGTH,
  SELF_SERVICE_CATEGORIES,
  institutionTypeLabel,
  isSelfServiceCategory,
  type CategoryRequestReviewItem,
} from "@/lib/institution-category";

type Decision = "approve" | "reject";

type Pending = { request: CategoryRequestReviewItem; decision: Decision };

const LINK_CLASSES =
  "font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function formatWhen(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zagreb",
  }).format(date);
}

/**
 * Organisations whose type is not among the listed categories write their
 * own. Approval puts that text on the public profile and sets the category
 * they are filtered by on the map (their current one unless the reviewer
 * picks another); a rejection tells them why.
 */
export function CategoryRequestQueue({
  requests,
  total,
}: {
  requests: CategoryRequestReviewItem[];
  /** Every open request, not just the ones on this page. */
  total: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const router = useRouter();

  const [pending, setPending] = useState<Pending | null>(null);
  const [category, setCategory] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // An organisation in the violence-support category cannot send a request,
  // so the choice is always among the self-service categories.
  function openDecision(request: CategoryRequestReviewItem, decision: Decision) {
    setPending({ request, decision });
    const current = request.institution?.category;
    setCategory(isSelfServiceCategory(current) ? current : "");
    setCategoryError(null);
    setNote("");
    setNoteError(null);
  }

  async function submitDecision() {
    if (!pending) return;
    const approve = pending.decision === "approve";
    if (approve && !isSelfServiceCategory(category)) {
      setCategoryError(t("admin.category_requests_category_required"));
      return;
    }
    const trimmed = note.trim();
    // A refusal the organisation cannot act on is not a review.
    if (!approve && trimmed.length === 0) {
      setNoteError(t("admin.category_requests_note_required"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/institution-category-requests/${pending.request.id}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: pending.decision,
          note: trimmed || null,
          ...(approve ? { category } : {}),
        }),
      });
      if (!res.ok) {
        toast({
          tone: "error",
          title: t("admin.category_requests_failed_toast"),
          description: t(
            res.status === 409
              ? "admin.category_requests_error_closed"
              : res.status === 403
                ? "admin.category_requests_error_forbidden"
                : "admin.category_requests_error_generic"
          ),
        });
        if (res.status === 409) {
          setPending(null);
          router.refresh();
        }
        return;
      }
      toast({
        tone: "success",
        title: approve
          ? t("admin.category_requests_approved_toast")
          : t("admin.category_requests_rejected_toast"),
        description: pending.request.label,
      });
      setPending(null);
      router.refresh();
    } catch {
      toast({
        tone: "error",
        title: t("admin.category_requests_failed_toast"),
        description: t("admin.category_requests_error_generic"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="category-requests-heading" className="mt-8">
      <SectionHeader
        id="category-requests-heading"
        title={t("admin.category_requests_title")}
        description={t("admin.category_requests_subtitle")}
        actions={<Badge tone={total > 0 ? "warning" : "neutral"}>{total}</Badge>}
      />

      {total > requests.length ? (
        <p className="mb-4 text-sm text-ink-secondary">
          {t("admin.category_requests_showing", { shown: requests.length, total })}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />}
          title={t("admin.category_requests_empty")}
        />
      ) : (
        <ul className="space-y-4">
          {requests.map((request) => {
            const institution = request.institution;
            return (
              <Card as="li" key={request.id} padding="lg">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-lg font-semibold text-ink">„{request.label}”</p>
                    <p className="text-sm text-ink-secondary">
                      {institution ? (
                        <Link href={`/institution/${institution.id}`} className={LINK_CLASSES}>
                          {institution.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {institution?.city ? ` · ${institution.city}` : null}
                    </p>
                    {institution ? (
                      <p className="text-sm text-ink-secondary">
                        {t("admin.category_requests_current", {
                          category: institutionTypeLabel(
                            {
                              category: institution.category,
                              categoryLabel: institution.category_label,
                            },
                            locale
                          ),
                        })}
                      </p>
                    ) : null}
                    <p className="text-xs text-ink-tertiary">
                      <time dateTime={request.created_at} suppressHydrationWarning>
                        {formatWhen(request.created_at, locale)}
                      </time>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      onClick={() => openDecision(request, "approve")}
                      icon={<BadgeCheck className="h-4 w-4" aria-hidden="true" />}
                    >
                      {t("admin.category_requests_approve")}
                    </Button>
                    <Button variant="secondary" onClick={() => openDecision(request, "reject")}>
                      {t("admin.category_requests_reject")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={
          pending?.decision === "approve"
            ? t("admin.category_requests_approve_title")
            : t("admin.category_requests_reject_title")
        }
        description={
          pending
            ? `„${pending.request.label}” · ${pending.request.institution?.name ?? ""}`
            : undefined
        }
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant={pending?.decision === "approve" ? "primary" : "danger"}
              onClick={() => void submitDecision()}
              loading={submitting}
              data-dialog-initial-focus
            >
              {pending?.decision === "approve"
                ? t("admin.category_requests_approve")
                : t("admin.category_requests_reject")}
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {pending?.decision === "approve" ? (
            <Field
              label={t("admin.category_requests_category")}
              hint={t("admin.category_requests_category_hint")}
              required
              requiredLabel={t("common.required")}
              error={categoryError ?? undefined}
            >
              {(field) => (
                <Select
                  {...field}
                  value={category}
                  invalid={Boolean(categoryError)}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setCategoryError(null);
                  }}
                >
                  <option value="">{t("admin.claims_category_placeholder")}</option>
                  {SELF_SERVICE_CATEGORIES.map((option) => (
                    <option key={option} value={option}>
                      {institutionTypeLabel({ category: option }, locale)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field
            label={
              pending?.decision === "reject"
                ? t("admin.category_requests_reason")
                : t("admin.category_requests_note")
            }
            required={pending?.decision === "reject"}
            requiredLabel={t("common.required")}
            error={noteError ?? undefined}
          >
            {(field) => (
              <Textarea
                {...field}
                rows={3}
                maxLength={CATEGORY_REVIEW_NOTE_MAX_LENGTH}
                value={note}
                invalid={Boolean(noteError)}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteError(null);
                }}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </section>
  );
}

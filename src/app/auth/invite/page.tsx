import { Suspense } from "react";
import { AcceptInviteClient } from "./client";

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteClient />
    </Suspense>
  );
}

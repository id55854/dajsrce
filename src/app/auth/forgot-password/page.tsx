import { redirect } from "next/navigation";

// Recovery uses the address entered on the sign-in form.
export default function ForgotPasswordPage() {
  redirect("/auth/login");
}

"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorText, Field, FieldGroup, Label, TextInput } from "../../components/ui/Field";

// Sign-in only (spec R10). There is no public sign-up: accounts are created by
// an administrator (or the one-time first-admin bootstrap, see README).
// Server-side checks on every query/mutation remain the real enforcement.
// Outside the shell (unauthenticated, design-system R14): conventions 7, 8
// and 9 (form field, button, focus ring) still apply.
export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    formData.set("flow", "signIn");
    try {
      await signIn("password", formData);
      router.replace("/");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-sm mx-auto mt-12 p-content">
      <h1 className="text-2xl font-semibold leading-tight text-fg">Wavelink</h1>
      <p>Sign in to view the dashboard.</p>
      <form onSubmit={handleSubmit} className="mt-4">
        <FieldGroup>
          <Field>
            <Label>Email</Label>
            <TextInput name="email" type="email" required autoComplete="email" />
          </Field>
          <Field>
            <Label>Password</Label>
            <TextInput name="password" type="password" required autoComplete="current-password" />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" variant="primary" disabled={submitting}>
            Sign in
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-6 text-sm text-fg-muted">
        Accounts are created by an administrator. Ask yours if you need access.
      </p>
    </main>
  );
}

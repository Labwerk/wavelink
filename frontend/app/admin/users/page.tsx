"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { api } from "../../../../backend/_generated/api";
import type { Id } from "../../../../backend/_generated/dataModel";
import { StatusBadge } from "../../../components/StatusBadge";
import { Button } from "../../../components/ui/Button";
import { ErrorText, Field, FieldGroup, Label, SelectInput, TextInput } from "../../../components/ui/Field";
import { PageHeading } from "../../../components/ui/PageHeading";
import { TBody, Td, Th, THead, Table, Tr } from "../../../components/ui/Table";

const ROLES = ["viewer", "operator", "maintenance", "admin"] as const;
type Role = (typeof ROLES)[number];

// User and role administration (spec R7/R9). Only rendered for callers whose
// capability list includes `user.manage`; every function it calls
// (users.list / setRole / createUser, audit.list) re-checks that capability
// on the server, so this gate is cosmetic.
export default function AdminUsersPage() {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }
  if (me === null || !me.capabilities.includes("user.manage")) {
    return (
      <main>
        <p>Not available.</p>
        <Link href="/">Back to dashboard</Link>
      </main>
    );
  }
  return <UserAdmin currentUserId={me._id} />;
}

function UserAdmin({ currentUserId }: { currentUserId: Id<"users"> }) {
  const users = useQuery(api.users.list);
  const audit = useQuery(api.audit.list, { limit: 25 });
  const setRole = useMutation(api.users.setRole);
  const setActive = useMutation(api.users.setActive);
  const [error, setError] = useState<string | null>(null);

  async function handleRoleChange(userId: Id<"users">, role: Role) {
    setError(null);
    try {
      await setRole({ userId, role });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change role.");
    }
  }

  async function handleActiveChange(userId: Id<"users">, isActive: boolean) {
    setError(null);
    try {
      await setActive({ userId, isActive });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change account status.");
    }
  }

  const emailById = new Map(users?.map((u) => [u._id, u.email]));

  return (
    <main className="space-y-6">
      <PageHeading actions={<Link href="/">Back to dashboard</Link>}>Users</PageHeading>

      {error && <ErrorText>{error}</ErrorText>}
      {users === undefined && <p>Loading…</p>}
      <Table>
        <THead>
          <Tr>
            <Th>Email</Th>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Status</Th>
          </Tr>
        </THead>
        <TBody>
          {users?.map((u) => (
            <Tr key={u._id}>
              <Td>{u.email}</Td>
              <Td>{u.name}</Td>
              <Td>
                <SelectInput
                  value={u.role}
                  aria-label={`Role for ${u.email}`}
                  onChange={(e) => void handleRoleChange(u._id, e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </SelectInput>
                {u._id === currentUserId && <span> (you)</span>}
              </Td>
              <Td>
                <StatusBadge kind={u.isActive ? "active" : "inactive"} label={u.isActive ? "Active" : "Deactivated"} />{" "}
                {u._id !== currentUserId && (
                  <Button variant="secondary" onClick={() => void handleActiveChange(u._id, !u.isActive)}>
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      <CreateUserForm />

      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-fg">Recent changes</h2>
        <Table>
          <THead>
            <Tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Details</Th>
            </Tr>
          </THead>
          <TBody>
            {audit?.map((a) => (
              <Tr key={a._id}>
                <Td>{new Date(a.at).toLocaleString()}</Td>
                <Td>{a.actorId ? (emailById.get(a.actorId) ?? a.actorId) : "deployment admin key"}</Td>
                <Td>{a.action}</Td>
                <Td>
                  {a.targetTable === "users" && a.targetId
                    ? `${emailById.get(a.targetId as Id<"users">) ?? a.targetId} `
                    : ""}
                  {a.details
                    ? Object.entries(a.details)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(", ")
                    : ""}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </main>
  );
}

// Invite-only provisioning: the admin sets a temporary password and hands it
// to the user out-of-band. New accounts start as viewer; promote afterwards.
function CreateUserForm() {
  const createUser = useAction(api.users.createUser);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreated(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    try {
      await createUser({
        email: String(data.get("email") ?? ""),
        name: name || undefined,
        temporaryPassword: String(data.get("temporaryPassword") ?? ""),
      });
      setCreated(String(data.get("email") ?? ""));
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border pt-4 max-w-xs">
      <FieldGroup>
        <h2 className="text-xl font-semibold text-fg">Create user</h2>
        <Field>
          <Label>Email</Label>
          <TextInput name="email" type="email" placeholder="Email" required />
        </Field>
        <Field>
          <Label>Display name (optional)</Label>
          <TextInput name="name" placeholder="Display name (optional)" />
        </Field>
        <Field>
          <Label>Temporary password (min 8 chars)</Label>
          <TextInput
            name="temporaryPassword"
            type="password"
            placeholder="Temporary password (min 8 chars)"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        {created && (
          <p>
            Created {created} as viewer. Share the temporary password out-of-band, then promote
            their role above if needed.
          </p>
        )}
        <Button type="submit" variant="primary">
          Create user
        </Button>
      </FieldGroup>
    </form>
  );
}
